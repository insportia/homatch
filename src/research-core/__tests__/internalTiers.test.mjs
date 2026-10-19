// FIND BUYERS 2.0 — smart internal match expansion (owner, 2026-10-18).
// The listing is production's only one (HOMATCH 244486, Krtsanisi, $213,840); the area
// medians are the ones internal_match_place_geo computes from geocoded portal listings.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyInternalCandidate, budgetTolerance, DEFAULT_EXPANSION_CONFIG, expansionConfigFrom,
  geoIndexFrom, placeKey, haversineKm, renovationVerdict, buildingStatusVerdict, supplyQualityFromFacts,
} from '../match/internalTiers.ts';
import { demandSideFromIntentProfile, strengthFromCriteria, supplySideFromProperty } from '../match/native-pair.ts';

const SUPPLY = supplySideFromProperty(
  { transaction_type: 'SALE', property_type: 'APARTMENT', listed_by_role: 'OWNER' },
  { city: 'Tbilisi', district: 'Krtsanisi', total_price: 213840, currency: 'USD', area: 97.2, rooms: 3, bedrooms: 2 },
);
const GEO = geoIndexFrom([
  { cityKey: 'tbilisi', placeKey: 'krtsanisi', samples: 144, lat: 41.6766, lon: 44.8165, ppsqmUsd: 1400 },
  { cityKey: 'tbilisi', placeKey: 'isani', samples: 23, lat: 41.6794, lon: 44.8384, ppsqmUsd: 1250 },
  { cityKey: 'tbilisi', placeKey: 'avlabari', samples: 10, lat: 41.6924, lon: 44.8212, ppsqmUsd: null },
  { cityKey: 'tbilisi', placeKey: 'vake', samples: 96, lat: 41.7085, lon: 44.7658, ppsqmUsd: 2100 },
  { cityKey: 'tbilisi', placeKey: 'ვარკეთილი', samples: 332, lat: 41.6969, lon: 44.8761, ppsqmUsd: 900 },
  { cityKey: 'tbilisi', placeKey: 'sololaki', samples: 3, lat: 41.6883, lon: 44.7866, ppsqmUsd: 1500 },
]);

const demand = (row, criteria = null) => demandSideFromIntentProfile({
  intent_type: 'BUY', transaction_type: 'SALE', city: 'Tbilisi', property_types: ['APARTMENT'], currency: 'USD', ...row,
}, strengthFromCriteria(criteria));
const classify = (row, extra = {}, criteria = null, config) => classifyInternalCandidate({
  demand: demand(row, criteria),
  demandPlaces: [row.district, ...(row.neighborhoods ?? [])].filter(Boolean),
  requirements: extra.requirements ?? {},
  supply: SUPPLY,
  supplyAddress: 'კრწანისის ქ. 6',
  supplyQuality: extra.quality ?? {},
}, GEO, config ?? DEFAULT_EXPANSION_CONFIG);

test('the owner\'s tolerance bands: ≤$50k ±5k, $50,001–119,999 ±10k, ≥$120k ±15k; never another currency', () => {
  const c = DEFAULT_EXPANSION_CONFIG;
  assert.equal(budgetTolerance(50000, 'USD', 'SALE', c), 5000);
  assert.equal(budgetTolerance(50001, 'USD', 'SALE', c), 10000);
  assert.equal(budgetTolerance(119999, 'USD', 'SALE', c), 10000);
  assert.equal(budgetTolerance(120000, 'USD', 'SALE', c), 15000);
  assert.equal(budgetTolerance(213840, 'USD', 'SALE', c), 15000);
  assert.equal(budgetTolerance(213840, 'GEL', 'SALE', c), 0, 'bands are USD; a GEL price is not stretched');
  assert.equal(budgetTolerance(900, 'USD', 'RENT', c), 0, 'no rent tolerance unless configured');
  assert.equal(budgetTolerance(1000, 'USD', 'RENT', expansionConfigFrom({ rentTolerancePct: 0.1 })), 100);
});

