// FIND PROPERTY — production stabilization (owner, 2026-10-22).
//
// Primary regression: production search d3d859cc-aaa4-4a86-b2d7-23dae8663484. The customer
// asked for floors 2–8 ("სართულები კიდე 2-დან 8-მდე"), a balcony, a renovated (or green-frame)
// flat, preferably in a new building. The model turned the floors into LOW/MIDDLE/HIGH, the
// floor requirement was lost, a first-floor flat ranked #1 with a FLOOR_MATCH reason, and no
// result could be strong because a required balcony stated only in descriptions was "unknown".
import test from 'node:test';
import assert from 'node:assert/strict';
import { statedFloorIntent, floorTraceable } from '../marketplace/floor-intent.ts';
import { briefFromModel, sanitizeBrief } from '../marketplace/brief.ts';
import { buildSearchRequest } from '../marketplace/worker-contract.ts';
import { hardFilter } from '../marketplace/ranking.ts';
import { processSearch } from '../marketplace/pipeline.ts';
import { assessProperty } from '../marketplace/advisor.ts';
import { deriveSearchStatus } from '../marketplace/lifecycle.ts';
import { evaluateReadiness } from '../marketplace/readiness.ts';
import * as F from './fixtures/marketplaceFixtures.mjs';

/* The customer's words and the model's output, exactly as stored for d3d859cc. */
const D3_TEXT = 'მოკლედ ყლეო, ვეძებ ვარკეთილში და ვაზისუბანშიც ორივე ლოკაცია მაინტერესებს, ბინას მაქსიმუმ ბიუჯეტი 70-დან 90 ათას დოლარამდეა, 2 საძინებლიანი აუცილებლად, უნდ ქონდეს აივანი, განვიხიალვ მწვანე კარკასსაც და რაც მტავარია გარემონტებული უნდა იყოს და უკეთესია ახალაშენებულში, სართულები კიდე 2-დან 8-მდე, და კვ.მ კიდე 70 კვ.მ.-დან! მხოლოდ ამ უბნების ცენტრში';
const D3_MODEL = {
  transactionType: 'BUY', propertyType: 'APARTMENT', country: 'GE', city: 'Tbilisi', districts: ['ვარკეთილი', 'ვაზისუბანი'],
  locationPreferences: ['უბნის ცენტრი'], priceMinUsd: 70000, priceMaxUsd: 90000, priceCurrencyStated: 'USD',
  areaMinSqm: 70, areaMaxSqm: 100, roomsMin: 2, roomsMax: null, bedroomsMin: 2, bedroomsMax: null, bathroomsMin: null,
  buildingStatuses: ['NEW_BUILD', 'OLD_BUILD'], renovationPreferences: ['RENOVATED', 'GREEN_FRAME'], furnished: null, parking: null,
  floorPreferences: ['LOW', 'MIDDLE', 'HIGH'], mustHave: ['BALCONY'], niceToHave: [], exclusions: [],
  userLanguage: 'ka', relevantSearchLanguages: ['ka'], proposals: [],
};

/* ─────────── Floors: read from the customer's own words ─────────── */

test('d3d859cc: "სართულები კიდე 2-დან 8-მდე" is floors 2–8 — the price "70-დან 90" is never read as floors', () => {
  const f = statedFloorIntent(D3_TEXT);
  assert.deepEqual(f.range, { min: 2, max: 8 });
  assert.equal(f.notFirst, false);
});

