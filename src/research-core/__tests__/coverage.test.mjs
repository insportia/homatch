// COVERAGE: do we already know enough not to go outside?
//
// The behaviour these tests protect is a decision that SPENDS or SAVES money, so
// the failure modes worth testing are the ones that are wrong in a direction
// nobody notices:
//
//   COVERED when the store holds only stale rows  → the sweep is skipped and the
//                                                    customer gets nothing
//   UNCOVERED when the store holds plenty         → we pay for what we had
//   PARTIAL that sweeps every language anyway     → we re-buy the half we held
//
// Freshness itself is judgeDelivery()'s job. These tests assert that coverage
// DELEGATES to it rather than agreeing with it by coincidence.

import test from 'node:test';
import assert from 'node:assert/strict';

import { assessCoverage, decideSweep } from '../discovery/coverage.ts';
import { DEFAULT_DELIVERY_WINDOW_DAYS, judgeDelivery } from '../discovery/revalidation.ts';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-26T12:00:00.000Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

/** A freshness record, defaulting to something verified this morning. */
function freshness(overrides = {}) {
  return {
    firstSeenAt: iso(30 * DAY),
    lastSeenAt: iso(1 * DAY),
    lastVerifiedAt: iso(1 * DAY),
    contentChangedAt: null,
    expiresAt: iso(-6 * DAY),
    contentFingerprint: 'abc123',
    validationState: 'VALID',
    failedChecks: 0,
    ...overrides,
  };
}

const held = (language, overrides = {}, city = 'Tbilisi', publishedAt = iso(2 * DAY)) => ({
  city,
  language,
  sourceId: 'telegram:tbilisikvartiri',
  publishedAt,
  freshness: freshness(overrides),
});

const request = (overrides = {}) => ({
  market: 'Georgia',
  city: 'Tbilisi',
  languages: ['ka', 'ru'],
  minPerLanguage: 3,
  now: NOW,
  ...overrides,
});

/* ────────────────────────────────────────────────────────────────────────
 * The three verdicts
 * ──────────────────────────────────────────────────────────────────────── */

test('enough deliverable evidence in every requested language is COVERED, and no sweep', () => {
  const store = [
    held('ka'), held('ka'), held('ka'),
    held('ru'), held('ru'), held('ru'),
  ];
  const assessment = assessCoverage(store, request());

  assert.equal(assessment.verdict, 'COVERED');
  assert.deepEqual(assessment.deliverableByLanguage, { ka: 3, ru: 3 });
  assert.deepEqual(assessment.gaps, []);

  const decision = decideSweep(assessment);
  assert.equal(decision.sweep, false);
  assert.deepEqual(decision.languages, []);
});

test('an empty store is UNCOVERED, never COVERED by vacuous satisfaction', () => {
  const assessment = assessCoverage([], request());

  assert.equal(assessment.verdict, 'UNCOVERED');
  assert.equal(assessment.gaps.length, 2, 'one gap per requested language');
  assert.deepEqual(assessment.sweepLanguages.sort(), ['ka', 'ru']);
  assert.equal(decideSweep(assessment).sweep, true);
});

test('one language held and one missing is PARTIAL, and the sweep is scoped to the gap', () => {
  const store = [held('ka'), held('ka'), held('ka'), held('ka')];
  const assessment = assessCoverage(store, request());

  assert.equal(assessment.verdict, 'PARTIAL');
  assert.equal(assessment.gaps.length, 1);
  assert.equal(assessment.gaps[0].value, 'ru');
  assert.equal(assessment.gaps[0].have, 0);

  const decision = decideSweep(assessment);
  assert.equal(decision.sweep, true);
  assert.deepEqual(
    decision.languages,
    ['ru'],
    'the Georgian half is already paid for and must not be swept again',
  );
});

/* ────────────────────────────────────────────────────────────────────────
 * Coverage is counted in DELIVERABLE evidence, and the rule is not ours
 * ──────────────────────────────────────────────────────────────────────── */

