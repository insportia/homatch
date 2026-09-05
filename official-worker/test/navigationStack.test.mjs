// navigationStack.test.mjs — browser/NavigationStack.ts, ported unchanged
// from the pre-refactor lib/navigationStack.js's test suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NavigationStack, normalizeKey } from '../.tstest-build/browser/NavigationStack.js';

test('normalizeKey: strips volatile tracking params but keeps real ones', () => {
  assert.equal(normalizeKey('https://x.ge/doc?id=7&t=12345'), normalizeKey('https://x.ge/doc?id=7&t=99999'));
  assert.notEqual(normalizeKey('https://x.ge/doc?id=7'), normalizeKey('https://x.ge/doc?id=8'));
});
test('normalizeKey: non-URL synthetic ids normalize by case/whitespace only', () => {
  assert.equal(normalizeKey('Grid Row 7'), normalizeKey('grid row 7'));
});

test('enter: returns true for a new node, false (and skips) for an already-visited one', () => {
  const nav = new NavigationStack('ROOT');
  assert.equal(nav.enter('row1', 'https://x.ge/1'), true);
  assert.equal(nav.enter('row1-again', 'https://x.ge/1'), false);
  assert.equal(nav.visitedCount(), 1);
});

test('enter/back: maintains a correct breadcrumb path', () => {
  const nav = new NavigationStack('RESULTS');
  nav.enter('Result 1', 'r1');
  nav.enter('Document A', 'r1-a');
  assert.deepEqual(nav.currentPath(), ['RESULTS', 'Result 1', 'Document A']);
  nav.back();
  assert.deepEqual(nav.currentPath(), ['RESULTS', 'Result 1']);
  nav.back();
  assert.deepEqual(nav.currentPath(), ['RESULTS']);
});

test('back at root: no-ops rather than throwing', () => {
  const nav = new NavigationStack('ROOT');
  nav.back();
  nav.back();
  assert.deepEqual(nav.currentPath(), ['ROOT']);
});

test('hasVisited: global loop guard independent of current parent', () => {
  const nav = new NavigationStack('ROOT');
  nav.enter('A', 'x');
  nav.back();
  assert.ok(nav.hasVisited('x'));
});

test('trace: records ENTER/BACK/SKIP_ALREADY_VISITED in order', () => {
  const nav = new NavigationStack('ROOT');
  nav.enter('A', 'a');
  nav.enter('A-again', 'a');
  nav.back();
  const actions = nav.trace().map((t) => t.action);
  assert.deepEqual(actions, ['ENTER', 'SKIP_ALREADY_VISITED', 'BACK']);
});

test('18-row exhaustive traversal never revisits a node (the TAS regression scenario)', () => {
  const nav = new NavigationStack('TAS_RESULTS');
  for (let i = 0; i < 18; i++) {
    assert.equal(nav.enter(`row-${i}`, `https://tas.ge/doc?id=${i}`), true);
    nav.back();
  }
  assert.equal(nav.visitedCount(), 18);
  // Re-entering row-5 a second time (e.g. a stale re-render) must be
  // recognized as already visited, never double-counted.
  assert.equal(nav.enter('row-5-again', 'https://tas.ge/doc?id=5'), false);
  assert.equal(nav.visitedCount(), 18);
});
