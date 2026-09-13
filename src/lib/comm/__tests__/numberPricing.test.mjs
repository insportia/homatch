// Number procurement pricing — the one place a margin rule is allowed to live.
//
// The rule is owner-approved and narrow: retail = provider cost x 2, for
// NUMBER PROCUREMENT ONLY. These tests exist because a pricing function that
// silently returns a number for a bad input is how a customer gets charged
// nothing, or charged for a cost we never actually read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  numberRetailPrice, formatMoneyCents, NUMBER_RETAIL_MULTIPLIER,
} from '../numberPricing.ts';

test('retail is exactly twice the provider cost', () => {
  // The three worked examples the rule was approved with: $2 -> $4,
  // $5 -> $10, $12 -> $24.
  for (const [costDollars, retailDollars] of [[2, 4], [5, 10], [12, 24]]) {
    const p = numberRetailPrice(costDollars * 100);
    assert.ok(p, `expected a price for $${costDollars}`);
    assert.equal(p.providerCostCents, costDollars * 100);
    assert.equal(p.retailCents, retailDollars * 100);
    assert.equal(p.grossMarginCents, (retailDollars - costDollars) * 100);
  }
});

test('the multiplier is the authorised one', () => {
  assert.equal(NUMBER_RETAIL_MULTIPLIER, 2);
});

test('a cost that is not a real number produces no price at all', () => {
  // Every one of these must be rendered as "price unavailable". A price of 0
  // would be a free number, and a NaN price formats as "$NaN" in the UI and as
  // a successful charge of nothing in the ledger.
  for (const bad of [null, undefined, NaN, Infinity, -Infinity, -1, -0.5, '5', {}]) {
    assert.equal(numberRetailPrice(bad), null, `${String(bad)} must not produce a price`);
  }
});

test('a zero cost is a failure to read the cost, not a free number', () => {
  assert.equal(numberRetailPrice(0), null);
});

test('rounding never erodes the margin', () => {
  // 199.5c cost -> cost rounds up to 200c, retail 400c. The customer is never
  // charged less than twice what we actually paid.
  const p = numberRetailPrice(199.5);
  assert.ok(p);
  assert.equal(p.providerCostCents, 200);
  assert.equal(p.retailCents, 400);
  assert.ok(p.retailCents >= p.providerCostCents * 2);
});

test('margin is always exactly the cost again', () => {
  for (const cents of [1, 37, 250, 999, 123456]) {
    const p = numberRetailPrice(cents);
    assert.ok(p);
    assert.equal(p.grossMarginCents, p.retailCents - p.providerCostCents);
    assert.equal(p.retailCents, p.providerCostCents * 2);
  }
});

test('currency travels with the price', () => {
  const p = numberRetailPrice(500, 'EUR');
  assert.ok(p);
  assert.equal(p.currency, 'EUR');
});

test('money formats as money, and an unknown currency still renders', () => {
  assert.equal(formatMoneyCents(400), '$4.00');
  assert.equal(formatMoneyCents(1050), '$10.50');
  // An unrecognised code must not throw — it degrades to a readable string.
  assert.match(formatMoneyCents(400, 'XYZ'), /4\.00/);
});