test('floor phrases in Georgian, Russian and English; building height is never a floor range', () => {
  const cases = [
    ['მეორე სართულიდან ზემოთ', { min: 2, max: null }],
    ['მე-2 სართულიდან', { min: 2, max: null }],
    ['2 სართულიდან', { min: 2, max: null }],
    ['მე-8 სართულამდე', { min: null, max: 8 }],
    ['2-დან 8-მდე სართული', { min: 2, max: 8 }],
    ['с 2 по 8 этаж', { min: 2, max: 8 }],
    ['от 3 до 10 этажа', { min: 3, max: 10 }],
    ['не ниже 2 этажа', { min: 2, max: null }],
    ['floors 2-8', { min: 2, max: 8 }],
    ['from the 2nd floor up', { min: 2, max: null }],
    ['second floor and above', { min: 2, max: null }],
    ['9 სართულიან კორპუსში', null],
    ['в 9-этажном доме', null],
    ['ბიუჯეტი 70-დან 90 ათასამდე', null],
  ];
  for (const [text, range] of cases) assert.deepEqual(statedFloorIntent(text).range, range, text);
  for (const text of ['არა პირველ სართულზე', 'не первый этаж', 'not on the first floor']) assert.equal(statedFloorIntent(text).notFirst, true, text);
  assert.equal(floorTraceable(2, 'მეორე სართულიდან'), true);
  assert.equal(floorTraceable(5, 'ბინა ვაკეში'), false);
});

test('d3d859cc brief: the floor range survives, the vague LOW/MIDDLE/HIGH noise does not, nothing else is lost', () => {
  const brief = briefFromModel(D3_MODEL, D3_TEXT);
  assert.deepEqual(brief.floorRange, { min: 2, max: 8 });
  assert.deepEqual(brief.floorPreferences, []);
  assert.deepEqual(brief.bedrooms.value, { min: 2, max: null });
  assert.deepEqual(brief.mustHave, ['BALCONY']);
  assert.deepEqual(brief.renovationPreferences.value, ['RENOVATED', 'GREEN_FRAME']);
  /* Price and area wait for the customer's confirmation, as in production (70-დან, 100 m² are not traceable digits). */
  const confirmed = ['price', 'area'].reduce((b, field) => ({ ...b, [field]: { ...b[field], status: 'CONFIRMED' } }), brief);
  assert.equal(evaluateReadiness(confirmed).state, 'READY');
  const req = buildSearchRequest(confirmed, { searchId: 's', searchPlanId: 'p' }, F.FIXTURE_NOW);
  assert.deepEqual(req.floorRange, { min: 2, max: 8 });
  /* It round-trips through a client edit unchanged. */
  assert.deepEqual(sanitizeBrief(JSON.parse(JSON.stringify(brief))).floorRange, { min: 2, max: 8 });
});

test('a model floor the customer never said is dropped; one they said is kept', () => {
  const said = briefFromModel({ ...D3_MODEL, floorMin: 3, floorMax: null }, 'ბინა ვაკეში, მესამე სართულიდან, 2 საძინებელი');
  assert.deepEqual(said.floorRange, { min: 3, max: null });
  const invented = briefFromModel({ ...D3_MODEL, floorMin: 5, floorMax: null }, 'ბინა ვაკეში 2 საძინებელი');
  assert.equal(invented.floorRange, null);
});

/* ─────────── Building age vs finishing condition; requirement vs preference ─────────── */

test('"preferably new" is a wish: every building age stays acceptable and the wish only ranks', () => {
  const brief = briefFromModel({ ...D3_MODEL, buildingStatuses: [], preferredBuildingStatuses: ['NEW_BUILD'], preferredRenovations: [] }, D3_TEXT);
  assert.deepEqual(brief.buildingStatuses.value, ['ANY']);
  assert.deepEqual(brief.preferredBuildingStatuses, ['NEW_BUILD']);
  const readiness = evaluateReadiness(brief);
  assert.equal([...readiness.missing, ...readiness.unconfirmed].includes('buildingStatus'), false, 'a wish answers the building question');
  const confirmed = ['price', 'area'].reduce((b, field) => ({ ...b, [field]: { ...b[field], status: 'CONFIRMED' } }), brief);
  const req = buildSearchRequest(confirmed, { searchId: 's', searchPlanId: 'p' }, F.FIXTURE_NOW);
  assert.deepEqual(req.buildingStatuses, []);
  assert.deepEqual(req.preferredBuildingStatuses, ['NEW_BUILD']);
  const facts = { ...baseFacts(), buildingStatus: 'UNDER_CONSTRUCTION' };
  const r = hardFilter(facts, { ...F.FIXTURE_REQUEST, buildingStatuses: [], preferredBuildingStatuses: ['NEW_BUILD'] });
  assert.equal(r.fits, true, 'a wish never excludes');
  assert.deepEqual(r.checks.find((c) => c.field === 'PREFERRED_BUILDING_STATUS'), { field: 'PREFERRED_BUILDING_STATUS', hard: false,
    expected: ['NEW_BUILD'], observed: 'UNDER_CONSTRUCTION', basis: 'STRUCTURED', result: 'FAIL' });
});

