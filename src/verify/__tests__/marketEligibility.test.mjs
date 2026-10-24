// F6 (Verify V1 market defect, 2026-10-22): the subject's market profile comes
// from the register, and a deterministic eligibility gate decides which
// listings may describe it. Fixtures are production jobs 61c1c38c (a land plot
// that was valued from 103 city-wide flats) and 8ba97da9 (a Krtsanisi flat).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  subjectMarketProfile, marketplaceSearchPlan, applyMarketEligibility, rangeBasis, marketEligibilityBrief, AREA_TOLERANCE, MIN_ELIGIBLE_FOR_RANGE, localityOf,
} from '../marketEligibility.ts';
import { buildResearchSeed } from '../researchSeed.ts';
import { marketProfileFromSeed, toReportComparable, dedupeMarketplace } from '../marketplaceComparables.ts';
import { refreshProfile, foldMarketRefresh } from '../marketRefresh.ts';
import { buildMarketIntelligence } from '../intelligence/marketIntelligence.ts';
import { marketView } from '../marketPresentation.ts';
import { kindsCompatible } from '../intelligence/marketHierarchy.ts';
import * as LAND from './fixtures/landPlot61c1c38cFixture.mjs';
import * as FLAT from './fixtures/apartment8ba97da9MarketFixture.mjs';

const FX = { date: '2026-10-22', gelPerUsd: 2.7, source: 'National Bank of Georgia' };
const seedOf = (result, query) => buildResearchSeed({ jobId: 'j', query, mode: 'cadastral', result, knownFacts: {} });

/* ---------------- the land plot (job 61c1c38c) ---------------- */

test('61c1c38c root cause: the old seed path produced exactly the production profile', () => {
  const seed = seedOf(LAND.RESULT, '01.14.07.001.044');
  // identity.assetClass APARTMENT_IN_PROJECT → APARTMENT; the register's area is never read; no district in the address.
  assert.equal(seed.property.propertyType?.value, 'APARTMENT');
  assert.equal(seed.property.areaSqm, null);
  assert.equal(seed.location.district, null);
});

test('61c1c38c: the register makes it LAND with its 2,509 m², and no portal search runs without a district', () => {
  const p = subjectMarketProfile({ result: LAND.RESULT, seed: seedOf(LAND.RESULT, '01.14.07.001.044'), registerLatest: LAND.REGISTER_LATEST });
  assert.equal(p.assetClass, 'LAND');
  assert.equal(p.assetClassBasis, 'REGISTRY');
  assert.equal(p.areaSqm, 2509);
  assert.equal(p.areaBasis, 'REGISTRY_LAND');
  assert.equal(p.rooms, null);
  const plan = marketplaceSearchPlan(p);
  assert.equal(plan.request, null, 'never a city-wide land (or apartment) search');
  assert.equal(plan.reason, 'LOCATION_UNKNOWN');
});

test('61c1c38c: before the register is read, the identity guess never starts a search', () => {
  const p = subjectMarketProfile({ result: LAND.RESULT, seed: seedOf(LAND.RESULT, '01.14.07.001.044'), registerLatest: null });
  // A five-group parcel code with a named project reads as that project (a7177a89) — still only a guess.
  assert.equal(p.assetClass, 'DEVELOPMENT_PROJECT');
  assert.equal(p.assetClassBasis, 'IDENTITY');
  assert.deepEqual(marketplaceSearchPlan(p, { requireRegistry: true }), { request: null, reason: 'AWAITING_REGISTRY' });
});

test('61c1c38c: the 103 stored comparables → zero accepted, insufficient data, no range', () => {
  const p = subjectMarketProfile({ result: LAND.RESULT, seed: seedOf(LAND.RESULT, '01.14.07.001.044'), registerLatest: LAND.REGISTER_LATEST });
  assert.equal(LAND.COMPARABLES.length, 103);
  const gate = applyMarketEligibility(LAND.COMPARABLES, p, { fx: FX });
  assert.equal(gate.accepted.length, 0, 'no apartment ever describes a plot');
  assert.equal(gate.state, 'INSUFFICIENT_DATA');
  assert.equal(gate.valuationAllowed, false);
  assert.equal(gate.rejected.length, 103);
  assert.equal(gate.rejectedCounts.PROPERTY_TYPE_MISMATCH, 103);
  assert.ok(gate.rejected.every((r) => r.reasons.length > 0));
  assert.deepEqual(rangeBasis(gate), { kept: [], outliersTrimmed: 0 });
  // The city-wide adverts are also rejected on place, the 35–56 m² flats on size.
  assert.ok(gate.rejectedCounts.LOCATION_WIDER_MARKET >= 96);
  assert.ok(gate.rejectedCounts.SIZE_OUT_OF_BAND >= 96);
});

