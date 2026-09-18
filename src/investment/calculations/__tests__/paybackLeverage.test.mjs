// Invested capital, both paybacks, and the debt leg.
//
// The mandate's payback figures are literals:
//   $100,000 / $6,000 ≈ 16.67 years
//   $100,000 / $8,000 = 12.5 years
//   $100,000 / $5,000 = 20 years
//   $113,000 / $6,500 ≈ 17.38 years   (100k purchase + 10k renovation + 3k costs)
//
// And the calculation this product must NEVER make is asserted as an
// inequality: a $100k flat bought with 35% equity and sold at $110k after a
// year is not a 28.6% return, and the engine's answer must differ from it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInvestedCapital, buildPaybackModel, recoveryMonth } from '../capital.ts';
import { buildDebtLeg, buildLeverageModel, sliceSchedule, toMortgageInput } from '../leverage.ts';
import { buildIncomeModel } from '../income.ts';
import { paybackYears } from '../core.ts';
import { runInvestmentModel } from '../index.ts';

/* ── Payback arithmetic, exactly as the mandate states it ────────────── */

test('$100,000 recovered at $6,000 a year is 16.67 years', () => {
  assert.equal(paybackYears(100000, 6000, 'x').value, 16.67);
});

test('$100,000 at $8,000 is 12.5 years and at $5,000 is 20 years', () => {
  assert.equal(paybackYears(100000, 8000, 'x').value, 12.5);
  assert.equal(paybackYears(100000, 5000, 'x').value, 20);
});

test('payback uses ACTUAL invested capital: 113,000 / 6,500 ≈ 17.38 years', () => {
  const input = {
    currency: 'USD',
    purchasePrice: 100000,
    renovationCost: 10000,
    acquisitionCosts: 3000,
  };
  const capital = buildInvestedCapital(input);
  assert.equal(capital.totalPropertyCapital, 113000);
  assert.equal(paybackYears(capital.totalPropertyCapital, 6500, 'x').value, 17.38);
});

test('zero or negative income has no payback period, and says why', () => {
  assert.equal(paybackYears(100000, 0, 'x').unavailable, 'NO_POSITIVE_INCOME');
  assert.equal(paybackYears(100000, -500, 'x').unavailable, 'NO_POSITIVE_INCOME');
});

/* ── Invested capital ────────────────────────────────────────────────── */

test('an unfinanced purchase has the whole price as investor cash', () => {
  const capital = buildInvestedCapital({ currency: 'USD', purchasePrice: 100000 });
  assert.equal(capital.investorCashInvested, 100000);
  assert.equal(capital.loanAmount, 0);
});

test('35% equity on $100,000 is $35,000 down and a $65,000 loan', () => {
  const capital = buildInvestedCapital({
    currency: 'USD',
    purchasePrice: 100000,
    financing: { downPaymentPercent: 35, annualRatePercent: 11, termMonths: 240 },
  });
  assert.equal(capital.loanAmount, 65000);
  assert.equal(capital.investorCashInvested, 35000);
});

test('acquisition costs as a percentage resolve against the purchase price', () => {
  const capital = buildInvestedCapital({
    currency: 'USD',
    purchasePrice: 100000,
    acquisitionCostPercent: 3,
  });
  assert.equal(capital.acquisitionCosts, 3000);
});

test('an absolute acquisition cost wins over a percentage', () => {
  const capital = buildInvestedCapital({
    currency: 'USD',
    purchasePrice: 100000,
    acquisitionCosts: 2500,
    acquisitionCostPercent: 3,
  });
  assert.equal(capital.acquisitionCosts, 2500);
});

test('financing with no equity figure assumes NO loan rather than a deposit', () => {
  // Inventing "20% is normal" would fabricate the most decision-relevant
  // number in the scenario, so the engine treats it as fully cash-bought
  // until the investor says otherwise.
  const capital = buildInvestedCapital({
    currency: 'USD',
    purchasePrice: 100000,
    financing: { annualRatePercent: 11, termMonths: 240 },
  });
  assert.equal(capital.loanAmount, 0);
  assert.equal(capital.investorCashInvested, 100000);
});

/* ── The debt leg comes from the mortgage engine ─────────────────────── */

test('the investment scenario translates into the mortgage engine input', () => {
  const input = {
    currency: 'USD',
    purchasePrice: 100000,
    financing: { downPaymentPercent: 35, annualRatePercent: 12, termMonths: 240 },
  };
  const capital = buildInvestedCapital(input);
  const mortgageInput = toMortgageInput(input, capital);
  assert.equal(mortgageInput.propertyPrice, 100000);
  assert.equal(mortgageInput.downPayment, 35000);
  assert.equal(mortgageInput.termMonths, 240);
  assert.equal(mortgageInput.nominalAnnualRatePercent, 12);
});

test('the monthly payment matches the standard annuity formula', () => {
  const input = {
    currency: 'USD',
    purchasePrice: 100000,
    financing: { downPaymentPercent: 35, annualRatePercent: 12, termMonths: 240 },
  };
  const capital = buildInvestedCapital(input);
  const debt = buildDebtLeg(input, capital);
  // 65,000 at 1% a month over 240 months.
  const r = 0.01;
  const expected = (65000 * r * Math.pow(1 + r, 240)) / (Math.pow(1 + r, 240) - 1);
  assert.ok(Math.abs(debt.monthlyPayment - expected) < 0.01);
});

