// What the price comparison is actually comparing.
//
// Every fixture value here is a real string taken from production: the
// thirteen distinct condition spellings that 39 completed jobs put into
// research_jobs.result_json, across two scripts, for what are really five
// states. That is why nothing downstream could use the field — and why a
// report could tell a buyer their renovated flat carried a 28% premium over a
// median built from green-frame shells.
//
// In Georgia the fit-out state is most of the price. A black frame is bare
// concrete, a green frame has utilities to the door, a white frame is ready to
// decorate, a renovated flat you can move into, and the ends of that ladder
// are routinely thirty or forty per cent apart per square metre. A comparison
// that ignores it is not imprecise — it is confidently wrong.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONDITION_LADDER,
  conditionGrade,
  conditionDistance,
  conditionMix,
} from '../comparableCondition.ts';
import {
  buildMarketIntelligence,
  scoreComparable,
  sameProjectName,
} from '../marketIntelligence.ts';

/** Every distinct condition string 39 completed production jobs produced. */
const PRODUCTION_CONDITIONS = [
  ['green frame', 'GREEN_FRAME'],
  ['white frame', 'WHITE_FRAME'],
  ['ახალი გარემონტებული', 'NEWLY_RENOVATED'],
  ['ახალი რემონტი', 'NEWLY_RENOVATED'],
  ['ახალი რემონტით', 'NEWLY_RENOVATED'],
  ['დასრულებული', 'RENOVATED'],
  ['თეთრი კარკასი', 'WHITE_FRAME'],
  ['მწვანე კარკასი', 'GREEN_FRAME'],
  ['მწვანე კარკასი, დასრულებული რემონტით', 'RENOVATED'],
  ['პრემიუმ მწვანე კარკასი', 'GREEN_FRAME'],
  ['შავი კარკასი', 'BLACK_FRAME'],
  ['შავი/მწვანე კარკასი', 'BLACK_FRAME'],
  ['ძველი გარემონტებული', 'RENOVATED'],
];

const SUBJECT = {
  project: 'VILLION Krtsanisi Homes',
  address: 'თბილისი, კრწანისის ქუჩა 6',
  area: 94.1,
  currency: 'USD',
};

const comp = (over) => ({
  project: 'VILLION Krtsanisi Homes',
  address: 'კრწანისის ქუჩა 6',
  area: '94',
  pricePerSqm: '1800',
  currency: 'USD',
  comparableType: 'SAME_PROJECT',
  ...over,
});

/* ── the ladder ──────────────────────────────────────────────────────── */

test('every condition production has actually produced is understood', () => {
  for (const [raw, expected] of PRODUCTION_CONDITIONS) {
    assert.equal(conditionGrade(raw), expected, `"${raw}" was read as the wrong state`);
  }
});

test('a premium green frame is still a green frame', () => {
  // The adjective describes the building, not the rung. Reading it as
  // "finished" would put bare-ish stock into a renovated comparison.
  assert.equal(conditionGrade('პრემიუმ მწვანე კარკასი'), 'GREEN_FRAME');
});

test('a green frame WITH a finished renovation is a finished flat', () => {
  // The rung is what you can do with it, not how it started.
  assert.equal(conditionGrade('მწვანე კარკასი, დასრულებული რემონტით'), 'RENOVATED');
});

test('black-or-green is read as the lower rung', () => {
  // Offered as either, so the black frame is what a buyer is guaranteed.
  assert.equal(conditionGrade('შავი/მწვანე კარკასი'), 'BLACK_FRAME');
});

test('new work and old work are different rungs', () => {
  assert.equal(conditionGrade('ახალი გარემონტებული'), 'NEWLY_RENOVATED');
  assert.equal(conditionGrade('ძველი გარემონტებული'), 'RENOVATED');
});

test('an unstated condition is unknown, never a rung', () => {
  // Roughly a third of production comparables carry none. Reading our own
  // missing field as "bare" or as "finished" would both be inventions.
  for (const nothing of [null, undefined, '', '   ', 42, {}]) {
    assert.equal(conditionGrade(nothing), null, `${String(nothing)} was given a grade`);
  }
  assert.equal(conditionDistance('მწვანე კარკასი', null), null);
  assert.equal(conditionDistance(null, null), null);
});

