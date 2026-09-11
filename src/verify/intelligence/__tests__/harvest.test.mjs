// What a finished verification is allowed to teach the graph.
//
// The report fixture below is a real one, copied from a completed production
// job (cadastral 01.72.14.040.030.01.02.017), because the interesting cases
// here are not hypothetical — that report contains, simultaneously:
//
//   a unit whose link to its project is explicitly NOT verified
//   four registry checks that established nothing
//   two that established something
//   a named parent parcel that is genuinely the code's own prefix
//   a company identified by a real registration code
//
// which is exactly the set of judgements this module has to get right.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  harvestReport,
  normalizeCadastral,
  normalizeCompanyId,
  projectSlug,
  parentParcelOf,
} from '../harvest.ts';

const POLICIES = [
  { fact_key_pattern: 'registry.', freshness_class: 'HIGH_VOLATILITY', max_age_hours: 6 },
  { fact_key_pattern: 'company.status', freshness_class: 'MEDIUM_VOLATILITY', max_age_hours: 720 },
  { fact_key_pattern: 'project.identity', freshness_class: 'LOW_VOLATILITY', max_age_hours: 8760 },
  { fact_key_pattern: 'building.', freshness_class: 'LOW_VOLATILITY', max_age_hours: 8760 },
  { fact_key_pattern: 'parcel.', freshness_class: 'LOW_VOLATILITY', max_age_hours: 8760 },
];

/** Trimmed from a real completed job, with the shapes preserved exactly. */
const REAL_REPORT = {
  exactUnit: {
    code: '01.72.14.040.030.01.02.017',
    note: 'კონკრეტული ერთეულის დანიშნულება, ფართობი, სართული, მესაკუთრე და ამ პროექტთან პირდაპირი კავშირი დადასტურებული არ არის.',
    verified: false,
  },
  identifiedParent: {
    code: '01.72.14.040.030',
    name: 'მიწის ნაკვეთი, კრისტიან სტივენის ქუჩა №18, თბილისი',
    confidence: 'MEDIUM',
  },
  legalStatus: {
    commissioning: { status: 'NOT_CONFIRMED', label: 'ექსპლუატაციაში მიღება' },
    debtorRegistry: { status: 'CONFIRMED_POSITIVE', label: 'მოვალეთა რეესტრი' },
    taxpayerStatus: { status: 'NOT_CONFIRMED', label: 'გადასახადის გადამხდელის სტატუსი' },
    companyRegistration: { status: 'CONFIRMED_POSITIVE', label: 'კომპანიის რეგისტრაცია' },
    propertyEncumbrances: { status: 'NOT_CONFIRMED', label: 'საკუთრების შეზღუდვები/ტვირთები' },
    constructionPermissions: { status: 'NOT_CONFIRMED', label: 'მშენებლობის ნებართვები' },
  },
  companyProfile: {
    name: 'შპს „ჯეო სითი დიღომი“',
    idCode: '424619256',
    status: null,
    legalForm: 'შპს',
    sourceBasis: 'REGISTRY_CONFIRMED',
    directors: [],
    registrationDate: null,
  },
  projectProfile: {
    name: 'კრისტიან სტივენის ქუჩა №18',
    floors: '7',
    buildings: '1',
    unitCounts: '48 ბინა',
    address: 'თბილისი, სოფელი დიღომი, კრისტიან სტივენის ქუჩა №18',
    aliases: ['Geo City Digomi', 'ჯეო სითი დიღომი', 'Kristian Stiven St, 18'],
    amenities: ['ლიფტი', 'მიწისზედა პარკინგი'],
    developer: 'ჯეო სითი დიღომი',
    developerCompany: 'შპს „ჯეო სითი დიღომი“ (საიდენტიფიკაციო კოდი 424619256)',
    website: null,
    architect: null,
  },
};

