// A market is a place, not a property.
//
// Every verification bought the same knowledge again: sweep five bands, build
// a median, quote it, throw it away, and let the next flat in the same
// building pay for the sweep again. That sweep is 45% of a Verify, most of it
// web search at about $0.04 a call.
//
// These tests are in two halves. The first is that reuse actually happens —
// a fresh, confident snapshot must produce ZERO searches, because a search
// taken "just to be safe" costs exactly as much as one taken for a reason.
// The second half is the one that matters more: every way a snapshot can be
// untrustworthy must still buy research. A cheap market that is wrong is not
// a saving.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  roomBandOf,
  segmentKeyOf,
  segmentsFor,
  confidenceOf,
  ageHours,
  planMarket,
  priceIsAnomalous,
  draftSnapshot,
  snapshotBrief,
  SNAPSHOT_MAX_AGE_HOURS,
} from '../marketSnapshot.ts';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-09-12T12:00:00.000Z');
const agoHours = (h) => new Date(NOW - h * HOUR).toISOString();

const snapshot = (over = {}) => ({
  scope_type: 'PROJECT',
  scope_key: 'kristian-stiven-street-18',
  property_type: 'RESIDENTIAL',
  room_band: '3',
  currency: 'USD',
  median_price_per_sqm: 1600,
  lower_price_per_sqm: 1450,
  upper_price_per_sqm: 1800,
  sample_count: 9,
  usable_comparable_count: 7,
  source_count: 2,
  confidence: 'HIGH',
  basis_tier: 'SAME_PROJECT',
  last_refreshed_at: agoHours(24),
  ...over,
});

/* ── the saving ──────────────────────────────────────────────────────── */

test('a fresh confident snapshot buys no searches at all', () => {
  // The whole point. Zero, not one: a search taken for reassurance costs the
  // same as a search taken for a reason.
  const plan = planMarket({ snapshot: snapshot(), now: NOW });
  assert.equal(plan.refresh, false);
  assert.equal(plan.searchBudget, 0);
  assert.deepEqual(plan.reasons, []);
  assert.match(plan.summary, /reusing PROJECT snapshot/);
});

test('the stage is handed the answer rather than sent to find it', () => {
  const text = snapshotBrief(planMarket({ snapshot: snapshot(), now: NOW }));
  assert.match(text, /MARKET RANGE ALREADY ESTABLISHED/);
  assert.match(text, /1600/);
  assert.match(text, /1450-1800/);
  assert.match(text, /Do NOT search for comparables to rebuild this range/);
  // It still writes the section; the report is built from its output.
  assert.match(text, /Report the range, place the subject against it/);
});

test('a refreshing plan gets no snapshot brief, so nothing stale is quoted', () => {
  const stale = planMarket({ snapshot: snapshot({ last_refreshed_at: agoHours(400) }), now: NOW });
  assert.equal(snapshotBrief(stale), '');
});

/* ── every way it must still research ────────────────────────────────── */

test('no snapshot means full research', () => {
  const plan = planMarket({ snapshot: null, now: NOW });
  assert.equal(plan.refresh, true);
  assert.deepEqual(plan.reasons, ['NO_SNAPSHOT']);
  assert.ok(plan.searchBudget >= 4, 'a cold market was throttled');
});

test('a stale snapshot is refreshed, not reused', () => {
  const old = agoHours(SNAPSHOT_MAX_AGE_HOURS.PROJECT + 1);
  const plan = planMarket({ snapshot: snapshot({ last_refreshed_at: old }), now: NOW });
  assert.equal(plan.refresh, true);
  assert.ok(plan.reasons.includes('STALE'));
});

test('an unreadable timestamp counts as stale, which is the safe direction', () => {
  const plan = planMarket({ snapshot: snapshot({ last_refreshed_at: 'not-a-date' }), now: NOW });
  assert.ok(plan.reasons.includes('STALE'));
});

test('low confidence buys a targeted top-up rather than a sweep', () => {
  const plan = planMarket({ snapshot: snapshot({ confidence: 'LOW' }), now: NOW });
  assert.equal(plan.refresh, true);
  assert.ok(plan.reasons.includes('LOW_CONFIDENCE'));
  assert.ok(plan.searchBudget > 0);
});