test('61c1c38c as a development project: only its own new-build asks survive; never city flats; still no range', () => {
  const result = { ...LAND.RESULT, identity: { ...LAND.RESULT.identity, entity: { type: LAND.ENTITY_TYPE_WITH_BUILDINGS } } };
  const p = subjectMarketProfile({ result, seed: seedOf(result, '01.14.07.001.044'), registerLatest: LAND.REGISTER_LATEST });
  assert.equal(p.assetClass, 'DEVELOPMENT_PROJECT');
  // Owner 2026-10-24: a project is searched too — the area's new-build apartments, of every size.
  assert.equal(marketplaceSearchPlan(p).reason, 'LOCATION_UNKNOWN', 'this fixture names no district: still no city-wide search');
  const plan = marketplaceSearchPlan({ ...p, city: 'თბილისი', district: 'ვაკე' });
  assert.equal(plan.reason, null);
  assert.deepEqual([plan.request.propertyType, plan.request.areaSqm], ['APARTMENT', null]);
  const gate = applyMarketEligibility(LAND.COMPARABLES, p, { fx: FX });
  assert.deepEqual(gate.accepted.map((c) => c.project), ['მეტროპოლ ბაგები', 'მეტროპოლ ბაგები']);
  assert.ok(gate.accepted.every((c) => c.discoveryMethod !== 'MARKETPLACE_WORKER_SEARCH'));
  assert.equal(gate.valuationAllowed, false, `${gate.accepted.length} < ${MIN_ELIGIBLE_FOR_RANGE}`);
  assert.equal(gate.reason, 'TOO_FEW_ELIGIBLE_COMPARABLES');
});

test('61c1c38c end to end: the report market is EVIDENCE_LIMITED, says why, and renders with existing keys', () => {
  const p = subjectMarketProfile({ result: LAND.RESULT, seed: seedOf(LAND.RESULT, '01.14.07.001.044'), registerLatest: LAND.REGISTER_LATEST });
  const gate = applyMarketEligibility(LAND.COMPARABLES, p, { fx: FX });
  const market = buildMarketIntelligence({ propertyKind: 'LAND', area: 2509, dealType: 'SALE', currency: 'USD' }, gate.accepted, [], { state: gate.state, rejectedCounts: gate.rejectedCounts });
  assert.ok(market, 'an insufficient market is still answered, not dropped');
  assert.equal(market.headline.state, 'EVIDENCE_LIMITED');
  assert.equal(market.median, null);
  assert.equal(market.valuation.state, 'INSUFFICIENT_EVIDENCE');
  assert.equal(market.valuation.pricePerSqm, null);
  assert.equal(market.hierarchy.excluded.PROPERTY_TYPE_MISMATCH, 103);
  const view = marketView(market);
  assert.equal(view.headline.state, 'EVIDENCE_LIMITED');
  assert.equal(view.comparables.length, 0);
  assert.ok(view.insufficiency.missingKeys.includes('vfm6_missing_same_kind_land'));
  assert.ok(view.method.excluded.some((e) => e.key === 'vfm6_ex_other_kind'));
  // Without the gate, an empty pool still means "no market section" as before.
  assert.equal(buildMarketIntelligence({ propertyKind: 'LAND' }, [], []), null);
});

test('the MARKET prompt is told not to value when the gate says insufficient; silent otherwise', () => {
  const brief = marketEligibilityBrief({ state: 'INSUFFICIENT_DATA', reason: 'LOCATION_UNKNOWN', subject: { assetClass: 'LAND' } });
  assert.match(brief, /Do NOT produce, estimate or imply a valuation/);
  assert.match(brief, /same property class \(LAND\)/);
  assert.equal(marketEligibilityBrief({ state: 'OK' }), '');
  assert.equal(marketEligibilityBrief(null), '');
});

