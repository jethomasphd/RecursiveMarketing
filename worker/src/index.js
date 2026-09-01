// ═══════════════════════════════════════════════════════════════
// THE GATE WORKER v8 — Federal job matchmaker.
// USAJobs.gov API + Claude → converge on a specific job.
// JavaScript version — identical logic to index.ts.
// ═══════════════════════════════════════════════════════════════

const DEFAULT_MODEL = 'claude-opus-5';
const DEFAULT_EFFORT = 'low';

// ─── CORS (always allow — public API) ────────────────────────

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, request, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  });
}

// ─── USAJOBS API ───────────────────────────────────────────────

// Documented casing. The lowercase /api/search alias also resolves today, but
// only the capitalised path is in the reference.
const USAJOBS_ENDPOINT = 'https://data.usajobs.gov/api/Search';

// Chip values arrive capitalised ("Anything", "Remote", "Anywhere"), so every
// sentinel test is case-insensitive. Comparing against lowercase literals sent
// "Anything" through as a real keyword and searched for the word itself.
const ANY_KEYWORD = new Set(['', 'anything', 'any', 'all']);
const ANY_LOCATION = new Set(['', 'anywhere', 'any', 'near me', 'nearby']);

// USAJobs work-schedule codes, for when the API returns a code but no Name.
const SCHEDULE_CODES = {
  '1': 'Full-time', '2': 'Part-time', '3': 'Shift Work',
  '4': 'Intermittent', '5': 'Job Sharing', '6': 'Multiple Schedules',
};

// Pay-interval codes, for when PositionRemuneration drops Description.
const RATE_INTERVALS = {
  PA: 'Per Year', PH: 'Per Hour', PD: 'Per Day', PW: 'Per Week',
  BW: 'Per Biweekly', PM: 'Per Month', WC: 'Without Compensation',
};

function norm(v) {
  return (v || '').trim().toLowerCase();
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return '';
}

// PositionURI and ApplyURI come back as https://www.usajobs.gov:443/... — the
// explicit port resolves, but it leaks into every job link the portal renders.
function cleanUrl(u) {
  return firstNonEmpty(u).replace('://www.usajobs.gov:443/', '://www.usajobs.gov/');
}

// ApplyURI has been published as a bare string, an array of strings, and an
// array of objects. Take the first usable URL out of whichever shape arrives.
function pickUrl(v) {
  if (!v) return '';
  if (typeof v === 'string') return cleanUrl(v);
  if (Array.isArray(v)) {
    for (const entry of v) {
      const u = typeof entry === 'string'
        ? entry
        : firstNonEmpty(entry?.Uri, entry?.URI, entry?.Url, entry?.URL, entry?.Value);
      if (u) return cleanUrl(u);
    }
  }
  return '';
}

// Work schedule stopped arriving at PositionSchedule[0].Name. Read every shape
// it has been published under before giving up on it.
function pickSchedule(d) {
  const entry = d?.PositionSchedule?.[0] || {};
  const named = firstNonEmpty(entry.Name, entry.Value, entry.Description);
  if (named) return named;
  const code = firstNonEmpty(entry.Code, entry.ID);
  if (code && SCHEDULE_CODES[code]) return SCHEDULE_CODES[code];
  return firstNonEmpty(
    d?.PositionScheduleDisplay,
    d?.UserArea?.Details?.PositionSchedule?.[0]?.Name,
    d?.UserArea?.Details?.WorkSchedule,
    code,
  );
}

function mapJob(r) {
  const d = r?.MatchedObjectDescriptor || {};
  const pay = d.PositionRemuneration?.[0] || {};
  const loc = d.PositionLocation?.[0] || {};
  const positionUrl = cleanUrl(d.PositionURI);
  return {
    title: d.PositionTitle || 'Untitled Position',
    org: d.OrganizationName || '',
    dept: d.DepartmentName || '',
    location: firstNonEmpty(d.PositionLocationDisplay, loc.LocationName, loc.CityName),
    salaryMin: firstNonEmpty(pay.MinimumRange),
    salaryMax: firstNonEmpty(pay.MaximumRange),
    salaryPeriod: firstNonEmpty(
      pay.Description,
      RATE_INTERVALS[String(pay.RateIntervalCode || '').toUpperCase()],
      'Per Year',
    ),
    grade: firstNonEmpty(d.JobGrade?.[0]?.Code),
    schedule: pickSchedule(d),
    url: positionUrl,
    applyUrl: pickUrl(d.ApplyURI) || positionUrl,
    closing: d.ApplicationCloseDate ? fmtDate(d.ApplicationCloseDate) : '',
    qualifications: d.QualificationSummary ? d.QualificationSummary.slice(0, 300) : '',
  };
}