test('a store of nothing but stale rows is UNCOVERED, not COVERED', () => {
  // Verified well outside the seven-day window: judgeDelivery says
  // NEEDS_REVALIDATION, so these are a re-read we owe, not coverage we hold.
  const stale = { lastVerifiedAt: iso(40 * DAY), firstSeenAt: iso(90 * DAY) };
  const store = [
    held('ka', stale), held('ka', stale), held('ka', stale), held('ka', stale),
    held('ru', stale), held('ru', stale), held('ru', stale), held('ru', stale),
  ];
  const assessment = assessCoverage(store, request());

  assert.equal(assessment.verdict, 'UNCOVERED');
  assert.deepEqual(assessment.deliverableByLanguage, { ka: 0, ru: 0 });
  assert.equal(assessment.excluded.NEEDS_REVALIDATION, 8);
});

test('every non-deliverable verdict is reported by name, never summed into "stale"', () => {
  const store = [
    held('ka', { lastVerifiedAt: iso(40 * DAY) }),                             // NEEDS_REVALIDATION
    held('ka', { validationState: 'REMOVED' }),                                // REMOVED
    held('ka', { validationState: 'INVALID' }),                                // INVALID
    held('ka', { validationState: 'UNVERIFIABLE', lastVerifiedAt: null, failedChecks: 3 }),
  ];
  const assessment = assessCoverage(store, request({ minPerLanguage: 1 }));

  assert.deepEqual(assessment.excluded, {
    NEEDS_REVALIDATION: 1,
    REMOVED: 1,
    INVALID: 1,
    UNVERIFIABLE: 1,
  });
  assert.match(assessment.rationale, /Not counted:/);
  assert.match(assessment.rationale, /1 REMOVED/);
  assert.match(
    assessment.rationale,
    /1 UNVERIFIABLE/,
    'a source refusing us is a different situation from a re-read we owe',
  );
});

test('a NEW_UNVERIFIED sighting counts, because judgeDelivery calls it deliverable', () => {
  // First seen inside the window and never re-checked. The existing contract
  // deliberately delivers this while refusing to call it verified, and coverage
  // must not quietly apply a stricter rule of its own.
  const newSighting = { lastVerifiedAt: null, firstSeenAt: iso(2 * DAY), validationState: 'UNVERIFIED' };
  const probe = judgeDelivery(freshness(newSighting), { now: NOW });
  assert.equal(probe.verdict, 'NEW_UNVERIFIED');
  assert.equal(probe.deliverable, true, 'guard: the premise of this test');

  const store = [held('ka', newSighting), held('ru', newSighting)];
  const assessment = assessCoverage(store, request({ minPerLanguage: 1 }));

  assert.equal(assessment.verdict, 'COVERED');
  assert.deepEqual(assessment.deliverableByLanguage, { ka: 1, ru: 1 });
});

test('the policy is handed to judgeDelivery, so a tighter window narrows coverage', () => {
  const store = [held('ka', { lastVerifiedAt: iso(3 * DAY) }), held('ru', { lastVerifiedAt: iso(3 * DAY) })];
  const base = request({ minPerLanguage: 1 });

  assert.equal(
    assessCoverage(store, base).verdict,
    'COVERED',
    `three days is inside the default ${DEFAULT_DELIVERY_WINDOW_DAYS}-day window`,
  );
  assert.equal(
    assessCoverage(store, { ...base, policy: { deliveryWindowDays: 1 } }).verdict,
    'UNCOVERED',
    'a one-day window must make the same rows stale, proving the policy is not ignored',
  );
});

test('allowUnverifiedWithinWindow: false reaches judgeDelivery too', () => {
  const store = [held('ka', { lastVerifiedAt: null, firstSeenAt: iso(1 * DAY), validationState: 'UNVERIFIED' })];
  const base = request({ languages: ['ka'], minPerLanguage: 1 });

  assert.equal(assessCoverage(store, base).verdict, 'COVERED');
  assert.equal(
    assessCoverage(store, { ...base, policy: { allowUnverifiedWithinWindow: false } }).verdict,
    'UNCOVERED',
  );
});

/* ────────────────────────────────────────────────────────────────────────
 * A language we did not ask for is not coverage
 * ──────────────────────────────────────────────────────────────────────── */

