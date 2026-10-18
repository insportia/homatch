// FIND BUYERS — Facebook Pages discovery in the plan, listing queries, and the
// one-campaign test cap (2026-10-16). Pure: no network, no database.
import test from 'node:test';
import { classifyDemand } from '../findBuyers/demandClassifier.ts';
import assert from 'node:assert/strict';

import { buildPropertyDna } from '../findBuyers/propertyDna.ts';
import { buildQueryPlan, queriesFor } from '../findBuyers/queryPlanner.ts';
import { initialSocialJobs, LISTING_SEARCH_LANGUAGES } from '../findBuyers/campaignPlan.ts';
import { cappedBudget, decideTestCap, parseTestCap, TEST_CAP_MAX_USD } from '../findBuyers/testCap.ts';

const SALE = buildPropertyDna({ transactionType: 'SALE', propertyType: 'APARTMENT', city: 'Tbilisi', district: 'Krtsanisi', totalPrice: 213840, currency: 'USD', area: 97.2, rooms: 3, bedrooms: 2 });
const RENT = buildPropertyDna({ transactionType: 'RENT', propertyType: 'APARTMENT', city: 'Batumi', totalPrice: 700, currency: 'USD', area: 50, bedrooms: 1 });

test('listing queries are how a comparable flat is ADVERTISED, per language and side', () => {
  const sale = buildQueryPlan(SALE);
  const ka = queriesFor(sale, 'listing', 'ka').map((q) => q.query);
  assert.ok(ka[0].startsWith('იყიდება ') && /3-ოთახიანი/.test(ka[0]) && /კრწანის/.test(ka[0]), ka[0]);
  assert.equal(ka.length, 2);
  assert.ok(queriesFor(sale, 'listing', 'ru')[0].query.startsWith('продается '));
  assert.match(queriesFor(sale, 'listing', 'en')[0].query, /for sale/);
  for (const lang of ['ar', 'he']) assert.equal(queriesFor(sale, 'listing', lang).length, 1, lang);
  /* Turkish "<place> satılık daire" is already a demand phrasing: one phrasing per language is kept once. */
  assert.ok(queriesFor(sale, 'listing', 'tr').length <= 1);
  const rent = buildQueryPlan(RENT);
  assert.ok(queriesFor(rent, 'listing', 'ka')[0].query.startsWith('ქირავდება '));
  assert.ok(!queriesFor(rent, 'listing').some((q) => /იყიდება|продается|for sale/.test(q.query)), 'a rental never searches sale listings');
  /* Demand queries are unchanged by the new kind. */
  assert.ok(queriesFor(sale, 'demand', 'ka').length > 0);
});

const enabled = {
  FB_GROUP_SEARCH: { probeSize: 10, priority: 80 }, FB_GROUP_POSTS: { probeSize: 20, priority: 80 },
  FB_POST_SEARCH: { probeSize: 15, priority: 55 }, FB_PAGE_POSTS: { probeSize: 10, priority: 50 },
};
const now = Date.parse('2026-10-16T10:00:00Z');
const known = [
  { id: 'g1', platform: 'FACEBOOK', sourceType: 'FACEBOOK_GROUP', url: 'https://www.facebook.com/groups/1', languages: ['ka'], city: 'Tbilisi', historicalYield: 1, lastCheckedAt: null },
  { id: 'g2', platform: 'FACEBOOK', url: 'https://www.facebook.com/groups/2', languages: ['ru'], city: 'Tbilisi', historicalYield: null, lastCheckedAt: null },
  { id: 'p1', platform: 'FACEBOOK', sourceType: 'SOCIAL_PROFILE', url: 'https://www.facebook.com/tbilisihomes', languages: ['ka'], city: 'Tbilisi', historicalYield: null, lastCheckedAt: null },
];

