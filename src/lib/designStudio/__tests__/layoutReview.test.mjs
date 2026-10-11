// THE AI'S REVIEW OF A BUILT LAYOUT (walkthrough/layoutReview.ts) AND THE AI ROOM MATCH (walkthrough/designGraph.ts).
//
// The model's answers are data: only known pieces and rooms, positions inside the room, at most MAX_REVIEW_OPS; a
// correction applied to the plan is built again by the same engine, and a room the review touches keeps every piece
// the engine had added to it. The edge function's wiring (asked once, in the background; kept only when every gate
// still passes; metered) is held by source premises below.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spaceFromReading } from '../walkthrough/photoSpace.ts';
import { buildSpaceModel } from '../space.ts';
import { buildWalkthrough, roomSketches } from '../walkthrough/build.ts';
import { emptyDesignState } from '../designState.ts';
import { applyReview, MAX_REVIEW_OPS, readReview, reviewLayout, reviewRequest } from '../walkthrough/layoutReview.ts';
import { readRoomMatch, roomMatchRequest } from '../walkthrough/designGraph.ts';
import { prodAssets } from './fixtures/devCatalogue.mjs';

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const room = (key, kind, poly, label = null) => ({ key, kind, label, polygon: poly, outdoor: ['BALCONY', 'TERRACE'].includes(kind), confidence: 0.8, basis: 'OBSERVED', geometry: 'ESTIMATE' });
const reading = (rooms) => ({ version: 'ds-recon-3', view: 'AERIAL', scaleConfidence: 0.6, scaleEvidence: null, ceilingHeightM: 2.7, usesPlan: false, rooms, openings: [], objects: [], surfaces: [], palette: [], styleWords: [], cameras: [], unknowns: [] });
const HOME = [room('kl', 'LIVING', rect(0, 0, 6.5, 4.5), 'Kitchen / Living'), room('bed', 'BEDROOM', rect(0, 4.5, 3.8, 8)), room('bath', 'BATHROOM', rect(3.8, 4.5, 6.5, 6.5)), room('hall', 'HALL', rect(3.8, 6.5, 6.5, 8))];

function home() {
  const b0 = spaceFromReading(reading(HOME), { sourceKey: 'review', expected: [], furnish: null });
  const space = buildSpaceModel(b0.space.canonical.scene);
  const assets = prodAssets();
  const plan = { lighting: { timeOfDay: 'DAY', temperature: 'NEUTRAL', interiorIntensity: 0.7 }, palette: [], styleCode: null,
    rooms: space.rooms.map((r) => ({ roomId: r.id, floorMaterial: null, floorColor: null, wallMaterial: null, wallColor: null, wallFinish: null, accent: null, ceilingColor: null, items: [] })) };
  const build = (p) => buildWalkthrough({ space, base: emptyDesignState(), assets, materialsByCode: new Map(), materialsById: new Map(), idPrefix: 'c', plan: p });
  const built = build(plan);
  return { space, assets, plan, build, built, layout: reviewLayout(space, roomSketches(space), plan, built.state, built.report, assets) };
}

test('the reviewer sees every built piece in its room frame, and where it came from', () => {
  const { layout, built } = home();
  assert.equal(layout.pieces.length, built.state.objects.length);
  for (const p of layout.pieces) {
    const r = layout.rooms.find((x) => x.id === p.roomId);
    assert.ok(r && p.x >= -0.01 && p.y >= -0.01 && p.x <= r.widthM + 0.01 && p.y <= r.depthM + 0.01, `${p.id} in its room frame`);
  }
  // No plan: every piece is the engine's.
  assert.ok(Object.values(layout.source).every((v) => v === null));
  const body = reviewRequest('m', 'data:image/png;base64,AA==', layout);
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.schema.properties.corrections.maxItems, MAX_REVIEW_OPS);
});

test('the answer is data: unknown pieces, other rooms, positions outside the room and repeats are dropped', () => {
  const { layout } = home();
  const sofa = layout.pieces.find((p) => /sofa/.test(p.code));
  const ops = readReview({ corrections: [
    { op: 'MOVE', pieceId: sofa.id, roomId: sofa.roomId, type: null, x: 1, y: 1, rotationDeg: 90, reason: 'face the TV' },
    { op: 'MOVE', pieceId: sofa.id, roomId: sofa.roomId, type: null, x: 2, y: 2, rotationDeg: 0, reason: 'again' },
    { op: 'MOVE', pieceId: 'nope', roomId: sofa.roomId, type: null, x: 1, y: 1, rotationDeg: 0, reason: '' },
    { op: 'MOVE', pieceId: sofa.id, roomId: 'r-bed', type: null, x: 1, y: 1, rotationDeg: 0, reason: '' },
    { op: 'ADD', pieceId: null, roomId: sofa.roomId, type: 'ARMCHAIR', x: 99, y: 1, rotationDeg: 0, reason: '' },
    { op: 'ADD', pieceId: null, roomId: sofa.roomId, type: 'SPACESHIP', x: 1, y: 1, rotationDeg: 0, reason: '' },
    { op: 'ADD', pieceId: null, roomId: sofa.roomId, type: 'ARMCHAIR', x: 1.2, y: 3.3, rotationDeg: 450, reason: 'the picture has one' },
  ] }, layout);
  assert.deepEqual(ops.map((o) => [o.op, o.op === 'ADD' ? o.type : o.pieceId]), [['MOVE', sofa.id], ['ADD', 'ARMCHAIR']]);
  assert.equal(ops[1].rotationDeg, 90);
  assert.deepEqual(readReview(null, layout), []);
});