// `legacy` drops the two newer parameters so a rejected request can be retried
// with the parameter set that was known to work.
function buildParams(keyword, location, legacy) {
  const params = new URLSearchParams();
  if (keyword && !ANY_KEYWORD.has(norm(keyword))) params.set('Keyword', keyword);
  if (norm(location) === 'remote') {
    params.set('RemoteIndicator', 'True');
  } else if (location && !ANY_LOCATION.has(norm(location))) {
    params.set('LocationName', location);
    params.set('Radius', '50');
  }
  params.set('ResultsPerPage', '20');
  params.set('SortField', 'opendate');
  params.set('SortDirection', 'desc');
  // WhoMayApply is the legacy public filter and no longer restricts anything —
  // merit-promotion-only announcements come back through it. USAJobs named
  // HiringPath as its replacement, so that is what actually filters now.
  // WhoMayApply stays for as long as it is still accepted.
  params.set('WhoMayApply', 'Public');
  if (!legacy) {
    params.set('HiringPath', 'public');
    // Without an explicit Fields the response arrives without PositionSchedule
    // or ApplyURI.
    params.set('Fields', 'Full');
  }
  return params;
}

async function runSearch(keyword, location, env, legacy) {
  const res = await fetch(USAJOBS_ENDPOINT + '?' + buildParams(keyword, location, legacy).toString(), {
    headers: {
      'Authorization-Key': env.USAJOBS_API_KEY,
      'User-Agent': env.USAJOBS_EMAIL,
    },
  });

  // Surface the real failure instead of returning an empty result set that
  // looks identical to a legitimately empty search.
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const hint = res.status === 401
      ? ' (USAJobs rejected the credentials — check that USAJOBS_API_KEY is the key they emailed you and USAJOBS_EMAIL is the address you registered with.)'
      : '';
    return {
      items: [], total: 0, status: res.status,
      error: `USAJobs API ${res.status} ${res.statusText}: ${body.slice(0, 300)}${hint}`,
    };
  }

  const data = await res.json();
  const results = data?.SearchResult?.SearchResultItems || [];
  const total = Number(
    data?.SearchResult?.SearchResultCountAll ??
    data?.SearchResult?.SearchResultCount ??
    results.length,
  ) || 0;

  return {
    items: results.map(mapJob),
    total,
    status: res.status,
    usedLegacyParams: legacy,
    descriptorKeys: Object.keys(results[0]?.MatchedObjectDescriptor || {}),
  };
}

async function searchUSAJobs(keyword, location, env) {
  if (!env.USAJOBS_API_KEY || !env.USAJOBS_EMAIL) {
    return { items: [], total: 0, missingKeys: true, error: 'USAJOBS_API_KEY and/or USAJOBS_EMAIL are not set on the Worker.' };
  }

  try {
    const result = await runSearch(keyword, location, env, false);
    // A 4xx that is not an auth failure means USAJobs rejected one of the
    // parameters. Retry once on the legacy set rather than handing back an
    // error for a search that would still work without them.
    const rejected = !!result.error && !!result.status &&
      result.status >= 400 && result.status < 500 &&
      result.status !== 401 && result.status !== 403 && result.status !== 429;
    // HiringPath narrows the search, and an empty board is the exact symptom
    // this change set out to fix. If it ever filters a search down to nothing,
    // retry without it so the newer parameters can only ever add precision —
    // never take results away.
    const emptied = !result.error && result.items.length === 0;
    if (rejected || emptied) {
      const fallback = await runSearch(keyword, location, env, true);
      if (!fallback.error && (rejected || fallback.items.length > 0)) return fallback;
    }
    return result;
  } catch (e) {
    return { items: [], total: 0, error: 'USAJobs request failed: ' + (e?.message || String(e)) };
  }
}

