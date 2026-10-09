// Incident 2026-10-09 (job c80f7237…): a finished official result held a NUL,
// Postgres refused it ("\u0000 cannot be converted to text"), the unchecked
// write left the job in BROWSER_WAITING and the driver reclaimed it for an hour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  pgSafe, pgSafeString, reducedOfficialResults, officialStallDecision, currentOfficialSource,
  persistOfficialTransition, recoverStalledOfficial, OFFICIAL_BROWSER_DEADLINE_MS, OFFICIAL_STALL_MS,
} from '../officialRecovery.ts';

const code = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
/** What Postgres jsonb refuses: an escaped NUL or a lone surrogate in the JSON text. */
const pgRejects = (v) => /\\u0000|\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])|(?<!\\ud[89ab][0-9a-f]{2})\\ud[c-f][0-9a-f]{2}/i.test(JSON.stringify(v));

// The production payload shape: a NAPR (Service176) document whose extracted text ends in a NUL.
const WORKER_COMPLETE = {
  status: 'COMPLETE',
  completedAt: '2026-10-09T08:12:41.397Z',
  steps: [{ type: 'source', key: 'TAS_MAP' }, { type: 'source', key: 'tas' }, { type: 'source', key: 'mygov' }],
  results: [
    { source: 'TAS_MAP', status: 'SEARCH_CONFIRMED' },
    { source: 'tas', status: 'SEARCH_CONFIRMED' },
    { source: 'mygov', adapter: 'service176-public-api', status: 'SEARCH_CONFIRMED', documents: [{ title: 'ამონაწერი', rawText: 'b0de95fc-0c99-4e65-9ebe-a27f78138827.html1/1\n\u0000', sha256: 'x' }] },
  ],
};

test('pgSafe removes NUL and repairs lone surrogates, deeply, and changes nothing else', () => {
  assert.ok(pgRejects(WORKER_COMPLETE), 'the fixture reproduces what Postgres refused');
  const stats = { nul: 0, surrogates: 0 };
  const safe = pgSafe(WORKER_COMPLETE, stats);
  assert.equal(pgRejects(safe), false);
  assert.equal(stats.nul, 1);
  assert.equal(safe.results[2].documents[0].rawText, 'b0de95fc-0c99-4e65-9ebe-a27f78138827.html1/1\n');
  assert.deepEqual({ ...safe, results: undefined }, { ...WORKER_COMPLETE, results: undefined });
  assert.equal(WORKER_COMPLETE.results[2].documents[0].rawText.includes('\u0000'), true, 'input not mutated');
  assert.equal(pgSafeString('a\uD800b'), 'a�b');
  assert.equal(pgSafeString('ok 😀 ქართული'), 'ok 😀 ქართული', 'valid pairs and Georgian untouched');
  assert.deepEqual(pgSafe({ 'k\u0000': [1, true, null, 'x\u0000y'] }), { k: [1, true, null, 'xy'] });
});

