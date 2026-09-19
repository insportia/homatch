import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buyerOpening, isMissingInputStatement, labelOf, unconfirmedItems,
} from '../buyerSummary.ts';

/*
 * THE OPENING, AGAINST THE REPORT THAT CAUSED THE COMPLAINT.
 *
 * Every fixture below is the REAL stored synthesis of Villion research job
 * 947d921c, read out of production. Using the real thing is the point: the
 * requirement is that a report nobody is allowed to re-run must present
 * correctly from the bytes already in the database.
 */

const REAL_SUMMARY = {
  label: 'NEEDS_ATTENTION',
  statement:
    'ფასის შეფასება ჯერ ვერ კეთდება, რადგან ბინის ფართობი და მოთხოვნილი ფასი მოწოდებულ მასალაში არ ჩანს.',
  highlights: [
    {
      headline: 'მცირე მასშტაბი და კარგი საერთო ინფრასტრუქტურა',
      detail: 'ორი 8-სართულიანი ბლოკი 42 ერთეულით, გამწვანებული ეზო, დახურული სივრცეები, ლიფტები და მიწისქვეშა პარკინგი.',
      dimension: 'PROJECT_QUALITY',
      sentiment: 'POSITIVE',
    },
    {
      headline: 'ფასის კონტექსტი არსებობს, მაგრამ არა ამ ბინისთვის',
      detail: '37 აქტიური განცხადების peer-project შედარებაში მოთხოვნილი ფასების მედიანა 1,670 აშშ დოლარია კვ.მ-ზე.',
      dimension: 'MARKET_POSITION',
      sentiment: 'BALANCED',
    },
    { headline: 'მშობელ ნაკვეთზე რეგისტრირებული იპოთეკა', sentiment: 'ATTENTION' },
    { headline: 'ახალგაზრდა, რეესტრში დადასტურებული კომპანია', sentiment: 'POSITIVE' },
    { headline: 'ჩაბარება ცალკე უნდა გადამოწმდეს', sentiment: 'ATTENTION' },
  ],
};

/* ------------------------------------------------------------------ *
 * Recognising a sentence about missing input                          *
 * ------------------------------------------------------------------ */

test('the real opening sentence is recognised as being about missing input', () => {
  assert.equal(isMissingInputStatement(REAL_SUMMARY.statement), true);
});

test('it recognises the same claim in every language the product ships', () => {
  for (const s of [
    'ფასის შეფასება ჯერ ვერ კეთდება, რადგან ბინის ფართობი არ ჩანს.',
    'A price assessment is not available because the area and asking price are missing.',
    'Оценка цены невозможна: площадь и запрашиваемая цена не указаны.',
    'Alan ve istenen fiyat belirtilmediği için fiyat değerlendirmesi mümkün değil.',
    'لا يمكن تقييم السعر لأن المساحة غير متاحة.',
    'לא ניתן להעריך את המחיר כי השטח לא צוין.',
  ]) {
    assert.equal(isMissingInputStatement(s), true, `not recognised: ${s}`);
  }
});

test('a real finding that merely mentions price is never mistaken for a gap', () => {
  /*
   * Both halves are required — a price/area subject AND an absence claim — so
   * genuine market findings survive. Suppressing one of these would hide the
   * most decision-relevant sentence a report can carry.
   */
  for (const s of [
    'მოთხოვნილი ფასი მედიანაზე 15%-ით მაღალია.',
    'The asking price is 15% above the local median.',
    'Запрашиваемая цена на 15% выше медианы.',
    'ფართობი 24.30 კვ.მ-ია, რაც ბლოკის საშუალოზე ნაკლებია.',
  ]) {
    assert.equal(isMissingInputStatement(s), false, `wrongly flagged: ${s}`);
  }
  assert.equal(isMissingInputStatement(''), false);
});

/* ------------------------------------------------------------------ *
 * The opening itself                                                  *
 * ------------------------------------------------------------------ */

test('the verdict is the model’s and is never upgraded', () => {
  // Fabricating positivity is the one failure worse than the defect being
  // fixed. NEEDS_ATTENTION stays NEEDS_ATTENTION.
  assert.equal(buyerOpening(REAL_SUMMARY).label, 'NEEDS_ATTENTION');
  assert.equal(labelOf({ label: 'POSITIVE' }), 'POSITIVE');
  assert.equal(labelOf({ label: 'nonsense' }), 'BALANCED', 'an unknown label falls to the middle');
  assert.equal(labelOf(null), 'BALANCED');
});

