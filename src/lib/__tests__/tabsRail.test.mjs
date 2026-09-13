import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * TAB LABELS DO NOT SIT ON TOP OF EACH OTHER.
 *
 * The Verification Center's section selector rendered five labels across a
 * 390px phone with each one overflowing its neighbour. It looked like a
 * styling problem in that screen and was a flex default in the primitive:
 *
 *   TabsList  inline-flex, fixed h-9
 *   TabsTrigger  whitespace-nowrap, no shrink-0
 *
 * Flex children shrink by default. Five triggers were each squeezed to a
 * fifth of the rail while whitespace-nowrap refused to let the text follow,
 * so every label ran across the one beside it. Screens that had noticed the
 * symptom added `overflow-x-auto` to the list and nothing changed, because
 * there was no overflow to scroll: the boxes had obediently shrunk to fit.
 *
 * This guards the two properties that make a scrolling rail possible, in the
 * primitive rather than in each screen that uses it. It reads the source
 * because these are Tailwind classes on a .tsx module — there is no runtime
 * here to render and measure, and the browser gates that DO measure are the
 * slow ones.
 */

const SRC = readFileSync(new URL('../../components/ui/tabs.tsx', import.meta.url), 'utf8');

/** The className argument of one forwardRef component in that file. */
function classesOf(component) {
  const at = SRC.indexOf(`const ${component} = React.forwardRef`);
  assert.ok(at > -1, `${component} is no longer declared the way this test reads it`);
  const body = SRC.slice(at, at + 1600);
  const quoted = body.match(/"([^"]*inline-flex[^"]*)"/);
  assert.ok(quoted, `${component} no longer has a literal class string`);
  return quoted[1];
}

test('a tab keeps its width, so the rail can overflow and scroll', () => {
  const trigger = classesOf('TabsTrigger');
  assert.match(trigger, /\bshrink-0\b/,
    'TabsTrigger shrinks: five labels on a phone will squeeze and overlap instead of scrolling');
  assert.match(trigger, /\bwhitespace-nowrap\b/,
    'a tab label that wraps mid-word is a different bug, but it is still a bug');
});

test('a tab is big enough to hit with a thumb', () => {
  const trigger = classesOf('TabsTrigger');
  assert.match(trigger, /\bmin-h-\d/,
    'TabsTrigger has no minimum height: on a phone it is a 26px target');
});

test('the rail can grow, so a wrapping caller is not clipped', () => {
  const list = classesOf('TabsList');
  assert.match(list, /\bmin-h-\d/,
    'TabsList has a fixed height: a caller that wants labels to wrap gets them cut off');
  // A class, not a substring: \b matches inside `min-h-9`, because a hyphen
  // is a word boundary. Whitespace or the ends of the string are what
  // actually separate Tailwind classes.
  assert.equal(/(^|\s)h-9(\s|$)/.test(list), false,
    'TabsList is back to a fixed h-9, which clips anything taller than one line');
});
