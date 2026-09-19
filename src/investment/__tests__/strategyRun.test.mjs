// What each strategy actually RUNS, and what the six slots say about it.
//
// Two things this file is really guarding:
//
//   ONE STRATEGY, ONE ENGINE. runStrategy is the only place that decides
//   which calculator a business model uses. A flip that quietly started
//   running the off-plan model would still produce plausible numbers — the
//   inputs overlap — and nothing else in the product would notice.
//
//   SIX SLOTS, ALWAYS, IN THE SAME ORDER. The summary is the contract
//   between four very different analyses and one reader. A strategy that
//   returned five slots, or put its profit where the last one put its
//   break-even, would silently break the thing that makes the results
//   comparable at a glance.
//
// The renovate model's arithmetic is checked here too, against a deal
// worked by hand below, because it had no test of its own.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch } from '../consultant/context.ts';
import { runStrategy } from '../strategies/run.ts';
import { summarySlots } from '../strategies/summary.ts';
import { STRATEGY_IDS } from '../strategies/definitions.ts';

const ctx = (patch) => applyPatch({}, patch, 'USER', { at: '2026-09-19T00:00:00.000Z' }).context;

/* ── A flip, worked by hand ──────────────────────────────────────────
 *
 *   purchase            100,000
 *   acquisition 4%        4,000
 *   renovation           25,000
 *   furnishing            3,000
 *   holding 800 × 8       6,400
 *   ----------------------------
 *   all in              138,400   over 70 m² = 1,977.14 /m²
 *
 *   resale              180,000
 *   selling 3%            5,400
 *   net proceeds        174,600
 *   profit               36,200   on 138,400 = 26.16%
 *   break-even sale     138,400 / 0.97 = 142,680.41
 */
const FLIP = ctx({
  currency: 'USD',
  purchasePrice: 100_000,
  areaSqm: 70,
  acquisitionCostPercent: 4,
  renovationCost: 25_000,
  furnishingCost: 3_000,
  monthlyHoldingCosts: 800,
  holdMonths: 8,
  exitPriceAssumption: 180_000,
  sellingCostPercent: 3,
  financingMode: 'CASH',
});

test('a flip runs the renovate model and leaves the off-plan one alone', () => {
  const run = runStrategy('RENOVATE_RESELL', FLIP);
  assert.equal(run.strategy, 'RENOVATE_RESELL');
  assert.ok(run.flip, 'the flip summary is built');
  assert.ok(run.model, 'the shared model is built, because the flip is built on it');
  assert.equal(run.construction, null);
  assert.equal(run.value, null);
  assert.deepEqual(run.delays, []);
});

test('the flip arithmetic matches the deal worked by hand', () => {
  const { flip } = runStrategy('RENOVATE_RESELL', FLIP);

  assert.equal(flip.costs.purchasePrice, 100_000);
  assert.equal(flip.costs.acquisitionCosts, 4_000);
  assert.equal(flip.costs.renovation, 25_000);
  assert.equal(flip.costs.furnishing, 3_000);
  assert.equal(flip.costs.holdingCosts, 6_400);
  assert.equal(flip.costs.totalInvestedCapital, 138_400);

  assert.ok(Math.abs(flip.allInCostPerSqm.value - 1_977.14) < 0.5);
  assert.equal(flip.expectedSalePrice.value, 180_000);
  assert.equal(flip.sellingCosts.value, 5_400);
  assert.equal(flip.netSaleProceeds.value, 174_600);
  assert.equal(flip.netProfit.value, 36_200);
  assert.ok(Math.abs(flip.returnOnInvestedCashPercent.value - 26.156) < 0.01);
  assert.ok(Math.abs(flip.breakEvenSalePrice.value - 142_680.41) < 1);
});

