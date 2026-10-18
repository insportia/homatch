// PROVIDER ACCESS — a refusal cools a source down for a bounded time; it never
// becomes a permanent, customer-facing shutdown that needs a manual clearance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COOLDOWN_STEPS_MS, LEVEL_RESET_AFTER_MS, PROBE_LEASE_MS, decideProviderAccess, readProviderAccess,
  recordRecovery, recordRestriction, sourceFreshness,
} from '../marketplace/provider-access.ts';
import { deriveSearchStatus } from '../marketplace/lifecycle.ts';

const at = (iso) => new Date(iso);
const T0 = '2026-10-10T20:36:20.000Z';
const plus = (ms) => new Date(Date.parse(T0) + ms);

test('an untouched source is available', () => {
  const a = readProviderAccess({ status: 'HEALTHY' });
  assert.equal(a.state, 'AVAILABLE');
  assert.equal(decideProviderAccess(a, at(T0)).mode, 'LIVE');
});

test('a refusal cools down for the first step, then one probe is allowed, never two at once', () => {
  const cooled = recordRestriction(readProviderAccess({}), at(T0), 'HTTP 403; CHALLENGE_REQUIRED');
  assert.equal(cooled.state, 'COOLDOWN'); assert.equal(cooled.level, 1);
  assert.equal(cooled.cooldownUntil, plus(COOLDOWN_STEPS_MS[0]).toISOString());
  const during = decideProviderAccess(cooled, plus(60_000));
  assert.equal(during.mode, 'CACHE_ONLY'); assert.equal(during.retryAt, cooled.cooldownUntil); assert.equal(during.next, null);
  const probe = decideProviderAccess(cooled, plus(COOLDOWN_STEPS_MS[0]));
  assert.equal(probe.mode, 'PROBE'); assert.equal(probe.next.version, cooled.version + 1);
  const second = decideProviderAccess(probe.next, plus(COOLDOWN_STEPS_MS[0] + 1000));
  assert.equal(second.mode, 'CACHE_ONLY', 'the single probe lease is held');
});

test('a probe that never reports back frees its lease; the startup check never spends a probe', () => {
  const cooled = recordRestriction(readProviderAccess({}), at(T0), '403');
  const probe = decideProviderAccess(cooled, plus(COOLDOWN_STEPS_MS[0])).next;
  assert.equal(decideProviderAccess(probe, plus(COOLDOWN_STEPS_MS[0] + PROBE_LEASE_MS + 1)).mode, 'PROBE');
  assert.equal(decideProviderAccess(cooled, plus(COOLDOWN_STEPS_MS[0]), false).mode, 'CACHE_ONLY');
});

test('repeated refusals back off to a 6 hour ceiling; recovery resets everything', () => {
  let a = readProviderAccess({}), t = Date.parse(T0);
  for (let i = 0; i < 10; i++) { a = recordRestriction(a, new Date(t), '403'); t = Date.parse(a.cooldownUntil); }
  assert.equal(a.level, COOLDOWN_STEPS_MS.length);
  assert.equal(Date.parse(a.cooldownUntil) - Date.parse(a.restrictedAt), 6 * 3_600_000);
  const ok = recordRecovery(a, new Date(t));
  assert.equal(ok.state, 'AVAILABLE'); assert.equal(ok.level, 0); assert.equal(ok.cooldownUntil, null);
  assert.equal(decideProviderAccess(ok, new Date(t)).mode, 'LIVE');
});

test('a refusal after a full day of access starts again at the first step', () => {
  let a = recordRestriction(readProviderAccess({}), at(T0), '403');
  a = recordRestriction(a, plus(COOLDOWN_STEPS_MS[0]), '403');
  assert.equal(a.level, 2);
  const ok = recordRecovery(a, plus(3_600_000));
  const later = recordRestriction(ok, plus(3_600_000 + LEVEL_RESET_AFTER_MS + 1), '403');
  assert.equal(later.level, 1);
  const soon = recordRestriction(ok, plus(3_600_000 + 60_000), '403');
  assert.equal(soon.level, 1, 'recovery already reset the level');
});

