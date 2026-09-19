// WOULD A NORMAL PERSON UNDERSTAND THIS PAGE?
//
// That question cannot be asserted. What CAN be asserted is every
// specific way the page failed it on 19 September 2026, each of which a
// later change could quietly reintroduce while every other gate stayed
// green. Physically observed on the live Georgian page that day:
//
//   ამ პირობებით თვეში დაახლოებით {{monthly}} გადაიხდი 8 წლის განმავლობაში.
//   ...მაღალია.(მანძილი გამოცხადებულ და ეფექტურ განაკვეთს შორის)
//   ...ფარავს.(სესხი ღირებულებასთან გამოქვეყნებულ ზღვართან)
//   PTI · LTV
//   Subsidized Mortgage Loan — families with children (Decree No. 388…)
//
// and, after six questions about a family's children, the single
// sentence "does not match the published conditions" with no reason
// under it.
//
// These tests are behaviour and invariants, not marketing sentences.
// The one place an exact string is asserted is the child-age condition,
// because that one is legally load-bearing: a family whose child is
// four years old does not qualify, and the question that omits the age
// tells them they do.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHECKLIST, SIGNING_TOPICS } from '../guidance.ts';
import { checklistStates, knownCount } from '../checklistState.ts';
import { matchSubsidyProgram, criterionRole } from '../rules/subsidy.ts';
import { runFullMortgageCalculation } from '../calculations/index.ts';
import { buildRateBreakdown } from '../calculations/rateBreakdown.ts';
import { buildFinancingPicture } from '../calculations/financingPicture.ts';
import { MORTGAGE_HUMAN_STRINGS } from '../../../scripts/mortgage-human-data.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const LANGS = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];

/* ── The owner's scenario, which is also the acceptance fixture ────── */

const OWNER_SCENARIO = {
  propertyPrice: 120_000,
  propertyCurrency: 'USD',
  downPayment: 15_000,
  termMonths: 96,
  nominalAnnualRatePercent: 13,
};

/* ── 1. The {{monthly}} class of bug ───────────────────────────────── */

const HOLE = /\{\{\s*(\w+)\s*\}\}/g;
const holesOf = (value) => [...String(value).matchAll(HOLE)].map((m) => m[1]).sort().join(',');

test('every curated Mortgage string names the same placeholders as its English', () => {
  const offenders = [];
  for (const [key, values] of Object.entries(MORTGAGE_HUMAN_STRINGS)) {
    const expected = holesOf(values[0]);
    values.forEach((value, i) => {
      if (holesOf(value) !== expected) offenders.push(`${LANGS[i]}.${key}: [${holesOf(value)}] vs [${expected}]`);
    });
  }
  assert.deepEqual(offenders, [], `a placeholder nobody fills renders as braces:\n${offenders.join('\n')}`);
});

test('no curated Mortgage string uses a single-brace placeholder', () => {
  // t() substitutes {{name}} only. {name} ships its braces.
  const SINGLE = /(?<!\{)\{\s*\w+\s*\}(?!\})/;
  const offenders = [];
  for (const [key, values] of Object.entries(MORTGAGE_HUMAN_STRINGS)) {
    values.forEach((value, i) => { if (SINGLE.test(value)) offenders.push(`${LANGS[i]}.${key}`); });
  }
  assert.deepEqual(offenders, []);
});

test('the rendering contract that stops an override printing braces is wired into t()', () => {
  const context = read('src/contexts/LanguageContext.tsx');
  assert.ok(context.includes("from '@/i18n/interpolate'"), 'LanguageContext must use the shared contract');
  assert.ok(context.includes('resolveCopy('), 'both t() implementations resolve through resolveCopy');
  // Two call sites: the live provider and the Studio preview. A preview
  // that rendered braces the live page will not is a lie about the edit.
  assert.ok(context.split('resolveCopy(').length - 1 >= 2);
  assert.ok(!/return interpolate\(written, vars\)/.test(context), 'an override must not be returned unchecked');
});

