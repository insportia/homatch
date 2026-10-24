// landLocationPropagation.test.mjs — production Verify 9f49e7e3 (2026-10-24), cadastral code 01.19.19.004.008, a
// 14,313 m² land parcel in Tbilisi. Its TAS_MAP result was refused as too large (413) and the worker's trimmed
// hand-off kept scalars only, so the parcel's own map views (frameUrls) never reached the edge: market search,
// neighbourhood and fresh photos all said "location unknown", and the report then claimed "too few comparables" for
// a market that was never searched. The worker now keeps the views (official-worker/test/handoffLocation.test.mjs);
// these tests hold every downstream stage to them, for every property kind, and hold the report to the truth.
// Fixture: src/verify/__tests__/fixtures/job-9f49e7e3-land-location.json (sanitized; one labelled synthetic view).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { subjectMarketProfile, marketplaceSearchPlan, marketEligibilityBrief } from '../marketEligibility.ts';
import { centerFromBrowserOfficial, MS_MAP_DEFAULT_CENTER } from '../intelligence/neighborhood.ts';
import { freshPhotoCenter } from '../freshPhotos.ts';
import { officialCenterCandidates } from '../intelligence/neighborhoodFetch.ts';
import { buildMarketIntelligence } from '../intelligence/marketIntelligence.ts';
import { marketView } from '../marketPresentation.ts';

const F = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/job-9f49e7e3-land-location.json', import.meta.url)), 'utf8'));
const PARCEL = F.cadastralCode;
const seed = { location: { address: { value: F.tasCaseAddress }, city: { value: F.city } }, property: { cadastralCode: { value: PARCEL } } };
/** What the edge received: as stored (trimmed), or with the views the fixed hand-off keeps. */
const browserOfficial = (withViews) => ({ results: [{ ...F.storedTasMap, ...(withViews ? { frameUrls: F.workerFrameUrls } : {}) }] });
const extract = (fields) => ({ issuedAt: '2026-10-05', recordId: 'fixture', ...fields });
const KINDS = {
  LAND: extract({ unitRowFound: false, ...F.registerLatest }),
  APARTMENT: extract({ unitRowFound: true, unitItemText: 'ბინა N 12', unitAreaSqm: 75 }),
  HOUSE: extract({ unitRowFound: false, landAreaSqm: 600, buildingsText: 'საცხოვრებელი სახლი', buildingsTotalAreaSqm: 180 }),
  COMMERCIAL: extract({ unitRowFound: true, unitItemText: 'კომერციული ფართი', unitAreaSqm: 120 }),
};
const profile = (kind, withViews) => subjectMarketProfile({ result: { browserOfficial: browserOfficial(withViews) }, seed, registerLatest: KINDS[kind] });

test('reproduction: the stored (trimmed) result carries only the map default view, so no stage has a location', () => {
  // The default start view is the same for every job and is never evidence of the parcel.
  assert.ok(F.storedTasMap.startUrl.includes(MS_MAP_DEFAULT_CENTER));
  assert.equal(F.storedTasMap.handoffMinimum, true);
  assert.equal(centerFromBrowserOfficial(browserOfficial(false), PARCEL), null);
  const p = profile('LAND', false);
  assert.equal(p.assetClass, 'LAND');
  assert.equal(p.areaSqm, 14313, 'the register area did arrive');
  assert.equal(p.city, 'თბილისი', 'the address did arrive');
  assert.equal(p.latitude, null);
  assert.equal(p.district, null);
  assert.equal(marketplaceSearchPlan(p).reason, 'LOCATION_UNKNOWN', 'what production recorded');
  assert.equal(freshPhotoCenter({}, { exactUnit: { code: PARCEL }, browserOfficial: browserOfficial(false) }), null, 'photos: NO_LOCATION, as recorded');
});

test('fixed hand-off: the parcel view reaches the market search, with a district named from the point', () => {
  const c = centerFromBrowserOfficial(browserOfficial(true), PARCEL);
  assert.deepEqual(c, { lng: 44.896, lat: 41.6995 });
  const p = profile('LAND', true);
  assert.equal(p.latitude, 41.6995);
  assert.equal(p.longitude, 44.896);
  assert.equal(p.districtBasis, 'COORDINATES');
  assert.ok(p.district, 'a Tbilisi district is named from the parcel centre');
  const plan = marketplaceSearchPlan(p);
  assert.equal(plan.reason, null);
  assert.equal(plan.request.propertyType, 'LAND');
  assert.equal(plan.request.areaSqm, 14313);
  assert.equal(plan.request.latitude, 41.6995);
});

test('fixed hand-off: the photo search gets the official parcel centre, not a geocode guess', () => {
  const centre = freshPhotoCenter({}, { exactUnit: { code: PARCEL }, browserOfficial: browserOfficial(true) });
  assert.deepEqual(centre, { lng: 44.896, lat: 41.6995, basis: 'MS_MAP_PARCEL' });
  // A centre the report already stored still wins (existing behaviour).
  const stored = freshPhotoCenter({ location: { neighborhood: { center: { lat: 41.7, lng: 44.9, basis: 'CADASTRAL_PLAN' } } } }, { exactUnit: { code: PARCEL }, browserOfficial: browserOfficial(true) });
  assert.equal(stored.basis, 'CADASTRAL_PLAN');
});

test('neighbourhood: the official candidates gain the parcel view (HIGH, before any address geocode)', () => {
  assert.deepEqual(officialCenterCandidates(browserOfficial(false), PARCEL), [], 'as recorded: NO_LOCATION');
  const [c] = officialCenterCandidates(browserOfficial(true), PARCEL);
  assert.equal(c.basis, 'MS_MAP_PARCEL');
  assert.equal(c.lat, 41.6995);
  assert.equal(c.parcel, PARCEL);
});

