// The ResearchSeed: what a run already knows, shaped so a portal can be asked.
//
// The failure this prevents is cheap to describe and expensive to ship: the
// pipeline establishes the district, hands it to a model as prose, and the
// model spends a paid search rediscovering it. A seed field is only useful if
// it is STRUCTURED and if it carries where it came from — a district from a
// reconciled identity and a district guessed from free text are not the same
// claim, and the envelope's rationale has to be able to say which it used.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildResearchSeed, parseQueryHints, GE_RESEARCH_LANGUAGES } from '../researchSeed.ts';
import { seedSupportsMarketSearch, describeSeed } from '../../research-core/plan/seed.ts';
import { buildComparableEnvelope } from '../../research-core/plan/envelope.ts';

test('area is read from free text in several scripts and unit spellings', () => {
  assert.equal(parseQueryHints('97.2 m2 flat in Vake').areaSqm, 97.2);
  assert.equal(parseQueryHints('97,2 კვ.მ ბინა').areaSqm, 97.2);
  assert.equal(parseQueryHints('120 кв.м квартира').areaSqm, 120);
  assert.equal(parseQueryHints('85 sqm apartment').areaSqm, 85);
});

test('a number that cannot be an area is not read as one', () => {
  // A cadastral code is full of numbers and none of them are square metres.
  assert.equal(parseQueryHints('01.18.06.019.055.03.01.603').areaSqm, null);
  assert.equal(parseQueryHints('').areaSqm, null);
  assert.equal(parseQueryHints(null).areaSqm, null);
  // Below the plausibility bound, it is not an area.
  assert.equal(parseQueryHints('3 m2 storage').areaSqm, null);
});

test('rent and sale intent are read, and absence stays UNKNOWN', () => {
  assert.equal(parseQueryHints('2 bedroom flat for rent in Vake').transaction, 'RENT');
  assert.equal(parseQueryHints('apartment for sale Vake').transaction, 'SALE');
  assert.equal(parseQueryHints('ბინა ქირავდება ვაკეში').transaction, 'RENT');
  assert.equal(parseQueryHints('Vake apartment').transaction, 'UNKNOWN');
});

test('a reconciled address outranks a free-text guess, and says so', () => {
  const seed = buildResearchSeed({
    jobId: 'job-1',
    query: 'flat somewhere in Gldani',
    mode: 'property',
    result: {
      reconciledIdentity: { address: 'Chavchavadze Avenue 12, Vake, Tbilisi', confidence: 'HIGH' },
    },
  });
  // Homatch's canonical district vocabulary is Georgian, which is also the
  // locale the portal adapter then asks in so the two actually match.
  assert.equal(seed.location.district.value, 'ვაკე');
  assert.match(seed.location.district.origin, /reconciledIdentity/);
  assert.equal(seed.location.city.value, 'თბილისი');
});

test('free text is used only when nothing stronger exists, and is labelled', () => {
  const seed = buildResearchSeed({
    jobId: 'job-2',
    query: '97.2 m2 2 bedroom apartment in Vake',
    mode: 'property',
    result: {},
  });
  assert.equal(seed.property.areaSqm.value, 97.2);
  assert.equal(seed.property.areaSqm.origin, 'query text');
  assert.equal(seed.property.bedrooms.value, 2);
  assert.equal(seed.location.district.value, 'ვაკე');
});

test('a known property record outranks the query text', () => {
  const seed = buildResearchSeed({
    jobId: 'job-3',
    query: '50 m2 flat',
    mode: 'property',
    result: {},
    property: { area_sqm: 97.2, bedrooms: 2, district: 'Vake', city: 'Tbilisi' },
  });
  assert.equal(seed.property.areaSqm.value, 97.2);
  assert.equal(seed.property.areaSqm.origin, 'property');
});

test('nothing established means nothing asserted', () => {
  const seed = buildResearchSeed({ jobId: 'job-4', query: '', mode: 'property', result: {} });
  assert.equal(seed.property.areaSqm, null);
  assert.equal(seed.location.district, null);
  assert.equal(seed.project.name, null);
  // And with nothing to narrow a city, no market query may be built.
  assert.equal(seedSupportsMarketSearch(seed), false);
  assert.equal(buildComparableEnvelope(seed), null);
});

test('research languages are the market\'s, not the interface\'s', () => {
  const seed = buildResearchSeed({ jobId: 'job-5', query: 'Vake flat', mode: 'property', result: {} });
  // A Georgian buyer still needs the Russian and English expat market.
  assert.deepEqual(seed.languages, GE_RESEARCH_LANGUAGES);
  assert.ok(seed.languages.includes('ru'));
  assert.ok(seed.languages.includes('en'));
  assert.ok(seed.languages.includes('ka'));
});

test('the asset class decides the property type without inventing one', () => {
  const flat = buildResearchSeed({
    jobId: 'a', query: 'x', mode: 'cadastral',
    result: { identity: { assetClass: 'APARTMENT_IN_PROJECT' } },
  });
  assert.equal(flat.property.propertyType.value, 'APARTMENT');

  const unknown = buildResearchSeed({
    jobId: 'b', query: 'x', mode: 'cadastral',
    result: { identity: { assetClass: 'MIXED_OR_UNKNOWN' } },
  });
  // MIXED_OR_UNKNOWN genuinely does not say what this is. Leaving it null
  // keeps the envelope open instead of asserting a type nothing established.
  assert.equal(unknown.property.propertyType, null);
});

test('registry facts are never carried into a market query', () => {
  const seed = buildResearchSeed({
    jobId: 'job-6',
    query: 'Vake flat',
    mode: 'property',
    result: {},
    knownFacts: {
      'address.full': 'Chavchavadze 12, Vake',
      'ownership.owner': 'Some Person',
      'encumbrance.mortgage': 'Bank of Georgia',
    },
  });
  const rendered = JSON.stringify(seed);
  // Ownership and encumbrances say nothing about which flats are comparable,
  // and putting them in a portal query would be both useless and a privacy
  // mistake. The seed has no field that could carry them.
  assert.ok(!rendered.includes('Some Person'));
  assert.ok(!rendered.includes('Bank of Georgia'));
  assert.ok(rendered.includes('ვაკე'));
});

test('a seed can explain itself to an operator', () => {
  const seed = buildResearchSeed({
    jobId: 'job-7',
    query: '97.2 m2 2 bedroom apartment in Vake',
    mode: 'property',
    result: { reconciledIdentity: { address: 'Chavchavadze 12, Vake, Tbilisi' } },
  });
  const lines = describeSeed(seed);
  assert.ok(lines.some((l) => l.startsWith('district:')));
  assert.ok(lines.some((l) => l.includes('query text') || l.includes('reconciledIdentity')));
});

test('the envelope built from a real seed is narrow and traceable', () => {
  const seed = buildResearchSeed({
    jobId: 'job-8',
    query: '97.2 m2 2 bedroom apartment for sale',
    mode: 'property',
    result: { reconciledIdentity: { address: 'Chavchavadze 12, Vake, Tbilisi' } },
  });
  const query = buildComparableEnvelope(seed);
  assert.equal(query.transaction, 'SALE');
  assert.equal(query.area.min, 83);
  assert.equal(query.area.max, 112);
  assert.equal(query.bedrooms.min, 1);
  assert.equal(query.bedrooms.max, 3);
  assert.match(query.rationale, /job-8/);
});
