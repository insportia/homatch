import test from 'node:test';
import assert from 'node:assert/strict';
import { assessReadiness, readinessScenarios, loanForPayment, bandThresholdFor, INCOME_SOURCES } from '../readiness.ts';
import { selectActivePtiRule, ptiCurrencyClass } from '../rules/ptiLtv.ts';
import { computeMonthlyPayment } from '../calculations/amortization.ts';

/* Rule rows shaped like mortgage_rules, values as published by the National
   Bank of Georgia (verified 2026-10-24), plus the announced 2027 band changes. */
const rule = (id, data, extra = {}) => ({
  id, type: data.maxLtvPercent ? 'LTV_LIMIT' : 'PTI_LIMIT', title: id, data,
  humanExplanation: '', officialSourceUrl: 'https://nbg.gov.ge/en/page/pti-and-ltv-requirements',
  sourceAuthority: 'National Bank of Georgia', effectiveFrom: null, effectiveTo: null,
  lastVerifiedAt: '2026-10-24', status: 'ACTIVE', version: 1, supersedesRuleId: null,
  country: 'GE', currency: null, eligibilityDimensions: null, createdAt: '2026-10-24', ...extra,
});
const PTI = [
  rule('gel-low', { currencyClass: 'LOCAL', maxPtiPercent: 25, incomeTierMaxMonthlyNet: 1500 }, { effectiveTo: '2027-01-31' }),
  rule('gel-low-2027a', { currencyClass: 'LOCAL', maxPtiPercent: 25, incomeTierMaxMonthlyNet: 2000 }, { effectiveFrom: '2027-02-01', effectiveTo: '2027-08-31' }),
  rule('gel-low-2027b', { currencyClass: 'LOCAL', maxPtiPercent: 25, incomeTierMaxMonthlyNet: 2500 }, { effectiveFrom: '2027-09-01' }),
  rule('gel-high', { currencyClass: 'LOCAL', maxPtiPercent: 50, incomeTierMaxMonthlyNet: null }),
  rule('fx-low', { currencyClass: 'FOREIGN', maxPtiPercent: 20, incomeTierMaxMonthlyNet: 1500 }),
  rule('fx-high', { currencyClass: 'FOREIGN', maxPtiPercent: 30, incomeTierMaxMonthlyNet: null }),
];
const LTV = [
  rule('ltv-gel', { currencyClass: 'LOCAL', maxLtvPercent: 90 }),
  rule('ltv-fx', { currencyClass: 'FOREIGN', maxLtvPercent: 70 }),
];
const TODAY = new Date('2026-10-24T12:00:00Z');

const base = {
  price: 200000, currency: 'GEL', downPayment: 40000, termMonths: 240, ratePercent: 12,
  netMonthlyIncome: 6000, incomeInLoanCurrency: true, incomeAtLeastBand: null,
  existingMonthlyDebt: 0, source: 'SALARIED', history: 'OVER_24', credit: 'CLEAN',
  coBorrower: null, additionalCollateralValue: null,
};

test('date-effective rules: the 25% band widens on its announced dates, not before', () => {
  assert.equal(selectActivePtiRule(PTI, 1800, 'LOCAL', TODAY).id, 'gel-high');
  assert.equal(selectActivePtiRule(PTI, 1800, 'LOCAL', new Date('2027-02-01')).id, 'gel-low-2027a');
  assert.equal(selectActivePtiRule(PTI, 2400, 'LOCAL', new Date('2027-08-31')).id, 'gel-high');
  assert.equal(selectActivePtiRule(PTI, 2400, 'LOCAL', new Date('2027-09-01')).id, 'gel-low-2027b');
  assert.equal(bandThresholdFor(PTI, 'LOCAL', TODAY), 1500);
  assert.equal(bandThresholdFor(PTI, 'LOCAL', new Date('2027-09-02')), 2500);
});

test('a borrower earning in the loan currency is read against the GEL column', () => {
  assert.equal(ptiCurrencyClass('GEL'), 'LOCAL');
  assert.equal(ptiCurrencyClass('USD'), 'FOREIGN');
  assert.equal(ptiCurrencyClass('USD', true), 'LOCAL');
  assert.equal(ptiCurrencyClass('USD', false), 'FOREIGN');
});