test('fresh evidence in an unrequested language never covers the requested ones', () => {
  const store = [held('ka'), held('ka'), held('ka'), held('ka'), held('ka')];
  const assessment = assessCoverage(store, request({ languages: ['ar', 'he'], minPerLanguage: 1 }));

  assert.equal(assessment.verdict, 'UNCOVERED');
  assert.deepEqual(assessment.deliverableByLanguage, { ar: 0, he: 0 });
  assert.match(
    assessment.rationale,
    /5 deliverable item\(s\) are held in languages this campaign did not request/,
  );
});

test('language matching is case-insensitive on both sides', () => {
  const store = [held('KA'), held('Ka'), held('kA')];
  const assessment = assessCoverage(store, request({ languages: ['Ka'], minPerLanguage: 3 }));

  assert.equal(assessment.verdict, 'COVERED');
  assert.deepEqual(assessment.deliverableByLanguage, { ka: 3 });
});

test('evidence with no language recorded is not credited to a requested language', () => {
  const store = [held(null), held(null), held(''), held(undefined)];
  const assessment = assessCoverage(store, request({ languages: ['ka'], minPerLanguage: 1 }));

  assert.equal(assessment.verdict, 'UNCOVERED');
  assert.equal(assessment.deliverableByLanguage.ka, 0);
});

test('a duplicated requested language is counted once, not twice', () => {
  const store = [held('ka'), held('ka')];
  const assessment = assessCoverage(store, request({ languages: ['ka', 'ka', 'KA'], minPerLanguage: 2 }));

  assert.equal(assessment.verdict, 'COVERED');
  assert.deepEqual(Object.keys(assessment.deliverableByLanguage), ['ka']);
  assert.deepEqual(assessment.gaps, []);
});

/* ────────────────────────────────────────────────────────────────────────
 * The ways a caller could accidentally cancel a sweep
 * ──────────────────────────────────────────────────────────────────────── */

test('no city is a MARKET gap, because the store is queried by city', () => {
  const store = [held('ka'), held('ka'), held('ka'), held('ru'), held('ru'), held('ru')];
  const assessment = assessCoverage(store, request({ city: null }));

  assert.equal(assessment.verdict, 'PARTIAL', 'the language floors are met; the city is not');
  const market = assessment.gaps.find((gap) => gap.dimension === 'MARKET');
  assert.ok(market, 'a campaign with no city must not be reported as covered');
  assert.match(market.reason, /unnormalised/);
  assert.equal(decideSweep(assessment).sweep, true);
});

test('no requested languages is a gap, not vacuous coverage', () => {
  const assessment = assessCoverage([held('ka'), held('ru')], request({ languages: [] }));

  assert.equal(assessment.verdict, 'UNCOVERED');
  assert.equal(assessment.gaps.length, 1);
  assert.equal(assessment.gaps[0].dimension, 'MARKET');
  assert.equal(decideSweep(assessment).sweep, true);
});

test('a zero or negative floor is raised to one, so a sweep cannot be cancelled by arithmetic', () => {
  for (const minPerLanguage of [0, -5, 0.4, Number.NaN]) {
    const assessment = assessCoverage([], request({ minPerLanguage }));
    assert.equal(
      assessment.verdict,
      'UNCOVERED',
      `minPerLanguage ${minPerLanguage} must not make an empty store covered`,
    );
    assert.equal(assessment.gaps[0].want, 1);
  }
});

test('a market-only gap still sweeps, with an empty language scope', () => {
  // Every language floor met, city missing. The caller must read this as
  // "sweep, unscoped" -- and the sweep flag, not the language list, is what says so.
  const store = [held('ka'), held('ru')];
  const decision = decideSweep(
    assessCoverage(store, request({ city: null, minPerLanguage: 1 })),
  );

  assert.equal(decision.sweep, true);
  assert.deepEqual(decision.languages, []);
});

/* ────────────────────────────────────────────────────────────────────────
 * The decision has to be explainable after the fact
 * ──────────────────────────────────────────────────────────────────────── */

test('a skipped sweep carries a rationale naming the city and the floor', () => {
  const store = [held('ka'), held('ka'), held('ru'), held('ru')];
  const decision = decideSweep(assessCoverage(store, request({ minPerLanguage: 2 })));

  assert.equal(decision.sweep, false);
  assert.match(decision.reason, /Tbilisi/);
  assert.match(decision.reason, /at least 2 deliverable item\(s\)/);
  assert.match(decision.reason, /no external discovery is warranted/);
});