const harvest = (over = {}) => harvestReport({ ...REAL_REPORT, ...over }, POLICIES);
const factFor = (h, key) => h.facts.find((f) => f.factKey === key);
const relFor = (h, relation) => h.relationships.find((r) => r.relation === relation);

/* ── identity ────────────────────────────────────────────────────────── */

test('a cadastral code is normalised so one flat is one entity', () => {
  assert.equal(normalizeCadastral(' 01.72.14.040.030.01.02.017 '), '01.72.14.040.030.01.02.017');
  assert.equal(normalizeCadastral('01.72.14.040. 030'), '01.72.14.040.030');
  assert.equal(normalizeCadastral('not a code'), null);
  assert.equal(normalizeCadastral('01.72.14'), null, 'a fragment was accepted as a parcel');
});

test('five groups is a parcel, more is a unit inside one', () => {
  assert.equal(parentParcelOf('01.72.14.040.030.01.02.017'), '01.72.14.040.030');
  assert.equal(parentParcelOf('01.72.14.040.030'), null, 'a parcel was given a parent');
});

test('a company id is nine digits or it is not a company id', () => {
  assert.equal(normalizeCompanyId('424619256'), '424619256');
  assert.equal(normalizeCompanyId('ს/კ 424619256'), '424619256');
  assert.equal(normalizeCompanyId('12345'), null);
  assert.equal(normalizeCompanyId('40467027212345'), null);
});

test('a project name too short to be a name gets no slug', () => {
  assert.equal(projectSlug('Villion Krtsanisi Homes'), 'villion-krtsanisi-homes');
  assert.equal(projectSlug('  '), null);
  assert.equal(projectSlug('A'), null);
});

test('the unit, its parcel, the company and the project all become entities', () => {
  const h = harvest();
  const keys = h.entities.map((e) => `${e.entityType}:${e.naturalKey}`).sort();
  assert.deepEqual(keys, [
    'COMPANY:424619256',
    'PARENT_PARCEL:01.72.14.040.030',
    'PROJECT:კრისტიან-სტივენის-ქუჩა-18',
    'PROPERTY_UNIT:01.72.14.040.030.01.02.017',
  ]);
});

/* ── the hierarchy is arithmetic, not belief ─────────────────────────── */

test('the parent parcel is derived from the code, needing no external evidence', () => {
  // Five groups is a parcel and anything longer is a unit inside that exact
  // parcel. The relationship is arithmetic.
  const r = relFor(harvest(), 'HAS_PARENT_PARCEL');
  assert.ok(r, 'the unit was not linked to its parcel');
  assert.equal(r.to.naturalKey, '01.72.14.040.030');
  assert.equal(r.sourceKind, 'DETERMINISTIC_DERIVATION');
  assert.equal(r.confidence, 1);
});

test('a named parent that does not contain the unit code is refused', () => {
  // Then it is somebody's claim rather than the hierarchy, and the hierarchy
  // is what we can actually prove.
  const h = harvest({ identifiedParent: { code: '99.99.99.999.999', confidence: 'HIGH' } });
  const r = relFor(h, 'HAS_PARENT_PARCEL');
  assert.equal(r.to.naturalKey, '01.72.14.040.030', 'the claimed parent replaced the derived one');
  assert.ok(h.skipped.some((s) => /does not contain the unit code/.test(s.why)));
});

test('a parcel searched directly gets no parent invented for it', () => {
  const h = harvestReport({ exactUnit: { code: '01.72.14.040.030' } }, POLICIES);
  assert.equal(relFor(h, 'HAS_PARENT_PARCEL'), undefined);
  assert.equal(h.entities[0].entityType, 'PARENT_PARCEL');
});

/* ── NOT FOUND IS NOT ABSENT ─────────────────────────────────────────── */

