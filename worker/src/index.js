// ═══════════════════════════════════════════════════════════════
// THE GATE WORKER v5 — Intelligent job matchmaker.
// USAJobs.gov API + Claude conversation → specific job application.
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
    return { items: [], total: 0, missingKeys: true };
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
  params.set('ResultsPerPage', '20');
  params.set('WhoMayApply', 'Public');
  params.set('SortField', 'opendate');
  params.set('SortDirection', 'desc');

  const url = 'https://data.usajobs.gov/api/search?' + params.toString();

  try {
    const res = await fetch(url, {
      headers: {
        'Authorization-Key': env.USAJOBS_API_KEY,
        'User-Agent': env.USAJOBS_EMAIL,
        'Host': 'data.usajobs.gov',
      },
    });

    if (!res.ok) return { items: [], total: 0 };

    const data = await res.json();
    const results = data?.SearchResult?.SearchResultItems || [];
    const total = data?.SearchResult?.SearchResultCountAll || 0;

    const items = results.map(r => {
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
        qualifications: d.QualificationSummary ? d.QualificationSummary.slice(0, 300) : '',
      };
    });

    return { items, total };
  } catch {
    return { items: [], total: 0 };
  }
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return ''; }
}

function formatSalary(min, max, period) {
  if (!min && !max) return '';
  const fmt = n => { const num = parseInt(n); return isNaN(num) ? n : '$' + num.toLocaleString('en-US'); };
  const range = min && max ? fmt(min) + ' – ' + fmt(max) : fmt(min || max);
  const per = period === 'Per Year' ? '/yr' : period === 'Per Hour' ? '/hr' : '/' + (period || 'yr');
  return range + per;
}

function formatJobsForClaude(jobResult) {
  if (!jobResult.items.length) return '\n[USAJOBS: No results found for this search.]\n';

  let text = `\n[USAJOBS LIVE DATA: ${jobResult.total} total positions. Top ${jobResult.items.length} shown with index numbers.]\n`;
  jobResult.items.forEach((j, i) => {
    const sal = formatSalary(j.salaryMin, j.salaryMax, j.salaryPeriod);
    text += `[${i}] ${j.title} | ${j.org} (${j.dept}) | ${j.location} | ${sal}`;
    if (j.grade) text += ` | ${j.grade}`;
    if (j.schedule) text += ` | ${j.schedule}`;
    if (j.closing) text += ` | Closes ${j.closing}`;
    text += '\n';
    if (j.qualifications) text += `    Quals: ${j.qualifications}\n`;
  });
  return text;
}

function buildSearchUrl(keyword, location) {
  const params = new URLSearchParams();
  if (keyword && keyword !== 'anything') params.set('k', keyword);
  if (location && location !== 'Anywhere' && location !== 'near me') params.set('l', location);
  return 'https://www.usajobs.gov/Search/Results?' + params.toString();
}

// ─── CLAUDE ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a job-matching intelligence inside a mysterious portal. You have live access to USAJobs.gov federal job listings. Your single mission: guide this person to a specific federal job they should apply for RIGHT NOW.

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

