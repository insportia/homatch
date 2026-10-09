import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyPair, identityOf, resolveProperties } from '../marketplace/property-entity.ts';
import { normalizeCandidate } from '../marketplace/normalize.ts';
import { processSearch } from '../marketplace/pipeline.ts';
import { applyEdit, sanitizeBrief } from '../marketplace/brief.ts';
import { buildSearchRequest } from '../marketplace/worker-contract.ts';
import { hardFilter } from '../marketplace/ranking.ts';
import { selectUpgrades, whatYouGain, isMeaningful } from '../marketplace/upgrade.ts';
import * as F from './fixtures/marketplaceFixtures.mjs';
const now = F.FIXTURE_NOW;
const norm = (over) => normalizeCandidate(F.listing(over), { now });
const production = JSON.parse(readFileSync(new URL('./fixtures/production-property-identity.json', import.meta.url)));
const recorded = production.listings;
const saved = recorded.map((r) => normalizeCandidate(r, { now }));

test('real production: Zhvania 10 and Zhvania 1 are not the same apartment based on dimensions', () => {
  const a = saved.find((l) => l.id === 'myhome-ge:21944160');
  const b = saved.find((l) => l.id === 'ss-ge:36964005');
  assert.equal(a.areaSqm, b.areaSqm); assert.equal(a.floor, b.floor);
  assert.notEqual(a.address, b.address);
  assert.notEqual(identityOf(classifyPair(a, b)), 'CONFIRMED_DUPLICATE');
  const r = resolveProperties(saved);
  assert.notEqual(r.keyOf.get(a.id), r.keyOf.get(b.id));
  for (const c of r.clusters) for (const x of c.memberIds) for (const y of c.memberIds) {
    if (x === y) continue;
    assert.equal(identityOf(classifyPair(saved.find((l) => l.id === x), saved.find((l) => l.id === y))), 'CONFIRMED_DUPLICATE');
  }
  assert.equal(saved.length, 90, 'all original source observations retained');
  const output = processSearch({ request: production.request, candidates: recorded.map(candidate => ({ workerId: 'stored', candidate })), now: new Date('2026-10-09T08:01:05.145Z') });
  assert.equal(output.stats.uniqueProperties, 90);
  assert.equal(output.properties.length, 66);
  assert.ok(output.properties.filter(p => p.group === 'BEST').every(p => p.facts.priceUsd <= 160000));
  assert.ok(output.properties.filter(p => p.group === 'UPGRADE').every(p => p.facts.priceUsd >= 168000 && p.facts.priceUsd <= 176000));
});

test('similar dimensions, description, broker contact and building pin never confirm identity', () => {
  const a = norm({ source: 'myhome-ge', ...F.CONFIRMED_IDENTITY, images: [], latitude: 41.7, longitude: 44.8, seller: { publicPhone: '+995555111222' } });
  const b = norm({ source: 'ss-ge', ...F.CONFIRMED_IDENTITY, images: [], latitude: 41.7, longitude: 44.8, seller: { publicPhone: '+995555111222' } });
  assert.equal(identityOf(classifyPair(a, b)), 'POSSIBLE_DUPLICATE');
  assert.equal(resolveProperties([a, b]).clusters.length, 2);
  assert.equal(identityOf(classifyPair(norm({}), norm({ source: 'ss-ge' }))), 'INSUFFICIENT_EVIDENCE');
});

test('corroborated identities collapse, conflicting unit configuration vetoes photo reuse', () => {
  const a = norm({ ...F.CONFIRMED_IDENTITY, source: 'myhome-ge' });
  const b = norm({ ...F.CONFIRMED_IDENTITY, source: 'ss-ge' });
  assert.equal(identityOf(classifyPair(a, b)), 'CONFIRMED_DUPLICATE');
  assert.equal(resolveProperties([a, b]).clusters.length, 1);
  for (const difference of [{ totalFloors: 16 }, { floor: 8 }, { rooms: 4 }, { bedrooms: 3 }, { areaSqm: 120 }]) {
    assert.equal(identityOf(classifyPair(a, { ...b, ...difference })), 'DISTINCT_PROPERTY');
    assert.equal(resolveProperties([a, { ...b, ...difference }]).clusters.length, 2);
  }
  assert.notEqual(identityOf(classifyPair(a, { ...b, address: null })), 'CONFIRMED_DUPLICATE');
  assert.equal(identityOf(classifyPair(a, { ...b, address: '12 Example Street, unit 8' })), 'DISTINCT_PROPERTY');
  assert.notEqual(identityOf(classifyPair({ ...a, address: '12 Example Street' }, { ...b, address: '12 Example Street' })), 'CONFIRMED_DUPLICATE', 'reused photos in one building cannot identify a unit');
});

