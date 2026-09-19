// The Home Financing workspace's own rules: which question can answer
// when, what the picture is allowed to say, and whether a subsidy
// verdict can ever overstate itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOPICS,
  TOPIC_IDS,
  TOPIC_ORDER,
  isTopicId,
  isTopicReady,
  missingRequirements,
} from '../topics.ts';
import { CHECKLIST, SIGNING_TOPICS, answeredChecklistItems } from '../guidance.ts';
import { mortgageDerivedPercent, mortgagePresetsFor } from '../presets.ts';
import {
  computeSubsidyBenefit,
  matchSubsidyProgram,
  parseSubsidyFormula,
} from '../rules/subsidy.ts';
import { buildFinancingPicture } from '../calculations/financingPicture.ts';
import { buildRateBreakdown } from '../calculations/rateBreakdown.ts';
import { runFullMortgageCalculation } from '../calculations/index.ts';

const LOAN = {
  propertyPrice: 150_000,
  propertyCurrency: 'GEL',
  downPayment: 30_000,
  termMonths: 240,
  nominalAnnualRatePercent: 12.5,
};

const EMPTY_STATE = { loan: null, monthlyNetIncome: null, offerCount: 0, hasOwnLoan: false };

/* ── Topics ─────────────────────────────────────────────────────── */

test('every topic in the order is a real topic, and none is missing', () => {
  assert.equal(TOPIC_ORDER.length, TOPIC_IDS.length);
  assert.deepEqual(new Set(TOPIC_ORDER), new Set(TOPIC_IDS));
  for (const id of TOPIC_IDS) assert.ok(isTopicId(id));
  assert.ok(!isTopicId('MONTHLY_PAYMENTS'));
});

test('the two topics that need no numbers are answerable from an empty workspace', () => {
  const alwaysReady = TOPIC_IDS.filter((id) => isTopicReady(TOPICS[id], EMPTY_STATE));
  assert.deepEqual(new Set(alwaysReady), new Set(['GOVERNMENT_PROGRAMS', 'BEFORE_YOU_SIGN']));
});

test('a topic that cannot answer says what it is waiting for, by name', () => {
  for (const id of TOPIC_IDS) {
    const missing = missingRequirements(TOPICS[id], EMPTY_STATE);
    if (isTopicReady(TOPICS[id], EMPTY_STATE)) {
      assert.deepEqual(missing, [], id);
      continue;
    }
    assert.ok(missing.length > 0, `${id} is not ready and named nothing`);
    for (const key of missing) assert.match(key, /^mortgage_needs_/);
  }
});

test('the loan alone unlocks four of the nine', () => {
  const state = { ...EMPTY_STATE, loan: LOAN };
  const ready = TOPIC_IDS.filter((id) => isTopicReady(TOPICS[id], state));
  assert.deepEqual(
    new Set(ready),
    new Set([
      'MONTHLY_PAYMENT',
      'UNDERSTAND_RATE',
      'COMPARE_TERMS',
      'EARLY_REPAYMENT',
      'GOVERNMENT_PROGRAMS',
      'BEFORE_YOU_SIGN',
    ]),
  );
});

test('affordability needs an income and comparison needs two offers', () => {
  const withLoan = { ...EMPTY_STATE, loan: LOAN };
  assert.ok(!isTopicReady(TOPICS.AFFORDABILITY, withLoan));
  assert.ok(isTopicReady(TOPICS.AFFORDABILITY, { ...withLoan, monthlyNetIncome: 2500 }));

  assert.ok(!isTopicReady(TOPICS.COMPARE_OFFERS, { ...withLoan, offerCount: 1 }));
  assert.ok(isTopicReady(TOPICS.COMPARE_OFFERS, { ...withLoan, offerCount: 2 }));
});

/* ── Click-first ────────────────────────────────────────────────── */

test('every numeric field the loan form asks for can be answered by clicking', () => {
  // The exception is documented in presets.ts and tested for below: an
  // interest rate is quoted by a bank, and a chip reading "12%" would
  // be this product putting a number in somebody's head.
  const context = { propertyPrice: 150_000, loanAmount: 120_000, termMonths: 240, monthlyPayment: 1363 };
  for (const field of [
    'propertyPrice',
    'downPayment',
    'termMonths',
    'gracePeriodMonths',
    'originationFeePercent',
    'monthlyFeeFlat',
    'valuationFeeFlat',
    'mandatoryInsuranceAnnualFlat',
    'monthlyNetIncome',
    'existingMonthlyDebtObligations',
    'extraPaymentAmount',
    'extraPaymentMonth',
    'recurringMonthlyExtra',
    'refinancingFeesFlat',
  ]) {
    assert.ok(mortgagePresetsFor(field, context).length > 0, `${field} has nothing to click`);
  }
});

