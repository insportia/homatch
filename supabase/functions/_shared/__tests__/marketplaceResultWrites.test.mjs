// FIND PROPERTY — one rejected result row never erases the others.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeResultRows } from '../marketplaceSearch.ts';

function fakeDb(rejectKey) {
  const stored = new Map();
  return {
    stored,
    from() {
      return {
        upsert(rows) {
          if (rows.some((r) => r.property_key === rejectKey)) return Promise.resolve({ error: { message: 'invalid input syntax for type json' } });
          for (const r of rows) stored.set(r.property_key, r);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

test('a batch with one bad row is retried row by row; only the bad row is lost and reported', async () => {
  const rows = Array.from({ length: 250 }, (_, i) => ({ search_id: 's', property_key: `k${i}`, rank: i + 1 }));
  const db = fakeDb('k7');
  const out = await writeResultRows(db, rows);
  assert.equal(out.written, 249);
  assert.deepEqual(out.failedKeys, ['k7']);
  assert.match(out.error, /invalid input syntax/);
  assert.equal(db.stored.size, 249);
  assert.ok(db.stored.has('k0') && db.stored.has('k249') && !db.stored.has('k7'), 'everything but the bad row is kept, top of the ranking included');
});

test('clean rows are written in checked batches with nothing reported', async () => {
  const db = fakeDb(null);
  const out = await writeResultRows(db, Array.from({ length: 618 }, (_, i) => ({ search_id: 's', property_key: `k${i}` })));
  assert.equal(out.written, 618);
  assert.deepEqual(out.failedKeys, []);
  assert.equal(out.error, null);
});
