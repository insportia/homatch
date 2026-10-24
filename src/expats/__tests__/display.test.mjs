// For Expats display rules: Georgian dates, endings that stay on their line,
// and no internal key shown as a name.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatExpatDate, keepSuffix, projectLabel } from '../display.ts';

const WJ = '⁠';
const NBSP = ' ';

test('a Georgian ending joined by a hyphen cannot start a line', () => {
  assert.equal(keepSuffix('15 კატეგორიიდან 2-ის ფასი ვიცით'), `15 კატეგორიიდან 2-${WJ}ის ფასი ვიცით`);
  assert.equal(keepSuffix('დაკვირვებული კვ.მ-ზე'), `დაკვირვებული კვ.მ-${WJ}ზე`);
  // Latin and numeric hyphens are left alone.
  assert.equal(keepSuffix('Homatch-based 2026-09-20'), 'Homatch-based 2026-09-20');
});

test('Georgian dates are written out by hand and never split', () => {
  assert.equal(formatExpatDate('2026-09-20', 'ka'), ['20', 'სექტემბერი', '2026'].join(NBSP));
  assert.equal(formatExpatDate('2026-01-05T23:30:00Z', 'ka'), ['5', 'იანვარი', '2026'].join(NBSP));
  assert.ok(!/Sep|-/.test(formatExpatDate('2026-09-20', 'ka')));
});

test('other languages use the browser calendar, unsplit; bad input is empty', () => {
  const en = formatExpatDate('2026-09-20', 'en');
  assert.match(en, /2026/);
  assert.ok(!en.includes(' '), 'spaces are non-breaking');
  assert.equal(formatExpatDate(null, 'en'), '');
  assert.equal(formatExpatDate('not a date', 'ka'), '');
});

test('a development key reads as a name, never as a slug', () => {
  assert.equal(projectLabel('villion-krtsanisi-homes'), 'Villion Krtsanisi Homes');
  assert.equal(projectLabel('m2_saburtalo'), 'M2 Saburtalo');
  assert.equal(projectLabel(null), '');
});