test('web-found URLs the MARKET model appends pass the same gate (land subject)', () => {
  const p = subjectMarketProfile({ result: LAND.RESULT, seed: seedOf(LAND.RESULT, '01.14.07.001.044'), registerLatest: LAND.REGISTER_LATEST });
  const modelAdded = [
    { source: 'web', url: 'https://example.ge/flat-in-bagebi', area: '80', price: '160000', currency: 'USD', pricePerSqm: '2000', comparableType: 'MICRO_LOCATION', propertyType: 'RESIDENTIAL', address: 'ბაგები, თბილისი' },
    { source: 'web', url: 'https://example.ge/land-in-bagebi', area: '2400', price: '600000', currency: 'USD', pricePerSqm: '250', comparableType: 'MICRO_LOCATION', propertyType: 'LAND', address: 'ბაგები, თბილისი' },
  ];
  const gate = applyMarketEligibility(modelAdded, { ...p, district: 'ბაგები', areaKey: 'BAGEBI' }, { fx: FX });
  assert.deepEqual(gate.accepted.map((c) => c.url), ['https://example.ge/land-in-bagebi']);
  assert.deepEqual(gate.rejected[0].reasons, ['PROPERTY_TYPE_MISMATCH', 'SIZE_OUT_OF_BAND']);
});

/* ---------------- the apartment (job 8ba97da9) ---------------- */

const flatProfile = () => subjectMarketProfile({ result: FLAT.RESULT, seed: seedOf(FLAT.RESULT, '01.18.06.019.055.03.01.601'), registerLatest: FLAT.REGISTER_LATEST });

test('8ba97da9: the register supplies the unit area production searched without', () => {
  const p = flatProfile();
  assert.equal(p.assetClass, 'APARTMENT');
  assert.equal(p.areaSqm, 94.1);
  assert.equal(p.areaBasis, 'REGISTRY_UNIT');
  assert.equal(p.areaKey, 'KRTSANISI');
  const plan = marketplaceSearchPlan(p);
  assert.deepEqual(plan.request, { city: 'თბილისი', district: p.district, transactionType: 'BUY', propertyType: 'APARTMENT', areaSqm: 94.1, rooms: null, priceUsd: null });
  assert.notEqual(FLAT.PRODUCTION_PROFILE.areaSqm, plan.request.areaSqm);
});

test('8ba97da9: same-district similar-size flats accepted; rent, citywide, out-of-band and EUR excluded; GEL converted; outlier trimmed', () => {
  const p = flatProfile();
  const gate = applyMarketEligibility(FLAT.COMPARABLES, p, { fx: FX });
  const band = AREA_TOLERANCE.APARTMENT * 94.1;
  assert.ok(gate.accepted.length >= MIN_ELIGIBLE_FOR_RANGE);
  assert.ok(gate.accepted.every((c) => Math.abs(Number(c.area) - 94.1) <= band), 'all within ±35 %');
  assert.ok(gate.accepted.every((c) => c.currency === 'USD'), 'one currency');
  assert.ok(gate.accepted.every((c) => c.comparableType !== 'WIDER_MARKET'));
  const gel = gate.accepted.find((c) => c.url.endsWith('36981370'));
  assert.equal(gel.originalCurrency, 'GEL');
  assert.equal(gel.pricePerSqm, String(Math.round((3794.87 / 2.7) * 100) / 100));
  assert.equal(gel.fxConversion.gelPerUsd, 2.7);
  assert.equal(gel.fxConversion.date, '2026-10-22');
  const why = (suffix) => gate.rejected.find((r) => r.url?.endsWith(suffix))?.reasons ?? [];
  assert.ok(why('90000001').includes('DEAL_TYPE_MISMATCH'), 'rent never mixed with sale');
  assert.ok(why('90000003').includes('CURRENCY_UNCONVERTIBLE'));
  assert.ok(why('90000004').includes('LOCATION_WIDER_MARKET'), 'a Didi Dighomi advert is not Krtsanisi');
  assert.ok(why('36983184').includes('SIZE_OUT_OF_BAND'), '30 m² is not a 94 m² flat');
  assert.ok(why('33664293').includes('SIZE_OUT_OF_BAND'));
  assert.equal(gate.valuationAllowed, true);
  const basis = rangeBasis(gate);
  assert.ok(basis.outliersTrimmed >= 1);
  assert.ok(!basis.kept.some((c) => c.url.endsWith('90000002')), 'the $10,000/m² ask is trimmed');
  const values = basis.kept.map((c) => Number(c.pricePerSqm));
  assert.ok(Math.max(...values) < 4000 && Math.min(...values) > 1000);
});

