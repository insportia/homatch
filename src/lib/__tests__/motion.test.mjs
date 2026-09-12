import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DURATION, EASING, durationFor, motionLevel, revealShape, transitionFor,
} from '../motion.ts';

/*
 * THE MOTION SYSTEM — what is allowed to move, and how much.
 *
 * The property worth protecting is the first one: a person who asked their
 * operating system to stop animating things must get that, from every
 * component, regardless of what else is true about their device. It is the
 * kind of rule that is easy to write once and then quietly lose to a
 * condition added later, which is why it is asserted against every
 * combination of the other inputs rather than a representative one.
 */

const ALL = [false, true];

test('a request for reduced motion is honoured whatever else is true', () => {
  for (const coarsePointer of ALL) {
    for (const narrow of ALL) {
      for (const saveData of ALL) {
        assert.equal(
          motionLevel({ reducedMotion: true, coarsePointer, narrow, saveData }),
          'none',
          `reduced motion was overridden by coarse=${coarsePointer} narrow=${narrow} saveData=${saveData}`,
        );
      }
    }
  }
});

test('data saver is treated as a request to stop as well', () => {
  // Somebody on a metered or failing connection is not asking for decorative
  // work, and the browser has already told us so.
  assert.equal(
    motionLevel({ reducedMotion: false, coarsePointer: false, narrow: false, saveData: true }),
    'none',
  );
});

test('a phone gets simplified motion, not no motion', () => {
  // The point of the middle level: reducing motion on a small screen is
  // about distance and duration, not about removing it.
  assert.equal(
    motionLevel({ reducedMotion: false, coarsePointer: true, narrow: true, saveData: false }),
    'simplified',
  );
  assert.equal(
    motionLevel({ reducedMotion: false, coarsePointer: false, narrow: true, saveData: false }),
    'simplified',
  );
  assert.equal(
    motionLevel({ reducedMotion: false, coarsePointer: true, narrow: false, saveData: false }),
    'simplified',
    'a touch screen at tablet width is still a touch screen',
  );
});

test('a desktop with no stated preference gets the full thing', () => {
  assert.equal(
    motionLevel({ reducedMotion: false, coarsePointer: false, narrow: false, saveData: false }),
    'full',
  );
});

test('at none, a reveal has nothing to reveal', () => {
  // This is what lets the reveal component render unconditionally: no
  // distance, no duration, no waiting on an observer.
  assert.deepEqual(revealShape('none'), { distance: 0, duration: 0, stagger: 0 });
});

test('a reveal on a phone is shorter, smaller and unstaggered', () => {
  const full = revealShape('full');
  const simple = revealShape('simplified');
  assert.ok(simple.distance < full.distance, 'the travel should be shorter on a phone');
  assert.ok(simple.duration < full.duration, 'it should take less time on a phone');
  assert.equal(simple.stagger, 0, 'staggering a list on a phone makes the last item feel broken');
  assert.ok(full.stagger > 0);
});

test('durations scale down but never collapse except at none', () => {
  for (const name of Object.keys(DURATION)) {
    assert.equal(durationFor(name, 'none'), 0);
    assert.ok(durationFor(name, 'simplified') > 0,
      `${name} collapsed to zero on a phone; a 0ms transition fires no transitionend`);
    assert.ok(durationFor(name, 'simplified') < durationFor(name, 'full'));
  }
});

test('every named duration is ordered by how much screen it covers', () => {
  // A hover that takes as long as a dialog feels broken, and a dialog that
  // arrives as fast as a hover feels like a glitch.
  assert.ok(DURATION.instant < DURATION.control);
  assert.ok(DURATION.control < DURATION.surface);
  assert.ok(DURATION.surface < DURATION.page);
});

test('transitions read as none when nothing should move', () => {
  assert.equal(transitionFor('opacity', 'surface', 'none'), 'none');
  assert.match(transitionFor('opacity', 'surface', 'full'), /^opacity \d+ms cubic-bezier/);
});

test('leaving is quicker than arriving', () => {
  // Not a duration but an easing: exit should not make somebody wait for a
  // thing they have already dismissed.
  assert.notEqual(EASING.enter, EASING.exit);
  assert.match(EASING.enter, /^cubic-bezier\(/);
  assert.match(EASING.exit, /^cubic-bezier\(/);
});

/*
 * The stylesheet floor.
 *
 * lib/motion.ts governs what components animate deliberately. It cannot
 * govern what they animate incidentally — every `animate-*` utility, every
 * Radix open/close transition, every `transition-colors` on a hover. Those
 * are covered once, in CSS, and these assertions are what stop that rule
 * being edited into something that looks equivalent and is not.
 */
const css = readFileSync('src/index.css', 'utf8');

test('the stylesheet stops everything moving when reduced motion is asked for', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,400}\*,[\s\S]{0,120}animation-duration: 0\.01ms !important/);
  assert.match(css, /transition-duration: 0\.01ms !important/);
  assert.match(css, /scroll-behavior: auto !important/);
});

test('the floor shortens animations rather than cancelling them', () => {
  // `animation: none` CANCELS, and anything whose final state comes from its
  // keyframes — a Radix dialog that fades in — would be stuck invisible at
  // its starting state. A near-zero duration RUNS the animation to its end
  // within a frame, so the element lands where it belongs and animationend
  // still fires for anything waiting on it.
  // Sliced by character count rather than by searching for a closing brace
  // on its own line: these files are stored with CRLF endings, so a needle
  // containing a bare line feed matches nothing and silently yields an
  // empty block that would pass every assertion below.
  const prose = css.indexOf('When somebody asks everything to stop moving');
  assert.notEqual(prose, -1, 'the reduced-motion floor is gone from index.css');
  // From the RULE, not from the comment above it: that comment explains
  // why `animation: none` is wrong, and searching the prose for the thing
  // it warns against finds the warning.
  const at = css.indexOf('@media (prefers-reduced-motion: reduce)', prose);
  assert.notEqual(at, -1, 'the floor is no longer a media query');
  const block = css.slice(at, at + 1400);
  assert.equal(/animation:\s*none/.test(block), false,
    'cancelling animations can leave keyframe-positioned elements invisible');
  assert.match(block, /animation-iteration-count: 1 !important/);
});