test('EXACT needs the member\'s own area, the property type and a price inside their budget', () => {
  const m = classify({ district: 'Krtsanisi', budget_min: 200000, budget_max: 220000, bedrooms_min: 2 });
  assert.equal(m.category, 'EXACT');
  assert.equal(m.kind, 'EXACT_LOCATION');
  assert.equal(m.confidence, 'HIGH');
  assert.equal(m.budget.verdict, 'WITHIN');
  assert.equal(m.geo.level, 'EXACT_AREA');
  assert.equal(m.geo.streetMentioned, false);
  /* Across scripts, through the one place vocabulary. */
  assert.equal(classify({ district: 'Крцаниси', budget_max: 220000 }).category, 'EXACT');
  assert.equal(classify({ district: null, neighborhoods: ['კრწანისი'], budget_max: 220000 }).category, 'EXACT');
});

test('a street mention alone never makes a match exact', () => {
  const m = classify({ district: 'Vake', budget_min: 200000, budget_max: 220000, bedrooms_min: 2 },
    { requirements: { nearby: ['კრწანისის ქუჩა'] } });
  assert.ok(m, 'still a candidate — a similar flat elsewhere in the city');
  assert.notEqual(m.category, 'EXACT');
  assert.equal(m.kind, 'SIMILAR_PROPERTY');
  assert.equal(m.geo.streetMentioned, true, 'reported as evidence');
  assert.equal(m.confidence, 'LOW');
});

test('above the stated maximum, inside the tolerance: shown, never high confidence unless they said it is flexible', () => {
  const m = classify({ district: 'Krtsanisi', budget_max: 200000 });
  assert.equal(m.category, 'NEARBY_SIMILAR');
  assert.equal(m.kind, 'SAME_AREA_BUDGET_FLEX');
  assert.equal(m.budget.verdict, 'ABOVE_MAX_TOLERANCE');
  assert.equal(m.budget.outsideBy, 13840);
  assert.equal(m.confidence, 'LOW');
  assert.ok(m.uncertainty.includes('ABOVE_MAX'));
  const flex = classify({ district: 'Krtsanisi', budget_max: 200000 }, {}, { strength: { PRICE: 'PREFERRED' } });
  assert.equal(flex.confidence, 'MEDIUM');
  assert.ok(flex.uncertainty.includes('ABOVE_MAX_FLEXIBLE'));
  /* Beyond the tolerance is not a candidate at all. */
  assert.equal(classify({ district: 'Krtsanisi', budget_max: 190000 }), null);
  assert.equal(classify({ district: 'Krtsanisi', budget_min: 240000, budget_max: 300000 }), null);
});

test('nearby is measured: listing medians within the distance, enough samples, comparable price level', () => {
  const isani = classify({ district: 'Isani', budget_min: 200000, budget_max: 220000, bedrooms_min: 2 });
  assert.equal(isani.kind, 'NEARBY_AREA');
  assert.equal(isani.category, 'NEARBY_SIMILAR');
  assert.ok(isani.geo.km > 1.5 && isani.geo.km < 2.5, `measured ${isani.geo.km} km`);
  assert.deepEqual(isani.geo.samples, [23, 144]);
  assert.equal(isani.geo.priceLevelRatio, 1.12);
  /* An area with too few geocoded listings is never "nearby" anything. */
  const sololaki = classify({ district: 'Sololaki', budget_min: 200000, budget_max: 220000, bedrooms_min: 2 });
  assert.equal(sololaki.kind, 'SIMILAR_PROPERTY');
  /* Varketili is 5 km away: not nearby. Vake is close enough to some but priced unlike Krtsanisi. */
  assert.equal(classify({ district: 'ვარკეთილი', budget_min: 200000, budget_max: 220000, bedrooms_min: 2 }).kind, 'SIMILAR_PROPERTY');
  const wide = expansionConfigFrom({ nearbyMaxKm: 7, priceLevelMaxRatio: 1.35 });
  assert.equal(classify({ district: 'Vake', budget_min: 200000, budget_max: 220000, bedrooms_min: 2 }, {}, null, wide).kind, 'SIMILAR_PROPERTY',
    'Vake is within 7 km but its price level is 1.5× — not a compatible neighbour');
  assert.ok(haversineKm({ lat: 41.6766, lon: 44.8165 }, { lat: 41.6969, lon: 44.8761 }) > 5);
});

