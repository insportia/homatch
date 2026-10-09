// MARKETPLACE SEARCH foundation — brief, readiness gate, worker contract,
// normalisation, entity resolution, seller and price intelligence, ranking,
// budget upgrades, results intelligence, lifecycle, handoffs, telemetry.
// All data is synthetic (fixtures/marketplaceFixtures.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SEARCH_BRIEF_JSON_SCHEMA, applyEdit, briefFromModel, confirmedFields, emptyBrief, proposedFields,
  sanitizeBrief, statedNumbers, toSearchPlanDraft,
} from '../marketplace/brief.ts';
import { evaluateReadiness, requirementsFor } from '../marketplace/readiness.ts';
import {
  buildSearchRequest, canTransition, eligibleWorkers, isDispatchable, validateCandidate, validateWorkerReport,
} from '../marketplace/worker-contract.ts';
import { normalizeCandidate, validateListing } from '../marketplace/normalize.ts';
import { classifyPair, resolveProperties } from '../marketplace/property-entity.ts';
import { classifySeller } from '../marketplace/seller.ts';
import { localComparison, priceDiscrepancy } from '../marketplace/price-intel.ts';
import { budgetBand, hardFilter } from '../marketplace/ranking.ts';
import { MAX_UPGRADE_RECOMMENDATIONS, isMeaningful, selectUpgrades, whatYouGain } from '../marketplace/upgrade.ts';
import { pageResults, processSearch, publicView } from '../marketplace/pipeline.ts';
import {
  RESULTS_INTELLIGENCE_LIMIT, acceptIntelligence, applyIntelligence, buildFactSheets,
} from '../marketplace/results-intelligence.ts';
import { deriveSearchStatus, progressOf, stagesOf, timedOut } from '../marketplace/lifecycle.ts';
import { compareProperties } from '../marketplace/comparison.ts';
import { investmentHandoff, mortgageHandoff } from '../marketplace/handoff.ts';
import { summarizeTelemetry } from '../marketplace/telemetry.ts';
import { shouldResumeSearch } from '../marketplace/search-entry.ts';
import { normalisePlan, planReadiness } from '../discovery/search-plan.ts';


test('bare Find Property resumes the latest usable result catalogue regardless of age', () => {
  const oldSuccessful = { terminal: true, unavailable: null, createdAt: '2026-01-01T00:00:00.000Z' };
  const oldUnavailable = { terminal: true, unavailable: 'FAILED', createdAt: '2026-01-01T00:00:00.000Z' };
  assert.equal(shouldResumeSearch(oldSuccessful, null, Date.parse('2026-10-07T12:00:00.000Z')), true);
  assert.equal(shouldResumeSearch(oldUnavailable, null, Date.parse('2026-10-07T12:00:00.000Z')), false);
  assert.equal(shouldResumeSearch(oldUnavailable, 'explicit-history-id', Date.parse('2026-10-07T12:00:00.000Z')), true);
});

test('owner Georgian neighborhood is not a city and street preferences are not acquisition districts', () => {
  const text = 'მინდა ვარკეთილში, სუხიშვილის ქუჩისკენ, ან მიკროებში მაღლა მხარეს 2 საძინებლიანი ბინა, ახალ აშენებულ კორპუსში ან მიმდინარეში, მაქსიმუმ 90000$, მინიმუმ 70 კვადრატიდან';
  const brief = briefFromModel({ transactionType:'BUY', propertyType:'APARTMENT', country:'GE',
    city:'ვარკეთილი', districts:['სუხიშვილის ქუჩა','მიკროები'], locationPreferences:['მაღლა მხარეს'],
    priceMinUsd:null,priceMaxUsd:90000,areaMinSqm:70,areaMaxSqm:null,
    bedroomsMin:2,bedroomsMax:2,buildingStatuses:['NEW_BUILD','UNDER_CONSTRUCTION'],userLanguage:'ka' }, text);
  assert.equal(brief.city.value,'Tbilisi');assert.deepEqual(brief.districts.value,['Varketili']);
  assert.deepEqual(brief.locationPreferences,['მაღლა მხარეს','სუხიშვილის ქუჩა','მიკროები']);
  const oldBrief = { ...brief,city:{value:'ვარკეთილი',status:'STATED'},districts:{value:['სუხიშვილის ქუჩა','მიკროები'],status:'STATED'} };
  const canonical = sanitizeBrief(oldBrief);assert.equal(canonical.city.value,'Tbilisi');assert.deepEqual(canonical.districts.value,['Varketili']);
  const req = buildSearchRequest(canonical,{searchId:'s',searchPlanId:'p'});
  assert.equal(req.city,'Tbilisi');assert.deepEqual(req.districts,['Varketili']);assert.equal(req.priceMinUsd,75000);assert.equal(req.priceMaxUsd,90000);
});
import { StaticRateConverter } from '../normalize/currency.ts';
import * as F from './fixtures/marketplaceFixtures.mjs';

