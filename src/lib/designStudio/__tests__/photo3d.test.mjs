// STEP INSIDE THE PICTURE: the selected picture made 3D from its own pixels.
// From the picture's viewpoint the mesh IS the picture (every vertex lands on
// its own pixel); nothing is stretched across a jump in depth; the walk stays
// where a single picture still holds.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clampWalk, EDGE_RATIO, hotspotAt, PHOTO_CAMERAS, photoMesh, walkBounds } from '../photo3d/depthMesh.ts';

/** A depth map from a function of (u, v) → disparity. */
const map = (w, h, f) => ({ width: w, height: h, data: Float32Array.from({ length: w * h }, (_, i) => f((i % w) / (w - 1), Math.floor(i / w) / (h - 1))) });
// A room: the floor nearer at the bottom of the picture, the back wall at the top.
const room = map(96, 64, (u, v) => 0.2 + 0.8 * v);
const ROOM = PHOTO_CAMERAS.ROOM;

test('from the picture\'s own viewpoint every vertex lands exactly on its own pixel: the view IS the picture', () => {
  const aspect = 1.5;
  const m = photoMesh(room, aspect, ROOM, 64);
  const tanV = Math.tan((ROOM.fovDeg * Math.PI) / 360); const tanH = tanV * aspect;
  for (let k = 0; k < m.positions.length / 3; k += 37) {
    const [x, y, z] = [m.positions[k * 3], m.positions[k * 3 + 1], m.positions[k * 3 + 2]];
    const u = 0.5 + x / -z / tanH / 2; const v = 0.5 + y / -z / tanV / 2; // texture v (flipped picture rows)
    assert.ok(Math.abs(u - m.uvs[k * 2]) < 1e-5 && Math.abs(v - m.uvs[k * 2 + 1]) < 1e-5, `vertex ${k}`);
  }
});

test('depth follows the picture: nearer disparity is nearer, within the camera\'s near and far', () => {
  const m = photoMesh(room, 1.5, ROOM, 64);
  const zAt = (col, row) => -m.positions[(row * (m.cols + 1) + col) * 3 + 2];
  assert.ok(zAt(32, m.rows) < zAt(32, 0), 'the bottom of the picture (the floor) is nearer than the top (the back wall)');
  for (let k = 2; k < m.positions.length; k += 3) assert.ok(-m.positions[k] >= ROOM.nearM - 1e-6 && -m.positions[k] <= ROOM.farM + 1e-6);
  assert.equal(m.openTriangles, 0, 'a smooth room is one surface');
});

test('a sofa in front of a wall: nothing is stretched across the jump in depth (the gap stays open, never invented)', () => {
  const sofa = map(96, 64, (u, v) => (u > 0.3 && u < 0.7 && v > 0.5 ? 1 : 0.1));
  const m = photoMesh(sofa, 1.5, ROOM, 64);
  assert.ok(m.openTriangles > 0);
  const z = (i) => -m.positions[i * 3 + 2];
  for (let t = 0; t < m.indices.length; t += 3) {
    const zs = [z(m.indices[t]), z(m.indices[t + 1]), z(m.indices[t + 2])];
    assert.ok(Math.max(...zs) / Math.min(...zs) <= EDGE_RATIO + 1e-6);
  }
});

test('the walk stays where the picture holds: forward short of the nearest surface, the side narrowing as one walks in', () => {
  const m = photoMesh(room, 1.5, ROOM, 64);
  const b = walkBounds(m);
  assert.ok(b.forwardM > 0.3 && b.forwardM < m.medianM, JSON.stringify(b));
  const deep = clampWalk({ x: 5, y: 2, z: -50 }, b);
  assert.equal(deep.z, -b.forwardM);
  assert.ok(Math.abs(deep.x) <= b.sideM * 0.5 + 1e-9, 'narrower at the far end');
  assert.equal(deep.y, b.upM);
  assert.deepEqual(clampWalk({ x: 0, y: 0, z: 0 }, b), { x: 0, y: 0, z: 0 }, 'the picture\'s own viewpoint is always allowed');
});

test('a dollhouse picture is seen from further away (its own camera)', () => {
  const m = photoMesh(room, 1.5, PHOTO_CAMERAS.MASTER, 48);
  assert.ok(m.nearestM >= PHOTO_CAMERAS.MASTER.nearM - 1e-6);
});

