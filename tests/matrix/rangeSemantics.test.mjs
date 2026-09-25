/*
 * USD60,000–0
 *
 * That is what production showed for a buyer who gave a budget floor and no
 * ceiling: the absent maximum was coerced with `?? 0` and then formatted like
 * a real bound, so the customer read a range running downwards to nothing.
 *
 * These tests pin the two halves of the rule that stops it: an absent number
 * is never rendered as a value, and a real zero is never mistaken for absent.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { rangeShape, valueShape, formatRange, present } from '../../src/lib/rangeSemantics.ts';

const WORDS = {
  from: (v) => `from ${v}`,
  upTo: (v) => `up to ${v}`,
  unknown: () => 'not stated',
};
const money = (n) => `USD${n.toLocaleString('en-US')}`;
const show = (min, max) => formatRange(rangeShape(min, max), money, WORDS);

test('range 1: a missing maximum is never rendered as zero', () => {
  assert.equal(show(60000, null), 'from USD60,000');
  assert.equal(show(60000, undefined), 'from USD60,000');
  assert.notEqual(show(60000, null), 'USD60,000–USD0');
  assert.ok(!show(60000, null).includes('–'), 'a one-sided bound must not render as a span');
});

test('range 2: a missing minimum reads as a ceiling, not a floor of zero', () => {
  assert.equal(show(null, 90000), 'up to USD90,000');
  assert.ok(!show(null, 90000).startsWith('USD0'));
});

test('range 3: neither bound is an honest absence', () => {
  assert.equal(show(null, null), 'not stated');
  assert.equal(show(undefined, undefined), 'not stated');
});

test('range 4: a real zero survives as a value', () => {
  /*
   * The trap: `if (!value)` treats a fee of zero as missing. A zero fee is a
   * fact worth showing and is the difference between "free" and "unknown".
   */
  assert.equal(present(0), true);
  assert.equal(valueShape(0).kind, 'exact');
  assert.equal(formatRange(valueShape(0), money, WORDS), 'USD0');
  assert.equal(show(0, 0), 'USD0');
});

test('range 5: equal bounds are one number, not a span of itself', () => {
  assert.equal(show(120000, 120000), 'USD120,000');
});

test('range 6: bounds the wrong way round describe the span they mean', () => {
  /* Bad data should not produce a range that runs backwards on screen. */
  assert.equal(show(90000, 60000), 'USD60,000–USD90,000');
});

test('range 7: NaN and non-numbers are absent, not zero', () => {
  assert.equal(present(Number.NaN), false);
  assert.equal(present('60000'), false);
  assert.equal(show(Number.NaN, Number.NaN), 'not stated');
  assert.equal(rangeShape(Number.NaN, 90000).kind, 'upTo');
});

test('range 8: every combination has an answer', () => {
  /* Total by construction, so a caller cannot reach a formatter without
     having decided what an absence means. */
  const kinds = new Set();
  for (const min of [null, 10]) {
    for (const max of [null, 10, 20]) kinds.add(rangeShape(min, max).kind);
  }
  assert.deepEqual([...kinds].sort(), ['exact', 'from', 'range', 'unknown', 'upTo'].sort());
});
