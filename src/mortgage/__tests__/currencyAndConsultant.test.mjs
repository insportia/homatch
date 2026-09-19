// SIX CURRENCIES, AND A CONSULTANT THAT DOES NOT DO ARITHMETIC.
//
// Two properties this product can break silently:
//
//   A SCENARIO HAS ONE CURRENCY. Not "mostly one" — a price in dirhams
//   and a payment in lari is not a rounding error, it is a wrong answer
//   presented with total confidence. Nothing converts, so the unit that
//   goes in is the unit that comes out, everywhere.
//
//   THE MODEL IS HANDED NUMBERS, NEVER ASKED FOR THEM. Every figure in
//   the consultant brief has to be reproducible by calling the engine
//   directly with the same inputs. If a what-if ever drifts from the
//   engine, the consultant is quoting something the page would not show.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MORTGAGE_CURRENCIES, MORTGAGE_CURRENCY_CODES, mortgageCurrency } from '../currencies.ts';
import { mortgagePresetsFor } from '../presets.ts';
import { classifyCurrency, selectActiveLtvRule, selectActivePtiRule } from '../rules/ptiLtv.ts';
import { runFullMortgageCalculation, compareTerms, calculateEarlyRepayment } from '../calculations/index.ts';
import { buildConsultantBrief } from '../consultantBrief.ts';

const CODES = ['GEL', 'USD', 'EUR', 'GBP', 'TRY', 'AED'];

/** A loan of the same SHAPE in each currency: 80% financed, 20 years. */
function scenarioFor(code) {
  const price = mortgageCurrency(code).pricePoints[2];
  return {
    propertyPrice: price,
    propertyCurrency: code,
    downPayment: price * 0.2,
    termMonths: 240,
    nominalAnnualRatePercent: 12.4,
  };
}

/* ── The registry ───────────────────────────────────────────────── */

test('the registry carries exactly the six supported currencies', () => {
  assert.deepEqual([...MORTGAGE_CURRENCY_CODES], CODES);
  assert.equal(MORTGAGE_CURRENCIES.length, 6);
  for (const entry of MORTGAGE_CURRENCIES) {
    assert.ok(entry.pricePoints.length >= 4, `${entry.code} has too few illustrations`);
    assert.ok(entry.smallStep > 0, `${entry.code} has no small step`);
    // Ascending, so the chips read as a scale rather than a jumble.
    const sorted = [...entry.pricePoints].sort((a, b) => a - b);
    assert.deepEqual([...entry.pricePoints], sorted, `${entry.code} price points are unordered`);
  }
});

test('an unknown currency code degrades instead of throwing', () => {
  assert.equal(mortgageCurrency('JPY').code, 'GEL');
  assert.equal(mortgageCurrency(null).code, 'GEL');
  assert.equal(mortgageCurrency(undefined).code, 'GEL');
});

test('suggestions are in the currency, not a conversion of another one', () => {
  // TRY prices are millions and GEL prices are hundreds of thousands
  // because that is what a property costs in each place — not because
  // one was multiplied by a rate.
  const gel = mortgagePresetsFor('propertyPrice', { currency: 'GEL' }).map((p) => p.value);
  const lira = mortgagePresetsFor('propertyPrice', { currency: 'TRY' }).map((p) => p.value);
  assert.notDeepEqual(gel, lira);
  assert.ok(Math.min(...lira) >= 1_000_000, 'lira illustrations are the wrong order of magnitude');

  // The step-based flat fees reproduce the original lari figures exactly.
  assert.deepEqual(
    mortgagePresetsFor('monthlyFeeFlat', { currency: 'GEL' }).map((p) => p.value),
    [0, 5, 10, 20],
  );
  assert.deepEqual(
    mortgagePresetsFor('valuationFeeFlat', { currency: 'USD' }).map((p) => p.value),
    [0, 100, 150, 250],
  );
  // And are proportionate elsewhere.
  assert.deepEqual(
    mortgagePresetsFor('monthlyFeeFlat', { currency: 'TRY' }).map((p) => p.value),
    [0, 100, 200, 400],
  );
});

/* ── One scenario, one currency ─────────────────────────────────── */