const READY_BRIEF = () => briefFromModel(F.COMPLETE_MODEL_OUTPUT, F.COMPLETE_TEXT);
for (const [maximum, minimum] of [[150000, 135000], [200000, 185000], [100000, 85000], [10000, 0]]) {
  test(`max-only USD ${maximum}: canonical primary range, plan and worker agree`, () => {
    const brief = briefFromModel({ ...F.COMPLETE_MODEL_OUTPUT, priceMinUsd: null, priceMaxUsd: maximum }, `${F.COMPLETE_TEXT} up to $${maximum}`);
    assert.deepEqual(brief.price.value, { min: minimum, max: maximum });
    assert.equal(brief.price.status, 'STATED');
    const plan = toSearchPlanDraft(brief);
    assert.equal(plan.budgetMin, minimum); assert.equal(plan.budgetMax, maximum);
    const req = buildSearchRequest(brief, { searchId: 'search', searchPlanId: 'plan' });
    assert.equal(req.priceMinUsd, minimum); assert.equal(req.priceMaxUsd, maximum);
    assert.equal(req.collectPriceMaxUsd, Math.floor(maximum * 1.1));
    const edited = applyEdit(READY_BRIEF(), { field: 'price', value: { min: null, max: maximum } });
    assert.deepEqual(edited.price.value, brief.price.value);
    assert.deepEqual(sanitizeBrief(edited).price.value, brief.price.value);
  });
}
test('explicit USD 120000–150000 stays exact across canonical budget paths', () => {
  const brief = briefFromModel({ ...F.COMPLETE_MODEL_OUTPUT, priceMinUsd: 120000, priceMaxUsd: 150000 }, '$120000 to $150000');
  assert.deepEqual(brief.price.value, { min: 120000, max: 150000 });
  assert.deepEqual(sanitizeBrief(brief).price.value, brief.price.value);
  assert.deepEqual(applyEdit(brief, { field: 'price', value: brief.price.value }).price.value, brief.price.value);
  assert.equal(buildSearchRequest(brief, { searchId: 's', searchPlanId: 'p' }).priceMinUsd, 120000);
});
test('canonical detailed filters enforce known bathrooms and exact floor exclusions after acquisition', () => {
  const facts = { priceUsd: 150000, areaSqm: 100, rooms: 3, bedrooms: 2, bathrooms: 1, floor: 1, totalFloors: 10,
    district: null, buildingStatus: null, renovationStatus: null, parking: null, furnished: null, amenities: [] };
  const req = { ...F.FIXTURE_REQUEST, districts: [], buildingStatuses: [], bathrooms: { min: 2, max: null }, floorPreferences: ['NOT_FIRST', 'NOT_LAST'] };
  assert.deepEqual(hardFilter(facts, req).violations, ['BATHROOMS', 'FLOOR_NOT_FIRST']);
  assert.ok(hardFilter({ ...facts, bathrooms: 2, floor: 10 }, req).violations.includes('FLOOR_NOT_LAST'));
  const unknown = hardFilter({ ...facts, bathrooms: null, floor: null, totalFloors: null }, req);
  assert.ok(unknown.unverified.includes('BATHROOMS')); assert.ok(unknown.unverified.includes('FLOOR_NOT_LAST'));
  assert.equal(unknown.fits, true);
});
const run = (list = F.ALL_FIXTURE_LISTINGS, request = F.FIXTURE_REQUEST, extra = {}) =>
  processSearch({ request, candidates: F.fixtureCandidates(list), now: F.FIXTURE_NOW, ...extra });

/* ───────────────────────── Search Intelligence Brief ───────────────────────── */

test('schema: strict structured output — every property required, no additional properties, nested too', () => {
  const walk = (s, path) => {
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false, path);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), path);
      for (const [k, v] of Object.entries(s.properties)) walk(v, `${path}.${k}`);
    }
    if (s.type === 'array') walk(s.items, `${path}[]`);
  };
  walk(SEARCH_BRIEF_JSON_SCHEMA, 'brief');
});

test('QA 73: the complete Georgian request is fully understood and READY without asking anything', () => {
  const brief = READY_BRIEF();
  assert.equal(brief.transactionType.value, 'BUY');
  assert.equal(brief.propertyType.value, 'APARTMENT');
  assert.deepEqual(brief.districts.value, ['ვაკე']);
  assert.equal(brief.city.value, 'Tbilisi', 'a known Tbilisi district implies the executable city');
  assert.deepEqual(brief.bedrooms.value, { min: 2, max: 2 });
  assert.deepEqual(brief.rooms.value, { min: 3, max: 3 });
  assert.deepEqual(brief.area.value, { min: 80, max: 110 });
  assert.deepEqual(brief.price.value, { min: 120000, max: 160000 });
  assert.deepEqual(brief.buildingStatuses.value, ['NEW_BUILD', 'UNDER_CONSTRUCTION']);
  for (const f of ['price', 'area', 'rooms', 'bedrooms']) assert.equal(brief[f].status, 'STATED', f);
  const r = evaluateReadiness(brief);
  assert.equal(r.state, 'READY');
  assert.equal(r.nextQuestion, null);
  assert.deepEqual(proposedFields(brief), []);
});

test('QA 74: the incomplete request keeps what was said and invents nothing; asks only what is missing', () => {
  const brief = briefFromModel(F.INCOMPLETE_MODEL_OUTPUT, F.INCOMPLETE_TEXT);
  assert.equal(brief.propertyType.value, 'APARTMENT');
  assert.deepEqual(brief.bedrooms.value, { min: 2, max: 2 });
  assert.equal(brief.transactionType, null);
  assert.equal(brief.price, null);
  assert.equal(brief.area, null);
  assert.equal(brief.rooms, null);
  assert.equal(brief.buildingStatuses, null);
  const r = evaluateReadiness(brief);
  assert.equal(r.state, 'INCOMPLETE');
  assert.equal(r.nextQuestion, 'transactionType');
  assert.ok(!r.missing.includes('bedrooms') && !r.missing.includes('location') && !r.missing.includes('propertyType'),
    'understood fields are never asked again');
});

test('a number the customer never typed is PROPOSED, not STATED; proposals never make a search READY', () => {
  const text = 'ვაკეში მინდა საყიდლად 3 ოთახიანი 2 საძინებლიანი ბინა 90 მ², დაახლოებით $150,000';
  const raw = { ...F.COMPLETE_MODEL_OUTPUT, priceMinUsd: 140000, priceMaxUsd: 160000, areaMinSqm: 85, areaMaxSqm: 95 };
  const brief = briefFromModel(raw, text);
  assert.equal(brief.price.status, 'PROPOSED', '140000 and 160000 are not in the text');
  assert.equal(brief.area.status, 'PROPOSED');
  const r = evaluateReadiness(brief);
  assert.equal(r.state, 'INCOMPLETE');
  assert.deepEqual(r.unconfirmed, ['price', 'area']);
  const confirmed = applyEdit(applyEdit(brief, { field: 'confirm', target: 'price' }), { field: 'confirm', target: 'area' });
  assert.equal(evaluateReadiness(confirmed).state, 'READY');
  assert.ok(confirmedFields(confirmed).includes('price'));
});

test('an approximate single price becomes a proposal, never a range', () => {
  const raw = { ...F.COMPLETE_MODEL_OUTPUT, priceMinUsd: null, priceMaxUsd: null, proposals: [{ field: 'price', min: 140000, max: 160000 }] };
  const brief = briefFromModel(raw, 'around $150,000');
  assert.equal(brief.price.status, 'PROPOSED');
  assert.equal(evaluateReadiness(brief).nextQuestion, 'price');
});

