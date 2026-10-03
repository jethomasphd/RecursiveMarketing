// Integration tests for the USAJobs half of the Worker.
//
// The Worker is an ES module but lives in a package with no "type" field, so
// Node would load worker/src/index.js as CommonJS. Copy the real source to a
// .mjs alongside it and import that — the bytes under test are the shipped ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js');
const shim = join(mkdtempSync(join(tmpdir(), 'gate-')), 'index.mjs');
writeFileSync(shim, readFileSync(SRC));
const worker = (await import(pathToFileURL(shim).href)).default;

const ENV = {
  ANTHROPIC_API_KEY: 'test-anthropic-key',
  USAJOBS_API_KEY: 'test-usajobs-key',
  USAJOBS_EMAIL: 'tester@example.com',
  ALLOWED_ORIGINS: '',
};

const CLAUDE_REPLY = {
  stop_reason: 'end_turn',
  content: [
    { type: 'thinking', thinking: 'considering' },
    {
      type: 'text',
      text: JSON.stringify({
        message: 'Found some.',
        extraction: { interest: 'nurse', location: 'anywhere' },
        signal: 40, topPick: null, showJobs: [0],
        suggestions: ['More'], refineSearch: false,
      }),
    },
  ],
};

// One search result in the shape the API returns today: PositionSchedule
// carries a Code but no Name, ApplyURI is absent, and PositionURI has the
// explicit :443 port.
const CURRENT_SHAPE = {
  MatchedObjectDescriptor: {
    PositionTitle: 'Registered Nurse',
    OrganizationName: 'Veterans Health Administration',
    DepartmentName: 'Department of Veterans Affairs',
    PositionLocationDisplay: 'Austin, Texas',
    PositionRemuneration: [{ MinimumRange: '80000', MaximumRange: '120000', RateIntervalCode: 'PA' }],
    JobGrade: [{ Code: 'GS' }],
    PositionSchedule: [{ Code: '1' }],
    PositionURI: 'https://www.usajobs.gov:443/job/123456700',
    ApplicationCloseDate: '2026-12-01',
    QualificationSummary: 'Nursing degree required.',
  },
};

// The documented shape, with Name and ApplyURI populated.
const FULL_SHAPE = {
  MatchedObjectDescriptor: {
    ...CURRENT_SHAPE.MatchedObjectDescriptor,
    PositionSchedule: [{ Code: '2', Name: 'Part-time' }],
    PositionRemuneration: [{ MinimumRange: '80000', MaximumRange: '120000', Description: 'Per Year' }],
    ApplyURI: ['https://www.usajobs.gov:443/GetJob/ViewDetails/123456700'],
  },
};

function usajobsBody(items, countKey = 'SearchResultCountAll') {
  return { SearchResult: { SearchResultItems: items, [countKey]: 42 } };
}

// Records every outbound USAJobs URL and replays scripted responses in order.
function stubFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.startsWith('https://api.anthropic.com')) {
      return new Response(JSON.stringify(CLAUDE_REPLY), { status: 200 });
    }
    calls.push(href);
    const next = responses.shift() ?? responses.at(-1);
    return new Response(
      typeof next.body === 'string' ? next.body : JSON.stringify(next.body),
      { status: next.status ?? 200 },
    );
  };
  return calls;
}

