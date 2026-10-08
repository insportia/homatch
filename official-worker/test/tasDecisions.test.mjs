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
