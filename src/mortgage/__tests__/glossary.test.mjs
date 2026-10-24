// Financial literacy: every term explained, the owner's Georgian kept word for word, every
// worked example reconciling with the payment engine, and nominal never confused with effective.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GLOSSARY_TERMS, SAMPLE_SCENARIO, TERM_FOR_LABEL, termBodyKey, termExample, termExampleKey, termTitleKey } from '../glossary.ts';
import { buildAmortizationSchedule, computeMonthlyPayment } from '../calculations/amortization.ts';
import { annualizeFromSchedule } from '../calculations/effectiveRate.ts';
import { HOMI_MORTGAGE2_STRINGS as S } from '../../../scripts/homi-mortgage2-i18n-data.mjs';

const bundle = fs.readFileSync('src/i18n/translations.ts', 'utf8');
const enBlock = bundle.slice(0, bundle.indexOf('\nconst ka'));

test('the addendum terms are all explained', () => {
  for (const term of ['NOMINAL_RATE', 'EFFECTIVE_RATE', 'FIXED_RATE', 'VARIABLE_RATE', 'REFERENCE_INDEX', 'PRINCIPAL',
    'INTEREST_PAYMENT', 'MONTHLY_INSTALLMENT', 'AMORTIZATION', 'DOWN_PAYMENT', 'PTI', 'LTV', 'COLLATERAL',
    'ADDITIONAL_COLLATERAL', 'CO_BORROWER', 'GUARANTOR', 'CREDIT_HISTORY', 'ORIGINATION_FEE', 'APPRAISAL',
    'INSURANCE', 'EARLY_REPAYMENT', 'REFINANCING', 'TOTAL_REPAYMENT', 'TOTAL_COST', 'CURRENCY_RISK']) {
    assert.ok(GLOSSARY_TERMS.includes(term), term);
  }
});

test('every term has a title and an explanation in all six languages, in the bundle', () => {
  for (const term of GLOSSARY_TERMS) {
    for (const key of [termTitleKey(term), termBodyKey(term)]) {
      assert.ok(S[key], `${key} missing from the copy file`);
      assert.equal(S[key].length, 6);
      S[key].forEach((v, i) => assert.ok(v && v.trim().length > 2, `${key}[${i}] empty`));
      assert.ok(enBlock.includes(`\n  ${key}: `), `${key} not spliced into the bundle`);
    }
  }
});

test('every example the engine can produce has copy, and its placeholders are all filled', () => {
  for (const term of GLOSSARY_TERMS) {
    const ex = termExample(term, null);
    if (!ex) continue;
    const copy = S[termExampleKey(term)];
    assert.ok(copy, `${term} has an example but no copy`);
    copy.forEach((text, i) => {
      for (const [, name] of text.matchAll(/\{\{(\w+)\}\}/g)) assert.ok(name in ex.vars, `${termExampleKey(term)}[${i}] uses {{${name}}} the engine does not supply`);
    });
  }
});

test('labels on the page point at real terms', () => {
  for (const [label, term] of Object.entries(TERM_FOR_LABEL)) {
    assert.ok(GLOSSARY_TERMS.includes(term), `${label} → ${term}`);
    assert.ok(enBlock.includes(`\n  ${label}: `), `${label} is not an existing label`);
  }
  assert.equal(TERM_FOR_LABEL.mortgage_label_nominal_rate, 'NOMINAL_RATE');
  assert.equal(TERM_FOR_LABEL.mortgage_label_effective_rate_bank, 'EFFECTIVE_RATE', 'nominal and effective must never share an explanation');
});

