// Versions compare as decisions, and a copy is a real copy.

import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyDesignState } from '../designState.ts';
import { copyState, diffDesigns, isEmptyDiff, uniqueVersionName } from '../versioning.ts';

const obj = (id, over = {}) => ({
  instanceId: id, assetId: 'dev/sofa-3', roomId: 'r', position: { x: 1, y: 0, z: 1 }, rotationY: 0,
  materialVariant: null, colorOverride: null, locked: false, ...over,
});

test('identical states have an empty diff', () => {
  const s = emptyDesignState();
  assert.equal(isEmptyDiff(diffDesigns(s, copyState(s))), true);
});

test('added, removed, replaced, moved and restyled pieces are counted separately', () => {
  const a = { ...emptyDesignState(), objects: [obj('keep'), obj('gone'), obj('swap'), obj('move'), obj('paint')] };
  const b = {
    ...emptyDesignState(),
    objects: [
      obj('keep'), obj('swap', { assetId: 'dev/sofa-2' }), obj('move', { position: { x: 2, y: 0, z: 1 } }),
      obj('paint', { colorOverride: '#000000' }), obj('new'),
    ],
  };
  assert.deepEqual(
    (({ objectsAdded, objectsRemoved, objectsReplaced, objectsMoved, objectsRestyled }) =>
      ({ objectsAdded, objectsRemoved, objectsReplaced, objectsMoved, objectsRestyled }))(diffDesigns(a, b)),
    { objectsAdded: 1, objectsRemoved: 1, objectsReplaced: 1, objectsMoved: 1, objectsRestyled: 1 },
  );
});

test('surface, lighting, palette and style changes are detected', () => {
  const a = emptyDesignState();
  const b = {
    ...emptyDesignState(),
    surfaces: { 'floor:r': { materialId: 'm', color: null, finish: null, locked: false } },
    lighting: { ...a.lighting, timeOfDay: 'EVENING' },
    palette: ['#ffffff'],
    styleCode: 'japandi',
  };
  const d = diffDesigns(a, b);
  assert.equal(d.surfacesChanged, 1);
  assert.equal(d.lightingChanged, true);
  assert.equal(d.paletteChanged, true);
  assert.equal(d.styleChanged, true);
});

test('a copy shares nothing with its original', () => {
  const a = { ...emptyDesignState(), objects: [obj('x')] };
  const b = copyState(a);
  b.objects[0].position.x = 99;
  assert.equal(a.objects[0].position.x, 1);
});

test('version names never collide', () => {
  assert.equal(uniqueVersionName('Warm Minimal', ['Original']), 'Warm Minimal');
  assert.equal(uniqueVersionName('Warm Minimal', ['warm minimal', 'Warm Minimal 2']), 'Warm Minimal 3');
});
