// Decision extraction from official TAS response text: number, issue date,
// legal outcome — conservative, never inferred from silence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDecision, OUTCOME_AUTHORITY } from '../.tstest-build/workflows/tas/api/decisions.js';

test('the live-confirmed 639208 / 4304382 shape: number, date, intermediate result', () => {
  const text = 'ქალაქ თბილისის მუნიციპალიტეტის მერია ბრძანება N 4303543 გაცემის თარიღი: 13/12/2018 განცხადება AR1639208 საკადასტრო კოდი 01.18.06.019.055 შედეგი: შუალედური';
  const d = extractDecision(text);
  assert.equal(d.number, '4303543');
  assert.equal(d.issueDate, '2018-12-13');
  assert.equal(d.outcome, 'INTERMEDIATE');
  assert.ok(d.evidence.includes('შუალედური'));
});

test('a refusal is never read as an approval, even when approval words also appear', () => {
  const d = extractDecision('გადაწყვეტილება № 5550001 თარიღი 02.03.2021. განცხადება არ დაკმაყოფილდეს, მშენებლობის ნებართვის გაცემაზე უარი ეთქვას.');
  assert.equal(d.outcome, 'REFUSED');
});

test('permit issued with validity; deadline extension; cancellation; suspension', () => {
  assert.equal(extractDecision('ბრძანება N 1234567 01/06/2019 მშენებლობის ნებართვა გაიცეს. ნებართვის მოქმედების ვადა 31.12.2022').outcome, 'PERMIT_ISSUED');
  assert.equal(extractDecision('ბრძანება N 1234567 01/06/2019 მშენებლობის ნებართვა გაიცეს. ნებართვის მოქმედების ვადა 31.12.2022').validUntil, '2022-12-31');
  assert.equal(extractDecision('ბრძანება N 7654321 05/05/2023 ნებართვის ვადა გაგრძელდეს 31.12.2026-მდე').outcome, 'DEADLINE_EXTENDED');
  assert.equal(extractDecision('ბრძანება N 1112223 10/10/2024 მშენებლობის ნებართვა ბათილად იქნეს ცნობილი').outcome, 'CANCELLED');
  assert.equal(extractDecision('ბრძანება N 1112224 11/10/2024 სამშენებლო სამუშაოები შეჩერდეს').outcome, 'SUSPENDED');
});

test('no operative wording → UNDETERMINED; empty → UNDETERMINED; impossible dates rejected', () => {
  assert.equal(extractDecision('ფურცელი 1 ხელმოწერა ბეჭედი თბილისის მერია სამსახური').outcome, 'UNDETERMINED');
  assert.equal(extractDecision('').outcome, 'UNDETERMINED');
  assert.equal(extractDecision('ბრძანება N 1234567 45/13/2019 შეთანხმდეს').issueDate, null);
});

test('authority ranks cancellation and suspension above any approval', () => {
  assert.ok(OUTCOME_AUTHORITY.CANCELLED > OUTCOME_AUTHORITY.PERMIT_ISSUED);
  assert.ok(OUTCOME_AUTHORITY.SUSPENDED > OUTCOME_AUTHORITY.APPROVED);
  assert.ok(OUTCOME_AUTHORITY.INTERMEDIATE < OUTCOME_AUTHORITY.REFUSED);
});

// Adversarial review cases: negation, conditional boilerplate, side clauses,
// conflicting wording and a quoted earlier date must never yield a confident
// wrong outcome.
test('the standard refusal title is a refusal, not a permit', () => {
  assert.equal(extractDecision('ბრძანება N 7000001 20.06.2023 მშენებლობის ნებართვის გაცემაზე უარის თქმის შესახებ').outcome, 'REFUSED');
});

test('negated approval is a refusal; negated sanctions are not sanctions', () => {
  assert.equal(extractDecision('ბრძანება N 7000002 20.06.2023 პროექტი არ შეთანხმდეს').outcome, 'REFUSED');
  assert.notEqual(extractDecision('ბრძანება N 7000003 20.06.2023 ნებართვა არ გაუქმდეს, განმარტება').outcome, 'CANCELLED');
});