test('the owner-approved Georgian explanations are kept word for word', () => {
  const approved = {
    NOMINAL_RATE: 'ნომინალური პროცენტი არის განაკვეთი, რომლითაც ბანკი სესხზე პროცენტს გირიცხავს. ის სრულად არ აჩვენებს სესხთან დაკავშირებულ ყველა ხარჯს.',
    EFFECTIVE_RATE: 'ეფექტური პროცენტი სესხის რეალური ღირებულების უკეთ შესაფასებლად გამოიყენება. ის ითვალისწინებს კანონით განსაზღვრულ შესაბამის ხარჯებსა და გადახდების დროს. ამიტომ ორი შეთავაზების შედარებისას მხოლოდ ნომინალურ პროცენტს ნუ დაეყრდნობი.',
    PRINCIPAL: 'ძირი არის თანხა, რომელიც ბანკისგან ისესხე და ჯერ არ დაგიბრუნებია. ყოველთვიური შენატანის ნაწილი ძირის შემცირებას ხმარდება, ნაწილი კი პროცენტის გადახდას.',
    AMORTIZATION: 'ეს არის ცხრილი, რომელიც გაჩვენებს, ყოველ თვეში რამდენს იხდი, რა ნაწილი მიდის პროცენტში და რამდენით მცირდება დარჩენილი სესხი.',
    FIXED_RATE: 'ფიქსირებული განაკვეთი შეთანხმებული პერიოდის განმავლობაში არ იცვლება. აუცილებლად გადაამოწმე, ფიქსირებულია მთელი ვადით თუ მხოლოდ პირველი რამდენიმე წლით.',
    VARIABLE_RATE: 'ცვლადი განაკვეთი შეიძლება შეიცვალოს ხელშეკრულებით განსაზღვრული წესით. თუ გაიზრდება, შესაძლოა შენი ყოველთვიური შენატანიც გაიზარდოს.',
    REFINANCING: 'რეფინანსირება ნიშნავს არსებული სესხის ახალი სესხით ჩანაცვლებას. ზოგჯერ ეს უკეთეს პირობებს გაძლევს, მაგრამ გადაწყვეტილებამდე უნდა შეადარო ახალი და ძველი სესხის ყველა ხარჯი.',
    CURRENCY_RISK: 'თუ შემოსავალს ლარში იღებ, სესხს კი უცხოურ ვალუტაში იხდი, გაცვლითი კურსის ცვლილებამ შეიძლება შენი გადასახდელი ლარში გაზარდოს.',
    APPRAISAL: 'ბანკი ამოწმებს, რა ღირებულებისაა ქონება, რომელიც სესხის უზრუნველყოფად გამოიყენება. ბანკის მიერ მიღებული შეფასება შეიძლება განსხვავდებოდეს ბინის გასაყიდი ფასისგან.',
    INSURANCE: 'ზოგი იპოთეკური პროდუქტი ქონების ან სხვა დაზღვევას ითვალისწინებს. გადაამოწმე, რა დაზღვევაა საჭირო, რა ღირს და შედის თუ არა ეს თანხა შეთავაზების გამოთვლაში.',
    TOTAL_COST: 'ეს არის თანხა, რომელსაც სესხის მომსახურებასა და შესაბამის დამატებით ხარჯებში გადაიხდი. დაბალი ყოველთვიური შენატანი ყოველთვის არ ნიშნავს დაბალ ჯამურ ხარჯს.',
  };
  for (const [term, ka] of Object.entries(approved)) assert.equal(S[termBodyKey(term)][1], ka, term);
});

test('worked examples reconcile with the engine (sample loan)', () => {
  const s = SAMPLE_SCENARIO;
  const loan = s.propertyPrice - s.downPayment;
  const schedule = buildAmortizationSchedule({ principal: loan, annualRatePercent: s.nominalAnnualRatePercent, termMonths: s.termMonths });
  const payment = computeMonthlyPayment(loan, s.nominalAnnualRatePercent, s.termMonths);

  const p = termExample('PRINCIPAL', null);
  assert.equal(p.sample, true);
  assert.equal(p.vars.loan.value, 100_000);
  assert.equal(p.vars.interest.value, 1000, '1% a month of 100,000');
  assert.equal(Math.round((p.vars.interest.value + p.vars.principal.value) * 100) / 100, payment, 'principal + interest = payment');

  const a = termExample('AMORTIZATION', null);
  assert.ok(a.vars.lastInterest.value < a.vars.interest.value);
  assert.equal(a.vars.lastInterest.value, schedule.at(-1).interestPortion);

  const total = termExample('TOTAL_REPAYMENT', null);
  const interestSum = schedule.reduce((sum, r) => sum + r.interestPortion, 0);
  assert.ok(Math.abs(total.vars.total.value - (loan + interestSum)) < 0.01);
  assert.equal(total.vars.years.value, 20);

  const eff = termExample('EFFECTIVE_RATE', null);
  assert.equal(eff.vars.fee.value, 1000);
  const expected = annualizeFromSchedule(loan - 1000, schedule);
  assert.ok(Math.abs(eff.vars.effective.value - expected) < 0.01);
  assert.ok(eff.vars.effective.value > eff.vars.rate.value, 'a fee always lifts the effective rate above the nominal');

  const v = termExample('VARIABLE_RATE', null);
  assert.equal(v.vars.shocked.value, computeMonthlyPayment(loan, 14, 240));
  assert.ok(v.vars.shocked.value > payment);

  const pti = termExample('PTI', null);
  assert.ok(Math.abs(pti.vars.pti.value - (payment / 4000) * 100) < 0.01);
  const ltv = termExample('LTV', null);
  assert.equal(ltv.vars.ltv.value, 80);
  const down = termExample('DOWN_PAYMENT', null);
  assert.equal(down.vars.downPct.value, 20);
});

test('examples use the person\'s own numbers when there is a scenario', () => {
  const own = { propertyPrice: 200_000, downPayment: 60_000, termMonths: 180, nominalAnnualRatePercent: 9, currency: 'USD', monthlyNetIncome: null, originationFeePercent: null };
  const ex = termExample('MONTHLY_INSTALLMENT', own);
  assert.equal(ex.sample, false);
  assert.equal(ex.vars.loan.value, 140_000);
  assert.equal(ex.vars.payment.value, computeMonthlyPayment(140_000, 9, 180));
  // No income entered: PTI falls back to the sample income and says so.
  assert.equal(termExample('PTI', own).sample, true);
  // Words-only terms have no numbers to invent.
  assert.equal(termExample('GUARANTOR', own), null);
  assert.equal(termExample('CREDIT_HISTORY', own), null);
});
