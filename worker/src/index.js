// ═══════════════════════════════════════════════════════════════
// THE GATE WORKER v4 — Real jobs. Real data. Real magic.
// USAJobs.gov API + Claude conversation with actual federal listings.
// ═══════════════════════════════════════════════════════════════

// ─── CORS ──────────────────────────────────────────────────────

function getAllowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = getAllowedOrigins(env);
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  if (allowed.length === 0 || allowed.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin || '*';
  }
  return h;
}

function jsonResponse(data, request, env, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
  });
}

// ─── USAJOBS API ───────────────────────────────────────────────

async function searchUSAJobs(keyword, location, env) {
  if (!env.USAJOBS_API_KEY || !env.USAJOBS_EMAIL) {
    return { items: [], total: 0 };
  }

  const params = new URLSearchParams();
  if (keyword && keyword !== 'anything') params.set('Keyword', keyword);
  if (location && location !== 'Anywhere' && location !== 'near me' && location !== 'Remote') {
    params.set('LocationName', location);
    params.set('Radius', '50');
  }
  if (location === 'Remote') {
    params.set('RemoteIndicator', 'True');
  }
  params.set('ResultsPerPage', '15');
  params.set('WhoMayApply', 'Public');
  params.set('SortField', 'opendate');
  params.set('SortDirection', 'desc');
  params.set('Fields', 'Min');

  const url = 'https://data.usajobs.gov/api/search?' + params.toString();

  try {
    const res = await fetch(url, {
      headers: {
        'Authorization-Key': env.USAJOBS_API_KEY,
        'User-Agent': env.USAJOBS_EMAIL,
        'Host': 'data.usajobs.gov',
      },
    });

    if (!res.ok) {
      console.error('USAJobs API returned ' + res.status);
      return { items: [], total: 0 };
    }

    const data = await res.json();
    const results = data?.SearchResult?.SearchResultItems || [];
    const total = data?.SearchResult?.SearchResultCountAll || 0;

    const items = results.map(r => {
      const d = r.MatchedObjectDescriptor || {};
      const pay = d.PositionRemuneration?.[0] || {};
      const loc = d.PositionLocation?.[0] || {};
      const grade = d.JobGrade?.[0]?.Code || '';
      const schedule = d.PositionSchedule?.[0]?.Name || '';

      return {
        title: d.PositionTitle || 'Untitled Position',
        org: d.OrganizationName || '',
        dept: d.DepartmentName || '',
        location: d.PositionLocationDisplay || loc.CityName || '',
        salaryMin: pay.MinimumRange || '',
        salaryMax: pay.MaximumRange || '',
        salaryPeriod: pay.Description || 'Per Year',
        grade: grade,
        schedule: schedule,
        url: d.PositionURI || '',
        applyUrl: d.ApplyURI?.[0] || d.PositionURI || '',
        closing: d.ApplicationCloseDate ? formatDate(d.ApplicationCloseDate) : '',
        qualifications: d.QualificationSummary ? d.QualificationSummary.slice(0, 200) : '',
      };
    });

    return { items, total };
  } catch (e) {
    console.error('USAJobs fetch failed:', e);
    return { items: [], total: 0 };
  }
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return ''; }
}

function formatSalary(min, max, period) {
  if (!min && !max) return '';
  const fmt = n => {
    const num = parseInt(n);
    return isNaN(num) ? n : '$' + num.toLocaleString('en-US');
  };
  const range = min && max ? fmt(min) + ' – ' + fmt(max) : fmt(min || max);
  const per = period === 'Per Year' ? '/yr' : period === 'Per Hour' ? '/hr' : '/' + (period || 'yr');
  return range + per;
}

function formatJobsForClaude(jobResult) {
  if (!jobResult.items.length) return '\n[USAJOBS: No results found for this search.]\n';

  let text = `\n[USAJOBS RESULTS: ${jobResult.total} total federal positions found, showing top ${jobResult.items.length}]\n`;
  jobResult.items.forEach((j, i) => {
    const sal = formatSalary(j.salaryMin, j.salaryMax, j.salaryPeriod);
    text += `${i + 1}. ${j.title} | ${j.org} | ${j.location} | ${sal}${j.grade ? ' (' + j.grade + ')' : ''} | ${j.schedule} | Closes ${j.closing}\n`;
  });
  text += '\nReference these REAL listings in your response. Use specific titles, salaries, and agencies.\n';
  return text;
}

