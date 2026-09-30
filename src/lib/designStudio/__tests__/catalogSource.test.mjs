// The catalogue core: one identity for every provider, licences that decide
// delivery, keys that carry the delivery class, names people can read,
// colour you can compare, and a glTF measured from its own data.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as C from '../catalogSource.ts';

test('identity: provider + kind + source id, deterministic; nothing else changes it', async () => {
  const a = await C.homatchAssetId('blendkit', 'MODEL', 'aa39fb43-b2b9-44cc-8f86-a57afdf502e4');
  assert.match(a, C.HMA);
  assert.equal(a, await C.homatchAssetId('blendkit', 'MODEL', 'aa39fb43-b2b9-44cc-8f86-a57afdf502e4'));
  assert.notEqual(a, await C.homatchAssetId('polyhaven', 'MODEL', 'aa39fb43-b2b9-44cc-8f86-a57afdf502e4'), 'provider isolation: same source id, other provider');
  assert.notEqual(a, await C.homatchAssetId('blendkit', 'MATERIAL', 'aa39fb43-b2b9-44cc-8f86-a57afdf502e4'), 'the kind is part of identity');
  assert.notEqual(await C.homatchAssetId('polyhaven', 'MATERIAL', 'Brick_01'), await C.homatchAssetId('polyhaven', 'MATERIAL', 'brick_01'), 'provider ids are case-sensitive');
  // Pinned: changing the scheme would re-identify every imported asset.
  assert.equal(await C.homatchAssetId('polyhaven', 'MATERIAL', 'rough_concrete'), await C.homatchAssetId('polyhaven', 'MATERIAL', 'rough_concrete'));
  await assert.rejects(() => C.homatchAssetId('Poly Haven!', 'MATERIAL', 'x'), 'a provider id is a code, not a display name');
});