function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return ''; }
}

function fmtSalary(min, max, period) {
  if (!min && !max) return '';
  const f = (n) => { const v = parseInt(n); return isNaN(v) ? n : '$' + v.toLocaleString('en-US'); };
  const range = min && max ? f(min) + ' – ' + f(max) : f(min || max);
  const per = period === 'Per Year' ? '/yr' : period === 'Per Hour' ? '/hr' : '/' + (period || 'yr');
  return range + per;
}

function jobsForClaude(result) {
  if (result.error) return `\n[USAJOBS UNAVAILABLE: ${result.error}]\n`;
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

function buildSearchUrl(keyword, location) {
  const p = new URLSearchParams();
  if (keyword && keyword !== 'anything') p.set('k', keyword);
  if (location && location !== 'Anywhere' && location !== 'near me') p.set('l', location);
  return 'https://www.usajobs.gov/Search/Results?' + p.toString();
}

// ─── CLAUDE RESPONSE PARSING ─────────────────────────────────

// Claude returns a list of content blocks. With thinking enabled the first
// block is a thinking block, so pick the text blocks explicitly rather than
// assuming content[0].
function textFromClaude(data) {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  return blocks
    .filter((b) => b && b.type === 'text')
    .map((b) => b.text || '')
    .join('')
    .trim();
}

// The model is asked for bare JSON, but tolerate a fenced or prose-wrapped
// object rather than dropping to the fallback over a stray backtick.
function extractJson(text) {
  let t = (text || '').trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
  }
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first !== -1 && last > first) t = t.slice(first, last + 1);
  return t;
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

If the listings are marked UNAVAILABLE, say plainly that the live federal job feed is down right now and point them at usajobs.gov — do not invent positions.

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
    signal: 20, topPick: null, topPickJob: null,
    showJobs: [],
    jobs: [], totalResults: 0, usajobsError: null,
    suggestions: ['What did you find?', 'I have experience', 'Remote only', 'Best paying?'],
    searchUrl: buildSearchUrl(i, l),
    safetyFallbackUsed: true, _raw: '',
  };
}