test('a price stated in GEL is not converted by guess; the customer is asked in USD', () => {
  const brief = briefFromModel({ ...F.COMPLETE_MODEL_OUTPUT, priceCurrencyStated: 'GEL', priceMinUsd: 300000, priceMaxUsd: 400000 }, '300 000 - 400 000 ლარი');
  assert.equal(brief.price, null);
  assert.deepEqual(brief.dropped, [{ key: 'mps_dropped_currency', value: 'GEL' }]);
});

test('statedNumbers reads grouped digits, k/ათასი multipliers and ranges', () => {
  const n = statedNumbers('80 დან 110 მ² მდე, $120,000 დან 160k-მდე, 1.2 მლნ, 95 ათასი');
  for (const v of [80, 110, 120000, 160000, 1200000, 95000]) assert.ok(n.includes(v), String(v));
});

test('hostile model output: unknown enums, injected place names, wrong types are dropped, never corrected', () => {
  const brief = briefFromModel({
    transactionType: 'STEAL', propertyType: ['APARTMENT'], city: "Tbilisi' or 1=1 --", districts: ['Vake', { x: 1 }, 'a,b'],
    priceMinUsd: -5, priceMaxUsd: 'NaN', roomsMin: 999, buildingStatuses: ['NEW_BUILD', 'CASTLE'], mustHave: ['PARKING', 'MOAT'],
  }, 'x');
  assert.equal(brief.transactionType, null);
  assert.equal(brief.propertyType, null);
  assert.equal(brief.city.value, 'Tbilisi', 'the injected city is dropped; the known district still implies Tbilisi');
  assert.deepEqual(brief.districts.value, ['Vake']);
  assert.equal(brief.price, null);
  assert.equal(brief.rooms, null);
  assert.deepEqual(brief.buildingStatuses.value, ['NEW_BUILD']);
  assert.deepEqual(brief.mustHave, ['PARKING']);
});

test('sanitizeBrief re-validates a client brief; statuses survive, junk does not', () => {
  const b = sanitizeBrief({ ...READY_BRIEF(), price: { value: { min: 'x', max: 100 }, status: 'CONFIRMED' }, rooms: { value: { min: 3, max: 3 }, status: 'HACKED' } });
  assert.deepEqual(b.price, { value: { min: null, max: 100 }, status: 'CONFIRMED' });
  assert.equal(b.rooms, null);
  assert.equal(evaluateReadiness(b).state, 'INCOMPLETE');
});

test('the brief maps onto the existing SearchPlan (one vocabulary with the native matcher), confirmed values only', () => {
  const { plan } = normalisePlan(toSearchPlanDraft(READY_BRIEF()));
  assert.equal(plan.goal, 'BUY');
  assert.deepEqual(plan.budget.value, { min: 120000, max: 160000, currency: 'USD' });
  assert.equal(plan.budget.strength, 'REQUIRED', 'hard constraints stay hard');
  assert.ok(planReadiness(plan).ready);
  const proposed = applyEdit(emptyBrief(), { field: 'transactionType', value: 'MONTHLY_RENT' });
  assert.equal(normalisePlan(toSearchPlanDraft(proposed)).plan.goal, 'RENT');
});

/* ───────────────────────── Readiness gate ───────────────────────── */

test('requirements by property type: land, commercial and office never get residential questions', () => {
  assert.deepEqual(requirementsFor('BUY', 'APARTMENT'), ['transactionType', 'propertyType', 'location', 'price', 'area', 'rooms', 'bedrooms', 'buildingStatus']);
  assert.deepEqual(requirementsFor('BUY', 'PENTHOUSE'), requirementsFor('BUY', 'APARTMENT'));
  assert.deepEqual(requirementsFor('BUY', 'HOUSE'), ['transactionType', 'propertyType', 'location', 'price', 'area', 'rooms', 'bedrooms']);
  assert.deepEqual(requirementsFor('BUY', 'LAND'), ['transactionType', 'propertyType', 'location', 'price', 'area']);
  assert.deepEqual(requirementsFor('BUY', 'COMMERCIAL'), ['transactionType', 'propertyType', 'location', 'price', 'area']);
  assert.deepEqual(requirementsFor('MONTHLY_RENT', 'OFFICE'), ['transactionType', 'propertyType', 'location', 'price', 'area']);
  assert.deepEqual(requirementsFor('MONTHLY_RENT', 'APARTMENT'), ['transactionType', 'propertyType', 'location', 'price', 'area', 'rooms', 'bedrooms']);
  assert.deepEqual(requirementsFor('DAILY_RENT', 'APARTMENT'), ['transactionType', 'propertyType', 'location', 'price', 'rooms', 'bedrooms']);
  assert.deepEqual(requirementsFor(null, null), ['transactionType', 'propertyType', 'location', 'price']);
});

test('readiness: max-only price gets the primary window; explicit min 0 and separate bedrooms survive', () => {
  let b = READY_BRIEF();
  b = applyEdit(b, { field: 'price', value: { min: null, max: 160000 } });
  let r = evaluateReadiness(b);
  assert.deepEqual(r.invalid, []);
  assert.deepEqual(b.price.value, { min: 145000, max: 160000 });
  b = applyEdit(b, { field: 'price', value: { min: 0, max: 160000 } });
  assert.equal(evaluateReadiness(b).state, 'READY');
  b = applyEdit(b, { field: 'bedrooms', value: null });
  r = evaluateReadiness(b);
  assert.deepEqual(r.missing, ['bedrooms'], 'rooms present does not satisfy bedrooms');
  b = applyEdit(b, { field: 'area', value: { min: 110, max: 80 } });
  assert.deepEqual(b.area.value, { min: 80, max: 110 }, 'a backwards range is read in order');
});