test('the ladder is ordered bare to finished', () => {
  assert.deepEqual([...CONDITION_LADDER], [
    'BLACK_FRAME', 'GREEN_FRAME', 'WHITE_FRAME', 'RENOVATED', 'NEWLY_RENOVATED',
  ]);
  assert.equal(conditionDistance('შავი კარკასი', 'ახალი რემონტი'), 4);
  assert.equal(conditionDistance('მწვანე კარკასი', 'green frame'), 0);
  assert.equal(conditionDistance('მწვანე კარკასი', 'თეთრი კარკასი'), 1);
});

/* ── the mix ─────────────────────────────────────────────────────────── */

test('the mix counts what it knows and admits what it does not', () => {
  const m = conditionMix(['მწვანე კარკასი', 'green frame', null, 'თეთრი კარკასი']);
  assert.equal(m.grades.GREEN_FRAME, 2);
  assert.equal(m.grades.WHITE_FRAME, 1);
  assert.equal(m.unknown, 1);
  assert.equal(m.dominant, 'GREEN_FRAME');
});

test('a plurality is not a characterisation of a market', () => {
  // Two out of three known is a majority; one out of three is not.
  assert.equal(conditionMix(['შავი კარკასი', 'მწვანე კარკასი', 'თეთრი კარკასი']).dominant, null);
  assert.equal(conditionMix(['მწვანე კარკასი']).dominant, null, 'one listing described a market');
});

/* ── the comparison ──────────────────────────────────────────────────── */

test('condition weighs more than room count, because it is the product', () => {
  const same = scoreComparable({ ...SUBJECT, condition: 'მწვანე კარკასი' }, comp({ condition: 'green frame' }));
  const opposite = scoreComparable({ ...SUBJECT, condition: 'მწვანე კარკასი' }, comp({ condition: 'ახალი რემონტი' }));
  assert.ok(same.relevance > opposite.relevance, 'a matching condition did not rank higher');
  assert.ok(same.relevance - opposite.relevance >= 15,
    'the gap between bare and finished is being treated as a tie-breaker');
  assert.equal(same.condition, 'GREEN_FRAME');
});

test('a report says plainly when it is comparing different products', () => {
  const m = buildMarketIntelligence(
    { ...SUBJECT, condition: 'ახალი რემონტი', pricePerSqm: 2400 },
    [comp({ condition: 'მწვანე კარკასი' }), comp({ area: '90', pricePerSqm: '1820', condition: 'green frame' })]
  );
  assert.equal(m.subjectCondition, 'NEWLY_RENOVATED');
  assert.equal(m.conditionMix.dominant, 'GREEN_FRAME');
  assert.equal(m.conditionMismatch, true, 'a finished flat was compared to shells without saying so');
  // The number is still produced. What changes is that it cannot be read as a
  // verdict on its own.
  assert.ok(m.deltaFromMedianPct > 0);
});

test('a mismatch is never claimed when either side is unknown', () => {
  const noSubject = buildMarketIntelligence(SUBJECT, [comp({ condition: 'მწვანე კარკასი' }), comp({ area: '90', condition: 'green frame' })]);
  assert.equal(noSubject.conditionMismatch, false, 'a mismatch was claimed with no subject condition');
  const noComps = buildMarketIntelligence({ ...SUBJECT, condition: 'ახალი რემონტი' }, [comp({}), comp({ area: '90' })]);
  assert.equal(noComps.conditionMismatch, false, 'a mismatch was claimed against unlabelled comparables');
});

/* ── which listings count ────────────────────────────────────────────── */

test('a listing that came off the market is not today\'s market', () => {
  const m = buildMarketIntelligence(SUBJECT, [
    comp({ pricePerSqm: '1800', listingStatus: 'active' }),
    comp({ area: '90', pricePerSqm: '1820', listingStatus: 'active' }),
    comp({ area: '88', pricePerSqm: '1200', listingStatus: 'expired' }),
  ]);
  assert.equal(m.expiredExcluded, 1);
  assert.equal(m.count, 2);
  assert.equal(m.median, 1810, 'a withdrawn asking price still moved the median');
});

test('an unknown status is never treated as expired', () => {
  // Roughly a third of production comparables carry no status. Reading our
  // own missing field as "removed" is the absence rule broken in arithmetic.
  const m = buildMarketIntelligence(SUBJECT, [comp({ pricePerSqm: '1800' }), comp({ area: '90', pricePerSqm: '1820' })]);
  assert.equal(m.expiredExcluded, 0);
  assert.equal(m.count, 2);
});

