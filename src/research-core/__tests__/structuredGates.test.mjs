// The three structured gates: city across scripts, budget across currencies,
// bedrooms. Only CONFLICT rejects; UNKNOWN is never turned into a fit.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cityGate, marketCitySpellings, budgetGate, bedroomsGate, converterFromRates,
  ratesFromNbg, converterFrom, FX_NBG_MAX_AGE_DAYS, ratesFromPayload,
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
  const fx = converterFromRates([{ base_currency: 'USD', quote_currency: 'GEL', rate: 2.7, effective_from: new Date().toISOString() }]);
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

test('different cities in different scripts are never merged into one place', () => {
  assert.equal(cityGate('თბილისი', 'Batumi'), 'CONFLICT', 'Tbilisi (Georgian) vs Batumi (Latin) is a known conflict');
  assert.equal(cityGate('Тбилиси', 'ბათუმი'), 'CONFLICT');
  assert.equal(cityGate('Tbilisi', 'Tbilisi Sea'), 'UNKNOWN', 'an unknown place is not merged by substring');
  assert.equal(cityGate('Kutaisi', 'Tbilisi'), 'CONFLICT');
  assert.equal(cityGate('Tbilisi', 'Tbilisis'), 'UNKNOWN', 'a typo is unknown, not a different city');
});

test('a district written in the city field agrees with its own city only', () => {
  assert.equal(cityGate('Tbilisi', 'Vake'), 'AGREE');
  assert.equal(cityGate('თბილისი', 'საბურთალო'), 'AGREE');
  assert.equal(cityGate('Batumi', 'Vake'), 'CONFLICT');
});

test('a stale or undated fx_rates row is ignored, so the budget stays UNKNOWN', () => {
  const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const stale = converterFromRates([{ base_currency: 'USD', quote_currency: 'GEL', rate: 2.7, effective_from: old }]);
  assert.equal(budgetGate({ price: 300000, priceCurrency: 'USD', budgetMax: 300000, budgetCurrency: 'GEL', converter: stale }), 'UNKNOWN');
  const undated = converterFromRates([{ base_currency: 'USD', quote_currency: 'GEL', rate: 2.7 }]);
  assert.equal(budgetGate({ price: 300000, priceCurrency: 'USD', budgetMax: 300000, budgetCurrency: 'GEL', converter: undated }), 'UNKNOWN');
});

test('NBG official rates convert only while current', () => {
  const now = Date.parse('2026-09-29T12:00:00Z');
  const payload = [{ date: '2026-09-29T00:00:00.000Z', currencies: [
    { code: 'USD', quantity: 1, rate: 2.7 }, { code: 'EUR', quantity: 1, rate: 3.0 }, { code: 'RUB', quantity: 100, rate: 3.2 },
  ] }];
  const rates = ratesFromNbg(payload, now);
  assert.ok(rates, 'a same-day NBG payload is accepted');
  const fx = converterFrom(rates);
  /* 270,000 GEL budget = 100,000 USD: a 100,000 USD flat fits, a 200,000 USD flat does not. */
  assert.equal(budgetGate({ price: 100000, priceCurrency: 'USD', budgetMax: 270000, budgetCurrency: 'GEL', converter: fx }), 'AGREE');
  assert.equal(budgetGate({ price: 200000, priceCurrency: 'USD', budgetMax: 270000, budgetCurrency: 'GEL', converter: fx }), 'CONFLICT');
  /* EUR -> USD through GEL. */
  assert.equal(budgetGate({ price: 110000, priceCurrency: 'USD', budgetMax: 100000, budgetCurrency: 'EUR', converter: fx }), 'AGREE');
  const old = [{ ...payload[0], date: new Date(now - (FX_NBG_MAX_AGE_DAYS + 1) * 86_400_000).toISOString() }];
  assert.equal(ratesFromNbg(old, now), null, 'an old NBG payload is refused');
  assert.equal(ratesFromNbg([{ currencies: payload[0].currencies }], now), null, 'an undated payload is refused');
});

test('without FX, same-currency matching still works and cross-currency is UNKNOWN', () => {
  const none = converterFrom();
  assert.equal(budgetGate({ price: 100000, priceCurrency: 'USD', budgetMax: 120000, budgetCurrency: 'USD', converter: none }), 'AGREE');
  assert.equal(budgetGate({ price: 900000, priceCurrency: 'USD', budgetMax: 120000, budgetCurrency: 'USD', converter: none }), 'CONFLICT');
  assert.equal(budgetGate({ price: 900000, priceCurrency: 'USD', budgetMax: 120000, budgetCurrency: 'GEL', converter: none }), 'UNKNOWN');
});

test('the place table\'s city/district split is what the gate relies on', async () => {
  const { resolvePlace } = await import('../normalize/place.ts');
  for (const city of ['Tbilisi', 'Batumi', 'Kutaisi', 'Rustavi', 'Kobuleti']) assert.equal(resolvePlace(city)?.kind, 'CITY', city);
  for (const d of ['Vake', 'Saburtalo', 'Ortachala', 'Didi Digomi']) assert.equal(resolvePlace(d)?.kind, 'DISTRICT', d);
  assert.equal(resolvePlace('Tbilisi Sea'), null);
});

test('rates handed to the match writer are re-validated, not trusted', () => {
  const now = Date.parse('2026-09-29T12:00:00Z');
  const fresh = '2026-09-29T00:00:00.000Z';
  const ok = ratesFromPayload({ USD_GEL: { rate: 2.7, asOf: fresh } }, now);
  assert.deepEqual(Object.keys(ok), ['USD_GEL']);
  assert.equal(ratesFromPayload({ USD_GEL: { rate: 2.7, asOf: '2026-09-01T00:00:00Z' } }, now), null, 'stale');
  assert.equal(ratesFromPayload({ USD_GEL: { rate: -1, asOf: fresh } }, now), null, 'nonsense rate');
  assert.equal(ratesFromPayload({ USD_EUR: { rate: 0.9, asOf: fresh } }, now), null, 'only CODE_GEL pairs');
  assert.equal(ratesFromPayload({ USD_GEL: { rate: 2.7 } }, now), null, 'undated');
  assert.equal(ratesFromPayload(null, now), null);
});
