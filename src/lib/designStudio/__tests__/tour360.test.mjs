// THE HOME IN 360°: four eye-level pictures per room, a quarter turn apart, joined by the plan's doors.
// The server tells each picture what its side shows from the plan; the browser puts the doors at the same bearings.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bearingDeg, facingWords, headingFrame, HEADINGS, isHeading, relativeDeg, roomOpenings, VIEW_HFOV_DEG } from '../tour/roomViews.ts';

// Two rooms side by side: A (0..4 x 0..3) and B (4..8 x 0..3), a door between them on x = 4, a window in A's top wall.
const square = (x0, x1, y0, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const room = (id, poly) => ({ id, kind: 'LIVING', label: id, polygon: poly, areaM2: 12, centroid: { x: (poly[0].x + poly[1].x) / 2, y: (poly[0].y + poly[2].y) / 2 }, bounds: null, outdoor: false });
const space = { rooms: [room('A', square(0, 4, 0, 3)), room('B', square(4, 8, 0, 3))] };
const scene = {
  walls: [
    { id: 'w-mid', start: { x: 4, y: 0 }, end: { x: 4, y: 3 }, thicknessM: 0.2, openings: [{ id: 'd1', kind: 'DOOR', offsetM: 1.5, widthM: 0.9 }] },
    { id: 'w-top', start: { x: 0, y: 3 }, end: { x: 4, y: 3 }, thicknessM: 0.2, openings: [{ id: 'win1', kind: 'WINDOW', offsetM: 2, widthM: 1.2 }] },
  ],
};

test('four headings close the circle: 4 x 90 degrees', () => {
  assert.deepEqual([...HEADINGS], [0, 1, 2, 3]);
  assert.equal(VIEW_HFOV_DEG * HEADINGS.length, 360);
  assert.ok(isHeading(2) && !isHeading(4) && !isHeading('1'));
});

test('bearings are clockwise from heading 0 (up the drawing)', () => {
  const c = { x: 0, y: 0 };
  assert.equal(Math.round(bearingDeg(c, { x: 0, y: 1 })), 0);
  assert.equal(Math.round(bearingDeg(c, { x: 1, y: 0 })), 90);
  assert.equal(Math.round(bearingDeg(c, { x: 0, y: -1 })), 180);
  assert.equal(Math.round(bearingDeg(c, { x: -1, y: 0 })), 270);
  assert.equal(relativeDeg(90, 1), 0);
  assert.equal(relativeDeg(270, 0), -90);
});

test('the door joins the two rooms both ways, at the bearing it is seen at', () => {
  const a = roomOpenings(space, scene, 'A');
  assert.deepEqual(a.links.map((l) => [l.toRoomId, l.bearingDeg]), [['B', 90]]);
  assert.deepEqual(a.windows.map((w) => w.bearingDeg), [0]);
  const b = roomOpenings(space, scene, 'B');
  assert.deepEqual(b.links.map((l) => [l.toRoomId, l.bearingDeg]), [['A', 270]]);
});

test('each picture is told what its side of the room shows, from the plan', () => {
  const label = (id) => (id === 'B' ? 'kitchen' : 'living room');
  assert.match(facingWords({ space, scene, roomId: 'A', heading: 1, label }), /doorway to the kitchen straight ahead/);
  assert.match(facingWords({ space, scene, roomId: 'A', heading: 0, label }), /a window straight ahead/);
  assert.match(facingWords({ space, scene, roomId: 'A', heading: 2, label }), /no door or window/);
  const frame = headingFrame(1, 'x', true);
  assert.match(frame, /picture 2 of 4/);
  assert.match(frame, /exactly 90 degrees horizontal field of view/);
  assert.match(frame, /picture 1 of this same room/);
  assert.doesNotMatch(headingFrame(0, 'x', true), /picture 1 of this same room/);
});

test('the server makes a room\'s four pictures from one specification, each told its side', () => {
  const gen = readFileSync(new URL('../../../../supabase/functions/design-studio-reconstruct/generate.ts', import.meta.url), 'utf8');
  // The heading is part of the picture's identity (its own row, its own reservation) and of its view.
  assert.match(gen, /id: mode === 'ROOM' \? `room-\$\{roomId\}\$\{heading != null \? `-h\$\{heading\}` : ''\}` : 'master'/);
  assert.match(gen, /\.\.\.\(mode === 'ROOM' && heading != null \? \{ heading \} : \{\}\),/);
  // Only a whitelisted heading is read from the request; the words come from the plan, never from the request.
  assert.match(gen, /isHeading\(body\.heading\) \? body\.heading : null/);
  assert.match(gen, /return facingWords\(\{ space, scene, roomId: String\(row\.view\.roomId\), heading, label \}\);/);
  assert.match(gen, /\$\{headingFrame\(heading, facing, heading !== 0\)\}/);
  // Turned from the first picture of the same room and the same specification.
  assert.match(gen, /\.eq\('view->>heading', '0'\)/);
  assert.match(gen, /r\.timings\?\.ai\?\.specJobId === row\.timings\?\.ai\?\.specJobId/);
});

test('the result asks one price for every missing picture and opens the home in 360°', () => {
  const result = readFileSync(new URL('../../../components/designStudio/unified/DesignResult.tsx', import.meta.url), 'utf8');
  assert.match(result, /credits: credits \* pictures360/);
  assert.match(result, /key: keyBase, heading: 0,/);
  assert.match(result, /renderRoomView\(\{ projectId, versionId: run\.headId, specJobId: specJobId!, heading: h, key: `\$\{keyBase\}-h\$\{h\}`, confirmedCredits: run\.credits \}\)/);
  assert.match(result, /panorama=\{pano \? panoRooms : undefined\}/);
  const run = readFileSync(new URL('../../../services/designStudio/designRun.ts', import.meta.url), 'utf8');
  assert.match(run, /if \(quoted\.quote\.credits !== input\.confirmedCredits\) throw new DesignStudioFailure\('PRICE_CHANGED', true\);/);
  const pano = readFileSync(new URL('../../../components/designStudio/unified/PanoramaWalk.tsx', import.meta.url), 'utf8');
  assert.match(pano, /data-testid="pano-door"/);
  assert.match(pano, /onClick=\{\(\) => go\(d\.toRoomId\)\}/);
  assert.match(pano, /new THREE\.MeshBasicMaterial\(\{ map: texture/);
});
