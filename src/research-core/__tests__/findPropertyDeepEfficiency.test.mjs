// Deep Search efficiency (owner, 2026-10-18): the request's own words before any provider
// run, the most relevant communities first, probe-first runs that stop a useless network at
// no cost, Telegram out until its output is verified, and a 20-credit test that stays inside
// its $1.26 provider budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requestQueries, districtFocus, planOfferJobs, followUpDecision, telegramPostUrl, kaLocative, LOW_YIELD_MIN_BILLED, offerSearchLanguages,
} from '../findProperty/offerCampaign.ts';
import { allocateCampaign } from '../billing/paidDiscoveryPolicy.ts';

const ACTORS = {
  FB_GROUP_POSTS: { actorKey: 'FB_GROUP_POSTS', ready: true, startFeeMicros: 8000, pricePer1kMicros: 1_500_000, probeSize: 20, maxResults: 100, outputVerified: true },
  TELEGRAM_CHANNEL: { actorKey: 'TELEGRAM_CHANNEL', ready: true, startFeeMicros: 1000, pricePer1kMicros: 250_000, probeSize: 30, maxResults: 150 },
  TIKTOK: { actorKey: 'TIKTOK', ready: true, startFeeMicros: 5000, pricePer1kMicros: 2_000_000, probeSize: 20, maxResults: 60, outputVerified: true },
};
const VAKE = { transaction: 'SALE', propertyType: 'APARTMENT', city: 'Tbilisi', districts: ['ვაკე'], languages: ['ka', 'ru', 'en'], rooms: 3 };
const fb = (i, extra = {}) => ({ id: `g${i}`, network: 'FACEBOOK', kind: 'FACEBOOK_GROUP', url: `https://www.facebook.com/groups/tbilisi.flats${i}`, city: 'Tbilisi', priority: 5, name: null, offerEvidence: 0, ...extra });
const tg = (i) => ({ id: `t${i}`, network: 'TELEGRAM', kind: 'TELEGRAM_GROUP', url: `https://t.me/tbilisi_sale_${i}`, city: 'Tbilisi', priority: 5, name: null, offerEvidence: 3 });

test('queries come from the request itself: transaction, rooms, type and the wanted district, in each language', () => {
  assert.deepEqual(requestQueries(VAKE), [
    { language: 'ka', query: 'იყიდება 3 ოთახიანი ბინა ვაკეში' },
    { language: 'ru', query: 'продается 3-комнатная квартира Ваке' },
    { language: 'en', query: '3 room apartment for sale Vake Tbilisi' },
  ]);
  assert.deepEqual(requestQueries({ ...VAKE, transaction: 'RENT', districts: [], rooms: null, city: 'Batumi' }).map((q) => q.query),
    ['ქირავდება ბინა ბათუმში', 'сдается квартира Батуми', 'apartment for rent Batumi']);
  assert.equal(kaLocative('თბილისი'), 'თბილისში');
  assert.equal(kaLocative('საბურთალო'), 'საბურთალოში');
});

test('TikTok (server-side search, verified) is given the request phrases, not generic city words', () => {
  const plan = planOfferJobs({ search: VAKE, networks: ['TIKTOK'], actors: ACTORS, sources: [], providerBudgetMicros: 1_260_000 });
  assert.deepEqual(plan.jobs[0].queries, requestQueries(VAKE).map((q) => q.query));
});

test('the most relevant communities are read first: district evidence, then the district in the name; another district last', () => {
  const sources = [
    ...Array.from({ length: 40 }, (_, i) => fb(i, { offerEvidence: 30 })),
    fb(90, { name: 'ბინები საბურთალოზე', offerEvidence: 50 }),
    fb(91, { url: 'https://www.facebook.com/groups/vake.apartments', name: 'Vake apartments' }),
    fb(92, { districtEvidence: 7, offerEvidence: 9 }),
  ];
  assert.equal(districtFocus(sources[41], ['ვაკე']), 2);
  assert.equal(districtFocus(sources[40], ['ვაკე']), 0);
  const plan = planOfferJobs({ search: VAKE, networks: ['FACEBOOK'], actors: ACTORS, sources, providerBudgetMicros: 1_260_000 });
  const order = plan.jobs.flatMap((j) => j.targets.map((t) => t.sourceId));
  assert.deepEqual(order.slice(0, 2), ['g92', 'g91'], 'proven-in-district, then named for the district');
  assert.ok(!order.includes('g90') || order.indexOf('g90') === order.length - 1, 'a community named for another district is read last, if at all');
});