const health = (qs = '') => new Request(`https://w.dev/health${qs}`);
const chat = (body) => new Request('https://w.dev/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

async function probe(responses, qs = '?raw=1') {
  const calls = stubFetch(responses);
  const res = await worker.fetch(health(qs), ENV);
  return { calls, body: await res.json() };
}

async function searchParamsFor(interest, location) {
  const calls = stubFetch([{ body: usajobsBody([CURRENT_SHAPE]) }]);
  await worker.fetch(chat({ name: 'T', interest_hint: interest, location_hint: location, history: [] }), ENV);
  return new URL(calls[0]).searchParams;
}

test('sends the parameters that restore the missing fields', async () => {
  const { calls } = await probe([{ body: usajobsBody([CURRENT_SHAPE]) }]);
  const p = new URL(calls[0]).searchParams;
  assert.equal(p.get('HiringPath'), 'public', 'HiringPath is what actually filters to public-eligible jobs');
  assert.equal(p.get('Fields'), 'Full', 'without Fields=Full the response omits PositionSchedule/ApplyURI');
  assert.equal(p.get('WhoMayApply'), 'Public');
  assert.equal(p.get('SortField'), 'opendate');
});

test('maps the shape the API returns today', async () => {
  const { body } = await probe([{ body: usajobsBody([CURRENT_SHAPE]) }]);
  assert.equal(body.usajobs.ok, true);
  assert.equal(body.usajobs.totalResults, 42);
  const job = body.usajobs.sample;
  assert.equal(job.schedule, 'Full-time', 'schedule recovered from PositionSchedule[0].Code');
  assert.equal(job.salaryPeriod, 'Per Year', 'period recovered from RateIntervalCode');
  assert.equal(job.url, 'https://www.usajobs.gov/job/123456700', ':443 stripped');
  assert.equal(job.applyUrl, 'https://www.usajobs.gov/job/123456700', 'falls back to the position URL');
});

test('still maps the documented full shape', async () => {
  const { body } = await probe([{ body: usajobsBody([FULL_SHAPE]) }]);
  const job = body.usajobs.sample;
  assert.equal(job.schedule, 'Part-time', 'Name wins over the code table');
  assert.equal(job.applyUrl, 'https://www.usajobs.gov/GetJob/ViewDetails/123456700');
});

test('reports the raw descriptor keys for diagnosing the next schema change', async () => {
  const { body } = await probe([{ body: usajobsBody([CURRENT_SHAPE]) }]);
  assert.ok(body.usajobs.descriptorKeys.includes('PositionSchedule'));
  assert.ok(body.usajobs.descriptorKeys.includes('PositionTitle'));
});

test('omits raw diagnostics unless asked', async () => {
  const { body } = await probe([{ body: usajobsBody([CURRENT_SHAPE]) }], '');
  assert.equal(body.usajobs.descriptorKeys, undefined);
  assert.equal(body.usajobs.sample, undefined);
});

test('falls back to the legacy parameter set when a parameter is rejected', async () => {
  const { calls, body } = await probe([
    { status: 400, body: 'Error code: 400. Invalid parameter. Parameter: HiringPath' },
    { body: usajobsBody([CURRENT_SHAPE]) },
  ]);
  assert.equal(calls.length, 2, 'retries once');
  const retry = new URL(calls[1]).searchParams;
  assert.equal(retry.get('HiringPath'), null, 'newer parameters dropped on the retry');
  assert.equal(retry.get('Fields'), null);
  assert.equal(retry.get('Keyword'), 'nurse', 'the search itself is unchanged');
  assert.equal(body.usajobs.ok, true, 'search still succeeds');
  assert.equal(body.usajobs.usedLegacyParams, true);
});

test('retries without the newer filters if they empty the board', async () => {
  const { calls, body } = await probe([
    { body: usajobsBody([]) },
    { body: usajobsBody([CURRENT_SHAPE]) },
  ]);
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[1]).searchParams.get('HiringPath'), null);
  assert.equal(body.usajobs.returned, 1, 'the narrowing filter never costs the user every result');
  assert.equal(body.usajobs.usedLegacyParams, true);
});

test('accepts a genuinely empty search once both parameter sets agree', async () => {
  const { calls, body } = await probe([
    { body: usajobsBody([]) },
    { body: usajobsBody([]) },
  ]);
  assert.equal(calls.length, 2);
  assert.equal(body.usajobs.ok, true, 'no matches is not an error');
  assert.equal(body.usajobs.returned, 0);
  assert.equal(body.usajobs.usedLegacyParams, false, 'reports the primary attempt');
});

test('does not retry a credential failure', async () => {
  const { calls, body } = await probe([{ status: 401, body: '{"status":401}' }]);
  assert.equal(calls.length, 1, 'a 401 is not a parameter problem');
  assert.equal(body.usajobs.ok, false);
  assert.match(body.usajobs.error, /401/);
  assert.match(body.usajobs.error, /USAJOBS_API_KEY/, 'names the likely cause');
});

test('reads the total from either count field', async () => {
  const { body } = await probe([{ body: usajobsBody([CURRENT_SHAPE], 'SearchResultCount') }]);
  assert.equal(body.usajobs.totalResults, 42);
});

test('treats the "Anything" chip as an unfiltered search', async () => {
  const p = await searchParamsFor('Anything', 'Anywhere');
  assert.equal(p.get('Keyword'), null, 'the capitalised chip value is still a sentinel');
  assert.equal(p.get('LocationName'), null);
});

test('maps the Remote chip to RemoteIndicator', async () => {
  const p = await searchParamsFor('Healthcare', 'Remote');
  assert.equal(p.get('RemoteIndicator'), 'True');
  assert.equal(p.get('LocationName'), null, 'Remote is not a place name');
});

test('sends a detected city as a located search', async () => {
  const p = await searchParamsFor('Healthcare', 'Columbus, Ohio');
  assert.equal(p.get('LocationName'), 'Columbus, Ohio');
  assert.equal(p.get('Radius'), '50');
});

test('reports missing credentials without calling out', async () => {
  const calls = stubFetch([{ body: usajobsBody([]) }]);
  const res = await worker.fetch(health('?raw=1'), { ...ENV, USAJOBS_API_KEY: '' });
  const body = await res.json();
  assert.equal(calls.length, 0);
  assert.equal(body.usajobs.ok, false);
  assert.match(body.usajobs.error, /not set on the Worker/);
});
