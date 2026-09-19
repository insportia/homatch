// Buying during construction and selling on completion.
//
// The property this file exists to protect: TOTAL CAPITAL COMMITTED and
// CASH ACTUALLY DEPLOYED are different numbers, and an off-plan deal looks
// either far better or far worse than it is depending on which one a return
// is measured against. Both are asserted, separately, everywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCompletedPriceScenarios,
  buildConstructionDelayLadder,
  buildConstructionModel,
  buildDeployment,
  completedValueFor,
  monthsToExitFor,
} from '../calculations/construction.ts';

/**
 * A typical Tbilisi off-plan purchase: $80,000 at shell stage, 30% down,
 * $1,000 a month for twenty months, completing in two years, expected to be
 * worth $100,000 finished.
 */
const offPlan = (over = {}) => ({
  currency: 'USD',
  purchasePrice: 80000,
  areaSqm: 60,
  acquisitionCosts: 1500,
  upfrontPayment: 24000,
  installmentMonthly: 1000,
  installmentCount: 20,
  monthsToCompletion: 24,
  expectedCompletedPrice: 100000,
  sellingCostPercent: 3,
  ...over,
});

/* ── The payment schedule ───────────────────────────────────────────── */

test('the schedule pays the deposit at month zero and instalments after it', () => {
  const points = buildDeployment(offPlan());
  assert.equal(points[0].month, 0);
  assert.equal(points[0].cumulativePaid, 24000);
  assert.equal(points[0].remainingObligation, 56000);
  assert.equal(points[1].paidThisMonth, 1000);
  assert.equal(points[20].cumulativePaid, 44000);
  // Instalments stop after the count; the rest stays owed.
  assert.equal(points[21].paidThisMonth, 0);
  assert.equal(points[24].cumulativePaid, 44000);
  assert.equal(points[24].remainingObligation, 36000);
});

test('instalments never over-pay the contract price', () => {
  // Sixty months of $2,000 against an $80,000 price with $24,000 down: the
  // schedule must stop at the price, not run past it into a negative
  // balance that would then flatter the exit.
  const points = buildDeployment(
    offPlan({ installmentMonthly: 2000, installmentCount: 60, monthsToCompletion: 60 }),
  );
  const last = points[points.length - 1];
  assert.equal(last.cumulativePaid, 80000);
  assert.equal(last.remainingObligation, 0);
  assert.ok(points.every((p) => p.remainingObligation >= 0));
});

test('a stated remaining balance wins over the derived one', () => {
  const model = buildConstructionModel(offPlan({ remainingDeveloperBalance: 30000 }));
  assert.equal(model.remainingObligation.value, 30000);
});

/* ── The two capital figures ────────────────────────────────────────── */

test('total capital committed and cash deployed are DIFFERENT and both correct', () => {
  const model = buildConstructionModel(offPlan());
  // Committed: the whole price plus the investor's own acquisition costs.
  assert.equal(model.totalCapitalCommitted.value, 81500);
  // Deployed: deposit + twenty instalments + acquisition costs.
  assert.equal(model.investorCashDeployed.value, 45500);
  assert.equal(model.remainingObligation.value, 36000);
  // And the three reconcile to the committed figure.
  assert.equal(
    model.investorCashDeployed.value + model.remainingObligation.value,
    model.totalCapitalCommitted.value,
  );
});

test('the two returns differ, and the cash one is the larger', () => {
  const model = buildConstructionModel(offPlan());
  const onCash = model.returnOnInvestorCashPercent.value;
  const onTotal = model.returnOnTotalCapitalPercent.value;
  assert.ok(onCash > onTotal, `${onCash}% on cash should exceed ${onTotal}% on total capital`);
  // Neither is reported without the other.
  assert.ok(Number.isFinite(onCash) && Number.isFinite(onTotal));
});

/* ── The exit ───────────────────────────────────────────────────────── */

test('the exit settles what is still owed, exactly like a loan payoff', () => {
  const model = buildConstructionModel(offPlan());
  assert.equal(model.sellingCosts.value, 3000);
  // 100,000 − 3,000 selling − 36,000 still owed.
  assert.equal(model.expectedSaleProceeds.value, 61000);
  // Proceeds less the cash that went in.
  assert.equal(model.netProfit.value, 15500);
});

test('appreciation is the project finishing, not anything the investor did', () => {
  const model = buildConstructionModel(offPlan());
  assert.equal(model.expectedAppreciation.value, 20000);
  assert.equal(model.appreciationPercent.value, 25);
});

test('a completed price per m2 is accepted in place of a total', () => {
  assert.equal(
    completedValueFor(offPlan({ expectedCompletedPrice: undefined, expectedCompletedPricePerSqm: 1800 })),
    108000,
  );
  // A total wins when both are present.
  assert.equal(completedValueFor(offPlan({ expectedCompletedPricePerSqm: 1800 })), 100000);
});

