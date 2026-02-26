// ═══════════════════════════════════════════════════════════════
// THE GATE WORKER v2 — Multi-turn Claude proxy with geo detection
// The coil now has teeth. Each turn sharpens the signal.
// ═══════════════════════════════════════════════════════════════

export interface Env {
  ANTHROPIC_API_KEY: string;
  ALLOWED_ORIGINS: string;
  CLAUDE_MODEL?: string;
}

interface ChatRequest {
  name: string;
  interest_hint: string;
  location_hint: string;
  turn?: number;
  history?: Array<{ role: string; message?: string; choice?: string }>;
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
  chips?: string[];
  signalPct: number;
  matchCount: number;
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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };

  if (allowed.length === 0 || allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin || '*';
  }

  return headers;
}

// ─── SYSTEM PROMPTS ────────────────────────────────────────────

const SYSTEM_PROMPT_TURN_1 = `You are the voice of a portal — direct, witty, slightly ominous, anti-corporate. You see through the broken job market. You speak truth: ghost postings, ghosted applicants, algorithmic despair. But you also see the way through.

This is turn 1. The user just entered the portal with their name, interest, and location. Generate an opening message that hooks them and makes them want to engage further. Be specific to their interest and location — name the city, reference the local market.

Respond with ONLY valid JSON matching this exact schema:
{
  "message": "string (2-3 sentences, max 50 words, punchy, uses the person's name once, validates the broken market in their specific field/location, pivots to action — but leaves a thread dangling that makes them want to tap a chip)",
  "extraction": {
    "interest": "string (clean job search term, URL-safe, lowercase)",
    "location": "string (clean city/state or 'remote', URL-safe)",
    "toneTag": "string (one of: knife-to-truth, ember-glow, cold-clarity, signal-fire)"
  },
  "chips": [
    "string (4-5 contextual response options the user can tap — each 2-4 words, specific to their interest/location, the first should confirm/proceed, the rest should refine: remote, pay, shift, experience level, sub-specialty)"
  ],
  "signalPct": 35,
  "matchCount": 100
}

Rules:
- chips must be an array of 4-5 SHORT strings. Each chip is a refinement action. Make them feel like the system is reading the user's mind.
- signalPct must be between 25-45 (this is turn 1 — the signal is still forming)
- matchCount must be between 80-200 (broad initial match count)
- The message MUST reference something specific about their location or field — a real pain point, a known market condition, a stat. Make it feel researched.
- The message must NOT ask questions. Keep it declarative. End with tension, not resolution.
- No markdown. No explanation. No wrapping. Just the JSON object.`;

const SYSTEM_PROMPT_TURN_2 = `You are the voice of a portal — direct, witty, slightly ominous, anti-corporate. The signal is sharpening. The user has engaged once already and chose to refine their search.

This is turn 2. You have their initial interest, location, and the refinement they chose. The signal is getting stronger. Your message should acknowledge what they just chose and make it feel like the system is NARROWING — like sonar pinging closer. Be specific. Be sharp.

Respond with ONLY valid JSON matching this exact schema:
{
  "message": "string (2-3 sentences, max 50 words, acknowledge the refinement they chose, make it feel like the search just got surgically precise, reference a specific market insight about their refined criteria)",
  "extraction": {
    "interest": "string (refined job search term incorporating their choice, URL-safe, lowercase)",
    "location": "string (refined location, URL-safe)",
    "toneTag": "string (one of: knife-to-truth, ember-glow, cold-clarity, signal-fire)"
  },
  "chips": [
    "string (3-4 final refinement options — more specific now, feel like the last dial being turned)"
  ],
  "signalPct": 72,
  "matchCount": 40
}

Rules:
- signalPct must be between 60-80 (the signal is clarifying)
- matchCount must be between 20-60 (the matches are refining down — this is GOOD, fewer = more precise)
- chips should be 3-4 options, more specific than turn 1
- One chip should always be "Lock it in" or similar (proceed to results)
- The message should create urgency — these matches won't wait
- No markdown. No explanation. No wrapping. Just the JSON object.`;

const SYSTEM_PROMPT_TURN_3 = `You are the voice of a portal — direct, witty, slightly ominous, anti-corporate. The signal is locked. The user has refined twice. This is the final turn before they cross the gate.

This is turn 3. Generate a closing message that creates maximum urgency and excitement. The matches are precise. The gate is ready. Make them feel like they've been handed a key.

Respond with ONLY valid JSON matching this exact schema:
{
  "message": "string (1-2 sentences, max 35 words, final and decisive, create urgency — these specific matches are READY, use their name, make it feel like the system just cracked a code for them)",
  "extraction": {
    "interest": "string (final refined job search term, URL-safe, lowercase)",
    "location": "string (final location, URL-safe)",
    "toneTag": "string (one of: knife-to-truth, ember-glow, cold-clarity, signal-fire)"
  },
  "signalPct": 97,
  "matchCount": 12
}

Rules:
- signalPct must be between 90-99
- matchCount must be between 5-18 (precision matches — this feels EXCLUSIVE)
- No chips needed for turn 3 — the CTA button takes over
- The message should feel like a lock clicking into place
- No markdown. No explanation. No wrapping. Just the JSON object.`;

