// FIND BUYERS — competitor advertising (2026-10-16). The Meta Ad Library is a way IN to
// interested people, never a source of buyers: an ad is supply, the Library exposes no
// comments, and a comparable ad leads to its advertiser's Page feed (comments attached).
// Pure: no network, no database, no spend.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPropertyDna } from '../findBuyers/propertyDna.ts';
import { buildQueryPlan, queriesFor } from '../findBuyers/queryPlanner.ts';
import { initialSocialJobs, LISTING_SEARCH_LANGUAGES } from '../findBuyers/campaignPlan.ts';
import { buildInput, defaultInput, STAGE_ACTOR, STAGE_OUTPUT } from '../findBuyers/actorInputs.ts';
import { normalizeDataset } from '../findBuyers/normalize.ts';
import { classifyDemand } from '../findBuyers/demandClassifier.ts';
import { classifyBuyerIntent } from '../findBuyers/buyerIntent.ts';
import { REGISTRY_SEEDS, ACTOR_PROFILES } from '../findBuyers/actorCatalog.ts';

const SALE = buildPropertyDna({ transactionType: 'SALE', propertyType: 'APARTMENT', city: 'Tbilisi', district: 'Krtsanisi', totalPrice: 213840, currency: 'USD', area: 97.2, rooms: 3, bedrooms: 2, countryCode: 'GE' });
const now = Date.parse('2026-10-16T10:00:00Z');

const AD = {
  ad_archive_id: '1234567890123', page_id: '987654321', page_name: 'Krtsanisi Residence', is_active: true,
  start_date: 1791000000, end_date: null,
  snapshot: { title: 'იყიდება 3-ოთახიანი ბინა კრწანისში', body: { text: 'ახალი პროექტი კრწანისში, მწვანე კარკასი, განვადება. დაგვიკავშირდით!' },
    page_profile_uri: 'https://www.facebook.com/krtsanisiresidence' },
};

test('an ad is a POST by its Page, linked to the public Ad Library entry, with no comments claimed', () => {
  const [item] = normalizeDataset(STAGE_OUTPUT.FB_AD_LIBRARY, 'FACEBOOK', [AD, { ...AD }, { error: 'x' }, { ad_archive_id: 'not-an-id', snapshot: { body: 'x' } }]);
  assert.equal(normalizeDataset(STAGE_OUTPUT.FB_AD_LIBRARY, 'FACEBOOK', [AD, { ...AD }]).length, 1, 'one ad, once');
  assert.equal(item.kind, 'POST');
  assert.equal(item.url, 'https://www.facebook.com/ads/library/?id=1234567890123');
  assert.equal(item.author.url, 'https://www.facebook.com/krtsanisiresidence');
  assert.equal(item.author.name, 'Krtsanisi Residence');
  assert.equal(item.engagement.comments, null, 'the Library exposes no comments: unknown, never zero');
  assert.deepEqual(item.inlineComments, []);
  assert.ok(item.publishedAt, 'an active ad is current');
  assert.match(item.text, /იყიდება 3-ოთახიანი/);
});

test('a competitor ad is supply, never a buyer', () => {
  const [item] = normalizeDataset('ADS', 'FACEBOOK', [AD]);
  const r = classifyDemand(item.text);
  assert.equal(r.role, 'SALE_OFFER');
  assert.equal(classifyBuyerIntent({ text: item.text, kind: 'POST', reading: r }).resultType, 'EXCLUDED');
});

test('the Ad Library is planned only when its Actor is registered and enabled, with listing phrases', () => {
  const base = { FB_GROUP_SEARCH: { probeSize: 10, priority: 80 }, FB_GROUP_POSTS: { probeSize: 20, priority: 80 } };
  const plan = buildQueryPlan(SALE);
  const without = initialSocialJobs({ dna: SALE, plan, knownSources: [], enabledActors: base, nativeTelegramActive: true, now });
  assert.equal(without.filter((j) => j.stage === 'FB_AD_LIBRARY').length, 0, 'not registered → never planned, never paid');
  const withAds = initialSocialJobs({ dna: SALE, plan, knownSources: [], enabledActors: { ...base, FB_AD_LIBRARY: { probeSize: 20, priority: 52 } }, nativeTelegramActive: true, now });
  const ads = withAds.filter((j) => j.stage === 'FB_AD_LIBRARY');
  assert.deepEqual([...new Set(ads.map((j) => j.language))].sort(), [...LISTING_SEARCH_LANGUAGES].sort());
  for (const j of ads) {
    assert.equal(j.query, queriesFor(plan, 'listing', j.language)[0].query);
    assert.equal(j.actorKey, STAGE_ACTOR.FB_AD_LIBRARY);
    assert.equal(j.reason, 'competitor_ads');
  }
});

test('the ad search body carries the phrase and the market, and refuses to run without a phrase', () => {
  assert.deepEqual(defaultInput('FB_AD_LIBRARY', { query: 'იყიდება ბინა კრწანისში', size: 20, country: 'ge' }),
    { searchTerms: ['იყიდება ბინა კრწანისში'], searchCountries: ['GE'], maxItems: 20 });
  const fitted = buildInput('FB_AD_LIBRARY', { query: 'x', size: 5, country: 'GE' }, { schemaProperties: ['searchTerms', 'maxItems'] });
  assert.deepEqual(fitted.input, { searchTerms: ['x'], maxItems: 5 });
  assert.deepEqual(fitted.dropped, ['searchCountries']);
});

test('registration is the owner\'s Admin step: the seed exists, nothing is enabled here', () => {
  const seed = REGISTRY_SEEDS.FB_AD_LIBRARY;
  assert.equal(seed.actor_id, 'memo23~facebook-ads-library-scraper-ppe');
  assert.equal(seed.source, 'FACEBOOK');
  assert.ok(!('enabled' in seed));
  assert.equal(ACTOR_PROFILES.FB_AD_LIBRARY.cls, 'PRIMARY_DISCOVERY');
});
