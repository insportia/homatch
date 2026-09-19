// "What is a sensible price for THIS property, given how I intend to make
// money from it?"
//
// Every maximum here is solved BACKWARDS from a business objective, and the
// only convincing test of a backsolve is a ROUND TRIP: feed the answer into
// the forward engine and confirm it produces exactly the requirement it was
// solved for. A backsolve that is merely self-consistent is a formula
// agreeing with itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  constructionAcquisitionValue,
  renovationAcquisitionValue,
  rentalAcquisitionValue,
} from '../calculations/acquisitionValue.ts';
import { buildConstructionModel } from '../calculations/construction.ts';
import { runInvestmentModel } from '../calculations/index.ts';

/* ── Rental: price from income ──────────────────────────────────────── */

test('the naive case: $6,000 of net income at 6% supports $100,000', () => {
  const result = rentalAcquisitionValue({
    currency: 'USD',
    netOperatingIncome: 6000,
    targetYieldPercent: 6,
  });
  assert.equal(result.maximumPrice.value, 100000);
});

test('acquisition costs come OUT of what the income can support', () => {
  // The yield has to be earned on everything the investor pays, not just on
  // the price — so 3% of costs lowers the price the income supports.
  const result = rentalAcquisitionValue({
    currency: 'USD',
    netOperatingIncome: 6000,
    targetYieldPercent: 6,
    acquisitionCostPercent: 3,
  });
  assert.ok(result.maximumPrice.value < 100000);
  assert.equal(result.maximumPrice.value, 97087.38);
});

test('ROUND TRIP: buying at the maximum delivers exactly the target yield', () => {
  const targetYield = 7;
  const result = rentalAcquisitionValue({
    currency: 'USD',
    netOperatingIncome: 7000,
    targetYieldPercent: targetYield,
    acquisitionCostPercent: 2,
    upfrontWorks: 5000,
  });
  const price = result.maximumPrice.value;
  const totalInvested = price * 1.02 + 5000;
  assert.ok(
    Math.abs((7000 / totalInvested) * 100 - targetYield) < 0.01,
    `at ${price} the yield was ${((7000 / totalInvested) * 100).toFixed(3)}%`,
  );
});

test('a rental has no break-even PRICE, and says why rather than omitting it', () => {
  const result = rentalAcquisitionValue({
    currency: 'USD',
    netOperatingIncome: 6000,
    targetYieldPercent: 6,
  });
  assert.equal(result.breakEvenPrice.value, null);
  assert.equal(result.breakEvenPrice.unavailable, 'NOT_MEANINGFUL');
});

test('income that cannot support any positive price says so', () => {
  const result = rentalAcquisitionValue({
    currency: 'USD',
    netOperatingIncome: 100,
    targetYieldPercent: 6,
    acquisitionCostsFlat: 5000,
  });
  assert.equal(result.maximumPrice.value, null);
  assert.equal(result.maximumPrice.unavailable, 'NOT_MEANINGFUL');
});

/* ── Renovate and resell: price from the resale ─────────────────────── */

const flipValue = (over = {}) => ({
  currency: 'USD',
  expectedResalePrice: 150000,
  renovationCost: 25000,
  sellingCostPercent: 3,
  acquisitionCostPercent: 2,
  areaSqm: 70,
  ...over,
});

test('break-even is where the resale exactly covers everything', () => {
  const result = renovationAcquisitionValue(flipValue());
  const price = result.breakEvenPrice.value;
  // Resale 150,000 − 4,500 selling − 25,000 reno = 120,500 available.
  // 120,500 / 1.02 = 118,137.25
  assert.equal(price, 118137.25);
});

test('ROUND TRIP: buying at break-even produces a profit of zero', () => {
  const result = renovationAcquisitionValue(flipValue());
  const price = result.breakEvenPrice.value;
  const model = runInvestmentModel({
    currency: 'USD',
    purchasePrice: price,
    subject: { areaSqm: 70 },
    renovationCost: 25000,
    acquisitionCostPercent: 2,
    holdMonths: 6,
    exitPriceAssumption: 150000,
    sellingCostPercent: 3,
  });
  assert.ok(
    Math.abs(model.holdAndExit.profit.value) < 1,
    `profit at the break-even price was ${model.holdAndExit.profit.value}`,
  );
});