test('8ba97da9: without an NBG rate a GEL advert is excluded, never averaged as if it were USD', () => {
  const gate = applyMarketEligibility(FLAT.COMPARABLES, flatProfile(), { fx: null });
  assert.ok(gate.rejected.find((r) => r.url.endsWith('36981370')).reasons.includes('CURRENCY_UNCONVERTIBLE'));
  assert.ok(gate.accepted.every((c) => c.currency === 'USD' && !c.originalCurrency));
});

test('gate is idempotent: re-gating the accepted set changes nothing (MARKET → SYNTHESIS)', () => {
  const p = flatProfile();
  const once = applyMarketEligibility(FLAT.COMPARABLES, p, { fx: FX });
  const twice = applyMarketEligibility(once.accepted, p, { fx: FX });
  assert.deepEqual(twice.accepted, once.accepted);
  assert.equal(twice.rejected.length, 0);
});

test('rooms ±1 for residential units when known; duplicates by listing id across portals', () => {
  const p = { ...flatProfile(), rooms: 3 };
  const mk = (url, rooms) => ({ source: 'ss.ge', url, area: '90', rooms: String(rooms), price: '200000', currency: 'USD', pricePerSqm: '2222', comparableType: 'SAME_DISTRICT', propertyType: 'RESIDENTIAL', district: 'ორთაჭალა' });
  const gate = applyMarketEligibility([
    mk('https://home.ss.ge/ka/udzravi-qoneba/a-11111111', 3),
    mk('https://home.ss.ge/ka/udzravi-qoneba/b-22222222', 5),
    mk('https://www.ss.ge/x/11111111', 3),
  ], p, { fx: FX });
  assert.equal(gate.accepted.length, 1);
  assert.deepEqual(gate.rejected.map((r) => r.reasons), [['ROOMS_MISMATCH'], ['DUPLICATE']]);
});

test('measured distance overrides any label', () => {
  const p = { ...flatProfile() };
  const c = { source: 'myhome.ge', url: 'https://www.myhome.ge/pr/77777777/', area: '90', price: '200000', currency: 'USD', pricePerSqm: '2222', comparableType: 'SAME_DISTRICT', propertyType: 'RESIDENTIAL', distanceM: 4200 };
  assert.deepEqual(applyMarketEligibility([c], p, { fx: FX }).rejected[0].reasons, ['TOO_FAR']);
  assert.equal(applyMarketEligibility([{ ...c, distanceM: 300, comparableType: 'WIDER_MARKET' }], p, { fx: FX }).accepted.length, 1);
});

/* ---------------- missing attributes ---------------- */

test('missing attributes never widen the search: unknown type / area / district → no request, with the reason', () => {
  const p = flatProfile();
  assert.equal(marketplaceSearchPlan({ ...p, assetClass: 'UNKNOWN', assetClassBasis: null }).reason, 'PROPERTY_TYPE_UNKNOWN');
  assert.equal(marketplaceSearchPlan({ ...p, areaSqm: null }).reason, 'AREA_UNKNOWN');
  assert.equal(marketplaceSearchPlan({ ...p, district: null }).reason, 'LOCATION_UNKNOWN');
  assert.equal(marketplaceSearchPlan({ ...p, assetClass: 'MIXED' }).reason, 'PROPERTY_TYPE_NOT_SEARCHABLE');
  assert.equal(marketplaceSearchPlan({ ...p, assetClass: 'PARKING', areaSqm: 19.7 }).request.propertyType, 'PARKING', 'parking is searched (owner 2026-10-24)');
  const gate = applyMarketEligibility(FLAT.COMPARABLES, { ...p, areaSqm: null }, { fx: FX });
  assert.equal(gate.accepted.length, 0);
  assert.equal(gate.reason, 'AREA_UNKNOWN');
});

