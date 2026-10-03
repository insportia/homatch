// The walkthrough's scene plan: OpenAI proposes; HOMATCH validates the
// schema, matches the catalogue deterministically and enforces the look.

import test from 'node:test';
import assert from 'node:assert/strict';
import { matchItem, SCENE_PLAN_SCHEMA, sceneMessage, sceneRequest, validateScenePlan } from '../walkthrough/scenePlan.ts';

const prefs = { style: 'contemporary', mood: 'BRIGHT', floor: 'LIGHT_WOOD', walls: 'COOL_WHITE', accent: 'BLACK_METAL', palette: 'NEUTRAL', furnishing: 'FULL', brief: '' };
const A = (code, category, subcategory, w, d, over = {}) => ({ code, name: code, category, subcategory, roomKinds: [], styleTags: ['contemporary'], widthM: w, depthM: d, ...over });
const assets = [
  A('sofa-3', 'SOFA', 'SOFA_3', 2.2, 0.95, { roomKinds: ['LIVING'] }),
  A('sofa-2', 'SOFA', null, 1.7, 0.9, { roomKinds: ['LIVING'], styleTags: [] }),
  A('coffee', 'TABLE', 'COFFEE', 1.1, 0.6),
  A('dining', 'TABLE', 'DINING', 1.6, 0.9),
  A('chair', 'CHAIR', null, 0.5, 0.5),
  A('bed-double', 'BED', 'DOUBLE', 1.6, 2.05, { roomKinds: ['BEDROOM'] }),
  A('bedside', 'TABLE', 'NIGHTSTAND', 0.45, 0.4, { roomKinds: ['BEDROOM'] }),
  A('wardrobe', 'WARDROBE', null, 1.8, 0.6, { roomKinds: ['BEDROOM', 'HALL'] }),
  A('toilet', 'BATHROOM', 'TOILET', 0.4, 0.7, { roomKinds: ['BATHROOM', 'WC'] }),
  A('vanity', 'BATHROOM', 'VANITY', 0.8, 0.5, { roomKinds: ['BATHROOM', 'WC'] }),
  A('planter', 'OUTDOOR', 'PLANTER', 0.5, 0.5, { roomKinds: ['BALCONY', 'TERRACE'] }),
  A('out-chair', 'OUTDOOR', 'CHAIR', 0.6, 0.6, { roomKinds: ['BALCONY', 'TERRACE'] }),
];
const M = (code, appliesTo, color, over = {}) => ({ code, name: code, appliesTo, styleTags: [], color, category: null, colorFamily: null, colorTags: [], textured: false, ...over });
const materials = [
  M('oak-light', ['FLOOR'], '#c9a27a', { name: 'light oak plank', category: 'WOOD' }),
  M('tile-white', ['FLOOR', 'WALL'], '#e9e9e6', { name: 'white porcelain tile', category: 'TILE' }),
  M('paint-cool', ['WALL'], '#f6f7f7'),
];
const rooms = [
  { id: 'r1', kind: 'LIVING', areaM2: 20, label: 'Living' },
  { id: 'r2', kind: 'BEDROOM', areaM2: 14, label: 'Bedroom' },
  { id: 'r3', kind: 'BATHROOM', areaM2: 4, label: 'Bath' },
  { id: 'r4', kind: 'STORAGE', areaM2: 2, label: 'Wash' },
];
const sketch = (id, w, d) => ({
  id, kind: rooms.find((r) => r.id === id).kind, label: null, areaM2: w * d, widthM: w, depthM: d,
  polygon: [[0, 0], [w, 0], [w, d], [0, d]], doors: [{ x: w / 2, y: 0, widthM: 0.9 }], windows: [],
  walls: [{ surfaceId: `wall:a:L:${id}`, from: [0, 0], to: [w, 0], lengthM: w, facing: 'N' }, { surfaceId: `wall:b:L:${id}`, from: [0, d], to: [w, d], lengthM: w, facing: 'S' }],
  stairs: false,
});
const ctx = { rooms, assets, materials, locks: { layout: false, furniture: false, walls: false, floor: false, kitchen: false, colors: false, lighting: false }, existing: {} };
const input = (over = {}) => ({
  preferences: prefs, spec: null, finishes: { floor: { color: '#d8bc91' }, walls: { color: '#f4f6f7' }, ceiling: { color: '#f5f2ed' }, wetFloor: { color: '#d4d2cb' } },
  palette: ['#f4f6f7', '#d8bc91'], ctx, rooms: [sketch('r1', 5, 4), sketch('r2', 4, 3.5), sketch('r3', 2, 2), sketch('r4', 1.5, 1.6)], ...over,
});
const roomPlan = (roomId, furniture = [], over = {}) => ({
  roomId, floor: { materialCode: null, color: null }, walls: { materialCode: null, color: null, finish: null }, accentWall: { surfaceId: null, color: null },
  ceiling: { color: null }, furniture, ...over,
});
const piece = (type, assetCode, x = 1, y = 1, over = {}) => ({ type, assetCode, x, y, rotationDeg: 0, scale: 1, color: null, purpose: '', ...over });
const plan = (roomsList, over = {}) => ({ summary: 'ok', lighting: { timeOfDay: 'DAY', temperature: 'NEUTRAL', interiorIntensity: 0.8 }, rooms: roomsList, ...over });

test('the schema is strict: every object closed, every property required', () => {
  const walk = (s) => {
    if (s?.type === 'object' || (Array.isArray(s?.type) && s.type.includes('object'))) {
      assert.equal(s.additionalProperties, false);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
      for (const v of Object.values(s.properties)) walk(v);
    }
    if (s?.items) walk(s.items);
  };
  walk(SCENE_PLAN_SCHEMA);
  const body = sceneRequest('m', input());
  assert.equal(body.text.format.strict, true);
  assert.ok(!JSON.stringify(body).toLowerCase().includes('gemini'));
});

