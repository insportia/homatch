// Income, vacancy and yield — the arithmetic the whole product rests on.
//
// Imports the REAL modules (Node's TypeScript type-stripping), the same way
// src/mortgage/calculations/__tests__ does, so these assertions are about
// shipped code rather than about a copy of it.
//
// Every figure in the mandate's own worked example is here as a literal:
// $100,000 / $500 a month / 6%, the vacancy ladder at 12, 11 and 10 months,
// and the 6%/7%/8% comparison on the same purchase price. If any of these
// ever flip direction — more income reading as a lower yield — this file is
// what says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIncomeModel,
  buildYieldModel,
  effectiveGrossIncome,
  grossPotentialAnnualIncome,
  occupiedMonthsFor,
  operatingExpenses,
  vacancyLadder,
  vacancyLossAnnual,
} from '../income.ts';
import { buildInvestedCapital } from '../capital.ts';

const base = (over = {}) => ({
  currency: 'USD',
  purchasePrice: 100000,
  monthlyRent: 500,
  ...over,
});

/* ── Gross income and the headline yield ─────────────────────────────── */

test('$500 a month is $6,000 a year', () => {
  assert.equal(grossPotentialAnnualIncome(base()).value, 6000);
});

test('$6,000 a year on a $100,000 purchase price is a 6% gross yield', () => {
  const input = base();
  const income = buildIncomeModel(input);
  const capital = buildInvestedCapital(input);
  const yields = buildYieldModel(income, capital, input.purchasePrice, null);
  assert.equal(yields.grossYieldOnPurchasePrice.value, 6);
});

test('MORE income on the SAME price is a HIGHER yield — 6%, 7%, 8%', () => {
  for (const [annual, expected] of [[6000, 6], [7000, 7], [8000, 8]]) {
    const input = base({ monthlyRent: annual / 12 });
    const income = buildIncomeModel(input);
    const capital = buildInvestedCapital(input);
    const yields = buildYieldModel(income, capital, input.purchasePrice, null);
    assert.equal(
      yields.grossYieldOnPurchasePrice.value,
      expected,
      `${annual} a year on 100,000 must be ${expected}%`,
    );
  }
});

test('a missing rent produces a named gap, never a zero yield', () => {
  const input = base({ monthlyRent: undefined });
  const income = buildIncomeModel(input);
  assert.equal(income.grossPotentialAnnualIncome.value, null);
  assert.equal(income.grossPotentialAnnualIncome.unavailable, 'MISSING_INPUT');
  const capital = buildInvestedCapital(input);
  const yields = buildYieldModel(income, capital, input.purchasePrice, null);
  assert.equal(yields.grossYieldOnPurchasePrice.value, null);
});

test('a purchase price of zero produces no yield rather than infinity', () => {
  const income = buildIncomeModel(base());
  const capital = buildInvestedCapital(base({ purchasePrice: 0.0001 }));
  const yields = buildYieldModel(income, capital, 0, null);
  assert.equal(yields.grossYieldOnPurchasePrice.value, null);
  assert.equal(yields.grossYieldOnPurchasePrice.unavailable, 'MISSING_INPUT');
});

/* ── Vacancy ─────────────────────────────────────────────────────────── */

test('the vacancy ladder: 12, 11 and 10 collected months', () => {
  assert.equal(effectiveGrossIncome(base({ vacantMonthsPerYear: 0 })).value, 6000);
  assert.equal(effectiveGrossIncome(base({ vacantMonthsPerYear: 1 })).value, 5500);
  assert.equal(effectiveGrossIncome(base({ vacantMonthsPerYear: 2 })).value, 5000);
});

test('the same three months as gross yields: 6.0%, 5.5%, 5.0%', () => {
  const ladder = vacancyLadder(base(), [0, 1, 2]);
  assert.deepEqual(
    ladder.map((row) => row.grossYieldOnPurchasePrice.value),
    [6, 5.5, 5],
  );
  assert.deepEqual(
    ladder.map((row) => row.effectiveGrossIncome),
    [6000, 5500, 5000],
  );
});

test('vacancy loss is rent only — other income does not stop with the tenant', () => {
  const input = base({ vacantMonthsPerYear: 2, otherAnnualIncome: 600 });
  assert.equal(vacancyLossAnnual(input).value, 1000);
  assert.equal(grossPotentialAnnualIncome(input).value, 6600);
  assert.equal(effectiveGrossIncome(input).value, 5600);
});

test('vacancy is clamped to a real year rather than rejected', () => {
  assert.equal(occupiedMonthsFor(base({ vacantMonthsPerYear: 20 })), 0);
  assert.equal(occupiedMonthsFor(base({ vacantMonthsPerYear: -5 })), 12);
});

test('no vacancy stated means twelve collected months, and the model says so', () => {
  const income = buildIncomeModel(base());
  assert.equal(income.occupiedMonths, 12);
  assert.equal(income.occupancyRate.value, 100);
});

/* ── Operating costs ─────────────────────────────────────────────────── */

test('with no operating cost supplied there is NO net figure at all', () => {
  const income = buildIncomeModel(base());
  assert.equal(income.operatingExpenses, null);
  assert.equal(income.netOperatingIncome.value, null);
  assert.equal(income.netOperatingIncome.unavailable, 'MISSING_INPUT');
});

test('management is charged on collected rent, not on potential rent', () => {
  const input = base({
    vacantMonthsPerYear: 2,
    operating: { managementPercentOfCollectedRent: 10 },
  });
  const breakdown = operatingExpenses(input, 5000);
  assert.equal(breakdown.lines.find((l) => l.key === 'management').annual, 500);
});

test('every cost category nobody supplied is named as a gap', () => {
  const input = base({ operating: { maintenanceAnnual: 300 } });
  const income = buildIncomeModel(input);
  assert.ok(income.operatingExpenses.knownGaps.includes('propertyTax'));
  assert.ok(income.operatingExpenses.knownGaps.includes('insurance'));
  assert.ok(!income.operatingExpenses.knownGaps.includes('maintenance'));
});

test('net operating income is collected rent less every supplied cost', () => {
  const input = base({
    vacantMonthsPerYear: 1,
    operating: {
      managementPercentOfCollectedRent: 10,
      maintenanceAnnual: 300,
      propertyTaxAnnual: 200,
    },
  });
  const income = buildIncomeModel(input);
  // Collected 5,500. Management 550, maintenance 300, tax 200 = 1,050.
  assert.equal(income.effectiveGrossIncome.value, 5500);
  assert.equal(income.operatingExpenses.totalAnnual, 1050);
  assert.equal(income.netOperatingIncome.value, 4450);
});

test('a letting fee is charged per tenancy, not per year by default', () => {
  const input = base({ operating: { lettingFeePerTenancy: 250, tenanciesPerYear: 2 } });
  const income = buildIncomeModel(input);
  assert.equal(income.operatingExpenses.lines.find((l) => l.key === 'lettingFee').annual, 500);
});

/* ── Yield on invested capital, not just on price ────────────────────── */

test('renovation and acquisition costs lower the yield on invested capital', () => {
  const input = base({ renovationCost: 10000, acquisitionCosts: 3000 });
  const income = buildIncomeModel(input);
  const capital = buildInvestedCapital(input);
  const yields = buildYieldModel(income, capital, input.purchasePrice, null);
  assert.equal(capital.totalPropertyCapital, 113000);
  assert.equal(yields.grossYieldOnPurchasePrice.value, 6);
  // 6,000 / 113,000 = 5.3097...%
  assert.equal(yields.grossYieldOnInvestedCapital.value, 5.3097);
});
