// STEP INSIDE THE PICTURE: the selected picture made 3D from its own pixels.
// From the picture's viewpoint the mesh IS the picture (every vertex lands on
// its own pixel); nothing is stretched across a jump in depth; the walk stays
// where a single picture still holds.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clampWalk, EDGE_RATIO, PHOTO_CAMERAS, photoMesh, walkBounds } from '../photo3d/depthMesh.ts';

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
  const result = readFileSync(new URL('../../../components/designStudio/unified/DesignResult.tsx', import.meta.url), 'utf8');
  assert.match(result, /renderId=\{hero\.id\} photos=\{walkPhotos\}/);
  const depth = readFileSync(new URL('../photo3d/estimateDepth.ts', import.meta.url), 'utf8');
  assert.match(depth, /await import\('@huggingface\/transformers'\)/);
  assert.doesNotMatch(depth, /^import .*@huggingface/m, 'never a static import (it would enter the main bundle)');
  const walk = readFileSync(new URL('../../../components/designStudio/unified/PhotoWalk.tsx', import.meta.url), 'utf8');
  assert.match(walk, /new THREE\.MeshBasicMaterial\(\{ map: texture/, 'unlit: the picture\'s own light and colour');
});