test('probe-first: a network\'s later runs wait for its first, and stop at no cost when its posts could not fit', () => {
  const sources = Array.from({ length: 53 }, (_, i) => fb(i));
  const plan = planOfferJobs({ search: VAKE, networks: ['FACEBOOK', 'TIKTOK'], actors: ACTORS, sources, providerBudgetMicros: 3_150_000 });
  const fbRuns = plan.jobs.filter((j) => j.network === 'FACEBOOK');
  assert.ok(fbRuns.length >= 2);
  assert.equal(fbRuns[0].followUp, undefined, 'the first run of a network is the probe');
  assert.ok(fbRuns.slice(1).every((j) => j.followUp === true));
  assert.equal(plan.jobs.find((j) => j.network === 'TIKTOK').followUp, undefined);
  assert.equal(followUpDecision(null), 'WAIT');
  assert.equal(followUpDecision({ billed: 990, useful: 0 }), 'STOP_LOW_YIELD');
  assert.equal(followUpDecision({ billed: 990, useful: 1 }), 'CONTINUE');
  assert.equal(followUpDecision({ billed: LOW_YIELD_MIN_BILLED - 1, useful: 0 }), 'CONTINUE', 'too few posts to judge a network');
});

test('Telegram is out of offer campaigns until its output contract is verified ($0, said out loud)', () => {
  const sources = [...Array.from({ length: 5 }, (_, i) => fb(i)), ...Array.from({ length: 12 }, (_, i) => tg(i))];
  const plan = planOfferJobs({ search: VAKE, networks: ['FACEBOOK', 'TELEGRAM', 'TIKTOK'], actors: ACTORS, sources, providerBudgetMicros: 3_150_000 });
  assert.equal(plan.jobs.filter((j) => j.network === 'TELEGRAM').length, 0);
  assert.deepEqual(plan.unavailable, [{ network: 'TELEGRAM', reason: 'OUTPUT_UNVERIFIED' }]);
  const verified = planOfferJobs({ search: VAKE, networks: ['TELEGRAM'], actors: { ...ACTORS, TELEGRAM_CHANNEL: { ...ACTORS.TELEGRAM_CHANNEL, outputVerified: true } }, sources, providerBudgetMicros: 3_150_000 });
  assert.ok(verified.jobs.length > 0, 'once verified it is planned again');
});

test('Telegram post links are built from channel + message id (the production output shape)', () => {
  /* Real shape (raw_signals, 2026-10-17): parent https://t.me/bd_tbilisi_sale, external id post:23311, no post URL. */
  assert.equal(telegramPostUrl('https://t.me/bd_tbilisi_sale', 'post:23311'), 'https://t.me/bd_tbilisi_sale/23311');
  assert.equal(telegramPostUrl('https://t.me/s/ArendaKvartiriTbilisi', '81634'), 'https://t.me/ArendaKvartiriTbilisi/81634');
  assert.equal(telegramPostUrl('https://evil.example/x', 'post:1'), null);
  assert.equal(telegramPostUrl('https://t.me/bd_tbilisi_sale', 'post:abc'), null);
});

test('the 20-credit test reads the most relevant sources and never plans beyond $1.26', () => {
  const budget = allocateCampaign(20, 10).providerBudgetMicros;
  assert.equal(budget, 1_260_000);
  const sources = [...Array.from({ length: 53 }, (_, i) => fb(i, { offerEvidence: i })), fb(99, { districtEvidence: 4, offerEvidence: 4 }), ...Array.from({ length: 41 }, (_, i) => tg(i))];
  const plan = planOfferJobs({ search: { ...VAKE, languages: offerSearchLanguages('ka') }, networks: ['FACEBOOK', 'TELEGRAM', 'TIKTOK'], actors: ACTORS, sources, providerBudgetMicros: budget });
  assert.ok(plan.estimatedMicros <= budget, `${plan.estimatedMicros} ≤ ${budget}`);
  assert.equal(plan.jobs.filter((j) => j.network === 'TELEGRAM').length, 0, 'no paid Telegram');
  assert.equal(plan.jobs.find((j) => j.network === 'FACEBOOK').targets[0].sourceId, 'g99', 'the district-proven group is read first');
  assert.ok(plan.jobs.some((j) => j.network === 'TIKTOK'));
});