test('marketProfileFromSeed no longer turns an unknown type into APARTMENT', () => {
  assert.equal(marketProfileFromSeed({ location: { city: { value: 'თბილისი' } }, property: {} }), null);
  assert.equal(marketProfileFromSeed({ location: { city: { value: 'თბილისი' } }, property: { propertyType: { value: 'APARTMENT' } } }).propertyType, 'APARTMENT');
});

test('kindsCompatible: land, like parking, needs a listing stated as such', () => {
  assert.equal(kindsCompatible('LAND', null), false);
  assert.equal(kindsCompatible('LAND', 'APARTMENT'), false);
  assert.equal(kindsCompatible('LAND', 'LAND'), true);
  assert.equal(kindsCompatible('APARTMENT', null), true);
});

test('worker adverts carry their portal type and deal, so a rental or a house cannot pass as a sale flat', () => {
  const base = { source: 'MYHOME', sourceListingId: '9', exactUrl: 'https://www.myhome.ge/pr/9/', price: 900, currency: 'USD', pricePerSqm: 10, areaSqm: 90, rooms: 3, bedrooms: 2,
    floor: 3, totalFloors: 9, city: 'თბილისი', district: 'ორთაჭალა', address: 'x', latitude: null, longitude: null, propertyType: 'HOUSE', transactionType: 'MONTHLY_RENT',
    buildingStatus: null, renovationStatus: null, title: null, publishedAt: null, updatedAt: null, observedAt: '2026-10-22T00:00:00Z', imageHashes: [], phoneHash: null, scope: 'DISTRICT' };
  const rc = toReportComparable(dedupeMarketplace([base]).unique[0], { project: null, latitude: null, longitude: null, district: 'ორთაჭალა' });
  assert.equal(rc.sourcePropertyType, 'HOUSE');
  assert.equal(rc.transactionType, 'MONTHLY_RENT');
  const gate = applyMarketEligibility([rc], flatProfile(), { fx: FX });
  assert.deepEqual(gate.rejected[0].reasons, ['PROPERTY_TYPE_MISMATCH', 'DEAL_TYPE_MISMATCH']);
});

test('a market refresh is re-profiled from the register and its fold is gated (no replay of the bad search)', () => {
  const rj = { ...LAND.RESULT, _marketplaceLedger: { profile: LAND.PRODUCTION_PROFILE } };
  assert.equal(refreshProfile(rj, { seed: seedOf(rj, '01.14.07.001.044'), registerLatest: LAND.REGISTER_LATEST }), null);
  const flat = { ...FLAT.RESULT, _marketplaceLedger: { profile: FLAT.PRODUCTION_PROFILE } };
  assert.equal(refreshProfile(flat, { seed: seedOf(flat, '01.18.06.019.055.03.01.601'), registerLatest: FLAT.REGISTER_LATEST }).areaSqm, 94.1);
  const subject = subjectMarketProfile({ result: LAND.RESULT, seed: seedOf(LAND.RESULT, '01.14.07.001.044'), registerLatest: LAND.REGISTER_LATEST });
  const job = { status: 'COMPLETE', sources: {}, comparables: [{ ...{ source: 'MYHOME', sourceListingId: '1', exactUrl: 'https://www.myhome.ge/pr/1/', price: 100000, currency: 'USD', pricePerSqm: 2000, areaSqm: 50, rooms: 2, bedrooms: 1, floor: 2, totalFloors: 9, city: 'თბილისი', district: 'საბურთალო', address: null, latitude: null, longitude: null, propertyType: 'APARTMENT', transactionType: 'BUY', buildingStatus: null, renovationStatus: null, title: null, publishedAt: null, updatedAt: null, observedAt: '2026-10-22T00:00:00Z', imageHashes: [], phoneHash: null, scope: 'CITY' } }] };
  const out = foldMarketRefresh({ market: { comparables: [] } }, job, { project: null, latitude: null, longitude: null, district: null }, '2026-10-22T00:00:00Z', { subject, fx: FX });
  assert.equal(out.market.comparables.length, 0);
  assert.equal(out._marketEligibility.state, 'INSUFFICIENT_DATA');
});

