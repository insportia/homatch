import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STYLE_AXES, cleanStyle, defaultStyle, makeSection, normalizeSection } from '../model.ts';
import { styleMark } from '../style.ts';

/*
 * STYLE PRESETS — set a section without being able to break it.
 *
 * Ten axes an admin can change, each a closed list of named steps. The
 * argument for letting anybody change presentation at all rests on three
 * properties, and this file is those three.
 *
 *   NOTHING AN ADMIN PICKS REACHES THE DOM AS A VALUE. Every step becomes a
 *   data attribute the stylesheet has a rule for, or one of two custom
 *   properties that are read with a fallback. There is no path from the
 *   editor to a colour, a shadow or a length, so there is no path to one that
 *   fails contrast or breaks the grid.
 *
 *   AN UNKNOWN STEP IS THE DEFAULT. A typo, a value from a newer build, a
 *   direct database write: all of them render the section as designed rather
 *   than as a class that matches no rule. The failure mode of a preset system
 *   must not be a section with no background.
 *
 *   A SECTION NOBODY HAS STYLED IS UNCHANGED. Every axis at 'default' emits
 *   no attribute and no property at all — the same DOM as before presets
 *   existed. That is what made it safe to add to a live site.
 */

const AXES = Object.keys(STYLE_AXES);

test('the vocabulary is the ten the product offers', () => {
  /* Eight here, plus theme and spacing which predate this and live on the
     section directly. Changing this list is a design decision, not a
     refactor, so it is written down twice on purpose. */
  assert.deepEqual(AXES.sort(), [
    'accent', 'align', 'cardStyle', 'density', 'mediaRatio', 'surface', 'textAlign', 'width',
  ]);
  for (const axis of AXES) {
    assert.equal(STYLE_AXES[axis][0], 'default',
      `${axis} does not start at 'default', so an unstyled section is not the designed one`);
  }
});

test('a fresh section is default on every axis', () => {
  const section = makeSection('hero', 'h1');
  assert.deepEqual(section.style, defaultStyle());
  for (const axis of AXES) assert.equal(section.style[axis], 'default');
});

test('an unstyled section emits no attributes and no properties at all', () => {
  const mark = styleMark(defaultStyle());
  assert.deepEqual(mark.attrs, {});
  assert.deepEqual(mark.style, {});
  assert.equal(mark.className, '');
});

test('a section saved before presets existed styles as designed', () => {
  // No `style` key at all — every page stored until today.
  const mark = styleMark(undefined);
  assert.deepEqual(mark.attrs, {});
  assert.deepEqual(mark.style, {});
});

test('every step of every axis resolves to an attribute or a property', () => {
  /* The inverse of the rule above, and the one that catches an axis added to
     the vocabulary and never wired to anything: a control that changes
     nothing is worse than a missing control, because it looks like it works. */
  for (const axis of AXES) {
    for (const step of STYLE_AXES[axis]) {
      if (step === 'default') continue;
      const mark = styleMark({ ...defaultStyle(), [axis]: step });
      const emitted = Object.keys(mark.attrs).filter(k => k !== 'data-hm-style').length
        + Object.keys(mark.style).length;
      assert.ok(emitted > 0, `${axis}='${step}' produces nothing`);
    }
  }
});

test('an unknown step is refused on the way in, not rendered', () => {
  const cleaned = cleanStyle({ surface: 'neon', width: 'enormous', accent: 'gold-plated' });
  assert.equal(cleaned.surface, 'default');
  assert.equal(cleaned.width, 'default');
  assert.equal(cleaned.accent, 'default');
});

test('an unknown step that gets past cleaning still renders as designed', () => {
  // Belt and braces: styleMark re-checks rather than trusting its input.
  const mark = styleMark({ ...defaultStyle(), surface: 'neon' });
  assert.equal(mark.attrs['data-hm-surface'], undefined);
});

test('a stored style survives a round trip through normalization', () => {
  const raw = {
    id: 's1', type: 'hero', variant: 'default',
    style: { surface: 'muted', width: 'narrow', cardStyle: 'elevated' },
  };
  const section = normalizeSection(raw, {
    knownTypes: ['hero'], variantsFor: () => ['default'], knownRoutes: ['/'],
  });
  assert.equal(section.style.surface, 'muted');
  assert.equal(section.style.width, 'narrow');
  assert.equal(section.style.cardStyle, 'elevated');
  // And the axes nobody set are still the designed ones.
  assert.equal(section.style.accent, 'default');
});