test('a check that established nothing is not stored as a fact', () => {
  // This is the rule that matters most here. "We could not confirm the
  // encumbrances" is a fact about our search; stored as knowledge, the next
  // verification would find it, treat it as known, and skip a check that was
  // never completed.
  const h = harvest();
  assert.equal(factFor(h, 'registry.propertyEncumbrances'), undefined,
    'an unconfirmed encumbrance check was stored as knowledge');
  assert.equal(factFor(h, 'registry.commissioning'), undefined);
  assert.equal(factFor(h, 'registry.constructionPermissions'), undefined);
  assert.ok(h.skipped.some((s) => s.what === 'legalStatus.propertyEncumbrances' && /establishes nothing/.test(s.why)));
});

test('a check that did establish something is stored, as a registry fact', () => {
  const f = factFor(harvest(), 'registry.debtorRegistry');
  assert.ok(f, 'a confirmed registry check was thrown away');
  assert.equal(f.valueText, 'CONFIRMED_POSITIVE');
  assert.equal(f.sourceKind, 'OFFICIAL_REGISTRY');
  assert.equal(f.freshnessClass, 'HIGH_VOLATILITY', 'a registry fact was not treated as volatile');
});

/* ── an unverified link is not a link ────────────────────────────────── */

test('an unverified unit is never attached to a project', () => {
  // The real report says outright that the unit's connection to this project
  // is unconfirmed. Writing it anyway is how a developer's reputation gets
  // attached to a building they never touched.
  const h = harvest();
  assert.equal(relFor(h, 'PART_OF_PROJECT'), undefined, 'an unverified unit was attached to a project');
  assert.ok(h.skipped.some((s) => /did not verify that this exact unit belongs/.test(s.why)));
});

test('a verified unit is attached to its project', () => {
  const h = harvest({ exactUnit: { ...REAL_REPORT.exactUnit, verified: true } });
  const r = relFor(h, 'PART_OF_PROJECT');
  assert.ok(r, 'a verified unit was not attached to its project');
  assert.equal(r.sourceKind, 'OFFICIAL_REGISTRY');
});

test('a developer named without an identification code is not linked', () => {
  // A name is a string, and attaching a reputation to a string is how the
  // wrong company ends up in somebody's report.
  const h = harvest({ companyProfile: { name: 'Some Developer LLC', idCode: null } });
  assert.equal(relFor(h, 'DEVELOPED_BY'), undefined);
  assert.ok(h.skipped.some((s) => /without an identification code/.test(s.why)));
});

test('a developer with a real code is linked, and the link carries its basis', () => {
  const r = relFor(harvest(), 'DEVELOPED_BY');
  assert.ok(r);
  assert.equal(r.to.naturalKey, '424619256');
  assert.equal(r.sourceKind, 'OFFICIAL_REGISTRY', 'a registry-confirmed company was recorded as a web finding');
  assert.equal(r.confidence, 0.9);
});

test('a company found only on the web is recorded as such', () => {
  const h = harvest({ companyProfile: { ...REAL_REPORT.companyProfile, sourceBasis: 'WEB' } });
  assert.equal(relFor(h, 'DEVELOPED_BY').sourceKind, 'PUBLIC_WEB');
  assert.equal(factFor(h, 'company.name').confidence, 0.6);
});

/* ── values ──────────────────────────────────────────────────────────── */

test('numbers are stored as numbers, out of the strings they arrive in', () => {
  const h = harvest();
  assert.equal(factFor(h, 'project.floors').valueNumber, 7);
  assert.equal(factFor(h, 'project.buildings').valueNumber, 1);
  assert.equal(factFor(h, 'project.units').valueNumber, 48, '"48 ბინა" did not yield 48');
});

test('an empty or null field becomes no fact at all', () => {
  // A row asserting nothing is worse than no row: it looks like knowledge.
  const h = harvest();
  assert.equal(factFor(h, 'company.status'), undefined, 'a null company status became a fact');
  assert.equal(factFor(h, 'company.registrationDate'), undefined);
  assert.equal(factFor(h, 'company.directors'), undefined, 'an empty director list became a fact');
});