test('readiness for each transaction: buy, monthly rent, daily rent', () => {
  const base = (t, p) => {
    let b = emptyBrief('x');
    b = applyEdit(b, { field: 'transactionType', value: t });
    b = applyEdit(b, { field: 'propertyType', value: p });
    b = applyEdit(b, { field: 'city', value: 'Tbilisi' });
    b = applyEdit(b, { field: 'price', value: { min: 50, max: 90 } });
    return b;
  };
  assert.equal(evaluateReadiness(base('DAILY_RENT', 'LAND')).state, 'READY', 'daily land: area not required');
  assert.equal(evaluateReadiness(base('MONTHLY_RENT', 'COMMERCIAL')).nextQuestion, 'area');
  const daily = applyEdit(applyEdit(base('DAILY_RENT', 'APARTMENT'), { field: 'rooms', value: { min: 2, max: 2 } }), { field: 'bedrooms', value: { min: 1, max: 1 } });
  assert.equal(evaluateReadiness(daily).state, 'READY');
  let buyHouse = applyEdit(base('BUY', 'HOUSE'), { field: 'area', value: { min: 100, max: 200 } });
  buyHouse = applyEdit(applyEdit(buyHouse, { field: 'rooms', value: { min: 4, max: null } }), { field: 'bedrooms', value: { min: 3, max: null } });
  assert.equal(evaluateReadiness(buyHouse).state, 'READY', 'no building question for a house');
  const flat = applyEdit(applyEdit(applyEdit(base('BUY', 'APARTMENT'), { field: 'area', value: { min: 60, max: 90 } }),
    { field: 'rooms', value: { min: 3, max: 3 } }), { field: 'bedrooms', value: { min: 2, max: 2 } });
  assert.equal(evaluateReadiness(flat).nextQuestion, 'buildingStatus');
  assert.equal(evaluateReadiness(applyEdit(flat, { field: 'buildingStatuses', value: ['ANY'] })).state, 'READY', '"does not matter" is an answer');
});

/* ───────────────────────── Worker contract ───────────────────────── */

test('the canonical request carries confirmed values only and the +10% collection ceiling', () => {
  const req = buildSearchRequest(READY_BRIEF(), { searchId: 's', searchPlanId: 'p' }, F.FIXTURE_NOW);
  assert.equal(req.priceMaxUsd, 160000);
  assert.equal(req.collectPriceMaxUsd, 176000);
  assert.deepEqual(req.buildingStatuses, ['NEW_BUILD', 'UNDER_CONSTRUCTION']);
  assert.throws(() => buildSearchRequest(briefFromModel(F.INCOMPLETE_MODEL_OUTPUT, F.INCOMPLETE_TEXT), { searchId: 's', searchPlanId: 'p' }));
});

test('registry: a row is not a worker; only ACTIVE + enabled + capable workers are dispatched', () => {
  const w = (over) => ({ workerId: 'w', sourceId: 's', sourceName: 'S', sourceType: 'MARKETPLACE', supportedMarkets: ['GE'], supportedLanguages: ['ka'],
    supportedPropertyTypes: ['APARTMENT'], supportedTransactionTypes: ['BUY'], supportedFilters: [], executionMode: 'BROWSER',
    timeoutMs: 1, maxResults: 1, state: 'ACTIVE', enabled: true, health: { status: 'UNKNOWN', checkedAt: null }, ...over });
  assert.equal(isDispatchable(w({ state: 'PROVEN' })), false);
  assert.equal(isDispatchable(w({ enabled: false })), false);
  assert.equal(isDispatchable(w({})), true);
  const req = { market: 'GE', transactionType: 'BUY', propertyType: 'APARTMENT' };
  assert.equal(eligibleWorkers([w({}), w({ workerId: 'x', supportedTransactionTypes: ['MONTHLY_RENT'] }), w({ workerId: 'y', state: 'REGISTERED' })], req).length, 1);
});

test('worker payload validation: unsafe URLs, foreign sources, oversize and unknown fields are refused', () => {
  assert.equal(validateCandidate({ ...F.listing(), exactUrl: 'javascript:alert(1)' }, 'source-a').reason, 'UNSAFE_OR_MISSING_URL');
  assert.equal(validateCandidate({ ...F.listing(), exactUrl: 'https://user:pw@a.example/x' }, 'source-a').reason, 'UNSAFE_OR_MISSING_URL');
  assert.equal(validateCandidate(F.listing({ source: 'source-b' }), 'source-a').reason, 'SOURCE_MISMATCH');
  const ok = validateCandidate({ ...F.listing(), evil: 'x', images: ['data:image/png;base64,x', 'https://img.example/1.jpg'],
    seller: { publicPhone: 'call me', publicEmail: 'not-an-email', publicProfile: 'ftp://x' } }, 'source-a');
  assert.ok(ok.ok);
  assert.equal('evil' in ok.candidate, false);
  assert.deepEqual(ok.candidate.images, ['https://img.example/1.jpg']);
  assert.equal(ok.candidate.seller.publicPhone, null);
  assert.equal(ok.candidate.seller.publicEmail, null);
  assert.equal(ok.candidate.seller.publicProfile, null);
  const partial = validateCandidate({ source: 'source-a', sourceListingId: '1', exactUrl: 'https://a.example/1' }, 'source-a');
  assert.ok(partial.ok);
  assert.equal(partial.candidate.areaSqm, null, 'partial data is valid and stays missing');
  assert.equal(validateWorkerReport({ status: 'DONE' }, 'a').reason, 'BAD_STATUS');
  assert.equal(validateWorkerReport({ status: 'COMPLETE', listings: Array(501).fill({}) }, 'a').reason, 'TOO_MANY_LISTINGS');
  const rep = validateWorkerReport({ status: 'PARTIAL', listings: [F.listing(), F.listing(), { bad: 1 }], errors: [{ code: 'CAPTCHA' }] }, 'source-a');
  assert.ok(rep.ok && rep.report.final);
  assert.equal(rep.report.listings.length, 1);
  assert.deepEqual(rep.report.rejected.map((r) => r.reason).sort(), ['DUPLICATE_IN_REPORT', 'UNSAFE_OR_MISSING_URL']);
});

test('worker status transitions: terminal never moves; progressive batches allowed', () => {
  assert.ok(canTransition('QUEUED', 'SEARCHING'));
  assert.ok(canTransition('SEARCHING', 'RESULTS_RECEIVED'));
  assert.ok(canTransition('RESULTS_RECEIVED', 'RESULTS_RECEIVED'));
  assert.ok(canTransition('SEARCHING', 'TIMED_OUT'));
  assert.equal(canTransition('COMPLETE', 'SEARCHING'), false);
  assert.equal(canTransition('FAILED', 'COMPLETE'), false);
  assert.equal(canTransition('RESULTS_RECEIVED', 'SEARCHING'), false);
});

/* ───────────────────────── Normalisation and freshness ───────────────────────── */