test('complete linkage requires affirmative identity for every pair, not merely absence of a contradiction', () => {
  const common = { ...F.CONFIRMED_IDENTITY };
  const photos = (ids) => ids.map((id) => `https://img.example/${id}.jpg`);
  const a = norm({ ...common, source: 'a', images: photos([1,2,3]) });
  const b = norm({ ...common, source: 'b', images: photos([1,2,3,4,5,6]) });
  const c = norm({ ...common, source: 'c', images: photos([4,5,6]) });
  const r = resolveProperties([a,b,c]);
  assert.equal(r.clusters.length, 2); assert.ok(r.vetoed.length > 0);
  assert.notEqual(r.keyOf.get(a.id), r.keyOf.get(c.id));
});

test('advanced optional requirements survive serialization; legacy brief remains valid', () => {
  const brief = applyEdit(sanitizeBrief({}), { field: 'advanced', value: {
    floorPreferences: ['NOT_FIRST', 'NOT_LAST'], floorRange: { min: 2, max: 7 }, maxBuildingAge: 15, elevatorRequired: true,
  } });
  const savedBrief = sanitizeBrief(JSON.parse(JSON.stringify(brief)));
  assert.deepEqual(savedBrief.floorRange, { min: 2, max: 7 }); assert.equal(savedBrief.maxBuildingAge, 15);
  assert.ok(savedBrief.mustHave.includes('ELEVATOR')); assert.equal(sanitizeBrief({}).maxBuildingAge, null);
  assert.equal(sanitizeBrief({ maxBuildingAge: -1 }).maxBuildingAge, null);
  const tall = sanitizeBrief({ floorRange: { min: -2, max: 80 }, maxBuildingAge: 100 });
  assert.deepEqual(tall.floorRange, { min: -2, max: 80 }); assert.equal(tall.maxBuildingAge, 100);
  assert.equal(sanitizeBrief({ maxBuildingAge: '100' }).maxBuildingAge, null);
});

test('fifth of five without elevator is excluded when required; unknown elevator never becomes confirmed', () => {
  const req = { ...F.FIXTURE_REQUEST, requestedAt: '2026-10-09T00:00:00Z', mustHave: ['ELEVATOR'], floorRange: { min: 2, max: 7 }, maxBuildingAge: 15 };
  const facts = { ...norm({ floor: 5, totalFloors: 5, constructionYear: 2020 }), elevator: false };
  assert.ok(hardFilter(facts, req).violations.includes('REQUIRED_ELEVATOR'));
  const unknown = hardFilter({ ...facts, elevator: null }, req);
  assert.ok(unknown.unverified.includes('REQUIRED_ELEVATOR'));
  assert.ok(hardFilter({ ...facts, elevator: true, floor: 8 }, req).violations.includes('FLOOR_RANGE'));
  assert.ok(hardFilter({ ...facts, elevator: true, constructionYear: 1990 }, req).violations.includes('BUILDING_AGE'));
  const rejected = processSearch({ request: req, candidates: F.fixtureCandidates([F.listing({ floor: 5, totalFloors: 5, description: 'No elevator.' })]), now });
  assert.equal(rejected.properties.length, 0);
});

test('missing baseline data is never an improvement; seller and freshness alone are not an upgrade', () => {
  const candidate = (key,price) => ({ key, facts: { ...norm({ price }), priceUsd: price, pricePerSqmUsd: 1600 }, band: price <= 150000 ? 'IN_BUDGET' : 'UPGRADE_EXTENDED', fits: true, criteriaScore: 1, freshness: 'VERIFIED', seller: 'UNKNOWN', score: 1 });
  const b = candidate('baseline', 150000), c = candidate('upgrade', 160000);
  c.facts.parking = true; b.facts.parking = null; c.facts.renovationStatus = 'RENOVATED'; b.facts.renovationStatus = null;
  const gain = whatYouGain(b,c,{maxUsd:150000,districts:[]});
  assert.ok(!gain.advantages.some((a) => a.code === 'PARKING' || a.code === 'BETTER_RENOVATION'));
  assert.equal(isMeaningful(gain),false);
  c.facts.areaSqm = 110;
  assert.equal(selectUpgrades([b,c],{maxUsd:150000,districts:[]}).length,1);
  for (const price of [157499,165001]) assert.equal(selectUpgrades([b,{...c,facts:{...c.facts,priceUsd:price}}],{maxUsd:150000,districts:[]}).length,0);
});