test('the 3D tour card opens the picture itself first; the depth model loads only when a picture is entered', () => {
  const panel = readFileSync(new URL('../../../components/designStudio/unified/WalkthroughPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /const PhotoWalk = lazy\(\(\) => import\('\.\/PhotoWalk'\)\);/);
  assert.match(panel, /data-testid="photo3d-enter"/);
  // With a picture, the 3D tour IS the picture: nothing else on the card, nothing asked of the server.
  assert.ok(panel.indexOf('if (photoTour) {') > 0 && panel.indexOf('if (photoTour) {') < panel.indexOf('if (!loaded) return null;'));
  assert.match(panel, /if \(!photoTour\) void read\(\);/);
  const result = readFileSync(new URL('../../../components/designStudio/unified/DesignResult.tsx', import.meta.url), 'utf8');
  assert.match(result, /renderId=\{hero\.id\} photos=\{walkPhotos\} needsRoomPhotos\s/);
  // Only eye-level room pictures are walked: a dollhouse picture (seen from above) has no eye level to enter.
  const walkBlock = result.slice(result.indexOf('const walkPhotos = useMemo'), result.indexOf('const others = data.rooms'));
  assert.doesNotMatch(walkBlock, /kind: 'MASTER'/);
  assert.match(walkBlock, /if \(hero && heroUrl && heroRoomId\)/);
  assert.match(panel, /data-testid="photo3d-rooms-needed"/);
  const depth = readFileSync(new URL('../photo3d/estimateDepth.ts', import.meta.url), 'utf8');
  // Off the page's thread (a slow phone never freezes the page), the picture reduced to the model's size first,
  // and a hard time limit after which the picture still opens.
  assert.match(depth, /new Worker\(new URL\('\.\/depth\.worker\.ts', import\.meta\.url\), \{ type: 'module' \}\)/);
  assert.match(depth, /export const DEPTH_INPUT = 518;/);
  assert.match(depth, /export const DEPTH_TIMEOUT_MS = 40_000;/);
  assert.doesNotMatch(depth, /^import .*@huggingface/m, 'the library lives in the worker, never the main bundle');
  const worker = readFileSync(new URL('../photo3d/depth.worker.ts', import.meta.url), 'utf8');
  assert.match(worker, /device: 'wasm', dtype: 'q8'/);
  const walk = readFileSync(new URL('../../../components/designStudio/unified/PhotoWalk.tsx', import.meta.url), 'utf8');
  assert.match(walk, /new THREE\.MeshBasicMaterial\(\{ map: texture/, 'unlit: the picture\'s own light and colour');
  // A page left open outlives its picture link: the picture is signed afresh when entered, and a failure names its step.
  assert.match(walk, /signedUrls\(\[photo\.key\], 900\)/);
  // The wait says what it is doing, and has the same game as every long wait.
  assert.match(walk, /dsx_photo3d_measuring/);
  assert.match(walk, /const SnakeGame = lazy\(\(\) => import\('@\/components\/games\/SnakeGame'\)\);/);
  assert.match(walk, /setPhase\(\{ kind: 'FAILED', code: stage \}\)/);
});

test('the points to the other rooms stand inside the picture, apart from each other, at about door height', () => {
  for (const n of [1, 2, 3, 5, 8]) {
    const at = Array.from({ length: n }, (_, i) => hotspotAt(i, n));
    for (const p of at) assert.ok(p.u > 0.1 && p.u < 0.9 && p.v > 0.45 && p.v < 0.7, JSON.stringify(p));
    for (let i = 1; i < n; i += 1) assert.ok(at[i].u - at[i - 1].u > 0.07, `n=${n}`);
  }
  assert.deepEqual(hotspotAt(0, 1), { u: 0.5, v: 0.56 });
});

test('one tap makes the whole tour: every missing room at once, one price, one wait, then it opens by itself', () => {
  const result = readFileSync(new URL('../../../components/designStudio/unified/DesignResult.tsx', import.meta.url), 'utf8');
  const create = result.slice(result.indexOf('const createTour = async'), result.indexOf('const createTour = async') + 1200);
  // One price for all of them (each room's confirmed price x the rooms), confirmed before anything is spent.
  assert.match(create, /credits: credits \* run\.roomIds\.length/);
  assert.match(create, /setPending\(/);
  const run = result.slice(result.indexOf('const runTour = async'), result.indexOf('// A tour being made when the page was left'));
  // Every room drawn from the same design references, under the same key a single room would use (never paid twice).
  assert.match(run, /key: roomKey\(roomId, null, run\.refs\)/);
  assert.match(run, /referenceRenderIds: run\.refs/);
  assert.match(run, /confirmedCredits: run\.credits/);
  assert.match(run, /Promise\.all\(Array\.from\(\{ length: Math\.min\(TOUR_PARALLEL/);
  assert.match(run, /setTourOpen\(/);
  assert.doesNotMatch(run, /setHeroId/, 'the design shown stays the design shown');
  // A tour left half-made is followed again only on the same design (a different head would be different rooms).
  assert.match(result, /saved\.headId !== data\.head\.id/);
  const panel = readFileSync(new URL('../../../components/designStudio/unified/WalkthroughPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /data-testid="tour-create"/);
  assert.match(panel, /data-testid="tour-making"/);
  // The wait shows no internal step names: only that it is being prepared.
  const making = panel.slice(panel.indexOf('data-testid="tour-making"'), panel.indexOf('data-testid="tour-create-block"'));
  assert.doesNotMatch(making, /STEP_KEY|STAGE_KEY|reason|code/);
  const walk = readFileSync(new URL('../../../components/designStudio/unified/PhotoWalk.tsx', import.meta.url), 'utf8');
  assert.match(walk, /data-testid="photo-walk-spot"/);
  assert.match(walk, /onClick=\{\(\) => setActiveId\(p\.id\)\}/);
  // Nothing internal on screen: the approximate-depth reason is kept off it.
  assert.doesNotMatch(walk, /photo-walk-approx-reason/);
});