test('the earlier permanent circuit is read as a first-step cooldown that expires on its own', () => {
  const legacy = readProviderAccess({ status: 'DOWN', accessRestricted: true, checkedAt: T0, accessClearedAt: '2026-10-10T20:12:35Z' });
  assert.equal(legacy.state, 'COOLDOWN'); assert.equal(legacy.cooldownUntil, plus(COOLDOWN_STEPS_MS[0]).toISOString());
  assert.equal(decideProviderAccess(legacy, plus(COOLDOWN_STEPS_MS[0] + 1)).mode, 'PROBE', 'no manual clearance needed');
});

test('customer-facing source state never calls cached results a fresh refresh', () => {
  assert.equal(sourceFreshness({ status: 'SEARCHING', freshCount: 0, cachedCount: 0 }), 'REFRESHING');
  assert.equal(sourceFreshness({ status: 'COMPLETE', freshCount: 72, cachedCount: 0 }), 'FRESH');
  assert.equal(sourceFreshness({ status: 'PARTIAL', freshCount: 48, cachedCount: 10 }), 'PARTIAL');
  assert.equal(sourceFreshness({ status: 'BLOCKED', freshCount: 0, cachedCount: 31 }), 'CACHED');
  assert.equal(sourceFreshness({ status: 'TIMED_OUT', freshCount: 0, cachedCount: 0 }), 'UNAVAILABLE');
});

test('when no source refreshed but previously collected listings match, the search is partial, not failed', () => {
  const runs = [{ workerId: 'myhome-agent', status: 'BLOCKED', deadlineAt: T0, returnedCount: 0 }, { workerId: 'ssge-agent', status: 'FAILED', deadlineAt: T0, returnedCount: 0 }];
  assert.deepEqual(deriveSearchStatus('SEARCHING', runs, { properties: 12, strongMatches: 0 }), { status: 'PARTIAL_COMPLETE', failureReason: 'NO_FRESH_SOURCES' });
  assert.equal(deriveSearchStatus('SEARCHING', runs, { properties: 0, strongMatches: 0 }).status, 'FAILED');
});

/* ── Cached fallback, through the real pipeline, against an in-memory table ── */
import { serveCachedListings, shareRecentResults, requestKey, CACHE_WINDOW_MS } from '../../../supabase/functions/_shared/marketplaceSearch.ts';
import { FIXTURE_NOW, FIXTURE_REQUEST, listing } from './fixtures/marketplaceFixtures.mjs';

function memoryDb(rows, runs = []) {
  const table = { discovery_marketplace_listings: rows, discovery_marketplace_worker_runs: runs, fx_rates: [] };
  const query = (name) => {
    let list = [...(table[name] ?? [])], patch = null;
    const get = (row, path) => path.split(/->>?/).reduce((v, k) => (v == null ? v : v[k]), row);
    const q = {
      select: () => q, order: () => q, limit: (n) => { list = list.slice(0, n); return q; },
      eq: (k, v) => { list = list.filter((r) => String(get(r, k)) === String(v)); return q; },
      neq: (k, v) => { list = list.filter((r) => String(get(r, k)) !== String(v)); return q; },
      gte: (k, v) => { list = list.filter((r) => String(get(r, k)) >= String(v)); return q; },
      gt: (k, v) => { list = list.filter((r) => Number(get(r, k)) > Number(v)); return q; },
      in: (k, vals) => { if (Array.isArray(vals)) list = list.filter((r) => vals.includes(get(r, k))); return q; },
      is: () => q, maybeSingle: async () => ({ data: patch ? (list.forEach((r) => Object.assign(r, patch)), list[0] ?? null) : list[0] ?? null }),
      update: (p) => { patch = p; return q; },
      upsert: async (batch, opts) => {
        for (const row of batch) {
          const clash = table[name].find((r) => r.search_id === row.search_id && r.source_key === row.source_key && r.source_listing_id === row.source_listing_id);
          if (!clash) table[name].push(row); else if (!opts?.ignoreDuplicates) Object.assign(clash, row);
        }
        return { error: null };
      },
      then: (resolve) => resolve({ data: list, error: null }),
    };
    return q;
  };
  return { from: query, table };
}

const stored = (searchId, over) => {
  const raw = listing({ source: 'myhome-ge', ...over });
  return { search_id: searchId, worker_run_id: `run-${searchId}`, source_key: 'myhome-ge', source_listing_id: raw.sourceListingId, exact_url: raw.exactUrl, raw, observed_at: raw.observedAt };
};