test('normalisation keeps raw truth, converts only with a real rate, never invents fields', () => {
  const gel = F.listing({ price: 405000, currency: 'GEL' });
  assert.equal(validateListing(gel, F.FIXTURE_REQUEST, { now: F.FIXTURE_NOW }).reason, 'PRICE_NOT_CONVERTIBLE');
  const n = normalizeCandidate(gel, { converter: new StaticRateConverter({ GEL_USD: 0.37 }), now: F.FIXTURE_NOW });
  assert.equal(n.priceUsd, 149850);
  assert.deepEqual(n.priceOriginal, { amount: 405000, currency: 'GEL' });
  assert.equal(n.priceUsdBasis, 'CONVERTED');
  const partial = normalizeCandidate(F.listing({ areaSqm: null, floor: null }), { now: F.FIXTURE_NOW });
  assert.equal(partial.areaSqm, null);
  assert.equal(partial.pricePerSqmUsd, null);
  assert.equal(partial.floor, null);
});

test('freshness: verified only when actually observed now; stale stays stale; old listings flagged', () => {
  const now = normalizeCandidate(F.listing(), { now: F.FIXTURE_NOW });
  assert.equal(now.freshness, 'VERIFIED');
  assert.equal(now.lastVerifiedAt, now.observedAt);
  const stale = normalizeCandidate(F.listing({ observedAt: '2026-09-28T12:00:00Z' }), { now: F.FIXTURE_NOW });
  assert.equal(stale.freshness, 'STALE');
  assert.equal(stale.lastVerifiedAt, null, 'never "verified" without a current verification');
  const old = normalizeCandidate(F.listing({ publishedAt: '2026-01-01T00:00:00Z' }), { now: F.FIXTURE_NOW });
  assert.equal(old.oldListing, true);
});

test('validation refuses the wrong deal, type and city, and listings without a usable price', () => {
  const v = (over) => validateListing(F.listing(over), F.FIXTURE_REQUEST, { now: F.FIXTURE_NOW });
  assert.equal(v({ transactionType: 'MONTHLY_RENT' }).reason, 'TRANSACTION_MISMATCH');
  assert.equal(v({ propertyType: 'LAND' }).reason, 'PROPERTY_TYPE_MISMATCH');
  assert.ok(v({ propertyType: 'PENTHOUSE' }).valid, 'a penthouse is a flat for this purpose');
  assert.equal(v({ city: 'Batumi' }).reason, 'CITY_MISMATCH');
  assert.ok(v({ city: 'თბილისი' }).valid, 'same city in another script is not a conflict');
  assert.equal(v({ price: null }).reason, 'NO_PRICE');
});

/* ───────────────────────── Entity resolution ───────────────────────── */

const norm = (l) => normalizeCandidate(l, { now: F.FIXTURE_NOW });

test('QA 71: three sources, one flat → ONE property, three listings, factual price discrepancy, exact links kept', () => {
  const out = run(F.SAME_PROPERTY_THREE_SOURCES, { ...F.FIXTURE_REQUEST, priceMaxUsd: 190000 });
  assert.equal(out.stats.uniqueProperties, 1);
  const p = out.properties[0];
  assert.equal(p.listings.length, 3);
  assert.equal(p.sourceCount, 3);
  assert.equal(p.facts.priceUsd, 162000, 'the property is shown at its lowest current observed price');
  assert.equal(p.priceDiscrepancy.lowestUsd, 162000);
  assert.equal(p.priceDiscrepancy.highestUsd, 181000);
  assert.equal(p.priceDiscrepancy.differenceUsd, 19000);
  assert.equal(p.priceDiscrepancy.differencePct, 0.1173);
  assert.equal(p.priceDiscrepancy.significant, true);
  assert.deepEqual(p.listings.map((l) => l.exactUrl), [
    'https://source-a.example/listing/a-162', 'https://source-b.example/listing/b-165', 'https://source-c.example/listing/c-181']);
  assert.deepEqual(p.listings.map((l) => l.seller.classification), ['LIKELY_OWNER', 'AGENCY', 'BROKER']);
  assert.ok(p.listings[0].isLowest && p.listings[2].isHighest);
  assert.ok(p.reasons.some((r) => r.code === 'LOWEST_ACROSS_SOURCES' && r.count === 3));
  const text = JSON.stringify(publicView(p)).toLowerCase();
  for (const word of ['scam', 'fraud', 'dishonest', 'untrustworthy']) assert.ok(!text.includes(word), word);
});

test('exact duplicate, likely same, possible same, distinct', () => {
  const a = norm(F.listing({ ...F.CONFIRMED_IDENTITY, sourceListingId: '1' }));
  assert.equal(classifyPair(a, norm(F.listing({ sourceListingId: '1' }))).tier, 'EXACT_DUPLICATE');
  assert.equal(classifyPair(a, norm(F.listing({ ...F.CONFIRMED_IDENTITY, source: 'source-b', sourceListingId: '9', price: 170000 }))).tier, 'LIKELY_SAME_PROPERTY');
  const possible = classifyPair(a, norm(F.listing({ source: 'source-b', sourceListingId: '9', floor: null, district: null, rooms: null })));
  assert.equal(possible.tier, 'DISTINCT_PROPERTY', 'area alone with the same city supplies no unit identity');
  assert.equal(possible.conflict, null, 'missing evidence is not a contradiction');
  assert.equal(classifyPair(a, norm(F.listing({ source: 'source-b', sourceListingId: '9', areaSqm: 120 }))).tier, 'DISTINCT_PROPERTY');
  assert.equal(classifyPair(a, norm(F.listing({ source: 'source-b', sourceListingId: '9', floor: 2 }))).tier, 'DISTINCT_PROPERTY');
  const far = classifyPair(a, norm(F.listing({ source: 'source-b', sourceListingId: '9', price: 300000 })));
  assert.equal(far.tier, 'DISTINCT_PROPERTY', 'price differences never establish unit identity');
});

