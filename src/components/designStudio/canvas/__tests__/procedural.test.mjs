// Concept blocks carry real living parts: every declared interaction has a
// part to move, every declaration is valid, and the catalogue's own
// capabilities permit what each piece declares — so nothing a visitor is
// offered silently fails, and nothing moves that was not declared.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProcedural, slotColors } from '../procedural.ts';
import { compileMachine, permittedInteractions, validateInteractions } from '../../../../lib/designStudio/interactions.ts';
import { seedAssets } from '../../../../lib/designStudio/__tests__/seedCatalog.mjs';

const asset = (kind, w, d, h, extra = {}) => ({
  id: kind, code: kind, name: kind, category: kind, subcategory: null, roomKinds: [], styleTags: [], colorTags: [], materialTags: [],
  widthM: w, depthM: d, heightM: h, placement: 'FLOOR', anchor: 'WALL', clearanceM: 0, procedural: { kind }, modelKey: null, lods: [],
  triangles: null, textureBytes: null, thumbnailKey: null, materialSlots: [], variants: [], dominantColors: [], provenance: 'HOMATCH_DEV_PLACEHOLDER',
  isPlaceholder: true, active: true, capabilities: [], interactions: [], ...extra,
});

const parts = (kind, w, d, h, extra) => {
  const g = buildProcedural(kind, asset(kind, w, d, h, extra), {});
  const declared = g.userData.interactions;
  const specs = validateInteractions(declared);
  return { g, specs, declared };
};

/** Every part a spec moves or lights exists in the built piece. */
function assertPartsExist(g, specs, label) {
  for (const s of specs) {
    if (s.kind === 'SEAT') continue;
    const m = compileMachine(s);
    assert.ok(m, `${label}: ${s.id} compiles`);
    for (const p of m.parts) assert.ok(g.getObjectByName(`ix:${p}`), `${label}: ${s.id} has no part ix:${p}`);
  }
}

test('a wardrobe has hinged doors that swing outward', () => {
  const { g, specs } = parts('WARDROBE', 1.2, 0.6, 2.2);
  assert.deepEqual(specs.map((s) => [s.id, s.kind, s.role]), [['door-1', 'HINGED', 'WARDROBE'], ['door-2', 'HINGED', 'WARDROBE']]);
  assertPartsExist(g, specs, 'wardrobe');
  assert.ok(specs[0].open > 0 && specs[1].open < 0, 'the pair opens away from each other');
});

test('a chest of drawers has drawers that slide toward the front', () => {
  const { g, specs } = parts('DRESSER', 1.2, 0.5, 0.8);
  assert.ok(specs.length >= 2 && specs.every((s) => s.kind === 'SLIDING' && s.axis === 'z' && s.open < 0));
  assertPartsExist(g, specs, 'dresser');
});

test('a refrigerator has a fridge door and a freezer door', () => {
  const fridge = parts('FRIDGE', 0.6, 0.65, 1.85);
  assert.deepEqual(fridge.specs.map((s) => [s.id, s.role]), [['door', 'APPLIANCE'], ['freezer', 'FREEZER']]);
  assertPartsExist(fridge.g, fridge.specs, 'fridge');
});

test('a kitchen run is a working kitchen: cupboards, oven, dishwasher, hob, tap, cooking and coffee', () => {
  const run = parts('KITCHEN_RUN', 3.0, 0.62, 0.9, { subcategory: 'RUN' });
  const roles = run.specs.map((s) => s.role);
  for (const r of ['CABINET', 'OVEN', 'DISHWASHER', 'STOVE', 'FAUCET', 'COFFEE']) assert.ok(roles.includes(r), r);
  assertPartsExist(run.g, run.specs, 'kitchen');
  const coffee = run.specs.find((s) => s.role === 'COFFEE');
  assert.deepEqual(coffee.transitions.map((t) => t.action), ['MAKE_COFFEE', 'DRINK']);
  // An island is cupboards only: one coffee machine per kitchen, on the run.
  const island = parts('KITCHEN_RUN', 1.8, 0.9, 0.9, { subcategory: 'ISLAND' });
  assert.ok(island.specs.every((s) => s.role === 'CABINET'));
});

