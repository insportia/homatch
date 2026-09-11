// Does the architecture force apartment assumptions onto everything else?
//
// Production evidence covers development apartments almost exclusively — the
// same building, two cadastral codes. That is the standing acceptance risk:
// a pipeline that works beautifully for a flat in a development, and quietly
// describes a field as having a lift.
//
// These fixtures are built from the REAL report contract — the field names
// and shapes taken from the persisted result_json of live jobs — and run
// through the REAL code at each boundary:
//
//   INPUT → resolveAssetClass()     the shipped classifier
//         → publicResearchScope()   the shipped research plan
//         → propertyTypeDisplay()   the shipped badge
//         → parcelRelation()        the shipped parcel/unit split
//
// No external evidence is fabricated: each fixture contains only what that
// kind of property would genuinely have, and the assertions are about what
// the system must NOT invent from it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAssetClass, publicResearchScope, PUBLIC_RESEARCH_TARGETS } from '../researchPlan.ts';
import { propertyTypeDisplay } from '../propertyType.ts';
import { parcelRelation, parentParcelCode } from '../cadastral.ts';

/* ------------------------------------------------------------------ *
 * Fixtures. Real contract shapes, one per archetype.                  *
 * ------------------------------------------------------------------ */

/** A. Development apartment — the shape production actually produces. */
const DEVELOPMENT_APARTMENT = {
  queryType: 'cadastral',
  assetClass: 'MIXED_OR_UNKNOWN', // what the model said on the live job
  entityType: 'მშენებარე საცხოვრებელი ბინა',
  exactUnit: { code: '01.18.06.019.055.03.01.601', verified: false, note: 'ზუსტი მიმდინარე სტატუსი საჯარო მტკიცებულებით ვერ დადასტურდა.' },
  identifiedParent: { code: null, name: 'საკადასტრო კოდი 01.18.06.019.055' },
  projectProfile: { name: 'Villion', developer: 'Millenio Group', website: 'https://example.invalid', floors: '8', unitCounts: '42' },
  companyProfile: { name: 'შპს „მილენიო გრუპი“', idCode: '404670272', sourceBasis: 'REGISTRY_CONFIRMED', directors: ['კობა კვანტალიანი', 'ლევან ჩაჩუა'], representation: 'JOINT' },
  landProfile: null,
};

/** B. Resale apartment — a unit with no development behind it. */
const RESALE_APARTMENT = {
  queryType: 'cadastral',
  assetClass: 'PRIVATE_RESALE',
  entityType: 'საცხოვრებელი ბინა',
  exactUnit: { code: '01.14.02.011.033.02.01.014', verified: true, note: null },
  identifiedParent: { code: null, name: null },
  projectProfile: null,
  companyProfile: null,
  landProfile: null,
};

/** C. Land parcel — a bare five-group cadastral code, nothing built. */
const LAND_PARCEL = {
  queryType: 'cadastral',
  assetClass: 'LAND',
  entityType: 'მიწის ნაკვეთი',
  exactUnit: { code: '01.19.30.004.128', verified: true, note: null },
  identifiedParent: { code: null, name: null },
  projectProfile: null,
  companyProfile: null,
  landProfile: { area: '1,240 კვ.მ', designation: 'არასასოფლო სამეურნეო' },
};

/** D. Private house — a building the owner had built on their own parcel. */
const PRIVATE_HOUSE = {
  queryType: 'cadastral',
  assetClass: 'PRIVATE_HOUSE',
  entityType: 'საცხოვრებელი სახლი',
  exactUnit: { code: '01.15.07.022.019.01.500', verified: true, note: null },
  identifiedParent: { code: '01.15.07.022.019', name: null },
  projectProfile: null,
  companyProfile: null,
  landProfile: { area: '480 კვ.მ', designation: 'არასასოფლო სამეურნეო' },
};

/** E. Commercial property — a ground-floor retail unit. */
const COMMERCIAL = {
  queryType: 'cadastral',
  assetClass: 'COMMERCIAL',
  entityType: 'კომერციული ფართი',
  exactUnit: { code: '01.17.05.030.012.01.01.002', verified: false, note: null },
  identifiedParent: { code: null, name: null },
  projectProfile: null,
  companyProfile: { name: 'შპს X', idCode: '400123456', sourceBasis: 'REGISTRY_CONFIRMED' },
  landProfile: null,
};