test('ROUND TRIP: buying at the maximum delivers exactly the target return', () => {
  const target = 20;
  const result = renovationAcquisitionValue(flipValue({ targetReturnPercent: target }));
  const price = result.maximumPrice.value;
  const model = runInvestmentModel({
    currency: 'USD',
    purchasePrice: price,
    subject: { areaSqm: 70 },
    renovationCost: 25000,
    acquisitionCostPercent: 2,
    holdMonths: 6,
    exitPriceAssumption: 150000,
    sellingCostPercent: 3,
  });
  assert.ok(
    Math.abs(model.holdAndExit.returnOnInvestedCashPercent.value - target) < 0.02,
    `expected ${target}%, got ${model.holdAndExit.returnOnInvestedCashPercent.value}%`,
  );
});

test('a required flat profit is honoured exactly', () => {
  const result = renovationAcquisitionValue(flipValue({ requiredProfit: 20000 }));
  const price = result.maximumPrice.value;
  const model = runInvestmentModel({
    currency: 'USD',
    purchasePrice: price,
    subject: { areaSqm: 70 },
    renovationCost: 25000,
    acquisitionCostPercent: 2,
    holdMonths: 6,
    exitPriceAssumption: 150000,
    sellingCostPercent: 3,
  });
  assert.ok(Math.abs(model.holdAndExit.profit.value - 20000) < 1);
});

test('a higher requirement always means a lower maximum price', () => {
  const prices = [10, 15, 20, 30].map(
    (r) => renovationAcquisitionValue(flipValue({ targetReturnPercent: r })).maximumPrice.value,
  );
  for (let i = 1; i < prices.length; i += 1) {
    assert.ok(prices[i] < prices[i - 1], `${prices[i]} should be below ${prices[i - 1]}`);
  }
});

test('the target entry price sits below the maximum by the cushion', () => {
  const result = renovationAcquisitionValue(flipValue({ targetReturnPercent: 20 }));
  assert.ok(Math.abs(result.targetEntryPrice.value - result.maximumPrice.value * 0.9) < 0.01);
});

test('per-m2 boundaries are the same prices divided by the area', () => {
  const result = renovationAcquisitionValue(flipValue({ targetReturnPercent: 20 }));
  assert.ok(Math.abs(result.maximumPricePerSqm.value - result.maximumPrice.value / 70) < 0.01);
  assert.ok(Math.abs(result.targetEntryPricePerSqm.value - result.targetEntryPrice.value / 70) < 0.01);
});

/* ── Scoring a price the investor is considering ────────────────────── */

test('a price under the target reads as comfortable', () => {
  // The boundaries on this deal are break-even 118,137, maximum 94,363,
  // target 84,926. A price BELOW the target is the comfortable case; 90,000
  // sits between target and maximum and is the tight one asserted below.
  const result = renovationAcquisitionValue(
    flipValue({ targetReturnPercent: 20, proposedPrice: 80000 }),
  );
  assert.equal(result.verdictKey, 'inv_value_verdict_comfortable');
  assert.ok(result.marginOfSafetyPercent.value > 10);
});

test('the four boundaries stay in their only sensible order', () => {
  const result = renovationAcquisitionValue(flipValue({ targetReturnPercent: 20 }));
  assert.ok(
    result.targetEntryPrice.value < result.maximumPrice.value,
    'the cushion must sit below the maximum',
  );
  assert.ok(
    result.maximumPrice.value < result.breakEvenPrice.value,
    'a deal that meets a positive requirement must cost less than one that merely breaks even',
  );
});