/*
 * Replay of the last 30 production jobs (2026-10-23): job 72ad7c75 (unit
 * 01.72.14.040.030.01.02.017, a 12 m² parking space per its register) had no
 * register in the run, so the identity text made it an "apartment" and a whole
 * building's 3,711.2 m² became its size. An impossible size is refused, kept as
 * evidence, and the subject is AREA_UNKNOWN — never searched at that size.
 */
test('an area impossible for the class is refused, kept as evidence, and not searched with', () => {
  const p = subjectMarketProfile({
    result: { assetClass: 'APARTMENT_IN_PROJECT', entityType: 'apartment' },
    seed: { property: { areaSqm: { value: 3711.2 } }, location: { city: { value: 'თბილისი' }, district: { value: 'დიღომი' } } },
    registerLatest: null,
  });
  assert.equal(p.assetClass, 'APARTMENT');
  assert.equal(p.areaSqm, null);
  assert.deepEqual(p.areaRejected, [{ value: 3711.2, basis: 'SEED', reason: 'IMPLAUSIBLE_FOR_CLASS' }]);
  assert.deepEqual(marketplaceSearchPlan(p), { request: null, reason: 'AREA_UNKNOWN' });
});

test('a plausible apartment area from the same path is used as before', () => {
  const p = subjectMarketProfile({
    result: { assetClass: 'APARTMENT_IN_PROJECT', entityType: 'apartment' },
    seed: { property: { areaSqm: { value: 79.5 } }, location: { city: { value: 'თბილისი' }, district: { value: 'დიღომი' } } },
    registerLatest: null,
  });
  assert.equal(p.areaSqm, 79.5);
  assert.equal(p.areaRejected, undefined);
});

/*
 * Replay (2026-10-23), job 5d270963: a 1,100 m² plot in the village of
 * წავკისი, outside the Tbilisi neighbourhood vocabulary. The old run's three
 * წავკისი land listings are exactly the right comparables; the gate must keep
 * them, and still refuse a listing that does not name the village.
 */
test('a village subject keeps listings naming the same village and refuses the rest', () => {
  const subject = subjectMarketProfile({
    result: {},
    seed: { location: { address: { value: 'წავკისი' } } },
    registerLatest: { landAreaSqm: 1100, propertyType: 'მიწის ნაკვეთი', unitRowFound: false },
  });
  assert.equal(subject.areaKey, null);
  assert.equal(subject.locality, 'წავკისი');
  const land = (address, area, extra = {}) => ({ url: `https://x/${address}/${area}`, source: 'myhome.ge', price: '50000', currency: 'USD', area: String(area), propertyType: 'LAND', sourcePropertyType: 'LAND', transactionType: 'BUY', comparableType: 'MICRO_LOCATION', address, ...extra });
  const gate = applyMarketEligibility([
    land('წავკისი', 525), land('წავკისი', 750), land('წავკისი, თრიალეთის ქუჩა', 1000),
    land('კოჯორი', 1000), land('საბურთალო', 1000),
  ], { ...subject, assetClass: 'LAND', areaSqm: 1100 }, { fx: { date: '2026-10-23', gelPerUsd: 2.7 } });
  // 750 and 1,000 m² name the village and fit the land band; 525 m² is outside ±50% of 1,100.
  assert.deepEqual(gate.accepted.map((c) => Number(c.area)).sort((a, b) => a - b), [750, 1000]);
  const why = Object.fromEntries(gate.rejected.map((r) => [r.url.split('/').slice(-2).join(' '), r.reasons]));
  assert.deepEqual(why['წავკისი 525'], ['SIZE_OUT_OF_BAND']);
  assert.deepEqual(why['კოჯორი 1000'], ['LOCATION_WIDER_MARKET']);
  assert.deepEqual(why['საბურთალო 1000'], ['LOCATION_MISMATCH']);
});