test('the nominal rate deliberately offers nothing', () => {
  assert.deepEqual(mortgagePresetsFor('nominalAnnualRatePercent', { propertyPrice: 150_000 }), []);
});

test('the down payment is offered as percentages of the price', () => {
  const presets = mortgagePresetsFor('downPayment', { propertyPrice: 150_000 });
  assert.deepEqual(presets.map((p) => p.value), [15_000, 30_000, 45_000, 75_000]);
  assert.ok(presets.every((p) => p.kind === 'CALCULATED'));
});

test('a down payment entered as an amount shows its percentage', () => {
  assert.equal(mortgageDerivedPercent({ propertyPrice: 150_000, downPayment: 30_000 }), 20);
  assert.equal(mortgageDerivedPercent({ propertyPrice: 0, downPayment: 30_000 }), null);
});

/* ── The picture ────────────────────────────────────────────────── */

function picture(overrides = {}) {
  const input = { ...LOAN, ...overrides.input };
  const result = runFullMortgageCalculation(input);
  return buildFinancingPicture({
    input,
    result,
    breakdown: buildRateBreakdown(input),
    affordability: overrides.affordability ?? null,
    ptiRule: overrides.ptiRule ?? null,
    ltvRule: overrides.ltvRule ?? null,
    earlyRepaymentFeeKnown: overrides.earlyRepaymentFeeKnown ?? false,
  });
}

test('every finding names the criterion that produced it', () => {
  const p = picture();
  for (const note of [...p.comfortable, ...p.attention, ...p.missing]) {
    assert.match(note.key, /^mortgage_picture_/);
    assert.match(note.criterionKey, /^mortgage_picture_crit_/);
  }
});

test('the picture never grades the loan', () => {
  // No score, no verdict, no single number standing for "how good is
  // this". Three lists of specific observations and nothing else.
  const p = picture();
  assert.deepEqual(
    Object.keys(p).filter((k) => /score|grade|rating|verdict/i.test(k)),
    [],
  );
});

test('an unstated rate type is reported as unknown, not assumed fixed', () => {
  const unknown = picture();
  assert.ok(unknown.missing.some((n) => n.key === 'mortgage_picture_missing_rate_type'));
  assert.ok(!unknown.comfortable.some((n) => n.key === 'mortgage_picture_rate_fixed'));

  const fixed = picture({ input: { rateType: 'FIXED' } });
  assert.ok(fixed.comfortable.some((n) => n.key === 'mortgage_picture_rate_fixed'));

  const variable = picture({ input: { rateType: 'VARIABLE' } });
  assert.ok(variable.attention.some((n) => n.key === 'mortgage_picture_rate_not_fixed'));
});

test('a PTI inside the limit but near it is reported as attention, not comfort', () => {
  const ptiRule = { id: 'r', data: { maxPtiPercent: 50, currencyClass: 'LOCAL', incomeTierMaxMonthlyNet: null } };

  const near = picture({ affordability: { ptiPercent: 47, ltvPercent: 80, ptiWithinPublishedLimit: true, ltvWithinPublishedLimit: true, matchedPtiRuleId: 'r', matchedLtvRuleId: null }, ptiRule });
  assert.ok(near.attention.some((n) => n.key === 'mortgage_picture_pti_near'));

  const clear = picture({ affordability: { ptiPercent: 30, ltvPercent: 80, ptiWithinPublishedLimit: true, ltvWithinPublishedLimit: true, matchedPtiRuleId: 'r', matchedLtvRuleId: null }, ptiRule });
  assert.ok(clear.comfortable.some((n) => n.key === 'mortgage_picture_pti_under'));

  const over = picture({ affordability: { ptiPercent: 60, ltvPercent: 80, ptiWithinPublishedLimit: false, ltvWithinPublishedLimit: true, matchedPtiRuleId: 'r', matchedLtvRuleId: null }, ptiRule });
  assert.ok(over.attention.some((n) => n.key === 'mortgage_picture_pti_over'));
});