test('a comfortable GEL scenario is HIGH, with limits and sources attached', () => {
  const r = assessReadiness(base, PTI, LTV, TODAY);
  assert.equal(r.tier, 'HIGH');
  assert.equal(r.ptiLimit, 50);
  assert.equal(r.ltvLimit, 90);
  assert.equal(r.ltvPercent, 80);
  assert.equal(r.ptiRule.authority, 'National Bank of Georgia');
  assert.ok(r.ptiPercent > 0 && r.ptiPercent < 45);
  assert.deepEqual(r.gaps, []);
});

test('insufficient income is CONDITIONS, with the exact shortfall and the largest supported loan', () => {
  const r = assessReadiness({ ...base, netMonthlyIncome: 3000 }, PTI, LTV, TODAY);
  assert.equal(r.tier, 'CONDITIONS');
  const pti = r.checks.find((c) => c.key === 'PTI');
  assert.equal(pti.status, 'NOT_MET');
  const incomeGap = r.gaps.find((g) => g.key === 'INCOME').amount;
  // With that extra income the payment sits exactly on the limit.
  assert.ok(Math.abs(((r.monthlyPayment) / (3000 + incomeGap)) * 100 - 50) < 0.05);
  // The supported loan really does produce the maximum payment.
  assert.ok(Math.abs(computeMonthlyPayment(r.maxLoan, 12, 240) - r.maxPayment) <= 0.02);
});

test('a co-borrower adds income and obligations; collateral moves LTV only', () => {
  const weak = { ...base, netMonthlyIncome: 3000 };
  const withCo = assessReadiness({ ...weak, coBorrower: { netMonthlyIncome: 2500, monthlyDebt: 200 } }, PTI, LTV, TODAY);
  assert.equal(withCo.totalIncome, 5500);
  assert.equal(withCo.totalDebt, 200);
  assert.notEqual(withCo.checks.find((c) => c.key === 'PTI').status, 'NOT_MET');

  const highLtv = { ...base, currency: 'USD', incomeInLoanCurrency: true, downPayment: 40000, netMonthlyIncome: 9000, incomeAtLeastBand: true };
  const noCollateral = assessReadiness(highLtv, PTI, LTV, TODAY);
  assert.equal(noCollateral.checks.find((c) => c.key === 'LTV').status, 'NOT_MET'); // 80% > 70% for FX
  const withCollateral = assessReadiness({ ...highLtv, additionalCollateralValue: 60000 }, PTI, LTV, TODAY);
  assert.equal(withCollateral.checks.find((c) => c.key === 'LTV').status, 'ATTENTION');
  // Collateral never changes repayment capacity.
  assert.equal(withCollateral.ptiPercent, noCollateral.ptiPercent);
});

test('a foreign-currency loan needs the band answer; nothing is converted', () => {
  const fx = { ...base, currency: 'USD', downPayment: 70000, incomeInLoanCurrency: false, netMonthlyIncome: 4000 };
  assert.equal(assessReadiness(fx, PTI, LTV, TODAY).tier, 'INCOMPLETE');
  const above = assessReadiness({ ...fx, incomeAtLeastBand: true }, PTI, LTV, TODAY);
  assert.equal(above.ptiLimit, 30);
  assert.ok(above.checks.some((c) => c.key === 'CURRENCY' && c.status === 'ATTENTION'));
  const hedged = assessReadiness({ ...fx, incomeInLoanCurrency: true, incomeAtLeastBand: true }, PTI, LTV, TODAY);
  assert.equal(hedged.ptiLimit, 50);
});

test('self-employment is a documents question, never a rejection', () => {
  const r = assessReadiness({ ...base, source: 'SELF_EMPLOYED' }, PTI, LTV, TODAY);
  assert.equal(r.checks.find((c) => c.key === 'INCOME_PROOF').status, 'ATTENTION');
  assert.notEqual(r.tier, 'CONDITIONS');
});

test('no limit is ever invented when the rules are missing', () => {
  const r = assessReadiness(base, [], [], TODAY);
  assert.equal(r.ptiLimit, null);
  assert.equal(r.ltvLimit, null);
  assert.equal(r.maxLoan, null);
  assert.equal(r.tier, 'INCOMPLETE');
});

