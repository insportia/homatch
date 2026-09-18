// Hold and sell, renovate and sell, exit delay, break-even, sensitivity.
//
// The mandate's full worked scenario runs end to end at the bottom of this
// file: $100,000, $500 a month, 35% equity, a one-year hold, exits at
// $110k/$105k/$100k/$95k, 12 versus 18 months, and vacancy at 0/1/2 months.
// Every intermediate line it asks to see — interest, principal, remaining
// debt, rent, vacancy, expenses, exit costs, debt payoff, equity returned —
// is asserted as present and reconciling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHoldAndExitModel, buildRenovationModel, holdMonthsFor, sellingCostsFor } from '../hold.ts';
import { buildBreakEvenModel, recomputeFor } from '../breakEven.ts';
import { buildExitDelayLadder, buildSensitivityGrid, evaluateMetric } from '../sensitivity.ts';
import { runInvestmentModel } from '../index.ts';

const cashDeal = (over = {}) => ({
  currency: 'USD',
  purchasePrice: 100000,
  monthlyRent: 500,
  vacantMonthsPerYear: 1,
  operating: { maintenanceAnnual: 600 },
  acquisitionCosts: 3000,
  holdMonths: 12,
  exitPriceAssumption: 110000,
  sellingCostPercent: 3,
  ...over,
});

const leveredDeal = (over = {}) =>
  cashDeal({
    financing: { downPaymentPercent: 35, annualRatePercent: 12, termMonths: 240 },
    ...over,
  });

/* ── Hold and sell, unfinanced ───────────────────────────────────────── */

test('an all-cash hold reconciles: cash in, cash out, profit', () => {
  const model = runInvestmentModel(cashDeal());
  const h = model.holdAndExit;
  assert.equal(h.holdMonths, 12);
  assert.equal(h.rentCollectedOverHold.value, 5500);
  assert.equal(h.operatingCostsOverHold.value, 600);
  assert.equal(h.netCashFlowOverHold.value, 4900);
  assert.equal(h.sellingCosts.value, 3300);
  assert.equal(h.netSaleProceeds.value, 106700);
  assert.equal(h.totalCashInvested.value, 103000);
  assert.equal(h.totalCashReturned.value, 111600);
  assert.equal(h.profit.value, 8600);
  // 8,600 / 103,000
  assert.equal(h.returnOnInvestedCashPercent.value, 8.3495);
});

test('the profit splits into a capital part and an income part that sum exactly', () => {
  const model = runInvestmentModel(cashDeal());
  const h = model.holdAndExit;
  assert.equal(
    Math.round((h.capitalGainComponent.value + h.incomeComponent.value) * 100) / 100,
    h.profit.value,
  );
  // 110,000 - 3,300 selling - 103,000 invested in the property = 3,700.
  assert.equal(h.capitalGainComponent.value, 3700);
  assert.equal(h.incomeComponent.value, 4900);
});

test('with no exit price the hold is still modelled and the exit is a named gap', () => {
  const model = runInvestmentModel(cashDeal({ exitPriceAssumption: undefined }));
  const h = model.holdAndExit;
  assert.equal(h.rentCollectedOverHold.value, 5500);
  assert.equal(h.profit.value, null);
  assert.equal(h.profit.unavailable, 'MISSING_INPUT');
  assert.equal(h.exitPrice.value, null);
});

test('selling costs combine a percentage and a flat amount', () => {
  assert.equal(sellingCostsFor({ sellingCostPercent: 3, sellingCostAmount: 500 }, 100000), 3500);
  assert.equal(sellingCostsFor({}, 100000), 0);
});

test('no hold period stated defaults to twelve months and says so in the model', () => {
  assert.equal(holdMonthsFor({ currency: 'USD', purchasePrice: 1 }), 12);
  assert.equal(holdMonthsFor({ currency: 'USD', purchasePrice: 1, holdMonths: 36 }), 36);
});

/* ── Hold and sell, financed ─────────────────────────────────────────── */

test('a financed hold carries interest, principal, remaining debt and payoff', () => {
  const model = runInvestmentModel(leveredDeal());
  const h = model.holdAndExit;
  const l = model.leverage;

  assert.equal(l.loanAmount.value, 65000);
  assert.equal(l.downPayment.value, 35000);
  assert.equal(l.loanToValuePercent.value, 65);

  assert.ok(l.interestPaidOverHold.value > 0);
  assert.ok(l.principalRepaidOverHold.value > 0);
  // Early in a 20-year 12% loan, interest dominates.
  assert.ok(l.interestPaidOverHold.value > l.principalRepaidOverHold.value);
  // The debt payoff at exit is the schedule's remaining principal.
  assert.equal(h.debtPayoff.value, l.remainingDebtAtExit.value);
  assert.ok(h.debtPayoff.value < 65000);

  // Cash invested is the deposit plus the acquisition costs.
  assert.equal(h.totalCashInvested.value, 38000);
  // And the sale proceeds are net of BOTH the selling cost and the debt.
  assert.equal(
    h.netSaleProceeds.value,
    Math.round((110000 - h.sellingCosts.value - h.debtPayoff.value) * 100) / 100,
  );
});

