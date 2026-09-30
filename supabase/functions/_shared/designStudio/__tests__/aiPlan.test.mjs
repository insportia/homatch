// The AI designer's contract: whatever the model says, only checkable,
// allowed, un-kept changes survive.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUserMessage, normalizeBrief, validatePlan } from '../aiPlan.ts';

const LOCKS = { layout: false, furniture: false, walls: false, floor: false, kitchen: false, colors: false, lighting: false };

const ctx = (locks = LOCKS) => ({
  rooms: [
    { id: 'r-living', kind: 'LIVING', areaM2: 42, label: 'Living' },
    { id: 'r-bed', kind: 'BEDROOM', areaM2: 16, label: null },
    { id: 'r-kit', kind: 'KITCHEN', areaM2: 10, label: null },
  ],
  assets: [
    { code: 'dev/sofa-3', name: 'Three-seat sofa', category: 'SOFA', subcategory: 'SOFA_3', roomKinds: ['LIVING'], styleTags: ['scandinavian'], widthM: 2.2, depthM: 0.95 },
    { code: 'dev/bed-double', name: 'Double bed', category: 'BED', subcategory: 'DOUBLE', roomKinds: ['BEDROOM'], styleTags: [], widthM: 1.6, depthM: 2.1 },
    { code: 'dev/kitchen-island', name: 'Kitchen island', category: 'KITCHEN', subcategory: 'ISLAND', roomKinds: ['KITCHEN'], styleTags: [], widthM: 1.8, depthM: 0.9 },
  ],
  materials: [
    { code: 'dev/paint-sage', name: 'Sage paint', appliesTo: ['WALL'], styleTags: [], color: '#b6bfa7' },
    { code: 'dev/floor-light-oak', name: 'Light oak', appliesTo: ['FLOOR'], styleTags: [], color: '#cdb28b' },
  ],
  locks,
  existing: { 'r-living': ['dev/sofa-3'] },
});

const brief = (over = {}) => normalizeBrief({ styleCode: 'scandinavian', text: 'calm', alternatives: 2, ...over }, new Set(['r-living', 'r-bed', 'r-kit']));

const good = {
  alternatives: [{
    title: 'Calm Nordic light', rationale: 'Soft sage walls with light oak.', styleCode: 'scandinavian',
    palette: ['#F2EEE6', '#b6bfa7', 'red'],
    lighting: { timeOfDay: 'DAY', temperature: 'WARM', interiorIntensity: 3 },
    rooms: [
      { roomId: 'r-living', wallColor: '#b6bfa7', wallMaterial: null, floorMaterial: 'dev/floor-light-oak', clearFurniture: false, furniture: ['dev/sofa-3', 'acme/luxury-sofa-999'] },
      { roomId: 'r-bed', wallColor: 'sage', wallMaterial: 'dev/floor-light-oak', floorMaterial: null, clearFurniture: false, furniture: ['dev/bed-double'] },
      { roomId: 'r-ghost', wallColor: '#ffffff', wallMaterial: null, floorMaterial: null, clearFurniture: false, furniture: [] },
    ],
  }],
};

test('only known codes, valid colours and real rooms survive', () => {
  const plan = validatePlan(good, ctx(), brief());
  assert.equal(plan.alternatives.length, 1);
  const alt = plan.alternatives[0];
  assert.deepEqual(alt.palette, ['#f2eee6', '#b6bfa7']);
  assert.deepEqual(alt.lighting, { timeOfDay: 'DAY', temperature: 'WARM', interiorIntensity: 1 });
  assert.deepEqual(alt.rooms.map((r) => r.roomId), ['r-living', 'r-bed']);
  assert.deepEqual(alt.rooms[0].furniture, ['dev/sofa-3']);
  assert.equal(alt.rooms[0].floorMaterial, 'dev/floor-light-oak');
  // A floor material on a wall, and a colour name, are both refused.
  assert.equal(alt.rooms[1].wallMaterial, null);
  assert.equal(alt.rooms[1].wallColor, null);
  assert.deepEqual(plan.dropped, { BAD_COLOR: 2, UNKNOWN_ASSET: 1, UNKNOWN_MATERIAL: 1, UNKNOWN_ROOM: 1 });
});

