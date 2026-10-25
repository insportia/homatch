import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decideScroll, entryName, rememberPosition, recallPosition } from '../scrollMemory.ts';

/*
 * WHERE A PAGE STARTS.
 *
 * Owner, 2026-10-25: "when I pick any service it lands at the bottom, or where
 * I was before, not at the top as standard. It jumps here and there." These are
 * the four answers, as one pure function.
 */

const go = (over) => decideScroll({ previousPath: '/', previousHash: '', pathname: '/investment', hash: '', navigationType: 'PUSH', ...over });

test('a new page starts at its top, by link or by redirect', () => {
  assert.equal(go({}), 'TOP');
  assert.equal(go({ navigationType: 'REPLACE' }), 'TOP');
});

test('back and forward return to where the person was', () => {
  assert.equal(go({ navigationType: 'POP' }), 'RESTORE');
  /* The first load is a POP too: a reload of the same entry restores. */
  assert.equal(go({ previousPath: null, navigationType: 'POP' }), 'RESTORE');
});

test('a link to an anchor lands on the anchor, never the top', () => {
  assert.equal(go({ hash: '#sources' }), 'ANCHOR');
  /* Same page, a different section. */
  assert.equal(go({ previousPath: '/about', pathname: '/about', previousHash: '#what', hash: '#market' }), 'ANCHOR');
});

test('a tab, filter or page of results that writes the query never moves the page', () => {
  assert.equal(go({ previousPath: '/investment', pathname: '/investment' }), 'NONE');
  assert.equal(go({ previousPath: '/investment', pathname: '/investment', navigationType: 'REPLACE' }), 'NONE');
  assert.equal(go({ previousPath: '/investment', pathname: '/investment', navigationType: 'POP' }), 'NONE');
});

test('positions are remembered per history entry, and a shared "default" entry is told apart by path', () => {
  const store = new Map();
  globalThis.window = { sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) } };
  rememberPosition('abc123', 1840.6);
  assert.equal(recallPosition('abc123'), 1841);
  assert.equal(recallPosition('zzz'), null);
  /* React Router's name for an entry it did not create is never a key on its own. */
  rememberPosition('default', 500);
  assert.equal(recallPosition('default'), null);
  assert.equal(entryName('default', '/'), 'default:/');
  rememberPosition(entryName('default', '/'), 700);
  assert.equal(recallPosition('default:/'), 700);
  assert.equal(entryName('k1', '/x'), 'k1');
  delete globalThis.window;
});
