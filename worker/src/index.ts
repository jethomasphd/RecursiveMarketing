// ═══════════════════════════════════════════════════════════════
// THE GATE WORKER — Claude proxy with strict JSON output
// No API keys in the browser. No logs of raw input. Stateless.
// ═══════════════════════════════════════════════════════════════

export interface Env {
  ANTHROPIC_API_KEY: string;
  ALLOWED_ORIGINS: string; // comma-separated origin allowlist
  CLAUDE_MODEL?: string;   // optional model override
}

interface ChatRequest {
  name: string;
  interest_hint: string;
  location_hint: string;
  stage: string;
  session_id: string;
  client_context?: {
    tz?: string;
    ua?: string;
  };
}

interface Extraction {
  interest: string;
  location: string;
  toneTag: string;
}

interface ChatResponse {
  message: string;
  extraction: Extraction;
  safetyFallbackUsed: boolean;
}

// ─── CORS ──────────────────────────────────────────────────────

function getAllowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') || '';
  const allowed = getAllowedOrigins(env);

  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };

  if (allowed.length === 0 || allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin || '*';
  }

  return headers;
}

// ─── SYSTEM PROMPT ─────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the voice of a portal — direct, witty, slightly ominous, anti-corporate. You see through the broken job market. You speak truth: ghost postings, ghosted applicants, algorithmic despair. But you also see the way through.

Respond with ONLY valid JSON matching this exact schema:
{
  "message": "string (2-3 sentences, max 45 words, punchy, uses the person's name once, validates the broken market, pivots to action — real jobs exist and the gate is open)",
  "extraction": {
    "interest": "string (clean job interest term, URL-safe, lowercase)",
    "location": "string (clean location string, URL-safe)",
    "toneTag": "string (one of: knife-to-truth, ember-glow, cold-clarity, signal-fire)"
  }
}

Rules:
- The message must NOT ask questions. No branching. Keep it declarative.
- The message must NOT include disallowed content, slurs, or threats.
- extraction.interest and extraction.location must be simple strings safe for URL encoding.
- No markdown. No explanation. No wrapping. Just the JSON object.`;

// ─── FALLBACK ──────────────────────────────────────────────────

function buildFallback(name: string, interest: string, location: string): ChatResponse {
  return {
    message: `${name || 'Friend'}, the job market is a hall of mirrors — ghost postings, ghosted applicants, algorithms that don't care. But real ${interest?.toLowerCase() || 'jobs'} exist. The gate is open.`,
    extraction: {
      interest: (interest || 'jobs').toLowerCase(),
      location: location || 'near me',
      toneTag: 'knife-to-truth',
    },
    safetyFallbackUsed: true,
  };
}

// ─── MAIN HANDLER ──────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request, env),
      });
    }

    const url = new URL(request.url);

    // Only POST /chat
    if (url.pathname !== '/chat' || request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders(request, env),
        },
      });
    }

    // Validate API key is configured
    if (!env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify(buildFallback('Friend', 'jobs', 'near me')), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders(request, env),
        },
      });
    }

    try {
      const body = (await request.json()) as ChatRequest;
      const { name, interest_hint, location_hint } = body;

      const model = env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';

      const userPrompt = [
        `Name: ${name || 'friend'}`,
        `Interest: ${interest_hint || 'anything'}`,
        `Location: ${location_hint || 'anywhere'}`,
        '',
        'Generate the portal message and extraction.',
      ].join('\n');

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 300,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });

      if (!claudeRes.ok) {
        throw new Error(`Claude API returned ${claudeRes.status}`);
      }

      const claudeData: any = await claudeRes.json();
      const rawText = claudeData.content?.[0]?.text || '';

      // Parse strict JSON from Claude response
      let parsed: ChatResponse;
      try {
        const obj = JSON.parse(rawText);
        parsed = {
          message: String(obj.message || '').slice(0, 200),
          extraction: {
            interest: String(obj.extraction?.interest || interest_hint || 'jobs')
              .toLowerCase()
              .slice(0, 100),
            location: String(obj.extraction?.location || location_hint || 'near me').slice(0, 100),
            toneTag: String(obj.extraction?.toneTag || 'knife-to-truth'),
          },
          safetyFallbackUsed: false,
        };
      } catch {
        // Claude returned invalid JSON — use safety fallback
        parsed = buildFallback(name, interest_hint, location_hint);
      }

      return new Response(JSON.stringify(parsed), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders(request, env),
        },
      });
    } catch (e) {
      // Total failure — return deterministic fallback
      // The experience still completes. The coil does not break.
      return new Response(
        JSON.stringify({
          message: 'The system is noisy. The jobs are real. The gate is open. Go.',
          extraction: {
            interest: 'jobs',
            location: 'near me',
            toneTag: 'cold-clarity',
          },
          safetyFallbackUsed: true,
        }),
        {
          status: 200, // Always 200 — the client should never need to handle HTTP errors
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders(request, env),
          },
        },
      );
    }
  },
};