test('interest and principal over the hold are the schedule, not an average', () => {
  const input = {
    currency: 'USD',
    purchasePrice: 100000,
    financing: { downPaymentPercent: 35, annualRatePercent: 12, termMonths: 240 },
  };
  const capital = buildInvestedCapital(input);
  const debt = buildDebtLeg(input, capital);
  const year = sliceSchedule(debt.schedule, 12);
  // Early in a 20-year loan almost all of the payment is interest.
  assert.ok(year.interest > year.principal * 5);
  assert.ok(Math.abs(year.remainingPrincipal - (65000 - year.principal)) < 1);
});

test('an unfinanced scenario reports NOT_FINANCED rather than zero debt', () => {
  const input = { currency: 'USD', purchasePrice: 100000, monthlyRent: 500 };
  const capital = buildInvestedCapital(input);
  const debt = buildDebtLeg(input, capital);
  const income = buildIncomeModel(input);
  const leverage = buildLeverageModel({
    input,
    capital,
    debt,
    netOperatingIncome: income.netOperatingIncome.value,
    holdMonths: 12,
  });
  assert.equal(leverage.financed, false);
  assert.equal(leverage.monthlyPayment.value, null);
  assert.equal(leverage.monthlyPayment.unavailable, 'NOT_FINANCED');
});

test('an impossible financing input is refused, not silently corrected', () => {
  const input = {
    currency: 'USD',
    purchasePrice: 100000,
    financing: { downPaymentPercent: 35, annualRatePercent: 12, termMonths: 0 },
  };
  const capital = buildInvestedCapital(input);
  const debt = buildDebtLeg(input, capital);
  assert.equal(debt.refusalMessageKey, 'mortgage_error_term_invalid');
});

/* ── Property payback is NOT equity payback ──────────────────────────── */

test('property payback and equity payback are different numbers', () => {
  const input = {
    currency: 'USD',
    purchasePrice: 100000,
    monthlyRent: 500,
    operating: { maintenanceAnnual: 600 },
    financing: { downPaymentPercent: 35, annualRatePercent: 12, termMonths: 240 },
  };
  const model = runInvestmentModel(input);
  const property = model.payback.propertyPaybackYears.value;
  const equity = model.payback.equityPaybackYears;
  assert.ok(property > 0);
  // 5,400 NOI against roughly 8,590 of annual debt service: cash flow is
  // negative, so there IS no equity payback and the engine must say so
  // rather than emitting a negative number of years.
  assert.equal(equity.value, null);
  assert.equal(equity.unavailable, 'NO_POSITIVE_INCOME');
});

test('when cash flow IS positive, equity payback is shorter than property payback', () => {
  const input = {
    currency: 'USD',
    purchasePrice: 100000,
    monthlyRent: 1200,
    operating: { maintenanceAnnual: 600 },
    financing: { downPaymentPercent: 50, annualRatePercent: 6, termMonths: 300 },
  };
  const model = runInvestmentModel(input);
  assert.ok(model.payback.propertyPaybackYears.value > 0);
  assert.ok(model.payback.equityPaybackYears.value > 0);
  assert.ok(
    model.payback.equityPaybackYears.value < model.payback.propertyPaybackYears.value,
    'leverage on a cash-flow-positive deal recovers the investor cash sooner',
  );
});

test('the recovery timeline crosses where the arithmetic says it does', () => {
  const timeline = [
    { month: 1, cumulativeNetCashFlow: 400, cumulativePrincipalRepaid: 0 },
    { month: 2, cumulativeNetCashFlow: 800, cumulativePrincipalRepaid: 0 },
    { month: 3, cumulativeNetCashFlow: 1200, cumulativePrincipalRepaid: 0 },
  ];
  assert.equal(recoveryMonth(timeline, 800).value, 2);
  assert.equal(recoveryMonth(timeline, 5000).unavailable, 'NEVER_RECOVERS');
});

test('a payback model with no income at all produces gaps, never zeros', () => {
  const payback = buildPaybackModel({
    capital: buildInvestedCapital({ currency: 'USD', purchasePrice: 100000 }),
    netOperatingIncome: null,
    annualNetCashFlowAfterDebt: null,
    monthlyPrincipalRepaid: [],
  });
  assert.equal(payback.propertyPaybackYears.value, null);
  assert.equal(payback.equityPaybackYears.value, null);
  assert.equal(payback.timeline.length, 0);
});

/* ── The forbidden calculation ───────────────────────────────────────── */

test('the naive leveraged return (110k-100k)/35k = 28.6% is NOT what we report', () => {
  const input = {
    currency: 'USD',
    purchasePrice: 100000,
    monthlyRent: 500,
    vacantMonthsPerYear: 1,
    operating: { maintenanceAnnual: 600 },
    acquisitionCosts: 3000,
    financing: { downPaymentPercent: 35, annualRatePercent: 12, termMonths: 240 },
    holdMonths: 12,
    exitPriceAssumption: 110000,
    sellingCostPercent: 3,
  };
  const model = runInvestmentModel(input);
  const naive = ((110000 - 100000) / 35000) * 100; // 28.571...
  const reported = model.holdAndExit.returnOnInvestedCashPercent.value;
  assert.ok(
    Math.abs(reported - naive) > 5,
    `the honest return (${reported}%) must differ materially from the naive ${naive.toFixed(1)}%`,
  );
  // And every omitted term is actually present in the model.
  assert.ok(model.holdAndExit.debtServiceOverHold.value > 0);
  assert.ok(model.holdAndExit.sellingCosts.value > 0);
  assert.ok(model.holdAndExit.debtPayoff.value > 0);
  assert.ok(model.holdAndExit.rentCollectedOverHold.value > 0);
  assert.equal(model.holdAndExit.totalCashInvested.value, 38000);
});