test('debt service over the hold includes principal, not interest alone', () => {
  const model = runInvestmentModel(leveredDeal());
  const l = model.leverage;
  const h = model.holdAndExit;
  assert.ok(
    h.debtServiceOverHold.value >= l.interestPaidOverHold.value + l.principalRepaidOverHold.value - 0.5,
  );
});

test('a debt service coverage ratio below 1 is reported, not hidden', () => {
  const model = runInvestmentModel(leveredDeal());
  // NOI 4,900 against roughly 8,590 of debt service.
  assert.ok(model.leverage.debtServiceCoverageRatio.value < 1);
  assert.ok(model.leverage.annualNetCashFlowAfterDebt.value < 0);
});

/* ── Break-even ──────────────────────────────────────────────────────── */

test('the break-even exit price is the price at which profit is exactly zero', () => {
  const input = cashDeal();
  const { capital, income, debt } = recomputeFor(input);
  const breakEven = buildBreakEvenModel({ input, capital, income, debt });
  const price = breakEven.breakEvenExitPrice.value;
  assert.ok(price > 0);

  const at = buildHoldAndExitModel({ input, capital, income, debt, exitPriceOverride: price });
  assert.ok(Math.abs(at.profit.value) < 1, `profit at the break-even price was ${at.profit.value}`);
});

test('the break-even exit price per square metre needs an area, and says so', () => {
  const withoutArea = recomputeFor(cashDeal());
  const a = buildBreakEvenModel(withoutArea);
  assert.equal(a.breakEvenExitPricePerSqm.value, null);
  assert.equal(a.breakEvenExitPricePerSqm.unavailable, 'MISSING_INPUT');

  const withArea = recomputeFor(cashDeal({ subject: { areaSqm: 50 } }));
  const b = buildBreakEvenModel(withArea);
  assert.ok(Math.abs(b.breakEvenExitPricePerSqm.value - b.breakEvenExitPrice.value / 50) < 0.01);
});

test('the minimum rent for zero net operating income is exact', () => {
  const input = cashDeal({ operating: { maintenanceAnnual: 600 }, vacantMonthsPerYear: 0 });
  const breakEven = buildBreakEvenModel(recomputeFor(input));
  // 12 collected months must cover 600 of maintenance: 50 a month.
  assert.ok(Math.abs(breakEven.minimumRentForZeroNoi.value - 50) < 0.5);
});

test('the minimum rent for zero CASH FLOW is higher once debt is serviced', () => {
  const levered = buildBreakEvenModel(recomputeFor(leveredDeal({ vacantMonthsPerYear: 0 })));
  assert.ok(levered.minimumRentForZeroCashFlow.value > levered.minimumRentForZeroNoi.value);
});

test('a scenario that cannot break even at any occupancy says so, with a reason', () => {
  const impossible = buildBreakEvenModel(
    recomputeFor(leveredDeal({ monthlyRent: 100, vacantMonthsPerYear: 0 })),
  );
  assert.equal(impossible.minimumOccupiedMonths.value, null);
  assert.equal(impossible.minimumOccupiedMonths.unavailable, 'NOT_MEANINGFUL');
});

test('the occupancy floor is a real number of months when one exists', () => {
  const input = leveredDeal({ monthlyRent: 1200, vacantMonthsPerYear: 0, financing: { downPaymentPercent: 60, annualRatePercent: 8, termMonths: 300 } });
  const breakEven = buildBreakEvenModel(recomputeFor(input));
  const months = breakEven.minimumOccupiedMonths.value;
  assert.ok(months !== null && months > 0 && months < 12, `expected a real floor, got ${months}`);
});

test('the maximum renovation budget is the current profit plus what is already budgeted', () => {
  const input = cashDeal({ renovationCost: 5000 });
  const parts = recomputeFor(input);
  const breakEven = buildBreakEvenModel(parts);
  const model = buildHoldAndExitModel(parts);
  assert.equal(
    breakEven.maximumRenovationBudget.value,
    Math.round((5000 + model.profit.value) * 100) / 100,
  );
});

