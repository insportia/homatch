// Opening a finished report: the READY fast path (reportReadPath.ts) and the
// per-tab opened-report cache (reportCache.ts). Proven: a stored report is
// served without result_json ONLY when it was enriched by the current code;
// the cache key moves with synthesis_at, the logic version and the read
// derivation revision; a payload due an upgrade never comes from the cache;
// signed URLs are never served dead; broken storage is just "not cached".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPORT_LOGIC_VERSION } from '../intelligence/reportVersion.ts';
import {
  READ_ENRICHMENT_REVISION, READY_FAST_COLUMNS, canServeStoredFast, readEnrichmentMarkers, reportCacheKey,
} from '../intelligence/reportReadPath.ts';
import {
  readCachedReport, writeCachedReport, forgetCachedReport, cacheableReport,
  REPORT_CACHE_FRESH_MS, REPORT_CACHE_MAX_AGE_MS, REPORT_CACHE_MAX_ENTRIES, REPORT_CACHE_PREFIX,
} from '../reportCache.ts';

const ROOT = process.cwd();
const code = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

class MemStore {
  constructor(limit = Infinity) { this.m = new Map(); this.limit = limit; }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) {
    const size = [...this.m.entries()].filter(([x]) => x !== k).reduce((n, [, x]) => n + x.length, 0) + v.length;
    if (size > this.limit) throw new Error('QuotaExceededError');
    this.m.set(k, v);
  }
  removeItem(k) { this.m.delete(k); }
}

const JOB = '8ba97da9-2f0d-487f-96f2-043a2abe8202';
const AT = '2026-10-11T09:45:08.243+00:00';
const report = (extra = {}) => ({ report: { summary: { statement: 'x' } }, _logicVersion: REPORT_LOGIC_VERSION, jobId: JOB, ...extra });

/* ── the server fast path ─────────────────────────────────────────────── */

test('a stored report is served without result_json only when the current code enriched it', () => {
  const enriched = { synthesis_state: 'READY', synthesis_json: { report: {}, _logicVersion: REPORT_LOGIC_VERSION, ...readEnrichmentMarkers() } };
  assert.equal(canServeStoredFast(enriched), true);
  assert.equal(canServeStoredFast(enriched, { force: true }), false, 'a forced rebuild took the read path');
  assert.equal(canServeStoredFast({ ...enriched, synthesis_state: 'PENDING' }), false);
  const sj = enriched.synthesis_json;
  assert.equal(canServeStoredFast({ ...enriched, synthesis_json: { ...sj, _readEnrichment: undefined } }), false, 'a report persisted before the marker skipped its read derivations');
  assert.equal(canServeStoredFast({ ...enriched, synthesis_json: { ...sj, _readEnrichment: READ_ENRICHMENT_REVISION - 1 } }), false, 'an older read derivation was trusted');
  assert.equal(canServeStoredFast({ ...enriched, synthesis_json: { ...sj, _logicVersion: REPORT_LOGIC_VERSION - 1 } }), false, 'an old report skipped its upgrade');
  assert.equal(canServeStoredFast({ ...enriched, synthesis_json: { ...sj, _readEnrichedLogic: REPORT_LOGIC_VERSION - 1 } }), false);
  assert.equal(canServeStoredFast({ ...enriched, synthesis_json: { ...sj, empty: true } }), false, 'an empty report is stored un-enriched');
  assert.equal(canServeStoredFast(null), false);
  assert.ok(!/result_json/.test(READY_FAST_COLUMNS), 'the READY read still pulls result_json');
});