test('false-merge protection: complete-linkage veto, same-source listings stay separate, possible pairs never merge', () => {
  const a = F.listing({ source: 'source-a', sourceListingId: 'A', areaSqm: 92, floor: null });
  const b = F.listing({ source: 'source-b', sourceListingId: 'B', areaSqm: 93.5, floor: 7 });
  const c = F.listing({ source: 'source-c', sourceListingId: 'C', areaSqm: 95, floor: null });
  const r = resolveProperties([a, b, c].map(norm));
  for (const cl of r.clusters) {
    const areas = cl.memberIds.map((id) => [a, b, c].find((x) => `${x.source}:${x.sourceListingId}` === id).areaSqm);
    assert.ok(Math.max(...areas) / Math.min(...areas) - 1 <= 0.03, 'no chain drags conflicting areas together');
  }
  const sameSource = resolveProperties([F.listing({ sourceListingId: 'P' }), F.listing({ sourceListingId: 'Q' })].map(norm));
  assert.equal(sameSource.clusters.length, 2, 'two listings on one site are two listings unless proven');
  assert.equal(sameSource.possible.length, 0, 'generic dimensions do not even establish a related unit');
});

test('a single shared image hash cannot establish cross-source identity', () => {
  const x = norm(F.listing({ sourceListingId: 'h1', district: null, rooms: null, floor: null, imageHashes: ['ph:abc'] }));
  const y = norm(F.listing({ source: 'source-b', sourceListingId: 'h2', district: null, rooms: null, floor: null, imageHashes: ['ph:abc'] }));
  assert.equal(classifyPair(x, y).tier, 'POSSIBLE_SAME_PROPERTY');
  assert.equal(resolveProperties([x, y]).clusters.length, 2);
  const z = norm(F.listing({ source: 'source-b', sourceListingId: 'h3', district: null, rooms: null, floor: null, imageHashes: ['ph:abc'], areaSqm: 140 }));
  assert.equal(classifyPair(x, z).tier, 'DISTINCT_PROPERTY');
});

/* ───────────────────────── Seller intelligence ───────────────────────── */

test('seller: owner, likely owner, agency, broker, developer, unknown — each with evidence and reason codes', () => {
  const out = run();
  const by = (key) => out.properties.find((p) => p.key === key);
  assert.equal(by('source-a:a-162').seller.classification, 'LIKELY_OWNER');
  assert.equal(by('source-a:a-owner2').seller.classification, 'LIKELY_OWNER');
  assert.equal(by('source-e:e-dev').seller.classification, 'DEVELOPER');
  assert.equal(by('source-b:b-agency').seller.classification, 'AGENCY');
  const broker = by('source-d:d-2');
  assert.equal(broker.seller.classification, 'BROKER');
  assert.ok(broker.seller.reasonCodes.includes('OWNER_CLAIM_NOT_SUPPORTED'), 'a self-declared owner on four properties is not an owner');
  assert.equal(by('source-c:c-partial').seller.classification, 'UNKNOWN');
});

test('seller: an uncorroborated owner claim stays UNKNOWN; VERIFIED_OWNER only from HOMATCH verification', () => {
  const l = norm(F.listing({ seller: { declaredType: 'OWNER' } }));
  assert.equal(classifySeller(l, { propertiesPerPhone: new Map() }).classification, 'UNKNOWN');
  const v = norm(F.listing({ seller: { publicPhone: '+995 599 11 22 33', declaredType: 'OWNER' } }));
  assert.equal(classifySeller(v, { propertiesPerPhone: new Map(), verifiedOwnerPhoneKeys: new Set([v.seller.phoneKey]) }).classification, 'VERIFIED_OWNER');
});

/* ───────────────────────── Price, ranking, groups ───────────────────────── */

test('price discrepancy needs two sources; local comparison needs enough comparables and never claims market value', () => {
  assert.equal(priceDiscrepancy([norm(F.listing())]), null);
  assert.equal(localComparison([{ priceUsd: 1, pricePerSqmUsd: 1 }]).medianPriceUsd, null);
  const lc = localComparison([100, 200, 300, 400, 500].map((p) => ({ priceUsd: p, pricePerSqmUsd: p / 10 })));
  assert.equal(lc.medianPriceUsd, 300);
  assert.equal(lc.comparableCount, 5);
});

test('ranking: hard criteria are hard, unknown is unverified, not cheapest-first, seller type cannot dominate', () => {
  const out = run();
  const keys = out.properties.map((p) => p.key);
  assert.ok(!keys.includes('source-c:c-saburtalo'), 'wrong district is excluded');
  assert.ok(!keys.includes('source-c:c-too-high'), 'above the 10% ceiling is never shown');
  const partial = out.properties.find((p) => p.key === 'source-c:c-partial');
  assert.deepEqual(partial.unverified.sort(), ['AREA', 'BUILDING_STATUS']);
  const best = out.properties.filter((p) => p.group === 'BEST');
  assert.ok(best.length > 0 && best.length <= 6);
  const prices = best.map((p) => p.facts.priceUsd);
  assert.notDeepEqual(prices, [...prices].sort((x, y) => x - y), 'best matches are not simply cheapest first');
  for (const p of out.properties) {
    const c = p.internal.components;
    for (const v of Object.values(c)) assert.ok(v >= 0 && v <= 1);
    assert.ok(c.seller * 0.06 + c.ownerPreference * 0.04 <= 0.1, 'seller signals are at most 10% of the score');
  }
  const stale = out.properties.find((p) => p.key === 'source-b:b-stale');
  assert.equal(stale.group, 'MORE', 'a stale listing is never a best match');
});

test('groups: best, owner opportunities, worth considering, more — no property twice', () => {
  const out = run();
  const keys = out.properties.map((p) => p.key);
  assert.equal(new Set(keys).size, keys.length);
  const upgrade = out.properties.filter((p) => p.group === 'UPGRADE');
  assert.deepEqual(upgrade.map((p) => p.key), ['source-a:a-upgrade']);
  assert.ok(upgrade[0].upgrade.advantages.length >= 2);
  assert.equal(upgrade[0].upgrade.overMaxPct, 0.053);
});

test('pagination: a page at a time, bounded size, stable offsets', () => {
  const out = run();
  const page = pageResults(out, 'MORE', 0, 2);
  assert.equal(page.items.length, 2);
  assert.equal(page.nextOffset, 2);
  const last = pageResults(out, 'MORE', page.total - 1, 2);
  assert.equal(last.nextOffset, null);
  assert.equal(pageResults(out, 'BEST', 0, 10_000).items.length <= 48, true);
  assert.equal('internal' in publicView(out.properties[0]), false, 'ranking internals never reach a customer');
});

/* ───────────────────────── Budget upgrade ───────────────────────── */