test('localityOf never takes a street, a number or the city as the settlement', () => {
  assert.equal(localityOf('ქალაქი თბილისი, წყნეთის გზატკეცილი N31'), null);
  assert.equal(localityOf('სოფელი წავკისი'), 'წავკისი');
  assert.equal(localityOf('თბილისი'), null);
});

test('a7177a89: no district name read → the parcel centre names it; a parcel code with a project is the project', async () => {
  const { areaNearPoint } = await import('../intelligence/marketGeography.ts');
  assert.deepEqual(areaNearPoint(41.7194168, 44.7239822), { area: 'VASHLIJVARI', district: 'SABURTALO', distanceKm: 1.12 });
  assert.equal(areaNearPoint(41.6413, 41.6339), null, 'Batumi is not a Tbilisi neighbourhood');
  assert.equal(areaNearPoint(null, 44.7), null);
  const result = {
    reconciledIdentity: { project: 'Archi Kavtaradze', address: 'თბილისი, მიხეილ შავიშვილის ქუჩა N1' },
    identity: { assetClass: 'APARTMENT' },
    browserOfficial: { results: [{ source: 'TAS_MAP', status: 'SEARCH_CONFIRMED', queryEntered: '01.14.04.029.116', finalUrl: 'http://abstract.reestri.gov.ge/abstract/cad_amo.php', frameUrls: ['https://ms.gov.ge/msmap/#C=44.7239822-41.7194168@Z=18'] }] },
  };
  const seed = { property: { cadastralCode: { value: '01.14.04.029.116' } }, location: { city: { value: 'თბილისი' } } };
  const p = subjectMarketProfile({ result, seed, registerLatest: null });
  assert.equal(p.assetClass, 'DEVELOPMENT_PROJECT');
  assert.equal(p.latitude, 41.7194168, 'the cadastral map centre, as the neighbourhood uses it');
  assert.equal(p.district, 'საბურთალო');
  assert.equal(p.areaKey, 'VASHLIJVARI');
  assert.equal(p.districtBasis, 'COORDINATES');
  const unit = subjectMarketProfile({ result, seed: { ...seed, property: { cadastralCode: { value: '01.14.04.029.116.01.01.012' } }, location: { city: { value: 'თბილისი' }, latitude: { value: 41.7194168 }, longitude: { value: 44.7239822 } } }, registerLatest: null });
  assert.notEqual(unit.assetClass, 'DEVELOPMENT_PROJECT', 'a unit code is never read as the whole project');
  assert.equal(unit.district, 'საბურთალო');
  const named = subjectMarketProfile({ result, seed: { ...seed, location: { city: { value: 'თბილისი' }, district: { value: 'ვაკე' }, latitude: { value: 41.7194168 }, longitude: { value: 44.7239822 } } }, registerLatest: null });
  assert.equal(named.district, 'ვაკე', 'a district that was read always wins over the point');
});

test('any Georgian city: no district name but a parcel centre → the search is sent with the centre, never city-wide', () => {
  const base = { assetClass: 'APARTMENT', assetClassBasis: 'REGISTRY', areaSqm: 62, rooms: 2, transactionType: 'BUY', areaKey: null, locality: null };
  const batumi = marketplaceSearchPlan({ ...base, city: 'ბათუმი', district: null, latitude: 41.6413, longitude: 41.6339 });
  assert.equal(batumi.reason, null);
  assert.deepEqual([batumi.request.city, batumi.request.district, batumi.request.latitude, batumi.request.longitude], ['ბათუმი', null, 41.6413, 41.6339]);
  const unnamed = marketplaceSearchPlan({ ...base, city: null, district: null, latitude: 42.2679, longitude: 42.6946 });
  assert.equal(unnamed.request.city, '', 'the worker names the city from the centre');
  assert.equal(marketplaceSearchPlan({ ...base, city: 'ბათუმი', district: null, latitude: null, longitude: null }).reason, 'LOCATION_UNKNOWN', 'no centre, no district: no search');
  assert.equal(marketplaceSearchPlan({ ...base, city: 'x', district: null, latitude: 55.75, longitude: 37.6 }).reason, 'LOCATION_UNKNOWN', 'outside Georgia');
  const named = marketplaceSearchPlan({ ...base, city: 'თბილისი', district: 'ვაკე', latitude: null, longitude: null });
  assert.equal(named.request.latitude, undefined, 'a named district sends no centre');
});