/** F. Genuinely unclear — a code and nothing that resolves it. */
const UNKNOWN_PROPERTY = {
  queryType: 'cadastral',
  assetClass: null,
  entityType: 'საკადასტრო იდენტიფიკატორი',
  exactUnit: { code: '01.11.11.111.111.01.01.111', verified: false, note: null },
  identifiedParent: { code: null, name: null },
  projectProfile: null,
  companyProfile: null,
  landProfile: null,
};

const ALL = [
  ['development apartment', DEVELOPMENT_APARTMENT],
  ['resale apartment', RESALE_APARTMENT],
  ['land parcel', LAND_PARCEL],
  ['private house', PRIVATE_HOUSE],
  ['commercial', COMMERCIAL],
  ['unknown', UNKNOWN_PROPERTY],
];

const BUILDING_FABRIC = ['facade', 'windows', 'elevators', 'structural system', 'insulation', 'MEP (mechanical/electrical/plumbing)', 'energy efficiency', 'seismic design'];
const DEVELOPER_RESEARCH = ['founders owners participants', 'directors representatives', 'company history', 'previous projects', 'bank financing', 'partners'];
const CONSTRUCTION_TEAM = ['architect', 'architecture studio', 'contractors', 'construction companies', 'engineers', 'suppliers'];

/* ------------------------------------------------------------------ *
 * A. Development apartment — may legitimately have all of it.         *
 * ------------------------------------------------------------------ */

test('A. a development apartment is classified from its own evidence', () => {
  // The model said MIXED_OR_UNKNOWN; a named project, a developer behind it
  // and an identified unit inside it say otherwise.
  assert.equal(resolveAssetClass(DEVELOPMENT_APARTMENT), 'APARTMENT_IN_PROJECT');
});

test('A. a development apartment gets the full research plan', () => {
  const { targets } = publicResearchScope('APARTMENT_IN_PROJECT');
  assert.deepEqual(targets, PUBLIC_RESEARCH_TARGETS);
  for (const t of [...DEVELOPER_RESEARCH, ...CONSTRUCTION_TEAM, ...BUILDING_FABRIC]) {
    assert.ok(targets.includes(t), `${t} is not researched for a development apartment`);
  }
});

test('A. the parcel beneath the flat is a separate thing from the flat', () => {
  const rel = parcelRelation(DEVELOPMENT_APARTMENT);
  assert.equal(rel.unitCode, '01.18.06.019.055.03.01.601');
  assert.equal(rel.parcelCode, '01.18.06.019.055');
  assert.equal(rel.differs, true);
  assert.equal(rel.unitVerified, false);
});

/* ------------------------------------------------------------------ *
 * B. Resale apartment — no developer may be invented.                 *
 * ------------------------------------------------------------------ */

test('B. a resale apartment is never upgraded into a development project', () => {
  assert.equal(resolveAssetClass(RESALE_APARTMENT), 'PRIVATE_RESALE');
});

test('B. a resale apartment is not sent looking for a developer it does not have', () => {
  const { targets, scopeNote } = publicResearchScope('PRIVATE_RESALE');
  for (const t of [...DEVELOPER_RESEARCH, ...CONSTRUCTION_TEAM]) {
    assert.ok(!targets.includes(t), `${t} is still researched for a private resale`);
  }
  for (const t of BUILDING_FABRIC) {
    assert.ok(!targets.includes(t), `${t} is still researched for a private resale`);
  }
  assert.ok(/no forced developer research/i.test(scopeNote), 'the plan does not say why it is narrower');
  assert.ok(/never invent/i.test(scopeNote), 'nothing forbids filling the empty fields with a guess');
});

test('B. an empty developer field on a resale is the correct outcome, not a gap', () => {
  const { scopeNote } = publicResearchScope('PRIVATE_RESALE');
  assert.ok(/normal and CORRECT/i.test(scopeNote) || /entirely normal/i.test(scopeNote),
    'an absent developer is not stated to be the expected result');
});

/* ------------------------------------------------------------------ *
 * C. Land — no building semantics at all.                             *
 * ------------------------------------------------------------------ */