test('too few comparables is its own reason, not hidden inside confidence', () => {
  const plan = planMarket({ snapshot: snapshot({ usable_comparable_count: 2 }), now: NOW });
  assert.ok(plan.reasons.includes('TOO_FEW_COMPARABLES'));
});

test('a price far outside the known band re-checks the band', () => {
  // A property genuinely priced 40% above its market is the most valuable
  // thing a report can say, and it is also what a stale snapshot looks like
  // from the inside. Either way it is worth the searches.
  const plan = planMarket({ snapshot: snapshot(), subjectPricePerSqm: 2600, now: NOW });
  assert.equal(plan.refresh, true);
  assert.ok(plan.reasons.includes('PRICE_ANOMALY'));
});

test('a normal price does not trigger a refresh', () => {
  const plan = planMarket({ snapshot: snapshot(), subjectPricePerSqm: 1646, now: NOW });
  assert.equal(plan.refresh, false);
  assert.equal(plan.searchBudget, 0);
});

test('a property outside the segment researches properly', () => {
  const plan = planMarket({ snapshot: snapshot(), outsideSegment: true, now: NOW });
  assert.equal(plan.refresh, true);
  assert.ok(plan.reasons.includes('OUTSIDE_SEGMENT'));
});

test('an admin can force a refresh, and the reason is recorded', () => {
  const plan = planMarket({ snapshot: snapshot(), forced: true, now: NOW });
  assert.equal(plan.refresh, true);
  assert.ok(plan.reasons.includes('FORCED'));
});

test('a top-up is cheaper than a cold sweep, but never zero', () => {
  const cold = planMarket({ snapshot: null, now: NOW });
  const topUp = planMarket({ snapshot: snapshot({ last_refreshed_at: agoHours(400) }), now: NOW });
  assert.ok(topUp.searchBudget < cold.searchBudget, 'a refresh with a base cost as much as starting over');
  assert.ok(topUp.searchBudget > 0, 'a stale market was given nothing to research with');
});

/* ── confidence is computed, not felt ────────────────────────────────── */

test('confidence needs depth, a narrow band and more than one source', () => {
  assert.equal(confidenceOf({ usableCount: 7, basis: 'SAME_PROJECT', sourceCount: 2 }), 'HIGH');
  // Enough listings, but all from one portal: one opinion, not a market.
  assert.equal(confidenceOf({ usableCount: 7, basis: 'SAME_PROJECT', sourceCount: 1 }), 'MEDIUM');
  // Enough listings, but only from across the whole city.
  assert.equal(confidenceOf({ usableCount: 7, basis: 'WIDER_MARKET', sourceCount: 3 }), 'MEDIUM');
  assert.equal(confidenceOf({ usableCount: 3, basis: 'SAME_PROJECT', sourceCount: 2 }), 'MEDIUM');
});

test('below the arithmetic floor, confidence is LOW whatever else is true', () => {
  // The deterministic layer refuses to build an analysis from fewer than two
  // listings in a tier. This agrees with it rather than second-guessing.
  assert.equal(confidenceOf({ usableCount: 2, basis: 'SAME_PROJECT', sourceCount: 5 }), 'LOW');
  assert.equal(confidenceOf({ usableCount: 0, basis: 'SAME_PROJECT' }), 'LOW');
});

/* ── the segment key ─────────────────────────────────────────────────── */

test('the reuse hierarchy runs narrowest first', () => {
  const segments = segmentsFor({
    projectSlug: 'kristian-stiven-street-18',
    microLocation: 'digomi',
    district: 'didi-digomi',
    city: 'tbilisi',
    rooms: 3,
  });
  assert.deepEqual(segments.map((s) => s.scopeType), ['PROJECT', 'MICRO_LOCATION', 'DISTRICT', 'CITY']);
});

test('a property with no project still reaches a district answer', () => {
  const segments = segmentsFor({ district: 'krtsanisi', city: 'tbilisi', rooms: 2 });
  assert.deepEqual(segments.map((s) => s.scopeType), ['DISTRICT', 'CITY']);
});

