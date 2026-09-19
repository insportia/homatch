import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyGap, customerFacingGaps, isCoverageLanguage, scrubCoverageLanguage,
  meaningful, sectionHasContent,
} from '../coverageGap.ts';

/*
 * THE RULE: A REPORT SAYS WHAT WE KNOW ABOUT THE PROPERTY.
 *
 * Every string quoted below was on the live Villion report. Several of them I
 * wrote myself while moving gaps out of the opening — which is the point: a
 * diagnostic moved somewhere politer is still a diagnostic.
 */

/* ------------------------------------------------------------------ *
 * The three classes                                                   *
 * ------------------------------------------------------------------ */

test('a registry answer that is genuinely open stays with the customer', () => {
  // The registry was READ. The answer changes what a buyer does before
  // signing, so it is about the property, not about us.
  assert.equal(classifyGap('verify_unconf_rights'), 'PROPERTY_UNKNOWN');
  assert.equal(classifyGap('verify_unconf_commissioning'), 'PROPERTY_UNKNOWN');
});

test('our own reach never reaches the customer', () => {
  assert.equal(classifyGap('verify_unconf_utilities'), 'RESEARCH_COVERAGE_GAP');
  assert.equal(classifyGap('verify_unconf_subject_price'), 'RESEARCH_COVERAGE_GAP');
});

test('an unclassified gap defaults to hidden, not to shown', () => {
  // A new gap nobody has classified stays out of the report until somebody
  // decides it belongs there. The failure mode of the other default is a
  // crawler diagnostic appearing in front of a buyer.
  assert.equal(classifyGap('verify_unconf_something_new'), 'RESEARCH_COVERAGE_GAP');
  assert.equal(classifyGap(''), 'RESEARCH_COVERAGE_GAP');
});

test('the real Villion gap list loses the coverage items and keeps the rest', () => {
  const stored = [
    { key: 'verify_unconf_rights', weight: 'MATERIAL' },
    { key: 'verify_unconf_commissioning', weight: 'MATERIAL' },
    { key: 'verify_unconf_subject_price', weight: 'ROUTINE' },
    { key: 'verify_unconf_utilities', weight: 'ROUTINE' },
  ];
  assert.deepEqual(
    customerFacingGaps(stored).map((g) => g.key),
    ['verify_unconf_rights', 'verify_unconf_commissioning']
  );
});

/* ------------------------------------------------------------------ *
 * Prose                                                               *
 * ------------------------------------------------------------------ */

test('the exact sentences from the live report are recognised', () => {
  for (const s of [
    'ამ შენობაში ან ამ ქუჩაზე გასაყიდი განცხადება ვერ მოიძებნა, ამიტომ მონაცემები სხვაგანაა.',
    'ჩვენს მოძიებულ წყაროებში ამ კომპანიის სხვა დასრულებული პროექტი ვერ დადასტურდა.',
    'კომუნიკაციების მიერთება ამ შემოწმებისას არ გადამოწმებულა.',
    'We could not find any listings on this street.',
    'Нашим источникам не удалось подтвердить статус.',
    'לא מצאנו מודעות ברחוב הזה.',
    'لم نتمكن من العثور على إعلانات في هذا المبنى.',
  ]) {
    assert.equal(isCoverageLanguage(s), true, `not recognised: ${s}`);
  }
});

test('a sentence about the input we were handed is also a coverage gap', () => {
  /*
   * FOUND ON THE LIVE PAGE AFTER THE FIRST FIX. These carry no research actor
   * — no ჩვენ, no წყარო, no კვლევა — so every actor-based pattern missed
   * them, and the model's own market paragraph kept saying it.
   */
  for (const s of [
    'კონკრეტული ბინის ფართობი და მოთხოვნილი ფასი მოწოდებულ მასალაში არ ჩანს, ამიტომ ვერ ვიტყვი.',
    'ამ ბინის ფართობი არ მოგვეწოდა.',
    'The asking price was not provided to us.',
    'Площадь не предоставлена.',
  ]) {
    assert.equal(isCoverageLanguage(s), true, `not recognised: ${s}`);
    assert.equal(scrubCoverageLanguage(s), '', `not scrubbed: ${s}`);
  }
});

