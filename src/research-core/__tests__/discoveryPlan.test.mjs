// PHASE 2 — the DiscoveryPlan: two directions, staged tranches, a closed set
// of executable providers, and queue rows derived from the plan alone.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXECUTABLE_PROVIDERS,
  compileDemandPlan,
  compileSupplyPlan,
  plannedSourceJobs,
  sourceGroupOf,
} from '../discovery/discovery-plan.ts';
import { normalisePlan } from '../discovery/search-plan.ts';

const ALL_ON = { telegram: true, forum: true, portals: true, livePortalAdapters: ['home-ss-ge', 'place-ge', 'home-ge'] };
const LIMITS = { maxCredits: 50, deadlineMinutes: 30, targetResults: 3, activeDemandMaxDays: 30 };

const property = {
  transactionType: 'sale', propertyType: 'apartment', city: 'Tbilisi', district: 'Vake',
  price: 150000, currency: 'USD', bedrooms: 2, areaSqm: 80,
};

test('DEMAND plan: property becomes the subject, forums and Telegram serve it, portals never do', () => {
  const plan = compileDemandPlan({ market: 'ge', languages: ['ka', 'RU', 'ka'], property, switches: ALL_ON, limits: LIMITS });
  assert.equal(plan.direction, 'DEMAND');
  assert.equal(plan.market, 'GE');
  assert.deepEqual(plan.languages, ['ka', 'ru']);
  assert.equal(plan.subject.transaction, 'SALE');
  assert.equal(plan.subject.city, 'Tbilisi');
  assert.deepEqual(plan.portalAdapters, []);
  const providers = plan.tranches.flatMap((t) => t.providers);
  assert.ok(providers.includes('TELEGRAM') && providers.includes('FORUM'));
  assert.ok(!providers.includes('PORTAL'), 'a listing portal is not a source of demand');
  assert.equal(plan.tranches[0].tranche, 0);
  assert.equal(plan.freshness.activeDemandMaxDays, 30);
});

test('a rental property plans for tenants', () => {
  const plan = compileDemandPlan({ market: 'GE', languages: [], property: { ...property, transactionType: 'rent' }, switches: ALL_ON, limits: LIMITS });
  assert.equal(plan.subject.transaction, 'RENT');
});

test('SUPPLY plan: REQUIRED dimensions are hard, others only rank; portals come from the live list', () => {
  const { plan: search } = normalisePlan({
    goal: 'BUY', countryCode: 'GE', city: 'Tbilisi', cityStrength: 'REQUIRED',
    districts: ['Vake', 'Saburtalo'], districtsStrength: 'PREFERRED',
    propertyTypes: ['APARTMENT'], propertyTypesStrength: 'REQUIRED',
    budgetMax: 150000, currency: 'USD', budgetStrength: 'REQUIRED',
    bedroomsMin: 2, bedroomsStrength: 'FLEXIBLE', languages: ['ka'],
    originalText: '2 bedrooms in Vake or Saburtalo up to 150k',
  });
  const plan = compileSupplyPlan({ plan: search, switches: ALL_ON, limits: LIMITS });
  assert.equal(plan.direction, 'SUPPLY');
  assert.equal(plan.subject.transaction, 'SALE');
  assert.ok(plan.hardConstraints.includes('city'));
  assert.ok(plan.hardConstraints.includes('budget'));
  assert.ok(plan.softPreferences.includes('districts'));
  assert.ok(!plan.hardConstraints.includes('districts'));
  assert.deepEqual(plan.portalAdapters, ['home-ss-ge', 'place-ge', 'home-ge']);
  const providers = plan.tranches.flatMap((t) => t.providers);
  assert.ok(providers.includes('PORTAL'));
  assert.ok(!providers.includes('FORUM'), 'forums carry requests, not listings');
});

test('switches off means nothing external is planned', () => {
  const off = { telegram: false, forum: false, portals: false, livePortalAdapters: ['home-ss-ge'] };
  const plan = compileDemandPlan({ market: 'GE', languages: ['ka'], property, switches: off, limits: LIMITS });
  assert.equal(plan.tranches.length, 1);
  assert.deepEqual(plannedSourceJobs(plan, 'run-1'), []);
});

test('queue rows derive from the plan: one per provider/adapter, stable dedupe keys, tranche order', () => {
  const { plan: search } = normalisePlan({ goal: 'RENT', countryCode: 'GE', city: 'Tbilisi', cityStrength: 'REQUIRED', languages: ['ka', 'ru'] });
  const plan = compileSupplyPlan({ plan: search, switches: ALL_ON, limits: LIMITS });
  const jobs = plannedSourceJobs(plan, 'run-9');
  const keys = jobs.map((j) => j.dedupeKey);
  assert.equal(new Set(keys).size, keys.length, 'no duplicate job for the same scope');
  assert.deepEqual(plannedSourceJobs(plan, 'run-9').map((j) => j.dedupeKey), keys, 'deterministic');
  assert.equal(jobs.filter((j) => j.provider === 'PORTAL').length, 3);
  assert.ok(jobs.every((j) => EXECUTABLE_PROVIDERS.includes(j.provider)));
  const portal = jobs.find((j) => j.provider === 'PORTAL');
  assert.equal(portal.metadata.adapterId, 'home-ss-ge');
  assert.equal(portal.metadata.direction, 'SUPPLY');
  const discovery = jobs.find((j) => j.provider === 'TELEGRAM_SOURCES');
  assert.equal(discovery.tranche, 2);
  assert.ok(discovery.metadata.queries.length > 0);
});

test('retired providers are not executable and never planned', () => {
  for (const retired of ['DATAFORSEO', 'APIFY', 'ZENROWS', 'SCRAPINGBEE', 'BRIGHTDATA']) {
    assert.ok(!EXECUTABLE_PROVIDERS.includes(retired), retired);
  }
});

test('customer source groups never name a provider', () => {
  assert.equal(sourceGroupOf('TELEGRAM'), 'COMMUNITIES');
  assert.equal(sourceGroupOf('PORTAL'), 'PROPERTY_PORTALS');
  assert.equal(sourceGroupOf('FORUM'), 'FORUMS');
  assert.equal(sourceGroupOf('anything'), 'HOMATCH');
});

test('a stored SearchPlan round-trips through the draft and normalisePlan unchanged', async () => {
  const { draftFromStoredPlan } = await import('../discovery/discovery-plan.ts');
  const { plan: first } = normalisePlan({
    goal: 'RENT', countryCode: 'GE', city: 'Tbilisi', cityStrength: 'REQUIRED',
    districts: ['Vake'], districtsStrength: 'PREFERRED', propertyTypes: ['APARTMENT'], propertyTypesStrength: 'REQUIRED',
    budgetMax: 1200, currency: 'USD', budgetStrength: 'REQUIRED', bedroomsMin: 2, bedroomsStrength: 'FLEXIBLE',
    languages: ['ka', 'en'], originalText: 'two bedrooms in Vake up to 1200',
  });
  const stored = JSON.parse(JSON.stringify(first));
  const { plan: again } = normalisePlan(draftFromStoredPlan(stored));
  assert.deepEqual(again, first);
  assert.equal(normalisePlan(draftFromStoredPlan({ city: { value: 'x; drop table', strength: 'REQUIRED' } })).plan?.city?.value ?? null,
    normalisePlan({ city: 'x; drop table', cityStrength: 'REQUIRED' }).plan?.city?.value ?? null,
    'a stored value gets exactly the validation a fresh draft gets');
});