test('the flip break-even sits below the expected sale whenever it makes money', () => {
  const { flip } = runStrategy('RENOVATE_RESELL', FLIP);
  assert.ok(flip.breakEvenSalePrice.value < flip.expectedSalePrice.value);
  // Margin of safety is the distance between them, as a share of the sale.
  const expected = ((180_000 - flip.breakEvenSalePrice.value) / 180_000) * 100;
  assert.ok(Math.abs(flip.marginOfSafetyPercent.value - expected) < 0.01);
});

test('renovation entered per m² reaches the engine as a total', () => {
  const perSqm = ctx({
    currency: 'USD',
    purchasePrice: 100_000,
    areaSqm: 70,
    renovationCostPerSqm: 400,
    exitPriceAssumption: 180_000,
    holdMonths: 8,
  });
  const { flip } = runStrategy('RENOVATE_RESELL', perSqm);
  assert.equal(flip.costs.renovation, 28_000);
});

/* ── Off-plan ────────────────────────────────────────────────────── */

const OFFPLAN = ctx({
  currency: 'USD',
  purchasePrice: 120_000,
  areaSqm: 60,
  upfrontPayment: 30_000,
  installmentMonthly: 2_000,
  installmentCount: 20,
  monthsToCompletion: 24,
  exitTiming: 'AT_COMPLETION',
  expectedCompletedPrice: 165_000,
  sellingCostPercent: 3,
});

test('an off-plan purchase runs the construction model and no other', () => {
  const run = runStrategy('CONSTRUCTION_RESALE', OFFPLAN);
  assert.ok(run.construction);
  assert.equal(run.flip, null);
  assert.equal(run.model, null, 'the rental engine is not run for an off-plan deal');
  assert.ok(run.delays.length > 1, 'the delay ladder comes with it');
  assert.ok(run.priceScenarios.length > 1);
});

test('committed, deployed and owed reconcile to the whole price', () => {
  const { construction } = runStrategy('CONSTRUCTION_RESALE', OFFPLAN);
  const deployed = construction.investorCashDeployed.value;
  const owed = construction.remainingObligation.value;
  const committed = construction.totalCapitalCommitted.value;
  // Deployed includes acquisition costs, which are not part of the price,
  // so the identity is on the PRICE: paid to the developer plus owed.
  assert.equal(30_000 + 2_000 * 20 + owed, 120_000);
  assert.ok(deployed <= committed);
});

/* ── Rental ──────────────────────────────────────────────────────── */

const RENTAL = ctx({
  currency: 'USD',
  purchasePrice: 90_000,
  areaSqm: 55,
  monthlyRent: 600,
  vacantMonthsPerYear: 1,
  maintenanceAnnual: 900,
  financingMode: 'CASH',
});

test('a rental runs the shared engine and nothing strategy-specific', () => {
  const run = runStrategy('RENTAL_INVESTMENT', RENTAL);
  assert.ok(run.model);
  assert.equal(run.flip, null);
  assert.equal(run.construction, null);
  assert.equal(run.value, null);
});

/* ── Investment value ────────────────────────────────────────────── */

test('the value backsolve follows the plan the investor chose', () => {
  const rental = runStrategy(
    'INVESTMENT_VALUE',
    ctx({
      currency: 'USD',
      valueStrategy: 'RENTAL_INVESTMENT',
      benchmarkYieldPercent: 8,
      monthlyRent: 700,
      vacantMonthsPerYear: 0.6,
      maintenanceAnnual: 600,
      acquisitionCostPercent: 4,
      proposedPrice: 85_000,
    }),
  );
  assert.ok(rental.value, 'a rental plan produces a price');
  assert.equal(rental.value.strategy, 'RENTAL_INVESTMENT');

  const flip = runStrategy(
    'INVESTMENT_VALUE',
    ctx({
      currency: 'USD',
      valueStrategy: 'RENOVATE_RESELL',
      targetReturnPercent: 20,
      exitPriceAssumption: 180_000,
      renovationCost: 25_000,
      sellingCostPercent: 3,
      acquisitionCostPercent: 4,
      proposedPrice: 100_000,
    }),
  );
  assert.equal(flip.value.strategy, 'RENOVATE_RESELL');

  const offplan = runStrategy(
    'INVESTMENT_VALUE',
    ctx({
      currency: 'USD',
      valueStrategy: 'CONSTRUCTION_RESALE',
      targetReturnPercent: 25,
      expectedCompletedPrice: 165_000,
      sellingCostPercent: 3,
      proposedPrice: 110_000,
    }),
  );
  assert.equal(offplan.value.strategy, 'CONSTRUCTION_RESALE');
});

