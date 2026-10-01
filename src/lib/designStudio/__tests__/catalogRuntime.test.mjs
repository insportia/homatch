// The licensed library reaches the scene: the Asset Resolver chooses ONE
// canonical id for what the picture showed, the design stores that id, and
// it survives saving and loading unchanged. (The browser proof — the model
// visibly loaded in the Design Studio — is the canary's, on real files.)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { matchAsset, CANONICAL_FOR } from '../reconstruction.ts';
import { normalizeDesignState, emptyDesignState } from '../designState.ts';
import { OBJECT_TYPES } from '../reconstructRead.ts';

const base = {
  id: 'x', name: 'x', category: 'SOFA', subcategory: null, roomKinds: [], styleTags: [], colorTags: [], materialTags: [], placement: 'FLOOR', anchor: 'WALL',
  clearanceM: 0, procedural: null, modelKey: 'k', lods: [], triangles: 1000, textureBytes: 0, thumbnailKey: null, materialSlots: [], variants: [], dominantColors: [],
  provenance: 'LICENSED', isPlaceholder: false, active: true, capabilities: [], interactions: [],
};
const imported = (code, o) => ({ ...base, code, homatchAssetId: code, sourceProvider: 'blendkit', canonicalCategory: 'OBJECT.FURNITURE', canonicalSubcategory: 'SOFA', searchAliases: [], qualityTier: 'STANDARD', webSuitability: 0.9, colorFamilies: [], licenseClass: 'CC0', ...o });
const handMade = { ...base, code: 'dev.sofa.3seat', procedural: { kind: 'SOFA' }, isPlaceholder: true, provenance: 'HOMATCH_DEV_PLACEHOLDER', widthM: 2.2, depthM: 0.9, heightM: 0.8, category: 'SOFA' };

test('every reader object type that the library can hold maps to canonical subtypes', () => {
  for (const t of Object.keys(CANONICAL_FOR)) assert.ok(OBJECT_TYPES.includes(t), t);
  for (const t of ['SOFA', 'BED_DOUBLE', 'FRIDGE', 'BATH', 'WASHING_MACHINE', 'CURTAIN', 'WARDROBE', 'TOILET', 'RUG']) assert.ok(CANONICAL_FOR[t]?.length, t);
});

test('a picture’s sofa resolves to the closest LICENSED sofa by size, colour and style — by canonical id', () => {
  const seen = { type: 'SOFA', widthM: 2.3, depthM: 0.95, heightM: 0.85, color: '#e9dcc6', style: 'modern' };
  const cream = imported('hma_cream00000000000000000000', { widthM: 2.27, depthM: 0.94, heightM: 0.84, dominantColors: ['#ecdfc8'], styleTags: ['modern'] });
  const black = imported('hma_black00000000000000000000', { widthM: 2.3, depthM: 0.95, heightM: 0.85, dominantColors: ['#151515'], styleTags: ['modern'], qualityTier: 'PREMIUM' });
  const tiny = imported('hma_tiny000000000000000000000', { widthM: 0.9, depthM: 0.5, heightM: 0.6, dominantColors: ['#ecdfc8'], styleTags: ['modern'] });
  const m = matchAsset(seen, [handMade, black, tiny, cream], []);
  assert.equal(m.assetId, 'hma_cream00000000000000000000');
  assert.equal(m.quality, 'GOOD');
});

test('without licensed candidates of that type, the hand-made catalogue answers exactly as before', () => {
  const m = matchAsset({ type: 'SOFA', widthM: 2.2, depthM: 0.9, heightM: 0.8, color: null, style: null }, [handMade], []);
  assert.equal(m.assetId, 'dev.sofa.3seat');
  const inactive = imported('hma_off0000000000000000000000', { widthM: 2.2, depthM: 0.9, heightM: 0.8, active: false });
  assert.equal(matchAsset({ type: 'SOFA', widthM: 2.2, depthM: 0.9, heightM: 0.8, color: null, style: null }, [handMade, inactive], []).assetId, 'dev.sofa.3seat', 'an inactive import is never chosen');
});

test('the chosen canonical id survives the saved design unchanged (save → load → save)', () => {
  const state = emptyDesignState();
  state.objects.push({ instanceId: 'o1', assetId: 'hma_cream00000000000000000000', roomId: 'r-1', position: { x: 1, y: 2 }, rotationY: 0 });
  const saved = JSON.parse(JSON.stringify(state));
  const loaded = normalizeDesignState(saved);
  assert.equal(loaded.objects[0].assetId, 'hma_cream00000000000000000000');
  assert.deepEqual(normalizeDesignState(JSON.parse(JSON.stringify(loaded))).objects[0].assetId, 'hma_cream00000000000000000000');
});