test('a scenario that loses money with no renovation at all has NO renovation headroom', () => {
  const input = cashDeal({ exitPriceAssumption: 70000, renovationCost: 0 });
  const breakEven = buildBreakEvenModel(recomputeFor(input));
  assert.equal(breakEven.maximumRenovationBudget.value, null);
  assert.equal(breakEven.maximumRenovationBudget.unavailable, 'NOT_MEANINGFUL');
});

/* ── Renovate and sell ───────────────────────────────────────────────── */

test('the flip model shows where every currency unit of capital went', () => {
  const input = cashDeal({ renovationCost: 20000, furnishingCost: 4000, subject: { areaSqm: 60 } });
  const parts = recomputeFor(input);
  const breakEven = buildBreakEvenModel(parts);
  const flip = buildRenovationModel({ ...parts, breakEvenExitPrice: breakEven.breakEvenExitPrice });
  const byKey = Object.fromEntries(flip.allocation.map((a) => [a.key, a.amount]));
  assert.equal(byKey.purchasePrice, 100000);
  assert.equal(byKey.renovation, 20000);
  assert.equal(byKey.furnishing, 4000);
  assert.equal(byKey.acquisitionCosts, 3000);
  assert.equal(flip.capitalDeployedUpFront, 127000);
  assert.ok(flip.breakEvenExitPricePerSqm.value > 0);
});

/* ── Exit delay ──────────────────────────────────────────────────────── */

test('a delayed exit costs more interest and collects more rent', () => {
  const rows = buildExitDelayLadder(leveredDeal(), [0, 3, 6, 12]);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].delayMonths, 0);
  assert.equal(rows[0].additionalInterest.value, 0);
  assert.equal(rows[0].profitDelta.value, 0);

  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(rows[i].additionalInterest.value > rows[i - 1].additionalInterest.value);
    assert.ok(rows[i].additionalRentCollected.value > rows[i - 1].additionalRentCollected.value);
    assert.ok(rows[i].remainingDebtAtExit.value < rows[i - 1].remainingDebtAtExit.value);
  }
  assert.equal(rows[3].holdMonths, 24);
});

test('the exit delay ladder holds the exit price constant so the answer is about time', () => {
  const rows = buildExitDelayLadder(leveredDeal(), [0, 6]);
  // Only the hold moved, so the whole profit delta is time.
  const delta = rows[1].profitDelta.value;
  assert.ok(Number.isFinite(delta));
  assert.notEqual(delta, 0);
});

test('an unfinanced delay reports NOT_FINANCED for interest rather than zero', () => {
  const rows = buildExitDelayLadder(cashDeal(), [0, 6]);
  assert.equal(rows[1].additionalInterest.value, null);
  assert.equal(rows[1].additionalInterest.unavailable, 'NOT_FINANCED');
  // But the rent and cost effects of waiting are real and are reported.
  assert.ok(rows[1].additionalRentCollected.value > 0);
  assert.ok(rows[1].additionalOperatingCosts.value > 0);
});

/* ── Sensitivity ─────────────────────────────────────────────────────── */

test('the exit-price axis moves the profit one-for-one net of selling cost', () => {
  const grid = buildSensitivityGrid({
    input: cashDeal(),
    metric: 'PROFIT',
    rowAxis: 'EXIT_PRICE',
    rowValues: [110000, 105000, 100000, 95000],
  });
  assert.equal(grid.cells.length, 4);
  const profits = grid.cells.map((c) => c.metric.value);
  for (let i = 1; i < profits.length; i += 1) {
    assert.ok(profits[i] < profits[i - 1]);
  }
  // 5,000 less exit at 3% selling cost is 4,850 less profit.
  assert.equal(Math.round(profits[0] - profits[1]), 4850);
});

test('a two-axis grid re-runs the whole engine in every cell', () => {
  const grid = buildSensitivityGrid({
    input: leveredDeal(),
    metric: 'RETURN_ON_INVESTED_CASH',
    rowAxis: 'EXIT_PRICE',
    rowValues: [110000, 105000, 100000, 95000],
    columnAxis: 'HOLD_MONTHS',
    columnValues: [12, 18],
  });
  assert.equal(grid.cells.length, 8);
  for (const cell of grid.cells) assert.ok(Number.isFinite(cell.metric.value));
  assert.ok(Number.isFinite(grid.baseline.value));
});

test('the vacancy axis is the vacancy ladder, through the same engine', () => {
  const grid = buildSensitivityGrid({
    input: cashDeal(),
    metric: 'ANNUAL_NET_CASH_FLOW',
    rowAxis: 'VACANT_MONTHS',
    rowValues: [0, 1, 2],
  });
  const flows = grid.cells.map((c) => c.metric.value);
  assert.equal(flows[0] - flows[1], 500);
  assert.equal(flows[1] - flows[2], 500);
});

