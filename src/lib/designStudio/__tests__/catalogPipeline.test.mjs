// The import pipeline, end to end, against an in-memory world: a database,
// an object store and a provider. Resume, idempotency, bounded retry,
// validation, licences, delivery classes, ledger consistency, isolation.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { discover, processAsset, work, scrub } from '../catalogPipeline.ts';
import { homatchAssetId, rowUuid, CATALOG_KEY } from '../catalogSource.ts';

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const JPG = '\xff\xd8\xff\xe0 jpeg bytes';
const GLTF = (uris) => JSON.stringify({ asset: { version: '2.0' }, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  accessors: [{ count: 8, min: [-0.5, 0, -0.4], max: [0.5, 0.9, 0.4] }, { count: 36 }], buffers: uris.filter((u) => u.endsWith('.bin')).map((uri) => ({ uri })), images: uris.filter((u) => u.endsWith('.jpg')).map((uri) => ({ uri })) });

const CC0 = { licenseClass: 'CC0', providerLicense: 'cc0', url: null, redistribution: true, runtimeDelivery: 'PUBLIC', attributionRequired: false, credit: null };
const SIGNED_IN = { licenseClass: 'ROYALTY_FREE', providerLicense: 'rf', url: null, redistribution: false, runtimeDelivery: 'SIGNED_IN', attributionRequired: false, credit: null };
const UNKNOWN = { licenseClass: 'UNKNOWN', providerLicense: 'free', url: null, redistribution: false, runtimeDelivery: 'NONE', attributionRequired: false, credit: null };

/** A provider with a material, a model, a broken model and a model without a licence. */
function fakeAdapter(licenses = {}) {
  const assets = {
    wood: { kind: 'MATERIAL', files: { 'textures/wood_diff_1k.jpg': JPG, 'textures/wood_nor_gl_1k.jpg': JPG, 'textures/wood_arm_1k.jpg': JPG }, hash: 'w1' },
    chair: { kind: 'MODEL', files: { 'chair_1k.gltf': GLTF(['chair.bin', 'textures/chair_diff_1k.jpg']), 'chair.bin': 'BIN', 'textures/chair_diff_1k.jpg': JPG }, hash: 'c1' },
    broken: { kind: 'MODEL', files: { 'broken_1k.gltf': GLTF(['missing.bin']) }, hash: 'b1' },
    nolicence: { kind: 'MODEL', files: { 'x_1k.gltf': GLTF([]) }, hash: 'n1' },
  };
  const role = (p) => (p.endsWith('.gltf') ? 'GLTF' : p.endsWith('.bin') ? 'GEOMETRY' : /nor_gl/.test(p) ? 'NORMAL' : /_arm_/.test(p) ? 'ORM' : 'BASE_COLOR');
  return {
    assets,
    adapter: {
      provider: 'fakeprov', policy: 'fake-v1',
      license: (a) => licenses[a.id] ?? (a.id === 'nolicence' ? UNKNOWN : CC0),
      async discover() {
        return Object.entries(assets).map(([id, a]) => ({ sourceAssetId: id, kind: a.kind, canonical: { canonicalCategory: a.kind === 'MODEL' ? 'OBJECT.FURNITURE' : 'MATERIAL.WOOD', canonicalSubcategory: a.kind === 'MODEL' ? 'CHAIR' : 'FLOOR_BOARDS' }, asset: { id, name: id }, naming: { displayName: `Nice ${id}`, qualifiers: [], normalizedName: id, styleTags: [], colorTags: [], materialTags: [], aliases: [id] } }));
      },
      async current(id) { return { asset: { id, name: id, category: 'Wood' }, files: {}, filesHash: assets[id].hash, categoryId: null, categoryPath: 'Wood' }; },
      plan(kind, id, asset) {
        const lic = this.license(asset);
        const delivery = lic.runtimeDelivery === 'PUBLIC' ? 'public' : 'licensed';
        const files = Object.entries(assets[id].files).map(([p, body]) => ({ role: role(p), resolution: p.endsWith('.bin') ? null : '1k', relPath: p, sourceUrl: `https://provider.example/${id}/${p}?sig=SECRET`, bytes: body.length, md5: md5(body), contentType: 'x', delivery }));
        files.push({ role: 'METADATA', resolution: null, relPath: 'source.json', sourceUrl: null, bytes: 0, md5: null, contentType: 'application/json', delivery: lic.redistribution ? 'public' : 'restricted' });
        return { kind, sourceAssetId: id, resolutions: ['1k'], files, bytes: 0, refusal: null };
      },
      name: (kind, a) => ({ displayName: `Nice ${a.id}`, qualifiers: [], normalizedName: a.id, styleTags: [], colorTags: [], materialTags: [], aliases: [a.id] }),
      sourcePage: (id) => `https://provider.example/${id}`,
    },
  };
}

