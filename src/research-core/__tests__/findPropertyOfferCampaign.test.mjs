// Paid Find Property social campaign: the plan never estimates past the 63%
// provider budget, says what it could not search, and keeps only real offers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planOfferJobs, qualifyOffer, estimateMicros } from '../findProperty/offerCampaign.ts';
import { allocateCampaign } from '../billing/paidDiscoveryPolicy.ts';

const actors = {
  FB_GROUP_POSTS: { actorKey: 'FB_GROUP_POSTS', ready: true, startFeeMicros: 8000, pricePer1kMicros: 1_500_000, probeSize: 20 },
  TELEGRAM_CHANNEL: { actorKey: 'TELEGRAM_CHANNEL', ready: true, startFeeMicros: 1000, pricePer1kMicros: 250_000, probeSize: 30, outputVerified: true }, // verified here: these tests exercise Telegram planning itself
  IG_PROFILE_POSTS: { actorKey: 'IG_PROFILE_POSTS', ready: true, startFeeMicros: 40_000, pricePer1kMicros: 800_000, probeSize: 12 },
  VK_POSTS_COMMENTS: { actorKey: 'VK_POSTS_COMMENTS', ready: false, startFeeMicros: 10_000, pricePer1kMicros: 3_600_000, probeSize: 20 },
};
const URL_OF = { FACEBOOK: (i) => `https://www.facebook.com/groups/${1000 + i}/`, TELEGRAM: (i) => `https://t.me/realestate_${i}`,
  INSTAGRAM: (i) => `https://www.instagram.com/agency${i}/`, VK: (i) => `https://vk.com/club${i}` };
const src = (i, network, kind, city = 'Tbilisi') => ({ id: `s${String(i).padStart(3, '0')}`, network, kind, url: URL_OF[network](i), city, priority: 5 });
const sources = [
  ...Array.from({ length: 42 }, (_, i) => src(i, 'FACEBOOK', 'FACEBOOK_GROUP')),
  ...Array.from({ length: 42 }, (_, i) => src(100 + i, 'TELEGRAM', 'TELEGRAM_GROUP', i % 2 ? 'Batumi' : 'თბილისი')),
  src(300, 'INSTAGRAM', 'INSTAGRAM_PROFILE', null),
  src(400, 'VK', 'VK_COMMUNITY'),
];
const search = { transaction: 'SALE', propertyType: 'APARTMENT', city: 'Tbilisi', districts: ['Krtsanisi'], languages: ['ka', 'ru', 'en'] };

test('a $5 campaign plans within its $3.15 provider budget', () => {
  const budget = allocateCampaign(50, 10).providerBudgetMicros;
  const plan = planOfferJobs({ search, networks: ['FACEBOOK', 'TELEGRAM', 'INSTAGRAM', 'VK'], actors, sources, providerBudgetMicros: budget });
  assert.equal(budget, 3_150_000);
  assert.ok(plan.estimatedMicros <= budget);
  assert.equal(plan.jobs.reduce((s, j) => s + j.estimateMicros, 0), plan.estimatedMicros);
  assert.ok(plan.jobs.some((j) => j.network === 'FACEBOOK') && plan.jobs.some((j) => j.network === 'TELEGRAM') && plan.jobs.some((j) => j.network === 'INSTAGRAM'));
  /* One read per group, no keyword copies (2026-10-18): all 42 groups fit a $5 campaign. */
  const fbGroups = new Set(plan.jobs.filter((j) => j.stage === 'FB_GROUP_POSTS').flatMap((j) => j.targets.map((t) => t.url)));
  assert.equal(fbGroups.size, 42, 'every group is read');
  assert.ok(plan.jobs.every((j) => j.stage !== 'FB_GROUP_POSTS' || j.queries.length === 0), 'no keyword is sent to the group Actor');
  assert.equal(plan.skippedForBudget, 0);
  const tight = planOfferJobs({ search, networks: ['FACEBOOK', 'TELEGRAM', 'INSTAGRAM', 'VK'], actors, sources, providerBudgetMicros: 1_600_000 });
  assert.ok(tight.skippedForBudget > 0 && tight.estimatedMicros <= 1_600_000, 'what did not fit is counted');
  assert.deepEqual(plan.unavailable, [{ network: 'VK', reason: 'NO_READY_ACTOR' }]);
});

test('Batumi channels are not searched for a Tbilisi request; ka/en spellings agree', () => {
  const plan = planOfferJobs({ search, networks: ['TELEGRAM'], actors, sources, providerBudgetMicros: 100_000_000 });
  /* Batched (owner, 2026-10-18): the 21 Tbilisi channels are read in ONE run. */
  assert.equal(plan.jobs.length, 1);
  assert.equal(plan.jobs[0].targets.length, 21);
  assert.ok(plan.jobs[0].targets.every((t) => Number(t.sourceId.slice(1)) % 2 === 0));
});

test('keyword search runs only when its Actor is ready, once per language', () => {
  const withSearch = { ...actors, FB_POST_SEARCH: { actorKey: 'FB_POST_SEARCH', ready: true, startFeeMicros: 5000, pricePer1kMicros: 2_000_000, probeSize: 25 } };
  const plan = planOfferJobs({ search, networks: ['FACEBOOK'], actors: withSearch, sources: [], providerBudgetMicros: 10_000_000 });
  assert.deepEqual(plan.jobs.map((j) => j.query), ['იყიდება ბინა Krtsanisi Tbilisi', 'продается квартира Krtsanisi Tbilisi', 'apartment for sale Krtsanisi Tbilisi']);
  assert.equal(planOfferJobs({ search, networks: ['FACEBOOK'], actors, sources: [], providerBudgetMicros: 10_000_000 }).unavailable[0].reason, 'NO_KNOWN_SOURCE');
});

test('no budget, no jobs; estimate arithmetic is integer micros', () => {
  assert.equal(planOfferJobs({ search, networks: ['FACEBOOK'], actors, sources, providerBudgetMicros: 0 }).jobs.length, 0);
  assert.equal(estimateMicros({ startFeeMicros: 8000, pricePer1kMicros: 1_500_000 }, 20), 38_000);
});

test('offers in, requests and wrong kinds out', () => {
  const s = { transaction: 'SALE', city: 'Tbilisi' };
  assert.equal(qualifyOffer('იყიდება 2 ოთახიანი ბინა კრწანისში, 75 კვ.მ, ფასი 120000$', s).offer, true);
  assert.equal(qualifyOffer('Продается квартира в Тбилиси, Ортачала, 80 м2, 150000$', s).offer, true);
  assert.deepEqual(qualifyOffer('ვეძებ ბინას კრწანისში, ბიუჯეტი 120000$, ვყიდულობ', s), { offer: false, reason: 'NOT_AN_OFFER' });
  assert.equal(qualifyOffer('Сдается квартира в Тбилиси, 800$ в месяц', s).reason, 'WRONG_TRANSACTION');
  assert.equal(qualifyOffer('Продается квартира в Батуми, 60 м2, 90000$', s).reason, 'WRONG_CITY');
  assert.equal(qualifyOffer('Продается квартира в Тбилиси, 80 м2, 150000$', s, { publishedAt: '2020-01-01T00:00:00Z' }).reason, 'TOO_OLD');
});
