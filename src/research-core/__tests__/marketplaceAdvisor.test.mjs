import test from 'node:test';
import assert from 'node:assert/strict';
import { assessProperty, isRecommended } from '../marketplace/advisor.ts';

const brief = (over = {}) => ({
  version: 2, transactionType: { value: 'BUY', status: 'CONFIRMED' }, propertyType: { value: 'APARTMENT', status: 'CONFIRMED' },
  country: 'GE', city: { value: 'Tbilisi', status: 'CONFIRMED' }, districts: null, locationPreferences: [],
  price: { value: { min: 80000, max: 200000 }, status: 'CONFIRMED' }, area: { value: { min: 50, max: 120 }, status: 'CONFIRMED' },
  rooms: { value: { min: 2, max: 2 }, status: 'CONFIRMED' }, bedrooms: null, bathrooms: null, buildingStatuses: null,
  renovationPreferences: null, furnished: null, parking: null, floorPreferences: [], mustHave: [], niceToHave: [], exclusions: [],
  userLanguage: 'ka', relevantSearchLanguages: [], originalText: 'x', dropped: [], ...over,
});
const facts = (over = {}) => ({ priceUsd: 150000, pricePerSqmUsd: 2000, areaSqm: 75, rooms: 2, bedrooms: 1, bathrooms: 1, floor: 4, totalFloors: 9,
  city: 'Tbilisi', district: 'Saburtalo', buildingStatus: null, renovationStatus: null, parking: null, furnished: null, amenities: [], elevator: null, ...over });
const property = (over = {}) => ({ group: 'BEST', facts: facts(over.facts), intelligence: { strong: true, preferences: { confirmed: [], mentioned: [], unconfirmed: [], contradicted: [] } },
  vsComparable: null, seller: { classification: 'UNKNOWN' }, listings: [{ publishedAt: null, updatedAt: null }], priceDiscrepancy: null, upgrade: null, ...over, facts: facts(over.facts) });

test('advisor: what the listing states and matches is a fit; what it states otherwise is a difference', () => {
  const a = assessProperty(property({ facts: { areaSqm: 45 } }), brief());
  assert.deepEqual(a.fits.map((p) => p.code), ['BUDGET', 'ROOMS']);
  assert.deepEqual(a.misses, [{ code: 'AREA_SMALLER', params: { v: 45 } }]);
});

test('advisor: silence is UNKNOWN, never "no" (an elevator nobody mentions is not a missing elevator)', () => {
  const a = assessProperty(property({ intelligence: { strong: false, preferences: { confirmed: [], mentioned: [], unconfirmed: ['ELEVATOR'], contradicted: [] } } }),
    brief({ mustHave: ['ELEVATOR'] }));
  assert.deepEqual(a.unknown, [{ code: 'AMENITY', params: { amenity: 'ELEVATOR' } }]);
  assert.equal(a.misses.length, 0);
  /* Unknown is not "no", and not "yes" either: a REQUIRED elevator nobody mentions is worth a look, never a good match (owner, 2026-10-22). */
  assert.equal(a.verdict, 'CONSIDER');
  assert.equal(isRecommended(a), false);
  /* A nice-to-have nobody mentions is a soft unknown: still a good match. */
  const soft = assessProperty(property({ intelligence: { strong: false, preferences: { confirmed: [], mentioned: [], unconfirmed: ['ELEVATOR'], contradicted: [] } } }),
    brief({ niceToHave: ['ELEVATOR'] }));
  assert.equal(soft.verdict, 'GOOD');
  const said = assessProperty(property({ facts: { elevator: false } }), brief({ mustHave: ['ELEVATOR'] }));
  assert.deepEqual(said.misses, [{ code: 'AMENITY', params: { amenity: 'ELEVATOR' } }]);
});

test('advisor: over budget is stated with the amount; an upgrade is its own verdict', () => {
  const a = assessProperty(property({ group: 'UPGRADE', facts: { priceUsd: 210000 }, upgrade: { overMaxPct: 5, advantages: [{ code: 'MORE_AREA', delta: 12 }] } }), brief());
  assert.equal(a.verdict, 'UPGRADE');
  assert.deepEqual(a.misses[0], { code: 'OVER_BUDGET', params: { amount: 10000, pct: 5 } });
  assert.deepEqual(a.highlights.at(-1), { code: 'UPGRADE_MORE_AREA', params: { n: 12 } });
  assert.equal(isRecommended(a), false);
});