test('no rationale claims a percentage or a verification that did not happen', () => {
  const store = [
    held('ka', { lastVerifiedAt: null, firstSeenAt: iso(1 * DAY), validationState: 'UNVERIFIED' }),
    held('ru', { validationState: 'UNVERIFIABLE', lastVerifiedAt: null, failedChecks: 2 }),
  ];
  const assessment = assessCoverage(store, request({ minPerLanguage: 1 }));

  assert.doesNotMatch(assessment.rationale, /%/);
  assert.doesNotMatch(
    assessment.rationale,
    /\bverified\b/,
    'coverage counts deliverable evidence, and a first sighting is not a verification',
  );
});

/* ────────────────────────────────────────────────────────────────────────
 * The module spends nothing
 * ──────────────────────────────────────────────────────────────────────── */

test('assessCoverage is pure: same inputs, same answer, no clock of its own', () => {
  const store = [held('ka'), held('ru'), held('ru')];
  const req = request({ minPerLanguage: 2 });

  const a = assessCoverage(store, req);
  const b = assessCoverage(store, req);
  assert.deepEqual(a, b);

  // And it does not read the wall clock when `now` is given: a record verified
  // one day before NOW is deliverable, and would not be if Date.now() leaked in
  // with NOW far in the past.
  const past = assessCoverage(store, { ...req, now: Date.parse('2027-01-01T00:00:00.000Z') });
  assert.equal(past.verdict, 'UNCOVERED', 'moving `now` forward must move the verdict');
});

/* ────────────────────────────────────────────────────────────────────────
 * The city is not a string, and this is measured production behaviour
 *
 * supply_observations on 2026-09-26 held one city under three spellings:
 * 'Tbilisi' (11 rows), 'თბილისი' (8), 'tbilisi' (1) -- and Batumi likewise as
 * 'Batumi', 'Батуми', 'batumi'. A gate comparing bytes would have counted 11 of
 * 20 Tbilisi rows and then swept for the rest it already had.
 * ──────────────────────────────────────────────────────────────────────── */

test('a Georgian city spelling counts toward a Latin-spelled request', () => {
  const store = [
    held('ka', {}, 'თბილისი'),
    held('ka', {}, 'tbilisi'),
    held('ka', {}, 'Tbilisi'),
  ];
  const assessment = assessCoverage(store, request({ languages: ['ka'], minPerLanguage: 3 }));

  assert.equal(
    assessment.verdict,
    'COVERED',
    'three spellings of one city are three rows for that city, not one',
  );
  assert.equal(assessment.deliverableByLanguage.ka, 3);
  assert.equal(assessment.uncounted.wrongCity, 0);
});

test('a genuinely different city does not count, and is reported as such', () => {
  const store = [held('ka', {}, 'Batumi'), held('ka', {}, 'ქუთაისი')];
  const assessment = assessCoverage(store, request({ languages: ['ka'], minPerLanguage: 1 }));

  assert.equal(assessment.verdict, 'UNCOVERED');
  assert.equal(assessment.uncounted.wrongCity, 2);
  assert.match(assessment.rationale, /2 for another city/);
});

test('a city that cannot be compared across scripts is not counted as coverage', () => {
  // Not in the PLACES table and a different script from the request: comparePlaces
  // returns UNKNOWN, and UNKNOWN must never be read as agreement.
  const store = [held('ka', {}, 'ზესტაფონი'), held('ka', {}, 'ზესტაფონი')];
  const assessment = assessCoverage(store, request({ city: 'Zestafoni', languages: ['ka'], minPerLanguage: 1 }));

  assert.equal(assessment.verdict, 'UNCOVERED');
  assert.equal(
    assessment.uncounted.unplaceableCity,
    2,
    'an unmade comparison must not skip a sweep',
  );
  assert.match(assessment.rationale, /could not be compared across scripts/);
});

test('a row with no city is not counted when the campaign names one', () => {
  const store = [held('ka', {}, null), held('ka', {}, '')];
  const assessment = assessCoverage(store, request({ languages: ['ka'], minPerLanguage: 1 }));

  assert.equal(assessment.verdict, 'UNCOVERED');
  assert.equal(assessment.uncounted.unplaceableCity, 2);
});

