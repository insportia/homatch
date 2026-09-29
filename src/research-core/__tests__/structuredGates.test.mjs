// The three structured gates: city across scripts, budget across currencies,
// bedrooms. Only CONFLICT rejects; UNKNOWN is never turned into a fit.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cityGate, marketCitySpellings, budgetGate, bedroomsGate, converterFromRates,
} from '../match/structured-gates.ts';

test('city: the same place in two scripts agrees, two different known cities conflict', () => {
  assert.equal(cityGate('Tbilisi', 'თბილისი'), 'AGREE');
  assert.equal(cityGate('Tbilisi', 'Тбилиси'), 'AGREE');
  assert.equal(cityGate('Tbilisi', 'Batumi'), 'CONFLICT');
  assert.equal(cityGate('Tbilisi', null), 'UNKNOWN');
});

test('the market query carries every spelling of the city', () => {
  const names = marketCitySpellings('Tbilisi');
  assert.ok(names.some((n) => n.toLowerCase() === 'tbilisi'));
  assert.ok(names.some((n) => /თბილისი/.test(n)), 'the Georgian spelling is included');
  assert.deepEqual(marketCitySpellings(''), []);
});

test('budget: same currency — within range agrees, far above the maximum conflicts', () => {
  const g = (price) => budgetGate({ price, priceCurrency: 'USD', budgetMin: 100000, budgetMax: 150000, budgetCurrency: 'USD' });
  assert.equal(g(140000), 'AGREE');
  assert.equal(g(200000), 'NEAR');
  assert.equal(g(300000), 'CONFLICT');
});

test('budget: different currencies with no configured rate is UNKNOWN, never a guess', () => {
  const v = budgetGate({ price: 300000, priceCurrency: 'USD', budgetMin: 0, budgetMax: 300000, budgetCurrency: 'GEL',
    converter: converterFromRates([]) });
  assert.equal(v, 'UNKNOWN');
});

test('budget: a configured GEL rate converts before comparing', () => {
  const fx = converterFromRates([{ base_currency: 'USD', quote_currency: 'GEL', rate: 2.7 }]);
  /* 300,000 GEL ≈ 111,111 USD: a 300,000 USD flat is far out of reach. */
  assert.equal(budgetGate({ price: 300000, priceCurrency: 'USD', budgetMax: 300000, budgetCurrency: 'GEL', converter: fx }), 'CONFLICT');
  assert.equal(budgetGate({ price: 110000, priceCurrency: 'USD', budgetMax: 300000, budgetCurrency: 'GEL', converter: fx }), 'AGREE');
});

test('budget: a side with no currency is UNKNOWN', () => {
  assert.equal(budgetGate({ price: 100000, priceCurrency: null, budgetMax: 50000, budgetCurrency: 'USD' }), 'UNKNOWN');
});

test('bedrooms: two short cannot house the person; one short is near; unknown stays unknown', () => {
  assert.equal(bedroomsGate(1, 3, null), 'CONFLICT');
  assert.equal(bedroomsGate(2, 3, null), 'NEAR');
  assert.equal(bedroomsGate(3, 2, 3), 'AGREE');
  assert.equal(bedroomsGate(null, 2, 3), 'UNKNOWN');
  assert.equal(bedroomsGate(3, null, null), 'UNKNOWN');
});