test('corrections applied and built again: moved where the reviewer said, removed, added; the room keeps its other pieces', () => {
  const { layout, plan, build, built, assets } = home();
  const kl = layout.pieces.filter((p) => p.roomId === 'r-kl');
  const sofa = kl.find((p) => /sofa/.test(p.code));
  const victim = kl.find((p) => /coffee/.test(p.code)) ?? kl.find((p) => p !== sofa && !/kitchen|fridge/.test(p.code));
  const ops = [
    { op: 'MOVE', pieceId: sofa.id, roomId: 'r-kl', x: sofa.x, y: sofa.y, rotationDeg: sofa.rotationDeg, reason: 'keep' },
    { op: 'REMOVE', pieceId: victim.id, roomId: 'r-kl', reason: 'not in the picture' },
    { op: 'ADD', roomId: 'r-bed', type: 'LAMP', x: 0.5, y: 0.5, rotationDeg: 0, reason: 'the picture has one' },
  ];
  const lamp = [...assets.values()].find((a) => /lamp/i.test(a.code) && a.placement === 'FLOOR');
  const { plan: next, applied } = applyReview(plan, ops, layout, (type) => (type === 'LAMP' ? lamp?.code ?? null : null));
  assert.equal(applied, lamp ? 3 : 2);
  const klItems = next.rooms.find((r) => r.roomId === 'r-kl').items;
  // Every piece the engine had put in the touched room is planned there now, but the one removed.
  assert.equal(klItems.length, kl.length - 1);
  assert.ok(!klItems.some((it) => it.code === victim.code && Math.abs(it.pose.x - victim.x) < 1e-6 && Math.abs(it.pose.y - victim.y) < 1e-6));
  const again = build(next);
  assert.equal(again.report.gate.ok, true, JSON.stringify(again.report.gate));
  assert.ok(again.state.objects.some((o) => o.roomId === 'r-kl' && /sofa/.test(o.assetId)));
  assert.ok(built.state.objects.length > 0);
});

test('the AI room match only fills rooms left open, with real rooms, each once', () => {
  const body = roomMatchRequest('m', [{ id: 'r1', kind: 'KITCHEN_LIVING', label: 'სამზარეულო', pieces: ['SOFA'] }, { id: 'r3', kind: 'OFFICE', pieces: ['DESK'] }],
    [{ id: 'r-a', kind: 'LIVING', label: null, areaM2: 22, use: 'KITCHEN_LIVING' }, { id: 'r-b', kind: 'UNKNOWN', label: null, areaM2: 9, use: 'OTHER' }]);
  assert.deepEqual(body.text.format.schema.properties.matches.items.properties.planRoom.enum, ['r-a', 'r-b', null]);
  assert.deepEqual(readRoomMatch({ matches: [{ pictureRoom: 'r1', planRoom: 'r-a' }, { pictureRoom: 'r3', planRoom: 'r-a' }, { pictureRoom: 'zz', planRoom: 'r-b' }] }, ['r1', 'r3'], ['r-a', 'r-b']),
    { r1: 'r-a', r3: null });
});

test('premises: the edge function asks once in the background, keeps a correction only when the gates pass, meters both calls', () => {
  const src = fs.readFileSync(new URL('../../../../supabase/functions/design-studio-reconstruct/walkthrough.ts', import.meta.url), 'utf8');
  assert.match(src, /reviewRequest\(QA_MODEL, reference\.dataUrl, layout\), background: true, store: true/);
  assert.match(src, /if \(failing && corrected\) \{[\s\S]{0,400}state: 'REJECTED'/);
  assert.match(src, /step: 'walkthrough_layout_review'/);
  assert.match(src, /step: 'walkthrough_room_match'/);
  assert.match(src, /DS_LAYOUT_REVIEW/);
  // A room the graph could not furnish takes the AI plan's own pieces for it.
  assert.match(src, /aiFilled\.push\(r\.roomId\)/);
});
