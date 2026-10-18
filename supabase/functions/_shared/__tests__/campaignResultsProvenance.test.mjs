// Deep Search results provenance and dated FX, executed against a fake database (no network,
// no provider, no money): a rebuild is "verified" only when every actor run still owns exactly
// the offers it booked and nothing changed after the campaign ended; GEL prices convert only
// through a rate dated near the campaign.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.Deno = { env: { get: () => undefined } };
const { persistCampaignResults } = await import('../findProperty/campaignResults.ts');

const ENDED = '2026-10-18T09:20:00Z';
const RUN = { id: 'run-1', user_id: 'u-1', subscription_id: null, offer_plan: { marketplaceSearchId: 'ms-1' }, pricing_policy: 'paid_discovery_37_63_v1', started_at: '2026-10-18T08:00:00Z', completed_at: ENDED };
/* The production campaign's request (f8833757). */
const REQUEST = { transactionType: 'BUY', propertyType: 'APARTMENT', city: 'Tbilisi', priceMinUsd: 120000, priceMaxUsd: 160000 };
const post = (id, ar, extra = {}) => ({
  id, canonical_url: `https://www.facebook.com/groups/g/posts/${id}`, transaction: 'SALE', property_type: 'APARTMENT', city: 'Tbilisi', district: null,
  sale_amount: 150000, sale_currency: 'USD', rent_amount: null, rent_currency: null, area_sqm: 90, rooms: 3, bedrooms: 2,
  title: null, description: 'იყიდება ბინა', published_at: '2026-10-15T00:00:00Z', content_fingerprint: `fp-${id}`, image_urls: [],
  field_origins: { memo23ActorRunId: ar, network: 'FACEBOOK' }, updated_at: '2026-10-18T09:00:00Z', ...extra,
});

function fakeDb({ actorRuns, offers, fx = [] }) {
  const writes = [];
  const from = (table) => {
    const q = { table, op: 'select', payload: null };
    const chain = {
      select() { return chain; }, eq() { return chain; }, in() { return chain; }, is() { return chain; }, lte() { return chain; },
      order() { return chain; }, limit() { return chain; }, range() { return chain; }, maybeSingle() { q.single = true; return chain; },
      upsert(p) { q.op = 'upsert'; q.payload = p; writes.push(q); return chain; }, update(p) { q.op = 'update'; q.payload = p; writes.push(q); return chain; },
      delete() { q.op = 'delete'; writes.push(q); return chain; },
      then(resolve, reject) {
        const data = q.op !== 'select' ? null
          : table === 'discovery_runs' ? RUN
            : table === 'find_property_actor_runs' ? actorRuns
              : table === 'supply_observations' ? offers
                : table === 'fx_rates' ? fx
                  : table === 'find_property_campaign_results' ? []
                    : table === 'discovery_marketplace_searches' ? { request: REQUEST, brief: {} } : null;
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return chain;
  };
  return { writes, from, rpc() { throw new Error('no RPC expected'); } };
}
const outcomeOf = (db) => db.writes.find((w) => w.table === 'discovery_runs' && w.op === 'update').payload.campaign_outcome;
const noNetwork = async (fn) => { const real = globalThis.fetch; globalThis.fetch = async () => { throw new Error('offline'); }; try { return await fn(); } finally { globalThis.fetch = real; } };

test('a rebuild that still matches what every actor run booked is verified', async () => {
  const db = fakeDb({ actorRuns: [{ id: 'ar1', items_fetched: 10, results_billed: 10, offers_found: 2 }, { id: 'ar2', items_fetched: 5, results_billed: 5, offers_found: 0 }],
    offers: [post('a', 'ar1'), post('b', 'ar1')] });
  await noNetwork(() => persistCampaignResults(db, 'run-1'));
  assert.deepEqual({ ...outcomeOf(db).provenance, fxSources: undefined },
    { captured: 'RECONSTRUCTED', bookedOffers: 2, attributedOffers: 2, changedAfterEnd: 0, verified: true, fxSources: undefined });
});

test('a post taken over by a later run, or changed after the end, makes the rebuild unverified', async () => {
  const lost = fakeDb({ actorRuns: [{ id: 'ar1', items_fetched: 10, results_billed: 10, offers_found: 3 }], offers: [post('a', 'ar1'), post('b', 'ar1')] });
  await noNetwork(() => persistCampaignResults(lost, 'run-1'));
  assert.equal(outcomeOf(lost).provenance.verified, false, 'one booked offer is no longer attributed to this campaign');
  const edited = fakeDb({ actorRuns: [{ id: 'ar1', items_fetched: 10, results_billed: 10, offers_found: 2 }],
    offers: [post('a', 'ar1'), post('b', 'ar1', { updated_at: '2026-10-19T00:00:00Z' })] });
  await noNetwork(() => persistCampaignResults(edited, 'run-1', 'CAMPAIGN_END'));
  assert.deepEqual([outcomeOf(edited).provenance.captured, outcomeOf(edited).provenance.changedAfterEnd, outcomeOf(edited).provenance.verified], ['CAMPAIGN_END', 1, false]);
});

test('GEL is converted only through a rate in effect at the campaign; without one the price is UNVERIFIED', async () => {
  const gel = [post('a', 'ar1', { sale_amount: 405000, sale_currency: 'GEL' })];
  const ars = [{ id: 'ar1', items_fetched: 1, results_billed: 1, offers_found: 1 }];
  const none = fakeDb({ actorRuns: ars, offers: gel });
  await noNetwork(() => persistCampaignResults(none, 'run-1'));
  const row = none.writes.find((w) => w.op === 'upsert').payload[0];
  assert.equal(row.checks.find((c) => c.key === 'price').state, 'UNVERIFIED');
  assert.equal(row.snapshot.priceUsd, null);
  assert.ok(!row.reject_reasons.includes('PRICE'), 'never rejected for price without a dated rate');
  const dated = fakeDb({ actorRuns: ars, offers: gel, fx: [{ base_currency: 'USD', quote_currency: 'GEL', rate: 2.7, effective_from: '2026-10-17T00:00:00Z' }] });
  await noNetwork(() => persistCampaignResults(dated, 'run-1'));
  const priced = dated.writes.find((w) => w.op === 'upsert').payload[0];
  assert.equal(priced.snapshot.priceUsd, 150000, '405,000 GEL at 2.7 = $150,000');
  assert.equal(priced.checks.find((c) => c.key === 'price').state, 'MATCH');
  assert.deepEqual(outcomeOf(dated).provenance.fxSources, ['fx_rates']);
});