test('the result object carries no approval probability of any kind', () => {
  const r = assessReadiness(base, PTI, LTV, TODAY);
  const json = JSON.stringify(r).toLowerCase();
  assert.doesNotMatch(json, /probab|approv|chance|likelihood|score/);
});

test('scenarios change one thing each and include the co-borrower comparison', () => {
  const input = { ...base, netMonthlyIncome: 3000, existingMonthlyDebt: 300, coBorrower: { netMonthlyIncome: 2000, monthlyDebt: 0 }, additionalCollateralValue: 50000 };
  const s = readinessScenarios(input, PTI, LTV, TODAY);
  const keys = s.map((x) => x.key);
  for (const k of ['AS_ENTERED', 'MORE_DOWN', 'LESS_DEBT', 'LONGER_TERM', 'LOWER_PRICE', 'NO_CO_BORROWER', 'NO_COLLATERAL']) assert.ok(keys.includes(k), k);
  const asIs = s.find((x) => x.key === 'AS_ENTERED').result;
  const more = s.find((x) => x.key === 'MORE_DOWN').result;
  assert.ok(more.monthlyPayment < asIs.monthlyPayment);
  assert.ok(s.find((x) => x.key === 'NO_CO_BORROWER').result.totalIncome < asIs.totalIncome);
  // Collateral is compared against the same scenario without it: only the LTV-with-collateral figure differs.
  const noCol = s.find((x) => x.key === 'NO_COLLATERAL').result;
  assert.equal(noCol.ltvWithCollateralPercent, null);
  assert.ok(asIs.ltvWithCollateralPercent < asIs.ltvPercent);
  assert.equal(noCol.monthlyPayment, asIs.monthlyPayment);
  assert.ok(!keys.includes('WITH_CO_BORROWER'), 'a co-borrower is already there');
});

test('a short income without a co-borrower offers one earning exactly the shortfall', () => {
  const input = { ...base, netMonthlyIncome: 1000, existingMonthlyDebt: 0, coBorrower: null, additionalCollateralValue: null };
  const s = readinessScenarios(input, PTI, LTV, TODAY);
  const asIs = s.find((x) => x.key === 'AS_ENTERED').result;
  const gap = asIs.gaps.find((g) => g.key === 'INCOME');
  assert.ok(gap && gap.amount > 0, 'the base case is short on income');
  const withCo = s.find((x) => x.key === 'WITH_CO_BORROWER');
  assert.ok(withCo, 'the co-borrower variant is offered');
  assert.equal(withCo.vars.amount, Math.ceil(gap.amount));
  assert.notEqual(withCo.result.checks.find((c) => c.key === 'PTI').status, 'NOT_MET');
});

test('optional answers add a line only when given and never invent a limit', () => {
  const plain = assessReadiness(base, PTI, LTV, TODAY);
  for (const k of ['RESIDENCY', 'GUARANTOR', 'COSTS']) assert.ok(!plain.checks.some((c) => c.key === k), k);
  const r = assessReadiness({ ...base, residency: 'NON_RESIDENT', guarantor: true, costsKnown: false }, PTI, LTV, TODAY);
  assert.equal(r.checks.find((c) => c.key === 'RESIDENCY').status, 'ATTENTION');
  assert.equal(r.checks.find((c) => c.key === 'GUARANTOR').status, 'OK');
  assert.equal(r.checks.find((c) => c.key === 'COSTS').status, 'ATTENTION');
  assert.equal(r.ptiLimit, plain.ptiLimit, 'a guarantor never changes the published limit');
  assert.equal(r.maxLoan, plain.maxLoan);
});

test('foreign income is its own income source with its own document list', () => {
  assert.ok(INCOME_SOURCES.includes('FOREIGN_INCOME'));
  const r = assessReadiness({ ...base, source: 'FOREIGN_INCOME' }, PTI, LTV, TODAY);
  assert.equal(r.checks.find((c) => c.key === 'INCOME_PROOF').status, 'ATTENTION');
});

test('loanForPayment inverts the engine formula', () => {
  const loan = loanForPayment(1000, 10, 240);
  assert.ok(Math.abs(computeMonthlyPayment(loan, 10, 240) - 1000) <= 0.02);
});