/* ────────────────────────────────────────────────────────────────────────
 * The language nobody recorded, which is the MAJORITY of production rows
 * ──────────────────────────────────────────────────────────────────────── */

test('rows with no detected language are reported, not silently dropped', () => {
  // 22 of 32 production supply_observations rows had detected_language NULL on
  // 2026-09-26. The gate must say so, or it looks broken rather than starved.
  const store = [held(null), held(null), held(null), held('ka')];
  const assessment = assessCoverage(store, request({ languages: ['ka'], minPerLanguage: 3 }));

  assert.equal(assessment.verdict, 'PARTIAL');
  assert.equal(assessment.deliverableByLanguage.ka, 1);
  assert.equal(assessment.uncounted.unknownLanguage, 3);
  assert.match(assessment.rationale, /3 with no recorded language/);
});

test('an unrecorded language never satisfies a requested one', () => {
  const store = [held(null), held(null), held(null), held(null), held(null)];
  const assessment = assessCoverage(store, request({ languages: ['ka'], minPerLanguage: 1 }));

  assert.equal(
    assessment.verdict,
    'UNCOVERED',
    'guessing that an unlabelled row is Georgian would skip the sweep on an assumption',
  );
  assert.equal(decideSweep(assessment).sweep, true);
});

test('with no requested city, the place comparison is skipped rather than failing everything', () => {
  // city: null already produces a MARKET gap. It must not ALSO discard every row
  // as unplaceable -- that would report the store as empty when it is not.
  const store = [held('ka', {}, 'Tbilisi'), held('ka', {}, 'Batumi')];
  const assessment = assessCoverage(store, request({ city: null, languages: ['ka'], minPerLanguage: 1 }));

  assert.equal(assessment.deliverableByLanguage.ka, 2);
  assert.equal(assessment.uncounted.wrongCity, 0);
  assert.equal(assessment.uncounted.unplaceableCity, 0);
  assert.equal(assessment.verdict, 'PARTIAL', 'covered on language, gapped on the missing city');
  assert.equal(decideSweep(assessment).sweep, true);
});

/* ────────────────────────────────────────────────────────────────────────
 * OBSERVATION FRESHNESS IS NOT PUBLICATION AGE
 *
 * The finding that produced this section, measured in production 2026-09-26.
 * The first live Telegram sync stored seven real posts from @tbilisikvartiri:
 *
 *   tbilisikvartiri/5   published 2022-10-08   1449 days old   SUPPLY
 *   tbilisikvartiri/16  published 2022-10-08   1449 days old   SUPPLY
 *   tbilisikvartiri/20  published 2022-11-27   1399 days old   SUPPLY
 *
 * A second sync re-read them, the fingerprints matched, and TOUCH set
 * validation_state VALID with last_verified_at = now. judgeDelivery() then called
 * all seven FRESH and deliverable -- correctly, on its own terms: the OBSERVATION
 * was minutes old.
 *
 * But "the post is still on the channel" is not "the flat is still available". A
 * 32-room hotel advertised in 2022 counted as coverage would stop a campaign
 * paying to find out what is for sale now, on the strength of an archive.
 * ──────────────────────────────────────────────────────────────────────── */

const YEAR = 365 * DAY;

test('a post we verified today but published in 2022 is deliverable', () => {
  // The premise, stated so nothing below reads as a complaint about
  // judgeDelivery: it is behaving exactly as designed.
  const decision = judgeDelivery(
    freshness({ lastVerifiedAt: iso(0), validationState: 'VALID' }),
    { now: NOW },
  );
  assert.equal(decision.verdict, 'FRESH');
  assert.equal(decision.deliverable, true);
});

test('without a ceiling, publication age is not considered at all', () => {
  // Omitting maxPublishedAgeMs must preserve the previous behaviour exactly. A
  // silent new rule would change every existing caller's answer.
  const store = [
    held('ka', {}, 'Tbilisi', '2022-10-08T00:00:00.000Z'),
    held('ru', {}, 'Tbilisi', '2022-11-27T00:00:00.000Z'),
  ];
  const assessment = assessCoverage(store, request({ minPerLanguage: 1 }));

  assert.equal(assessment.verdict, 'COVERED');
  assert.equal(assessment.uncounted.publishedTooLongAgo, 0);
});