test('versions: new provider files or a new policy are a new version; the same are the same', async () => {
  const a = await C.homatchAssetId('polyhaven', 'MATERIAL', 'rough_concrete');
  const v = await C.versionId(a, 'hash-1', 'policy-1');
  assert.match(v, C.HMV);
  assert.equal(v, await C.versionId(a, 'hash-1', 'policy-1'));
  assert.notEqual(v, await C.versionId(a, 'hash-2', 'policy-1'));
  assert.notEqual(v, await C.versionId(a, 'hash-1', 'policy-2'));
  await assert.rejects(() => C.versionId(a, '', 'p'));
  assert.match(await C.rowUuid(a), /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('licences: only what is positively recognised; UNKNOWN never enters; "free" is not CC0', () => {
  assert.equal(C.classifyLicense('cc_zero'), 'CC0');
  assert.equal(C.classifyLicense('CC0'), 'CC0');
  assert.equal(C.classifyLicense('royalty_free'), 'ROYALTY_FREE');
  for (const x of ['free', 'Free for commercial use', '', null, 'cc_by', 'editorial']) assert.equal(C.classifyLicense(x), 'UNKNOWN', String(x));
  assert.match(C.licenseRefusal({ licenseClass: 'UNKNOWN', providerLicense: 'free', url: null, redistribution: false, runtimeDelivery: 'PUBLIC', attributionRequired: false, credit: null }), /unknown/);
  assert.match(C.licenseRefusal(null), /unknown/);
  assert.match(C.licenseRefusal({ licenseClass: 'ROYALTY_FREE', providerLicense: 'royalty_free', url: null, redistribution: false, runtimeDelivery: 'NONE', attributionRequired: false, credit: null }), /does not permit runtime delivery/);
});

test('delivery: a restricted source can never be public; derivatives follow the licence', () => {
  const cc0 = { licenseClass: 'CC0', providerLicense: 'cc_zero', url: null, redistribution: true, runtimeDelivery: 'PUBLIC', attributionRequired: false, credit: null };
  const signedIn = { licenseClass: 'ROYALTY_FREE', providerLicense: 'royalty_free', url: null, redistribution: false, runtimeDelivery: 'SIGNED_IN', attributionRequired: false, credit: null };
  assert.equal(C.deliveryFor(cc0, 'SOURCE'), 'public');
  assert.equal(C.deliveryFor(cc0, 'RUNTIME'), 'public');
  assert.equal(C.deliveryFor(signedIn, 'SOURCE'), 'restricted', 'no redistribution: the source package stays private');
  assert.equal(C.deliveryFor(signedIn, 'RUNTIME'), 'licensed');
  assert.equal(C.deliveryFor(signedIn, 'METADATA'), 'restricted');
});

test('keys: the delivery class is in the key; the route and storage rules carry the same pattern', async () => {
  const a = await C.homatchAssetId('polyhaven', 'MATERIAL', 'rough_concrete');
  const v = await C.versionId(a, 'h', 'p');
  const pub = C.objectKey('MATERIAL', a, v, { role: 'BASE_COLOR', relPath: 'textures/rough_concrete_diff_1k.jpg', delivery: 'public' });
  assert.equal(pub, `design-studio/catalog/public/materials/${a}/${v}/textures/rough_concrete_diff_1k.jpg`);
  const src = C.objectKey('MODEL', a, v, { role: 'SOURCE_PACKAGE', relPath: 'x.blend', delivery: 'restricted' });
  assert.ok(src.startsWith('design-studio/catalog/restricted/models/'));
  assert.equal(C.objectKey('MODEL', a, v, { role: 'THUMBNAIL', relPath: 'thumbnail.webp', delivery: 'public' }).split('/')[3], 'thumbnails');
  for (const k of [pub, src]) assert.match(k, C.CATALOG_KEY);
  for (const bad of ['design-studio/catalog/models/x', `design-studio/catalog/open/materials/${a}/${v}/a.jpg`, `design-studio/catalog/public/materials/${a}/${v}/../a.jpg`]) {
    assert.doesNotMatch(bad, C.CATALOG_KEY, bad);
  }
  const route = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/design-studio-model/catalog.ts'), 'utf8');
  assert.ok(route.includes(`export const CATALOG_KEY = ${C.CATALOG_KEY.toString()};`), 'route pattern equals the core');
  const keys = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/_shared/storage/keys.ts'), 'utf8');
  assert.ok(keys.includes(C.CATALOG_KEY.toString().replace('^design-studio\\/', '^')), 'storage rules pattern equals the core');
});

test('names: readable, unique across the WHOLE catalogue, stable', () => {
  assert.equal(C.cleanSourceName('painted_plaster_wall_02'), 'Painted Plaster Wall');
  assert.equal(C.cleanSourceName('Aristea Wreck (Pure Sky)'), 'Aristea Wreck');
  assert.equal(C.cleanSourceName('Arm Chair 01'), 'Armchair');
  const items = [
    { assetId: 'hma_b', kind: 'MATERIAL', displayName: 'Floor Tiles', qualifiers: ['Worn'] },
    { assetId: 'hma_a', kind: 'MATERIAL', displayName: 'Floor Tiles', qualifiers: ['Marble'] },
    { assetId: 'hma_c', kind: 'MATERIAL', displayName: 'Floor Tiles', qualifiers: [] },
    { assetId: 'hma_d', kind: 'MODEL', displayName: 'Floor Tiles' },
  ];
  const u = C.uniqueNames(items);
  assert.deepEqual([u.get('hma_a'), u.get('hma_b'), u.get('hma_c'), u.get('hma_d')], ['Marble Floor Tiles', 'Worn Floor Tiles', 'Floor Tiles', 'Floor Tiles']);
  assert.deepEqual(C.uniqueNames([...items].reverse()), u, 'input order does not change names');
  // Another provider already holds "Modern Sofa": this provider's one is qualified, not duplicated.
  const r = C.uniqueNames([{ assetId: 'hma_x', kind: 'MODEL', displayName: 'Modern Sofa', qualifiers: ['Beige'] }], [{ kind: 'MODEL', name: 'Modern Sofa' }]);
  assert.equal(r.get('hma_x'), 'Beige Modern Sofa');
  assert.equal(C.environmentName('SUNSET', 'SKY', 'Belfast Sunset'), 'Golden Hour Sky HDRI — Belfast Sunset');
});

test('colour: families from words and from measured colour, comparable in Lab', () => {
  assert.equal(C.colorFamily('cream'), 'CREAM');
  assert.equal(C.colorFamily('walnut'), 'WOOD_DARK');
  assert.equal(C.colorFamily('#ffffff'), 'WHITE');
  assert.equal(C.colorFamily('#111111'), 'BLACK');
  assert.equal(C.colorFamily('#808080'), 'GRAY');
  assert.equal(C.colorFamily('#1f4fbf'), 'BLUE');
  assert.equal(C.colorFamily('#2e8b3a'), 'GREEN');
  assert.equal(C.colorFamily('#6b4423'), 'BROWN');
  assert.equal(C.colorFamily('#d9c7a7'), 'BEIGE');
  assert.equal(C.colorFamily('not a colour'), null);
  const lab = (h) => C.rgbToLab(C.hexToRgb(h));
  assert.ok(C.deltaE(lab('#f3ead8'), lab('#efe4cf')) < C.deltaE(lab('#f3ead8'), lab('#222222')), 'cream is nearer cream than black');
});

test('material metadata: exact physical repeat, 1K mobile / 2K desktop variants of ONE asset, editor controls', () => {
  const pbr = C.materialPbr([1230.0000190734863, 1230], { '1k': { albedo: 'a', normal: 'n', orm: 'o' }, '2k': { albedo: 'A', normal: 'N', orm: 'O' } });
  assert.deepEqual(pbr.maps, { albedo: 'a', normal: 'n', roughness: 'o' });
  assert.deepEqual(pbr.variants, { mobile: '1k', desktop: '2k' });
  assert.deepEqual(pbr.physicalSizeM, [1.23, 1.23]);
  assert.deepEqual(Object.keys(pbr.controls).sort(), ['metalnessFactor', 'normalScale', 'repeatM', 'rotationDeg', 'roughnessFactor', 'scale']);
  assert.equal(pbr.normalConvention, 'OpenGL (Y+)');
  assert.equal(C.materialPbr(null, { '1k': {} }).variants.desktop, '1k', 'no 2K: desktop uses 1K');
});

test('placement: mount, anchor, rooms and what the walkthrough may do', () => {
  const sofa = C.modelPlacement({ canonicalCategory: 'OBJECT.FURNITURE', canonicalSubcategory: 'SOFA' }, [2.4, 0.8, 0.95]);
  assert.equal(sofa.placement, 'FLOOR'); assert.equal(sofa.anchor, 'WALL'); assert.ok(sofa.capabilities.includes('SITTABLE')); assert.deepEqual(sofa.roomKinds, ['LIVING']);
  const pendant = C.modelPlacement({ canonicalCategory: 'OBJECT.LIGHTING', canonicalSubcategory: 'PENDANT' }, [0.4, 0.6, 0.4]);
  assert.equal(pendant.placement, 'CEILING'); assert.ok(pendant.capabilities.includes('SWITCHABLE'));
  const fridge = C.modelPlacement({ canonicalCategory: 'OBJECT.APPLIANCE', canonicalSubcategory: 'REFRIGERATOR' }, [0.7, 1.9, 0.7]);
  assert.ok(fridge.capabilities.includes('OPENABLE')); assert.deepEqual(fridge.roomKinds, ['KITCHEN']);
  assert.deepEqual(C.modelPlacement({ canonicalCategory: 'OBJECT.BATHROOM', canonicalSubcategory: 'TOILET' }, [0.4, 0.8, 0.7]).roomKinds, ['BATHROOM', 'WC']);
});

test('a glTF is measured from its own data: triangles, bounds through the node tree, references', () => {
  const g = C.inspectGltf({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ children: [1], scale: [2, 2, 2] }, { mesh: 0, translation: [0, 0.5, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [{ count: 8, min: [-0.5, -0.5, -0.25], max: [0.5, 0.5, 0.25] }, { count: 36 }],
    buffers: [{ uri: 'chair.bin' }], images: [{ uri: 'textures/chair_diff_1k.jpg' }], materials: [{}], textures: [{}],
  });
  assert.equal(g.triangles, 12);
  assert.deepEqual(g.sizeM, [2, 2, 1]);
  assert.deepEqual(g.bbox.min, [-1, 0, -0.5]);
  assert.deepEqual(g.uris, ['chair.bin', 'textures/chair_diff_1k.jpg']);
  assert.deepEqual(g.problems, []);
  assert.ok(C.inspectGltf({ asset: { version: '2.0' }, buffers: [{ uri: '../../etc/passwd' }] }).problems.some((p) => /unsafe/.test(p)));
  assert.ok(C.inspectGltf({ asset: { version: '1.0' } }).problems.includes('not glTF 2.0'));
});

test('magic bytes: a file is what its role says', () => {
  const t = (s) => new TextEncoder().encode(s);
  assert.ok(C.looksLike('HDRI', t('#?RADIANCE\nFORMAT')));
  assert.ok(!C.looksLike('HDRI', t('<html>')));
  assert.ok(C.looksLike('BASE_COLOR', new Uint8Array([0xff, 0xd8, 0xff])));
  assert.ok(!C.looksLike('NORMAL', t('<html>')));
  assert.ok(C.looksLike('GLB', t('glTF\x02\x00\x00\x00')));
  assert.ok(!C.looksLike('GLB', t('{"asset":')));
  assert.ok(C.looksLike('SOURCE_PACKAGE', t('BLENDER-v300')));
});
