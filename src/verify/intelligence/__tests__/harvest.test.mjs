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
  listingKey,
  MAX_COMPARABLES_HARVESTED,
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
  const fromUnit = h.relationships.find(
    (r) => r.relation === 'PART_OF_PROJECT' && r.from.entityType === 'PROPERTY_UNIT'
  );
  assert.equal(fromUnit, undefined, 'an unverified unit was attached to a project');
  assert.ok(h.skipped.some((s) => /did not verify that this exact unit belongs/.test(s.why)));
});

test('but the project IS recorded as standing on the parcel', () => {
  // A different and far better supported claim, and the one that makes the
  // research reusable: "that development is on this land" needs no registry
  // statement about the flat. The two must never be collapsed, so this edge
  // hangs off the PARCEL and never off the unit.
  const h = harvest();
  const fromParcel = h.relationships.find(
    (r) => r.relation === 'PART_OF_PROJECT' && r.from.entityType === 'PARENT_PARCEL'
  );
  assert.ok(fromParcel, 'the project is not reachable from the parcel');
  assert.equal(fromParcel.to.entityType, 'PROJECT');
  assert.equal(fromParcel.sourceKind, 'PUBLIC_WEB', 'a web association claimed registry strength');
  assert.ok(fromParcel.confidence <= 0.6, 'a weakly-evidenced link carries a strong confidence');
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

/* ── what kind of property this is ───────────────────────────────────── */

test('the asset class is remembered, so the next run knows what applies', () => {
  // Without it the planner cannot tell "this kind of property has no
  // commissioning status" from "we have not looked yet", and a private resale
  // can never reuse the public research it already paid for.
  const h = harvest({ assetClass: 'PRIVATE_RESALE' });
  const f = factFor(h, 'property.assetClass');
  assert.ok(f, 'the asset class was not remembered');
  assert.equal(f.valueText, 'PRIVATE_RESALE');
  assert.equal(f.sourceKind, 'DETERMINISTIC_DERIVATION');
});

test('"we could not classify it" is not remembered as a classification', () => {
  // Storing it would let a later run treat an unclassified property as
  // classified — the absence rule, in another place.
  assert.equal(factFor(harvest({ assetClass: 'MIXED_OR_UNKNOWN' }), 'property.assetClass'), undefined);
  assert.equal(factFor(harvest({ assetClass: null }), 'property.assetClass'), undefined);
  assert.equal(factFor(harvest({}), 'property.assetClass'), undefined);
});

/* ── comparables ─────────────────────────────────────────────────────── */

/** Verbatim from a real completed job's market.comparables. */
const REAL_COMPARABLE = {
  url: 'https://www.home.ge/binebi/iyideba-binebi/iyideba-bina-3-otakhiani-akhali-ashenebuli-tbilisi-krtsanisi-444915.html',
  area: '83.2',
  floor: '6/8',
  price: '158080',
  rooms: '3',
  source: 'Home.ge',
  address: 'თბილისი, კრწანისი, კრწანისის ქუჩა 6',
  project: 'Villion Krtsanisi Homes',
  currency: 'USD',
  condition: 'მწვანე კარკასი',
  listingDate: '2026-06-25',
  pricePerSqm: '1900',
  retrievedAt: '2026-09-09',
  listingStatus: 'ACTIVE',
  comparableType: 'SAME_PROJECT',
};

const withMarket = (comparables) => harvest({ market: { comparables } });

test('a comparable becomes a listing entity in the same graph', () => {
  // Not a separate comparables store: a second knowledge system beside the
  // first means every read has to ask which of the two is right.
  const h = withMarket([REAL_COMPARABLE]);
  const listing = h.entities.find((e) => e.entityType === 'LISTING');
  assert.ok(listing, 'the comparable did not become an entity');
  assert.equal(listing.keyKind, 'LISTING_URL');
  assert.equal(listing.displayName, 'Villion Krtsanisi Homes');
});

test('its price and its description are both recorded', () => {
  const h = withMarket([REAL_COMPARABLE]);
  const f = (k) => h.facts.find((x) => x.factKey === k);
  assert.equal(f('listing.price').valueNumber, 158080);
  assert.equal(f('listing.price').valueUnit, 'USD');
  assert.equal(f('listing.pricePerSqm').valueNumber, 1900);
  assert.equal(f('listing.area').valueNumber, 83.2);
  assert.equal(f('listing.rooms').valueNumber, 3);
  assert.equal(f('listing.floor').valueText, '6/8');
  assert.equal(f('listing.condition').valueText, 'მწვანე კარკასი');
  assert.equal(f('listing.status').valueText, 'ACTIVE');
  assert.equal(f('listing.source').valueText, 'Home.ge');
  for (const fact of h.facts.filter((x) => x.factKey.startsWith('listing.'))) {
    assert.equal(fact.sourceKind, 'MARKET_LISTING', `${fact.factKey} claims a stronger source than a listing`);
  }
});

test('the same page seen twice is one listing, whatever the tracking parameters', () => {
  // Trackers and session parameters differ between two sightings and would
  // make one flat into several listings — which is exactly what breaks a
  // price history.
  assert.equal(
    listingKey('https://Home.ge/a/b?utm_source=x#top'),
    listingKey('https://home.ge/a/b/')
  );
  const h = withMarket([
    REAL_COMPARABLE,
    { ...REAL_COMPARABLE, url: REAL_COMPARABLE.url + '?utm_source=newsletter' },
  ]);
  assert.equal(h.entities.filter((e) => e.entityType === 'LISTING').length, 1);
});

test('a listing with no URL is not stored, because it could never be recognised again', () => {
  const h = withMarket([{ ...REAL_COMPARABLE, url: null }]);
  assert.equal(h.entities.filter((e) => e.entityType === 'LISTING').length, 0);
  // And a non-URL is not a URL.
  assert.equal(listingKey('home.ge/a'), null);
  assert.equal(listingKey(''), null);
  assert.equal(listingKey(null), null);
});

test('a comparable is linked to the property it was a comparable for', () => {
  // The same listing is a close comparison for the flat next door and a poor
  // one for a warehouse across the city.
  const h = withMarket([REAL_COMPARABLE]);
  const r = h.relationships.find((x) => x.relation === 'COMPARABLE_TO');
  assert.ok(r, 'the comparable was not linked to the subject');
  assert.equal(r.to.naturalKey, '01.72.14.040.030.01.02.017');
  assert.equal(r.sourceKind, 'MARKET_LISTING');
});

test('the number of listings stored per run is bounded', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ ...REAL_COMPARABLE, url: `https://home.ge/listing/${i}` }));
  const h = withMarket(many);
  assert.equal(h.entities.filter((e) => e.entityType === 'LISTING').length, MAX_COMPARABLES_HARVESTED);
});

test('an empty or broken market block harvests nothing and throws nothing', () => {
  for (const m of [null, undefined, {}, { comparables: null }, { comparables: 'x' }, { comparables: [null, 'x', 42] }]) {
    const h = harvest({ market: m });
    assert.equal(h.entities.filter((e) => e.entityType === 'LISTING').length, 0);
  }
});

test('no market conclusion is ever stored, only the observations under it', () => {
  // The medians, the bands and the positioning stay deterministic in
  // marketIntelligence.ts. The graph caches what was observed, never what was
  // concluded from it.
  const h = harvest({
    market: {
      comparables: [REAL_COMPARABLE],
      median: 1950, mean: 2000, basis: 'SAME_PROJECT', positioning: 'AROUND_MARKET',
    },
  });
  const keys = h.facts.map((f) => f.factKey);
  for (const conclusion of ['market.median', 'market.mean', 'market.basis', 'market.positioning']) {
    assert.ok(!keys.includes(conclusion), `${conclusion} was cached as a fact`);
  }
});