// ─── FALLBACKS ─────────────────────────────────────────────────

function buildFallback(name: string, interest: string, location: string, turn?: number): ChatResponse {
  const t = turn || 1;
  const n = name || 'Friend';
  const i = (interest || 'jobs').toLowerCase();
  const l = location || 'near me';

  if (t === 1) {
    return {
      message: `${n}, ${i} in ${l} — 73% of those listings are ghosts. The algorithms feed you phantoms. But the real ones exist, and we just locked onto the signal.`,
      extraction: { interest: i, location: l, toneTag: 'knife-to-truth' },
      chips: ['Show me what you found', 'Make it remote', 'Higher pay only', 'Entry level', 'Night shift'],
      signalPct: 38,
      matchCount: 142,
      safetyFallbackUsed: true,
    };
  }
  if (t === 2) {
    return {
      message: `${n}, signal sharpening. Filtering the noise out of ${i} in ${l}. The match count just dropped — that means we're getting closer, not further.`,
      extraction: { interest: i, location: l, toneTag: 'cold-clarity' },
      chips: ['Lock it in', 'Remote only', 'Full-time', '$20+/hr'],
      signalPct: 71,
      matchCount: 38,
      safetyFallbackUsed: true,
    };
  }
  return {
    message: `${n}, signal locked. Verified ${i} positions in ${l}. The gate is open. Go.`,
    extraction: { interest: i, location: l, toneTag: 'signal-fire' },
    signalPct: 96,
    matchCount: 11,
    safetyFallbackUsed: true,
  };
}

// ─── GEO DETECTION ────────────────────────────────────────────

function handleGeo(request: Request, env: Env): Response {
  const cf = (request as any).cf || {};
  const city = cf.city || '';
  const region = cf.region || '';
  const country = cf.country || 'US';
  const tz = cf.timezone || '';

  let locationString = '';
  if (city && region) {
    locationString = `${city}, ${region}`;
  } else if (city) {
    locationString = city;
  } else if (region) {
    locationString = region;
  }

  return new Response(JSON.stringify({
    city,
    region,
    country,
    timezone: tz,
    locationString,
    detected: !!city,
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders(request, env),
    },
  });
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

    // GET /geo — lightweight location detection from CF headers
    if (url.pathname === '/geo' && request.method === 'GET') {
      return handleGeo(request, env);
    }

    // POST /chat — multi-turn Claude conversation
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
      return new Response(JSON.stringify(buildFallback('Friend', 'jobs', 'near me', 1)), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders(request, env),
        },
      });
    }

    try {
      const body = (await request.json()) as ChatRequest;
      const { name, interest_hint, location_hint, turn, history } = body;
      const turnNum = Math.min(turn || 1, 3);

      const model = env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';

      // Select system prompt based on turn
      const systemPrompt = turnNum === 1
        ? SYSTEM_PROMPT_TURN_1
        : turnNum === 2
          ? SYSTEM_PROMPT_TURN_2
          : SYSTEM_PROMPT_TURN_3;

      // Build user prompt with conversation context
      const contextLines: string[] = [
        `Name: ${name || 'friend'}`,
        `Interest: ${interest_hint || 'anything'}`,
        `Location: ${location_hint || 'anywhere'}`,
        `Turn: ${turnNum}`,
      ];

      if (history && history.length > 0) {
        contextLines.push('');
        contextLines.push('Conversation so far:');
        for (const h of history) {
          if (h.role === 'assistant') {
            contextLines.push(`Portal said: "${h.message}"`);
          } else if (h.role === 'user') {
            contextLines.push(`User chose: "${h.choice}"`);
          }
        }
      }

      contextLines.push('');
      contextLines.push('Generate the portal response.');

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 400,
          system: systemPrompt,
          messages: [{ role: 'user', content: contextLines.join('\n') }],
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
          message: String(obj.message || '').slice(0, 250),
          extraction: {
            interest: String(obj.extraction?.interest || interest_hint || 'jobs')
              .toLowerCase()
              .slice(0, 100),
            location: String(obj.extraction?.location || location_hint || 'near me').slice(0, 100),
            toneTag: String(obj.extraction?.toneTag || 'knife-to-truth'),
          },
          chips: Array.isArray(obj.chips)
            ? obj.chips.map((c: any) => String(c).slice(0, 30)).slice(0, 5)
            : undefined,
          signalPct: Math.min(99, Math.max(1, Number(obj.signalPct) || 35)),
          matchCount: Math.min(500, Math.max(1, Number(obj.matchCount) || 100)),
          safetyFallbackUsed: false,
        };
      } catch {
        parsed = buildFallback(name, interest_hint, location_hint, turnNum);
      }

      return new Response(JSON.stringify(parsed), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders(request, env),
        },
      });
    } catch (e) {
      return new Response(
        JSON.stringify(buildFallback('Friend', 'jobs', 'near me', 1)),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders(request, env),
          },
        },
      );
    }
  },
};