test('a whole-city search is NEARBY_SIMILAR (city-wide), and the similar tier can be switched off', () => {
  const m = classify({ district: null, budget_min: 200000, budget_max: 220000 });
  assert.equal(m.kind, 'CITY_WIDE');
  assert.ok(m.uncertainty.includes('CITY_WIDE_SEARCH'));
  const off = expansionConfigFrom({ similarEnabled: false });
  assert.equal(classify({ district: 'Vake', budget_min: 200000, budget_max: 220000, bedrooms_min: 2 }, {}, null, off), null);
});

test('precision: what they required still disqualifies', () => {
  assert.equal(classify({ district: 'Krtsanisi', budget_max: 220000, bedrooms_min: 3 }), null, 'needs 3 bedrooms');
  assert.equal(classify({ district: 'Krtsanisi', budget_max: 220000, city: 'Batumi' }), null, 'another city');
  assert.equal(classify({ district: 'Krtsanisi', budget_max: 2000, transaction_type: 'RENT', intent_type: 'RENT' }), null, 'a tenant');
  assert.equal(classify({ district: 'Krtsanisi', budget_max: 220000, property_types: ['HOUSE'] }), null, 'wants a house');
  assert.equal(classify({ district: 'Krtsanisi', budget_max: 220000 }, { requirements: { mustHave: ['PARKING'] }, quality: { amenities: { PARKING: false } } }), null);
  assert.equal(classify({ district: 'Krtsanisi', budget_max: 220000 }, { requirements: { renovation: ['RENOVATED'] }, quality: { condition: 'NEEDS_RENOVATION' } }), null);
  const unknownParking = classify({ district: 'Krtsanisi', budget_max: 220000 }, { requirements: { mustHave: ['PARKING'] } });
  assert.ok(unknownParking.uncertainty.includes('AMENITIES_UNKNOWN'));
});

test('no documented type or budget is never EXACT, and the reason is stated', () => {
  const noType = classify({ district: 'Krtsanisi', budget_max: 220000, property_types: null, bedrooms_min: 2 });
  assert.equal(noType.kind, 'SAME_AREA_BUDGET_FLEX');
  assert.ok(noType.uncertainty.includes('TYPE_UNSTATED'));
  const noBudget = classify({ district: 'Krtsanisi', budget_max: null, currency: null, bedrooms_min: 2 });
  assert.equal(noBudget.kind, 'SAME_AREA_BUDGET_FLEX');
  assert.equal(noBudget.confidence, 'LOW');
  assert.ok(noBudget.uncertainty.includes('BUDGET_UNSTATED'));
  const otherCurrency = classify({ district: 'Krtsanisi', budget_max: 600000, currency: 'GEL', bedrooms_min: 2 });
  assert.ok(otherCurrency.uncertainty.includes('CURRENCY_DIFFERS'));
});

test('quality and place helpers', () => {
  assert.equal(placeKey('  კრწანისი '), 'krtsanisi');
  assert.equal(placeKey('ვარკეთილი'), 'ვარკეთილი', 'unknown to the vocabulary: kept as written, never guessed');
  assert.equal(renovationVerdict(['RENOVATED'], 'NEW'), 'AGREE');
  assert.equal(renovationVerdict(['WHITE_FRAME'], 'NEW'), 'UNKNOWN', 'frames are never inferred');
  assert.equal(buildingStatusVerdict(['NEW_BUILD'], { newBuild: true }), 'AGREE');
  assert.equal(buildingStatusVerdict(['OLD_BUILD'], { constructionStatus: 'UNDER_CONSTRUCTION' }), 'CONFLICT');
  assert.deepEqual(supplyQualityFromFacts({ parking: true, elevator: null }).amenities.PARKING, true);
  assert.equal(expansionConfigFrom({ nearbyMaxKm: 99 }).nearbyMaxKm, 10, 'clamped');
});