test('every property kind: without the view no search; with it the right kind is searched (nothing else changes)', () => {
  for (const [kind, expected] of [['LAND', 'LAND'], ['APARTMENT', 'APARTMENT'], ['HOUSE', 'HOUSE'], ['COMMERCIAL', 'COMMERCIAL']]) {
    const before = profile(kind, false);
    const after = profile(kind, true);
    assert.equal(before.assetClass, expected, kind);
    assert.equal(marketplaceSearchPlan(before).reason, 'LOCATION_UNKNOWN', `${kind}: no place, no search`);
    assert.equal(marketplaceSearchPlan(after).request?.propertyType, expected, `${kind}: searched as ${expected}`);
    // The view adds a location only: kind, area and city are unchanged.
    assert.equal(after.areaSqm, before.areaSqm, kind);
    assert.equal(after.city, before.city, kind);
  }
  // A view for ANOTHER parcel is never borrowed.
  const other = { results: [{ ...F.storedTasMap, queryEntered: '01.19.19.004.009', frameUrls: F.workerFrameUrls }] };
  assert.equal(centerFromBrowserOfficial(other, PARCEL), null);
});

/* ---- the report: three situations, three different statements, nothing invented ---- */

const SUBJECT = { address: F.tasCaseAddress, area: 14313, propertyKind: 'LAND' };

test('report: location unavailable is said as such, never as "too few comparables"; no numbers appear', () => {
  const m = buildMarketIntelligence(SUBJECT, [], [], { state: 'INSUFFICIENT_DATA', reason: F.eligibilityReason, rejectedCounts: {} });
  assert.equal(m.availability, 'LOCATION_UNAVAILABLE');
  assert.equal(m.valuation.state, 'INSUFFICIENT_EVIDENCE');
  assert.equal(m.valuation.reasonCode, 'LOCATION_UNAVAILABLE', `production stored ${F.storedValuation.reasonCode} here`);
  assert.equal(m.valuation.pricePerSqm, null);
  assert.equal(m.median, null);
  const v = marketView(m);
  assert.equal(v.availability, 'LOCATION_UNAVAILABLE');
  assert.equal(v.insufficiency.titleKey, 'vfm7_insufficient_title_no_location');
  assert.equal(v.insufficiency.bodyKey, 'vfm7_insufficient_body_no_location');
  assert.deepEqual(v.insufficiency.missingKeys, ['vfm7_missing_location']);
  assert.equal(v.comparables.length, 0, 'no comparable is invented');
});

test('report: location known but nothing usable found reads as no comparables (existing wording kept)', () => {
  const m = buildMarketIntelligence(SUBJECT, [], [], { state: 'INSUFFICIENT_DATA', reason: 'TOO_FEW_ELIGIBLE_COMPARABLES', rejectedCounts: { PROPERTY_TYPE_MISMATCH: 4 } });
  assert.equal(m.availability, 'NO_COMPARABLES');
  assert.equal(m.valuation.reasonCode, 'TOO_FEW_DEFENSIBLE_COMPARABLES');
  const v = marketView(m);
  assert.equal(v.insufficiency.titleKey, undefined, 'the existing title stays');
  assert.equal(v.insufficiency.bodyKey, 'vfm6_insufficient_body_land');
});

test('report: comparables found are reported as comparables, with or without a range', () => {
  // The existing market suite's known-good set (same project, same street): a range from three, context from one.
  const APT = { project: 'Villion', address: 'თბილისი, კრწანისის ქუჩა 6', area: 94.1, rooms: 3, floor: 6 };
  const sameProject = (over = {}) => ({ project: 'Villion', address: 'თბილისი, კრწანისის ქუჩა, 6', area: '94.30', price: '174455', currency: 'USD', pricePerSqm: '1850', rooms: '3', comparableType: 'SAME_PROJECT', listingStatus: 'ACTIVE', ...over });
  const range = buildMarketIntelligence(APT, [sameProject({ pricePerSqm: '1800' }), sameProject(), sameProject({ pricePerSqm: '1900' })]);
  assert.equal(range.availability, 'COMPARABLES');
  assert.equal(range.median, 1850);
  assert.equal(range.valuation.reasonCode === 'LOCATION_UNAVAILABLE', false);
  const one = buildMarketIntelligence(APT, [sameProject()]);
  assert.equal(one.availability, 'COMPARABLES', 'listings exist even when a range is withheld');
  // Even with a gate that could not place the subject, real comparables are never hidden as "location unavailable".
  const gated = buildMarketIntelligence(APT, [sameProject()], [], { state: 'INSUFFICIENT_DATA', reason: 'LOCATION_UNKNOWN', rejectedCounts: {} });
  assert.equal(gated.availability, 'COMPARABLES');
});

test('market stage prompt: a missing location is named, so the prose cannot claim a search found nothing', () => {
  const brief = marketEligibilityBrief({ state: 'INSUFFICIENT_DATA', reason: 'LOCATION_UNKNOWN', subject: { assetClass: 'LAND' } });
  assert.match(brief, /NO marketplace search was run/);
  const other = marketEligibilityBrief({ state: 'INSUFFICIENT_DATA', reason: 'TOO_FEW_ELIGIBLE_COMPARABLES', subject: { assetClass: 'LAND' } });
  assert.doesNotMatch(other, /NO marketplace search was run/);
  assert.equal(marketEligibilityBrief({ state: 'OK' }), '');
});