test('a verified negative fact is never mistaken for a coverage gap', () => {
  /*
   * THE ASSERTION THAT MATTERS MOST.
   *
   * Hiding a registered mortgage to make a report read nicely would be far
   * worse than the defect being fixed. These are findings ESTABLISHED by a
   * source, and every one of them must survive untouched.
   */
  for (const s of [
    'მშობელ ნაკვეთზე 01.18.06.019.055 რეგისტრირებულია იპოთეკა საქართველოს ბანკის სასარგებლოდ.',
    'რეესტრის ჩანაწერით კომპანიას ერთობლივი წარმომადგენლობა აქვს.',
    'The register records a mortgage in favour of Bank of Georgia.',
    'В реестре зарегистрирована ипотека в пользу банка.',
    'ქონებაზე რეგისტრირებული სხვა უფლება არ არსებობს რეესტრის ჩანაწერით.',
  ]) {
    assert.equal(isCoverageLanguage(s), false, `wrongly flagged as coverage: ${s}`);
    assert.equal(scrubCoverageLanguage(s), s, `a verified fact was altered: ${s}`);
  }
});

test('a paragraph keeps its findings and loses only the confession', () => {
  const mixed =
    'მშობელ ნაკვეთზე რეგისტრირებულია იპოთეკა საქართველოს ბანკის სასარგებლოდ. '
    + 'ამ შენობაში ან ამ ქუჩაზე გასაყიდი განცხადება ვერ მოიძებნა. '
    + 'ხელშეკრულებამდე გათავისუფლების მექანიზმი უნდა გაირკვეს.';
  const out = scrubCoverageLanguage(mixed);
  assert.ok(out.includes('იპოთეკა'), 'the finding must survive');
  assert.ok(out.includes('გათავისუფლების'), 'the advice must survive');
  assert.ok(!out.includes('ვერ მოიძებნა'), `the confession survived: ${out}`);
  assert.ok(!/\s{2,}/.test(out), `whitespace left behind: ${out}`);
});

test('a paragraph that was nothing but a confession becomes empty', () => {
  const only = 'ჩვენს მოძიებულ წყაროებში სხვა დასრულებული პროექტი ვერ დადასტურდა.';
  assert.equal(scrubCoverageLanguage(only), '');
  assert.equal(scrubCoverageLanguage(''), '');
});

/* ------------------------------------------------------------------ *
 * Sections with nothing in them                                       *
 * ------------------------------------------------------------------ */

const known = (r) => r.level !== 'NOT_VERIFIED';

test('a utilities block where nothing is known does not render at all', () => {
  // Exactly the live state: five rows, all „ჯერ არ გადამოწმებულა".
  const allUnknown = ['electricity', 'water', 'gas', 'sewage', 'internet']
    .map((key) => ({ key, level: 'NOT_VERIFIED' }));
  assert.equal(sectionHasContent(allUnknown, known), false);
  assert.deepEqual(meaningful(allUnknown, known), []);
});

test('a partial utilities block renders only the rows that say something', () => {
  const partial = [
    { key: 'electricity', level: 'CONFIRMED' },
    { key: 'water', level: 'NOT_VERIFIED' },
    { key: 'gas', level: 'REPORTED' },
    { key: 'sewage', level: 'NOT_VERIFIED' },
    { key: 'internet', level: 'NOT_VERIFIED' },
  ];
  assert.equal(sectionHasContent(partial, known), true);
  assert.deepEqual(meaningful(partial, known).map((r) => r.key), ['electricity', 'gas']);
});

test('a conflict is content, not an absence', () => {
  // Two sources disagreeing is a finding a buyer should see.
  const conflicting = [{ key: 'gas', level: 'CONFLICTING' }];
  assert.equal(sectionHasContent(conflicting, known), true);
});