test('rooms band rather than split into segments nobody shares', () => {
  assert.equal(roomBandOf(1), '1');
  assert.equal(roomBandOf('3 rooms'), '3');
  assert.equal(roomBandOf(4), '4_PLUS');
  assert.equal(roomBandOf(7), '4_PLUS');
  assert.equal(roomBandOf(null), 'UNKNOWN');
  assert.equal(roomBandOf('studio'), 'UNKNOWN');
});

test('the key is stable across spelling but separates real differences', () => {
  const a = segmentKeyOf({ scopeType: 'PROJECT', scopeKey: 'Kristian Stiven Street 18', propertyType: 'RESIDENTIAL', roomBand: '3' });
  const b = segmentKeyOf({ scopeType: 'PROJECT', scopeKey: 'kristian-stiven-street-18', propertyType: 'RESIDENTIAL', roomBand: '3' });
  assert.equal(a, b);

  const twoRoom = segmentKeyOf({ scopeType: 'PROJECT', scopeKey: 'kristian-stiven-street-18', propertyType: 'RESIDENTIAL', roomBand: '2' });
  assert.notEqual(a, twoRoom, 'a 2-room and a 3-room market were treated as one');

  const district = segmentKeyOf({ scopeType: 'DISTRICT', scopeKey: 'kristian-stiven-street-18', propertyType: 'RESIDENTIAL', roomBand: '3' });
  assert.notEqual(a, district, 'a project median and a district median shared a key');
});

test('a segment with no scope has no key', () => {
  assert.equal(segmentKeyOf({ scopeType: 'PROJECT', scopeKey: '   ', propertyType: 'RESIDENTIAL', roomBand: '3' }), null);
});

/* ── writing one ─────────────────────────────────────────────────────── */

const market = (over = {}) => ({
  currency: 'USD',
  median: 1600,
  mean: 1620,
  min: 1450,
  max: 1800,
  count: 9,
  basis: 'SAME_PROJECT',
  basisCount: 7,
  closest: [],
  tierCounts: {},
  tiers: [],
  qualityFactors: [],
  conditionMix: {},
  ...over,
});

test('a real analysis becomes a storable snapshot', () => {
  const draft = draftSnapshot(
    { scopeType: 'PROJECT', scopeKey: 'p', propertyType: 'RESIDENTIAL', roomBand: '3' },
    market(),
    { sourceCount: 2 }
  );
  assert.ok(draft);
  assert.equal(draft.medianPricePerSqm, 1600);
  assert.equal(draft.usableComparableCount, 7);
  assert.equal(draft.confidence, 'HIGH');
});

test('nothing worth reusing is not written', () => {
  // A snapshot that would immediately read LOW and force a refresh next run
  // is not intelligence, it is a row.
  assert.equal(draftSnapshot({ scopeType: 'PROJECT', scopeKey: 'p', propertyType: 'RESIDENTIAL', roomBand: '3' }, market({ basisCount: 1 }), {}), null);
  assert.equal(draftSnapshot({ scopeType: 'PROJECT', scopeKey: 'p', propertyType: 'RESIDENTIAL', roomBand: '3' }, market({ median: 0 }), {}), null);
  assert.equal(draftSnapshot({ scopeType: 'PROJECT', scopeKey: 'p', propertyType: 'RESIDENTIAL', roomBand: '3' }, null, {}), null);
});

/* ── freshness differs by scope ──────────────────────────────────────── */

test('a narrow market goes stale faster than a whole city', () => {
  // One developer changing a price list moves a project median. It does not
  // move a city.
  assert.ok(SNAPSHOT_MAX_AGE_HOURS.PROJECT <= SNAPSHOT_MAX_AGE_HOURS.CITY);
  assert.ok(SNAPSHOT_MAX_AGE_HOURS.MICRO_LOCATION <= SNAPSHOT_MAX_AGE_HOURS.DISTRICT);
});

