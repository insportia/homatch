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
import { serveCachedListings } from '../../../supabase/functions/_shared/marketplaceSearch.ts';
import { FIXTURE_NOW, FIXTURE_REQUEST, listing } from './fixtures/marketplaceFixtures.mjs';

function memoryDb(rows) {
  const table = { discovery_marketplace_listings: rows, fx_rates: [] };
  const query = (name) => {
    let list = [...(table[name] ?? [])];
    const get = (row, path) => path.split(/->>?/).reduce((v, k) => (v == null ? v : v[k]), row);
    const q = {
      select: () => q, order: () => q, limit: (n) => { list = list.slice(0, n); return q; },
      eq: (k, v) => { list = list.filter((r) => String(get(r, k)) === String(v)); return q; },
      neq: (k, v) => { list = list.filter((r) => String(get(r, k)) !== String(v)); return q; },
      gte: (k, v) => { list = list.filter((r) => String(get(r, k)) >= String(v)); return q; },
      in: () => q, is: () => q, maybeSingle: async () => ({ data: list[0] ?? null }),
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
  assert.equal(await serveCachedListings(memoryDb(rows), 'current', FIXTURE_REQUEST, [{ ...run, worker_id: 'ssge-agent' }], FIXTURE_NOW), 0, 'SS.ge is unchanged');
  assert.equal(await serveCachedListings(memoryDb(rows), 'current', FIXTURE_REQUEST, [{ ...run, status: 'COMPLETE' }], FIXTURE_NOW), 0, 'a fresh complete run gets no cache');
});