test('the plan searches public listing posts (Georgian first) and reads known Pages; Pages never reach the group reader', () => {
  const jobs = initialSocialJobs({ dna: SALE, plan: buildQueryPlan(SALE), knownSources: known, enabledActors: enabled, nativeTelegramActive: true, now });
  const search = jobs.filter((j) => j.stage === 'FB_POST_SEARCH' && j.reason === 'comparable_listing_search');
  assert.deepEqual([...new Set(search.map((j) => j.language))].sort(), [...LISTING_SEARCH_LANGUAGES].sort());
  assert.equal(search.filter((j) => j.language === 'ka').length, 2, 'two Georgian listing phrasings');
  assert.ok(search.every((j) => j.query && j.actorKey === 'FB_POST_SEARCH'));
  /* Buyers' own posts by purchase phrase, one per Facebook language (owner, 2026-10-18). */
  const demand = jobs.filter((j) => j.stage === 'FB_POST_SEARCH' && j.reason === 'demand_search');
  assert.deepEqual([...new Set(demand.map((j) => j.language))].sort(), ['ar', 'en', 'he', 'ka', 'ru', 'tr']);
  assert.ok(demand.every((j) => j.query && classifyDemand(j.query).role === 'BUY_SEEKER'), demand.map((j) => j.query).join(' | '));
  assert.equal(jobs.filter((j) => j.stage === 'FB_POST_SEARCH').length, search.length + demand.length, 'no other post search');
  const groupReads = jobs.filter((j) => j.stage === 'FB_GROUP_POSTS').map((j) => j.sourceId).sort();
  assert.deepEqual(groupReads, ['g1', 'g2'], 'a source without a type is a group (all rows before 2026-10-16); a Page is not');
  assert.deepEqual(jobs.filter((j) => j.stage === 'FB_PAGE_POSTS').map((j) => j.targetUrl), ['https://www.facebook.com/tbilisihomes']);
});

test('without the new Actors enabled, the plan is exactly what it was', () => {
  const { FB_POST_SEARCH, FB_PAGE_POSTS, ...old } = enabled;
  const jobs = initialSocialJobs({ dna: SALE, plan: buildQueryPlan(SALE), knownSources: known, enabledActors: old, nativeTelegramActive: true, now });
  assert.ok(!jobs.some((j) => j.stage === 'FB_POST_SEARCH' || j.stage === 'FB_PAGE_POSTS'));
});

const cap = { propertyId: 'prop-1', providerUsd: 3, expiresAt: '2026-10-18T00:00:00Z' };

test('test cap: applies once, to one property (and owner), never after expiry, never raises a budget', () => {
  const c = { propertyId: 'prop-1', userId: 'u1', matchingJobId: 'job-1', now };
  assert.deepEqual(decideTestCap(parseTestCap(cap), c), { applies: true, capMicros: 3_000_000, alreadyConsumedByThis: false });
  assert.deepEqual(decideTestCap(parseTestCap(cap), { ...c, propertyId: 'prop-2' }), { applies: false, reason: 'OTHER_PROPERTY' });
  assert.deepEqual(decideTestCap(parseTestCap({ ...cap, userId: 'u9' }), c), { applies: false, reason: 'OTHER_OWNER' });
  assert.deepEqual(decideTestCap(parseTestCap(cap), { ...c, now: Date.parse('2026-10-19T00:00:00Z') }), { applies: false, reason: 'EXPIRED' });
  const used = parseTestCap({ ...cap, consumedBy: 'job-1' });
  assert.deepEqual(decideTestCap(used, { ...c, matchingJobId: 'job-2' }), { applies: false, reason: 'CONSUMED' }, 'a second campaign never gets it');
  assert.equal(decideTestCap(used, c).applies, true, 'a retry of the campaign that consumed it keeps it');
  assert.equal(decideTestCap(null, c).reason, 'NONE');
  assert.equal(cappedBudget(5_000_000, 3_000_000), 3_000_000);
  assert.equal(cappedBudget(2_000_000, 3_000_000), 2_000_000, 'a cap never raises what the credits pay for');
});

test('test cap: malformed or oversized values are no cap at all', () => {
  for (const bad of [null, 'x', {}, { ...cap, providerUsd: 0 }, { ...cap, providerUsd: TEST_CAP_MAX_USD + 1 }, { ...cap, propertyId: '' }, { ...cap, expiresAt: 'soon' }]) {
    assert.equal(parseTestCap(bad), null, JSON.stringify(bad));
  }
  assert.equal(parseTestCap(JSON.stringify(cap)).providerUsd, 3, 'stored as a JSON string is read the same');
});
