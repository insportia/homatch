import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*
 * NOTHING IN THE CUSTOMER PRODUCT IS SMALLER THAN THE SCALE'S SMALLEST STEP.
 *
 * The type scale in tailwind.config.js starts at 2xs — 13px — and that floor
 * exists because the pass below it is where "the text is too small and too
 * faded" comes from. Arbitrary sizes bypass the scale completely: nobody
 * reviewing `text-[11px]` in a diff reads it as "below the smallest size this
 * product has", and twenty-one of them accumulated that way. Ten were on the
 * verification report, which is the single densest screen in the product and
 * the one a customer reads most carefully.
 *
 * WHAT IS DELIBERATELY EXEMPT
 *
 *   The logo lockup. Its tagline is set relative to the mark, not to the
 *   page's text, and it is a drawn thing rather than something to read.
 *
 *   The admin console. It is an internal tool used at a desk on a large
 *   screen, where density is worth more than it costs, and it is not part of
 *   the customer product this rule is about.
 *
 *   Unread-count badges. A two-digit number inside a 14px circle is a
 *   symbol, not a sentence; the thing that has to be legible is the dot,
 *   and the count beside it.
 *
 *   The mobile tab bar's labels. Five labels share 320px, and Georgian
 *   words are long: at 13px they truncate to initials, which is worse for
 *   everyone than 12px that fits. Held at 12px on the narrowest screens
 *   and released to 13px from sm, which is the deliberate trade rather
 *   than an oversight.
 */

const ROOT = 'src';
const FLOOR = 13;

/** Paths this rule does not govern, and why, in one place. */
const EXEMPT = [
  'src/components/common/HomatchLogo.tsx',        // part of the mark, not body text
  'src/components/admin/',                        // internal tooling, desktop only
  'src/pages/admin/',
  'src/components/layouts/MobileBottomNav.tsx',   // five labels in 320px, in Georgian
];

/**
 * Elements that carry a count in a small circle rather than text to read.
 *
 * The shape is what is exempt — a round box about sixteen pixels across —
 * rather than any one spelling of it, because the same badge is written as
 * h-4 in one file and h-[14px] in another. Matched per line so that adding
 * a genuine 12px PARAGRAPH to one of
 * these files is still caught — the exemption is for the badge, not for
 * the file it lives in.
 */
const BADGE_BOX = ['h-4 ', 'h-5 ', 'min-w-[14px]', 'h-[14px]'];
const isCountBadge = (line) =>
  line.includes('rounded-full') && BADGE_BOX.some((c) => line.includes(c));

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry).split('\\').join('/');
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

test('no customer-facing text is set below the type scale floor', () => {
  const offenders = [];
  let scanned = 0;

  for (const file of walk(ROOT)) {
    if (EXEMPT.some((e) => file.startsWith(e))) continue;
    scanned += 1;
    const src = readFileSync(file, 'utf8');
    for (const line of src.split('\n')) {
      if (isCountBadge(line)) continue;
      for (const m of line.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
        const px = Number(m[1]);
        if (px < FLOOR) offenders.push(`${file}: text-[${m[1]}px]  ${line.trim().slice(0, 60)}`);
      }
    }
  }

  // Guards the guard: an empty scan would make this vacuously true.
  assert.ok(scanned > 100, `only scanned ${scanned} components`);
  assert.deepEqual(
    offenders, [],
    `text below the ${FLOOR}px floor — use text-2xs, or add a deliberate exemption:\n  ${offenders.join('\n  ')}`,
  );
});

test('the scale itself still starts where this rule says it does', () => {
  // The floor above is a literal. If the scale moves and this does not, the
  // rule silently stops meaning what it says.
  const cfg = readFileSync('tailwind.config.js', 'utf8');
  assert.match(cfg, /'2xs':\s*\['0\.8125rem'/, '2xs is no longer 13px');
});
