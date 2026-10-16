// ROUTED OBJECTS: a file works wherever it is, a new file goes where the
// bucket's switch says, an R2 write is confirmed and indexed or it does not
// exist, and removal reaches both stores.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readRouted, signRouted, writeRouted, removeRouted, writeTarget, r2KeyFor } from '../routed.ts';

const PATH = '11111111-2222-3333-4444-555555555555/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png';
const KEY = `meta-ads-media/${PATH}`;
const bytes = (n) => new Uint8Array(n).fill(7);

function fakeStore({ r2 = new Map(), headSize = null, putFails = false } = {}) {
  const log = [];
  return {
    log, r2,
    async get(key) { log.push(['get', key]); return r2.has(key) ? new Response(r2.get(key), { headers: { 'content-type': 'image/png' } }) : new Response(null, { status: 404 }); },
    async head(key) { log.push(['head', key]); return r2.has(key) ? { exists: true, size: headSize ?? r2.get(key).byteLength, etag: 'e', contentType: 'image/png', lastModified: null } : { exists: false, size: null, etag: null, contentType: null, lastModified: null }; },
    async put(key, body) { log.push(['put', key]); if (putFails) throw new Error('R2 503'); r2.set(key, body); return { etag: 'e' }; },
    async remove(key) { log.push(['remove', key]); r2.delete(key); },
    async sign(key, expiresIn) { log.push(['sign', key, expiresIn]); return { url: `https://r2/${key}` }; },
  };
}

function fakeDb({ target = 'SUPABASE', supa = new Map(), indexFails = false } = {}) {
  const log = [];
  return {
    log, supa,
    async rpc(fn, args) { log.push(['rpc', fn, args]); return { data: target, error: null }; },
    storage: { from: (bucket) => ({
      async download(p) { log.push(['supa.download', bucket, p]); return supa.has(p) ? { data: new Blob([supa.get(p)], { type: 'image/png' }), error: null } : { data: null, error: { message: 'not found' } }; },
      async upload(p, b) { log.push(['supa.upload', bucket, p]); supa.set(p, b); return { error: null }; },
      async createSignedUrl(p, ttl) { log.push(['supa.sign', bucket, p, ttl]); return supa.has(p) ? { data: { signedUrl: `https://supa/${p}` }, error: null } : { data: null, error: { message: 'nf' } }; },
      async remove(ps) { log.push(['supa.remove', bucket, ps]); ps.forEach((p) => supa.delete(p)); return { error: null }; },
    }) },
    from: (table) => ({
      async upsert(row) { log.push(['upsert', table, row]); return { error: indexFails ? { message: 'index down' } : null }; },
      update(row) { return { eq: async (col, val) => { log.push(['update', table, row, val]); return { error: null }; } }; },
    }),
  };
}

test('the R2 key is the bucket plus the path the product already stores', () => {
  assert.equal(r2KeyFor('meta-ads-media', PATH), KEY);
  assert.equal(r2KeyFor('deal-room-documents', 'u/r/d.pdf'), 'deal-room-documents/u/r/d.pdf');
});

test('reads try R2 first and fall back to Supabase Storage', async () => {
  const inR2 = fakeStore({ r2: new Map([[KEY, bytes(3)]]) });
  const got = await readRouted(fakeDb(), 'meta-ads-media', PATH, inR2);
  assert.equal(got.source, 'R2');
  assert.equal(got.bytes.byteLength, 3);

  const db = fakeDb({ supa: new Map([[PATH, bytes(5)]]) });
  const legacy = await readRouted(db, 'meta-ads-media', PATH, fakeStore());
  assert.equal(legacy.source, 'SUPABASE');
  assert.equal(legacy.bytes.byteLength, 5);

  assert.equal(await readRouted(fakeDb(), 'meta-ads-media', PATH, fakeStore()), null, 'in neither: null, not an empty file');
});

test('an R2 outage falls back to Supabase instead of failing the read', async () => {
  const broken = { ...fakeStore(), async get() { throw new Error('R2 down'); } };
  const db = fakeDb({ supa: new Map([[PATH, bytes(2)]]) });
  assert.equal((await readRouted(db, 'meta-ads-media', PATH, broken)).source, 'SUPABASE');
});