test('the missing-input sentence is set aside and replaced by one about the verdict', () => {
  const open = buyerOpening(REAL_SUMMARY);
  assert.equal(open.replaced, true);
  assert.equal(open.statement, undefined, 'the gap sentence must not open the report');
  assert.equal(open.fallbackKey, 'verify_open_attention');
});

test('a statement genuinely about the property is left exactly alone', () => {
  const open = buyerOpening({
    label: 'POSITIVE',
    statement: 'პროექტი დასრულებულია და რეესტრში სუფთად ირიცხება.',
    highlights: [],
  });
  assert.equal(open.replaced, false);
  assert.equal(open.statement, 'პროექტი დასრულებულია და რეესტრში სუფთად ირიცხება.');
  assert.equal(open.fallbackKey, undefined);
});

test('the supporting line carries only what the run actually evidenced', () => {
  const open = buyerOpening(REAL_SUMMARY);
  // The two POSITIVE highlights, in order, and nothing else.
  assert.deepEqual(open.support, [
    'მცირე მასშტაბი და კარგი საერთო ინფრასტრუქტურა',
    'ახალგაზრდა, რეესტრში დადასტურებული კომპანია',
  ]);
  // Nothing BALANCED or ATTENTION is promoted into the opening.
  assert.ok(!open.support.some((s) => s.includes('იპოთეკა')));
});

test('a report with nothing positive gets no encouraging line at all', () => {
  const open = buyerOpening({
    label: 'NEEDS_ATTENTION',
    statement: 'ფასი ვერ დგინდება.',
    highlights: [{ headline: 'რისკი', sentiment: 'ATTENTION' }],
  });
  assert.deepEqual(open.support, [], 'an empty support line is honest; an invented one is not');
});

test('no summary at all does not throw and claims nothing', () => {
  const open = buyerOpening(null);
  assert.equal(open.label, 'BALANCED');
  assert.equal(open.replaced, true);
  assert.deepEqual(open.support, []);
});

/* ------------------------------------------------------------------ *
 * Where the gap actually goes                                         *
 * ------------------------------------------------------------------ */

test('the missing price and area reappear under what remains unconfirmed', () => {
  // The real stored shape: no subject valuation, rights NOT_CONFIRMED, no
  // utilities matrix, and a construction status that disclaims itself.
  const items = unconfirmedItems({
    market: { subjectValuation: null, contextAvailable: true },
    snapshot: {
      constructionStatus:
        'საჯაროდ ხელმისაწვდომ აღწერაში ორივე ბლოკი ჩაბარებულად არის აღნიშნული. ეს აღწერა არ წარმოადგენს ოფიციალური ექსპლუატაციაში მიღების დამადასტურებელ მტკიცებულებას.',
    },
    rights: { status: 'NOT_CONFIRMED' },
    utilities: null,
  });
  const keys = items.map((i) => i.key);
  assert.ok(keys.includes('verify_unconf_subject_price'), 'the gap must be stated somewhere');
  assert.ok(keys.includes('verify_unconf_rights'));
  assert.ok(keys.includes('verify_unconf_utilities'));
  assert.ok(keys.includes('verify_unconf_commissioning'));
});

test('a registry answer of “nothing found” is not an open question', () => {
  const items = unconfirmedItems({
    market: { subjectValuation: { pricePerSqm: 1800 } },
    rights: { status: 'NONE_FOUND_IN_CHECKED_SOURCE' },
    utilities: { electricity: { status: 'CONFIRMED_CONNECTED' } },
    snapshot: {},
  });
  assert.deepEqual(items, [], 'a report that answered everything lists nothing');
});

test('an unverified utility is never turned into an absent one', () => {
  // "We did not check" and "this building has no water" are different claims
  // and only one of them is true.
  const items = unconfirmedItems({ market: { subjectValuation: 1 }, utilities: null });
  assert.deepEqual(items.map((i) => i.key), ['verify_unconf_utilities']);
  assert.equal(items[0].weight, 'ROUTINE');
});
