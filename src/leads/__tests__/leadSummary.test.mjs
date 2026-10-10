// HOMATCH Leads — a lead card says only what the member stated; unsupported clauses are
// omitted, never guessed. Research budget and selection maths.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLeadSummary, budgetLabel, locationLabel, matchedCriteria, validateResearchBudget, researchExtension, selectionTotals,
} from '../leadSummary.ts';

const EN = {
  hl_type_apartment: 'apartment', hl_type_house: 'house', hl_type_property: 'property', hl_list_or: ' or ',
  hl_summary_full: 'Looking for a {{propertyType}} in {{preferredLocations}}, with a budget of {{budgetRange}}.',
  hl_summary_where: 'Looking for a {{propertyType}} in {{preferredLocations}}.',
  hl_summary_budget: 'Looking for a {{propertyType}}, with a budget of {{budgetRange}}.',
  hl_summary_type: 'Looking for a {{propertyType}}.',
  hl_summary_prefs: '{{preferences}}.',
  hl_summary_matches: 'This listing matches {{matchedCriteria}}.',
  hl_budget_up_to: 'up to {{amount}}', hl_budget_from: 'from {{amount}}',
  hl_req_bedrooms_min: 'at least {{n}} bedrooms', hl_req_bedrooms_range: '{{min}}–{{max}} bedrooms', hl_req_bedrooms_max: 'up to {{n}} bedrooms',
  hl_req_area_min: 'from {{n}} m²', hl_req_area_range: '{{min}}–{{max}} m²', hl_req_area_max: 'up to {{n}} m²',
  hl_req_rooms_min: 'at least {{n}} rooms', hl_req_rooms_range: '{{min}}–{{max}} rooms', hl_req_rooms_max: 'up to {{n}} rooms',
  hl_dim_transaction: 'purchase', hl_dim_property_type: 'property type', hl_dim_city: 'city', hl_dim_district: 'district',
  hl_dim_price: 'budget', hl_dim_bedrooms: 'bedrooms', hl_dim_area: 'size',
};
const t = (k, vars = {}) => (EN[k] ?? k).replace(/\{\{(\w+)\}\}/g, (_, v) => String(vars[v] ?? ''));
const fmt = (n, c) => `${c === 'USD' ? '$' : ''}${n.toLocaleString('en-US')}${c && c !== 'USD' ? ` ${c}` : ''}`;

test('the full approved sentence, from stated values only', () => {
  const s = buildLeadSummary({
    propertyTypes: ['APARTMENT'], transaction: 'SALE',
    locations: { city: 'Tbilisi', district: 'Krtsanisi', neighborhoods: ['Ortachala'] },
    budget: { min: 180000, max: 220000, currency: 'USD' },
    requirements: { bedroomsMin: 2 }, agreed: ['CITY', 'DISTRICT', 'PROPERTY_TYPE', 'TRANSACTION'],
  }, t, fmt);
  assert.equal(s, 'Looking for an apartment in Ortachala, Krtsanisi, Tbilisi, with a budget of $180,000 – $220,000. at least 2 bedrooms. This listing matches purchase, property type, city, district.');
});

test('missing data is omitted, never invented', () => {
  const s = buildLeadSummary({ propertyTypes: [], transaction: 'RENT', locations: { city: null, district: null, neighborhoods: [] },
    budget: null, requirements: {}, agreed: [] }, t, fmt);
  assert.equal(s, 'Looking for a property.');
  assert.doesNotMatch(s, /budget|urgent|ready|confirmed/i);
  const b = buildLeadSummary({ propertyTypes: ['HOUSE'], transaction: 'SALE', locations: { city: 'Batumi', district: null, neighborhoods: [] },
    budget: { min: null, max: 300000, currency: 'USD' }, requirements: {}, agreed: ['CITY'] }, t, fmt);
  assert.equal(b, 'Looking for a house in Batumi, with a budget of up to $300,000. This listing matches city.');
});

test('helpers: locations deduplicate, budget forms, criteria order', () => {
  assert.equal(locationLabel({ city: 'Tbilisi', district: 'Tbilisi', neighborhoods: [] }), 'Tbilisi');
  assert.equal(budgetLabel({ min: 500, max: 500, currency: 'USD' }, fmt, t), '$500');
  assert.equal(budgetLabel({ min: 900, max: null, currency: 'GEL' }, fmt, t), 'from 900 GEL');
  assert.deepEqual(matchedCriteria(['AREA', 'city', 'UNKNOWN_DIM'], t), ['city', 'size']);
});

test('research budget: whole credits, at least 100, within max and wallet', () => {
  const L = { min: 100, max: 5000, balance: 1200 };
  assert.equal(validateResearchBudget(100, L), null);
  assert.equal(validateResearchBudget('1,000', L), null);
  assert.equal(validateResearchBudget(99, L), 'BELOW_MINIMUM');
  assert.equal(validateResearchBudget(150.5, L), 'NOT_WHOLE');
  assert.equal(validateResearchBudget('', L), 'NOT_A_NUMBER');
  assert.equal(validateResearchBudget(1500, L), 'OVER_BALANCE');
  assert.equal(validateResearchBudget(6000, { ...L, balance: null }), 'ABOVE_MAXIMUM');
});

test('expanding a search authorises only the difference', () => {
  assert.deepEqual(researchExtension(100, 500, { max: 5000, balance: 1000, minStep: 50 }), { additional: 400, problem: null });
  assert.equal(researchExtension(500, 500, { max: 5000, balance: 1000, minStep: 50 }).problem, 'NOT_HIGHER');
  assert.equal(researchExtension(500, 520, { max: 5000, balance: 1000, minStep: 50 }).problem, 'STEP_TOO_SMALL');
  assert.equal(researchExtension(100, 2000, { max: 5000, balance: 1000, minStep: 50 }).problem, 'OVER_BALANCE');
});

test('bulk selection: unlocked leads are free, segments counted', () => {
  const items = [
    { matchId: 'a', segment: 'STANDARD', unlocked: false, priceCredits: 2.5 },
    { matchId: 'b', segment: 'PREMIUM', unlocked: false, priceCredits: 6 },
    { matchId: 'c', segment: 'PREMIUM', unlocked: true, priceCredits: 6 },
    { matchId: 'd', segment: 'STANDARD', unlocked: false, priceCredits: 2.5 },
  ];
  assert.deepEqual(selectionTotals(items, new Set(['a', 'b', 'c'])), { standard: 1, premium: 1, already: 1, credits: 8.5 });
});