test('a cooling-down MyHome run is filled with matching previously collected listings, honestly labelled, never over fresh rows', async () => {
  const old = new Date(FIXTURE_NOW.getTime() - 2 * 24 * 3_600_000).toISOString();
  const rows = [
    stored('earlier', { sourceListingId: 'm1', observedAt: old }),                       // matches
    stored('earlier', { sourceListingId: 'm2', observedAt: old, price: 900000 }),        // far over budget
    stored('earlier', { sourceListingId: 'm3', observedAt: old, transactionType: 'MONTHLY_RENT' }),
    stored('earlier', { sourceListingId: 'm4', observedAt: '2026-09-01T00:00:00Z' }),    // outside 14 days
    stored('current', { sourceListingId: 'm5', observedAt: FIXTURE_NOW.toISOString() }), // this search, fresh
    stored('earlier', { sourceListingId: 'm5', observedAt: old }),                       // same id, older copy
  ];
  const db = memoryDb(rows);
  const run = { id: 'run-current', worker_id: 'myhome-agent', status: 'BLOCKED' };
  const served = await serveCachedListings(db, 'current', FIXTURE_REQUEST, [run], FIXTURE_NOW);
  const mine = db.table.discovery_marketplace_listings.filter((r) => r.search_id === 'current');
  assert.equal(served, 2, 'm1 and the older m5 copy were accepted by the pipeline');
  const m1 = mine.find((r) => r.source_listing_id === 'm1');
  assert.equal(m1.raw.retrievalMetadata.observationLevel, 'CACHED');
  assert.equal(m1.observed_at, old, 'keeps its own last observation time');
  assert.equal(mine.find((r) => r.source_listing_id === 'm5').observed_at, FIXTURE_NOW.toISOString(), 'the fresh row is not overwritten');
  assert.ok(!mine.some((r) => ['m2', 'm3', 'm4'].includes(r.source_listing_id)));
  assert.equal(await serveCachedListings(db, 'current', FIXTURE_REQUEST, [run], FIXTURE_NOW), 0, 'runs once per run');
  assert.equal(await serveCachedListings(memoryDb(rows), 'current', FIXTURE_REQUEST, [{ ...run, worker_id: 'ssge-agent' }], FIXTURE_NOW), 0, 'a source draws only on its own pool');
  assert.equal(await serveCachedListings(memoryDb(rows), 'current', FIXTURE_REQUEST, [{ ...run, status: 'COMPLETE' }], FIXTURE_NOW), 0, 'a fresh complete run gets no cache');
});

test('every search is answered at once from the shared pool (MyHome and SS.ge), only from listings confirmed in the last 72 hours', async () => {
  const recent = new Date(FIXTURE_NOW.getTime() - 24 * 3_600_000).toISOString();
  const tooOld = new Date(FIXTURE_NOW.getTime() - CACHE_WINDOW_MS - 3_600_000).toISOString();
  const ss = (searchId, over) => { const row = stored(searchId, over); const raw = { ...row.raw, source: 'ss-ge' }; return { ...row, source_key: 'ss-ge', raw }; };
  const rows = [stored('earlier', { sourceListingId: 'm1', observedAt: recent }), stored('earlier', { sourceListingId: 'm9', observedAt: tooOld }),
    ss('earlier', { sourceListingId: 's1', observedAt: recent })];
  const db = memoryDb(rows);
  const runs = [{ id: 'run-mh', worker_id: 'myhome-agent', status: 'QUEUED' }, { id: 'run-ss', worker_id: 'ssge-agent', status: 'QUEUED' }];
  assert.equal(await serveCachedListings(db, 'new', FIXTURE_REQUEST, runs, FIXTURE_NOW), 0, 'a queued run is not a fallback case');
  assert.equal(await serveCachedListings(db, 'new', FIXTURE_REQUEST, runs, FIXTURE_NOW, true), 2, 'at start both sources answer from the pool');
  const mine = db.table.discovery_marketplace_listings.filter((r) => r.search_id === 'new');
  assert.deepEqual(mine.map((r) => r.source_listing_id).sort(), ['m1', 's1']);
  assert.ok(mine.every((r) => r.raw.retrievalMetadata.observationLevel === 'CACHED' && r.observed_at === recent));
  assert.ok(!mine.some((r) => r.source_listing_id === 'm9'), 'not confirmed within 72 hours: never shown, it may be sold or deleted');
});

