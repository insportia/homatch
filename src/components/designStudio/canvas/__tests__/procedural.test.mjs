// Concept blocks carry real moving parts: every declared interaction has a
// part to move, and nothing moves that was not declared.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProcedural } from '../procedural.ts';
import { validateInteractions } from '../../../../lib/designStudio/interactions.ts';

const asset = (kind, w, d, h) => ({
  id: kind, code: kind, name: kind, category: kind, subcategory: null, roomKinds: [], styleTags: [], colorTags: [], materialTags: [],
  widthM: w, depthM: d, heightM: h, placement: 'FLOOR', anchor: 'WALL', clearanceM: 0, procedural: { kind }, modelKey: null, lods: [],
  triangles: null, textureBytes: null, thumbnailKey: null, materialSlots: [], variants: [], dominantColors: [], provenance: 'HOMATCH_DEV_PLACEHOLDER',
  isPlaceholder: true, active: true, capabilities: [], interactions: [],
});

const parts = (kind, w, d, h) => {
  const g = buildProcedural(kind, asset(kind, w, d, h), {});
  const specs = validateInteractions(g.userData.interactions);
  return { g, specs };
};

test('a wardrobe has hinged doors that swing outward', () => {
  const { g, specs } = parts('WARDROBE', 1.2, 0.6, 2.2);
  assert.deepEqual(specs.map((s) => [s.id, s.kind, s.role]), [['door-1', 'HINGED', 'WARDROBE'], ['door-2', 'HINGED', 'WARDROBE']]);
  for (const s of specs) assert.ok(g.getObjectByName(`ix:${s.id}`), `${s.id} has no part`);
  assert.ok(specs[0].open > 0 && specs[1].open < 0, 'the pair opens away from each other');
});

test('a chest of drawers has drawers that slide toward the front', () => {
  const { g, specs } = parts('DRESSER', 1.2, 0.5, 0.8);
  assert.ok(specs.length >= 2 && specs.every((s) => s.kind === 'SLIDING' && s.axis === 'z' && s.open < 0));
  for (const s of specs) assert.ok(g.getObjectByName(`ix:${s.id}`));
});

test('a refrigerator has one appliance door; a kitchen run has cabinet doors', () => {
  const fridge = parts('FRIDGE', 0.6, 0.65, 1.85);
  assert.deepEqual(fridge.specs.map((s) => [s.id, s.role]), [['door', 'APPLIANCE']]);
  assert.ok(fridge.g.getObjectByName('ix:door'));
  const run = parts('KITCHEN_RUN', 2.4, 0.62, 0.9);
  assert.equal(run.specs.length, 4);
  assert.ok(run.specs.every((s) => s.role === 'CABINET'));
});

test('pieces without moving parts declare none', () => {
  for (const kind of ['SOFA', 'TABLE', 'BED', 'RUG', 'LAMP']) assert.deepEqual(parts(kind, 1, 1, 1).specs, [], kind);
});