test('construction type: both accepted, new only, old only, unknown', () => {
  const old = { ...baseFacts(), buildingStatus: 'OLD_BUILD' };
  const req = (buildingStatuses) => ({ ...F.FIXTURE_REQUEST, buildingStatuses });
  assert.equal(hardFilter(old, req(['NEW_BUILD', 'OLD_BUILD'])).fits, true, 'old and new both accepted');
  assert.deepEqual(hardFilter(old, req(['NEW_BUILD'])).violations, ['BUILDING_STATUS'], 'new only: old is a mismatch');
  assert.deepEqual(hardFilter({ ...old, buildingStatus: 'NEW_BUILD' }, req(['OLD_BUILD'])).violations, ['BUILDING_STATUS'], 'old only: new is a mismatch');
  const unknown = hardFilter({ ...old, buildingStatus: null }, req(['NEW_BUILD']));
  assert.equal(unknown.fits, true);
  assert.deepEqual(unknown.unverified, ['BUILDING_STATUS'], 'unknown is never a pass');
  assert.equal(hardFilter(old, req([])).checks.some((c) => c.field === 'BUILDING_STATUS'), false, 'no requirement, no check');
});

test('green frame is a finishing condition, not a building age; "newly built" does not mean "renovated"', () => {
  const req = { ...F.FIXTURE_REQUEST, buildingStatuses: ['NEW_BUILD'], renovationPreferences: ['RENOVATED', 'GREEN_FRAME'] };
  const newUnstated = hardFilter({ ...baseFacts(), buildingStatus: 'NEW_BUILD', renovationStatus: null }, req);
  assert.deepEqual(newUnstated.unverified, ['RENOVATION'], 'a new building with no stated condition is not "renovated"');
  const oldGreen = hardFilter({ ...baseFacts(), buildingStatus: 'OLD_BUILD', renovationStatus: 'GREEN_FRAME' }, req);
  assert.deepEqual(oldGreen.violations, ['BUILDING_STATUS'], 'green frame satisfies the condition, never the building age');
  assert.equal(oldGreen.checks.find((c) => c.field === 'RENOVATION').result, 'PASS');
});

test('mandatory renovation: a stated other condition fails, an unstated one is unverified', () => {
  const req = { ...F.FIXTURE_REQUEST, renovationPreferences: ['RENOVATED'] };
  assert.deepEqual(hardFilter({ ...baseFacts(), renovationStatus: 'WHITE_FRAME' }, req).violations, ['RENOVATION']);
  assert.deepEqual(hardFilter({ ...baseFacts(), renovationStatus: null }, req).unverified, ['RENOVATION']);
  /* Preferred renovation is soft. */
  const soft = hardFilter({ ...baseFacts(), renovationStatus: 'WHITE_FRAME' }, { ...F.FIXTURE_REQUEST, renovationPreferences: [], preferredRenovations: ['RENOVATED'] });
  assert.equal(soft.fits, true);
  assert.equal(soft.unverified.length, 0);
});

/* ─────────── Hard floor checks ─────────── */

test('minimum floor 2: floor 1 fails, floor 2 passes, an unknown floor is UNKNOWN (never a pass)', () => {
  const req = { ...F.FIXTURE_REQUEST, floorRange: { min: 2, max: 8 } };
  const first = hardFilter({ ...baseFacts(), floor: 1 }, req);
  assert.deepEqual(first.violations, ['FLOOR_RANGE']);
  assert.deepEqual(first.checks.find((c) => c.field === 'FLOOR_RANGE'),
    { field: 'FLOOR_RANGE', hard: true, expected: { min: 2, max: 8 }, observed: 1, basis: 'STRUCTURED', result: 'FAIL' });
  assert.equal(hardFilter({ ...baseFacts(), floor: 2 }, req).fits, true);
  assert.deepEqual(hardFilter({ ...baseFacts(), floor: 9 }, req).violations, ['FLOOR_RANGE'], 'above the maximum');
  const unknown = hardFilter({ ...baseFacts(), floor: null }, req);
  assert.deepEqual(unknown.unverified, ['FLOOR_RANGE']);
  assert.equal(unknown.checks.find((c) => c.field === 'FLOOR_RANGE').result, 'UNKNOWN');
  assert.deepEqual(hardFilter({ ...baseFacts(), floor: -1 }, req).violations, ['FLOOR_RANGE'], 'a basement is below 2');
});