function world(adapterBundle, faults = {}) {
  const imports = new Map(); const events = []; const tables = {}; const r2 = new Map(); const files = new Map();
  let dirs = 0; let puts = 0; let downloads = 0;
  const io = {
    runId: 'test-run',
    adapters: { fakeprov: adapterBundle.adapter },
    fetchJson: async () => ({}),
    resolveDownload: async (_p, url) => url,
    async download(url, dest) {
      downloads += 1;
      if (faults.download?.(url)) throw new Error(`network down for ${url}`);
      const [, id, ...rest] = new URL(url).pathname.split('/');
      const body = adapterBundle.assets[id].files[rest.join('/')];
      files.set(dest, body);
      return { bytes: body.length, md5: md5(body), sha256: sha(body) };
    },
    readHead: (file) => new TextEncoder().encode(files.get(file).slice(0, 16)).map((b, i) => files.get(file).charCodeAt(i) & 255),
    readText: (file) => files.get(file),
    writeText(file, text) { files.set(file, text); return { bytes: text.length, md5: md5(text), sha256: sha(text) }; },
    digest: (file) => ({ bytes: files.get(file).length, md5: md5(files.get(file)), sha256: sha(files.get(file)) }),
    tempDir: () => `/tmp/d${(dirs += 1)}`,
    removeDir: () => {},
    join: (...p) => p.join('/'),
    validateGltf: async () => ({ errors: 0, warnings: 0 }),
    gltfJson: (file) => JSON.parse(files.get(file)),
    async optimize(kind, _plan, dir, id) {
      if (kind !== 'MODEL') return { state: 'SKIPPED', note: 'no tools in tests', files: [] };
      if (faults.optimize) return faults.optimize(id);
      const main = `${dir}/opt/${id}.glb`; const lod1 = `${dir}/opt/${id}.lod1.glb`;
      files.set(main, 'glTF-runtime-main'); files.set(lod1, 'glTF-lod1');
      return {
        state: 'DONE',
        files: [{ role: 'GLB', resolution: null, relPath: `${id}.glb`, file: main, contentType: 'model/gltf-binary' }, { role: 'GLB', resolution: null, relPath: `${id}.lod1.glb`, file: lod1, contentType: 'model/gltf-binary' }],
        runtime: { main: { file: `${id}.glb`, bytes: 17, textureBytes: 8, maxTextureEdge: 2048, textures: 1, compressed: true }, lod1: { file: `${id}.lod1.glb`, bytes: 9, textureBytes: 4, maxTextureEdge: 1024, textures: 1, compressed: true } },
      };
    },
    async existing(objects) { return new Set(objects.filter((o) => r2.get(o.key)?.md5 === o.md5 && r2.get(o.key)?.bytes === o.bytes).map((o) => o.key)); },
    async put(objects) {
      for (const o of objects) {
        if (faults.put?.(o, puts)) throw new Error('connection reset during upload');
        puts += 1; r2.set(o.key, { md5: o.md5, bytes: o.bytes });
      }
    },
    db: {
      async claim(owner, limit) {
        const rows = [...imports.values()].filter((r) => r.state === 'QUEUED' && r.attempts < r.max_attempts).sort((a, b) => (a.homatch_asset_id < b.homatch_asset_id ? -1 : 1)).slice(0, limit);
        for (const r of rows) { r.state = 'DOWNLOADING'; r.attempts += 1; r.lease_owner = owner; }
        return rows.map((r) => ({ ...r }));
      },
      async patchImport(hma, patch) { Object.assign(imports.get(hma), patch); },
      async event(hma, stage, ev, extra = {}) { events.push({ hma, stage, ev, ...extra }); },
      async upsert(table, rows, onConflict) {
        const t = (tables[table] ??= new Map());
        for (const r of rows) {
          const k = r[onConflict];
          if (table === 'ds_catalog_imports' && !imports.has(k)) imports.set(k, { attempts: 0, max_attempts: 3, detail: {}, state: 'DISCOVERED', ...r });
          else if (table === 'ds_catalog_imports') Object.assign(imports.get(k), r);
          t.set(k, { ...(t.get(k) ?? {}), ...r });
        }
      },
      async names() { return [...imports.values()].map((r) => ({ homatch_asset_id: r.homatch_asset_id, source_provider: r.source_provider, kind: r.kind, display_name: r.display_name })); },
      async existingStates() { return new Map([...imports.values()].map((r) => [r.homatch_asset_id, r.state])); },
    },
    now: () => '2026-09-30T00:00:00.000Z',
  };
  const queue = (...ids) => { for (const r of imports.values()) if (ids.includes(r.source_asset_id)) { r.state = 'QUEUED'; r.attempts = 0; } };
  return { io, imports, events, tables, r2, queue, get puts() { return puts; }, get downloads() { return downloads; } };
}