test('nothing an admin picks becomes a raw value in the DOM', () => {
  /*
   * The whole safety argument in one assertion. The only inline properties
   * are the measure and the picture ratio, and both are lengths or ratios
   * drawn from a fixed table — never a colour, a shadow or a font.
   */
  for (const axis of AXES) {
    for (const step of STYLE_AXES[axis]) {
      const mark = styleMark({ ...defaultStyle(), [axis]: step });
      for (const [prop, value] of Object.entries(mark.style)) {
        assert.ok(['--hm-measure', '--hm-media-ratio'].includes(prop),
          `${axis}='${step}' writes an inline ${prop}`);
        assert.ok(/^[0-9a-z%./ ]+$/i.test(value), `${prop} carries "${value}"`);
      }
      for (const key of Object.keys(mark.attrs)) {
        assert.ok(key.startsWith('data-hm-'), `${axis}='${step}' sets ${key}`);
      }
    }
  }
});

/* ── The rules exist, and the components read the properties ─────────── */

const CSS = readFileSync('src/index.css', 'utf8');

test('every attribute the marks emit has a rule in the stylesheet', () => {
  const emitted = new Set();
  for (const axis of AXES) {
    for (const step of STYLE_AXES[axis]) {
      if (step === 'default') continue;
      const mark = styleMark({ ...defaultStyle(), [axis]: step });
      for (const [key, value] of Object.entries(mark.attrs)) {
        if (key === 'data-hm-style') continue;
        emitted.add(`[${key}='${value}']`);
      }
    }
  }
  for (const selector of emitted) {
    assert.ok(CSS.includes(selector),
      `${selector} is emitted by the renderer and styled by nothing — the control does nothing`);
  }
});

test('the measure and the ratio are read with the original value as fallback', () => {
  /*
   * `var(--hm-measure, 90rem)` rather than `var(--hm-measure)`. Without the
   * fallback an unstyled section has no max-width and the page loses its
   * grid — on every section at once, for the sake of a feature nobody used.
   */
  const primitives = readFileSync('src/components/home/sections/primitives.tsx', 'utf8');
  assert.ok(/var\(--hm-measure,\s*90rem\)/.test(primitives),
    'PAGE reads the measure without a fallback, so an unstyled page has no measure');

  const verify = readFileSync('src/components/home/sections/VerifyShowcaseSection.tsx', 'utf8');
  assert.ok(/var\(--hm-media-ratio,\s*16\/10\)/.test(verify),
    'the Verify plate reads the ratio without its own shape as the fallback');

  const video = readFileSync('src/components/home/sections/blocks/VideoBlockSection.tsx', 'utf8');
  assert.ok(/var\(--hm-media-ratio,\s*16\/9\)/.test(video),
    'the video frame reads the ratio without 16/9 as the fallback');
});

test('the preset adds no element to the page', () => {
  /*
   * It rides the wrapper every section already has — Reveal in public, the
   * click target in the editor. The first version added a div, and the first
   * thing that broke was the phone motion probe, which finds a section and
   * reads the transform off its parent. Anything else measuring that same
   * relationship would have broken the same way and said nothing.
   */
  const page = readFileSync('src/site/render/SitePage.tsx', 'utf8');
  assert.ok(/styleMark\(section\?\.style\)/.test(page), 'the renderer no longer applies the preset');
  assert.equal((page.match(/\{\.\.\.mark\.attrs\}/g) ?? []).length, 2,
    'the mark is not spread onto both the public wrapper and the editor one');
  assert.ok(!/<div className=\{mark\.className\}/.test(page),
    'a wrapper element is back between the section and the page');
});

test("Reveal keeps the caller's properties and owns only the motion", () => {
  /*
   * Reveal replaced `style` outright, which was invisible until something
   * needed to pass one. --hm-measure is set on the same element, so dropping
   * it made the width control work in the editor and do nothing in public —
   * the worst shape of bug this feature could have.
   */
  const reveal = readFileSync('src/components/common/Reveal.tsx', 'utf8');
  assert.ok(/\.\.\.style,/.test(reveal), "Reveal discards the caller's style again");
  const spread = reveal.indexOf('...style,');
  const opacity = reveal.indexOf('opacity: shown');
  assert.ok(spread > 0 && opacity > spread,
    'the caller can override opacity, which is the reveal itself');
});