test('signing uses R2 only when the object is really there, capped at 15 minutes', async () => {
  const store = fakeStore({ r2: new Map([[KEY, bytes(1)]]) });
  const r2 = await signRouted(fakeDb(), 'meta-ads-media', PATH, 3600, {}, store);
  assert.equal(r2.source, 'R2');
  assert.deepEqual(store.log.find(([op]) => op === 'sign'), ['sign', KEY, 900]);

  const db = fakeDb({ supa: new Map([[PATH, bytes(1)]]) });
  const supa = await signRouted(db, 'meta-ads-media', PATH, 3600, {}, fakeStore());
  assert.equal(supa.source, 'SUPABASE');
  assert.equal(supa.url, `https://supa/${PATH}`);
});

test('writes follow the switch: SUPABASE writes nothing to R2', async () => {
  const store = fakeStore();
  const db = fakeDb({ target: 'SUPABASE' });
  const res = await writeRouted(db, 'meta-ads-media', PATH, bytes(4), 'image/png', {}, store);
  assert.deepEqual(res, { error: null, source: 'SUPABASE' });
  assert.ok(db.supa.has(PATH));
  assert.equal(store.log.length, 0);
});

test('an R2 write is confirmed by HEAD and indexed ACTIVE with owner and checksums', async () => {
  const store = fakeStore();
  const db = fakeDb({ target: 'R2' });
  const res = await writeRouted(db, 'meta-ads-media', PATH, bytes(4), 'image/png', { ownerUserId: 'owner-1' }, store);
  assert.deepEqual(res, { error: null, source: 'R2' });
  assert.ok(store.r2.has(KEY));
  assert.ok(!db.supa.has(PATH), 'nothing written to Supabase');
  const [, table, row] = db.log.find(([op]) => op === 'upsert');
  assert.equal(table, 'storage_objects');
  assert.equal(row.object_key, KEY);
  assert.equal(row.lifecycle, 'ACTIVE');
  assert.equal(row.owner_user_id, 'owner-1');
  assert.equal(row.byte_size, 4);
  assert.match(row.checksum_sha256, /^[0-9a-f]{64}$/);
});

test('a write R2 does not confirm, or the index refuses, leaves no orphan', async () => {
  const short = fakeStore({ headSize: 1 });
  const r1 = await writeRouted(fakeDb({ target: 'R2' }), 'meta-ads-media', PATH, bytes(4), 'image/png', {}, short);
  assert.match(r1.error.message, /not confirmed/);
  assert.ok(!short.r2.has(KEY), 'the unconfirmed object was removed');

  const store = fakeStore();
  const r2 = await writeRouted(fakeDb({ target: 'R2', indexFails: true }), 'meta-ads-media', PATH, bytes(4), 'image/png', {}, store);
  assert.match(r2.error.message, /index/);
  assert.ok(!store.r2.has(KEY), 'an object nothing indexes is removed');

  const down = fakeStore({ putFails: true });
  const r3 = await writeRouted(fakeDb({ target: 'R2' }), 'meta-ads-media', PATH, bytes(4), 'image/png', {}, down);
  assert.match(r3.error.message, /R2 503/);
});

test('a write never silently overwrites an existing R2 object', async () => {
  const store = fakeStore({ r2: new Map([[KEY, bytes(9)]]) });
  const res = await writeRouted(fakeDb({ target: 'R2' }), 'meta-ads-media', PATH, bytes(4), 'image/png', {}, store);
  assert.match(res.error.message, /already exists/);
  assert.equal(store.r2.get(KEY).byteLength, 9, 'the original is untouched');
});

test('removal reaches both stores and marks the index row DELETED', async () => {
  const store = fakeStore({ r2: new Map([[KEY, bytes(1)]]) });
  const db = fakeDb({ supa: new Map([[PATH, bytes(1)]]) });
  const res = await removeRouted(db, 'meta-ads-media', [PATH], store);
  assert.equal(res.error, null);
  assert.ok(!store.r2.has(KEY));
  assert.ok(!db.supa.has(PATH));
  assert.equal(db.log.find(([op]) => op === 'update')[2].lifecycle, 'DELETED');
});

test('an unreadable switch means SUPABASE, today\'s behaviour', async () => {
  const db = { rpc: async () => { throw new Error('rpc down'); } };
  assert.equal(await writeTarget(db, 'meta-ads-media'), 'SUPABASE');
  assert.equal(await writeTarget({ rpc: async () => ({ data: null, error: { message: 'x' } }) }, 'meta-ads-media'), 'SUPABASE');
});