for (const code of CODES) {
  test(`${code}: the calculation stays in the currency it was given`, () => {
    const input = scenarioFor(code);
    const result = runFullMortgageCalculation(input);

    assert.equal(result.currency, code, 'the result changed currency');
    assert.ok(result.monthlyPayment > 0);
    assert.ok(result.totalInterest > 0);
    assert.ok(result.totalRepayment > result.loanAmount);
    assert.equal(result.loanAmount, input.propertyPrice - input.downPayment);

    // The unit is carried, never converted: the loan is exactly 80% of a
    // price expressed in this currency's own round numbers.
    assert.ok(Math.abs(result.ltvPercent - 80) < 0.01);

    // And every derived view of it agrees.
    for (const row of compareTerms(input)) {
      assert.ok(row.monthlyPayment > 0, `${code} term ${row.termMonths} produced nothing`);
    }
  });
}

test('the same loan in a different currency differs only by its unit', () => {
  // Identical numerals, different code: the arithmetic must be identical,
  // which is the proof that no rate is being applied anywhere.
  const base = { propertyPrice: 150_000, downPayment: 30_000, termMonths: 240, nominalAnnualRatePercent: 12.4 };
  const inGel = runFullMortgageCalculation({ ...base, propertyCurrency: 'GEL' });
  const inAed = runFullMortgageCalculation({ ...base, propertyCurrency: 'AED' });
  assert.equal(inGel.monthlyPayment, inAed.monthlyPayment);
  assert.equal(inGel.totalInterest, inAed.totalInterest);
  assert.notEqual(inGel.currency, inAed.currency);
});

/* ── Regulatory class follows denomination ──────────────────────── */

test('only lari is a local-currency loan; the other five are foreign', () => {
  assert.equal(classifyCurrency('GEL'), 'LOCAL');
  for (const code of CODES.filter((c) => c !== 'GEL')) {
    assert.equal(classifyCurrency(code), 'FOREIGN', `${code} was treated as local`);
  }
});

test('denomination selects the rule row, and the limits really differ', () => {
  const ptiRules = [
    rule('PTI_LIMIT', { currencyClass: 'LOCAL', maxPtiPercent: 50, incomeTierMaxMonthlyNet: null }),
    rule('PTI_LIMIT', { currencyClass: 'FOREIGN', maxPtiPercent: 30, incomeTierMaxMonthlyNet: null }),
  ];
  const ltvRules = [
    rule('LTV_LIMIT', { currencyClass: 'LOCAL', maxLtvPercent: 90 }),
    rule('LTV_LIMIT', { currencyClass: 'FOREIGN', maxLtvPercent: 70 }),
  ];

  const gelPti = selectActivePtiRule(ptiRules, 3200, classifyCurrency('GEL'));
  const usdPti = selectActivePtiRule(ptiRules, 3200, classifyCurrency('USD'));
  assert.equal(gelPti.data.maxPtiPercent, 50);
  assert.equal(usdPti.data.maxPtiPercent, 30);

  assert.equal(selectActiveLtvRule(ltvRules, classifyCurrency('GEL')).data.maxLtvPercent, 90);
  for (const code of ['USD', 'EUR', 'GBP', 'TRY', 'AED']) {
    assert.equal(
      selectActiveLtvRule(ltvRules, classifyCurrency(code)).data.maxLtvPercent,
      70,
      `${code} got the lari LTV ceiling`,
    );
  }
});

