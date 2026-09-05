import assert from 'node:assert/strict';
import { NavigationStack, normalizeKey } from '../src/lib/navigationStack.js';

let n = 0;
function t(name, fn) { n++; fn(); console.log(`ok - ${name}`); }

t('normalizeKey: strips volatile session/cache-busting params, keeps real ones', () => {
  const a = normalizeKey('https://tas.ge/doc?id=7&sid=abc123');
  const b = normalizeKey('https://tas.ge/doc?id=7&sid=zzz999');
  assert.equal(a, b); // same underlying doc, different session param
  const c = normalizeKey('https://tas.ge/doc?id=8&sid=abc123');
  assert.notEqual(a, c); // genuinely different document id
});

t('normalizeKey: falls back to whitespace/case normalization for non-URL ids', () => {
  assert.equal(normalizeKey('  Result #7 '), normalizeKey('result #7'));
});

t('NavigationStack: linear traversal RESULTS -> RESULT#7 -> DOC#1 -> back -> DOC#2 -> back -> back -> RESULT#8', () => {
  const nav = new NavigationStack('TAS_RESULTS');
  assert.ok(nav.enter('RESULT #7', 'row-7'));
  assert.ok(nav.enter('DOCUMENT #1', 'https://tas.ge/doc/1'));
  nav.back();
  assert.ok(nav.enter('DOCUMENT #2', 'https://tas.ge/doc/2'));
  nav.back();
  nav.back();
  assert.ok(nav.enter('RESULT #8', 'row-8'));
  assert.deepEqual(nav.currentPath(), ['TAS_RESULTS', 'RESULT #8']);
  assert.equal(nav.visitedCount(), 4); // row-7, doc/1, doc/2, row-8
});

t('NavigationStack: re-entering an already-visited node is refused (loop guard)', () => {
  const nav = new NavigationStack('ROOT');
  assert.ok(nav.enter('A', 'https://x.ge/a'));
  assert.equal(nav.enter('A again', 'https://x.ge/a'), false); // same url, different label — still refused
  assert.equal(nav.visitedCount(), 1);
});

t('NavigationStack: back() at root does not throw or go negative', () => {
  const nav = new NavigationStack('ROOT');
  nav.back();
  nav.back();
  assert.deepEqual(nav.currentPath(), ['ROOT']);
});

t('NavigationStack: hasVisited checks globally, not just current path', () => {
  const nav = new NavigationStack('ROOT');
  nav.enter('A', 'https://x.ge/a');
  nav.back();
  assert.equal(nav.hasVisited('https://x.ge/a'), true);
});

t('NavigationStack: trace records ENTER/BACK/SKIP in order', () => {
  const nav = new NavigationStack('ROOT');
  nav.enter('A', 'https://x.ge/a');
  nav.enter('A', 'https://x.ge/a'); // skipped
  nav.back();
  const actions = nav.trace().map(x => x.action);
  assert.deepEqual(actions, ['ENTER', 'SKIP_ALREADY_VISITED', 'BACK']);
});

console.log(`\n${n} passed`);