test('a price between target and maximum reads as tight', () => {
  const result = renovationAcquisitionValue(flipValue({ targetReturnPercent: 20 }));
  const between = (result.targetEntryPrice.value + result.maximumPrice.value) / 2;
  const scored = renovationAcquisitionValue(
    flipValue({ targetReturnPercent: 20, proposedPrice: between }),
  );
  assert.equal(scored.verdictKey, 'inv_value_verdict_tight');
});

test('a price above the maximum still works, below the requirement', () => {
  const result = renovationAcquisitionValue(flipValue({ targetReturnPercent: 20 }));
  const above = result.maximumPrice.value + 5000;
  const scored = renovationAcquisitionValue(
    flipValue({ targetReturnPercent: 20, proposedPrice: above }),
  );
  assert.equal(scored.verdictKey, 'inv_value_verdict_below_requirement');
  assert.ok(scored.profitAtProposedPrice.value > 0, 'it still makes money, just not enough');
});

test('a price at or above break-even does not work, and says so', () => {
  const result = renovationAcquisitionValue(flipValue({ targetReturnPercent: 20 }));
  const scored = renovationAcquisitionValue(
    flipValue({ targetReturnPercent: 20, proposedPrice: result.breakEvenPrice.value + 1000 }),
  );
  assert.equal(scored.verdictKey, 'inv_value_verdict_does_not_work');
  assert.ok(scored.profitAtProposedPrice.value < 0);
});

test('with no proposed price there is no verdict to give', () => {
  const result = renovationAcquisitionValue(flipValue({ targetReturnPercent: 20 }));
  assert.equal(result.verdictKey, 'inv_value_verdict_no_price');
  assert.equal(result.profitAtProposedPrice.value, null);
});

/* ── Construction resale: price from the completed value ────────────── */

test('ROUND TRIP: the maximum entry price delivers the target return', () => {
  const target = 25;
  const result = constructionAcquisitionValue({
    currency: 'USD',
    expectedCompletedPrice: 100000,
    remainingPayments: 0,
    sellingCostPercent: 3,
    acquisitionCostPercent: 2,
    targetReturnPercent: target,
    areaSqm: 60,
  });
  const price = result.maximumPrice.value;
  // Paid in full at entry, so cash deployed is price + costs.
  const model = buildConstructionModel({
    currency: 'USD',
    purchasePrice: price,
    areaSqm: 60,
    acquisitionCosts: price * 0.02,
    upfrontPayment: price,
    monthsToCompletion: 18,
    expectedCompletedPrice: 100000,
    sellingCostPercent: 3,
  });
  assert.ok(
    Math.abs(model.returnOnInvestorCashPercent.value - target) < 0.05,
    `expected ${target}%, got ${model.returnOnInvestorCashPercent.value}%`,
  );
});

test('payments still owed reduce what can be paid at entry', () => {
  const base = constructionAcquisitionValue({
    currency: 'USD',
    expectedCompletedPrice: 100000,
    targetReturnPercent: 20,
  });
  const withOwed = constructionAcquisitionValue({
    currency: 'USD',
    expectedCompletedPrice: 100000,
    remainingPayments: 20000,
    targetReturnPercent: 20,
  });
  assert.ok(withOwed.maximumPrice.value < base.maximumPrice.value);
});

test('a completed value that cannot cover the obligations refuses a price', () => {
  const result = constructionAcquisitionValue({
    currency: 'USD',
    expectedCompletedPrice: 50000,
    remainingPayments: 60000,
    targetReturnPercent: 20,
  });
  assert.equal(result.breakEvenPrice.value, null);
  assert.equal(result.breakEvenPrice.unavailable, 'NOT_MEANINGFUL');
});

test('every strategy reports which one it answered for', () => {
  assert.equal(
    rentalAcquisitionValue({ currency: 'USD', netOperatingIncome: 1, targetYieldPercent: 6 }).strategy,
    'RENTAL_INVESTMENT',
  );
  assert.equal(renovationAcquisitionValue(flipValue()).strategy, 'RENOVATE_RESELL');
  assert.equal(
    constructionAcquisitionValue({ currency: 'USD', expectedCompletedPrice: 1 }).strategy,
    'CONSTRUCTION_RESALE',
  );
});
