// dateParse.test.mjs — util/dateParse.ts, the shared date-normalization
// behind both TAS/ENREG official-document date extraction and ENREG's
// "latest application by real parsed date" selection (2026-09 "report
// intelligence v2" mandate Section 13).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAnyDate, extractAllDates, selectLatestDate } from '../.tstest-build/util/dateParse.js';

test('parseAnyDate: numeric DD.MM.YYYY and YYYY-MM-DD normalize to ISO', () => {
  assert.equal(parseAnyDate('05.09.2026'), '2026-09-05');
  assert.equal(parseAnyDate('2026-09-05'), '2026-09-05');
  assert.equal(parseAnyDate('05/09/2026'), '2026-09-05');
});
test('parseAnyDate: Georgian prose dates', () => {
  assert.equal(parseAnyDate('29 ოქტომბერი 2023'), '2023-10-29');
  assert.equal(parseAnyDate('29 ოქტომბერს, 2023'), '2023-10-29');
  assert.equal(parseAnyDate('2023 წლის 29 ოქტომბერი'), '2023-10-29');
  assert.equal(parseAnyDate('12 ივნისს 2022'), '2022-06-12');
});
test('parseAnyDate: never invents a date when none is printed', () => {
  assert.equal(parseAnyDate('no date here'), null);
  assert.equal(parseAnyDate(''), null);
  assert.equal(parseAnyDate(null), null);
});
test('parseAnyDate: rejects an out-of-range month/day rather than guessing', () => {
  assert.equal(parseAnyDate('45.13.2026'), null);
});

test('extractAllDates: collects every distinct date, mixed formats, dedup by normalized value', () => {
  const out = extractAllDates('პირველი გადაწყვეტილება 01.01.2020, მეორე 2023 წლის 29 ოქტომბერი, იგივე თარიღი 29 ოქტომბერი 2023 ხელახლა ნახსენები');
  assert.deepEqual(out, ['2020-01-01', '2023-10-29']);
});

test('selectLatestDate: returns the ORIGINAL string with the max value, mixed numeric/Georgian', () => {
  assert.equal(selectLatestDate(['01.01.2020', '2023 წლის 29 ოქტომბერი', '30.06.2022']), '2023 წლის 29 ოქტომბერი');
});
test('selectLatestDate: falls back to the first string when nothing parses', () => {
  assert.equal(selectLatestDate(['garbage', 'also garbage']), 'garbage');
});
