// Deep Search strict matching: every stored offer judged against the customer's EXACT
// request. Exact = every mandatory requirement stated and satisfied; potential = nothing
// contradicts, unknowns listed; alternative = one numeric miss within 15%; never inflated.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  judgeOffer, judgeCampaign, criteriaFromSearchRequest, statedBuildingStatus, districtsNamed, offerPriceUsd, repostKey,
} from '../findProperty/campaignMatch.ts';

const NOW = Date.parse('2026-10-18T10:00:00Z');
/* The production campaign's request (f8833757), as its marketplace search stored it. */
const REQUEST = {
  transactionType: 'BUY', propertyType: 'APARTMENT', city: 'Tbilisi', districts: ['ვაკე'],
  rooms: { min: 3, max: 3 }, bedrooms: { min: 2, max: 2 }, areaMinSqm: 80, areaMaxSqm: 110,
  priceMinUsd: 120000, priceMaxUsd: 160000, buildingStatuses: ['NEW_BUILD', 'UNDER_CONSTRUCTION'],
};
const C = criteriaFromSearchRequest(REQUEST);
const offer = (over = {}) => ({
  id: 'o1', canonical_url: 'https://www.facebook.com/groups/1/posts/1/', transaction: 'SALE', property_type: 'APARTMENT',
  city: 'tbilisi', district: 'vake', sale_amount: 145000, sale_currency: 'USD', rent_amount: null, rent_currency: null,
  area_sqm: 95, rooms: 3, bedrooms: 2, title: null,
  description: 'იყიდება 3 ოთახიანი ბინა ვაკეში, ახალაშენებულ კორპუსში, 95 კვ.მ, 2 საძინებელი, 145000$',
  published_at: '2026-10-15T10:00:00Z', content_fingerprint: 'f1', field_origins: { city: 'TEXT', network: 'FACEBOOK' },
  ...over,
});
const state = (v, key) => v.checks.find((c) => c.key === key)?.state;

test('the request keeps every requirement: rooms and bedrooms apart, budget, area, place, building', () => {
  assert.deepEqual(C, {
    transaction: 'SALE', city: 'Tbilisi', districts: ['ვაკე'], propertyType: 'APARTMENT',
    priceUsd: { min: 120000, max: 160000 }, areaSqm: { min: 80, max: 110 },
    rooms: { min: 3, max: 3 }, bedrooms: { min: 2, max: 2 }, buildingStatuses: ['NEW_BUILD', 'UNDER_CONSTRUCTION'],
  });
  assert.equal(criteriaFromSearchRequest({ transactionType: 'MONTHLY_RENT', city: 'Batumi' }).transaction, 'RENT');
  /* Unknown fields stay unset, never defaulted. */
  const bare = criteriaFromSearchRequest({ transactionType: 'BUY', city: 'Tbilisi' });
  assert.equal(bare.priceUsd, null); assert.equal(bare.bedrooms, null); assert.deepEqual(bare.districts, []);
});

test('a post that states and satisfies every requirement is an EXACT match', () => {
  const v = judgeOffer(offer(), C, NOW);
  assert.equal(v.category, 'EXACT', JSON.stringify(v.checks));
  assert.ok(v.checks.every((c) => c.state === 'MATCH'));
});

test('bedrooms are not rooms: a 1-bedroom flat is never a match for "2 bedrooms"', () => {
  const v = judgeOffer(offer({ bedrooms: 1, rooms: 3 }), C, NOW);
  assert.equal(v.category, 'REJECTED');
  assert.deepEqual(v.rejectReasons, ['BEDROOMS']);
  assert.equal(state(v, 'rooms'), 'MATCH');
});

test('price, area and city are hard filters', () => {
  assert.deepEqual(judgeOffer(offer({ sale_amount: 250000 }), C, NOW).rejectReasons, ['PRICE']);
  assert.deepEqual(judgeOffer(offer({ area_sqm: 50 }), C, NOW).rejectReasons, ['AREA']);
  const batumi = judgeOffer(offer({ city: 'batumi', district: null, description: 'იყიდება ბინა ბათუმში' }), C, NOW);
  assert.equal(batumi.category, 'REJECTED'); assert.ok(batumi.rejectReasons.includes('CITY'));
  assert.deepEqual(judgeOffer(offer({ district: 'saburtalo' }), C, NOW).rejectReasons, ['DISTRICT']);
  assert.deepEqual(judgeOffer(offer({ property_type: 'HOUSE' }), C, NOW).rejectReasons, ['PROPERTY_TYPE']);
  /* GEL is compared in USD: 540,000 GEL ≈ $199,800 is over budget. */
  assert.deepEqual(judgeOffer(offer({ sale_amount: 540000, sale_currency: 'GEL' }), C, NOW).rejectReasons, ['PRICE']);
  assert.equal(offerPriceUsd({ sale_amount: 400000, sale_currency: 'GEL' }, 'SALE'), 148000);
});