test('seats: sofas seat several, a bed sits and lies, a stool sits high', () => {
  const sofa = parts('SOFA', 2.2, 0.95, 0.82).specs.find((s) => s.kind === 'SEAT');
  assert.equal(sofa.seats.length, 3);
  const bed = parts('BED', 1.6, 2.05, 0.95).specs;
  assert.deepEqual(bed.find((s) => s.kind === 'SEAT').seats.map((x) => x.posture), ['SIT', 'LIE']);
  assert.deepEqual(bed.find((s) => s.kind === 'STATES').transitions.map((t) => t.action), ['MESS_BED', 'MAKE_BED']);
  const stool = parts('STOOL', 0.4, 0.4, 0.75).specs.find((s) => s.kind === 'SEAT');
  assert.ok(stool.seats[0].y > 1.3);
});

test('bathroom pieces: a shower runs, a toilet flushes and its lid lifts, a bath fills and drains', () => {
  const shower = parts('SHOWER', 0.9, 0.9, 2.0);
  assert.ok(shower.specs.some((s) => s.kind === 'SWITCH' && s.effects.some((e) => e.type === 'WATER')));
  assertPartsExist(shower.g, shower.specs, 'shower');
  const toilet = parts('TOILET', 0.38, 0.62, 0.8);
  const flush = toilet.specs.find((s) => s.id === 'flush');
  assert.equal(flush.autoOffMs, 2200, 'a flush switches itself off');
  assert.equal(flush.actions.on, 'FLUSH');
  assertPartsExist(toilet.g, toilet.specs, 'toilet');
  const bath = parts('BATH', 1.7, 0.75, 0.58);
  assert.deepEqual(bath.specs[0].transitions.map((t) => t.action), ['RUN_BATH', 'DRAIN']);
  assertPartsExist(bath.g, bath.specs, 'bath');
});

test('light, screen and textiles: a lamp lights, a TV shows a picture, curtains draw, a blind lowers', () => {
  const lamp = parts('LAMP', 0.4, 0.4, 1.6).specs[0];
  assert.equal(lamp.effects[0].type, 'LIGHT');
  const tv = parts('TV_UNIT', 1.6, 0.4, 0.5);
  assert.equal(tv.specs[0].effects[0].type, 'SCREEN');
  assertPartsExist(tv.g, tv.specs, 'tv');
  const curtains = parts('CURTAIN', 1.8, 0.14, 2.5);
  assert.equal(curtains.specs[0].initial, 'OPEN');
  assertPartsExist(curtains.g, curtains.specs, 'curtains');
  const blind = parts('BLIND', 1.2, 0.1, 2.2);
  assert.deepEqual(blind.specs[0].transitions.map((t) => t.action), ['LOWER', 'RAISE']);
});

test('pieces without living parts declare none', () => {
  for (const kind of ['TABLE', 'ROUND_TABLE', 'RUG', 'SHELF', 'PLANT']) assert.deepEqual(parts(kind, 1, 1, 1).specs, [], kind);
});

test('nothing a concept block declares is dropped by validation', () => {
  for (const a of seedAssets()) {
    const g = buildProcedural(a.procedural.kind, a, slotColors(a, null, null));
    const declared = g.userData.interactions;
    assert.equal(validateInteractions(declared).length, declared.length, `${a.code}: an invalid declaration`);
  }
});

test('the catalogue permits everything its concept blocks can do (and nothing is offered that would not run)', () => {
  for (const a of seedAssets()) {
    const g = buildProcedural(a.procedural.kind, a, slotColors(a, null, null));
    const specs = validateInteractions(g.userData.interactions);
    const permitted = permittedInteractions(specs, a.capabilities);
    assert.deepEqual(permitted.map((s) => s.id), specs.map((s) => s.id), `${a.code} declares more than its capabilities permit`);
    assertPartsExist(g, specs, a.code);
  }
});