test('the model is shown the measured rooms, the spec and only the offered catalogue', () => {
  const msg = sceneMessage(input());
  assert.match(msg, /r1 · LIVING/);
  assert.match(msg, /wall faces/);
  assert.match(msg, /sofa-3/);
  assert.match(msg, /oak-light/);
});

test('catalogue matching: exact when the code fits; the same type otherwise (approximation); a relative; or nothing', () => {
  const room = { kind: 'LIVING', areaM2: 20 };
  assert.deepEqual(matchItem({ type: 'SOFA', assetCode: 'sofa-3' }, room, assets, prefs), { code: 'sofa-3', approximate: false, reason: 'EXACT', score: 1 });
  const wrongCode = matchItem({ type: 'SOFA', assetCode: 'bed-double' }, room, assets, prefs);
  assert.equal(wrongCode.reason, 'SAME_TYPE'); assert.equal(wrongCode.approximate, true);
  assert.equal(matchItem({ type: 'SOFA', assetCode: null }, room, assets, prefs).code, 'sofa-3'); // style tag wins
  const rel = matchItem({ type: 'DINING_CHAIR', assetCode: null }, room, assets, prefs);
  assert.deepEqual([rel.code, rel.reason, rel.approximate], ['chair', 'RELATED_TYPE', true]);
  assert.equal(matchItem({ type: 'BATH', assetCode: null }, { kind: 'BATHROOM', areaM2: 4 }, assets, prefs), null);
  // Deterministic.
  assert.deepEqual(matchItem({ type: 'SOFA', assetCode: 'sofa-2' }, room, assets, prefs), matchItem({ type: 'SOFA', assetCode: 'sofa-2' }, room, assets, prefs));
});

test('a bed is never matched into a bathroom; outdoor pieces only outside', () => {
  assert.equal(matchItem({ type: 'BED', assetCode: 'bed-double' }, { kind: 'BATHROOM', areaM2: 4 }, assets, prefs), null);
  assert.equal(matchItem({ type: 'OUTDOOR_CHAIR', assetCode: 'out-chair' }, { kind: 'LIVING', areaM2: 20 }, assets, prefs), null);
});

test('validation keeps real rooms, real codes and bounded numbers; reports what it removed', () => {
  const v = validateScenePlan(plan([
    roomPlan('r1', [piece('SOFA', 'sofa-3', 0.6, 2, { rotationDeg: 270, scale: 1.4 }), piece('COFFEE_TABLE', 'coffee', 99, 99), piece('SOFA', 'invented-sofa')],
      { floor: { materialCode: 'oak-light', color: null }, walls: { materialCode: null, color: '#f6f7f7', finish: 'MATTE' }, accentWall: { surfaceId: 'wall:a:L:r1', color: '#30343a' } }),
    roomPlan('r-made-up', [piece('SOFA', 'sofa-3')]),
  ]), input());
  assert.ok(v);
  const r1 = v.rooms.find((r) => r.roomId === 'r1');
  const sofa = r1.items.find((i) => i.code === 'sofa-3');
  assert.equal(sofa.scale, 1.15);
  assert.equal(sofa.pose.rotationDeg, 270);
  assert.equal(r1.items.find((i) => i.code === 'coffee').pose, null); // outside the room: no proposal
  assert.ok(v.dropped.UNKNOWN_ROOM >= 1 && v.dropped.BAD_POSE >= 1 && v.dropped.SCALE_BOUNDED >= 1, JSON.stringify(v.dropped));
  assert.equal(r1.floorMaterial, 'oak-light');
  assert.deepEqual(r1.accent, { surfaceId: 'wall:a:L:r1', color: '#30343a' });
  // An invented code is matched to the closest real sofa and recorded as an approximation.
  assert.ok(v.approximations.some((a) => a.requested === 'invented-sofa'));
});

test('the look is enforced after the model: wall family, wet floors, room programme, empty storage', () => {
  const v = validateScenePlan(plan([
    roomPlan('r1', [], { walls: { materialCode: null, color: '#ff0000', finish: null } }),
    roomPlan('r3', [], { floor: { materialCode: 'oak-light', color: null } }),
    roomPlan('r4', [piece('SOFA', 'sofa-2')]),
  ]), input());
  const r1 = v.rooms.find((r) => r.roomId === 'r1');
  assert.notEqual(r1.wallColor, '#ff0000');
  assert.ok(r1.items.some((i) => i.type === 'SOFA' && i.origin === 'PROGRAMME'), JSON.stringify(r1.items));
  assert.equal(v.rooms.find((r) => r.roomId === 'r3').floorMaterial, 'tile-white');
  const bed = v.rooms.find((r) => r.roomId === 'r2');
  assert.ok(bed.items.some((i) => i.type === 'BED'));
  assert.ok(!(v.rooms.find((r) => r.roomId === 'r4')?.items ?? []).length);
});

test('an accent on a wall face of another room is dropped', () => {
  const v = validateScenePlan(plan([roomPlan('r1', [], { accentWall: { surfaceId: 'wall:a:L:r2', color: '#30343a' } })]), input());
  assert.equal(v.rooms.find((r) => r.roomId === 'r1').accent, null);
  assert.equal(v.dropped.BAD_ACCENT, 1);
});

test('not a plan at all → null; the same answer validates the same way', () => {
  assert.equal(validateScenePlan(null, input()), null);
  assert.equal(validateScenePlan({ rooms: 'x' }, input()), null);
  const raw = plan([roomPlan('r1', [piece('SOFA', 'sofa-3', 0.6, 2)])]);
  assert.deepEqual(validateScenePlan(raw, input()), validateScenePlan(raw, input()));
});
