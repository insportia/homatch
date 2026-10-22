// marketplaceInventory.ts against a fake database: one upsert per report, outcome counts,
// snapshot work only where R2 is configured, index keys confined to the worker's own provider.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.Deno ??= { env: { get: () => undefined } }; // R2 not configured in this suite
const { recordInventory, indexSnapshotCommit, indexSnapshotUpload, INDEX_MAX_BYTES } = await import('../marketplaceInventory.ts');

/* A worker candidate (worker-contract.ts shape) with only what these tests read. */
const listing = (over = {}) => ({ source: 'home-ge', sourceListingId: 'L0', exactUrl: 'https://www.home.ge/l/1', canonicalUrl: null, transactionType: 'BUY',
  propertyType: 'APARTMENT', price: 120000, currency: 'USD', areaSqm: 80, rooms: 3, bedrooms: 2, city: 'Tbilisi', district: 'Vake', images: [], amenities: [],
  observedAt: '2026-10-19T10:00:00Z', seller: { name: null, publicPhone: null, publicEmail: null }, retrievalMetadata: {}, ...over });

function fakeDb(outcomes) {
  const calls = [];
  return { calls, rpc: async (name, args) => { calls.push({ name, args }); return { data: outcomes(args.p_rows), error: null }; },
    from: () => { throw Error('no table access expected'); } };
}

test('one statement per report; outcomes counted; no R2 configured → no snapshot attempted, no failure', async () => {
  const db = fakeDb((rows) => rows.map((r, i) => ({ observation_id: `o${i}`, external_id: r.external_id, outcome: ['INSERTED', 'CHANGED', 'SEEN', 'FIRST_SNAPSHOT'][i % 4], first_seen_at: '2026-10-01T00:00:00Z' })));
  const listings = [1, 2, 3, 4].map((i) => listing({ sourceListingId: `L${i}` }));
  const out = await recordInventory(db, 'home-ge', listings);
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].name, 'upsert_marketplace_inventory');
  assert.equal(db.calls[0].args.p_source_key, 'home-ge');
  assert.deepEqual(db.calls[0].args.p_rows.map((r) => r.external_id), ['L1', 'L2', 'L3', 'L4']);
  assert.deepEqual(out, { inserted: 1, changed: 1, seen: 2, snapshots: 0, snapshotFailures: 0 }, 'FIRST_SNAPSHOT is a sighting, not a change');
  assert.deepEqual(await recordInventory(fakeDb(() => []), 'home-ge', []), { inserted: 0, changed: 0, seen: 0, snapshots: 0, snapshotFailures: 0 });
});

test('a failed upsert is reported to the caller (the ingest door logs it; it never reaches the worker)', async () => {
  const db = { rpc: async () => ({ data: null, error: { message: 'unknown inventory source: x' } }) };
  await assert.rejects(recordInventory(db, 'x', [listing()]), /inventory upsert: unknown inventory source/);
});

test('index snapshots: only well-formed keys under the worker\'s own provider; size and sha256 bounded', async () => {
  const sha = 'a'.repeat(64);
  assert.deepEqual(await indexSnapshotUpload('home-ge', 'nothex', 10), { error: 'BAD_SNAPSHOT' });
  assert.deepEqual(await indexSnapshotUpload('home-ge', sha, INDEX_MAX_BYTES + 1), { error: 'BAD_SNAPSHOT' });
  const db = { from: () => { throw Error('must not register'); } };
  for (const key of [
    'property-inventory/allhome-ge/ge/portal-index/index-20261019T120000Z-aaaaaaaa.json.gz', // another provider
    'property-inventory/home-ge/ge/portal-index/../../users/x.json.gz',
    'users/u/x.json.gz',
  ]) assert.deepEqual(await indexSnapshotCommit(db, 'home-ge', { key, sha256: sha, bytes: 10, entries: 1 }), { error: 'BAD_KEY' }, key);
  assert.deepEqual(await indexSnapshotCommit(db, 'home-ge', { key: 'property-inventory/home-ge/ge/portal-index/index-20261019T120000Z-aaaaaaaa.json.gz', sha256: sha, bytes: 0, entries: 1 }), { error: 'BAD_SNAPSHOT' });
});