test('when everything has expired, the old prices are better than nothing', () => {
  // A withdrawn asking price is still real information, and returning no
  // market section at all would tell the buyer less, not more.
  const m = buildMarketIntelligence(SUBJECT, [
    comp({ pricePerSqm: '1800', listingStatus: 'expired' }),
    comp({ area: '90', pricePerSqm: '1820', listingStatus: 'expired' }),
  ]);
  assert.ok(m, 'the market section vanished rather than degrading');
  assert.equal(m.count, 2);
  assert.equal(m.expiredExcluded, 0, 'listings that were kept were reported as excluded');
});

test('one flat posted twice gets one vote', () => {
  const m = buildMarketIntelligence(SUBJECT, [
    comp({ url: 'https://portal.ge/listing/1', pricePerSqm: '1800' }),
    comp({ url: 'https://PORTAL.ge/listing/1?utm_source=x', pricePerSqm: '1800' }),
    comp({ url: 'https://other.ge/2', area: '90', pricePerSqm: '1900' }),
  ]);
  assert.equal(m.duplicatesRemoved, 1);
  assert.equal(m.count, 2);
});

test('two genuinely different flats are never merged', () => {
  const m = buildMarketIntelligence(SUBJECT, [
    comp({ area: '94', pricePerSqm: '1800', floor: '6' }),
    comp({ area: '94', pricePerSqm: '1800', floor: '9' }),
  ]);
  assert.equal(m.duplicatesRemoved, 0, 'a different floor was treated as the same listing');
  assert.equal(m.count, 2);
});

/* ── project identity ────────────────────────────────────────────────── */

test('a development written in either script is one development', () => {
  // Georgian has no doubled consonants, so the Latin spelling doubles letters
  // the Georgian does not. Without handling that, a project fails to match
  // its own name.
  assert.equal(sameProjectName('VILLION Krtsanisi Homes', 'ვილიონ კრწანისი', 'კრწანისის ქუჩა 6'), true);
});

test('sharing a neighbourhood is not sharing a building', () => {
  // Tbilisi developments are routinely named after the district they stand
  // in. Caught by a real fixture: without this the same-project band swelled
  // from two listings to four and the median moved with it.
  const place = 'თბილისი, კრწანისის ქუჩა 6 კრწანისის ქუჩა 12';
  assert.equal(sameProjectName('VILLION Krtsanisi Homes', 'Krtsanisi Residence', place), false);
  assert.equal(sameProjectName('VILLION Krtsanisi Homes', 'Krtsanisi Park', place), false);
});

test('a generic word is never an identity', () => {
  assert.equal(sameProjectName('ბინა ვაკეში', 'ბინა საბურთალოზე', ''), false);
  assert.equal(sameProjectName('New Residence', 'Old Residence', ''), false);
});

test('a missing project name matches nothing', () => {
  assert.equal(sameProjectName(null, 'VILLION', ''), false);
  assert.equal(sameProjectName('VILLION', undefined, ''), false);
  assert.equal(sameProjectName('', '', ''), false);
});

/* ── the prose has to account for it ─────────────────────────────────── */

test('the model is told to say when the comparison is between different products', async () => {
  const { buildIntelligencePrompt } = await import('../prompt.ts');
  const { buildEvidencePackage } = await import('../evidencePackage.ts');
  const { system } = buildIntelligencePrompt(buildEvidencePackage({ entityName: 'x' }));
  assert.match(system, /CONDITION IS MOST OF THE PRICE/);
  assert.match(system, /If conditionMismatch is true/);
  assert.match(system, /Both are housekeeping, NOT findings: never report them/);
});

test('asking a normalised grade again returns the same grade', () => {
  // A ScoredComparable carries the grade, not the free text, so anything
  // downstream that normalises a second time must get the same answer.
  // Without this the condition mix read every known listing as unknown and a
  // real mismatch silently stopped being detectable.
  for (const g of CONDITION_LADDER) {
    assert.equal(conditionGrade(g), g, `${g} did not survive a second normalisation`);
  }
  assert.equal(conditionMix(['GREEN_FRAME', 'GREEN_FRAME', 'RENOVATED']).dominant, 'GREEN_FRAME');
});
