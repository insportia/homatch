// THE WALKTHROUGH AS A CUSTOMER SEES IT (the viewer's own source, read as text — the browser QA walks it).
// A real customer, in a real browser, met: a gold wireframe cube around whatever the screen centre rested on,
// walking that crawled on a device drawing few frames a second (each frame moved at most 50 ms of walk), a closed
// balcony door the tour had been planned as open, an evening design that read as a muddy interior, two toolbars,
// a row of room chips and a hint over the view, and an arrival wedged behind the sofa. Each is held here.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = (p) => fs.readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
const scene = src('components/designStudio/canvas/SceneController.ts');
const overlay = src('components/designStudio/workspace/WalkthroughOverlay.tsx');
const workspace = src('components/designStudio/workspace/DesignWorkspace.tsx');
const director = src('lib/designStudio/cameraDirector.ts');

test('no helper geometry while walking: no aim box, no hover outline, no drawn wall edges', () => {
  assert.doesNotMatch(scene, /this\.aimBox = new THREE\.Box3Helper/, 'the aimed piece is never boxed');
  assert.match(scene, /this\.hoverOutline = this\.walk \? null : this\.outlineFor\(target, TONE\.hover\);/);
  assert.match(scene, /for \(const edges of this\.wallEdges\) edges\.visible = false;/);
  assert.match(scene, /for \(const edges of this\.wallEdges\) edges\.visible = true;/);
});

test('walking keeps a person\'s pace on a slow device: real time, in ≤ 50 ms steps, and the walk lightens itself', () => {
  assert.match(scene, /const WALK_MAX_FRAME_S = 0\.25;/);
  assert.match(scene, /const WALK_STEP_S = 0\.05;/);
  assert.match(scene, /let left = Math\.min\(WALK_MAX_FRAME_S, Math\.max\(0, \(now - w\.last\) \/ 1000\)\);/);
  assert.match(scene, /const more = this\.stepWalkOnce\(now, dt\);/);
  assert.doesNotMatch(scene, /const dt = Math\.min\(0\.05, Math\.max\(0, \(now - w\.last\) \/ 1000\)\);/, 'one frame never caps the walk at 50 ms again');
  // Slow frames drop the finishing pass, then shadows, then pixel density — and leaving the walk restores them.
  assert.match(scene, /const WALK_SLOW_FRAME_MS = 40;/);
  assert.match(scene, /this\.draw\(this\.walk && this\.walkLighter > 0 \? false : undefined\);/);
  assert.match(scene, /if \(this\.walkLighter >= 2\) this\.sun\.castShadow = false;/);
  assert.match(scene, /this\.sun\.castShadow = this\.quality\.shadows;\n\s+this\.renderer\.setPixelRatio\(Math\.min\(window\.devicePixelRatio \|\| 1, this\.quality\.maxPixelRatio\)\);/);
});

test('the tour as planned: balcony doors open on arrival, and an evening design is walked in daylight', () => {
  assert.match(scene, /if \(e\.doorId && e\.machine\.role === 'BALCONY_DOOR' && model\.closedDoors\.has\(e\.doorId\)\) this\.living\.act\(e\.key, 'OPEN'\);/);
  assert.match(scene, /if \(!this\.envOverride && \(designed === 'EVENING' \|\| designed === 'NIGHT'\)\) this\.setEnvironment\('DAY', false\);/);
});

test('one quiet bar: the room, Plan, More and Exit — no room chips, no editor toolbar over a tour', () => {
  assert.match(overlay, /data-testid="walk-more"/);
  assert.match(overlay, /data-testid="walk-more-menu"/);
  for (const id of ['walk-live', 'walk-time', 'walk-back', 'walk-entrance', 'walk-controls']) {
    const at = overlay.indexOf(`data-testid="${id}"`);
    assert.ok(at > overlay.indexOf('data-testid="walk-more-menu"'), `${id} is in the More menu`);
  }
  assert.doesNotMatch(overlay, /<nav aria-label=\{tr\('ds_walk_rooms'\)\}/, 'no row of room chips');
  assert.match(workspace, /\{startWalkthrough && walking \? null : \(\n\s+<header/);
});

test('the visitor arrives in open floor, never wedged against a piece', () => {
  assert.match(director, /export const STANCE_CLEAR_M = 0\.6;/);
  assert.match(director, /if \(strict && clearOfPieces\(at\) < STANCE_CLEAR_M\) continue;/);
  assert.match(director, /- \(blocked \? 2\.5 : 0\);/);
});