test('bedrooms are never inferred from rooms', () => {
  const r = hardFilter({ ...baseFacts(), rooms: 3, bedrooms: null }, { ...F.FIXTURE_REQUEST, rooms: null, bedrooms: { min: 2, max: null } });
  assert.deepEqual(r.unverified, ['BEDROOMS']);
  assert.equal(r.checks.find((c) => c.field === 'BEDROOMS').observed, null);
});

test('a required amenity: structured field, else the listing\'s own description, else UNKNOWN', () => {
  const req = { ...F.FIXTURE_REQUEST, mustHave: ['BALCONY'] };
  const check = (facts, text) => hardFilter({ ...baseFacts(), ...facts }, req, text).checks.find((c) => c.field === 'REQUIRED_BALCONY');
  assert.equal(check({ amenities: ['BALCONY'] }).result, 'PASS');
  assert.deepEqual(check({}, { mentioned: ['BALCONY'], contradicted: [] }), { field: 'REQUIRED_BALCONY', hard: true, expected: true, observed: true, basis: 'DESCRIPTION', result: 'PASS' });
  assert.equal(check({}, { mentioned: [], contradicted: ['BALCONY'] }).result, 'FAIL');
  assert.equal(check({}).result, 'UNKNOWN');
});

/* ─────────── The whole pipeline: d3d859cc replayed on synthetic listings ─────────── */

const D3_REQUEST = { ...F.FIXTURE_REQUEST, districts: ['Vake'], priceMinUsd: 70000, priceMaxUsd: 90000, collectPriceMaxUsd: 99000,
  areaMinSqm: 70, areaMaxSqm: 100, rooms: { min: 2, max: null }, bedrooms: { min: 2, max: null },
  buildingStatuses: ['NEW_BUILD', 'OLD_BUILD'], renovationPreferences: ['RENOVATED', 'GREEN_FRAME'],
  preferredBuildingStatuses: ['NEW_BUILD'], floorRange: { min: 2, max: 8 }, mustHave: ['BALCONY'] };
const d3Listing = (id, over) => F.listing({ sourceListingId: id, price: 80000, areaSqm: 85, rooms: 3, bedrooms: 2, floor: 4, totalFloors: 9,
  buildingStatus: 'NEW_BUILD', renovationStatus: 'RENOVATED', description: 'ბინა გარემონტებული, აივნით, ყველაფერი ახალი.', ...over });

test('d3d859cc replay: the first-floor flat is never a match, never FLOOR_MATCH; a confirmed one is strong', () => {
  const out = processSearch({ request: D3_REQUEST, candidates: F.fixtureCandidates([
    d3Listing('first', { floor: 1, areaSqm: 86 }),
    d3Listing('fourth', {}),
    d3Listing('silent', { areaSqm: 90, floor: 5, description: 'ბინა ახალ კორპუსში.' }),
    d3Listing('noreno', { areaSqm: 95, floor: 6, renovationStatus: null }),
  ]), now: F.FIXTURE_NOW });
  const by = (id) => out.properties.find((p) => p.listings[0].sourceListingId === id);
  const first = by('first');
  assert.equal(first.group, 'OTHER');
  assert.deepEqual(first.mismatch, ['FLOOR_RANGE']);
  assert.equal(first.intelligence.strong, false);
  assert.equal(first.reasons.some((r) => r.code === 'FLOOR_MATCH'), false);
  const fourth = by('fourth');
  assert.equal(fourth.intelligence.strong, true, 'every hard criterion confirmed, balcony by the listing\'s own words');
  assert.equal(fourth.group, 'BEST');
  assert.ok(fourth.reasons.some((r) => r.code === 'FLOOR_MATCH'));
  assert.equal(by('silent').intelligence.strong, false, 'balcony not stated anywhere: not strong');
  assert.deepEqual(by('silent').unverified, ['REQUIRED_BALCONY']);
  assert.deepEqual(by('noreno').unverified, ['RENOVATION'], 'mandatory renovation unstated: not strong');
  assert.equal(out.stats.strongMatches, out.properties.filter((p) => p.intelligence.strong).length);
  assert.equal(out.stats.strongMatches, 1);
  /* BEST holds strong matches only: one definition for the group, the badge and the count. */
  assert.ok(out.properties.filter((p) => p.group === 'BEST').every((p) => p.intelligence.strong));
  /* The audit trail is persisted with every property. */
  assert.ok(first.internal.checks.some((c) => c.field === 'FLOOR_RANGE' && c.result === 'FAIL' && c.observed === 1));
});