function buildFallback(name, interest, location) {
  const n = name || 'friend';
  const i = (interest || 'jobs').toLowerCase();
  const l = location || 'anywhere';
  return {
    message: `${n}, I just hit the federal hiring database. Scanning ${i} positions${l !== 'anywhere' ? ' near ' + l : ''}. The government has its own language for job titles — let me translate and find what's actually worth your time.`,
    extraction: { interest: i, location: l },
    signal: 20,
    topPick: null,
    topPickJob: null,
    showJobs: [],
    suggestions: ['What did you find?', 'I have experience', 'Remote only', 'Best paying?'],
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

    if (url.pathname === '/health' && request.method === 'GET') {
      return jsonResponse({
        status: 'ok',
        hasAnthropicKey: !!env.ANTHROPIC_API_KEY,
        hasUsajobsKey: !!env.USAJOBS_API_KEY,
        hasUsajobsEmail: !!env.USAJOBS_EMAIL,
        allKeysConfigured: !!(env.ANTHROPIC_API_KEY && env.USAJOBS_API_KEY && env.USAJOBS_EMAIL),
      }, request, env);
    }

    if (url.pathname !== '/chat' || request.method !== 'POST') {
      return jsonResponse({ error: 'Not found' }, request, env, 404);
    }

    if (!env.ANTHROPIC_API_KEY) {
      const fb = buildFallback('friend', 'jobs', 'anywhere');
      fb.message = 'Worker is running but ANTHROPIC_API_KEY is not configured. Set it in Cloudflare Dashboard → Workers → Settings → Variables.';
      fb._raw = JSON.stringify(fb);
      return jsonResponse(fb, request, env);
    }

    try {
      const body = await request.json();
      const { name, interest_hint, location_hint, history, cachedJobs, forceSearch } = body;

      // Step 1: Get job data
      let jobResult;
      if (cachedJobs && cachedJobs.length > 0 && !forceSearch) {
        jobResult = { items: cachedJobs, total: cachedJobs.length };
      } else {
        jobResult = await searchUSAJobs(interest_hint, location_hint, env);
      }

      let jobContext = formatJobsForClaude(jobResult);
      if (jobResult.missingKeys) {
        jobContext += '\n[SYSTEM NOTE: USAJOBS_API_KEY or USAJOBS_EMAIL not configured. Using fallback. Tell the user the portal is connecting but live job data requires API setup.]\n';
      }
      const searchUrl = buildSearchUrl(interest_hint, location_hint);
      const model = env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';

      // Step 2: Build messages
      const contextMessage = `My name is ${name || 'friend'}. I'm interested in ${interest_hint || 'work'} in ${location_hint || 'anywhere'}.\n${jobContext}`;
      const messages = [{ role: 'user', content: contextMessage }];

      if (history && history.length > 0) {
        for (const h of history.slice(-16)) {
          messages.push({ role: h.role, content: h.content });
        }
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
        body: JSON.stringify({
          model,
          max_tokens: 500,
          system: SYSTEM_PROMPT,
          messages,
        }),
      });

      if (!claudeRes.ok) throw new Error('Claude API ' + claudeRes.status);

      const claudeData = await claudeRes.json();
      const rawText = claudeData.content?.[0]?.text || '';

      // Step 4: Parse
      let parsed;
      try {
        const obj = JSON.parse(rawText);
        const sig = Math.min(99, Math.max(1, Number(obj.signal) || 30));
        const tp = (obj.topPick !== null && obj.topPick !== undefined && obj.topPick >= 0 && obj.topPick < jobResult.items.length)
          ? Number(obj.topPick) : null;
        const showJobs = Array.isArray(obj.showJobs)
          ? obj.showJobs.filter(i => typeof i === 'number' && i >= 0 && i < jobResult.items.length).slice(0, 5)
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
          showJobs: showJobs.map(i => jobResult.items[i]).filter(Boolean),
          suggestions: Array.isArray(obj.suggestions)
            ? obj.suggestions.map(s => String(s).slice(0, 50)).slice(0, 4)
            : ['Tell me more', 'What else?'],
          refineSearch: !!obj.refineSearch,
          jobs: jobResult.items.slice(0, 20),
          totalResults: jobResult.total,
          searchUrl,
          safetyFallbackUsed: false,
          _raw: rawText,
        };
      } catch {
        const fb = buildFallback(name, interest_hint, location_hint);
        fb.jobs = jobResult.items.slice(0, 20);
        fb.totalResults = jobResult.total;
        fb.showJobs = jobResult.items.slice(0, 3);
        fb.searchUrl = searchUrl;
        fb._raw = JSON.stringify(fb);
        parsed = fb;
      }

      return jsonResponse(parsed, request, env);
    } catch {
      const fb = buildFallback('friend', 'jobs', 'anywhere');
      fb._raw = JSON.stringify(fb);
      return jsonResponse(fb, request, env);
    }
  },
};