test('verify-synthesis: fast path first, markers stamped after enrichment, result_json loaded only on demand', () => {
  const fn = code('supabase/functions/verify-synthesis/index.ts');
  assert.match(fn, /\.select\(READY_FAST_COLUMNS\)/);
  assert.ok(!/\.select\('id,user_id,query,result_json/.test(fn), 'the whole row is read on open again');
  const fast = fn.indexOf('canServeStoredFast(job');
  assert.ok(fast > 0 && fast < fn.indexOf('const upgrade = '), 'the fast path is not taken before the upgrade/read logic');
  // Markers are stamped AFTER withPropertyRegister, BEFORE persist.
  const enrich = fn.indexOf('const payload = withPropertyRegister(built');
  const mark = fn.indexOf('readEnrichmentMarkers())');
  const persistAt = fn.indexOf('await persist(writer, jobId, payload)');
  assert.ok(enrich > 0 && enrich < mark && mark < persistAt, 'the enrichment marker is not stamped between enrichment and persist');
  // Every path that reads result_json loads it first (the fifth is the
  // background first build, reportBackgroundBuild.test.mjs).
  assert.equal((fn.match(/await ensureResult\(\);/g) ?? []).length, 5, 'a result_json consumer runs before ensureResult');
  assert.match(fn, /scope: 'verify_synthesis_read'/, 'the read timing log is gone (the lead measures production with it)');
});

/* ── the client cache ─────────────────────────────────────────────────── */

test('the key moves with synthesis_at, the logic version and the read revision', () => {
  const k = reportCacheKey({ jobId: JOB, synthesisAt: AT });
  assert.equal(k, `v${REPORT_LOGIC_VERSION}.r${READ_ENRICHMENT_REVISION}|${JOB}|${AT}`);
  assert.notEqual(k, reportCacheKey({ jobId: JOB, synthesisAt: '2026-10-11T10:00:00Z' }));
  assert.equal(reportCacheKey({ jobId: JOB, synthesisAt: null }), null, 'a report with no synthesis_at was cacheable');
  assert.equal(reportCacheKey({ jobId: '', synthesisAt: AT }), null);
});

test('a cached report is served for the same build, and never across a rebuild', () => {
  const s = new MemStore();
  const t0 = 1_000_000;
  assert.equal(writeCachedReport(s, { jobId: JOB, synthesisAt: AT }, report(), t0), true);
  const hit = readCachedReport(s, { jobId: JOB, synthesisAt: AT }, t0 + 1000);
  assert.equal(hit.stale, false);
  assert.equal(hit.payload.jobId, JOB);
  // Rebuilt (synthesis_at moved): a miss, and the dead entry is dropped.
  assert.equal(readCachedReport(s, { jobId: JOB, synthesisAt: '2026-10-12T00:00:00Z' }, t0 + 1000), null);
  assert.equal(s.length, 0);
});

test('a payload of another logic version is neither stored nor served (the server must upgrade it)', () => {
  const s = new MemStore();
  assert.equal(cacheableReport(report({ _logicVersion: REPORT_LOGIC_VERSION - 1 })), false);
  assert.equal(writeCachedReport(s, { jobId: JOB, synthesisAt: AT }, report({ _logicVersion: REPORT_LOGIC_VERSION - 1 })), false);
  assert.equal(writeCachedReport(s, { jobId: JOB, synthesisAt: AT }, { pending: true, _logicVersion: REPORT_LOGIC_VERSION }), false);
  assert.equal(writeCachedReport(s, { jobId: JOB, synthesisAt: AT }, { error: 'x', _logicVersion: REPORT_LOGIC_VERSION }), false);
  // An entry planted under the current key but carrying an old payload version.
  s.setItem(`${REPORT_CACHE_PREFIX}${JOB}`, JSON.stringify({ key: reportCacheKey({ jobId: JOB, synthesisAt: AT }), savedAt: 1, payload: report({ _logicVersion: 1 }) }));
  assert.equal(readCachedReport(s, { jobId: JOB, synthesisAt: AT }, 2), null);
  // A key written by an older bundle (other version/revision prefix).
  s.setItem(`${REPORT_CACHE_PREFIX}${JOB}`, JSON.stringify({ key: `v1.r0|${JOB}|${AT}`, savedAt: 1, payload: report() }));
  assert.equal(readCachedReport(s, { jobId: JOB, synthesisAt: AT }, 2), null);
});

test('signed image URLs are never served dead: stale after FRESH_MS, gone after MAX_AGE_MS', () => {
  const s = new MemStore();
  writeCachedReport(s, { jobId: JOB, synthesisAt: AT }, report(), 0);
  assert.equal(readCachedReport(s, { jobId: JOB, synthesisAt: AT }, REPORT_CACHE_FRESH_MS + 1).stale, true);
  assert.equal(readCachedReport(s, { jobId: JOB, synthesisAt: AT }, REPORT_CACHE_MAX_AGE_MS + 1), null);
  assert.ok(REPORT_CACHE_MAX_AGE_MS < 3600 * 1000, 'the cache outlives the one-hour signed URLs');
});

test('bounded, evicts oldest, survives quota, corruption and missing storage', () => {
  const s = new MemStore();
  for (let i = 0; i < REPORT_CACHE_MAX_ENTRIES + 2; i++) writeCachedReport(s, { jobId: `job-${i}`, synthesisAt: AT }, report(), 100 + i);
  assert.equal(s.length, REPORT_CACHE_MAX_ENTRIES);
  assert.equal(s.getItem(`${REPORT_CACHE_PREFIX}job-0`), null, 'the oldest was kept');
  // Quota: everything else is dropped to make room.
  const tight = new MemStore(JSON.stringify({ key: 'x'.repeat(120), savedAt: 0, payload: report() }).length + 40);
  writeCachedReport(tight, { jobId: 'a', synthesisAt: AT }, report(), 1);
  assert.equal(writeCachedReport(tight, { jobId: 'b', synthesisAt: AT }, report(), 2), true);
  assert.equal(tight.getItem(`${REPORT_CACHE_PREFIX}a`), null);
  // Corrupt JSON and absent storage are "not cached", never a throw.
  s.setItem(`${REPORT_CACHE_PREFIX}${JOB}`, '{not json');
  assert.equal(readCachedReport(s, { jobId: JOB, synthesisAt: AT }), null);
  assert.equal(readCachedReport(null, { jobId: JOB, synthesisAt: AT }), null);
  assert.equal(writeCachedReport(null, { jobId: JOB, synthesisAt: AT }, report()), false);
  const broken = { get length() { throw new Error('blocked'); }, key() { throw new Error('blocked'); }, getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(readCachedReport(broken, { jobId: JOB, synthesisAt: AT }), null);
  assert.equal(writeCachedReport(broken, { jobId: JOB, synthesisAt: AT }, report()), false);
  forgetCachedReport(broken, JOB);
});

test('opening from History: prefetch in parallel, cache only for READY reports, no polling once READY', () => {
  const pre = code('src/services/verifyReportPrefetch.ts');
  assert.match(pre, /data\.synthesis_state !== 'READY'/, 'the prefetch asks for a report that is not READY');
  assert.ok(!/force/.test(pre), 'the prefetch can force a rebuild');
  assert.ok(!/research-agent/.test(pre), 'the prefetch talks to research');
  const page = code('src/pages/VerifyPage.tsx');
  assert.match(page, /prefetchVerifyReport\(id\);check\(id\)/, 'openJob no longer starts the report read in parallel');
  assert.match(page, /const pre=await takeVerifyReport\(id\);if\(pre\)/);
  const svc = code('src/services/verifyResult.ts');
  assert.match(svc, /readCachedReport\(sessionStore\(\), cacheId\)/);
  assert.match(svc, /synthesis_state,synthesis_at'\)/);
  const report = code('src/components/verify/VerifyReport.tsx');
  assert.match(report, /<LazyMount>\s*<OfficialDocuments/, 'the documents chapter mounts eagerly again');
  assert.match(report, /\{open \? children : null\}/, 'the evidence drawer builds its rows while closed');
});