test('QA 70: budget boundaries at a $150,000 maximum', () => {
  const band = (p) => budgetBand(p, 100000, 150000);
  assert.equal(band(150000), 'IN_BUDGET');
  assert.equal(band(150001), 'UPGRADE_PREFERRED');
  assert.equal(band(157500), 'UPGRADE_PREFERRED');
  assert.equal(band(157501), 'UPGRADE_EXTENDED');
  assert.equal(band(165000), 'UPGRADE_EXTENDED');
  assert.equal(band(165001), 'ABOVE_CEILING');
  assert.equal(band(170000), 'ABOVE_CEILING');
  assert.equal(band(99999), 'BELOW_MIN');
});

const upgradeCase = (over) => ({ key: 'u', band: 'UPGRADE_PREFERRED', fits: true, criteriaScore: 1, freshness: 'VERIFIED', seller: 'UNKNOWN', score: 0.8,
  facts: { priceUsd: 155000, pricePerSqmUsd: 1685, areaSqm: 92, rooms: 3, bedrooms: 2, bathrooms: 1, floor: 5, totalFloors: 10, city: 'Tbilisi', district: 'Vake',
    buildingStatus: 'NEW_BUILD', renovationStatus: 'RENOVATED', parking: null, furnished: null, amenities: [] }, ...over });
const baselineCase = upgradeCase({ key: 'b', band: 'IN_BUDGET', score: 0.9,
  facts: { ...upgradeCase().facts, priceUsd: 148000, pricePerSqmUsd: 1609 } });

test('QA 70: a $155,000 property with no meaningful advantage is NOT recommended just for fitting under 10%', () => {
  const picks = selectUpgrades([baselineCase, upgradeCase({})], { maxUsd: 150000, districts: ['Vake'] });
  assert.deepEqual(picks, []);
});

test('upgrades: only 5–10%; advantages are measured facts; never more than three', () => {
  const better = (key, price, band) => upgradeCase({ key, band, facts: { ...upgradeCase().facts, priceUsd: price, areaSqm: 108, pricePerSqmUsd: Math.round(price / 108), parking: true } });
  const picks = selectUpgrades([
    { ...baselineCase, facts: { ...baselineCase.facts, parking: false } }, better('e1', 164000, 'UPGRADE_EXTENDED'), better('p1', 157500, 'UPGRADE_PREFERRED'),
    better('p2', 158000, 'UPGRADE_EXTENDED'), better('e2', 165000, 'UPGRADE_EXTENDED'), better('x', 165001, 'ABOVE_CEILING'), better('too-small', 156000, 'UPGRADE_PREFERRED'),
  ], { maxUsd: 150000, districts: ['Vake'] });
  assert.equal(picks.length, MAX_UPGRADE_RECOMMENDATIONS);
  assert.deepEqual(picks.map((p) => p.key).slice(0, 2).sort(), ['p1', 'p2']);
  assert.ok(!picks.some((p) => p.key === 'x'));
  const g = picks[0].gain;
  assert.equal(g.extraAreaSqm, 16);
  assert.ok(g.advantages.some((a) => a.code === 'MORE_AREA' && a.delta === 16));
  assert.ok(g.advantages.some((a) => a.code === 'PARKING'));
  assert.equal(typeof g.extraPriceUsd, 'number');
});

test('upgrades: a candidate in a worse location or with fewer bedrooms is never "worth considering"', () => {
  const worse = upgradeCase({ facts: { ...upgradeCase().facts, district: 'Didube', areaSqm: 120, parking: true } });
  assert.equal(isMeaningful(whatYouGain(baselineCase, worse, { maxUsd: 150000, districts: ['Vake'] })), false);
  const fewer = upgradeCase({ facts: { ...upgradeCase().facts, bedrooms: 1, areaSqm: 120, parking: true } });
  assert.equal(isMeaningful(whatYouGain(baselineCase, fewer, { maxUsd: 150000, districts: ['Vake'] })), false);
  assert.deepEqual(selectUpgrades([upgradeCase({ facts: { ...upgradeCase().facts, areaSqm: 130 } })], { maxUsd: 150000, districts: [] }), [],
    'no in-budget alternative, no upgrade section');
});

/* ───────────────────────── Results intelligence ───────────────────────── */

test('results intelligence: bounded input, evidence-only codes, unknown keys and invented codes dropped, upgrade veto only', () => {
  const out = run();
  const sheets = buildFactSheets(out.properties);
  assert.ok(sheets.length <= RESULTS_INTELLIGENCE_LIMIT);
  assert.equal(JSON.stringify(sheets).includes('exactUrl'), false, 'no raw listing reaches the model');
  const upgradeKey = 'source-a:a-upgrade';
  const best = out.properties.find((p) => p.group === 'BEST');
  const { accepted, discarded } = acceptIntelligence({ properties: [
    { key: best.key, reasons: ['VERIFIED_RECENTLY', 'SEA_VIEW', 'DISTRICT_MATCH'], tradeoffs: ['FLOOR_NOT_STATED', 'HAUNTED'], upgradeWorthIt: true },
    { key: 'invented', reasons: [], tradeoffs: [], upgradeWorthIt: null },
    { key: upgradeKey, reasons: [], tradeoffs: [], upgradeWorthIt: false },
  ] }, sheets);
  assert.ok(discarded >= 3);
  const a = accepted.find((x) => x.key === best.key);
  assert.deepEqual(a.reasons, ['VERIFIED_RECENTLY', 'DISTRICT_MATCH']);
  assert.equal(a.upgradeWorthIt, null, 'a non-upgrade cannot be judged as one');
  const applied = applyIntelligence(out.properties, accepted);
  assert.equal(applied.find((p) => p.key === best.key).reasons[0].code, 'VERIFIED_RECENTLY');
  assert.ok(!applied.some((p) => p.key === upgradeKey), 'the model may veto an upgrade');
  assert.equal(applied.length, out.properties.length - 1, 'it can never add a property');
});

/* ───────────────────────── Lifecycle and progressive results ───────────────────────── */

