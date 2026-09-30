// AI proposals become operations through HOMATCH's own engine: placed by
// autoPlace, validated one by one, deterministic, undoable as one step.

import test from 'node:test';
import assert from 'node:assert/strict';
import { planToOperations } from '../aiPlan.ts';
import { critique, STYLE_CODES } from '../grammar.ts';
import { applyTransaction, applyUnchecked, validateOperation } from '../operations.ts';
import { emptyDesignState } from '../designState.ts';
import { buildSpaceModel, floorSurfaceId } from '../space.ts';
import { oneBedroomScene, testAssets, testMaterials } from './fixtures.mjs';

const space = buildSpaceModel(oneBedroomScene());
const assets = testAssets();
const materialsById = testMaterials();
const materials = [...materialsById.values()];
const ctx = { space, assets, materials: materialsById };

const alt = (rooms, over = {}) => ({
  title: 'Calm', rationale: '', styleCode: 'scandinavian', palette: [], lighting: null, rooms, ...over,
});
const room = (roomId, over = {}) => ({ roomId, wallColor: null, wallMaterial: null, floorMaterial: null, clearFurniture: false, furniture: [], ...over });
const convert = (a, state = emptyDesignState()) => planToOperations(a, { state, space, ctx, assets, materials, idPrefix: 'ai-t' });

test('furniture is placed by the engine, inside the room, never through a wall', () => {
  const p = convert(alt([room('r-living', { furniture: ['dev/sofa-3', 'dev/coffee-table', 'dev/rug-large'] })]));
  assert.equal(p.summary.added, 3);
  assert.deepEqual(p.skipped, []);
  for (const o of p.state.objects) {
    assert.equal(o.roomId, 'r-living');
    assert.ok(o.position.x > 0 && o.position.x < 6 && o.position.z > 0 && o.position.z < 7, JSON.stringify(o.position));
  }
  // The same plan on the same design is the same result.
  assert.deepEqual(convert(alt([room('r-living', { furniture: ['dev/sofa-3', 'dev/coffee-table', 'dev/rug-large'] })])).ops, p.ops);
});

test('walls and floors are dressed room by room', () => {
  const p = convert(alt([room('r-bed', { wallColor: '#b6bfa7', floorMaterial: 'm-oak' })]));
  const bedWalls = Object.keys(p.state.surfaces).filter((id) => id.startsWith('wall:') && id.endsWith(':r-bed'));
  assert.ok(bedWalls.length >= 4);
  assert.ok(bedWalls.every((id) => p.state.surfaces[id].color === '#b6bfa7'));
  assert.equal(p.state.surfaces[floorSurfaceId('r-bed')].materialId, 'm-oak');
  assert.equal(p.summary.rooms, 1);
});

test('what does not fit is reported, not forced', () => {
  // The bathroom (6 m², 2 × 3 m) cannot take a 3.4 m sofa.
  const p = convert(alt([room('r-bath', { furniture: ['dev/sofa-xl'] })]));
  assert.equal(p.summary.added, 0);
  assert.deepEqual(p.skipped.map((s) => [s.code, s.reason]), [['dev/sofa-xl', 'NO_SPACE']]);
});

test('unknown codes and inactive pieces are skipped with a reason', () => {
  const p = convert(alt([room('r-living', { furniture: ['acme/sofa', 'dev/retired'], floorMaterial: 'no-such' })]));
  assert.deepEqual(p.skipped.map((s) => s.reason).sort(), ['INACTIVE_ASSET', 'UNKNOWN_ASSET', 'UNKNOWN_MATERIAL']);
});

test('kept pieces and kept categories survive the proposal', () => {
  const base = convert(alt([room('r-living', { furniture: ['dev/sofa-3'] })])).state;
  const kept = { ...base, objects: base.objects.map((o) => ({ ...o, locked: true })) };
  const p = convert(alt([room('r-living', { clearFurniture: true, furniture: ['dev/coffee-table'] })]), kept);
  assert.equal(p.summary.removed, 0, 'a kept sofa was removed');
  assert.ok(p.state.objects.some((o) => o.assetId === 'dev/sofa-3'));
  const wallsKept = { ...emptyDesignState(), locks: { ...emptyDesignState().locks, walls: true } };
  const q = convert(alt([room('r-bed', { wallColor: '#b6bfa7' })]), wallsKept);
  assert.equal(q.summary.surfaces, 0);
  assert.equal(q.skipped[0].reason, 'CATEGORY_LOCKED');
});

test('a proposal applies as one transaction and undoes as one step', () => {
  const start = emptyDesignState();
  const p = convert(alt([room('r-living', { wallColor: '#e2d3b9', furniture: ['dev/sofa-3', 'dev/coffee-table'] })], {
    palette: ['#f2eee6', '#e2d3b9'], lighting: { timeOfDay: 'EVENING', temperature: 'WARM', interiorIntensity: null },
  }));
  const tx = applyTransaction(start, p.ops, ctx, { id: 't', label: 'AI', origin: 'AI' });
  assert.equal(tx.ok, true);
  assert.deepEqual(tx.state, p.state);
  assert.deepEqual(applyUnchecked(tx.state, tx.transaction.inverse), start);
  for (const op of p.ops) assert.ok(op.type !== 'SET_LOCKS', 'a proposal changed what the customer keeps');
});

test('clearing a room removes its pieces before placing new ones', () => {
  const base = convert(alt([room('r-living', { furniture: ['dev/sofa-3'] })])).state;
  const p = convert(alt([room('r-living', { clearFurniture: true, furniture: ['dev/sofa-2'] })]), base);
  assert.equal(p.summary.removed, 1);
  assert.deepEqual(p.state.objects.map((o) => o.assetId), ['dev/sofa-2']);
  assert.equal(validateOperation(base, p.ops[0], ctx), null);
});

test('the grammar notes what a room is missing and when colours scatter', () => {
  const notes = critique(emptyDesignState(), space, assets);
  assert.deepEqual(notes.filter((n) => n.code === 'MISSING_ESSENTIAL').map((n) => [n.roomId, n.category]).sort(),
    [['r-bed', 'BED'], ['r-bed', 'WARDROBE'], ['r-living', 'SOFA']]);
  const furnished = convert(alt([room('r-living', { furniture: ['dev/sofa-3'] }), room('r-bed', { furniture: ['dev/bed-double', 'dev/wardrobe'] })])).state;
  assert.deepEqual(critique(furnished, space, assets).filter((n) => n.code === 'MISSING_ESSENTIAL'), []);
  const colours = ['#111111', '#222222', '#333333', '#444444', '#555555'];
  const walls = space.surfaces.filter((s) => s.kind === 'WALL').slice(0, 5);
  const painted = { ...emptyDesignState(), surfaces: Object.fromEntries(walls.map((w, i) => [w.id, { materialId: null, color: colours[i], finish: null, locked: false }])) };
  assert.deepEqual(critique(painted, space, assets, []).filter((n) => n.code === 'SCATTERED_COLORS'), [{ code: 'SCATTERED_COLORS', count: 5 }]);
});

test('style codes are the ones the server offers', () => {
  assert.deepEqual([...STYLE_CODES].sort(), ['classic', 'contemporary', 'industrial', 'japandi', 'luxury', 'mediterranean', 'scandinavian', 'warm-minimal']);
});