test('what the customer keeps is never changed, whatever the model proposes', () => {
  const plan = validatePlan(good, ctx({ ...LOCKS, walls: true, floor: true, furniture: true, lighting: true, colors: true }), brief());
  // Nothing is left to propose, so the alternative itself is dropped.
  assert.equal(plan.alternatives.length, 0);
  assert.ok(plan.dropped.KEPT_WALLS >= 1 && plan.dropped.KEPT_FLOOR === 1 && plan.dropped.KEPT_FURNITURE >= 1 && plan.dropped.KEPT_LIGHTING === 1);
});

test('a kept kitchen is left alone: no room changes, no kitchen pieces anywhere', () => {
  const raw = { alternatives: [{ title: 't', rationale: '', styleCode: null, palette: [], lighting: null, rooms: [
    { roomId: 'r-kit', wallColor: '#ffffff', wallMaterial: null, floorMaterial: null, clearFurniture: true, furniture: [] },
    { roomId: 'r-living', wallColor: null, wallMaterial: null, floorMaterial: null, clearFurniture: false, furniture: ['dev/kitchen-island', 'dev/sofa-3'] },
  ] }] };
  const plan = validatePlan(raw, ctx({ ...LOCKS, kitchen: true }), brief());
  assert.deepEqual(plan.alternatives[0].rooms.map((r) => [r.roomId, r.furniture]), [['r-living', ['dev/sofa-3']]]);
  assert.equal(plan.dropped.KEPT_KITCHEN, 2);
});

test('rooms outside the requested scope are dropped', () => {
  const plan = validatePlan(good, ctx(), brief({ roomIds: ['r-bed'] }));
  assert.deepEqual(plan.alternatives[0].rooms.map((r) => r.roomId), ['r-bed']);
});

test('no more alternatives than were asked for, and text is bounded', () => {
  const many = { alternatives: [1, 2, 3].map((i) => ({ ...good.alternatives[0], title: `Option ${i} `.repeat(20) })) };
  const plan = validatePlan(many, ctx(), brief({ alternatives: 2 }));
  assert.equal(plan.alternatives.length, 2);
  assert.ok(plan.alternatives[0].title.length <= 60);
});

test('garbage from the model yields no proposal rather than an error', () => {
  for (const raw of [null, 'text', { alternatives: 'x' }, { alternatives: [null, 7] }]) {
    assert.deepEqual(validatePlan(raw, ctx(), brief()).alternatives, []);
  }
});

test('the brief is bounded and typed; unknown styles and rooms are dropped', () => {
  const b = normalizeBrief({ styleCode: 'cyberpunk', palette: ['#abcdef', 'blue'], text: 'x'.repeat(2000), roomIds: ['r-bed', 'nope'], alternatives: 9 }, new Set(['r-bed']));
  assert.equal(b.styleCode, null);
  assert.deepEqual(b.palette, ['#abcdef']);
  assert.equal(b.text.length, 600);
  assert.deepEqual(b.roomIds, ['r-bed']);
  assert.equal(b.alternatives, 3);
});

test('the prompt lists only what the model may use, and what to keep', () => {
  const msg = buildUserMessage(brief(), ctx({ ...LOCKS, kitchen: true }));
  assert.match(msg, /dev\/sofa-3/);
  assert.match(msg, /dev\/paint-sage/);
  assert.match(msg, /the kitchen \(no change/);
  assert.match(msg, /r-living · LIVING/);
  assert.ok(!/\$|€|₾|price/i.test(msg), 'the prompt talks about prices');
});

test('a piece is only proposed for the rooms it is meant for', () => {
  const raw = { alternatives: [{ title: 't', rationale: '', styleCode: null, palette: [], lighting: null, rooms: [
    { roomId: 'r-kit', wallColor: null, wallMaterial: null, floorMaterial: null, clearFurniture: false, furniture: ['dev/bed-double'] },
    { roomId: 'r-bed', wallColor: null, wallMaterial: null, floorMaterial: null, clearFurniture: false, furniture: ['dev/bed-double', 'dev/sofa-3'] },
  ] }] };
  const plan = validatePlan(raw, ctx(), brief());
  assert.deepEqual(plan.alternatives[0].rooms.map((r) => [r.roomId, r.furniture]), [['r-bed', ['dev/bed-double']]]);
  assert.equal(plan.dropped.WRONG_ROOM, 2);
});
