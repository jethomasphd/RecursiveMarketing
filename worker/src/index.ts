// ═══════════════════════════════════════════════════════════════
// THE GATE WORKER v4 — Real jobs. Real data. Real magic.
// USAJobs.gov API + Claude conversation. TypeScript version.
// ═══════════════════════════════════════════════════════════════

export interface Env {
  ANTHROPIC_API_KEY: string;
  USAJOBS_API_KEY: string;
  USAJOBS_EMAIL: string;
  ALLOWED_ORIGINS: string;
  CLAUDE_MODEL?: string;
}

interface JobItem {
  title: string; org: string; dept: string; location: string;
  salaryMin: string; salaryMax: string; salaryPeriod: string;
  grade: string; schedule: string; url: string; applyUrl: string;
  closing: string; qualifications: string;
}

// ─── CORS ──────────────────────────────────────────────────────

function getAllowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') || '';
  const allowed = getAllowedOrigins(env);
  const h: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  if (allowed.length === 0 || allowed.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin || '*';
  }
  return h;
}

function jsonResponse(data: any, request: Request, env: Env, status?: number): Response {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
  });
}

// ─── USAJOBS API ───────────────────────────────────────────────

async function searchUSAJobs(keyword: string, location: string, env: Env): Promise<{ items: JobItem[]; total: number }> {
  if (!env.USAJOBS_API_KEY || !env.USAJOBS_EMAIL) return { items: [], total: 0 };

  const params = new URLSearchParams();
  if (keyword && keyword !== 'anything') params.set('Keyword', keyword);
  if (location && location !== 'Anywhere' && location !== 'near me' && location !== 'Remote') {
    params.set('LocationName', location);
    params.set('Radius', '50');
  }
  if (location === 'Remote') params.set('RemoteIndicator', 'True');
  params.set('ResultsPerPage', '15');
  params.set('WhoMayApply', 'Public');
  params.set('SortField', 'opendate');
  params.set('SortDirection', 'desc');
  params.set('Fields', 'Min');

  try {
    const res = await fetch('https://data.usajobs.gov/api/search?' + params.toString(), {
      headers: {
        'Authorization-Key': env.USAJOBS_API_KEY,
        'User-Agent': env.USAJOBS_EMAIL,
        'Host': 'data.usajobs.gov',
      },
    });
    if (!res.ok) return { items: [], total: 0 };

    const data: any = await res.json();
    const results = data?.SearchResult?.SearchResultItems || [];
    const total = data?.SearchResult?.SearchResultCountAll || 0;

    const items: JobItem[] = results.map((r: any) => {
      const d = r.MatchedObjectDescriptor || {};
      const pay = d.PositionRemuneration?.[0] || {};
      const loc = d.PositionLocation?.[0] || {};
      return {
        title: d.PositionTitle || 'Untitled Position',
        org: d.OrganizationName || '',
        dept: d.DepartmentName || '',
        location: d.PositionLocationDisplay || loc.CityName || '',
        salaryMin: pay.MinimumRange || '',
        salaryMax: pay.MaximumRange || '',
        salaryPeriod: pay.Description || 'Per Year',
        grade: d.JobGrade?.[0]?.Code || '',
        schedule: d.PositionSchedule?.[0]?.Name || '',
        url: d.PositionURI || '',
        applyUrl: d.ApplyURI?.[0] || d.PositionURI || '',
        closing: d.ApplicationCloseDate ? formatDate(d.ApplicationCloseDate) : '',
        qualifications: d.QualificationSummary ? d.QualificationSummary.slice(0, 200) : '',
      };
    });

    return { items, total };
  } catch { return { items: [], total: 0 }; }
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return ''; }
}

function formatSalary(min: string, max: string, period: string): string {
  if (!min && !max) return '';
  const fmt = (n: string) => { const num = parseInt(n); return isNaN(num) ? n : '$' + num.toLocaleString('en-US'); };
  const range = min && max ? fmt(min) + ' – ' + fmt(max) : fmt(min || max);
  const per = period === 'Per Year' ? '/yr' : period === 'Per Hour' ? '/hr' : '/' + (period || 'yr');
  return range + per;
}