/* ── 2. No internal labels in customer copy ────────────────────────── */

test('the financing picture no longer prints its criterion in brackets', () => {
  const view = read('src/components/mortgage/FinancingPictureView.tsx');
  assert.ok(
    !/\(\{t\(note\.criterionKey\)\}\)/.test(view),
    'the criterion is an internal label and reached seven customer sentences',
  );
  assert.ok(!/t\(note\.criterionKey\)/.test(view), 'criterionKey must not be rendered at all');
});

test('the criterion is still recorded on every finding, just not printed', () => {
  // Removing it from the screen must not remove the traceability that
  // justified putting it there.
  const input = { ...OWNER_SCENARIO };
  const picture = buildFinancingPicture({
    input,
    result: runFullMortgageCalculation(input),
    breakdown: buildRateBreakdown(input),
    affordability: null,
    ptiRule: null,
    ltvRule: null,
    earlyRepaymentFeeKnown: false,
  });
  const notes = [...picture.known, ...picture.attention, ...picture.missing];
  assert.ok(notes.length > 0);
  for (const note of notes) assert.match(note.criterionKey, /^mortgage_picture_crit_/);
});

test('PTI and LTV lead with what they measure, and keep the acronym as a second line', () => {
  const view = read('src/components/mortgage/FinancingPictureView.tsx');
  assert.ok(view.includes("subKey: 'mortgage_pic_pti_sub'"));
  assert.ok(view.includes("subKey: 'mortgage_pic_ltv_sub'"));

  for (const key of ['mortgage_pic_pti', 'mortgage_pic_ltv']) {
    const values = MORTGAGE_HUMAN_STRINGS[key];
    assert.ok(values, `${key} must be curated`);
    values.forEach((value, i) => {
      assert.ok(
        !/^(PTI|LTV)$/.test(value.trim()),
        `${LANGS[i]}.${key} is a bare acronym: ${value}`,
      );
    });
  }
  // The acronym survives where it belongs.
  assert.ok(MORTGAGE_HUMAN_STRINGS.mortgage_pic_pti_sub.every((v) => v.includes('PTI')));
  assert.ok(MORTGAGE_HUMAN_STRINGS.mortgage_pic_ltv_sub.every((v) => v.includes('LTV')));
});

/* ── 3. The punctuation sweep ──────────────────────────────────────── */

/** Keys whose value is a heading, a label or a chip, never a sentence. */
const HEADING = [
  /_(title|eyebrow|label)$/,
  /^mortgage_check_group_/,
  /^mortgage_state_(known|open)$/,
  /^mortgage_subsidy_(verdict|fact)_[a-z_]+$/,
  /^mortgage_pic_(known|attention|missing|pti|ltv|effective|total_cost)$/,
  /^mortgage_(product_eyebrow|start_over|ask_homatch|details_(nominal|effective|terms|schedule|checklist|see_breakdown))$/,
  /^mortgage_(result_(eyebrow|monthly_label|loan_amount|total_interest|total_repayment)|section_(costs|income))$/,
  /^mortgage_check_[a-z_]+$/,
];
const isHeading = (key) =>
  HEADING.some((re) => re.test(key)) && !/_(why|ask|sub|desc|note|explain|open)$/.test(key);

