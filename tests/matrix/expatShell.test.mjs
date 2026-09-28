/*
 * FOR EXPATS IS PART OF HOMATCH, AND HAS TO LOOK LIKE IT.
 *
 * All three Expat pages rendered a bare fragment — no header, no footer, no
 * way back. A visitor arriving from a search result was inside what felt like
 * a separate product, with the rest of Homatch unreachable and nothing on
 * screen saying where they were.
 *
 * These tests are about the SHELL, not the content: the content is batch F.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PAGES = [
  'src/pages/ForExpatsPage.tsx',
  'src/pages/ExpatTopicPage.tsx',
  'src/pages/ExpatPlanPage.tsx',
];

test('expat 1: every Expat page renders inside the shared shell', () => {
  /*
   * These pages used to hand-roll PublicHeader + SiteFooter, which was an
   * improvement over the bare fragments they started as — but it also
   * meant a SIGNED-IN customer opening Expats from the sidebar fell out of
   * the product shell entirely: no sidebar, no way back. AppLayout gives
   * both audiences the right chrome: the customer shell when signed in,
   * the sticky public header and footer when not.
   */
  for (const page of PAGES) {
    const src = readFileSync(page, 'utf8');
    assert.match(src, /<AppLayout noPadding>/, `${page} is not inside the shared shell`);
    assert.doesNotMatch(src, /<PublicHeader/, `${page} must not hand-roll a second header`);
    assert.doesNotMatch(src, /<SiteFooter/, `${page} must not hand-roll a second footer`);
  }
});

test('expat 2: the loading and missing states keep the shell too', () => {
  /* A skeleton with no chrome is how the mobile sweep once recorded
     "rendered nothing" at 320px. Every early return wears the layout. */
  for (const page of ['src/pages/ExpatPlanPage.tsx', 'src/pages/ExpatTopicPage.tsx']) {
    const src = readFileSync(page, 'utf8');
    const returns = src.split('return (').length - 1;
    const shells = src.split('<AppLayout noPadding>').length - 1;
    assert.ok(shells >= 2, `${page}: early-return states must render inside AppLayout as well (${shells})`);
  }
});

test('expat 3: the long page says where you are inside it', () => {
  /* Four sections, and the hero's own pathway rows point at all four. */
  const src = readFileSync('src/pages/ForExpatsPage.tsx', 'utf8');
  assert.match(src, /<LocalSectionNav/);
  for (const id of ['cost-of-living', 'budget', 'topics', 'tools']) {
    assert.ok(src.includes(`id: '${id}'`), `${id} is missing from the page navigation`);
    assert.ok(src.includes(`id="${id}"`), `${id} is navigated to but never rendered`);
  }
});

test('expat 4: local navigation is anchors, not scroll handlers', () => {
  /*
   * Real anchors work with the keyboard, with middle-click, with "copy link
   * address" and with the back button. A click handler calling scrollIntoView
   * does none of that, and this is the component the editorial pages in the
   * later batches will reuse.
   */
  const nav = readFileSync('src/components/common/LocalSectionNav.tsx', 'utf8');
  assert.match(nav, /href=\{`#\$\{section\.id\}`\}/, 'the section links are not real anchors');
  assert.match(nav, /aria-label=\{t\(ariaLabelKey\)\}/, 'the nav has no accessible name');
  assert.ok(!/onClick/.test(nav), 'a click handler is standing in for an anchor');

  /* ScrollToTop must keep leaving hashes alone, or none of these would land. */
  const scroll = readFileSync('src/components/common/ScrollToTop.tsx', 'utf8');
  assert.match(scroll, /if \(hash\) return/, 'anchors would be dragged back to the top');
});

test('expat 5: no Expat page invents a navigation of its own', () => {
  /* The whole point of the shell is that there is one navigation. */
  for (const page of PAGES) {
    const src = readFileSync(page, 'utf8');
    assert.ok(!/HeaderLink\[\] = \[/.test(src), `${page} declares its own header links`);
  }
});