function formatJobsForClaude(jobResult: { items: JobItem[]; total: number }): string {
  if (!jobResult.items.length) return '\n[USAJOBS: No results found for this search.]\n';
  let text = `\n[USAJOBS RESULTS: ${jobResult.total} total federal positions found, showing top ${jobResult.items.length}]\n`;
  jobResult.items.forEach((j, i) => {
    const sal = formatSalary(j.salaryMin, j.salaryMax, j.salaryPeriod);
    text += `${i + 1}. ${j.title} | ${j.org} | ${j.location} | ${sal}${j.grade ? ' (' + j.grade + ')' : ''} | ${j.schedule} | Closes ${j.closing}\n`;
  });
  text += '\nReference these REAL listings in your response. Use specific titles, salaries, and agencies.\n';
  return text;
}

function buildSearchUrl(keyword: string, location: string): string {
  const params = new URLSearchParams();
  if (keyword && keyword !== 'anything') params.set('k', keyword);
  if (location && location !== 'Anywhere' && location !== 'near me') params.set('l', location);
  return 'https://www.usajobs.gov/Search/Results?' + params.toString();
}

// ─── CLAUDE ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the voice of a portal. Not a chatbot. Not a recruiter. Something that sees through the noise of government hiring and finds the signal.

You have access to REAL federal job listings from USAJobs.gov. When jobs are provided in the context, reference them specifically — by title, agency, salary, and location. Don't be vague. Be precise. Help the user understand which positions are worth pursuing and why.

Your tone: direct, witty, slightly conspiratorial — like you've hacked the federal hiring system and you're letting someone in on what you found. You understand GS grades, locality pay, federal benefits (FEHB health insurance, FERS retirement, TSP with 5% match, student loan forgiveness through PSLF), and the rhythms of government hiring.

If the listings are strong matches, say so with specifics. "The VA in Austin has a medical admin at GS-11 — that's $65k with locality, full benefits, and PSLF eligibility. That's the one."

If they're weak matches, be honest and help them adjust. "Nothing in warehouse specifically, but I see logistics specialist openings at Fort Hood — same hands-on work, federal pay scale."

If there are NO results, say so and pivot. Suggest different keywords, broader location, or related fields. Federal job titles are weird — "customer service" might be "Contact Representative" in government speak.

How to talk:
- 2-4 sentences. Tight. Reference specific jobs when you have them.
- You can ask questions to refine: "Do you have a clearance?" "How many years of experience?" "Would you relocate?"
- Sound like something they've never talked to before. A portal that pulled real federal data and is serving it raw.
- The conversation should steer toward a real application.

RESPONSE FORMAT — valid JSON only, no markdown, no wrapping:
{
  "message": "your response referencing real job data when available",
  "extraction": {
    "interest": "refined USAJobs keyword based on conversation",
    "location": "refined location"
  },
  "signal": <number 15-99>,
  "suggestions": ["2-4 contextual quick replies"],
  "refineSearch": false
}

About the fields:
- signal: search convergence. 15-35 = no/poor matches. 40-65 = decent matches. 70-99 = strong match found.
- suggestions: contextual quick replies. Make them specific to the job data.
- refineSearch: true ONLY if a different keyword/location would produce better results. Triggers new USAJobs search.
- extraction.interest should be a good USAJobs keyword. Refine based on conversation.`;

// ─── FALLBACK ──────────────────────────────────────────────────

function buildFallback(name: string, interest: string, location: string): any {
  const n = name || 'friend';
  const i = (interest || 'jobs').toLowerCase();
  const l = location || 'anywhere';
  const msg = `${n}. Federal hiring is its own universe — different rules, different language, different game. I'm scanning USAJobs for ${i} positions${l !== 'anywhere' ? ' near ' + l : ''}. Give me a second to find the signal.`;
  return {
    message: msg, extraction: { interest: i, location: l }, signal: 20,
    suggestions: ['What did you find?', 'Try broadening it', 'Remote only', 'What pays best?'],
    jobs: [], totalResults: 0, searchUrl: buildSearchUrl(i, l),
    safetyFallbackUsed: true, _raw: JSON.stringify({ message: msg }),
  };
}

