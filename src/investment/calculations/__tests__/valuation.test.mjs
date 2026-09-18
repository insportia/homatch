// Income-implied value, the yield spectrum, and positioning a price.
//
// The mandate's exact figures are literals here:
//   $8,000 / 6% ≈ $133,333    $6,000 / 6% = $100,000    $5,000 / 6% ≈ $83,333
// and the inverse ladder at a fixed $6,000 income:
//   4% → $150,000   5% → $120,000   6% → $100,000   7% ≈ $85,714   8% → $75,000
//
// The two directions are asserted in the same file on purpose. income.ts's
// tests say "more income is a higher yield"; these say "a higher required
// yield is a lower value". Both are true, they hold different things fixed,
// and confusing them is the single most likely way this product could
// mislead somebody about their own money.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildImpliedValuations,
  impliedValueSpectrum,
  incomeImpliedValue,
  positionAgainstEvidence,
  yieldImpliedByPrice,
} from '../valuation.ts';
import { buildIncomeModel } from '../income.ts';

/* ── The core division ───────────────────────────────────────────────── */

test('$8,000 of annual income at a 6% requirement implies about $133,333', () => {
  assert.equal(incomeImpliedValue(8000, 6), 133333.33);
});

test('$6,000 at 6% implies exactly the $100,000 purchase price', () => {
  assert.equal(incomeImpliedValue(6000, 6), 100000);
});

test('$5,000 at 6% implies about $83,333', () => {
  assert.equal(incomeImpliedValue(5000, 6), 83333.33);
});

test('$4,000 at 6% implies about $66,667 and $7,000 implies about $116,667', () => {
  assert.equal(incomeImpliedValue(4000, 6), 66666.67);
  assert.equal(incomeImpliedValue(7000, 6), 116666.67);
});

test('LESS income at a fixed benchmark implies a LOWER value, monotonically', () => {
  const values = [4000, 5000, 6000, 7000, 8000].map((i) => incomeImpliedValue(i, 6));
  for (let i = 1; i < values.length; i += 1) {
    assert.ok(values[i] > values[i - 1], `${values[i]} must exceed ${values[i - 1]}`);
  }
});

/* ── The inverse ─────────────────────────────────────────────────────── */

test('at a fixed $6,000 income, a higher required yield implies a lower value', () => {
  const spectrum = impliedValueSpectrum(6000, [4, 5, 6, 7, 8]);
  assert.deepEqual(
    spectrum.map((p) => p.impliedValue),
    [150000, 120000, 100000, 85714.29, 75000],
  );
  for (let i = 1; i < spectrum.length; i += 1) {
    assert.ok(spectrum[i].impliedValue < spectrum[i - 1].impliedValue);
  }
});

test('a required yield of zero or below has no implied value at all', () => {
  assert.equal(incomeImpliedValue(6000, 0), null);
  assert.equal(incomeImpliedValue(6000, -3), null);
});

test('the spectrum silently drops impossible yields rather than emitting Infinity', () => {
  const spectrum = impliedValueSpectrum(6000, [0, 6]);
  assert.equal(spectrum.length, 1);
  assert.equal(spectrum[0].impliedValue, 100000);
});

/* ── One valuation per income basis, never a blend ───────────────────── */

test('gross, effective and net income each get their OWN implied value', () => {
  const input = {
    currency: 'USD',
    purchasePrice: 100000,
    monthlyRent: 500,
    vacantMonthsPerYear: 1,
    operating: { maintenanceAnnual: 500 },
    benchmarkYieldPercent: 6,
  };
  const income = buildIncomeModel(input);
  const valuations = buildImpliedValuations(input, income);
  const byBasis = Object.fromEntries(valuations.map((v) => [v.basis, v]));

  assert.equal(byBasis.GROSS_POTENTIAL.annualIncome, 6000);
  assert.equal(byBasis.GROSS_POTENTIAL.atBenchmark.value, 100000);
  assert.equal(byBasis.EFFECTIVE_GROSS.annualIncome, 5500);
  assert.equal(byBasis.EFFECTIVE_GROSS.atBenchmark.value, 91666.67);
  assert.equal(byBasis.NET_OPERATING.annualIncome, 5000);
  assert.equal(byBasis.NET_OPERATING.atBenchmark.value, 83333.33);
});