test('C. a bare parcel is classified as land, not as a unit', () => {
  assert.equal(resolveAssetClass(LAND_PARCEL), 'LAND');
});

test('C. land is never given a parent parcel it does not have', () => {
  // Five groups IS the parcel. Inventing a parent for it would be inventing
  // a hierarchy that does not exist.
  assert.equal(parentParcelCode('01.19.30.004.128'), null);
  const rel = parcelRelation(LAND_PARCEL);
  assert.equal(rel.parcelCode, null);
  assert.equal(rel.differs, false, 'a bare parcel was split into parcel and unit');
});

test('C. no building-fabric research is planned for a parcel with no building', () => {
  const { targets, scopeNote } = publicResearchScope('LAND');
  for (const t of [...BUILDING_FABRIC, 'amenities', 'landscaping', 'parking', 'construction materials']) {
    assert.ok(!targets.includes(t), `${t} is researched for a bare land parcel`);
  }
  assert.ok(/do not apply/i.test(scopeNote), 'nothing states that building fabric is inapplicable');
  assert.ok(/never invent one/i.test(scopeNote), 'a developer may still be invented for a parcel');
});

test('C. land keeps the research that genuinely applies to it', () => {
  const { targets } = publicResearchScope('LAND');
  // A parcel someone has publicly announced plans for is worth knowing about.
  assert.ok(targets.includes('previous projects'));
  assert.ok(targets.includes('current physical status'));
  assert.ok(targets.includes('court records'), 'disputes over land are not researched');
});

/* ------------------------------------------------------------------ *
 * D. Private house — land and building, no project semantics.         *
 * ------------------------------------------------------------------ */

test('D. a private house is not turned into an apartment in a project', () => {
  assert.equal(resolveAssetClass(PRIVATE_HOUSE), 'PRIVATE_HOUSE');
});

test('D. a house sits on its parcel, and the two are distinguished', () => {
  const rel = parcelRelation(PRIVATE_HOUSE);
  assert.equal(rel.unitCode, '01.15.07.022.019.01.500');
  assert.equal(rel.parcelCode, '01.15.07.022.019');
  assert.equal(rel.differs, true, 'the house and its land were treated as one thing');
});

test('D. a house is not sent through developer or project research', () => {
  const { targets, scopeNote } = publicResearchScope('PRIVATE_HOUSE');
  for (const t of DEVELOPER_RESEARCH) {
    assert.ok(!targets.includes(t), `${t} is researched for a standalone house`);
  }
  assert.ok(/standalone private house/i.test(scopeNote));
  assert.ok(/not a unit in a marketed development/i.test(scopeNote));
});

test('D. a house and a resale flat do not get the same plan', () => {
  // Different property, different questions — otherwise the classification is
  // decorative.
  const house = publicResearchScope('PRIVATE_HOUSE');
  const resale = publicResearchScope('PRIVATE_RESALE');
  assert.notDeepEqual(house.targets, resale.targets);
  assert.notEqual(house.scopeNote, resale.scopeNote);
});

/* ------------------------------------------------------------------ *
 * E. Commercial — no residential assumptions.                         *
 * ------------------------------------------------------------------ */

test('E. commercial property keeps its own classification', () => {
  assert.equal(resolveAssetClass(COMMERCIAL), 'COMMERCIAL');
});

test('E. commercial findings are framed commercially, not residentially', () => {
  const { targets, scopeNote } = publicResearchScope('COMMERCIAL');
  // The building itself still matters for a commercial unit.
  for (const t of BUILDING_FABRIC) assert.ok(targets.includes(t), `${t} is not researched for commercial`);
  assert.ok(/commercial terms/i.test(scopeNote), 'nothing reframes the findings commercially');
  assert.ok(/tenant|business-facing/i.test(scopeNote), 'the commercial framing names no commercial concern');
  assert.ok(/rather than residential/i.test(scopeNote), 'residential framing is not explicitly displaced');
});

test('E. the commercial badge is not a residential label', () => {
  const d = propertyTypeDisplay(COMMERCIAL);
  assert.deepEqual(d, { kind: 'LABEL', labelKey: 'verify_asset_commercial' });
});

/* ------------------------------------------------------------------ *
 * F. Unknown — useful without guessing.                               *
 * ------------------------------------------------------------------ */