test('the scene loads a catalogue model in place of its placeholder, shares it safely, and picks LOD by device', async () => {
  const { modelKeyFor } = await import('../../../components/designStudio/canvas/modelLoader.ts');
  const asset = { modelKey: 'design-studio/catalog/public/models/a/b/x.glb', lods: [{ key: 'design-studio/catalog/public/models/a/b/x.glb', level: 0 }, { key: 'design-studio/catalog/public/models/a/b/x.lod1.glb', level: 1 }] };
  assert.equal(modelKeyFor(asset, 'HIGH'), asset.modelKey, 'desktop: the full model');
  assert.equal(modelKeyFor(asset, 'LOW'), 'design-studio/catalog/public/models/a/b/x.lod1.glb', 'a LOW-quality device: the lighter level of the SAME asset');
  assert.equal(modelKeyFor({ modelKey: 'k', lods: [] }, 'LOW'), 'k', 'no LOD: the model itself');
  const sc = fs.readFileSync(path.join(process.cwd(), 'src/components/designStudio/canvas/SceneController.ts'), 'utf8');
  // The model in place of its placeholder; a piece rebuilt from a picture is scaled toward its seen size (bounded, objectShape.ts).
  assert.match(sc, /if \(asset && key\) this\.attachCatalogModel\(obj\.instanceId, g, asset, key, obj\.shape && own \? modelScale\(own, obj\.shape\) : null\);/);
  assert.match(sc, /if \(this\.objectsById\.get\(instanceId\) !== holder\) return;/, 'a late load for a removed piece is dropped');
  assert.match(sc, /if \(o\.userData\.catalogShared\) return;/, 'shared model resources are never disposed with one instance');
  assert.match(sc, /inst\.position\.set\(-c\.x, -box\.min\.y, -c\.z\);/, 'normalised: footprint centred, lowest point on the floor');
});

/** A minimal GLB whose images are the given headers (PNG or KTX2), for the runtime reader. */
function glb(images) {
  const blobs = images.map((b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]));
  let off = 0;
  const bufferViews = blobs.map((b) => { const v = { buffer: 0, byteOffset: off, byteLength: b.length }; off += b.length; return v; });
  let json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ byteLength: off }], bufferViews, images: bufferViews.map((_, i) => ({ bufferView: i, mimeType: 'image/png' })) }));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const bin = Buffer.concat(blobs);
  const head = Buffer.alloc(12); head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  const chunk = (b, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(b.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, b]); };
  return new Uint8Array(Buffer.concat([head, chunk(json, 0x4e4f534a), chunk(bin, 0x004e4942)]));
}
const png = (w, h) => { const b = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const ktx2 = (w, h) => { const b = Buffer.alloc(48); Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32LE(w, 20); b.writeUInt32LE(h, 24); return b; };

test('runtime policy reads the real texture sizes out of the GLB and refuses an over-budget model', async () => {
  const { glbRuntimeFacts, runtimeRefusal, RUNTIME_POLICY } = await import('../catalogSource.ts');
  const heavy = glbRuntimeFacts(glb([png(4096, 4096), ktx2(1024, 1024)]));
  assert.equal(heavy.maxTextureEdge, 4096);
  assert.equal(heavy.textures, 2);
  assert.equal(heavy.compressed, false, 'a PNG is not GPU-compressed');
  assert.match(runtimeRefusal(heavy, null), /4096px exceeds 2048px/);
  const main = glbRuntimeFacts(glb([ktx2(2048, 2048), ktx2(2048, 1024)]));
  const lod1 = glbRuntimeFacts(glb([ktx2(1024, 1024)]));
  assert.equal(main.compressed, true);
  assert.equal(runtimeRefusal(main, lod1), null, 'a 2K KTX2 model with a 1K LOD1 passes');
  assert.match(runtimeRefusal(main, glbRuntimeFacts(glb([ktx2(2048, 2048)]))), /LOD1 texture 2048px exceeds 1024px/);
  assert.match(runtimeRefusal({ ...main, bytes: 47_000_000 }, lod1), /exceeds 20000000/, 'the 47 MB toilet is refused as it came');
  assert.match(runtimeRefusal(main, { ...lod1, bytes: RUNTIME_POLICY.maxLod1Bytes + 1 }), /LOD1 .* bytes exceeds/);
  assert.match(runtimeRefusal(null, null), /original is never served/);
  assert.throws(() => glbRuntimeFacts(new Uint8Array(Buffer.from('not a glb at all'))), /not a GLB/);
});

test('kitchen boundary: cabinetry is HOMATCH parametric; an imported kitchen set never stands in; movable appliances do come from the catalogue', async () => {
  const { PARAMETRIC_ONLY } = await import('../reconstruction.ts');
  assert.ok(PARAMETRIC_ONLY.has('KITCHEN_RUN') && PARAMETRIC_ONLY.has('KITCHEN_ISLAND'));
  for (const t of PARAMETRIC_ONLY) assert.equal(CANONICAL_FOR[t], undefined, `${t} has no catalogue stand-in`);
  const run = { ...base, code: 'dev.kitchen.run', category: 'KITCHEN', subcategory: 'RUN', procedural: { kind: 'KITCHEN_RUN' }, isPlaceholder: true, provenance: 'HOMATCH_DEV_PLACEHOLDER', widthM: 3, depthM: 0.6, heightM: 0.9 };
  const set = imported('hma_kitchenset000000000000000', { category: 'KITCHEN', canonicalSubcategory: 'KITCHEN_SET', widthM: 3, depthM: 0.6, heightM: 0.9 });
  const m = matchAsset({ type: 'KITCHEN_RUN', widthM: 3, depthM: 0.6, heightM: 0.9, color: null, style: null }, [set, run], []);
  assert.notEqual(m?.assetId, 'hma_kitchenset000000000000000');
  assert.deepEqual(CANONICAL_FOR.FRIDGE, ['REFRIGERATOR']);
});
