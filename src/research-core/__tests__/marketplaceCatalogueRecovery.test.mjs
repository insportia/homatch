import test from 'node:test';
import assert from 'node:assert/strict';
import { resultCatalogue, hasCurrentIdentity } from '../../../supabase/functions/_shared/marketplaceCatalogue.ts';
import { processSearch, publicView } from '../marketplace/pipeline.ts';
import * as F from './fixtures/marketplaceFixtures.mjs';

function database(views, raw, failure = false) {
  const calls = [];
  return { calls, from(table) {
    calls.push(table);
    const query = { select() { return this; }, eq(key, id) { if (key === 'search_id') assert.equal(id, 'owned-search'); return this; },
      order() { return this; }, is() { return Promise.resolve({ data: [] }); },
      range(from, to) { return Promise.resolve(failure ? { error: new Error('database unavailable') }
        : { data: (table === 'discovery_marketplace_properties' ? views.map(view => ({ view })) : raw.map(raw => ({ raw }))).slice(from, to + 1) }); } };
    return query;
  } };
}
const search = { id: 'owned-search', request: F.FIXTURE_REQUEST, processed_at: F.FIXTURE_NOW.toISOString() };

test('legacy canonical relationships rebuild read-only from owned original records, without source or AI calls', async () => {
  const a = F.listing({ source: 'myhome-ge', sourceListingId: 'a', address: 'Street 10' });
  const b = F.listing({ source: 'ss-ge', sourceListingId: 'b', address: 'Street 1' });
  const legacy = publicView(processSearch({ request: F.FIXTURE_REQUEST, candidates: [{ workerId: 'old', candidate: a }], now: F.FIXTURE_NOW }).properties[0]);
  delete legacy.identity;
  const db = database([legacy], [a, b]);
  const results = await resultCatalogue(db, search);
  assert.equal(results.length, 2);
  assert.ok(results.every(hasCurrentIdentity));
  assert.ok(db.calls.includes('discovery_marketplace_listings'));
  assert.equal(hasCurrentIdentity(null), false);
});

test('current identity catalogue avoids loading every original listing; database errors remain errors', async () => {
  const views = processSearch({ request: F.FIXTURE_REQUEST, candidates: F.fixtureCandidates(), now: F.FIXTURE_NOW }).properties.map(publicView);
  const db = database(views, []);
  assert.deepEqual(await resultCatalogue(db, search), views);
  assert.deepEqual(db.calls, ['discovery_marketplace_properties']);
  await assert.rejects(resultCatalogue(database([], [], true), search), /database unavailable/);
});