test('missing information is UNVERIFIED, never invented: such a post is a POTENTIAL match', () => {
  const v = judgeOffer(offer({ district: null, description: 'იყიდება ბინა, 2 საძინებელი, 95 კვ.მ', sale_amount: null }), C, NOW);
  assert.equal(v.category, 'POTENTIAL');
  assert.equal(state(v, 'district'), 'UNVERIFIED');
  assert.equal(state(v, 'price'), 'UNVERIFIED');
  assert.equal(state(v, 'buildingStatus'), 'UNVERIFIED');
  assert.equal(v.checks.find((c) => c.key === 'price').actual, null);
});

test('a post that states almost nothing is not shown as a potential match', () => {
  const v = judgeOffer(offer({ property_type: null, district: null, sale_amount: null, area_sqm: null, rooms: null, bedrooms: null, description: 'იყიდება, დარეკეთ' }), C, NOW);
  assert.equal(v.category, 'REJECTED');
  assert.ok(v.rejectReasons.includes('INSUFFICIENT_DETAIL'));
});

test('one numeric requirement missed by ≤15% is an ALTERNATIVE (shown only on request); more is rejected', () => {
  assert.equal(judgeOffer(offer({ sale_amount: 170000 }), C, NOW).category, 'ALTERNATIVE');
  assert.equal(judgeOffer(offer({ sale_amount: 200000 }), C, NOW).category, 'REJECTED');
  assert.equal(judgeOffer(offer({ sale_amount: 170000, bedrooms: 1 }), C, NOW).category, 'REJECTED');
});

test('posts older than 30 days are rejected; the building status is read only when the post says it', () => {
  assert.deepEqual(judgeOffer(offer({ published_at: '2026-08-01T00:00:00Z' }), C, NOW).rejectReasons, ['OLDER_THAN_30_DAYS']);
  assert.equal(statedBuildingStatus('ახალაშენებულ კორპუსში'), 'NEW_BUILD');
  assert.equal(statedBuildingStatus('მშენებარე კორპუსი'), 'UNDER_CONSTRUCTION');
  assert.equal(statedBuildingStatus('продается квартира в новостройке'), 'NEW_BUILD');
  assert.equal(statedBuildingStatus('ძველ აშენებულ კორპუსში'), 'OLD_BUILD');
  assert.equal(statedBuildingStatus('იყიდება ბინა'), null);
  assert.deepEqual(judgeOffer(offer({ description: 'იყიდება ბინა ძველ აშენებულ კორპუსში ვაკეში' }), C, NOW).rejectReasons, ['BUILDING_STATUS']);
});

test('districts named in Georgian case forms are read (ისნის → Isani, ვაკეში → Vake)', () => {
  assert.deepEqual(districtsNamed('იყიდება ბინა ისნის რაიონში'), ['isani']);
  assert.deepEqual(districtsNamed('ბინა ვაკეში'), ['vake']);
  assert.deepEqual(districtsNamed('ბინა ვარკეთილში'), ['samgori']);
  /* The parser missed the district but the text names another one: that contradicts "Vake". */
  const v = judgeOffer(offer({ district: null, description: 'იყიდება ბინა ისნის რაიონი 95 კვ 2 საძინებელი' }), C, NOW);
  assert.deepEqual(v.rejectReasons, ['DISTRICT']);
});

test('reposts count once; the funnel keeps raw, candidate, unique, exact, potential and rejected apart', () => {
  const offers = [
    offer({ id: 'a' }),
    offer({ id: 'b', content_fingerprint: 'f1' }), // same text: a repost
    offer({ id: 'c', content_fingerprint: 'f2', description: 'იყიდება ბინა 555 12 34 56, 95 კვ.მ', area_sqm: 95, district: null, sale_amount: null }),
    offer({ id: 'd', content_fingerprint: 'f3', description: 'ახალი ტექსტი 555123456 95 კვ', area_sqm: 95, district: null, sale_amount: null }), // same phone + area
    offer({ id: 'e', content_fingerprint: 'f4', bedrooms: 1 }),
  ];
  assert.equal(repostKey(offers[2]), repostKey(offers[3]));
  const { verdicts, funnel } = judgeCampaign(offers, C, 2846, NOW);
  assert.deepEqual({ ...funnel, rejectedBy: undefined, version: undefined }, {
    version: undefined, fetched: 2846, candidates: 5, unique: 3, duplicates: 2, exact: 1, potential: 1, alternative: 0, rejected: 1,
    rejectedBy: undefined, available: 2,
  });
  assert.deepEqual(funnel.rejectedBy, { BEDROOMS: 1 });
  assert.equal(verdicts[0].category, 'EXACT');
  assert.equal(verdicts[0].duplicateIds.length, 1);
  assert.equal(verdicts.length, funnel.unique);
});