test('lifecycle: independent workers — one failure never fails the search; partial completion is a result', () => {
  const { complete, failed, searching } = F.WORKER_RUNS;
  assert.equal(deriveSearchStatus('SEARCHING', [complete, failed], { properties: 4, strongMatches: 2 }).status, 'PARTIAL_COMPLETE');
  assert.equal(deriveSearchStatus('SEARCHING', [complete, { ...complete, workerId: 'b' }], { properties: 4, strongMatches: 2 }).status, 'COMPLETE');
  assert.equal(deriveSearchStatus('SEARCHING', [failed, { ...failed, workerId: 'x', status: 'TIMED_OUT' }], { properties: 0, strongMatches: 0 }).status, 'FAILED');
  assert.equal(deriveSearchStatus('DISPATCHING', [], { properties: 0, strongMatches: 0 }).failureReason, 'NO_ELIGIBLE_WORKERS');
  assert.equal(deriveSearchStatus('CANCELLED', [complete], { properties: 9, strongMatches: 9 }).status, 'CANCELLED');
});

test('progressive results as soon as one real property exists; a slow worker does not hold them back', () => {
  const { complete, searching } = F.WORKER_RUNS;
  assert.equal(deriveSearchStatus('SEARCHING', [complete, searching], { properties: 6, strongMatches: 3 }).status, 'RESULTS_AVAILABLE');
  assert.equal(deriveSearchStatus('SEARCHING', [complete, searching], { properties: 1, strongMatches: 0 }).status, 'RESULTS_AVAILABLE');
  assert.equal(deriveSearchStatus('SEARCHING', [complete, searching], { properties: 0, strongMatches: 0 }).status, 'SEARCHING');
  assert.equal(deriveSearchStatus('SEARCHING', [{ ...searching, status: 'RESULTS_RECEIVED' }], { properties: 0, strongMatches: 0 }).status, 'PROCESSING');
});

test('timeouts and real progress: no invented percentages', () => {
  const runs = Object.values(F.WORKER_RUNS);
  assert.deepEqual(timedOut(runs, F.FIXTURE_NOW), ['source-g-worker']);
  const p = progressOf(runs);
  assert.deepEqual([p.sourcesTotal, p.sourcesCompleted, p.sourcesFailed], [4, 2, 1]);
  assert.equal(p.fraction, 0.5);
  assert.equal(progressOf([]).fraction, null);
  const stages = stagesOf({ discovered: 12, validated: 0, uniqueProperties: 0, processed: false, terminal: false });
  assert.deepEqual(stages.map((s) => s.state), ['DONE', 'ACTIVE', 'PENDING', 'PENDING', 'PENDING']);
});

/* ───────────────────────── Large search ───────────────────────── */

test('QA 72: 1,000 raw listings reduce deterministically without an all-pairs blow-up; output is bounded', () => {
  const raw = F.largeFixture(1000);
  const req = { ...F.FIXTURE_REQUEST, districts: [], priceMinUsd: 0, priceMaxUsd: 500000, areaMinSqm: 0, areaMaxSqm: 1000, rooms: null, bedrooms: null, buildingStatuses: [] };
  const started = Date.now();
  const a = run(raw, req);
  const elapsed = Date.now() - started;
  const b = run([...raw].reverse(), req);
  assert.equal(a.stats.raw, 1000);
  assert.ok(a.stats.uniqueProperties < 1000 && a.stats.duplicatesCollapsed > 0);
  assert.equal(a.stats.uniqueProperties, b.stats.uniqueProperties, 'input order does not change the result');
  assert.ok(a.stats.comparisons < (1000 * 999) / 2 / 4, `blocking keeps comparisons bounded (${a.stats.comparisons})`);
  assert.ok(elapsed < 10_000, `processed in ${elapsed} ms`);
  assert.ok(buildFactSheets(a.properties).length <= RESULTS_INTELLIGENCE_LIMIT, 'only the strongest few reach OpenAI');
  assert.ok(pageResults(a, 'MORE', 0, 24).items.length <= 24, 'the browser receives a page, never the raw set');
});

/* ───────────────────────── Comparison and handoffs ───────────────────────── */

test('comparison: factual rows, per-field direction only where objective, never an overall winner', () => {
  const out = run();
  const a = out.properties.find((p) => p.group === 'BEST');
  const u = out.properties.find((p) => p.group === 'UPGRADE');
  const rows = compareProperties(
    { key: a.key, facts: a.facts, freshness: a.freshness.state, lastVerifiedAt: a.freshness.lastVerifiedAt, seller: a.seller.classification, sourceCount: a.sourceCount },
    { key: u.key, facts: u.facts, freshness: u.freshness.state, lastVerifiedAt: u.freshness.lastVerifiedAt, seller: u.seller.classification, sourceCount: u.sourceCount });
  assert.equal(rows.find((r) => r.field === 'price').ahead, 'A');
  assert.equal(rows.find((r) => r.field === 'area').ahead, 'B');
  assert.equal(rows.find((r) => r.field === 'seller').ahead, null);
  assert.ok(!rows.some((r) => r.field === 'winner'));
});

test('Investment and Mortgage handoffs pass only stated facts and compute nothing', () => {
  const p = run().properties.find((x) => x.key === 'source-c:c-partial');
  const inv = investmentHandoff(p, 'APARTMENT');
  assert.equal(inv.askingPrice, 155000);
  assert.equal(inv.areaSqm, null, 'not stated, not passed');
  assert.equal(inv.floor, null);
  for (const k of ['roi', 'yield', 'monthlyRent', 'appreciation']) assert.equal(k in inv, false);
  assert.deepEqual(mortgageHandoff(p), { price: 155000, currency: 'USD' });
  assert.equal(mortgageHandoff({ facts: { priceUsd: null } }), null);
  const m = mortgageHandoff(p);
  for (const k of ['rate', 'monthlyPayment', 'downPayment', 'term']) assert.equal(k in m, false);
});

test('cost telemetry: unknown cost stays unknown, never zero', () => {
  const s = summarizeTelemetry({
    ai: [{ call: 'SEARCH_INTELLIGENCE', model: 'm', inputTokens: 900, outputTokens: 200, costUsd: 0.0012, ok: true, at: 'x' }],
    workers: [{ workerId: 'w', durationMs: 5000, returnedCount: 3, pagesVisited: 4, bytesTransferred: 1, browserMs: 4000, estimatedCostUsd: null }],
    processingMs: [40, 20],
  });
  assert.equal(s.aiCostUsd, 0.0012);
  assert.equal(s.workerCostUsd, null);
  assert.equal(s.totalCostUsd, null);
  assert.equal(s.processingMs, 60);
  assert.equal(s.aiInputTokens, 900);
});