test('the three price boundaries never cross', () => {
  const { value } = runStrategy(
    'INVESTMENT_VALUE',
    ctx({
      currency: 'USD',
      valueStrategy: 'RENOVATE_RESELL',
      targetReturnPercent: 20,
      exitPriceAssumption: 180_000,
      renovationCost: 25_000,
      sellingCostPercent: 3,
      acquisitionCostPercent: 4,
    }),
  );
  assert.ok(value.targetEntryPrice.value <= value.maximumPrice.value);
  assert.ok(value.maximumPrice.value <= value.breakEvenPrice.value);
});

test('the rental backsolve uses the engine NOI, not a second one', () => {
  // Rent 700 × 12 = 8,400 gross; 0.6 vacant months costs 420; maintenance
  // 600 → NOI 7,380. At an 8% required yield with 4% buying costs the
  // maximum price solves as 7,380 / 0.08 / 1.04 = 88,701.92.
  const { value } = runStrategy(
    'INVESTMENT_VALUE',
    ctx({
      currency: 'USD',
      valueStrategy: 'RENTAL_INVESTMENT',
      benchmarkYieldPercent: 8,
      monthlyRent: 700,
      vacantMonthsPerYear: 0.6,
      maintenanceAnnual: 600,
      acquisitionCostPercent: 4,
    }),
  );
  assert.ok(Math.abs(value.maximumPrice.value - 88_701.92) < 2);
});

test('a strategy with nothing entered produces an empty run, not a crash', () => {
  for (const id of STRATEGY_IDS) {
    const run = runStrategy(id, {});
    assert.equal(run.strategy, id);
    assert.equal(run.model, null);
    assert.equal(run.flip, null);
    assert.equal(run.construction, null);
    assert.equal(run.value, null);
  }
});

test('the value flow shows what a different requirement would buy', () => {
  const run = runStrategy(
    'INVESTMENT_VALUE',
    ctx({
      currency: 'USD',
      valueStrategy: 'RENOVATE_RESELL',
      targetReturnPercent: 20,
      exitPriceAssumption: 190_000,
      renovationCost: 31_500,
      acquisitionCostPercent: 3,
      sellingCostPercent: 3,
      areaSqm: 70,
    }),
  );

  const rows = run.valueSensitivity;
  assert.ok(rows.length > 1, 'a ladder of requirements is produced');

  const current = rows.filter((row) => row.current);
  assert.equal(current.length, 1, 'exactly one row is the one the investor asked for');
  assert.equal(current[0].requirementPercent, 20);
  assert.equal(current[0].maximumPrice.value, run.value.maximumPrice.value,
    'the current row must agree with the headline, or the table contradicts it');

  // Demanding more can only mean paying less. If this ever inverts, the
  // backsolve has its sign the wrong way round.
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(rows[i].requirementPercent > rows[i - 1].requirementPercent);
    assert.ok(
      rows[i].maximumPrice.value < rows[i - 1].maximumPrice.value,
      `requiring ${rows[i].requirementPercent}% did not lower the maximum price`,
    );
  }
});

