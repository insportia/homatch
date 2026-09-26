// THE AUDIT THAT MAKES "WE MIGRATED THE WRONG SCREEN" A TEST FAILURE.
//
// 151 routes. A design migration across that many is a way to break a working product,
// so the classification is written down before anything is rewritten and these tests
// keep it honest. Three things they refuse to allow:
//
//   a PROTECTED surface appearing in the migratable set
//   a classified path that does not exist in the router
//   a status or note that says nothing
//
// What they deliberately do NOT do is require every one of the 151 routes to be
// classified. The Communications area alone is ~35 near-identical sub-routes sharing
// one shell; enumerating them would turn a decision document into a directory. What is
// required is that every surface the classification CLAIMS to cover really exists, and
// that the protected ones are unmistakable.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  SURFACES,
  customerCriticalPaths,
  migratablePaths,
  protectedPaths,
  statusOf,
} from '../../src/surfaces/classification.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const routesSource = readFileSync(join(root, 'src', 'routes.tsx'), 'utf8');

/** Every path the router actually registers. */
function routerPaths() {
  return new Set(
    [...routesSource.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]),
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * The classification describes the real product
 * ──────────────────────────────────────────────────────────────────────── */

test('every classified path is a route the application actually has', () => {
  // A classification of a path that does not exist is a decision about nothing, and it
  // rots silently -- the surface it was meant to protect may have been renamed.
  const real = routerPaths();
  const missing = SURFACES.map((s) => s.path).filter((p) => !real.has(p));
  assert.deepEqual(missing, [], `classified paths that no longer exist: ${missing.join(', ')}`);
});

test('no path is classified twice', () => {
  const seen = SURFACES.map((s) => s.path);
  assert.equal(new Set(seen).size, seen.length, 'a path has two conflicting statuses');
});

test('every surface carries a real reason, not a placeholder', () => {
  for (const surface of SURFACES) {
    assert.ok(surface.note.length > 40, `${surface.path} has a stub note`);
    assert.equal(
      /TODO|TBD|\?\?\?|placeholder/i.test(surface.note), false,
      `${surface.path} hedges instead of deciding`,
    );
  }
});

/* ────────────────────────────────────────────────────────────────────────
 * PROTECTED means protected
 * ──────────────────────────────────────────────────────────────────────── */

test('the three protected surfaces are all classified PROTECTED', () => {
  // Named individually rather than counted, so a future edit cannot quietly reclassify
  // one and still satisfy a length check.
  assert.equal(statusOf('/dashboard'), 'PROTECTED', 'MAIN DASHBOARD');
  assert.equal(statusOf('/verify'), 'PROTECTED', 'VERIFY');
  assert.equal(statusOf('/verify/:id'), 'PROTECTED', 'a paid Verify result');
});

test('no protected surface is in the migratable set', () => {
  // The assertion the whole file exists for.
  const overlap = protectedPaths().filter((p) => migratablePaths().includes(p));
  assert.deepEqual(overlap, [], `PROTECTED surfaces offered up for migration: ${overlap.join(', ')}`);
});

test('the benchmark is not itself migratable', () => {
  // /investment is the reference. Being the reference is not a reason to rewrite it,
  // and APPROVED_CURRENT_DESIGN is not in the migratable set.
  assert.equal(statusOf('/investment'), 'APPROVED_CURRENT_DESIGN');
  assert.equal(migratablePaths().includes('/investment'), false);
});

test('no admin or developer route is classified as a customer surface', () => {
  // Admin global design is protected and the developer product is a separate audience.
  // Either appearing here would mean a customer migration wave could reach it.
  for (const surface of SURFACES) {
    assert.equal(
      surface.path.startsWith('/admin'), false,
      `${surface.path} is an admin route and must not be in the customer classification`,
    );
    assert.equal(
      surface.path.startsWith('/developers'), false,
      `${surface.path} belongs to the developer product`,
    );
  }
});

/* ────────────────────────────────────────────────────────────────────────
 * The four that must be migrated, and why
 * ──────────────────────────────────────────────────────────────────────── */

test('the money screen is NEEDS_MIGRATION and says why', () => {
  const matches = SURFACES.find((s) => s.path === '/property/:id/matches');
  assert.ok(matches);
  assert.equal(matches.status, 'NEEDS_MIGRATION');
  assert.equal(matches.customerCritical, true);
  /* The reason has to name the actual defect, or the next person migrates the styling
     and leaves the double-sell in place. */
  assert.match(matches.note, /Locked\/Unlock/);
  assert.match(matches.note, /double-sells/);
  assert.match(matches.note, /redaction underneath is correct/);
});

test('the two AI-facing surfaces are queued for migration', () => {
  assert.equal(statusOf('/ai'), 'NEEDS_MIGRATION');
  assert.equal(statusOf('/active-search'), 'NEEDS_MIGRATION');
});

/* ────────────────────────────────────────────────────────────────────────
 * The matrix scope is a decision, not an accident
 * ──────────────────────────────────────────────────────────────────────── */

test('the customer-critical set is small enough to measure and large enough to matter', () => {
  /*
   * Four widths x six locales is 24 renders per surface. The existing harness takes
   * ~85 seconds for about 30 combinations, so the whole 83 customer+public surfaces
   * would be roughly half an hour -- a gate nobody runs is not a gate.
   */
  const critical = customerCriticalPaths();
  assert.ok(critical.length >= 8, `only ${critical.length} surfaces are customer-critical`);
  assert.ok(critical.length <= 20, `${critical.length} surfaces x 24 renders is too slow to gate`);
});

test('every surface where money or intent is handled is customer-critical', () => {
  // The four unconditional ones: money changes hands, the customer states what they
  // want, they read what we found, and the price is quoted.
  for (const path of ['/property/:id/matches', '/credits', '/active-search', '/pricing']) {
    const surface = SURFACES.find((s) => s.path === path);
    assert.ok(surface, `${path} is not classified at all`);
    assert.equal(surface.customerCritical, true, `${path} must be in the mobile matrix`);
  }
});

test('the RTL-first product stays in the matrix permanently', () => {
  // For Expats is the one product written for people who will read it in Arabic and
  // Hebrew. If it ever leaves the matrix, the RTL axis loses its best test case.
  const expats = SURFACES.find((s) => s.path === '/for-expats/georgia');
  assert.ok(expats);
  assert.equal(expats.customerCritical, true);
  assert.match(expats.note, /Arabic and Hebrew/);
});