test('conditional boilerplate in a permit does not suspend it', () => {
  assert.equal(extractDecision('ბრძანება N 7000004 20.06.2023 მშენებლობის ნებართვა გაიცეს. დარღვევის შემთხვევაში ნებართვა შეიძლება შეჩერდეს.').outcome, 'PERMIT_ISSUED');
});

test('an amendment voiding the PREVIOUS order is an amendment, not a cancellation', () => {
  assert.equal(extractDecision('ბრძანება N 7000005 20.06.2023 ვბრძანებ: პროექტში ცვლილება შეთანხმდეს; წინა ბრძანება ძალადაკარგულად ჩაითვალოს.').outcome, 'AMENDMENT_APPROVED');
  assert.equal(extractDecision('ბრძანება N 7000006 20.06.2023 ვბრძანებ: ნებართვა ძალადაკარგულად ჩაითვალოს.').outcome, 'CANCELLED');
});

test('positive and negative operative wording together → UNDETERMINED', () => {
  assert.equal(extractDecision('ბრძანება N 7000007 20.06.2023 ნებართვა გაიცეს. ნებართვა გაუქმდეს.').outcome, 'UNDETERMINED');
});

test('"no deficiency found" is not a deficiency', () => {
  assert.equal(extractDecision('ბრძანება N 7000008 20.06.2023 ხარვეზი არ გამოვლინდა, პროექტი შეთანხმდეს').outcome, 'APPROVED');
});

test('a quoted earlier date is not the issue date', () => {
  const d = extractDecision('თქვენი 12.01.2015 განცხადების საფუძველზე ბრძანება N 7000009 20.06.2023 — მშენებლობის ნებართვა გაიცეს');
  assert.equal(d.issueDate, '2023-06-20');
  assert.equal(extractDecision('თქვენი 12.01.2015 განცხადება. ბრძანება ამოუკითხავია. ნებართვა გაიცეს').issueDate, null);
});

test('ქართული (contains "თუ") does not trigger the conditional guard', () => {
  assert.equal(extractDecision('ბრძანება N 7000010 20.06.2023 ქართული ტექსტი: მშენებლობის ნებართვა გაიცეს').outcome, 'PERMIT_ISSUED');
});

test('the title of Resolution No 255 is a citation, not a commissioning (owner live run 2026-10-10)', () => {
  const text = 'გაცემის თარიღი: 27/05/2022\nგანცხადების ნომერი: AR1897963\nშედეგი: შუალედური\nქალაქ თბილისის მუნიციპალიტეტის არქიტექტურის სამსახური\nგადაწყვეტილება No 5955361\n'
    + 'მიწის ნაკვეთის სამშენებლოდ გამოყენების პირობების დადგენა\n'
    + 'საქართველოს მთავრობის 2019 წლის 31 მაისის No255 დადგენილებით დამტკიცებული მშენებლობის ნებართვის გაცემისა და შენობა-ნაგებობის ექსპლუატაციაში მიღების წესის და პირობების, ქალაქ თბილისის ... საფუძველზე\n'
    + 'ვადგენ: დამტკიცდეს მიწის ნაკვეთის სამშენებლოდ გამოყენების პირობები.';
  const d = extractDecision(text);
  assert.notEqual(d.outcome, 'COMMISSIONED');
  assert.equal(d.outcome, 'INTERMEDIATE', 'the decision states its own result: intermediate');
  // The citation alone, without a result line, is never a commissioning either.
  const bare = extractDecision('გადაწყვეტილება No 5955361. ' + 'No255 დადგენილებით დამტკიცებული მშენებლობის ნებართვის გაცემისა და შენობა-ნაგებობის ექსპლუატაციაში მიღების წესის და პირობების საფუძველზე ვადგენ: დამტკიცდეს პირობები.');
  assert.notEqual(bare.outcome, 'COMMISSIONED');
});

test('a real acceptance into operation is still read as COMMISSIONED', () => {
  const d = extractDecision('გადაწყვეტილება № 7000001 თარიღი 01.02.2026. ვბრძანებ: შენობა-ნაგებობა მიღებულ იქნეს ექსპლუატაციაში. ექსპლუატაციაში მიღების აქტი ძალაშია.');
  assert.equal(d.outcome, 'COMMISSIONED');
});