test('no heading ends with a full stop', () => {
  const offenders = [];
  for (const [key, values] of Object.entries(MORTGAGE_HUMAN_STRINGS)) {
    if (!isHeading(key)) continue;
    values.forEach((value, i) => {
      if (/[.。]$/.test(value.trim())) offenders.push(`${LANGS[i]}.${key}: ${value}`);
    });
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
});

test('no Georgian or English Mortgage sentence carries a semicolon or an em dash', () => {
  /*
   * WHY THIS IS SCOPED TO TWO LANGUAGES AND NOT SIX.
   *
   * In Georgian and English both marks are the punctuation of written
   * argument rather than of somebody explaining a mortgage out loud,
   * and every one of them on the live Georgian page was a sentence
   * that should have been two.
   *
   * In Russian the em dash is ordinary grammar: it stands in for the
   * missing copula, and "Кредит в GEL в той же валюте" without it is
   * not plainer Russian, it is wrong Russian. Turkish uses a semicolon
   * where English would use a colon. Deleting either would be this
   * test telling a language it is written incorrectly, which the brief
   * explicitly forbids: rewrite the sentence, never swap the character.
   */
  const GUARDED = ['en', 'ka'];
  const offenders = [];
  for (const [key, values] of Object.entries(MORTGAGE_HUMAN_STRINGS)) {
    values.forEach((value, i) => {
      if (!GUARDED.includes(LANGS[i])) return;
      if (/[;؛]/.test(value)) offenders.push(`${LANGS[i]}.${key}: semicolon`);
      if (/[—–]/.test(value)) offenders.push(`${LANGS[i]}.${key}: dash in ${value}`);
    });
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
});

test('no curated Mortgage sentence carries a parenthesis holding an explanation', () => {
  // "(მანძილი გამოცხადებულ და ეფექტურ განაკვეთს შორის)" is the shape
  // this forbids: an internal reason label dumped after a finding.
  // Short parentheses (a unit, an acronym) are not what went wrong.
  const offenders = [];
  for (const [key, values] of Object.entries(MORTGAGE_HUMAN_STRINGS)) {
    values.forEach((value, i) => {
      const long = value.match(/\([^)]{16,}\)/g);
      if (long) offenders.push(`${LANGS[i]}.${key}: ${long.join(' ')}`);
    });
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
});

test('the Georgian is written in one voice, not two', () => {
  // The live page mixed შეავსე with შეავსეთ inside one screen. The
  // polite plural survives in exactly one place by decision: the
  // subsidy questions, which address a household.
  const POLITE = /\b\w*(ეთ|თქვენი|თქვენ)\b/;
  const allowed = (key) => key.startsWith('mortgage_kb_subsidy_')
    || key === 'mortgage_subsidy_context_note';
  const offenders = [];
  for (const [key, values] of Object.entries(MORTGAGE_HUMAN_STRINGS)) {
    if (allowed(key)) continue;
    if (POLITE.test(values[1])) offenders.push(`ka.${key}: ${values[1]}`);
  }
  assert.deepEqual(offenders, [], `polite plural outside the subsidy questions:\n${offenders.join('\n')}`);
});

/* ── 4. The government programme ───────────────────────────────────── */

const DECREE_388 = {
  id: 'subsidy-ge',
  type: 'SUBSIDY_PROGRAM',
  data: {
    programName: 'Subsidized Mortgage Loan',
    titleKey: 'mortgage_kb_subsidy_title',
    administrator: 'Government of Georgia',
    maxLoanAmount: 200_000,
    currency: 'GEL',
    durationMonths: 60,
    citizenshipRequired: true,
    subsidyDescription: 'mortgage_kb_subsidy_description_rate_reduction',
    subsidyRateFormula: {
      oneToTwoChildren: 'NBG_refinancing_rate_minus_3.5pp_capped_at_6pct',
      threeOrMoreChildren: 'NBG_refinancing_rate_minus_1.5pp_capped_at_8pct',
    },
    eligibilityCriteria: [
      {
        key: 'georgian_citizenship', role: 'MANDATORY', mandatory: true,
        description: 'mortgage_kb_subsidy_eligibility_citizenship',
        metKey: 'mortgage_kb_subsidy_met_citizenship',
        failureKey: 'mortgage_kb_subsidy_failed_citizenship',
        question: { id: 'citizenship', type: 'YES_NO', promptKey: 'mortgage_kb_subsidy_q_citizenship', satisfiedWhenYes: true },
      },
      {
        key: 'no_prior_2020_mechanism', role: 'MANDATORY', mandatory: true,
        description: 'mortgage_kb_subsidy_eligibility_no_prior_scheme',
        metKey: 'mortgage_kb_subsidy_met_no_prior_scheme',
        failureKey: 'mortgage_kb_subsidy_failed_no_prior_scheme',
        question: { id: 'prior_scheme', type: 'YES_NO', promptKey: 'mortgage_kb_subsidy_q_prior_scheme', satisfiedWhenYes: false },
      },
      {
        key: 'children_born_after_2021_09_01', role: 'ROUTE',
        description: 'mortgage_kb_subsidy_eligibility_child_born_after',
        metKey: 'mortgage_kb_subsidy_met_child_under_one',
        question: { id: 'child_after_2021', type: 'YES_NO', promptKey: 'mortgage_kb_subsidy_q_child_after_2021', satisfiedWhenYes: true },
      },
      {
        key: 'adopted_child_after_2021_09_01', role: 'ROUTE',
        description: 'mortgage_kb_subsidy_eligibility_adopted_child',
        metKey: 'mortgage_kb_subsidy_met_adopted_child',
        question: { id: 'adopted_after_2021', type: 'YES_NO', promptKey: 'mortgage_kb_subsidy_q_adopted_after_2021', satisfiedWhenYes: true },
      },
      {
        key: 'three_plus_children_by_2022_09_01', role: 'CONTEXT', routeClosedOn: '2022-09-01',
        description: 'mortgage_kb_subsidy_eligibility_three_plus_children',
        question: { id: 'three_plus_children', type: 'NUMBER', promptKey: 'mortgage_kb_subsidy_q_children_count', satisfiedWhenAtLeast: 3 },
      },
      {
        key: 'single_parent_or_widow', role: 'CONTEXT',
        description: 'mortgage_kb_subsidy_eligibility_single_parent_widow',
        question: { id: 'single_parent', type: 'YES_NO', promptKey: 'mortgage_kb_subsidy_q_single_parent', satisfiedWhenYes: true },
      },
    ],
  },
};

const GEL_LOAN = { amount: 120_000, currency: 'GEL' };
const QUALIFIES = { citizenship: true, prior_scheme: false, child_after_2021: true };

test('the child condition states the age, in every language', () => {
  // Decree 388, Article 2 §5(a): a child UNDER ONE YEAR OLD at the time
  // the loan is taken, born after 1 September 2021. The question used
  // to ask only about the birth date, and a family with a four-year-old
  // born in 2022 answered yes.
  const question = MORTGAGE_HUMAN_STRINGS.mortgage_kb_subsidy_q_child_after_2021;
  const detail = MORTGAGE_HUMAN_STRINGS.mortgage_kb_subsidy_eligibility_child_born_after;

  assert.ok(question[1].includes('1 წლამდე'), `ka question omits the age: ${question[1]}`);
  assert.ok(/under one year old/i.test(question[0]), question[0]);
  // And the birth-date half is still stated, in the detail line.
  assert.ok(detail[1].includes('2021'), detail[1]);
  assert.ok(detail[1].includes('1 წლამდე'), detail[1]);
});

test('the programme has a title key, so a Georgian page stops printing English', () => {
  assert.ok(MORTGAGE_HUMAN_STRINGS.mortgage_kb_subsidy_title, 'the key must exist to be overridable');
  const view = read('src/components/mortgage/views/ProgramsView.tsx');
  assert.ok(view.includes('data.titleKey ? t(data.titleKey) : rule.title'));

  const migration = read('supabase/migrations/20260919172627_mortgage_subsidy_criterion_roles.sql');
  assert.ok(migration.includes("'titleKey', 'mortgage_kb_subsidy_title'"));
});

test('being a single parent is not, on its own, a way into the programme', () => {
  // Decree 388 lists single parents and widows INSIDE each child
  // condition, not beside them.
  const match = matchSubsidyProgram(
    DECREE_388,
    { citizenship: true, prior_scheme: false, child_after_2021: false, adopted_after_2021: false, single_parent: true },
    GEL_LOAN,
  );
  assert.equal(match.verdict, 'NOT_A_MATCH');
  assert.ok(match.reasons.some((r) => r.key === 'mortgage_subsidy_reason_no_route'));
});

test('three children is no longer a live route, because that window closed in 2022', () => {
  const match = matchSubsidyProgram(
    DECREE_388,
    { citizenship: true, prior_scheme: false, child_after_2021: false, adopted_after_2021: false, three_plus_children: 4 },
    GEL_LOAN,
  );
  assert.equal(match.verdict, 'NOT_A_MATCH');
  // It still selects the subsidy formula, so it is asked and recorded.
  const outcome = match.outcomes.find((o) => o.criterion.key === 'three_plus_children_by_2022_09_01');
  assert.equal(criterionRole(outcome.criterion), 'CONTEXT');
  assert.equal(outcome.satisfied, true);
});

test('a context answer never counts towards the reasons it matches', () => {
  const match = matchSubsidyProgram(
    DECREE_388,
    { ...QUALIFIES, single_parent: true, three_plus_children: 4 },
    GEL_LOAN,
  );
  assert.equal(match.verdict, 'LIKELY_MATCH');
  assert.ok(!match.met.some((r) => r.key === 'mortgage_kb_subsidy_eligibility_single_parent_widow'));
  assert.ok(!match.met.some((r) => r.key === 'mortgage_kb_subsidy_eligibility_three_plus_children'));
});

test('LIKELY_MATCH gives the reasons it matched', () => {
  const match = matchSubsidyProgram(DECREE_388, QUALIFIES, GEL_LOAN);
  assert.equal(match.verdict, 'LIKELY_MATCH');
  const keys = match.met.map((r) => r.key);
  assert.ok(keys.includes('mortgage_subsidy_met_currency'));
  assert.ok(keys.includes('mortgage_subsidy_met_within_max'));
  assert.ok(keys.includes('mortgage_kb_subsidy_met_citizenship'));
  assert.ok(keys.includes('mortgage_kb_subsidy_met_child_under_one'));
  assert.ok(match.met.length >= 4, 'the brief asks for two to four reasons, and there are four');
});

test('a currency mismatch says which currency, and what to do about it', () => {
  const match = matchSubsidyProgram(DECREE_388, QUALIFIES, { amount: 105_000, currency: 'USD' });
  assert.equal(match.verdict, 'NOT_A_MATCH');
  assert.ok(match.currencyMismatch);

  const reason = match.reasons.find((r) => r.key === 'mortgage_subsidy_reason_currency');
  assert.ok(reason, 'the exact reason must be named, not "does not match"');
  assert.equal(reason.vars.program, 'GEL');
  assert.equal(reason.vars.chosen, 'USD');

  assert.equal(match.nextStep.key, 'mortgage_subsidy_next_currency');
  assert.equal(match.nextStep.vars.program, 'GEL');
});

test('changing the currency clears the mismatch, with no resubmission', () => {
  // Same answers, different loan. The verdict is a pure function of the
  // two, which is what makes the live result reactive.
  const before = matchSubsidyProgram(DECREE_388, QUALIFIES, { amount: 105_000, currency: 'USD' });
  const after = matchSubsidyProgram(DECREE_388, QUALIFIES, { amount: 105_000, currency: 'GEL' });

  assert.equal(before.verdict, 'NOT_A_MATCH');
  assert.equal(after.verdict, 'LIKELY_MATCH');
  assert.ok(!after.reasons.some((r) => r.key === 'mortgage_subsidy_reason_currency'));
  assert.ok(!after.currencyMismatch);
});

test('a loan over the ceiling names both figures and the way back under it', () => {
  const match = matchSubsidyProgram(DECREE_388, QUALIFIES, { amount: 260_000, currency: 'GEL' });
  assert.equal(match.verdict, 'NOT_A_MATCH');
  const reason = match.reasons.find((r) => r.key === 'mortgage_subsidy_reason_over_max');
  assert.equal(reason.vars.max, 200_000);
  assert.equal(reason.vars.loan, 260_000);
  assert.equal(match.nextStep.key, 'mortgage_subsidy_next_over_max');
});

test('NOT ENOUGH INFORMATION names exactly which questions are open', () => {
  const match = matchSubsidyProgram(DECREE_388, { citizenship: true }, GEL_LOAN);
  assert.equal(match.verdict, 'CANNOT_DETERMINE');
  assert.deepEqual(
    match.outstanding.sort(),
    ['adopted_child_after_2021_09_01', 'children_born_after_2021_09_01', 'no_prior_2020_mechanism'],
  );
  const unanswered = match.reasons.find((r) => r.key === 'mortgage_subsidy_reason_unanswered');
  assert.equal(unanswered.vars.n, 3);
});

test('once one route is satisfied the others stop being outstanding', () => {
  const match = matchSubsidyProgram(DECREE_388, QUALIFIES, GEL_LOAN);
  assert.equal(match.verdict, 'LIKELY_MATCH');
  assert.deepEqual(match.outstanding, []);
});

test('a failed mandatory condition says which one, in words', () => {
  const match = matchSubsidyProgram(
    DECREE_388,
    { citizenship: false, prior_scheme: false, child_after_2021: true },
    GEL_LOAN,
  );
  assert.equal(match.verdict, 'NOT_A_MATCH');
  assert.ok(match.reasons.some((r) => r.key === 'mortgage_kb_subsidy_failed_citizenship'));
});

test('nothing in the programme can say a person is eligible', () => {
  const verdicts = new Set();
  for (const answers of [{}, QUALIFIES, { citizenship: false }, { ...QUALIFIES, three_plus_children: 3 }]) {
    verdicts.add(matchSubsidyProgram(DECREE_388, answers, GEL_LOAN).verdict);
  }
  assert.ok(!verdicts.has('ELIGIBLE'));
  assert.ok(!verdicts.has('APPROVED'));
  assert.ok(verdicts.has('LIKELY_MATCH'));
});

/* ── 5. The checklist ──────────────────────────────────────────────── */

function states(overrides = {}) {
  const input = { ...OWNER_SCENARIO, ...overrides };
  const result = runFullMortgageCalculation(input);
  return checklistStates({ input, result, breakdown: buildRateBreakdown(input) });
}

test('every checklist item has a state, and every state has a sentence', () => {
  const all = states();
  assert.equal(all.length, CHECKLIST.length);
  for (const state of all) {
    assert.match(state.stateKey, /^mortgage_state_/);
    assert.ok(['KNOWN', 'OPEN'].includes(state.status));
    if (state.status === 'OPEN') assert.match(state.findKey, /^mortgage_find_/);
  }
});

test('the state carries this scenario, not a generic sentence', () => {
  const byId = new Map(states().map((s) => [s.id, s]));

  const effective = byId.get('effective_rate');
  assert.equal(effective.status, 'KNOWN');
  assert.equal(effective.vars.nominal, 13);
  assert.ok(effective.vars.effective > 13, 'the real cost is above the quoted rate');

  const monthly = byId.get('monthly_payment');
  assert.equal(monthly.status, 'KNOWN');
  assert.ok(monthly.vars.amount > 1_700 && monthly.vars.amount < 1_800, monthly.vars.amount);

  const currency = byId.get('currency_risk');
  assert.equal(currency.stateKey, 'mortgage_state_currency_foreign');
  assert.equal(currency.vars.currency, 'USD');
});

test('every amount in a checklist state is declared as money, with its currency', () => {
  // The engine has no locale, so it hands back 1765 and says that the
  // variable is money in USD. A state that forgot to say so would put
  // a bare integer in a sentence about somebody's salary.
  const MONEY_VAR = /^(amount|total|interest)$/;
  for (const state of states()) {
    for (const name of Object.keys(state.vars ?? {})) {
      if (!MONEY_VAR.test(name)) continue;
      assert.ok(
        (state.moneyVars ?? []).includes(name),
        `${state.id}.${name} is an amount that nothing will format`,
      );
      assert.equal(state.currency, 'USD', `${state.id} did not say which currency`);
    }
  }
});

test('the checklist view formats those amounts rather than printing them raw', () => {
  const view = read('src/components/mortgage/views/GuidanceViews.tsx');
  assert.ok(view.includes('state.moneyVars'));
  assert.ok(view.includes('formatMoney('));
});

test('nothing unknown is filled with a plausible default', () => {
  const byId = new Map(states().map((s) => [s.id, s]));
  for (const id of ['initial_fees', 'recurring_fees', 'insurance', 'valuation', 'rate_type']) {
    assert.equal(byId.get(id).status, 'OPEN', `${id} was answered from nothing`);
  }
  // And entering the figure moves it, which is the whole contract.
  const withFee = new Map(states({ valuationFeeFlat: 300 }).map((s) => [s.id, s]));
  assert.equal(withFee.get('valuation').status, 'KNOWN');
  assert.equal(withFee.get('valuation').vars.amount, 300);
});

test('the three a contract decides are always open, whatever is entered', () => {
  const byId = new Map(
    states({ valuationFeeFlat: 300, monthlyFeeFlat: 10, rateType: 'FIXED', gracePeriodMonths: 6 })
      .map((s) => [s.id, s]),
  );
  for (const id of ['early_repayment', 'refinancing', 'penalties']) {
    assert.equal(byId.get(id).status, 'OPEN', id);
  }
});

test('KNOWN is a statement about this page, never about the bank', () => {
  // The old UI drew a green tick. A tick beside "Mandatory insurance"
  // reads as approval of the insurance, and nothing here can give one.
  const view = read('src/components/mortgage/views/GuidanceViews.tsx');
  assert.ok(view.includes("t(isKnown ? 'mortgage_state_known' : 'mortgage_state_open')"));
  assert.ok(!/<Check\b/.test(view), 'a tick is back in the checklist');
  assert.ok(!view.includes('hsl(var(--success))'), 'green beside a bank term reads as approval');
});

test('with no scenario at all, nothing is known and the page says so', () => {
  const empty = checklistStates({ input: null, result: null, breakdown: null });
  assert.equal(empty.length, CHECKLIST.length);
  assert.equal(knownCount(empty), 0);
  assert.ok(empty.every((s) => s.status === 'OPEN'));
});

/* ── 6. Checklist, picture and programme all reach ONE consultant ──── */

test('there is exactly one chat on the Mortgage page', () => {
  const files = [
    'src/pages/MortgagePage.tsx',
    'src/components/mortgage/ConsultantPanel.tsx',
    'src/components/mortgage/views/GuidanceViews.tsx',
    'src/components/mortgage/views/ProgramsView.tsx',
    'src/components/mortgage/FinancingPictureView.tsx',
    'src/components/mortgage/askConsultant.tsx',
  ];
  const uses = files.filter((f) => /useAIChat\(/.test(read(f)));
  assert.deepEqual(uses, ['src/components/mortgage/ConsultantPanel.tsx'],
    `a second conversation would bill separately and answer without the earlier turns: ${uses}`);
});

test('the page provides the ask channel and the consultant registers on it', () => {
  assert.ok(read('src/pages/MortgagePage.tsx').includes('<MortgageAskProvider>'));
  const panel = read('src/components/mortgage/ConsultantPanel.tsx');
  assert.ok(panel.includes('useMortgageAsk'), 'the consultant must register itself');
  assert.ok(panel.includes('register('), 'and expose a handler for the rest of the page');
  assert.ok(panel.includes("getElementById('consultant')"), 'pressing Ask should bring the chat into view');
  assert.ok(panel.includes('composerRef.current?.focus'), 'and put the cursor in the composer');
});

test('Ask Homatch pre-fills rather than spending a credit on a press', () => {
  const panel = read('src/components/mortgage/ConsultantPanel.tsx');
  const handler = panel.slice(panel.indexOf('useEffect(() => register('), panel.indexOf('/* Only offered once'));
  assert.ok(handler.includes('setValue(question)'), 'the question lands in the composer');
  assert.ok(!handler.includes('sendMessage'), 'and is not sent without the person pressing send');
});

test('every checklist item offers a question, and it is a question', () => {
  for (const item of CHECKLIST) {
    const values = MORTGAGE_HUMAN_STRINGS[item.askKey];
    assert.ok(values, `${item.id} has no curated question`);
    for (let i = 0; i < LANGS.length; i += 1) {
      assert.ok(/[?؟]$/.test(values[i].trim()), `${LANGS[i]}.${item.askKey} is not a question: ${values[i]}`);
      assert.ok(!/^["“„«]/.test(values[i].trim()), `${LANGS[i]}.${item.askKey} still carries its quote marks`);
    }
  }
});

test('the checklist, the picture and the programme all render the same button', () => {
  for (const file of [
    'src/components/mortgage/views/GuidanceViews.tsx',
    'src/components/mortgage/views/ProgramsView.tsx',
    'src/components/mortgage/FinancingPictureView.tsx',
  ]) {
    assert.ok(read(file).includes('<AskHomatch'), `${file} has no way into the conversation`);
  }
});

/* ── 7. Contract topics, expanded ──────────────────────────────────── */

test('every signing topic still has all four parts, and all four are curated', () => {
  assert.ok(SIGNING_TOPICS.length >= 6);
  for (const topic of SIGNING_TOPICS) {
    for (const field of ['titleKey', 'summaryKey', 'whatKey', 'whyKey', 'askKey', 'checkKey']) {
      const key = topic[field];
      assert.ok(key && key.startsWith('mortgage_'), `${topic.id}.${field}`);
      assert.ok(
        MORTGAGE_HUMAN_STRINGS[key],
        `${topic.id}.${field} (${key}) was not rewritten — the expanded copy was the half nobody read`,
      );
    }
  }
});

/* ── 8. Each tool says what it answers ─────────────────────────────── */

test('every tool opens with one sentence naming the question it answers', () => {
  const shelf = read('src/components/mortgage/ToolShelf.tsx');
  for (const id of ['AFFORDABILITY', 'COMPARE_OFFERS', 'EARLY_REPAYMENT', 'REFINANCING', 'GOVERNMENT_PROGRAMS']) {
    const match = new RegExp(`${id}: '(mortgage_tool_intro_[a-z_]+)'`).exec(shelf);
    assert.ok(match, `${id} opens into a bare form`);
    assert.ok(MORTGAGE_HUMAN_STRINGS[match[1]], `${match[1]} is not curated`);
  }
});

/* ── 9. The maths is untouched ─────────────────────────────────────── */

test('the owner’s scenario still produces the figures it produced before', () => {
  // 120,000 USD, 15,000 down, 8 years, 13%. The assertions are the
  // engine's own output rather than the prose approximations, and they
  // exist so a copy change can never quietly move a number.
  const result = runFullMortgageCalculation(OWNER_SCENARIO);
  assert.equal(result.loanAmount, 105_000);
  assert.equal(Math.round(result.monthlyPayment), 1_765);
  assert.equal(Math.round(result.totalInterest), 64_417);
  assert.equal(Math.round(result.totalRepayment), 169_417);
  assert.equal(result.amortizationSchedule.length, 96);
});

test('nothing in the copy layer recalculates anything', () => {
  const copy = read('src/mortgage/checklistState.ts');
  assert.ok(!/Math\.pow|\*\*\s*\(/.test(copy), 'the checklist must read the engines, never redo them');
  assert.ok(copy.includes("from './guidance.ts'"));
});