test('with a ceiling, the 2022 archive is not coverage', () => {
  const store = [
    held('ka', {}, 'Tbilisi', '2022-10-08T00:00:00.000Z'),
    held('ka', {}, 'Tbilisi', '2022-10-08T00:00:00.000Z'),
    held('ka', {}, 'Tbilisi', '2022-11-27T00:00:00.000Z'),
    held('ru', {}, 'Tbilisi', '2022-10-11T00:00:00.000Z'),
  ];
  const assessment = assessCoverage(
    store,
    request({ minPerLanguage: 1, maxPublishedAgeMs: 90 * DAY }),
  );

  assert.equal(
    assessment.verdict,
    'UNCOVERED',
    'four archived posts must not suppress a sweep for current listings',
  );
  assert.equal(assessment.uncounted.publishedTooLongAgo, 4);
  assert.match(assessment.rationale, /4 published too long ago to be worth showing/);
  assert.equal(decideSweep(assessment).sweep, true);
});

test('a row with no stated publication date is never excluded by age', () => {
  // Absence of a date is not evidence of age. Excluding these would discard most
  // of what some sources publish on the strength of a guess -- and production
  // holds plenty: detected_language and published_at are both often null.
  const store = [held('ka', {}, 'Tbilisi', null), held('ru', {}, 'Tbilisi', undefined)];
  const assessment = assessCoverage(
    store,
    request({ minPerLanguage: 1, maxPublishedAgeMs: 30 * DAY }),
  );

  assert.equal(assessment.verdict, 'COVERED');
  assert.equal(assessment.uncounted.publishedTooLongAgo, 0);
});

test('an unparseable publication date is not excluded either', () => {
  const store = [held('ka', {}, 'Tbilisi', 'sometime last spring')];
  const assessment = assessCoverage(
    store,
    request({ languages: ['ka'], minPerLanguage: 1, maxPublishedAgeMs: 30 * DAY }),
  );
  assert.equal(assessment.uncounted.publishedTooLongAgo, 0);
  assert.equal(assessment.deliverableByLanguage.ka, 1);
});

test('the ceiling is a market judgement, not a constant', () => {
  // A rental posted three months ago is gone; land advertised two years ago may
  // well still be for sale. Same row, two ceilings, two honest answers.
  const store = [held('ka', {}, 'Tbilisi', iso(200 * DAY))];
  const base = request({ languages: ['ka'], minPerLanguage: 1 });

  assert.equal(
    assessCoverage(store, { ...base, maxPublishedAgeMs: 90 * DAY }).verdict,
    'UNCOVERED',
  );
  assert.equal(
    assessCoverage(store, { ...base, maxPublishedAgeMs: 2 * YEAR }).verdict,
    'COVERED',
  );
});

test('a recent publication still counts, so the gate is not simply off', () => {
  const store = [
    held('ka', {}, 'Tbilisi', iso(3 * DAY)),
    held('ru', {}, 'Tbilisi', iso(1 * DAY)),
  ];
  const assessment = assessCoverage(
    store,
    request({ minPerLanguage: 1, maxPublishedAgeMs: 30 * DAY }),
  );
  assert.equal(assessment.verdict, 'COVERED');
  assert.deepEqual(assessment.deliverableByLanguage, { ka: 1, ru: 1 });
});

test('age is checked after the city, so a wrong-city archive reports as wrong city', () => {
  // Each row is excluded for ONE reason: the first that applies. A Batumi post from
  // 2022 in a Tbilisi campaign is a wrong-city row, and reporting it as an age
  // problem would send an operator looking at the wrong thing.
  const store = [held('ka', {}, 'Batumi', '2022-10-08T00:00:00.000Z')];
  const assessment = assessCoverage(
    store,
    request({ languages: ['ka'], minPerLanguage: 1, maxPublishedAgeMs: 30 * DAY }),
  );
  assert.equal(assessment.uncounted.wrongCity, 1);
  assert.equal(assessment.uncounted.publishedTooLongAgo, 0);
});
