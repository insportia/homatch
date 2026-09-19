import { test } from 'node:test';
import assert from 'node:assert/strict';

import { severitySignals, weighVerdict } from '../severity.ts';

/*
 * THE VERDICT, BY WEIGHT.
 *
 * The fixture is the REAL stored Villion evidence, read out of production:
 * a registry-confirmed company, a matched unit, two verified positives, a
 * mortgage on the parent parcel that the extract does not extend to this unit,
 * a commissioning status no authority confirmed, and a pledge registered
 * against the company.
 */

const VILLION = {
  rights: {
    status: 'NOT_CONFIRMED',
    items: [
      'ერთეული 01.18.06.019.055.03.01.601-ის საკუთრების გარდა სხვა რეგისტრირებული უფლებების ზუსტი სტატუსი ვერ დადასტურდა.',
      'მშობელ ნაკვეთზე 01.18.06.019.055 რეგისტრირებულია იპოთეკა სააქციო საზოგადოება „საქართველოს ბანკის" სასარგებლოდ.',
    ],
  },
  company: {
    sourceBasis: 'REGISTRY_CONFIRMED',
    idCode: '404670272',
    liquidationRegistered: false,
    shareholdingConsistent: true,
    encumbrances: [{ kind: 'PLEDGE_LEASE', creditor: 'სს საქართველოს ბანკი' }],
    directors: [{ name: 'კობა კვანტალიანი' }, { name: 'ლევან ჩაჩუა' }],
  },
  snapshot: {
    cadastralCode: '01.18.06.019.055.03.01.601',
    constructionStatus:
      'ორივე ბლოკი ჩაბარებულად არის აღნიშნული. ეს აღწერა არ წარმოადგენს ოფიციალური ექსპლუატაციაში მიღების დამადასტურებელ მტკიცებულებას.',
  },
  highlights: [
    { sentiment: 'POSITIVE', headline: 'მცირე მასშტაბი და კარგი საერთო ინფრასტრუქტურა' },
    { sentiment: 'POSITIVE', headline: 'ახალგაზრდა, რეესტრში დადასტურებული კომპანია' },
    { sentiment: 'ATTENTION', headline: 'მშობელ ნაკვეთზე რეგისტრირებული იპოთეკა' },
  ],
};

test('the parent-parcel charge is moderate, not material', () => {
  /*
   * The extract says in its own words that it neither extends the parent
   * parcel's mortgage to this unit nor excludes it. Treating that as material
   * would condemn most new-build flats in the country, which are sold out of
   * exactly this arrangement. It is real, it is resolvable before signing, and
   * it is not a blocker.
   */
  const keys = severitySignals(VILLION);
  const parent = keys.find((s) => s.key === 'sev_parent_parcel_charge');
  assert.ok(parent, 'the parent-parcel charge must be recognised at all');
  assert.equal(parent.severity, 'MODERATE_CONCERN');
  assert.ok(
    !keys.some((s) => s.severity === 'MATERIAL_RISK'),
    'nothing here is a blocker'
  );
});

test('the real Villion evidence is balanced, not alarming', () => {
  // The live report opened as NEEDS_ATTENTION with these exact facts.
  const w = weighVerdict(severitySignals(VILLION));
  assert.ok(w.positive >= 4, `only ${w.positive} positives counted`);
  assert.equal(w.material, 0);
  assert.equal(w.label, 'BALANCED');
});

test('one material risk outweighs any number of positives', () => {
  /*
   * The failure this module must never cause. A restriction the registry
   * actually identified against THIS unit is a blocker whatever else is true.
   */
  const withRestriction = {
    ...VILLION,
    rights: { status: 'RESTRICTION_IDENTIFIED', items: VILLION.rights.items },
    highlights: Array.from({ length: 10 }, (_, i) => ({
      sentiment: 'POSITIVE', headline: `positive ${i}`,
    })),
  };
  const w = weighVerdict(severitySignals(withRestriction));
  assert.equal(w.material, 1);
  assert.ok(w.positive >= 10);
  assert.equal(w.label, 'NEEDS_ATTENTION', 'ten positives must not bury a blocker');
});

test('a company in liquidation is material however clean the rest looks', () => {
  const w = weighVerdict(severitySignals({
    ...VILLION,
    company: { ...VILLION.company, liquidationRegistered: true },
  }));
  assert.equal(w.label, 'NEEDS_ATTENTION');
});

test('an inconsistent shareholding is material', () => {
  const w = weighVerdict(severitySignals({
    ...VILLION,
    company: { ...VILLION.company, shareholdingConsistent: false },
  }));
  assert.equal(w.label, 'NEEDS_ATTENTION');
});

test('many positives and one routine confirmation stays positive', () => {
  /*
   * Section 9's own example: ten strong verified positives, two routine
   * confirmation items, no material blocker. This must not be alarming.
   */
  const clean = {
    rights: { status: 'NONE_FOUND_IN_CHECKED_SOURCE', items: [] },
    company: {
      sourceBasis: 'REGISTRY_CONFIRMED', idCode: '404670272',
      liquidationRegistered: false, shareholdingConsistent: true,
      encumbrances: [], directors: [{ name: 'A' }, { name: 'B' }],
    },
    snapshot: { cadastralCode: '01.18.06.019.055.03.01.601', constructionStatus: 'ჩაბარებულია' },
    highlights: Array.from({ length: 8 }, (_, i) => ({
      sentiment: 'POSITIVE', headline: `verified ${i}`,
    })),
  };
  const w = weighVerdict(severitySignals(clean));
  assert.equal(w.material, 0);
  assert.equal(w.moderate, 0);
  assert.ok(w.minor >= 1, 'the joint-signature advice is still recorded');
  assert.equal(w.label, 'POSITIVE', 'routine advice must not darken a clean report');
});

test('routine advice alone never moves the label', () => {
  // A report whose headline darkens because it offered good advice has taught
  // the reader to ignore its headline.
  const onlyMinor = weighVerdict([
    { key: 'sev_joint_signature', severity: 'MINOR_ROUTINE' },
    { key: 'sev_commissioning_check', severity: 'MINOR_ROUTINE' },
    { key: 'a', severity: 'POSITIVE' },
  ]);
  assert.equal(onlyMinor.label, 'POSITIVE');
});

test('moderate concerns lead only when they outweigh what was established', () => {
  const outweighed = weighVerdict([
    { key: 'm1', severity: 'MODERATE_CONCERN' },
    { key: 'm2', severity: 'MODERATE_CONCERN' },
    { key: 'p1', severity: 'POSITIVE' },
  ]);
  assert.equal(outweighed.label, 'NEEDS_ATTENTION', 'two concerns against one positive');

  const balanced = weighVerdict([
    { key: 'm1', severity: 'MODERATE_CONCERN' },
    ...Array.from({ length: 4 }, (_, i) => ({ key: `p${i}`, severity: 'POSITIVE' })),
  ]);
  assert.equal(balanced.label, 'BALANCED', 'one concern against four positives');
});

test('a thin crawl scores nothing at all', () => {
  /*
   * Coverage is not evidence. Nothing in severitySignals reads a listing
   * count, a source count or a query count — if it did, "we found little"
   * would become "this looks risky".
   */
  const sparse = severitySignals({ rights: null, company: null, snapshot: null, highlights: [] });
  assert.deepEqual(sparse, [], 'an empty run produces no weight in either direction');
  assert.equal(weighVerdict(sparse).label, 'BALANCED', 'and no verdict either way');
});