test('owner 2026-10-24: every kind is searched — parking, storage, office, project — each against its own kind', async () => {
  const { comparableKindOf, kindsCompatible: compat } = await import('../intelligence/marketHierarchy.ts');
  const base = { assetClassBasis: 'REGISTRY', rooms: null, transactionType: 'BUY', city: 'თბილისი', district: 'მთაწმინდა', areaKey: 'MTATSMINDA', locality: null, latitude: null, longitude: null };
  assert.equal(marketplaceSearchPlan({ ...base, assetClass: 'PARKING', areaSqm: 19.7 }).request.propertyType, 'PARKING');
  assert.equal(marketplaceSearchPlan({ ...base, assetClass: 'STORAGE', areaSqm: 6 }).request.propertyType, 'STORAGE');
  const office = marketplaceSearchPlan({ ...base, assetClass: 'COMMERCIAL', subKind: 'OFFICE', areaSqm: 120 }).request;
  assert.deepEqual([office.propertyType, office.subKind], ['COMMERCIAL', 'OFFICE']);
  assert.equal(comparableKindOf({ propertyType: 'STORAGE' }), 'STORAGE');
  assert.equal(comparableKindOf({ url: 'https://ss.ge/ka/udzravi-qoneba/iyideba-satavso-mtatsmindaze' }), 'STORAGE');
  assert.equal(compat('STORAGE', 'COMMERCIAL'), false, 'a shop never prices a storage room');
  assert.equal(compat('PARKING', 'PARKING'), true);

  // A parking subject accepts the worker's parking adverts and refuses its shops.
  const subject = { ...base, assetClass: 'PARKING', areaSqm: 19.7 };
  const ad = (i, type, area) => ({ url: `https://www.myhome.ge/pr/${i}`, sourcePropertyType: type, propertyType: 'COMMERCIAL', area: String(area), price: String(area * 900), currency: 'USD', comparableType: 'SAME_DISTRICT', district: 'მთაწმინდა', transactionType: 'BUY', discoveryMethod: 'MARKETPLACE_WORKER_SEARCH' });
  const gate = applyMarketEligibility([ad(1, 'PARKING', 18), ad(2, 'PARKING', 22), ad(3, 'PARKING', 15), ad(4, 'COMMERCIAL', 20)], subject, { fx: FX });
  assert.deepEqual(gate.accepted.map((c) => c.url).sort(), ['https://www.myhome.ge/pr/1', 'https://www.myhome.ge/pr/2', 'https://www.myhome.ge/pr/3']);
});

test('a whole project accepts measured-near new-build adverts as its area market, never old stock or far ones', () => {
  const p = { assetClass: 'DEVELOPMENT_PROJECT', assetClassBasis: 'IDENTITY', areaSqm: null, rooms: null, transactionType: 'BUY', city: 'თბილისი', district: 'საბურთალო', areaKey: 'VASHLIJVARI', locality: null, latitude: 41.7194, longitude: 44.724, project: 'Archi Kavtaradze' };
  const ad = (i, d, cond) => ({ url: `https://www.myhome.ge/pr/${i}`, sourcePropertyType: 'APARTMENT', area: '70', price: '91000', currency: 'USD', comparableType: d <= 600 ? 'MICRO_LOCATION' : 'SAME_DISTRICT', distanceM: d, condition: cond, transactionType: 'BUY' });
  const gate = applyMarketEligibility([ad(1, 300, 'white frame'), ad(2, 450, 'black frame'), ad(3, 550, 'green frame'), ad(4, 400, 'old build renovated'), ad(5, 4000, 'white frame')], p, { fx: FX });
  assert.deepEqual(gate.accepted.map((c) => c.url).sort(), ['https://www.myhome.ge/pr/1', 'https://www.myhome.ge/pr/2', 'https://www.myhome.ge/pr/3']);
  assert.ok(gate.rejected.find((r) => r.url.endsWith('/4')).reasons.includes('NOT_NEW_BUILD'));
  assert.ok(gate.rejected.find((r) => r.url.endsWith('/5')).reasons.includes('LOCATION_WIDER_MARKET'));
});
