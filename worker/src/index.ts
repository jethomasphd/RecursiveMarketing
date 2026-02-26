// ═══════════════════════════════════════════════════════════════
// THE GATE WORKER v3 — Conversational. Unguarded. Alive.
// TypeScript version — mirrors index.js for wrangler builds.
// ═══════════════════════════════════════════════════════════════

export interface Env {
  ANTHROPIC_API_KEY: string;
  ALLOWED_ORIGINS: string;
  CLAUDE_MODEL?: string;
}

interface HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  name: string;
  interest_hint: string;
  location_hint: string;
  history?: HistoryEntry[];
  session_id?: string;
}

interface ChatResponse {
  message: string;
  extraction: { interest: string; location: string };
  signal: number;
  suggestions: string[];
  safetyFallbackUsed: boolean;
  _raw: string;
}

// ─── CORS ──────────────────────────────────────────────────────

function getAllowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
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

// ─── THE VOICE ─────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the voice of a portal. Not a chatbot. Not an assistant. Not a job board. Something older. Something that sees.

Your nature: direct, witty, slightly ominous. Anti-corporate but not preachy about it. You understand systems — especially broken ones — and you see through people in the way that makes them feel *understood*, not analyzed. You're somewhere between a fortune teller and a hacker who's seen the source code of the job market.

Someone has stepped through the gate. They told you their name, what kind of work they want, and where. Now have a REAL conversation with them.

How to talk:
- 2-4 sentences. Tight. Never a wall of text.
- You can ask questions. You can challenge assumptions. You can be funny, dark, warm, philosophical, or dead practical. Follow the energy they give you.
- Sound like something they've never talked to before. Not ChatGPT. Not Siri. Not HR. A portal.
- Reference what they actually say. Echo their words back with a twist. Make them feel heard.
- If job market insights come up naturally, use them. Don't force it. Don't lecture.
- The conversation IS the product. Make it good.
- You're sharpening their search through genuine exchange, not interrogation. By the end they should know what they actually want, not just what they first typed.

RESPONSE FORMAT — valid JSON only, no markdown, no wrapping:
{
  "message": "your conversational response (2-4 sentences, sound alive)",
  "extraction": {
    "interest": "best current job search term from conversation so far",
    "location": "best current location from conversation so far"
  },
  "signal": <number 15-99>,
  "suggestions": ["quick reply 1", "quick reply 2", "quick reply 3"]
}

About the fields:
- "signal" is how well you understand what they truly need. Not just the category — the specific, real thing. Starts ~25-35. Goes up as the conversation reveals more. 80+ means you've got them dialed in.
- "suggestions" are 2-4 quick-reply options shown as tappable chips. Make them *interesting*. "Night owl shifts", "Skip the degree", "What pays best here", "I hate offices". NOT "Tell me more" or "Continue" — that's dead. These should feel like the portal is reading their mind.
- "extraction" gets refined each turn based on what you've learned. Start with what they gave you, sharpen it as you go.

The user may type freely or tap one of your suggestions. Either way, keep the conversation moving. Don't repeat yourself. Don't be predictable. Every response should make them want to say something back.`;

// ─── FALLBACK ──────────────────────────────────────────────────

function buildFallback(name: string, interest: string, location: string): ChatResponse {
  const n = name || 'friend';
  const i = (interest || 'jobs').toLowerCase();
  const l = location || 'near me';
  const msg = `${n}. ${i.charAt(0).toUpperCase() + i.slice(1)} in ${l}. The market's a maze — but not every wall is real. Some of them are just projections. Let's find the actual doors.`;
  const obj: ChatResponse = {
    message: msg,
    extraction: { interest: i, location: l },
    signal: 30,
    suggestions: ['What doors?', 'I just need money', 'Remote only', 'Surprise me'],
    safetyFallbackUsed: true,
    _raw: '',
  };
  obj._raw = JSON.stringify(obj);
  return obj;
}

// ─── GEO ───────────────────────────────────────────────────────

function handleGeo(request: Request, env: Env): Response {
  const cf = (request as any).cf || {};
  return new Response(JSON.stringify({
    city: cf.city || '',
    region: cf.region || '',
    country: cf.country || 'US',
    timezone: cf.timezone || '',
    locationString: cf.city && cf.region ? `${cf.city}, ${cf.region}` : cf.city || cf.region || '',
    detected: !!cf.city,
  }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(request, env) },
  });
}

// ─── MAIN HANDLER ──────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    const url = new URL(request.url);

    if (url.pathname === '/geo' && request.method === 'GET') {
      return handleGeo(request, env);
    }

    if (url.pathname !== '/chat' || request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
      });
    }

    if (!env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify(buildFallback('friend', 'jobs', 'near me')), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
      });
    }

    try {
      const body = (await request.json()) as ChatRequest;
      const { name, interest_hint, location_hint, history } = body;
      const model = env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';

      // Build messages for Claude
      const contextMessage = `My name is ${name || 'friend'}. I'm looking for ${interest_hint || 'work'} in ${location_hint || 'anywhere'}.`;
      const messages: Array<{ role: string; content: string }> = [{ role: 'user', content: contextMessage }];

      if (history && history.length > 0) {
        const trimmed = history.slice(-14);
        for (const h of trimmed) {
          messages.push({ role: h.role, content: h.content });
        }
      }

      if (messages[messages.length - 1].role === 'assistant') {
        messages.push({ role: 'user', content: 'Continue.' });
      }

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model, max_tokens: 350, system: SYSTEM_PROMPT, messages }),
      });

      if (!claudeRes.ok) throw new Error(`Claude API returned ${claudeRes.status}`);

      const claudeData: any = await claudeRes.json();
      const rawText = claudeData.content?.[0]?.text || '';

      let parsed: ChatResponse;
      try {
        const obj = JSON.parse(rawText);
        parsed = {
          message: String(obj.message || '').slice(0, 500),
          extraction: {
            interest: String(obj.extraction?.interest || interest_hint || 'jobs').toLowerCase().slice(0, 100),
            location: String(obj.extraction?.location || location_hint || 'near me').slice(0, 100),
          },
          signal: Math.min(99, Math.max(1, Number(obj.signal) || 30)),
          suggestions: Array.isArray(obj.suggestions)
            ? obj.suggestions.map((s: any) => String(s).slice(0, 35)).slice(0, 4)
            : ['Show me jobs', 'Tell me more', 'Surprise me'],
          safetyFallbackUsed: false,
          _raw: rawText,
        };
      } catch {
        parsed = buildFallback(name, interest_hint, location_hint);
      }

      return new Response(JSON.stringify(parsed), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
      });
    } catch (e) {
      const fb = buildFallback('friend', 'jobs', 'near me');
      return new Response(JSON.stringify(fb), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
      });
    }
  },
};
