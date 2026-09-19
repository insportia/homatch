// A BUTTON SIZED FOR ENGLISH IS A BROKEN BUTTON IN FIVE OTHER LANGUAGES.
//
// The Verify report's two calls to action — Investment Consultant, Mortgage
// Consultant — were `<Button size="lg">`. That variant is `h-11`, a fixed
// 44px box, and the Button base carries `whitespace-nowrap`. Neither is reset
// for the <a> that `asChild` renders. So on a phone the Georgian label could
// not wrap AND the box could not grow, and the icon, the label and the arrow
// were pressed into a row too narrow to hold them.
//
// These pin the rules that make a button fit its own translation. They are
// read from source because the alternative is mounting React to assert that a
// class exists; the RENDERED behaviour is measured separately, in a real
// Chrome, at six widths in six languages.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
/**
 * The component's CODE, without its prose.
 *
 * The header explains at length which classes were wrong and why — including
 * the `h-11` it replaced and the two shrink-0 children it requires. A rule
 * satisfied, or broken, by a comment ABOUT the rule is not a rule.
 */
const CTA = () => read('src', 'components', 'verify', 'VerifyActionButton.tsx')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

test('CTA_FIXED_HEIGHT_DEPENDENCY = NONE: the box grows with the label', () => {
  const src = CTA();
  // h-auto beats the variant's h-11; min-h keeps the touch target.
  assert.match(src, /h-auto min-h-12/);
  // The exact thing that broke it must not come back.
  assert.ok(!/\bh-11\b|\bh-10\b|\bh-9\b/.test(src), 'a fixed height is the bug, not the fix');
  assert.ok(!/size="lg"/.test(src), 'the lg variant carries h-11 with it');
});

test('CTA_MIN_TOUCH_TARGET: at least 48px, with real padding', () => {
  const src = CTA();
  // min-h-12 is 3rem = 48px, inside the 44-48px comfortable range.
  assert.match(src, /min-h-12/);
  assert.match(src, /px-5 py-3/);
});

test('CTA_TEXT_TRUNCATION = NONE: long labels wrap, they are not cut', () => {
  const src = CTA();
  assert.match(src, /whitespace-normal/, 'the base sets nowrap; it has to be undone');
  assert.match(src, /break-words/);
  assert.match(src, /leading-snug/, 'wrapped lines must stay readable');
  for (const banned of ['truncate', 'text-ellipsis', 'line-clamp', 'overflow-hidden']) {
    assert.ok(!src.includes(banned), `${banned} would hide a call to action's own label`);
  }
});

test('CTA_ICON_COLLISION = NO: icons hold their size, only the text gives way', () => {
  const src = CTA();
  // Two shrink-0 children — the leading icon and the trailing arrow.
  assert.equal((src.match(/shrink-0/g) ?? []).length, 2);
  // And exactly one child allowed to become narrower than its content.
  assert.match(src, /min-w-0 flex-1 break-words/);
  assert.match(src, /gap-3/, 'nothing may touch its neighbour');
  assert.match(src, /items-center/, 'icon, label and arrow stay aligned');
});

test('CTA_TRANSLATION_AWARE: no language is special-cased and none is assumed', () => {
  const src = CTA();
  // No per-language branching, no width chosen for one alphabet.
  assert.ok(!/lang ===|locale ===|=== 'ka'|=== 'en'/.test(src));
  assert.ok(!/\bw-\[\d/.test(src), 'a hardcoded width is a width chosen for one language');
  // Direction-aware by construction rather than by a Latin assumption.
  assert.match(src, /rtl:rotate-180/, 'the arrow must point the way the text runs');
  assert.match(src, /text-start/);
});

test('full width on a phone, side by side once there is room', () => {
  const src = CTA();
  assert.match(src, /w-full min-w-0/);
  assert.match(src, /sm:w-auto sm:flex-1/);
});

test('CTA_INVESTMENT_MORTGAGE_VISUAL_PARITY: siblings, not a primary and a secondary', () => {
  const src = CTA();
  // One treatment for both. The component no longer takes a variant at all,
  // so the two cannot drift apart or imply an order of preference.
  assert.ok(!/variant\?:/.test(src), 'a variant prop is how they diverged');
  assert.match(src, /variant="outline"/);
  assert.match(src, /rounded-full border-border bg-transparent/);
  assert.match(src, /hover:border-\[hsl\(var\(--gold-border\)\)\]/);

  const next = read('src', 'components', 'verify', 'NextStepsCard.tsx');
  assert.ok(!/variant=/.test(next), 'neither call to action may be styled differently');
});

test('VERIFY_CTA_COMPONENT: both calls to action come from the one component', () => {
  const next = read('src', 'components', 'verify', 'NextStepsCard.tsx');
  assert.equal((next.match(/<VerifyActionButton/g) ?? []).length, 2);
  // Still the existing products, still not duplicated.
  assert.match(next, /to=\{`\/investment\$\{suffix\}`\}/);
  assert.match(next, /to=\{`\/mortgage\$\{suffix\}`\}/);
  // And no hand-rolled button survives beside it.
  assert.ok(!/<Button asChild/.test(next), 'one CTA component, not two spellings of one');
});

test('the stop control is held to the same standard', () => {
  const src = read('src', 'components', 'verify', 'ResearchStream.tsx')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  assert.match(src, /h-auto min-h-11/, 'a 36px target is too small to be found by a thumb');
  assert.match(src, /whitespace-normal/);
  assert.match(src, /leading-snug/);
  assert.ok(!/className="h-9 /.test(src), 'the 36px fixed height must not come back');
  // Still contained, still not the loudest thing on the screen.
  assert.match(src, /rounded-xl border border-border/);
  assert.match(src, /variant="outline"/);
});
