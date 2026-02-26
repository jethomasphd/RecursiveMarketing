// ═══════════════════════════════════════════════════════════════
// THE GATE WORKER v6 — Federal job matchmaker.
// USAJobs.gov API + Claude → converge on a specific job.
// TypeScript version — identical logic to index.js.
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

// ─── CORS (always allow — public API) ────────────────────────

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data: any, request: Request, status?: number): Response {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  });
}

// ─── USAJOBS API ───────────────────────────────────────────────

async function searchUSAJobs(keyword: string, location: string, env: Env): Promise<{ items: JobItem[]; total: number; missingKeys?: boolean }> {
  if (!env.USAJOBS_API_KEY || !env.USAJOBS_EMAIL) return { items: [], total: 0, missingKeys: true };

  const params = new URLSearchParams();
  if (keyword && keyword !== 'anything') params.set('Keyword', keyword);
  if (location && location !== 'Anywhere' && location !== 'near me' && location !== 'Remote') {
    params.set('LocationName', location);
    params.set('Radius', '50');
  }
  if (location === 'Remote') params.set('RemoteIndicator', 'True');
  params.set('ResultsPerPage', '20');
  params.set('WhoMayApply', 'Public');
  params.set('SortField', 'opendate');
  params.set('SortDirection', 'desc');

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
        closing: d.ApplicationCloseDate ? fmtDate(d.ApplicationCloseDate) : '',
        qualifications: d.QualificationSummary ? d.QualificationSummary.slice(0, 300) : '',
      };
    });
    return { items, total };
  } catch { return { items: [], total: 0 }; }
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return ''; }
}

function fmtSalary(min: string, max: string, period: string): string {
  if (!min && !max) return '';
  const f = (n: string) => { const v = parseInt(n); return isNaN(v) ? n : '$' + v.toLocaleString('en-US'); };
  const range = min && max ? f(min) + ' – ' + f(max) : f(min || max);
  const per = period === 'Per Year' ? '/yr' : period === 'Per Hour' ? '/hr' : '/' + (period || 'yr');
  return range + per;
}

function jobsForClaude(result: { items: JobItem[]; total: number }): string {
  if (!result.items.length) return '\n[USAJOBS: No results found for this search.]\n';
  let t = `\n[USAJOBS LIVE DATA: ${result.total} total positions. Top ${result.items.length} shown.]\n`;
  result.items.forEach((j, i) => {
    const sal = fmtSalary(j.salaryMin, j.salaryMax, j.salaryPeriod);
    t += `[${i}] ${j.title} | ${j.org} (${j.dept}) | ${j.location} | ${sal}`;
    if (j.grade) t += ` | ${j.grade}`;
    if (j.schedule) t += ` | ${j.schedule}`;
    if (j.closing) t += ` | Closes ${j.closing}`;
    t += '\n';
    if (j.qualifications) t += `    Quals: ${j.qualifications}\n`;
  });
  return t;
}

function buildSearchUrl(keyword: string, location: string): string {
  const p = new URLSearchParams();
  if (keyword && keyword !== 'anything') p.set('k', keyword);
  if (location && location !== 'Anywhere' && location !== 'near me') p.set('l', location);
  return 'https://www.usajobs.gov/Search/Results?' + p.toString();
}

// ─── CLAUDE SYSTEM PROMPT ────────────────────────────────────

