// THE ARCHITECT'S DRAFT OF A PLAN READ IN PERSPECTIVE (walkthrough/planDraft.ts).
//
// The shape of a real reading of a dollhouse picture: a slanted hall, an office overlapping the kitchen-living, rooms
// that fail the geometry check as read. The draft redraws them as rectangles in the same frame; it is accepted only
// when it is a plan (every room once, real sizes, no overlaps) and then builds as read — the plan the picture shows,
// not one laid out again by rule. Synthetic data: no customer reading is committed.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyDraft, draftProblems, draftRequest } from '../walkthrough/planDraft.ts';
import { spaceFromReading } from '../walkthrough/photoSpace.ts';

const room = (key, kind, label, polygon) => ({ key, kind, label, polygon, outdoor: kind === 'BALCONY', confidence: 0.8, basis: 'OBSERVED', geometry: 'ESTIMATE' });
const obj = (key, type, roomKey, at, w, d) => ({ key, type, label: type, room: roomKey, at, facingDeg: 0, widthM: w, depthM: d, heightM: 0.8, color: null, material: null, style: null, confidence: 0.8, basis: 'OBSERVED', seenIn: [0] });
const reading = {
  version: 'ds-recon-3', view: 'AERIAL', scaleConfidence: 0.6, scaleEvidence: null, ceilingHeightM: 2.7, usesPlan: false,
  rooms: [
    room('living', 'LIVING', 'kitchen-living', [[4, 5.5], [9, 5.5], [9, 9], [4, 9]]),
    room('office', 'UNKNOWN', 'office', [[4.36, 2.93], [8.83, 2.93], [8.67, 5.99], [4.08, 5.78]]),
    room('bedroom', 'BEDROOM', 'bedroom', [[4, 0], [9, 0], [9, 3], [4, 3]]),
    room('bathroom', 'BATHROOM', 'bathroom', [[1, 0], [4, 0], [4, 4], [1, 4]]),
    room('hall', 'HALL', 'entrance hall', [[1.27, 4.46], [4.08, 5.78], [2.2, 9.38], [0, 7.91]]),
    room('balcony', 'BALCONY', 'balcony', [[9, 0], [11, 0], [11, 9], [9, 9]]),
  ],
  openings: [], surfaces: [], palette: [], styleWords: [], cameras: [], unknowns: [],
  objects: [obj('sofa', 'SOFA', 'living', [6.5, 6.5], 2.2, 0.9), obj('bed', 'BED', 'bedroom', [6.5, 1.5], 1.6, 2.0), obj('desk', 'DESK', 'office', [6.5, 4.2], 1.2, 0.6), obj('wc', 'TOILET', 'bathroom', [2, 1], 0.4, 0.7)],
};
// The architect's answer: the same rooms, square, tiling a 9 × 9 home with the balcony outside it.
const draft = { rooms: [
  { key: 'living', rects: [{ x: 4, y: 5.5, widthM: 5, depthM: 3.5 }] },
  { key: 'office', rects: [{ x: 4, y: 3, widthM: 5, depthM: 2.5 }] },
  { key: 'bedroom', rects: [{ x: 4, y: 0, widthM: 5, depthM: 3 }] },
  { key: 'bathroom', rects: [{ x: 1, y: 0, widthM: 3, depthM: 3 }] },
  { key: 'hall', rects: [{ x: 1, y: 3, widthM: 3, depthM: 6 }] },
  { key: 'balcony', rects: [{ x: 9, y: 0, widthM: 2, depthM: 9 }] },
] };

test('a draft that is a plan replaces the outlines read in perspective', () => {
  const out = applyDraft(reading, draft);
  assert.ok(out);
  assert.deepEqual(out.recon.rooms.find((r) => r.key === 'hall').polygon, [[1, 3], [4, 3], [4, 9], [1, 9]]);
  assert.equal(out.recon.objects.length, reading.objects.length);
  const built = spaceFromReading(out.recon, { sourceKey: 't', expected: [], furnish: null });
  assert.ok(!('problems' in built), JSON.stringify(built.problems));
  assert.equal(built.layout, 'READ', 'built as drafted, not laid out again by rule');
});

test('a draft that is not a plan is refused: a room missing or repeated, a room of no size, rooms overlapping', () => {
  assert.equal(applyDraft(reading, { rooms: draft.rooms.slice(1) }), null);
  assert.equal(applyDraft(reading, { rooms: [...draft.rooms, draft.rooms[0]] }), null);
  assert.equal(applyDraft(reading, { rooms: draft.rooms.map((r) => (r.key === 'hall' ? { key: 'hall', rects: [{ x: 1, y: 3, widthM: 0.2, depthM: 6 }] } : r)) }), null);
  assert.equal(applyDraft(reading, { rooms: draft.rooms.map((r) => (r.key === 'office' ? { key: 'office', rects: [{ x: 3, y: 3, widthM: 6, depthM: 3 }] } : r)) }), null);
  assert.equal(applyDraft(reading, null), null);
});

test('a balcony that wraps a corner is drawn in parts, each a room of the same kind, its pieces in the part they stand in', () => {
  const read = { ...reading, objects: [...reading.objects, obj('chair', 'OUTDOOR_CHAIR', 'balcony', [5, -0.8], 0.6, 0.6)] };
  const wrap = { rooms: draft.rooms.map((r) => (r.key === 'balcony' ? { key: 'balcony', rects: [{ x: 9, y: 0, widthM: 2, depthM: 9 }, { x: 1, y: -1.6, widthM: 10, depthM: 1.6 }] } : r)) };
  const out = applyDraft(read, wrap);
  assert.ok(out);
  assert.deepEqual(out.split, ['balcony']);
  assert.ok(out.recon.rooms.some((r) => r.key === 'balcony-2' && r.kind === 'BALCONY'));
  assert.equal(out.recon.objects.find((o) => o.key === 'chair').room, 'balcony-2');
});

