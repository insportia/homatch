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
  assert.match(sc, /if \(asset && key\) this\.attachCatalogModel\(obj\.instanceId, g, asset, key\);/);
  assert.match(sc, /if \(this\.objectsById\.get\(instanceId\) !== holder\) return;/, 'a late load for a removed piece is dropped');
  assert.match(sc, /if \(o\.userData\.catalogShared\) return;/, 'shared model resources are never disposed with one instance');
  assert.match(sc, /inst\.position\.set\(-c\.x, -box\.min\.y, -c\.z\);/, 'normalised: footprint centred, lowest point on the floor');
});