// ─── MAIN ──────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);

    if (url.pathname === '/geo') {
      const cf = request.cf || {};
      return json({
        city: cf.city || '', region: cf.region || '', country: cf.country || 'US',
        locationString: cf.city && cf.region ? `${cf.city}, ${cf.region}` : cf.city || cf.region || '',
        detected: !!cf.city,
      }, request);
    }

    // /health reports key presence AND actually exercises the USAJobs
    // connection, so a broken feed can be diagnosed without the chat flow.
    // Pass ?deep=0 to skip the live probe.
    if (url.pathname === '/health') {
      let usajobs = { checked: false };
      if (url.searchParams.get('deep') !== '0') {
        const probe = await searchUSAJobs('nurse', '', env);
        usajobs = {
          checked: true,
          ok: !probe.error,
          status: probe.status ?? null,
          totalResults: probe.total,
          returned: probe.items.length,
          usedLegacyParams: !!probe.usedLegacyParams,
          error: probe.error || null,
        };
        // ?raw=1 reports the field names USAJobs actually returned plus one
        // mapped listing. The last two outages were schema drift diagnosed by
        // guesswork; this makes the next one a single curl.
        if (url.searchParams.get('raw') === '1') {
          usajobs.descriptorKeys = probe.descriptorKeys || [];
          usajobs.sample = probe.items[0] || null;
        }
      }
      return json({
        status: 'ok', version: 8,
        model: env.CLAUDE_MODEL || DEFAULT_MODEL,
        hasAnthropicKey: !!env.ANTHROPIC_API_KEY,
        hasUsajobsKey: !!env.USAJOBS_API_KEY,
        hasUsajobsEmail: !!env.USAJOBS_EMAIL,
        allKeysConfigured: !!(env.ANTHROPIC_API_KEY && env.USAJOBS_API_KEY && env.USAJOBS_EMAIL),
        usajobs,
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

    // Declared outside the try so a Claude failure still returns the jobs we
    // already fetched from USAJobs.
    let jobResult = { items: [], total: 0 };
    let body = {};

    try {
      body = await request.json();
      const { name, interest_hint, location_hint, history, cachedJobs, forceSearch } = body;

      if (cachedJobs && cachedJobs.length > 0 && !forceSearch) {
        jobResult = { items: cachedJobs, total: cachedJobs.length };
      } else {
        jobResult = await searchUSAJobs(interest_hint, location_hint, env);
      }

      const jobCtx = jobsForClaude(jobResult);
      const sUrl = buildSearchUrl(interest_hint, location_hint);
      const model = env.CLAUDE_MODEL || DEFAULT_MODEL;
      const effort = env.CLAUDE_EFFORT || DEFAULT_EFFORT;

      const ctx = `My name is ${name || 'friend'}. I'm interested in ${interest_hint || 'work'} in ${location_hint || 'anywhere'}.\n${jobCtx}`;
      const messages = [{ role: 'user', content: ctx }];
      if (history && history.length > 0) {
        for (const h of history.slice(-16)) messages.push({ role: h.role, content: h.content });
      }
      if (messages[messages.length - 1].role === 'assistant') {
        messages.push({ role: 'user', content: 'Continue.' });
      }

      const payload = {
        model,
        max_tokens: 3000,
        system: SYSTEM,
        messages,
      };
      if (effort && effort !== 'off') payload.output_config = { effort };

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
      });

      if (!claudeRes.ok) {
        const errText = await claudeRes.text().catch(() => '');
        throw new Error('Claude API ' + claudeRes.status + ': ' + errText.slice(0, 200));
      }

      const claudeData = await claudeRes.json();
      const rawText = textFromClaude(claudeData);

      let parsed;
      try {
        if (claudeData.stop_reason === 'refusal') throw new Error('refusal');
        const obj = JSON.parse(extractJson(rawText));
        const sig = Math.min(99, Math.max(1, Number(obj.signal) || 30));
        const tp = (obj.topPick !== null && obj.topPick !== undefined &&
                    obj.topPick >= 0 && obj.topPick < jobResult.items.length)
          ? Number(obj.topPick) : null;
        const show = Array.isArray(obj.showJobs)
          ? obj.showJobs.filter((i) => typeof i === 'number' && i >= 0 && i < jobResult.items.length).slice(0, 5)
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
          showJobs: show.map((i) => jobResult.items[i]).filter(Boolean),
          suggestions: Array.isArray(obj.suggestions)
            ? obj.suggestions.map((s) => String(s).slice(0, 50)).slice(0, 4)
            : ['Tell me more', 'What else?'],
          refineSearch: !!obj.refineSearch,
          jobs: jobResult.items.slice(0, 20),
          totalResults: jobResult.total,
          usajobsError: jobResult.error || null,
          searchUrl: sUrl,
          safetyFallbackUsed: false,
          _raw: rawText,
        };
      } catch {
        const fb = buildFallback(name, interest_hint, location_hint);
        fb.jobs = jobResult.items.slice(0, 20);
        fb.totalResults = jobResult.total;
        fb.usajobsError = jobResult.error || null;
        fb.showJobs = jobResult.items.slice(0, 3);
        fb.searchUrl = sUrl;
        fb._raw = rawText;
        parsed = fb;
      }

      return json(parsed, request);
    } catch (e) {
      // Keep whatever USAJobs returned — a Claude outage should not also blank
      // out live job listings we already have in hand.
      const fb = buildFallback(body?.name, body?.interest_hint, body?.location_hint);
      fb.message = 'Something went wrong: ' + (e.message || 'unknown error') + '. Try again in a moment.';
      fb.jobs = jobResult.items.slice(0, 20);
      fb.totalResults = jobResult.total;
      fb.showJobs = jobResult.items.slice(0, 3);
      fb.usajobsError = jobResult.error || null;
      fb._raw = '';
      return json(fb, request, 500);
    }
  },
};