test('F. an unresolvable property stays unknown rather than being guessed', () => {
  // A cadastral code and nothing else. NO EVIDENCE = NO FACT.
  assert.equal(resolveAssetClass(UNKNOWN_PROPERTY), 'MIXED_OR_UNKNOWN');
});

test('F. weak text that merely resembles a project does not upgrade the class', () => {
  // A project NAME with nobody behind it, and no unit — the three-part
  // requirement is what stops a passing mention becoming a classification.
  const nameOnly = { ...UNKNOWN_PROPERTY, projectProfile: { name: 'Some Residence' } };
  assert.equal(resolveAssetClass(nameOnly), 'MIXED_OR_UNKNOWN');

  const nameAndDeveloperButNoUnit = {
    ...UNKNOWN_PROPERTY,
    exactUnit: null,
    projectProfile: { name: 'Some Residence', developer: 'Some Dev' },
  };
  assert.equal(resolveAssetClass(nameAndDeveloperButNoUnit), 'MIXED_OR_UNKNOWN');
});

test('F. an unknown class is researched at FULL breadth, never narrowed on a guess', () => {
  const { targets, scopeNote } = publicResearchScope('MIXED_OR_UNKNOWN');
  assert.deepEqual(targets, PUBLIC_RESEARCH_TARGETS, 'evidence is dropped when the class is unclear');
  assert.equal(scopeNote, '', 'an unclear class carries a narrowing instruction');
});

test('F. an unknown class shows no property-type label rather than a false one', () => {
  // entityType here is "საკადასტრო იდენტიფიკატორი" — the customer's own input
  // handed back to them.
  assert.deepEqual(propertyTypeDisplay(UNKNOWN_PROPERTY), { kind: 'NONE' });
});

/* ------------------------------------------------------------------ *
 * Cross-archetype invariants.                                         *
 * ------------------------------------------------------------------ */

test('a committed classification is never overridden by the repair', () => {
  // The repair exists to fill in an unknown, not to second-guess the model.
  for (const cls of ['PRIVATE_RESALE', 'PRIVATE_HOUSE', 'LAND', 'COMMERCIAL', 'RENTAL', 'COMPANY_OWNED', 'UNDER_CONSTRUCTION']) {
    const withProjectEvidence = { ...DEVELOPMENT_APARTMENT, assetClass: cls };
    assert.equal(resolveAssetClass(withProjectEvidence), cls, `${cls} was overridden into an apartment`);
  }
});

test('every archetype produces a distinct, non-apartment-centric plan', () => {
  const plans = new Map();
  for (const cls of ['APARTMENT_IN_PROJECT', 'PRIVATE_RESALE', 'PRIVATE_HOUSE', 'LAND', 'COMMERCIAL']) {
    plans.set(cls, publicResearchScope(cls));
  }
  // The three that must be narrower than the default really are.
  for (const cls of ['PRIVATE_RESALE', 'PRIVATE_HOUSE', 'LAND']) {
    assert.ok(
      plans.get(cls).targets.length < plans.get('APARTMENT_IN_PROJECT').targets.length,
      `${cls} is researched as broadly as a development apartment`
    );
  }
  // And they are not the same plan wearing different labels.
  const signatures = new Set([...plans.values()].map((p) => p.targets.join('|')));
  assert.ok(signatures.size >= 4, 'the archetypes collapse onto too few distinct research plans');
});

test('every archetype survives the classifier without throwing', () => {
  for (const [name, fixture] of ALL) {
    assert.doesNotThrow(() => resolveAssetClass(fixture), `${name} threw`);
    assert.doesNotThrow(() => propertyTypeDisplay(fixture), `${name} threw in presentation`);
    assert.doesNotThrow(() => parcelRelation(fixture), `${name} threw in parcel relation`);
  }
  for (const junk of [null, undefined, {}, 'nope', 42, []]) {
    assert.equal(resolveAssetClass(junk), 'MIXED_OR_UNKNOWN');
  }
});

test('an unverified exact unit is never reported as verified, in any archetype', () => {
  for (const [name, fixture] of ALL) {
    const rel = parcelRelation(fixture);
    assert.equal(rel.unitVerified, fixture.exactUnit?.verified === true, `${name} misreports unit verification`);
  }
});