test('with no completed value the capital figures still stand and the exit is a named gap', () => {
  const model = buildConstructionModel(
    offPlan({ expectedCompletedPrice: undefined, expectedCompletedPricePerSqm: undefined }),
  );
  assert.equal(model.investorCashDeployed.value, 45500);
  assert.equal(model.netProfit.value, null);
  assert.equal(model.netProfit.unavailable, 'MISSING_INPUT');
  // Break-even needs no completed value and is still produced.
  assert.ok(model.breakEvenExitPrice.value > 0);
});

/* ── Break-even, target and margin ──────────────────────────────────── */

test('the break-even exit price is where the profit is exactly zero', () => {
  const model = buildConstructionModel(offPlan());
  const price = model.breakEvenExitPrice.value;
  const at = buildConstructionModel(offPlan({ expectedCompletedPrice: price }));
  assert.ok(Math.abs(at.netProfit.value) < 1, `profit at break-even was ${at.netProfit.value}`);
});

test('the required exit for a target return hits that return', () => {
  const model = buildConstructionModel(offPlan({ targetReturnPercent: 25 }));
  const price = model.requiredExitForTargetReturn.value;
  const at = buildConstructionModel(offPlan({ expectedCompletedPrice: price }));
  assert.ok(
    Math.abs(at.returnOnInvestorCashPercent.value - 25) < 0.05,
    `expected 25%, got ${at.returnOnInvestorCashPercent.value}%`,
  );
});

test('margin of safety says how far the price can fall before it stops working', () => {
  const model = buildConstructionModel(offPlan());
  const margin = model.marginOfSafetyPercent.value;
  assert.ok(margin > 0 && margin < 100);
  // Falling by exactly the margin lands on break-even.
  const dropped = buildConstructionModel(
    offPlan({ expectedCompletedPrice: (100000 * (100 - margin)) / 100 }),
  );
  assert.ok(Math.abs(dropped.netProfit.value) < 2);
});

test('break-even per m2 needs an area and says so when there is none', () => {
  const without = buildConstructionModel(offPlan({ areaSqm: undefined }));
  assert.equal(without.breakEvenExitPricePerSqm.value, null);
  assert.equal(without.breakEvenExitPricePerSqm.unavailable, 'MISSING_INPUT');
  const with60 = buildConstructionModel(offPlan());
  assert.ok(
    Math.abs(with60.breakEvenExitPricePerSqm.value - with60.breakEvenExitPrice.value / 60) < 0.01,
  );
});

/* ── Delay ──────────────────────────────────────────────────────────── */

test('months to exit is completion plus any wait after it', () => {
  assert.equal(monthsToExitFor(offPlan()), 24);
  assert.equal(monthsToExitFor(offPlan({ additionalMonthsToSale: 6 })), 30);
});

test('a delay lowers the annualised return while the total barely moves', () => {
  const rows = buildConstructionDelayLadder(offPlan({ monthlyHoldingCosts: 100 }), [0, 6, 12]);
  assert.equal(rows[0].delayMonths, 0);
  assert.equal(rows[0].annualizedDelta.value, 0);
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(rows[i].monthsToExit > rows[i - 1].monthsToExit);
    assert.ok(rows[i].additionalHoldingCosts.value > rows[i - 1].additionalHoldingCosts.value);
    assert.ok(
      rows[i].annualizedReturnPercent.value < rows[i - 1].annualizedReturnPercent.value,
      'waiting longer for the same price must lower the annualised return',
    );
  }
});

test('with no holding cost a delay still costs annualised return and nothing else', () => {
  const rows = buildConstructionDelayLadder(offPlan(), [0, 12]);
  assert.equal(rows[1].additionalHoldingCosts.value, 0);
  assert.equal(rows[1].netProfit.value, rows[0].netProfit.value);
  assert.ok(rows[1].annualizedReturnPercent.value < rows[0].annualizedReturnPercent.value);
});

/* ── Price sensitivity ──────────────────────────────────────────────── */

test('completed-price scenarios move the profit one for one, net of selling cost', () => {
  const rows = buildCompletedPriceScenarios(offPlan(), [10, 0, -10]);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].completedValue, 100000);
  // A 10% higher completed value is $10,000 more, less 3% selling cost.
  assert.equal(Math.round(rows[0].netProfit.value - rows[1].netProfit.value), 9700);
  assert.ok(rows[2].netProfit.value < rows[1].netProfit.value);
});

test('price scenarios are empty rather than invented when no completed value exists', () => {
  assert.deepEqual(
    buildCompletedPriceScenarios(
      offPlan({ expectedCompletedPrice: undefined, expectedCompletedPricePerSqm: undefined }),
    ),
    [],
  );
});