test('an unknown early-repayment fee is always listed as missing', () => {
  assert.ok(picture().missing.some((n) => n.key === 'mortgage_picture_missing_early_fee'));
  assert.ok(!picture({ earlyRepaymentFeeKnown: true }).missing.some((n) => n.key === 'mortgage_picture_missing_early_fee'));
});

test('borrowing outside the local currency is always flagged', () => {
  assert.ok(picture({ input: { propertyCurrency: 'USD' } }).attention.some((n) => n.key === 'mortgage_picture_fx'));
  assert.ok(!picture().attention.some((n) => n.key === 'mortgage_picture_fx'));
});

/* ── The checklist ──────────────────────────────────────────────── */

test('the checklist has fifteen items and every one carries all three strings', () => {
  assert.equal(CHECKLIST.length, 15);
  const ids = new Set();
  for (const item of CHECKLIST) {
    assert.ok(!ids.has(item.id), `duplicate id ${item.id}`);
    ids.add(item.id);
    assert.match(item.labelKey, /^mortgage_check_/);
    assert.match(item.whyKey, /_why$/);
    assert.match(item.askKey, /_ask$/);
  }
});

test('an item with no field can never tick itself', () => {
  const everything = {
    ...LOAN,
    rateType: 'FIXED',
    originationFeePercent: 1,
    monthlyFeeFlat: 10,
    mandatoryInsuranceAnnualFlat: 240,
    valuationFeeFlat: 150,
    gracePeriodMonths: 0,
    indexOrReferenceName: 'NBG',
    effectiveAnnualRatePercentFromBank: 13.9,
  };
  const answered = answeredChecklistItems(everything);
  for (const item of CHECKLIST) {
    if (item.field) continue;
    assert.ok(!answered.has(item.id), `${item.id} ticked itself with no field behind it`);
  }
  // And the contractual ones are exactly the ones that stay open.
  assert.deepEqual(
    CHECKLIST.filter((i) => !i.field).map((i) => i.id).sort(),
    ['early_repayment', 'monthly_payment', 'penalties', 'refinancing', 'total_interest', 'total_repayment'],
  );
});

test('nothing is answered from an empty workspace', () => {
  assert.equal(answeredChecklistItems(null).size, 0);
});

test('every signing topic has all four parts', () => {
  assert.ok(SIGNING_TOPICS.length >= 5);
  for (const topic of SIGNING_TOPICS) {
    for (const key of ['titleKey', 'summaryKey', 'whatKey', 'whyKey', 'askKey', 'checkKey']) {
      assert.ok(topic[key] && topic[key].startsWith('mortgage_'), `${topic.id}.${key}`);
    }
  }
});

/* ── Subsidy matching ───────────────────────────────────────────── */

const PROGRAM = {
  id: 'subsidy-1',
  type: 'SUBSIDY_PROGRAM',
  data: {
    programName: 'Test',
    administrator: 'Gov',
    maxLoanAmount: 200_000,
    currency: 'GEL',
    durationMonths: 60,
    citizenshipRequired: true,
    subsidyDescription: 'k',
    subsidyRateFormula: {
      oneToTwoChildren: 'NBG_refinancing_rate_minus_3.5pp_capped_at_6pct',
      threeOrMoreChildren: 'NBG_refinancing_rate_minus_1.5pp_capped_at_8pct',
    },
    eligibilityCriteria: [
      { key: 'cit', description: 'd', mandatory: true, question: { id: 'citizenship', type: 'YES_NO', promptKey: 'p', satisfiedWhenYes: true } },
      { key: 'child', description: 'd', question: { id: 'child_after_2021', type: 'YES_NO', promptKey: 'p', satisfiedWhenYes: true } },
      { key: 'three', description: 'd', question: { id: 'three_plus_children', type: 'NUMBER', promptKey: 'p', satisfiedWhenAtLeast: 3 } },
      { key: 'opaque', description: 'd' },
    ],
  },
};

const loan = { amount: 120_000, currency: 'GEL' };

test('nothing answered is never a match and never a rejection', () => {
  const match = matchSubsidyProgram(PROGRAM, {}, loan);
  assert.equal(match.verdict, 'CANNOT_DETERMINE');
});

test('a failed mandatory condition rules the programme out', () => {
  const match = matchSubsidyProgram(PROGRAM, { citizenship: false, child_after_2021: true }, loan);
  assert.equal(match.verdict, 'NOT_A_MATCH');
  assert.ok(match.reasons.includes('mortgage_subsidy_reason_mandatory_failed'));
});