const SYSTEM = `You are a job-matching intelligence inside a mysterious portal. You have live access to USAJobs.gov federal job listings. Your single mission: guide this person to a specific federal job they should apply for RIGHT NOW.

You're not a generic chatbot. You're something they've never talked to before — a system that scanned the entire federal hiring database and is about to hand them the key to a career. Direct. Witty. A little conspiratorial. Like you cracked open the government hiring machine and you're showing them what's inside.

REAL DATA is provided as indexed listings [0], [1], [2] etc. These are live federal positions. Reference them by name, agency, salary, and location. Be specific. "The VA needs an IT Specialist in Austin at $89k — that's you" not "there are some IT jobs available."

YOUR JOB IN EACH RESPONSE:
1. FIRST MESSAGE: Survey what's available. Highlight 2-3 standouts. Ask a sharpening question — experience level, clearance, education, salary floor, willingness to relocate. Show you're working for them.
2. MIDDLE MESSAGES: Narrow based on their answers. Eliminate bad fits. Advocate for specific positions. Explain WHY — salary, benefits (FEHB, FERS, TSP 5% match, PSLF student loan forgiveness), career path, work-life balance. Ask another sharpening question if needed.
3. CONVERGENCE: When you've identified the best match, go hard on it. "This is the one." Give them the pitch — title, agency, pay, location, why it fits THEM specifically. Set topPick to that job's index number.

You understand: GS/GL grades, locality pay adjustments, federal benefits, PSLF eligibility, security clearance requirements, how to translate private sector experience into federal qualification language, and that government job titles are weird ("Customer Service Rep" = "Contact Representative", "Warehouse" = "Materials Handler" or "Supply Technician").

TONE: 2-4 sentences per message. Tight. Alive. Every message either reveals something specific about a job or asks something that helps you find the right one. No filler. No "great question!" No "I'd be happy to help."

RESPONSE FORMAT — valid JSON only, no markdown:
{
  "message": "your response",
  "extraction": {
    "interest": "refined keyword for USAJobs search",
    "location": "refined location"
  },
  "signal": <number 15-99>,
  "topPick": <index number of recommended job, or null if not yet converged>,
  "showJobs": [<array of up to 3 job index numbers to display as cards>],
  "suggestions": ["2-4 short contextual quick-reply options"],
  "refineSearch": false
}

FIELD RULES:
- signal: 15-30 = scanning/no great matches. 35-55 = promising leads, narrowing. 60-80 = strong candidates identified. 85-99 = locked on THE job to apply for.
- topPick: null until you're confident. When set, this job becomes the featured "Apply Now" action. Set this when signal > 75 and you've identified THE position. Use the [index] number from the listings.
- showJobs: array of [index] numbers for jobs worth showing as cards. Show 2-3 on first message, 1-2 as you narrow, just the topPick when converged.
- suggestions: make them conversational and specific. "I have 5 years experience", "What's the GS-11 pay?", "Only remote", "That VA one looks good". Never generic.
- refineSearch: true only if a completely different keyword would find better matches. Triggers a new API call.
- extraction.interest: refine based on conversation. "healthcare" → "registered nurse". "office" → "program analyst". "warehouse" → "materials handler".`;

// ─── FALLBACK ──────────────────────────────────────────────────

function buildFallback(name: string, interest: string, location: string): any {
  const n = name || 'friend';
  const i = (interest || 'jobs').toLowerCase();
  const l = location || 'anywhere';
  return {
    message: `${n}, I just hit the federal hiring database. Scanning ${i} positions${l !== 'anywhere' ? ' near ' + l : ''}. The government has its own language for job titles — let me translate and find what's actually worth your time.`,
    extraction: { interest: i, location: l },
    signal: 20, topPick: null, topPickJob: null,
    showJobs: [],
    suggestions: ['What did you find?', 'I have experience', 'Remote only', 'Best paying?'],
    jobs: [], totalResults: 0,
    searchUrl: buildSearchUrl(i, l),
    safetyFallbackUsed: true, _raw: '',
  };
}

