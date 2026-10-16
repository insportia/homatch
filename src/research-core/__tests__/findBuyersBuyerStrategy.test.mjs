// FIND BUYERS — the property-specific buyer strategy: different properties
// get different personas, places, languages and phrasings; queries carry
// explicit intent; learning only re-orders/retires; depth follows the budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBuyerStrategy, prioritizeQueries, depthFor, areasOf } from '../findBuyers/buyerStrategy.ts';
import { buildPropertyDna } from '../findBuyers/propertyDna.ts';
import { buildQueryPlan } from '../findBuyers/queryPlanner.ts';
import { classifyDemand } from '../findBuyers/demandClassifier.ts';

const villion = buildPropertyDna({ transactionType: 'SALE', propertyType: 'APARTMENT', city: 'Tbilisi', district: 'Krtsanisi', totalPrice: 213840, currency: 'USD', area: 97.2, rooms: 3, bedrooms: 2 });
const gldani = buildPropertyDna({ transactionType: 'SALE', propertyType: 'APARTMENT', city: 'Tbilisi', district: 'Gldani', totalPrice: 52000, currency: 'USD', area: 48, rooms: 2, bedrooms: 1 });
const rent = buildPropertyDna({ transactionType: 'RENT', propertyType: 'APARTMENT', city: 'Tbilisi', district: 'Vake', totalPrice: 900, currency: 'USD', area: 70, rooms: 3, bedrooms: 2 });

test('a premium Krtsanisi apartment and an economy Gldani flat get different strategies', () => {
  const a = buildBuyerStrategy({ dna: villion, segment: { segment: 'PREMIUM', confidence: 0.7 }, providerBudgetMicros: 15e6 });
  const b = buildBuyerStrategy({ dna: gldani, segment: { segment: 'ECONOMY', confidence: 0.7 }, providerBudgetMicros: 15e6 });
  assert.ok(a.personas.some((p) => p.key === 'LUXURY' || p.key === 'INVESTOR'));
  assert.ok(b.personas.some((p) => p.key === 'FIRST_TIME'));
  assert.ok(!b.personas.some((p) => p.key === 'LUXURY'));
  assert.deepEqual(a.places.areas.sort(), ['abanotubani', 'ortachala', 'ponichala']);
  assert.ok(a.places.nearby.includes('sololaki'));
  const qa = a.queries.map((q) => q.query).join(' | ');
  const qb = b.queries.map((q) => q.query).join(' | ');
  assert.notEqual(qa, qb);
  assert.ok(/Крцаниси|Krtsanisi|კრწანის/.test(qa));
  assert.ok(/Глдани|Gldani|გლდან/.test(qb));
  assert.deepEqual(a.budgetBand, { min: 171072, max: 256608, currency: 'USD' });
});

test('every SALE query reads as explicit purchase intent in its language; RENT queries as renting', () => {
  for (const dna of [villion, gldani]) {
    for (const q of buildBuyerStrategy({ dna, providerBudgetMicros: 15e6 }).queries) {
      assert.equal(classifyDemand(q.query).role, 'BUY_SEEKER', `${q.language}: ${q.query}`);
    }
  }
  for (const q of buildBuyerStrategy({ dna: rent, providerBudgetMicros: 15e6 }).queries) {
    assert.equal(classifyDemand(q.query).role, 'RENT_SEEKER', `${q.language}: ${q.query}`);
  }
});

test('no segment evidence → UNKNOWN (never inferred from the price alone)', () => {
  assert.equal(buildBuyerStrategy({ dna: villion, providerBudgetMicros: 5e6 }).segment, 'UNKNOWN');
});

test('the query plan uses the strategy phrasings for demand and keeps community search', () => {
  const s = buildBuyerStrategy({ dna: villion, providerBudgetMicros: 15e6 });
  const plan = buildQueryPlan(villion, undefined, s);
  const demand = plan.queries.filter((q) => q.kind === 'demand').map((q) => q.query);
  assert.ok(demand.length > 0 && demand.every((q) => s.queries.some((x) => x.query === q)));
  assert.ok(plan.queries.some((q) => q.kind === 'community'));
});

test('depth: the budget unlocks platforms, languages and phrasings; the owner choice wins', () => {
  const p = buildBuyerStrategy({ dna: villion, providerBudgetMicros: 15e6 }).personas;
  const small = depthFor(2.8e6, p); const mid = depthFor(5e6, p); const big = depthFor(20e6, p);
  assert.deepEqual([small.tier, mid.tier, big.tier], ['FOCUSED', 'STANDARD', 'BROAD']);
  assert.ok(small.languages.length < big.languages.length);
  assert.ok(!small.platforms.includes('TIKTOK') && big.platforms.includes('LINKEDIN'));
  assert.deepEqual(depthFor(2.8e6, p, ['ar']).languages, ['ar']);
});

test('bounded learning: a query that ran 3× with content and no qualified lead is retired; productive ones go first; nothing is added', () => {
  const qs = [{ language: 'ru', query: 'A' }, { language: 'ru', query: 'B' }, { language: 'ru', query: 'C' }];
  const out = prioritizeQueries(qs, [
    { query: 'A', language: 'ru', runs: 3, items: 40, qualified: 0, spendMicros: 90000 },
    { query: 'C', language: 'ru', runs: 2, items: 20, qualified: 2, spendMicros: 60000 },
  ]);
  assert.deepEqual(out.map((q) => q.query), ['C', 'B']);
});

test('micro-areas belong to their district', () => {
  assert.ok(areasOf('Gldani').includes('mukhiani'));
  assert.deepEqual(areasOf(null), []);
});
