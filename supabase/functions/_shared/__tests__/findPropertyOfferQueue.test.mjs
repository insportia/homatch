// Find Property paid social offers: queue rows satisfy the queue schema, registry
// rows map to the right network/kind, and a stopped campaign keeps what it paid for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { offerQueueRows, offerSourceFromRegistry } from '../findProperty/socialOffers.ts';
import { planOfferJobs } from '../../../../src/research-core/findProperty/offerCampaign.ts';

const OFFERS = readFileSync(new URL('../findProperty/socialOffers.ts', import.meta.url), 'utf8');
const search = { transaction: 'SALE', propertyType: 'APARTMENT', city: 'Tbilisi', districts: ['Vake'], languages: ['ka', 'en'] };

test('every queue row has a language (discovery_query_queue.language is NOT NULL)', () => {
  const plan = { jobs: [
    { stage: 'FB_POST_SEARCH', actorKey: 'FB_POST_SEARCH', network: 'FACEBOOK', query: 'იყიდება ბინა ვაკე', language: 'ka', targetUrl: null, sourceId: null, size: 20, estimateMicros: 1 },
    { stage: 'TELEGRAM_CHANNEL', actorKey: 'TELEGRAM_CHANNEL', network: 'TELEGRAM', query: null, targetUrl: 'https://t.me/x', sourceId: 's1', size: 20, estimateMicros: 1 },
  ] };
  const rows = offerQueueRows('run-1', null, plan, search);
  assert.deepEqual(rows.map((r) => r.language), ['ka', 'multi']);
  for (const r of rows) assert.ok(r.platform && r.status === 'PENDING' && r.search_direction === 'SUPPLY');
});

test('keyword search jobs carry their search language', () => {
  const actor = { actorKey: 'FB_POST_SEARCH', ready: true, startFeeMicros: 0, pricePer1kMicros: 5000, probeSize: 20 };
  const plan = planOfferJobs({ search, networks: ['FACEBOOK'], actors: { FB_POST_SEARCH: actor }, sources: [], providerBudgetMicros: 10_000_000 });
  const fb = plan.jobs.filter((j) => j.stage === 'FB_POST_SEARCH');
  assert.ok(fb.length >= 1);
  for (const j of fb) assert.ok(search.languages.includes(j.language));
});

test('a Facebook SOCIAL_PROFILE is a Page; an Instagram one is Instagram', () => {
  const base = { id: 'x', url: 'https://www.facebook.com/somepage', city: 'Tbilisi', priority: 5 };
  assert.deepEqual(offerSourceFromRegistry({ ...base, platform: 'FACEBOOK', source_type: 'SOCIAL_PROFILE' }),
    { id: 'x', network: 'FACEBOOK', kind: 'FACEBOOK_PAGE', url: base.url, city: 'Tbilisi', priority: 5, name: null, offerEvidence: 0, districtEvidence: 0 });
  assert.equal(offerSourceFromRegistry({ ...base, platform: 'INSTAGRAM', source_type: 'SOCIAL_PROFILE' }).network, 'INSTAGRAM');
  assert.equal(offerSourceFromRegistry({ ...base, platform: 'FACEBOOK', source_type: 'FACEBOOK_GROUP' }).kind, 'FACEBOOK_GROUP');
  assert.equal(offerSourceFromRegistry({ ...base, platform: 'TIKTOK', source_type: 'SOCIAL_PROFILE' }), null);
  assert.equal(offerSourceFromRegistry({ ...base, platform: 'FACEBOOK', source_type: 'FORUM' }), null);
});

test('a Page source is planned as Page posts', () => {
  const actor = (k) => ({ actorKey: k, ready: true, startFeeMicros: 0, pricePer1kMicros: 5000, probeSize: 20 });
  const page = offerSourceFromRegistry({ id: 'p', platform: 'FACEBOOK', source_type: 'SOCIAL_PROFILE', url: 'https://www.facebook.com/p', city: null, priority: 5 });
  const plan = planOfferJobs({ search: { ...search, languages: [] }, networks: ['FACEBOOK'],
    actors: { FB_PAGE_POSTS: actor('FB_PAGE_POSTS'), FB_GROUP_POSTS: actor('FB_GROUP_POSTS') }, sources: [page], providerBudgetMicros: 10_000_000 });
  assert.deepEqual(plan.jobs.map((j) => j.stage), ['FB_PAGE_POSTS']);
});

test('a campaign that ends keeps the offers its provider already delivered', () => {
  const finish = OFFERS.slice(OFFERS.indexOf('export async function finishOfferCampaign'));
  assert.match(finish, /datasetItems\(/);
  assert.match(finish, /await storeOffers\(db, ar, ar\.stage as OfferStage, items/);
  assert.match(finish, /p_items_fetched: items\.length, p_offers: offers/);
  assert.doesNotMatch(finish.slice(finish.indexOf('abortRun')), /p_offers: 0, p_error: 'CAMPAIGN_ENDED'/);
});

test('an offer that cannot be stored is reported, never silent', () => {
  assert.match(OFFERS, /find_property_offer_store_failed/);
});

test('offer evidence: stored offers per community are counted across pages and reach the planner', async () => {
  const { loadOfferSources } = await import('../findProperty/socialOffers.ts');
  const reg = [
    { id: 'a', platform: 'TELEGRAM', source_type: 'TELEGRAM_GROUP', name: null, url: 'https://t.me/tbilisio', city: null, priority: 5 },
    { id: 'b', platform: 'TELEGRAM', source_type: 'TELEGRAM_GROUP', name: null, url: 'https://t.me/casinosamsoom', city: null, priority: 5 },
  ];
  const page1 = [...Array.from({ length: 999 }, () => ({ source_id: 'a' })), { source_id: 'b' }];
  const page2 = [{ source_id: 'a' }];
  const ranges = [];
  const db = { from(table) {
    const q = { table, range: null };
    const chain = { select() { return chain; }, eq() { return chain; }, in() { return chain; }, not() { return chain; }, gte() { return chain; }, order() { return chain; },
      range(f, t) { q.range = [f, t]; ranges.push([f, t]); return chain; },
      then(res, rej) { const data = table === 'source_registry' ? reg : q.range?.[0] === 0 ? page1 : page2; return Promise.resolve({ data, error: null }).then(res, rej); } };
    return chain;
  } };
  const out = await loadOfferSources(db, 'GE');
  assert.deepEqual(ranges, [[0, 999], [1000, 1999]], 'paged past the 1000-row API limit');
  assert.equal(out.find((s) => s.id === 'a').offerEvidence, 1000);
  assert.equal(out.find((s) => s.id === 'b').offerEvidence, 1);
});