test('advisor on the first-floor flat: a stated difference, never "good match"', () => {
  const brief = briefFromModel(D3_MODEL, D3_TEXT);
  const a = assessProperty({ group: 'OTHER', facts: { ...baseFacts(), floor: 1, totalFloors: 9, priceUsd: 76000, areaSqm: 85, bedrooms: 3, district: 'ვარკეთილი', buildingStatus: 'OLD_BUILD', renovationStatus: 'RENOVATED' },
    intelligence: { strong: false, preferences: { confirmed: [], mentioned: [], unconfirmed: ['BALCONY'], contradicted: [] } },
    vsComparable: null, seller: { classification: 'UNKNOWN' }, listings: [], priceDiscrepancy: null, upgrade: null }, brief);
  assert.ok(a.misses.some((m) => m.code === 'FLOOR' && m.params.n === 1));
  assert.equal(a.fits.some((m) => m.code === 'FLOOR'), false);
  assert.equal(a.verdict, 'CONSIDER');
});

test('ranking before the BEST cap: the six highest-scoring strong matches are BEST, the rest follow in order', () => {
  const listings = Array.from({ length: 9 }, (_, i) => d3Listing(`s${i}`, { areaSqm: 71 + i * 3, floor: 2 + (i % 6), price: 72000 + i * 1500 }));
  const out = processSearch({ request: D3_REQUEST, candidates: F.fixtureCandidates(listings), now: F.FIXTURE_NOW });
  const best = out.properties.filter((p) => p.group === 'BEST');
  assert.equal(best.length, 6);
  const minBest = Math.min(...best.map((p) => p.score));
  for (const p of out.properties.filter((x) => x.group === 'MORE' || x.group === 'OWNER')) assert.ok(p.score <= minBest, `${p.key} ranked below the BEST cap`);
});

/* ─────────── Search completeness ─────────── */

test('a BLOCKED source is terminal but not a success: 4 of 5 is PARTIAL_COMPLETE, never COMPLETE', () => {
  const runs = ['myhome-agent', 'homege-agent', 'allhome-agent', 'placege-agent'].map((workerId) => ({ workerId, status: 'COMPLETE', returnedCount: 10 }))
    .concat([{ workerId: 'ssge-agent', status: 'BLOCKED', returnedCount: 0 }]);
  assert.deepEqual(deriveSearchStatus('SEARCHING', runs, { properties: 150, strongMatches: 0 }), { status: 'PARTIAL_COMPLETE', failureReason: null });
  assert.equal(deriveSearchStatus('SEARCHING', runs.map((r) => ({ ...r, status: 'COMPLETE' })), { properties: 150, strongMatches: 0 }).status, 'COMPLETE');
});

function baseFacts() {
  return { priceUsd: 150000, pricePerSqmUsd: 1630, areaSqm: 92, rooms: 3, bedrooms: 2, bathrooms: 1, floor: 6, totalFloors: 12,
    city: 'Tbilisi', district: 'Vake', buildingStatus: 'NEW_BUILD', renovationStatus: 'RENOVATED', parking: null, furnished: null, amenities: [] };
}