// ─── GEO ───────────────────────────────────────────────────────

function handleGeo(request: Request, env: Env): Response {
  const cf = (request as any).cf || {};
  return jsonResponse({
    city: cf.city || '', region: cf.region || '', country: cf.country || 'US',
    timezone: cf.timezone || '',
    locationString: cf.city && cf.region ? `${cf.city}, ${cf.region}` : cf.city || cf.region || '',
    detected: !!cf.city,
  }, request, env);
}

// ─── MAIN HANDLER ──────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    const url = new URL(request.url);
    if (url.pathname === '/geo' && request.method === 'GET') return handleGeo(request, env);
    if (url.pathname !== '/chat' || request.method !== 'POST') {
      return jsonResponse({ error: 'Not found' }, request, env, 404);
    }
    if (!env.ANTHROPIC_API_KEY) return jsonResponse(buildFallback('friend', 'jobs', 'anywhere'), request, env);

    try {
      const body: any = await request.json();
      const { name, interest_hint, location_hint, history, cachedJobs, forceSearch } = body;

      // Step 1: Get job data
      let jobResult: { items: JobItem[]; total: number };
      if (cachedJobs && cachedJobs.length > 0 && !forceSearch) {
        jobResult = { items: cachedJobs, total: cachedJobs.length };
      } else {
        jobResult = await searchUSAJobs(interest_hint, location_hint, env);
      }

      const jobContext = formatJobsForClaude(jobResult);
      const searchUrl = buildSearchUrl(interest_hint, location_hint);
      const model = env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';

      // Step 2: Build messages
      const contextMessage = `My name is ${name || 'friend'}. I'm looking for ${interest_hint || 'work'} in ${location_hint || 'anywhere'}. ${jobContext}`;
      const messages: Array<{ role: string; content: string }> = [{ role: 'user', content: contextMessage }];

      if (history && history.length > 0) {
        for (const h of history.slice(-14)) messages.push({ role: h.role, content: h.content });
      }
      if (messages[messages.length - 1].role === 'assistant') {
        messages.push({ role: 'user', content: 'Continue.' });
      }

      // Step 3: Call Claude
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model, max_tokens: 400, system: SYSTEM_PROMPT, messages }),
      });

      if (!claudeRes.ok) throw new Error('Claude API returned ' + claudeRes.status);
      const claudeData: any = await claudeRes.json();
      const rawText = claudeData.content?.[0]?.text || '';

      // Step 4: Parse
      let parsed: any;
      try {
        const obj = JSON.parse(rawText);
        parsed = {
          message: String(obj.message || '').slice(0, 600),
          extraction: {
            interest: String(obj.extraction?.interest || interest_hint || 'jobs').toLowerCase().slice(0, 100),
            location: String(obj.extraction?.location || location_hint || 'anywhere').slice(0, 100),
          },
          signal: Math.min(99, Math.max(1, Number(obj.signal) || 30)),
          suggestions: Array.isArray(obj.suggestions) ? obj.suggestions.map((s: any) => String(s).slice(0, 40)).slice(0, 4) : ['Show me more', 'Refine search'],
          refineSearch: !!obj.refineSearch,
          jobs: jobResult.items.slice(0, 15),
          totalResults: jobResult.total,
          searchUrl, safetyFallbackUsed: false, _raw: rawText,
        };
      } catch {
        const fb = buildFallback(name, interest_hint, location_hint);
        fb.jobs = jobResult.items.slice(0, 15);
        fb.totalResults = jobResult.total;
        fb.searchUrl = searchUrl;
        parsed = fb;
      }

      return jsonResponse(parsed, request, env);
    } catch {
      return jsonResponse(buildFallback('friend', 'jobs', 'anywhere'), request, env);
    }
  },
};