function buildSearchUrl(keyword, location) {
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

If they're weak matches, be honest and help them adjust. "Nothing in warehouse specifically, but I see logistics specialist openings at Fort Hood — same hands-on work, federal pay scale, and you'd never get laid off."

If there are NO results, say so and pivot. Suggest different keywords, broader location, or related fields. Federal job titles are weird — "customer service" might be "Contact Representative" or "Public Affairs Specialist" in government speak.

How to talk:
- 2-4 sentences. Tight. Reference specific jobs when you have them.
- You can ask questions to refine: "Do you have a clearance?" "How many years of experience?" "Would you relocate?"
- Sound like something they've never talked to before. A portal that pulled real federal data and is serving it raw.
- The conversation should steer toward a real application. Every exchange should move closer to "this is the one — go apply."

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
- signal: search convergence. 15-35 = no/poor matches. 40-65 = decent matches, could narrow. 70-99 = strong match found.
- suggestions: contextual quick replies. "VA hospitals only", "GS-11 and above", "What's PSLF?", "Show me remote". Make them specific to what you just found.
- refineSearch: set to true ONLY if you think a different keyword or location would produce significantly better results. This triggers a new USAJobs API search. Use sparingly.
- extraction.interest should be a good USAJobs search keyword. Refine it based on conversation ("healthcare" → "registered nurse", "warehouse" → "logistics management").`;

// ─── FALLBACK ──────────────────────────────────────────────────

function buildFallback(name, interest, location) {
  const n = name || 'friend';
  const i = (interest || 'jobs').toLowerCase();
  const l = location || 'anywhere';
  return {
    message: `${n}. Federal hiring is its own universe — different rules, different language, different game. I'm scanning USAJobs for ${i} positions${l !== 'anywhere' ? ' near ' + l : ''}. Give me a second to find the signal.`,
    extraction: { interest: i, location: l },
    signal: 20,
    suggestions: ['What did you find?', 'Try broadening it', 'Remote only', 'What pays best?'],
    jobs: [],
    totalResults: 0,
    searchUrl: buildSearchUrl(i, l),
    safetyFallbackUsed: true,
    _raw: '',
  };
}

// ─── GEO ───────────────────────────────────────────────────────

function handleGeo(request, env) {
  const cf = request.cf || {};
  return jsonResponse({
    city: cf.city || '',
    region: cf.region || '',
    country: cf.country || 'US',
    timezone: cf.timezone || '',
    locationString: cf.city && cf.region ? `${cf.city}, ${cf.region}` : cf.city || cf.region || '',
    detected: !!cf.city,
  }, request, env);
}

// ─── MAIN HANDLER ──────────────────────────────────────────────

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    const url = new URL(request.url);

    if (url.pathname === '/geo' && request.method === 'GET') {
      return handleGeo(request, env);
    }

    if (url.pathname !== '/chat' || request.method !== 'POST') {
      return jsonResponse({ error: 'Not found' }, request, env, 404);
    }

    if (!env.ANTHROPIC_API_KEY) {
      const fb = buildFallback('friend', 'jobs', 'anywhere');
      fb._raw = JSON.stringify(fb);
      return jsonResponse(fb, request, env);
    }

    try {
      const body = await request.json();
      const { name, interest_hint, location_hint, history, cachedJobs, forceSearch } = body;

      // ─── Step 1: Get job data (search or use cache) ─────────
      let jobResult;
      if (cachedJobs && cachedJobs.length > 0 && !forceSearch) {
        // Use cached jobs from frontend
        jobResult = { items: cachedJobs, total: cachedJobs.length };
      } else {
        // Search USAJobs
        jobResult = await searchUSAJobs(interest_hint, location_hint, env);
      }

      const jobContext = formatJobsForClaude(jobResult);
      const searchUrl = buildSearchUrl(interest_hint, location_hint);

      // ─── Step 2: Build Claude messages ──────────────────────
      const model = env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';

      const contextMessage = [
        `My name is ${name || 'friend'}.`,
        `I'm looking for ${interest_hint || 'work'} in ${location_hint || 'anywhere'}.`,
        jobContext,
      ].join(' ');

      const messages = [{ role: 'user', content: contextMessage }];

      if (history && history.length > 0) {
        const trimmed = history.slice(-14);
        for (const h of trimmed) {
          messages.push({ role: h.role, content: h.content });
        }
      }

      if (messages[messages.length - 1].role === 'assistant') {
        messages.push({ role: 'user', content: 'Continue.' });
      }

      // ─── Step 3: Call Claude ────────────────────────────────
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
          system: SYSTEM_PROMPT,
          messages,
        }),
      });

      if (!claudeRes.ok) throw new Error('Claude API returned ' + claudeRes.status);

      const claudeData = await claudeRes.json();
      const rawText = claudeData.content?.[0]?.text || '';

      // ─── Step 4: Parse response ─────────────────────────────
      let parsed;
      try {
        const obj = JSON.parse(rawText);
        parsed = {
          message: String(obj.message || '').slice(0, 600),
          extraction: {
            interest: String(obj.extraction?.interest || interest_hint || 'jobs').toLowerCase().slice(0, 100),
            location: String(obj.extraction?.location || location_hint || 'anywhere').slice(0, 100),
          },
          signal: Math.min(99, Math.max(1, Number(obj.signal) || 30)),
          suggestions: Array.isArray(obj.suggestions)
            ? obj.suggestions.map(s => String(s).slice(0, 40)).slice(0, 4)
            : ['Show me more', 'Refine search', 'Remote only'],
          refineSearch: !!obj.refineSearch,
          jobs: jobResult.items.slice(0, 15),
          totalResults: jobResult.total,
          searchUrl: searchUrl,
          safetyFallbackUsed: false,
          _raw: rawText,
        };
      } catch {
        const fb = buildFallback(name, interest_hint, location_hint);
        fb.jobs = jobResult.items.slice(0, 15);
        fb.totalResults = jobResult.total;
        fb.searchUrl = searchUrl;
        fb._raw = JSON.stringify(fb);
        parsed = fb;
      }

      return jsonResponse(parsed, request, env);
    } catch (e) {
      const fb = buildFallback('friend', 'jobs', 'anywhere');
      fb._raw = JSON.stringify(fb);
      return jsonResponse(fb, request, env);
    }
  },
};
