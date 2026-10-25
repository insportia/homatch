import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*
 * NO JUMPS.
 *
 * Owner, 2026-10-25: picking a service in Investment opened it "at the bottom,
 * or where I was before", and pages "jump here and there". Three causes, each
 * guarded here so it cannot quietly come back:
 *
 *   1. A screen that replaces itself without a URL change (Investment's
 *      strategy picker → workspace) never told ScrollToTop it was a new page.
 *   2. Back relied on the browser, which restores before the lazy route and
 *      its data exist, so the offset was clamped to a short page.
 *   3. Chats followed their newest message with scrollIntoView, which scrolls
 *      the WINDOW too, so a conversation box pulled the page down to itself.
 */

const read = (p) => readFileSync(p, 'utf8');

test('ScrollToTop decides with the tested rule and restores back itself', () => {
  const src = read('src/components/common/ScrollToTop.tsx');
  assert.match(src, /decideScroll\(/, 'ScrollToTop no longer uses the tested decision');
  assert.match(src, /scrollRestoration = 'manual'/, 'the browser would restore too early again');
  assert.match(src, /recallPosition\(/, 'back no longer returns to the remembered position');
  assert.match(src, /rememberPosition\(/, 'positions are no longer remembered');
  /* It gives up the moment the person takes over: restoring must never fight a finger. */
  assert.match(src, /'wheel', 'touchstart', 'keydown', 'pointerdown'/);
  /* A #hash waits for its element, which arrives with the lazy route. */
  assert.match(src, /getElementById\(id\)/);
});

test('Investment starts each strategy at its top', () => {
  const page = read('src/pages/InvestmentPage.tsx');
  assert.match(page, /useScrollTopOnChange\(strategy/, 'choosing a strategy keeps the old scroll position again');
  /* Before the early return, or the hook order changes between the two screens. */
  assert.ok(page.indexOf('useScrollTopOnChange(') < page.indexOf('if (!strategy || !run)'));
  const hook = read('src/hooks/useScrollTopOnChange.ts');
  assert.match(hook, /Object\.is\(last\.current, view\)/, 'the hook would jump on first render');
});

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { if (entry !== '__tests__') out.push(...walk(full)); }
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

test('no chat follows its newest message by scrolling the whole page', () => {
  /* bottomRef / endRef / threadEnd are the end-of-list anchors; scrollIntoView on
     one of them scrolls every ancestor including the window. followLatest
     scrolls only the message box (src/lib/scrollWithin.ts). */
  const offenders = [];
  for (const file of walk('src')) {
    const src = read(file);
    for (const m of src.matchAll(/\b(bottomRef|endRef)\.current\?\.scrollIntoView\(/g)) {
      offenders.push(`${file.replace(/\\/g, '/')}: ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, [], 'use followLatest() from src/lib/scrollWithin.ts instead');
  const helper = read('src/lib/scrollWithin.ts');
  assert.match(helper, /if \(!opts\.allowPage\) return;/, 'followLatest may scroll the window by default again');
});