test('any one qualifying route is enough', () => {
  const viaChild = matchSubsidyProgram(PROGRAM, { citizenship: true, child_after_2021: true }, loan);
  assert.equal(viaChild.verdict, 'LIKELY_MATCH');

  const viaCount = matchSubsidyProgram(
    PROGRAM,
    { citizenship: true, child_after_2021: false, three_plus_children: 4 },
    loan,
  );
  assert.equal(viaCount.verdict, 'LIKELY_MATCH');
});

test('every route answered no, and none satisfied, is a rejection', () => {
  const match = matchSubsidyProgram(
    PROGRAM,
    { citizenship: true, child_after_2021: false, three_plus_children: 1 },
    loan,
  );
  assert.equal(match.verdict, 'NOT_A_MATCH');
  assert.ok(match.reasons.includes('mortgage_subsidy_reason_no_route'));
});

test('a condition the rule cannot express is always reported as unchecked', () => {
  const match = matchSubsidyProgram(PROGRAM, { citizenship: true, child_after_2021: true }, loan);
  const opaque = match.outcomes.find((o) => o.criterion.key === 'opaque');
  assert.equal(opaque.checkable, false);
  assert.equal(opaque.satisfied, null);
  assert.ok(match.reasons.includes('mortgage_subsidy_reason_uncheckable'));
});

test('the strongest verdict available is LIKELY_MATCH', () => {
  const verdicts = new Set();
  for (const answers of [{}, { citizenship: true, child_after_2021: true }, { citizenship: false }]) {
    verdicts.add(matchSubsidyProgram(PROGRAM, answers, loan).verdict);
  }
  assert.ok(!verdicts.has('ELIGIBLE'));
  assert.ok(verdicts.has('LIKELY_MATCH'));
});

test('a loan over the ceiling or in the wrong currency is ruled out', () => {
  const tooBig = matchSubsidyProgram(PROGRAM, { citizenship: true, child_after_2021: true }, { amount: 250_000, currency: 'GEL' });
  assert.equal(tooBig.verdict, 'NOT_A_MATCH');
  assert.ok(tooBig.loanExceedsMaximum);

  const wrongCurrency = matchSubsidyProgram(PROGRAM, { citizenship: true, child_after_2021: true }, { amount: 100_000, currency: 'USD' });
  assert.equal(wrongCurrency.verdict, 'NOT_A_MATCH');
  assert.ok(wrongCurrency.currencyMismatch);
});

/* ── What the subsidy is worth ──────────────────────────────────── */

test('the decree formula parses out of the knowledge base', () => {
  assert.deepEqual(parseSubsidyFormula('NBG_refinancing_rate_minus_3.5pp_capped_at_6pct'), {
    subtractPoints: 3.5,
    capPercent: 6,
  });
  assert.equal(parseSubsidyFormula('something else'), null);
  assert.equal(parseSubsidyFormula(undefined), null);
});

test('the benefit is the smaller of the formula and the cap, and says which bound', () => {
  // At the 8.25% policy rate verified on 2026-09-19: 8.25 − 3.5 = 4.75,
  // under the 6% ceiling, so the cap is NOT what sets it.
  const oneToTwo = computeSubsidyBenefit({
    formula: { subtractPoints: 3.5, capPercent: 6 },
    referenceRatePercent: 8.25,
    nominalAnnualRatePercent: 12.5,
    durationMonths: 60,
  });
  assert.equal(oneToTwo.reductionPoints, 4.75);
  assert.equal(oneToTwo.capApplied, false);
  assert.equal(oneToTwo.effectiveBorrowerRatePercent, 7.75);

  // A much higher policy rate would push past the ceiling.
  const capped = computeSubsidyBenefit({
    formula: { subtractPoints: 3.5, capPercent: 6 },
    referenceRatePercent: 12,
    nominalAnnualRatePercent: 12.5,
    durationMonths: 60,
  });
  assert.equal(capped.reductionPoints, 6);
  assert.equal(capped.capApplied, true);
});

test('no reference rate means no figure, rather than a stale one', () => {
  assert.equal(
    computeSubsidyBenefit({
      formula: { subtractPoints: 3.5, capPercent: 6 },
      referenceRatePercent: null,
      nominalAnnualRatePercent: 12.5,
      durationMonths: 60,
    }),
    null,
  );
  assert.equal(
    computeSubsidyBenefit({
      formula: null,
      referenceRatePercent: 8.25,
      nominalAnnualRatePercent: 12.5,
      durationMonths: 60,
    }),
    null,
  );
});