// ─── MAIN ──────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);

    if (url.pathname === '/geo') {
      const cf = (request as any).cf || {};
      return json({
        city: cf.city || '', region: cf.region || '', country: cf.country || 'US',
        locationString: cf.city && cf.region ? `${cf.city}, ${cf.region}` : cf.city || cf.region || '',
        detected: !!cf.city,
      }, request);
    }

    if (url.pathname === '/health') {
      return json({
        status: 'ok', version: 6,
        hasAnthropicKey: !!env.ANTHROPIC_API_KEY,
        hasUsajobsKey: !!env.USAJOBS_API_KEY,
        hasUsajobsEmail: !!env.USAJOBS_EMAIL,
        allKeysConfigured: !!(env.ANTHROPIC_API_KEY && env.USAJOBS_API_KEY && env.USAJOBS_EMAIL),
      }, request);
    }

    if (url.pathname !== '/chat' || request.method !== 'POST') {
      return json({ error: 'Not found' }, request, 404);
    }

    if (!env.ANTHROPIC_API_KEY) {
      const fb = buildFallback('friend', 'jobs', 'anywhere');
      fb.message = 'Worker running but ANTHROPIC_API_KEY not set. Add it in Cloudflare Dashboard → Workers → Settings → Variables.';
      return json(fb, request);
    }

    try {
      const body: any = await request.json();
      const { name, interest_hint, location_hint, history, cachedJobs, forceSearch } = body;

      let jobResult: { items: JobItem[]; total: number; missingKeys?: boolean };
      if (cachedJobs && cachedJobs.length > 0 && !forceSearch) {
        jobResult = { items: cachedJobs, total: cachedJobs.length };
      } else {
        jobResult = await searchUSAJobs(interest_hint, location_hint, env);
      }

      let jobCtx = jobsForClaude(jobResult);
      if (jobResult.missingKeys) {
        jobCtx += '\n[SYSTEM: USAJobs API keys not configured. Tell user live data requires setup.]\n';
      }
      const sUrl = buildSearchUrl(interest_hint, location_hint);
      const model = env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';

      const ctx = `My name is ${name || 'friend'}. I'm interested in ${interest_hint || 'work'} in ${location_hint || 'anywhere'}.\n${jobCtx}`;
      const messages: Array<{ role: string; content: string }> = [{ role: 'user', content: ctx }];
      if (history && history.length > 0) {
        for (const h of history.slice(-16)) messages.push({ role: h.role, content: h.content });
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
        body: JSON.stringify({ model, max_tokens: 500, system: SYSTEM, messages }),
      });

      if (!claudeRes.ok) {
        const errText = await claudeRes.text().catch(() => '');
        throw new Error('Claude API ' + claudeRes.status + ': ' + errText.slice(0, 200));
      }

      const claudeData: any = await claudeRes.json();
      const rawText = claudeData.content?.[0]?.text || '';

      let parsed: any;
      try {
        const obj = JSON.parse(rawText);
        const sig = Math.min(99, Math.max(1, Number(obj.signal) || 30));
        const tp = (obj.topPick !== null && obj.topPick !== undefined &&
                    obj.topPick >= 0 && obj.topPick < jobResult.items.length)
          ? Number(obj.topPick) : null;
        const show = Array.isArray(obj.showJobs)
          ? obj.showJobs.filter((i: number) => typeof i === 'number' && i >= 0 && i < jobResult.items.length).slice(0, 5)
          : [];

        parsed = {
          message: String(obj.message || '').slice(0, 800),
          extraction: {
            interest: String(obj.extraction?.interest || interest_hint || 'jobs').toLowerCase().slice(0, 100),
            location: String(obj.extraction?.location || location_hint || 'anywhere').slice(0, 100),
          },
          signal: sig,
          topPick: tp,
          topPickJob: tp !== null ? jobResult.items[tp] : null,
          showJobs: show.map((i: number) => jobResult.items[i]).filter(Boolean),
          suggestions: Array.isArray(obj.suggestions)
            ? obj.suggestions.map((s: any) => String(s).slice(0, 50)).slice(0, 4)
            : ['Tell me more', 'What else?'],
          refineSearch: !!obj.refineSearch,
          jobs: jobResult.items.slice(0, 20),
          totalResults: jobResult.total,
          searchUrl: sUrl,
          safetyFallbackUsed: false,
          _raw: rawText,
        };
      } catch {
        const fb = buildFallback(name, interest_hint, location_hint);
        fb.jobs = jobResult.items.slice(0, 20);
        fb.totalResults = jobResult.total;
        fb.showJobs = jobResult.items.slice(0, 3);
        fb.searchUrl = sUrl;
        fb._raw = rawText;
        parsed = fb;
      }

      return json(parsed, request);
    } catch (e: any) {
      const fb = buildFallback('friend', 'jobs', 'anywhere');
      fb.message = 'Something went wrong: ' + (e.message || 'unknown error') + '. Try again in a moment.';
      fb._raw = JSON.stringify(fb);
      return json(fb, request, 500);
    }
  },
};