test('the request: the pictures and the reading, a strict schema; the edge function asks it after every reading and keeps the draft it used', () => {
  const body = draftRequest('m', ['data:image/png;base64,AA=='], reading);
  assert.equal(body.text.format.strict, true);
  assert.match(body.input[1].content.at(-1).text, /"key":"hall"/);
  const src = fs.readFileSync(new URL('../../../../supabase/functions/design-studio-reconstruct/walkthrough.ts', import.meta.url), 'utf8');
  assert.match(src, /draftRequest\(SPACE_MODEL, draftImages, read\)/);
  assert.match(src, /const asRead = \(x: ReturnType<typeof spaceOf> \| null\) => !!x && !\('problems' in x\) && x\.layout === 'READ' && x\.geometryCheck\.verdict === 'PASS';/);
  assert.match(src, /const useDraft = !useArchitect && asRead\(fromDraft\);/);
  assert.match(src, /reading: kept,/);
  assert.match(src, /purpose: 'WALK_SPACE_DRAFT'/);
});

test('a draft sized against what its rooms are is sent back once, with exactly what is wrong', () => {
  // The shape of a real draft: a bathroom the size of a bedroom, a kitchen-living room too small for its kitchen and sofa,
  // a study 1.7 m deep.
  const read = { ...reading, objects: [...reading.objects, obj('run', 'KITCHEN_RUN', 'living', [5, 8.5], 2.4, 0.6)] };
  const bad = { rooms: [
    { key: 'bathroom', rects: [{ x: 1, y: 0, widthM: 3.1, depthM: 4.45 }] },
    { key: 'bedroom', rects: [{ x: 4.1, y: 0, widthM: 3.4, depthM: 4.45 }] },
    { key: 'hall', rects: [{ x: 1, y: 4.45, widthM: 1.4, depthM: 4 }] },
    { key: 'office', rects: [{ x: 4.1, y: 4.45, widthM: 5, depthM: 1.7 }] },
    { key: 'living', rects: [{ x: 4.1, y: 6.15, widthM: 5, depthM: 3.3 }] },
    { key: 'balcony', rects: [{ x: 9.1, y: 0, widthM: 1.5, depthM: 9 }] },
  ] };
  const problems = draftProblems(applyDraft(read, bad).recon);
  assert.ok(problems.some((p) => /bathroom\) is 13\.8 m²/.test(p)), problems.join(' | '));
  assert.ok(problems.some((p) => /kitchen-living room\) is 16\.5 m²/.test(p)), problems.join(' | '));
  assert.ok(problems.some((p) => /study\) is only 1\.7 m deep/.test(p)), problems.join(' | '));
  const good = { rooms: [
    { key: 'bathroom', rects: [{ x: 1, y: 0, widthM: 2.4, depthM: 2.4 }] },
    { key: 'hall', rects: [{ x: 1, y: 2.4, widthM: 2.4, depthM: 3 }] },
    { key: 'bedroom', rects: [{ x: 3.4, y: 0, widthM: 4, depthM: 3.5 }] },
    { key: 'office', rects: [{ x: 3.4, y: 3.5, widthM: 4, depthM: 2.5 }] },
    { key: 'living', rects: [{ x: 1, y: 6, widthM: 6.4, depthM: 4 }] },
    { key: 'balcony', rects: [{ x: 7.4, y: 0, widthM: 1.5, depthM: 10 }] },
  ] };
  assert.deepEqual(draftProblems(applyDraft(read, good).recon), []);
  // The second request carries the first draft and its problems.
  const body = draftRequest('m', ['data:image/png;base64,AA=='], read, { draft: bad, problems });
  assert.match(body.input[1].content.at(-1).text, /IT IS NOT THIS HOME/);
  const src = fs.readFileSync(new URL('../../../../supabase/functions/design-studio-reconstruct/walkthrough.ts', import.meta.url), 'utf8');
  assert.match(src, /draftRequest\(SPACE_MODEL, draftImages, read, \{ draft: draftRaw, problems: firstProblems \}\)/);
  assert.match(src, /purpose: 'WALK_SPACE_DRAFT_REPAIR'/);
  assert.match(src, /remaining\.length < firstProblems\.length/);
});

test('the last resort: a walkthrough whose plan failed is published from the render\'s own walkable pieces, once', () => {
  const src = fs.readFileSync(new URL('../../../../supabase/functions/design-studio-reconstruct/walkthrough.ts', import.meta.url), 'utf8');
  assert.match(src, /renderFurnishing\?\.declined === 'NOT_FAITHFUL' && !row\.timings\?\.renderFurnishing\?\.lastResort/);
  assert.match(src, /lastResort: \{ state: 'TRYING', failing/);
  assert.match(src, /planFromRender\(admin, row, design, furnishing, preferences\.style \?\? null, true\)/);
  assert.match(src, /const publishable = gate\.ready \|\| \(lastResort && gate\.lastResort\);/);
  const gate = fs.readFileSync(new URL('../walkthrough/renderGate.ts', import.meta.url), 'utf8');
  assert.match(gate, /const lastResort = ready \|\| \(navPass && importantRecall >= READY_MIN_IMPORTANT_RECALL/);
  assert.match(gate, /!build\.gate\?\.missingEssential\?\.length\);/);
});