test('identical searches share one fetch; different, stale or already-claimed runs never do', async () => {
  const now = FIXTURE_NOW;
  const req = (searchId) => ({ ...FIXTURE_REQUEST, searchId, searchPlanId: `plan-${searchId}`, requestedAt: now.toISOString(), maxResults: 2000 });
  assert.equal(requestKey(req('a')), requestKey(req('b')), 'per-search identity is not part of what the source is asked');
  assert.notEqual(requestKey(req('a')), requestKey({ ...req('a'), priceMaxUsd: 999 }));
  const minutes = (m) => new Date(now.getTime() - m * 60_000).toISOString();
  const runs = [
    { id: 'src', worker_id: 'myhome-agent', status: 'PARTIAL', request: req('a'), returned_count: 2, discovered_count: 161, query_applied: { pageCap: 3 }, errors: [{ code: 'ACCESS_DENIED' }], completed_at: minutes(5) },
    { id: 'q-same', search_id: 's-same', worker_id: 'myhome-agent', status: 'QUEUED', request: req('b') },
    { id: 'q-other', search_id: 's-other', worker_id: 'myhome-agent', status: 'QUEUED', request: { ...req('c'), priceMaxUsd: 999 } },
    { id: 'old', worker_id: 'myhome-agent', status: 'COMPLETE', request: { ...req('d'), districts: ['Saburtalo'] }, returned_count: 1, completed_at: minutes(45) },
    { id: 'q-old', search_id: 's-old', worker_id: 'myhome-agent', status: 'QUEUED', request: { ...req('e'), districts: ['Saburtalo'] } },
    { id: 'q-claimed', search_id: 's-claimed', worker_id: 'myhome-agent', status: 'SEARCHING', request: req('f') },
  ];
  const fresh = (id) => ({ ...stored('a', { sourceListingId: id, observedAt: minutes(5) }), worker_run_id: 'src', search_id: 'a' });
  const cachedRow = { ...stored('a', { sourceListingId: 'c1', observedAt: minutes(5) }), worker_run_id: 'src', search_id: 'a' };
  cachedRow.raw = { ...cachedRow.raw, retrievalMetadata: { observationLevel: 'CACHED' } };
  const db = memoryDb([fresh('f1'), fresh('f2'), cachedRow], runs);
  const processed = [];
  const shared = await shareRecentResults(db, 'myhome-agent', now, async (_db, searchId) => { processed.push(searchId); });
  assert.equal(shared, 1); assert.deepEqual(processed, ['s-same']);
  const closed = runs.find((r) => r.id === 'q-same');
  assert.equal(closed.status, 'PARTIAL', 'a partly read source run stays partial');
  assert.equal(closed.returned_count, 2); assert.equal(closed.query_applied.sharedFromRun, 'src');
  const copied = db.table.discovery_marketplace_listings.filter((r) => r.search_id === 's-same');
  assert.deepEqual(copied.map((r) => r.source_listing_id).sort(), ['f1', 'f2'], 'pool rows of the source run are not passed on as fresh');
  assert.ok(copied.every((r) => r.worker_run_id === 'q-same' && r.observed_at === minutes(5)), 'real observation time is kept');
  for (const id of ['q-other', 'q-old']) assert.equal(runs.find((r) => r.id === id).status, 'QUEUED', id);
  assert.equal(runs.find((r) => r.id === 'q-claimed').status, 'SEARCHING');
});

test('an owed pool answer (pool_pending) is served by any request, within its budget', async () => {
  const recent = new Date(FIXTURE_NOW.getTime() - 24 * 3_600_000).toISOString();
  const rows = [stored('earlier', { sourceListingId: 'm1', observedAt: recent })];
  const run = { id: 'run-p', worker_id: 'myhome-agent', status: 'QUEUED', pool_pending: true };
  assert.equal(await serveCachedListings(memoryDb([...rows], [{ ...run }]), 'new', FIXTURE_REQUEST, [{ ...run }], FIXTURE_NOW, false, 0), 0,
    'no budget left: nothing ranked, still owed');
  const db = memoryDb([...rows], [{ ...run }]);
  const runs = [{ ...run }];
  assert.equal(await serveCachedListings(db, 'new', FIXTURE_REQUEST, runs, FIXTURE_NOW), 1, 'a later status poll answers it');
  assert.equal(runs[0].pool_pending, false, 'and it is no longer owed');
});