test('every harvested fact carries a way back to what established it', () => {
  // NO EVIDENCE = NO FACT, and the database enforces the same rule.
  for (const f of harvest().facts) {
    const traceable =
      f.sourceKind === 'DETERMINISTIC_DERIVATION' ||
      (f.sourceRef && f.sourceRef.trim()) ||
      (f.evidenceRef && f.evidenceRef.trim());
    assert.ok(traceable, `${f.factKey} has no provenance`);
  }
  for (const r of harvest().relationships) {
    const traceable =
      r.sourceKind === 'DETERMINISTIC_DERIVATION' ||
      (r.sourceRef && r.sourceRef.trim()) ||
      (r.evidenceRef && r.evidenceRef.trim());
    assert.ok(traceable, `${r.relation} has no provenance`);
  }
});

test('every fact gets the freshness class its kind deserves', () => {
  const h = harvest();
  assert.equal(factFor(h, 'registry.debtorRegistry').freshnessClass, 'HIGH_VOLATILITY');
  assert.equal(factFor(h, 'project.identity').freshnessClass, 'LOW_VOLATILITY');
  assert.equal(factFor(h, 'parcel.code').freshnessClass, 'LOW_VOLATILITY');
  // A kind with no policy defaults to the middle rather than to "never
  // re-check".
  assert.equal(factFor(h, 'amenities.list').freshnessClass, 'MEDIUM_VOLATILITY');
});

/* ── what must never be harvested ────────────────────────────────────── */

test('the narrative is never promoted to a fact', () => {
  // The report's prose is a model's interpretation written for one buyer.
  // Promoting it would mean the next report cites the last report's writing
  // as though it were a source.
  const h = harvestReport({
    ...REAL_REPORT,
    summary: 'This looks like a solid opportunity in a good area.',
    finalView: 'I would proceed, subject to the mortgage release.',
    publicFindings: { riskFlags: ['something a model thought'] },
    unverified: ['a claim nobody checked'],
  }, POLICIES);
  const values = JSON.stringify(h.facts);
  assert.ok(!values.includes('solid opportunity'), 'narrative prose entered the fact layer');
  assert.ok(!values.includes('I would proceed'), 'a model conclusion entered the fact layer');
  assert.ok(!values.includes('something a model thought'));
  assert.ok(!values.includes('a claim nobody checked'));
});

test('nothing is harvested from an empty or broken report', () => {
  for (const nothing of [null, undefined, {}, 'x', 42]) {
    const h = harvestReport(nothing, POLICIES);
    assert.deepEqual(h.entities, []);
    assert.deepEqual(h.facts, []);
    assert.deepEqual(h.relationships, []);
  }
});

test('a report with no cadastral code still harvests what it can', () => {
  // A company and a project are real entities even when the property is not
  // identified, and the next verification of that developer benefits.
  const h = harvestReport({ companyProfile: REAL_REPORT.companyProfile, projectProfile: REAL_REPORT.projectProfile }, POLICIES);
  assert.ok(h.entities.some((e) => e.entityType === 'COMPANY'));
  assert.ok(h.entities.some((e) => e.entityType === 'PROJECT'));
  assert.equal(h.relationships.length, 1, 'only the developer link should survive');
});

test('a personal identification number is never harvested', () => {
  // Directors are names and a representation mode. The eleven-digit numbers
  // that sit beside them in a registry extract are not the customer's
  // business and are certainly not shared intelligence.
  const h = harvestReport({
    ...REAL_REPORT,
    companyProfile: { ...REAL_REPORT.companyProfile, directors: ['კობა კვანტალიანი', 'ლევან ჩაჩუა'] },
  }, POLICIES);
  const serialised = JSON.stringify(h);
  assert.ok(!/\b\d{11}\b/.test(serialised), 'an eleven-digit personal number reached the graph');
  assert.deepEqual(factFor(h, 'company.directors').valueJson, ['კობა კვანტალიანი', 'ლევან ჩაჩუა']);
});