const byId = (w, id) => [...w.imports.values()].find((r) => r.source_asset_id === id);

test('discovery records and names, never queues; an unknown licence is EXCLUDED with its reason', async () => {
  const w = world(fakeAdapter());
  const r = await discover(w.io, 'fakeprov');
  assert.equal(r.found, 4);
  assert.ok([...w.imports.values()].every((x) => x.state !== 'QUEUED'), 'discovery never queues');
  assert.equal(byId(w, 'nolicence').state, 'EXCLUDED');
  assert.match(byId(w, 'nolicence').detail.excluded, /licence unknown/);
  assert.equal(byId(w, 'wood').homatch_asset_id, await homatchAssetId('fakeprov', 'MATERIAL', 'wood'));
  // Discovering again finds the same assets and changes no state.
  byId(w, 'wood').state = 'READY';
  await discover(w.io, 'fakeprov');
  assert.equal(w.imports.size, 4, 'no duplicates');
  assert.equal(byId(w, 'wood').state, 'READY', 'a re-discovery never resets progress');
});

test('an asset goes READY: stored under its delivery class, ledger = registry = object store', async () => {
  const w = world(fakeAdapter());
  await discover(w.io, 'fakeprov');
  w.queue('wood', 'chair');
  const tally = await work(w.io, { budgetMs: 60000, concurrency: 2 });
  assert.deepEqual(tally, { READY: 2, RETRY: 0, FAILED: 0, EXCLUDED: 0 });
  const ledger = [...w.tables.storage_objects.values()];
  const registry = [...w.tables.ds_catalog_files.values()];
  assert.equal(ledger.length, registry.length);
  assert.equal(ledger.length, w.r2.size, 'every stored object is in the ledger, and nothing else');
  for (const l of ledger) {
    assert.match(l.object_key, CATALOG_KEY);
    assert.equal(w.r2.get(l.object_key).md5, l.checksum_md5);
    assert.equal(l.category, `catalog-${l.object_key.split('/')[2]}`);
  }
  assert.ok(registry.every((f) => f.delivery === 'public'), 'CC0: public');
  const chair = w.tables.ds_catalog_assets.get(await rowUuid(byId(w, 'chair').homatch_asset_id));
  assert.equal(chair.code, byId(w, 'chair').homatch_asset_id);
  assert.deepEqual([chair.width_m, chair.height_m, chair.depth_m], [1, 0.9, 0.8], 'dimensions measured from the model');
  assert.equal(chair.triangles, 12);
  assert.equal(chair.license_class, 'CC0');
  assert.match(chair.model_key, /\/optimized\/chair\.glb$/, 'the scene gets the optimised runtime GLB, never the source');
  assert.deepEqual(chair.lods.map((l) => l.key.split('/').pop()), ['chair.glb', 'chair.lod1.glb']);
  const events = w.events.filter((e) => e.hma === byId(w, 'chair').homatch_asset_id).map((e) => e.ev);
  assert.deepEqual(events, ['CLAIMED', 'READY']);
});