test('a rental requirement ladder steps in yield, not in whole returns', () => {
  const run = runStrategy(
    'INVESTMENT_VALUE',
    ctx({
      currency: 'USD',
      valueStrategy: 'RENTAL_INVESTMENT',
      benchmarkYieldPercent: 8,
      monthlyRent: 700,
      vacantMonthsPerYear: 0.6,
      maintenanceAnnual: 600,
      acquisitionCostPercent: 4,
    }),
  );
  const steps = run.valueSensitivity.map((row) => row.requirementPercent);
  assert.deepEqual(steps, [6, 7, 8, 9, 10]);
});

test('no requirement ladder without a requirement', () => {
  const run = runStrategy(
    'INVESTMENT_VALUE',
    ctx({ currency: 'USD', valueStrategy: 'RENOVATE_RESELL', exitPriceAssumption: 190_000 }),
  );
  assert.deepEqual(run.valueSensitivity, []);
});

/* ── The summary contract ────────────────────────────────────────── */

const RUNS = {
  RENOVATE_RESELL: () => runStrategy('RENOVATE_RESELL', FLIP),
  CONSTRUCTION_RESALE: () => runStrategy('CONSTRUCTION_RESALE', OFFPLAN),
  RENTAL_INVESTMENT: () => runStrategy('RENTAL_INVESTMENT', RENTAL),
  INVESTMENT_VALUE: () =>
    runStrategy(
      'INVESTMENT_VALUE',
      ctx({
        currency: 'USD',
        valueStrategy: 'RENOVATE_RESELL',
        targetReturnPercent: 20,
        exitPriceAssumption: 180_000,
        renovationCost: 25_000,
        proposedPrice: 100_000,
      }),
    ),
};

test('every strategy fills exactly six slots', () => {
  for (const id of STRATEGY_IDS) {
    assert.equal(summarySlots(RUNS[id]()).length, 6, id);
    assert.equal(summarySlots(runStrategy(id, {})).length, 6, `${id} with nothing entered`);
  }
});

test('exactly one slot is the headline', () => {
  for (const id of STRATEGY_IDS) {
    const emphasised = summarySlots(RUNS[id]()).filter((slot) => slot.emphasis);
    assert.equal(emphasised.length, 1, id);
  }
});

test('an empty strategy reports named gaps, never zeros', () => {
  for (const id of STRATEGY_IDS) {
    for (const slot of summarySlots(runStrategy(id, {}))) {
      assert.equal(slot.figure.value, null, `${id}/${slot.labelKey} invented a number`);
      assert.ok(slot.figure.unavailable, `${id}/${slot.labelKey} has no reason`);
    }
  }
});

test('each strategy labels its slots in its own vocabulary', () => {
  const labels = {};
  for (const id of STRATEGY_IDS) labels[id] = summarySlots(RUNS[id]()).map((s) => s.labelKey);

  // A flip's headline is a profit; a rental's is an annual income. Sharing
  // one label across both would be the product claiming they are the same
  // kind of claim.
  assert.notEqual(labels.RENTAL_INVESTMENT[1], labels.RENOVATE_RESELL[1]);
  assert.notEqual(labels.INVESTMENT_VALUE[0], labels.RENOVATE_RESELL[0]);

  for (const id of STRATEGY_IDS) {
    assert.equal(new Set(labels[id]).size, 6, `${id} repeats a label`);
    for (const key of labels[id]) assert.match(key, /^inv_sum_/);
  }
});

test('the rental headroom is the distance from the rent to the break-even rent', () => {
  const slots = summarySlots(RUNS.RENTAL_INVESTMENT());
  const headroom = slots.find((s) => s.labelKey === 'inv_sum_rent_headroom');
  const floor = slots.find((s) => s.labelKey === 'inv_sum_breakeven_rent');
  if (floor.figure.value === null) {
    // No mortgage to miss: the figure must carry the same reason rather
    // than claiming a flattering 100%.
    assert.equal(headroom.figure.value, null);
    return;
  }
  const expected = ((600 - floor.figure.value) / 600) * 100;
  assert.ok(Math.abs(headroom.figure.value - expected) < 0.01);
});
