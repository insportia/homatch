/*
 * THE REFRESH THAT SHOULD NEVER HAVE BEEN NECESSARY.
 *
 * Symptom: open Homatch, leave the tab, a deploy happens, come back and click
 * anything. "Something went wrong on our side. Please refresh the page and
 * try again." Refreshing always worked, which is what made it read as a
 * mystery rather than a build problem.
 *
 * Cause, measured against production on 2026-09-25:
 *
 *     GET https://www.homatch.live/assets/DoesNotExist-abc12345.js
 *     -> 200  text/html
 *
 * vercel.json rewrote everything unmatched to /index.html, including build
 * output. A tab running the previous build asks for a chunk whose hash no
 * longer exists, is handed HTML with 200 OK, refuses it under nosniff
 * ("Expected a JavaScript module script..."), and React.lazy throws into the
 * app error boundary.
 *
 * Two things are tested here because the fix has two halves: the rewrite
 * tells the truth now, and the app recovers the customer from it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { isChunkLoadError } from '../../src/lib/lazyRoute.ts';

test('route 1: the SPA rewrite does not answer for build output', () => {
  const cfg = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const rewrites = cfg.rewrites ?? [];
  assert.equal(rewrites.length, 1, 'expected exactly one SPA rewrite');

  const { source, destination } = rewrites[0];
  assert.equal(destination, '/index.html');
  assert.ok(!/^\/\(\.\*\)$/.test(source),
    'the catch-all rewrite is back: a missing chunk will be served HTML again');
  assert.match(source, /\?!/, 'the rewrite must exclude something');
  assert.match(source, /assets\//, 'the rewrite must exclude /assets/');

  /*
   * And the pattern has to actually behave. Vercel compiles `source` as a
   * regular path pattern, so the exclusion is checked the same way here: a
   * page route still reaches index.html, a chunk does not.
   */
  const re = new RegExp(`^${source}$`);
  for (const path of ['/pricing', '/for-expats', '/property/123', '/']) {
    assert.ok(re.test(path), `${path} must still reach index.html`);
  }
  for (const path of ['/assets/index-JKgg8yk_.js', '/assets/PricingPage-Ab12Cd34.js']) {
    assert.ok(!re.test(path), `${path} must NOT be rewritten to index.html`);
  }
});

test('route 2: a missing chunk is recognised however the browser words it', () => {
  /* Every engine words this differently and none of them use a code. */
  const missing = [
    'Failed to fetch dynamically imported module: https://x/assets/a.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
    "Expected a JavaScript module script but the server responded with a MIME type of \"text/html\".",
    "Refused to execute script: 'text/html' is not a valid JavaScript MIME type.",
  ];
  for (const message of missing) {
    assert.ok(isChunkLoadError(new Error(message)), `not recognised: ${message}`);
  }
  assert.ok(isChunkLoadError(Object.assign(new Error('boom'), { name: 'ChunkLoadError' })));
});

test('route 3: an ordinary page error is NOT treated as a missing chunk', () => {
  /*
   * The narrow match is the point. A page that throws for its own reasons
   * must reach the error boundary and be seen, not be hidden behind a reload
   * that makes a real bug look intermittent.
   */
  for (const message of [
    "Cannot read properties of undefined (reading 'filter')",
    'Network request failed',
    'Unauthorized',
    'Maximum update depth exceeded',
  ]) {
    assert.equal(isChunkLoadError(new Error(message)), false, `wrongly treated as a chunk error: ${message}`);
  }
  assert.equal(isChunkLoadError(null), false);
  assert.equal(isChunkLoadError(undefined), false);
});

test('route 4: every route is loaded through the recovering loader', () => {
  /*
   * 122 lazy routes. One of them left on bare React.lazy is one page that
   * still shows the error screen after a deploy, and it would be whichever
   * page nobody tested.
   */
  const routes = readFileSync('src/routes.tsx', 'utf8');
  const bare = routes.match(/(?<![a-zA-Z])lazy\(\(\) => import\(/g) ?? [];
  assert.deepEqual(bare, [], 'a route still uses bare React.lazy and will not recover from a deploy');
  assert.match(routes, /import \{ lazyRoute \} from '@\/lib\/lazyRoute'/);
  assert.ok((routes.match(/lazyRoute\(\(\) => import\(/g) ?? []).length > 100,
    'the lazy routes have gone missing');
});

test('route 5: the app scrolls new pages to the top, and leaves back alone', () => {
  const src = readFileSync('src/components/common/ScrollToTop.tsx', 'utf8');

  /* Back and forward restore where the person was: that is what back means. */
  assert.match(src, /navigationType === 'POP'/, 'back/forward must keep its restored position');
  /* An anchor asked for an element, not the top. */
  assert.match(src, /if \(hash\) return/, 'anchor links must not be dragged to the top');
  /*
   * Keyed on pathname, never on search. A tab, filter or pagination control
   * that writes to the query must not yank the viewport while somebody reads.
   */
  const deps = src.match(/\}, \[([^\]]*)\]\);/);
  assert.ok(deps, 'expected a dependency array');
  assert.ok(!/search/.test(deps[1]), 'scrolling on ?query changes would fight tabs and filters');
  assert.match(deps[1], /pathname/);

  /*
   * Read the render, not the file: App.tsx EXPLAINS <Routes> in a comment
   * above the component, and a test that cannot tell an explanation from the
   * code punishes writing the reason down.
   */
  const app = readFileSync('src/App.tsx', 'utf8');
  const render = app.split('\n').find((l) => l.includes('const App') && l.includes('<Routes>'));
  assert.ok(render, 'could not find the App render');
  assert.match(render, /<ScrollToTop\/>/, 'ScrollToTop is not mounted');
  assert.ok(render.indexOf('<ScrollToTop/>') < render.indexOf('<Routes>'),
    'ScrollToTop must sit outside <Routes> so a route change cannot remount it');
});