/** A fake supabase-js client that refuses what Postgres refuses, records writes, and supports .eq/.select chains. */
function fakeDb(row, { rejectNul = true, failAll = false } = {}) {
  const writes = [];
  const from = () => {
    let patch = null; const filters = []; let op = 'select';
    const run = () => {
      if (op === 'select') return { data: { ...row }, error: null };
      if (failAll || (rejectNul && pgRejects(patch))) return { data: null, error: { message: 'unsupported Unicode escape sequence' } };
      if (filters.some(([k, v]) => String(row[k]) !== String(v))) return { data: [], error: null };
      Object.assign(row, patch); writes.push(patch);
      return { data: [{ id: row.id }], error: null };
    };
    const chain = {
      update(p) { op = 'update'; patch = p; return chain; },
      select() { return chain; },
      eq(k, v) { filters.push([k, v]); return chain; },
      maybeSingle() { return Promise.resolve(run()); },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return chain;
  };
  return { from, writes, row };
}

test('the COMPLETE transition stores a sanitized result (the incident cannot recur)', async () => {
  const db = fakeDb({ id: 'c80f7237', stage: 'BROWSER_WAITING' });
  const r = await persistOfficialTransition(db, { id: 'c80f7237' }, { stage: 'OFFICIAL_READY', status: 'CREATED', result_json: { browserOfficial: { results: WORKER_COMPLETE.results } } });
  assert.equal(r.error, null);
  assert.equal(db.row.stage, 'OFFICIAL_READY');
  assert.equal(db.row.result_json.browserOfficial.results[2].documents.length, 1, 'the NAPR evidence is kept');
});

test('a write that still fails moves the job on with source outcomes only — never a silent no-op', async () => {
  let calls = 0;
  const db = fakeDb({ id: 'j1', stage: 'BROWSER_WAITING' }, { rejectNul: false });
  const realFrom = db.from;
  db.from = (t) => { calls++; const c = realFrom(t); if (calls === 1) { c.update = () => ({ eq: () => Promise.resolve({ error: { message: 'payload too large' } }) }); } return c; };
  const r = await persistOfficialTransition(db, { id: 'j1', evidence_bundle: [{ url: 'u' }] }, { stage: 'OFFICIAL_READY', status: 'CREATED', result_json: { identity: { a: 1 }, officialVisuals: [{ id: 'v' }], browserOfficial: { results: WORKER_COMPLETE.results } } });
  assert.equal(r.error, null);
  assert.equal(db.row.stage, 'OFFICIAL_READY');
  const bo = db.row.result_json.browserOfficial;
  assert.equal(bo.unavailable, true);
  assert.equal(bo.persistError, 'payload too large');
  assert.deepEqual(bo.results.map((x) => [x.source, x.status, x.persistedPartially]), [['TAS_MAP', 'SEARCH_CONFIRMED', true], ['tas', 'SEARCH_CONFIRMED', true], ['mygov', 'SEARCH_CONFIRMED', true]]);
  assert.equal(bo.results[2].documents, undefined, 'extracted payload dropped');
  assert.deepEqual(db.row.result_json.identity, { a: 1 }, 'earlier research kept');
  assert.equal(db.row.result_json.officialVisuals, undefined);
  assert.deepEqual(db.row.evidence_bundle, [{ url: 'u' }], 'stored evidence kept');
});

test('stall decision: only past the total deadline AND silent — progress is never cut short', () => {
  const t0 = Date.parse('2026-10-09T08:05:52Z');
  const base = { stage: 'BROWSER_WAITING', status: 'RUNNING', workerStartedAt: '2026-10-09T08:05:52Z', createdAt: '2026-10-09T08:05:13Z' };
  // the incident: last write 08:12:34, still waiting at 09:04
  assert.equal(officialStallDecision({ ...base, updatedAt: '2026-10-09T08:12:34Z', now: Date.parse('2026-10-09T09:04:42Z') }), 'RECOVER');
  assert.equal(officialStallDecision({ ...base, updatedAt: '2026-10-09T08:12:34Z', now: t0 + OFFICIAL_BROWSER_DEADLINE_MS - 1 }), 'WAIT', 'inside the deadline');
  assert.equal(officialStallDecision({ ...base, updatedAt: new Date(t0 + OFFICIAL_BROWSER_DEADLINE_MS).toISOString(), now: t0 + OFFICIAL_BROWSER_DEADLINE_MS + OFFICIAL_STALL_MS - 1 }), 'WAIT', 'written recently');
  assert.equal(officialStallDecision({ ...base, stage: 'OFFICIAL_READY', updatedAt: '2026-10-09T08:12:34Z', now: Date.parse('2026-10-09T09:04:42Z') }), 'WAIT');
  assert.equal(officialStallDecision({ ...base, status: 'WAITING_HUMAN', updatedAt: '2026-10-09T08:12:34Z', now: Date.parse('2026-10-09T09:04:42Z') }), 'WAIT', 'a human wait has its own release');
  assert.ok(OFFICIAL_BROWSER_DEADLINE_MS <= 10 * 60 * 1000, 'official stage bounded at 10 minutes');
});

test('stall recovery: conditional, keeps stored evidence, never re-runs; a concurrent write wins', async () => {
  const row = { id: 'c80f7237', status: 'RUNNING', stage: 'BROWSER_WAITING', created_at: '2026-10-09T08:05:13Z', updated_at: '2026-10-09T08:12:34.339+00:00', result_json: { identity: { x: 1 }, _worker: { jobId: '975dc617', startedAt: '2026-10-09T08:05:52.455Z' } } };
  const db = fakeDb(row);
  assert.equal(await recoverStalledOfficial(db, { id: row.id, updated_at: row.updated_at }, '2026-10-09T09:05:00.000Z'), true);
  assert.equal(row.stage, 'OFFICIAL_READY');
  assert.equal(row.status, 'CREATED');
  assert.equal(row.result_json.browserOfficial.unavailable, true);
  assert.equal(row.result_json._recovery.workerJobId, '975dc617');
  assert.equal(row.result_json._worker, undefined, 'the dead worker job is not polled again');
  assert.deepEqual(row.result_json.identity, { x: 1 });
  // Second call: row already moved on -> nothing.
  assert.equal(await recoverStalledOfficial(db, { id: row.id, updated_at: '2026-10-09T08:12:34.339+00:00' }, '2026-10-09T09:06:00.000Z'), false);
  // A step that wrote meanwhile (updated_at differs from what it read) is never overridden.
  const live = { ...row, stage: 'BROWSER_WAITING', status: 'RUNNING', updated_at: '2026-10-09T09:05:01Z' };
  assert.equal(await recoverStalledOfficial(fakeDb(live), { id: live.id, updated_at: '2026-10-09T08:12:34Z' }, '2026-10-09T09:06:00Z'), false);
  assert.equal(live.stage, 'BROWSER_WAITING');
});

test('reduced results and live progress name the sources truthfully', () => {
  assert.deepEqual(reducedOfficialResults('nope'), []);
  assert.equal(currentOfficialSource({ steps: WORKER_COMPLETE.steps, results: WORKER_COMPLETE.results.slice(0, 2) }), 'mygov');
  assert.equal(currentOfficialSource({ steps: [{ type: 'entity', source: 'debtor', name: 'x', idCode: null }], sourceIndex: 0, results: [] }), 'debtor');
  assert.equal(currentOfficialSource({}), null);
});

test('research-agent: worker data is sanitized at entry, every official exit is checked, the driver stops a stall', () => {
  const src = code('supabase/functions/research-agent/index.ts');
  const wf = src.slice(src.indexOf('async function wf('), src.indexOf('async function launch('));
  assert.match(wf, /z = pgSafe\(z, stats\);/);
  const poll = src.slice(src.indexOf('async function pollBrowser('), src.indexOf('// pickFinancialCandidate()'));
  assert.equal((poll.match(/stage: 'OFFICIAL_READY'/g) || []).length, (poll.match(/return persistOfficialTransition\(sb, j, \{/g) || []).length, 'every OFFICIAL_READY transition is a checked write');
  assert.doesNotMatch(poll, /return sb\s*\.from\('research_jobs'\)\s*\.update\(\{\s*status: 'CREATED'/);
  assert.match(poll, /const MAX_BROWSER_WAIT_MS = OFFICIAL_BROWSER_DEADLINE_MS;/);
  assert.match(poll, /currentSource: currentOfficialSource\(w\)/);
  const drive = src.slice(src.indexOf('async function driveJob('), src.indexOf('async function driveJob(') + 2000);
  assert.match(drive, /await advance\(sb, key, model, j, jobLanguage\(j\)\);\n[\s\S]{0,300}if \(await recoverStalledOfficial\(sb, j\)\) return;/);
  assert.doesNotMatch(src, /browserAgeMs > 12 \* 60 \* 1000/);
});
