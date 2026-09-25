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

test('expat 1: every Expat page renders the Homatch header and footer', () => {
  for (const page of PAGES) {
    const src = readFileSync(page, 'utf8');
    assert.match(src, /<PublicHeader links=\{headerLinks\}/, `${page} has no Homatch header`);
    assert.match(src, /<SiteFooter \/>/, `${page} has no Homatch footer`);
    assert.match(src, /usePublicNavLinks\(\)/, `${page} is not using the one navigation`);
  }
});

test('expat 2: the header is solid, because these heroes are not black', () => {
  /*
   * PublicHeader's transparent state only works over a full-bleed black
   * hero; ExpatHero is a light workspace canvas, so transparent would render
   * the logo and the navigation white on white — which is how a header
   * disappears.
   */
  for (const page of PAGES) {
    const src = readFileSync(page, 'utf8');
    assert.match(src, /<PublicHeader links=\{headerLinks\} solid \/>/, `${page} would render an invisible header`);
    assert.match(src, /<HeaderSpacer \/>/, `${page} would render content under the fixed header`);
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
