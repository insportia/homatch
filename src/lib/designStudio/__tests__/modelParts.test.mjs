// Uploaded-model parts: only what the inspector identified can be edited,
// and only in the ways that are true for a modelled-in-place part.

import test from 'node:test';
import assert from 'node:assert/strict';
import { modelParts, parsePartId, partRoles } from '../modelParts.ts';
import { applyOperation, applyUnchecked, validateOperation } from '../operations.ts';
import { emptyDesignState, normalizeDesignState } from '../designState.ts';
import { testMaterials } from './fixtures.mjs';

const analysis = (editability, roles) => ({
  kind: 'MODEL_ANALYSIS',
  editability,
  stats: { triangles: 100, meshNodes: 5, images: 0, bytes: 1000, container: 'GLB' },
  normalization: { scale: 1, units: 'm', upAxis: 'Y', sizeM: [8, 2.7, 6] },
  semantics: { counts: {}, unidentified: 0, rooms: [], roles },
  warnings: [],
});

const ROLES = { 0: 'FLOOR', 1: 'WALL', 2: 'CEILING', 3: 'FURNITURE', 4: 'DOOR' };

function ctxFor(editability = 'FULLY_STRUCTURED') {
  const parts = modelParts(analysis(editability, ROLES));
  const materials = testMaterials();
  return { space: null, assets: new Map(), materials, parts: partRoles(parts) };
}

test('parts come only from the analysis, and a VISUAL_MODEL has none', () => {
  assert.deepEqual(modelParts(analysis('FULLY_STRUCTURED', ROLES)).map((p) => [p.id, p.role]),
    [['part:0', 'FLOOR'], ['part:1', 'WALL'], ['part:2', 'CEILING'], ['part:3', 'FURNITURE'], ['part:4', 'DOOR']]);
  assert.deepEqual(modelParts(analysis('VISUAL_MODEL', ROLES)), []);
  assert.deepEqual(modelParts({ kind: 'SOMETHING_ELSE' }), []);
  assert.deepEqual(modelParts(analysis('PARTIALLY_STRUCTURED', { x: 'WALL', 7: 'ROOF', 8: 'WALL' })).map((p) => p.id), ['part:8']);
  assert.equal(parsePartId('part:12'), 12);
  assert.equal(parsePartId('part:-1'), null);
  assert.equal(parsePartId('wall:w1:L:r1'), null);
});

test('identified floors, walls and ceilings can be painted; other parts cannot', () => {
  const ctx = ctxFor();
  const s = emptyDesignState();
  assert.equal(validateOperation(s, { type: 'SET_SURFACE_COLOR', surfaceIds: ['part:1'], color: '#aabbcc' }, ctx), null);
  assert.equal(validateOperation(s, { type: 'SET_SURFACE_COLOR', surfaceIds: ['part:3'], color: '#aabbcc' }, ctx).code, 'UNKNOWN_SURFACE');
  assert.equal(validateOperation(s, { type: 'SET_SURFACE_COLOR', surfaceIds: ['part:4'], color: '#aabbcc' }, ctx).code, 'UNKNOWN_SURFACE');
  assert.equal(validateOperation(s, { type: 'SET_SURFACE_COLOR', surfaceIds: ['part:99'], color: '#aabbcc' }, ctx).code, 'UNKNOWN_SURFACE');
  const visual = ctxFor('VISUAL_MODEL');
  assert.equal(validateOperation(s, { type: 'SET_SURFACE_COLOR', surfaceIds: ['part:1'], color: '#aabbcc' }, visual).code, 'UNKNOWN_SURFACE');
});

test('a material must suit the part it is put on', () => {
  const ctx = ctxFor();
  const s = emptyDesignState();
  const floorOnly = [...testMaterials().values()].find((m) => m.appliesTo.includes('FLOOR') && !m.appliesTo.includes('WALL'));
  assert.ok(floorOnly, 'fixture has a floor-only material');
  assert.equal(validateOperation(s, { type: 'ASSIGN_MATERIAL', surfaceIds: ['part:0'], materialId: floorOnly.id }, ctx), null);
  assert.equal(validateOperation(s, { type: 'ASSIGN_MATERIAL', surfaceIds: ['part:1'], materialId: floorOnly.id }, ctx).code, 'MATERIAL_NOT_FOR_SURFACE');
});

test('kept walls and floors stay as they are on a model too', () => {
  const ctx = ctxFor();
  const s = { ...emptyDesignState(), locks: { ...emptyDesignState().locks, walls: true } };
  assert.equal(validateOperation(s, { type: 'SET_SURFACE_COLOR', surfaceIds: ['part:1'], color: '#aabbcc' }, ctx).code, 'CATEGORY_LOCKED');
  assert.equal(validateOperation(s, { type: 'SET_SURFACE_COLOR', surfaceIds: ['part:0'], color: '#aabbcc' }, ctx), null);
});

test('identified furniture can be hidden and shown, exactly undoably', () => {
  const ctx = ctxFor();
  const s0 = emptyDesignState();
  const hide = { type: 'SET_PART_HIDDEN', partId: 'part:3', hidden: true };
  assert.equal(validateOperation(s0, hide, ctx), null);
  const { state: s1, inverse } = applyOperation(s0, hide);
  assert.deepEqual(s1.hiddenParts, ['part:3']);
  assert.deepEqual(applyUnchecked(s1, inverse).hiddenParts, []);
  // Hiding twice is not two entries.
  assert.deepEqual(applyOperation(s1, hide).state.hiddenParts, ['part:3']);
});

test('walls, unknown parts and kept furniture cannot be hidden', () => {
  const ctx = ctxFor();
  const s = emptyDesignState();
  assert.equal(validateOperation(s, { type: 'SET_PART_HIDDEN', partId: 'part:1', hidden: true }, ctx).code, 'UNKNOWN_OBJECT');
  assert.equal(validateOperation(s, { type: 'SET_PART_HIDDEN', partId: 'part:42', hidden: true }, ctx).code, 'UNKNOWN_OBJECT');
  assert.equal(validateOperation(s, { type: 'SET_PART_HIDDEN', partId: 'part:3', hidden: 'yes' }, ctx).code, 'MALFORMED');
  const kept = { ...s, locks: { ...s.locks, furniture: true } };
  assert.equal(validateOperation(kept, { type: 'SET_PART_HIDDEN', partId: 'part:3', hidden: true }, ctx).code, 'CATEGORY_LOCKED');
});

test('a stored state keeps only well-formed hidden parts', () => {
  const s = normalizeDesignState({ hiddenParts: ['part:3', 'part:3', 'wall:x', 7, 'part:abc'] });
  assert.deepEqual(s.hiddenParts, ['part:3']);
  assert.deepEqual(normalizeDesignState({}).hiddenParts, []);
});