test('with no benchmark yield, the implied value at benchmark is a named gap', () => {
  const input = { currency: 'USD', purchasePrice: 100000, monthlyRent: 500 };
  const income = buildIncomeModel(input);
  const [gross] = buildImpliedValuations(input, income);
  assert.equal(gross.atBenchmark.value, null);
  assert.equal(gross.atBenchmark.unavailable, 'MISSING_INPUT');
  // The spectrum is still drawn: it needs no benchmark to be useful.
  assert.ok(gross.spectrum.length > 0);
});

/* ── Positioning, and the refusal to invent a market ─────────────────── */

test('with no researched range there is NO verdict, only NO_EVIDENCE', () => {
  const position = positionAgainstEvidence({
    purchasePrice: 100000,
    askingPrice: 120000,
    incomeImpliedValue: 133333.33,
  });
  assert.equal(position.verdict, 'NO_EVIDENCE');
  assert.equal(position.positionInRange, null);
});

test('the gap to the income-implied value is never called a profit', () => {
  const position = positionAgainstEvidence({
    purchasePrice: 100000,
    incomeImpliedValue: 133333.33,
  });
  // The field name is the guarantee; the value is the arithmetic.
  assert.equal(position.differenceVsIncomeImplied, 33333.33);
  assert.ok(!('profit' in position));
  assert.ok(!('gain' in position));
});

test('a price inside the researched range reads as WITHIN_RANGE', () => {
  const position = positionAgainstEvidence({
    purchasePrice: 110000,
    comparableRange: {
      low: 105000,
      median: 110000,
      high: 115000,
      currency: 'USD',
      independentSourceCount: 2,
      observationCount: 7,
      basis: 'ASKING',
    },
  });
  assert.equal(position.verdict, 'WITHIN_RANGE');
  assert.equal(position.positionInRange, 0.5);
});

test('above and below the range are distinguished, not collapsed into "bad"', () => {
  const range = {
    low: 105000,
    median: 110000,
    high: 115000,
    currency: 'USD',
    independentSourceCount: 2,
    observationCount: 7,
    basis: 'ASKING',
  };
  assert.equal(positionAgainstEvidence({ purchasePrice: 99000, comparableRange: range }).verdict, 'BELOW_RANGE');
  assert.equal(positionAgainstEvidence({ purchasePrice: 130000, comparableRange: range }).verdict, 'ABOVE_RANGE');
});

test('every point on the rail carries the basis it was observed on', () => {
  const position = positionAgainstEvidence({
    purchasePrice: 100000,
    askingPrice: 120000,
    incomeImpliedValue: 133333.33,
    comparableRange: {
      low: 105000,
      median: 110000,
      high: 115000,
      currency: 'USD',
      independentSourceCount: 2,
      observationCount: 7,
      basis: 'ASKING',
    },
  });
  const byKey = Object.fromEntries(position.points.map((p) => [p.key, p]));
  assert.equal(byKey.ASKING_PRICE.basis, 'ASKING');
  assert.equal(byKey.PURCHASE_PRICE.basis, 'USER');
  assert.equal(byKey.INCOME_IMPLIED.basis, 'MODELLED');
  assert.equal(byKey.MARKET_COMPARABLE_MEDIAN.basis, 'ASKING');
});

test('the yield a price implies is the same arithmetic read backwards', () => {
  assert.equal(yieldImpliedByPrice(8000, 100000).value, 8);
  assert.equal(yieldImpliedByPrice(8000, 133333.33).value, 6);
  assert.equal(yieldImpliedByPrice(6000, 0).value, null);
});