test('idempotent: importing again uploads nothing and keeps every id', async () => {
  const w = world(fakeAdapter());
  await discover(w.io, 'fakeprov');
  w.queue('wood');
  await work(w.io, { budgetMs: 60000, concurrency: 1 });
  const putsBefore = w.puts; const keys = [...w.r2.keys()].sort(); const rows = w.tables.ds_catalog_materials.size;
  w.queue('wood');
  await work(w.io, { budgetMs: 60000, concurrency: 1 });
  assert.equal(w.puts, putsBefore, 'identical objects are never re-uploaded');
  assert.deepEqual([...w.r2.keys()].sort(), keys);
  assert.equal(w.tables.ds_catalog_materials.size, rows);
  assert.equal(byId(w, 'wood').files_skipped, keys.length);
  assert.ok(w.events.some((e) => e.ev === 'SKIPPED_IDENTICAL'));
});

test('resumable: an interruption mid-upload retries, and only the rest is uploaded', async () => {
  let fail = true;
  const w = world(fakeAdapter(), { put: (_o, n) => fail && n === 2 });
  await discover(w.io, 'fakeprov');
  w.queue('wood');
  const first = await work(w.io, { budgetMs: 60000, concurrency: 1 });
  // The first attempt failed after two objects; the retry (same run) finishes it.
  assert.equal(first.READY, 0);
  assert.ok(first.RETRY >= 1);
  fail = false;
  const before = w.puts;
  w.queue('wood');
  byId(w, 'wood').attempts = 1;
  await work(w.io, { budgetMs: 60000, concurrency: 1 });
  assert.equal(byId(w, 'wood').state, 'READY');
  assert.equal(w.puts - before, w.r2.size - 2, 'the two objects that landed were not uploaded again');
});

test('bounded retry: a permanent failure ends FAILED with its stage, error and every attempt audited — and scrubbed', async () => {
  const w = world(fakeAdapter(), { download: () => true });
  await discover(w.io, 'fakeprov');
  w.queue('wood');
  await work(w.io, { budgetMs: 60000, concurrency: 1 });
  const r = byId(w, 'wood');
  assert.equal(r.state, 'FAILED');
  assert.equal(r.attempts, 3);
  assert.equal(r.last_error_stage, 'DOWNLOADING');
  assert.doesNotMatch(r.last_error, /sig=SECRET/, 'a signed URL never reaches the database');
  assert.deepEqual(w.events.filter((e) => e.hma === r.homatch_asset_id && /RETRY|FAILED/.test(e.ev)).map((e) => e.ev), ['RETRY', 'RETRY', 'FAILED']);
});