test('a district snapshot survives longer than a project one at the same age', () => {
  const at = agoHours(20 * 24);
  const project = planMarket({ snapshot: snapshot({ scope_type: 'PROJECT', last_refreshed_at: at }), now: NOW });
  const district = planMarket({ snapshot: snapshot({ scope_type: 'DISTRICT', last_refreshed_at: at }), now: NOW });
  assert.ok(project.reasons.includes('STALE'));
  assert.ok(!district.reasons.includes('STALE'));
});

test('age is measured, not guessed', () => {
  assert.equal(ageHours(agoHours(5), NOW), 5);
  assert.equal(ageHours(null, NOW), null);
  assert.equal(ageHours('nonsense', NOW), null);
});

test('an anomaly needs a real median to be measured against', () => {
  assert.equal(priceIsAnomalous(2600, null), false);
  assert.equal(priceIsAnomalous(null, snapshot()), false);
  assert.equal(priceIsAnomalous(2600, snapshot({ median_price_per_sqm: 0 })), false);
});

/* ── writing one, against a stubbed store ────────────────────────────
 *
 * The first production run wrote its snapshot TWICE, six seconds apart, from
 * one job: a verification can finish twice, which is why cost_events needed a
 * unique index. The invariant held — supersede-then-insert is ordered so the
 * partial unique index is never momentarily violated — but the history did
 * not, and a segment that looks re-researched when nothing changed is exactly
 * the signal market_refresh_roi exists to make trustworthy.
 */

function stubStore(existing = null) {
  const calls = { updates: [], inserts: [] };
  const db = {
    from() {
      const api = {
        select: () => api,
        eq: () => api,
        maybeSingle: async () => ({ data: existing }),
        insert: async (row) => { calls.inserts.push(row); return { error: null }; },
        update: (row) => { calls.updates.push(row); return { eq: async () => ({ error: null }) }; },
      };
      return api;
    },
  };
  return { db, calls };
}

const draft = {
  segment: { scopeType: 'PROJECT', scopeKey: 'p', propertyType: 'RESIDENTIAL', roomBand: 'UNKNOWN' },
  currency: 'USD', medianPricePerSqm: 970, lowerPricePerSqm: 950, upperPricePerSqm: 970,
  sampleCount: 3, usableComparableCount: 3, sourceCount: 2,
  basisTier: 'SAME_PROJECT', confidence: 'MEDIUM', refreshReason: 'INITIAL',
};

test('a job that already recorded this segment does not record it again', async () => {
  const { writeSnapshot } = await import('../snapshotStore.ts');
  const { db, calls } = stubStore({ id: 'row-1', built_by_job_id: 'job-1' });
  const out = await writeSnapshot(db, draft, { jobId: 'job-1' });
  assert.equal(out.written, false);
  assert.equal(calls.inserts.length, 0, 'a second finish wrote a duplicate snapshot');
  assert.equal(calls.updates.length, 0, 'a second finish superseded a row with a copy of itself');
});

test('a different job refreshing the same segment supersedes then inserts', async () => {
  const { writeSnapshot } = await import('../snapshotStore.ts');
  const { db, calls } = stubStore({ id: 'row-1', built_by_job_id: 'job-0' });
  const out = await writeSnapshot(db, draft, { jobId: 'job-1' });
  assert.equal(out.written, true);
  assert.equal(out.superseded, true);
  assert.equal(calls.updates[0].status, 'SUPERSEDED');
  assert.equal(calls.inserts[0].status, 'CURRENT');
  // Order matters: the index allows one CURRENT row, so the old one must die
  // before the new one is born.
  assert.equal(calls.inserts[0].built_by_job_id, 'job-1');
});

test('a first snapshot for a segment inserts without superseding anything', async () => {
  const { writeSnapshot } = await import('../snapshotStore.ts');
  const { db, calls } = stubStore(null);
  const out = await writeSnapshot(db, draft, { jobId: 'job-1' });
  assert.equal(out.written, true);
  assert.equal(out.superseded, false);
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.inserts.length, 1);
});

test('nothing worth storing writes nothing', async () => {
  const { writeSnapshot } = await import('../snapshotStore.ts');
  const { db, calls } = stubStore(null);
  const out = await writeSnapshot(db, null, { jobId: 'job-1' });
  assert.equal(out.written, false);
  assert.equal(calls.inserts.length, 0);
});