function rule(type, data) {
  return {
    id: `${type}-${data.currencyClass}`,
    type,
    title: type,
    data,
    humanExplanation: 'x',
    officialSourceUrl: 'https://example.test',
    sourceAuthority: 'Test',
    effectiveFrom: null,
    effectiveTo: null,
    lastVerifiedAt: '2026-09-19',
    status: 'ACTIVE',
    version: 1,
    supersedesRuleId: null,
    country: 'GE',
    currency: null,
    eligibilityDimensions: null,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

/* ── The consultant brief ───────────────────────────────────────── */

const EMPTY_BRIEF_ARGS = {
  offers: [],
  monthlyNetIncome: null,
  existingMonthlyDebtObligations: null,
  ptiRules: [],
  ltvRules: [],
  ptiRule: null,
  ltvRule: null,
  subsidyPrograms: [],
  ownLoan: {
    remainingPrincipal: null, remainingTermMonths: null, nominalRatePercent: null,
    newRatePercent: null, newTermMonths: null, feesFlat: null,
  },
};

test('every what-if in the brief is reproducible from the engine', () => {
  const input = scenarioFor('USD');
  const brief = buildConsultantBrief({ ...EMPTY_BRIEF_ARGS, input });
  assert.ok(brief);

  // The scenario itself.
  const base = runFullMortgageCalculation(input);
  assert.equal(brief.scenario.monthlyPayment, Math.round(base.monthlyPayment));
  assert.equal(brief.scenario.totalInterest, Math.round(base.totalInterest));
  assert.equal(brief.currency, 'USD');

  // A different term.
  const fifteen = brief.ifTermWere.find((row) => row.termMonths === 180);
  assert.ok(fifteen, 'the brief cannot answer "what about 15 years"');
  const engineFifteen = compareTerms(input).find((row) => row.termMonths === 180);
  assert.equal(fifteen.monthlyPayment, Math.round(engineFifteen.monthlyPayment));

  // A different deposit.
  const thirty = brief.ifDownPaymentWere.find((row) => row.downPaymentPercent === 30);
  assert.ok(thirty, 'the brief cannot answer "what if I put more down"');
  const engineThirty = runFullMortgageCalculation({ ...input, downPayment: input.propertyPrice * 0.3 });
  assert.equal(thirty.monthlyPayment, Math.round(engineThirty.monthlyPayment));

  // A different rate.
  assert.ok(brief.ifRateWere.some((row) => row.nominalAnnualRatePercent === 10.4));
  assert.ok(brief.ifRateWere.some((row) => row.nominalAnnualRatePercent === 14.4));

  // Paying extra.
  assert.ok(brief.ifPaidExtraMonthly.length > 0, 'the brief cannot answer "what if I pay extra"');
  const first = brief.ifPaidExtraMonthly[0];
  const engineExtra = calculateEarlyRepayment(input, {
    extraPaymentAmount: 0,
    extraPaymentMonth: 1,
    recurringMonthlyExtra: first.extraMonthly,
  });
  assert.equal(first.monthsSaved, engineExtra.monthsSaved);
});

test('the brief names what it was not told instead of assuming zero', () => {
  const brief = buildConsultantBrief({ ...EMPTY_BRIEF_ARGS, input: scenarioFor('GEL') });
  assert.ok(brief.unknown.includes('monthly_net_income'), 'silence about income is not recorded');
  assert.ok(brief.unknown.includes('early_repayment_fee'), 'the unknown early-repayment fee is not flagged');
  assert.ok(brief.unknown.includes('rate_type'), 'an unstated rate type is not recorded');
  assert.ok(brief.realCost.costsNotEntered.length > 0, 'unentered bank costs are not named');

  // Nothing was invented to fill the gaps.
  assert.equal(brief.affordability, null);
  assert.equal(brief.offers, null);
  assert.equal(brief.refinancing, null);
  assert.deepEqual(brief.programmes, []);
});

test('a brief cannot be built from a scenario the engine rejects', () => {
  const impossible = { ...scenarioFor('EUR'), downPayment: 999_999_999 };
  assert.equal(buildConsultantBrief({ ...EMPTY_BRIEF_ARGS, input: impossible }), null);
});

test('the brief stays in the scenario currency', () => {
  for (const code of CODES) {
    const brief = buildConsultantBrief({ ...EMPTY_BRIEF_ARGS, input: scenarioFor(code) });
    assert.equal(brief.currency, code);
    assert.ok(brief.scenario.monthlyPayment > 0, `${code} produced no payment`);
    // Money in the ladders is the same unit — there is no per-row code
    // because there is only ever one currency in a brief.
    for (const row of [...brief.ifTermWere, ...brief.ifDownPaymentWere, ...brief.ifRateWere]) {
      assert.ok(row.monthlyPayment > 0);
      assert.ok(row.totalRepayment > row.loanAmount);
    }
  }
});