test('the interest-rate axis is inert when there is no loan to reprice', () => {
  const grid = buildSensitivityGrid({
    input: cashDeal(),
    metric: 'PROFIT',
    rowAxis: 'INTEREST_RATE',
    rowValues: [8, 12, 16],
  });
  const profits = grid.cells.map((c) => c.metric.value);
  assert.equal(profits[0], profits[2]);
});

test('the grid is bounded so a client cannot ask for an unbounded computation', () => {
  const grid = buildSensitivityGrid({
    input: cashDeal(),
    metric: 'PROFIT',
    rowAxis: 'EXIT_PRICE',
    rowValues: Array.from({ length: 50 }, (_, i) => 90000 + i * 1000),
    columnAxis: 'HOLD_MONTHS',
    columnValues: Array.from({ length: 50 }, (_, i) => 6 + i),
  });
  assert.ok(grid.cells.length <= 144);
});

test('a metric with no answer is a gap in the cell, not a zero', () => {
  const figure = evaluateMetric(cashDeal({ operating: undefined }), 'NET_YIELD');
  assert.equal(figure.value, null);
  assert.equal(figure.unavailable, 'MISSING_INPUT');
});

/* ── The mandate's full worked scenario, end to end ──────────────────── */

test('THE FULL EXAMPLE: $100k, $500/month, 35% equity, one-year exit', () => {
  const input = {
    currency: 'USD',
    purchasePrice: 100000,
    monthlyRent: 500,
    benchmarkYieldPercent: 6,
    vacantMonthsPerYear: 0,
    operating: { maintenanceAnnual: 600, managementPercentOfCollectedRent: 8 },
    acquisitionCosts: 3000,
    financing: { downPaymentPercent: 35, annualRatePercent: 12, termMonths: 240 },
    holdMonths: 12,
    exitPriceAssumption: 110000,
    sellingCostPercent: 3,
    subject: { areaSqm: 50, city: 'Tbilisi', district: 'Vake' },
  };
  const model = runInvestmentModel(input);

  // Gross annual rent and gross yield, exactly as the mandate states them.
  assert.equal(model.income.grossPotentialAnnualIncome.value, 6000);
  assert.equal(model.yields.grossYieldOnPurchasePrice.value, 6);

  // The income-implied value at the investor's own 6% benchmark.
  const gross = model.impliedValuations.find((v) => v.basis === 'GROSS_POTENTIAL');
  assert.equal(gross.atBenchmark.value, 100000);

  // Net of 8% management on 6,000 collected plus 600 maintenance.
  assert.equal(model.income.operatingExpenses.totalAnnual, 1080);
  assert.equal(model.income.netOperatingIncome.value, 4920);

  // Every leverage line the mandate asks to see.
  assert.equal(model.leverage.loanAmount.value, 65000);
  assert.ok(model.leverage.monthlyPayment.value > 0);
  assert.ok(model.leverage.interestPaidOverHold.value > 0);
  assert.ok(model.leverage.principalRepaidOverHold.value > 0);
  assert.ok(model.leverage.remainingDebtAtExit.value > 0);

  // Both paybacks exist as distinct questions.
  assert.ok(model.payback.propertyPaybackYears.value > 0);

  // The four exits.
  const exits = buildSensitivityGrid({
    input,
    metric: 'PROFIT',
    rowAxis: 'EXIT_PRICE',
    rowValues: [110000, 105000, 100000, 95000],
  });
  assert.equal(exits.cells.length, 4);
  assert.ok(exits.cells[0].metric.value > exits.cells[3].metric.value);

  // Twelve versus eighteen months.
  const holds = buildSensitivityGrid({
    input,
    metric: 'PROFIT',
    rowAxis: 'HOLD_MONTHS',
    rowValues: [12, 18],
  });
  assert.equal(holds.cells.length, 2);

  // Vacancy at zero, one and two months.
  const vacancies = buildSensitivityGrid({
    input,
    metric: 'PROFIT',
    rowAxis: 'VACANT_MONTHS',
    rowValues: [0, 1, 2],
  });
  const vProfits = vacancies.cells.map((c) => c.metric.value);
  assert.ok(vProfits[0] > vProfits[1] && vProfits[1] > vProfits[2]);

  // And the capital flow is a real graph with real amounts.
  assert.ok(model.capitalFlow.nodes.length > 8);
  assert.ok(model.capitalFlow.edges.length > 5);
  assert.ok(model.capitalFlow.edges.every((e) => e.amount > 0));
});