test('validation: a model that references a missing file never becomes READY; the others do', async () => {
  const w = world(fakeAdapter());
  await discover(w.io, 'fakeprov');
  w.queue('broken', 'chair');
  const tally = await work(w.io, { budgetMs: 60000, concurrency: 2 });
  assert.equal(byId(w, 'chair').state, 'READY', 'one broken asset never stops the rest');
  assert.equal(byId(w, 'broken').state, 'FAILED');
  assert.match(byId(w, 'broken').last_error, /missing\.bin/);
  assert.equal(byId(w, 'broken').last_error_stage, 'VALIDATING');
  assert.ok(tally.FAILED >= 1);
});

test('delivery boundary: a licence without redistribution is never stored public', async () => {
  const bundle = fakeAdapter({ chair: SIGNED_IN });
  const w = world(bundle);
  await discover(w.io, 'fakeprov');
  w.queue('chair');
  await work(w.io, { budgetMs: 60000, concurrency: 1 });
  const keys = [...w.r2.keys()];
  assert.ok(keys.length > 0);
  assert.ok(keys.every((k) => !k.startsWith('design-studio/catalog/public/')), keys.join('\n'));
  assert.ok(keys.some((k) => k.startsWith('design-studio/catalog/licensed/')));
  assert.ok(keys.some((k) => k.startsWith('design-studio/catalog/restricted/metadata/')));
  assert.ok([...w.tables.storage_objects.values()].every((l) => l.visibility !== 'PUBLIC'));
});

test('an unknown licence met at import time is EXCLUDED, never downloaded', async () => {
  const w = world(fakeAdapter());
  await discover(w.io, 'fakeprov');
  byId(w, 'nolicence').state = 'QUEUED';
  const before = w.downloads;
  await work(w.io, { budgetMs: 60000, concurrency: 1 });
  assert.equal(byId(w, 'nolicence').state, 'EXCLUDED');
  assert.equal(w.downloads, before);
});

test('scrub keeps the host and drops the capability', () => {
  assert.equal(scrub('GET https://bucket.r2.example/key?X-Amz-Signature=abc failed'), 'GET https://bucket.r2.example/… failed');
});

test('runtime policy: an oversized or unoptimised model is FAILED at once — never READY, never uploaded, not retried', async () => {
  for (const [label, result] of [
    ['4K textures', { state: 'DONE', files: [], runtime: { main: { file: 'x.glb', bytes: 5e6, textureBytes: 4e6, maxTextureEdge: 4096, textures: 3, compressed: true }, lod1: null } }],
    ['too heavy', { state: 'DONE', files: [], runtime: { main: { file: 'x.glb', bytes: 47e6, textureBytes: 40e6, maxTextureEdge: 2048, textures: 3, compressed: true }, lod1: null } }],
    ['LOD1 too heavy', { state: 'DONE', files: [], runtime: { main: { file: 'x.glb', bytes: 5e6, textureBytes: 1e6, maxTextureEdge: 2048, textures: 1, compressed: true }, lod1: { file: 'l.glb', bytes: 9e6, textureBytes: 1e6, maxTextureEdge: 1024, textures: 1, compressed: true } } }],
    ['tools unavailable', { state: 'SKIPPED', note: 'gltf-transform unavailable', files: [] }],
  ]) {
    const w = world(fakeAdapter(), { optimize: () => result });
    await discover(w.io, 'fakeprov');
    w.queue('chair');
    const tally = await work(w.io, { budgetMs: 60000, concurrency: 1 });
    assert.deepEqual(tally, { READY: 0, RETRY: 0, FAILED: 1, EXCLUDED: 0 }, label);
    const r = byId(w, 'chair');
    assert.equal(r.state, 'FAILED', label);
    assert.equal(r.attempts, 1, `${label}: a policy refusal is final, not retried`);
    assert.match(r.last_error, /runtime policy/, label);
    assert.equal(r.last_error_stage, "OPTIMIZING", label);
    assert.equal(w.r2.size, 0, `${label}: nothing stored`);
    assert.ok(!w.tables.ds_catalog_assets, `${label}: never indexed`);
  }
});
