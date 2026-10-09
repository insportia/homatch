// FIND BUYERS — source discovery is the first stage of every campaign.
//
// Production 2026-10-04: the campaign's community search ran a fixed list of
// fifteen phrases capped at six — the first six, all Georgian and Russian — so
// English, Turkish, Arabic and Hebrew communities were never searched; the
// phrases ignored the property (Batumi searches for a Tbilisi sale); the read
// ran BEFORE discovery (priority 70 vs 60), so nothing found was read in the
// same campaign; and the read took any enabled community, Batumi included.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SITE_LANGUAGES, campaignSourceQueries, citiesMentioned, cityKeyOf, communityCityFit, communityFitFor, rankCommunitiesForCampaign,
} from '../discovery/sourceNetwork.ts';
import { compileDemandPlan, compileSupplyPlan, plannedSourceJobs } from '../discovery/discovery-plan.ts';
import { normalisePlan } from '../discovery/search-plan.ts';

const ALL_ON = { telegram: true, forum: true, portals: false, livePortalAdapters: [] };
const LIMITS = { maxCredits: 100, deadlineMinutes: 30, targetResults: 3, activeDemandMaxDays: 30 };
const SALE_TBILISI = { transactionType: 'SALE', propertyType: 'APARTMENT', city: 'თბილისი', district: 'კრწანისი', price: 180000, currency: 'USD', bedrooms: 2, areaSqm: 97 };

test('every site language is searched, and any cap of 6+ still covers all six (round-robin)', () => {
  const q = campaignSourceQueries({ city: 'Tbilisi', transaction: 'SALE' });
  assert.deepEqual([...new Set(q.slice(0, 6).map((x) => x.language))].sort(), [...SITE_LANGUAGES].sort());
  assert.deepEqual([...new Set(q.slice(0, 12).map((x) => x.language))].sort(), [...SITE_LANGUAGES].sort());
  for (const lang of SITE_LANGUAGES) assert.ok(q.filter((x) => x.language === lang).length >= 3, `${lang} has several phrases`);
  assert.equal(new Set(q.map((x) => `${x.language}:${x.query}`)).size, q.length, 'no duplicate search');
});

test('the property decides the searches: its city and deal, never another city', () => {
  const sale = campaignSourceQueries({ city: 'თბილისი', transaction: 'SALE' });
  assert.ok(sale.filter((x) => x.kind === 'CITY_DEAL').every((x) => citiesMentioned(x.query).includes('TBILISI')), 'Tbilisi in every city search');
  assert.ok(!sale.some((x) => citiesMentioned(x.query).includes('BATUMI')), 'no Batumi search for a Tbilisi sale');
  assert.ok(sale.some((x) => x.language === 'ru' && /купить|продаж/.test(x.query)));
  const rent = campaignSourceQueries({ city: 'Batumi', transaction: 'RENT' });
  assert.ok(rent.some((x) => x.language === 'ru' && /аренд|снять|сдам/.test(x.query) && /батуми/.test(x.query)));
  assert.ok(rent.some((x) => x.language === 'tr' && /kiralık/.test(x.query) && /batum/.test(x.query)));
  const noCity = campaignSourceQueries({ city: null, transaction: 'SALE' });
  assert.ok(noCity.length >= 12 && noCity.every((x) => x.kind !== 'CITY_DEAL'), 'country-wide when the city is unknown');
});

test('rotation makes the next campaign search different phrases, still in all six languages', () => {
  const day0 = campaignSourceQueries({ city: 'Tbilisi', transaction: 'SALE', rotation: 0 }).slice(0, 12).map((x) => x.query);
  const day1 = campaignSourceQueries({ city: 'Tbilisi', transaction: 'SALE', rotation: 1 }).slice(0, 12);
  assert.notDeepEqual(day1.map((x) => x.query), day0);
  assert.deepEqual([...new Set(day1.map((x) => x.language))].sort(), [...SITE_LANGUAGES].sort());
});

test('a community belongs to the city its own name names (production handles)', () => {
  assert.equal(cityKeyOf('თბილისი'), 'TBILISI');
  assert.equal(cityKeyOf('Batumi'), 'BATUMI');
  assert.equal(cityKeyOf(''), null);
  const fit = (external_id, name, q) => communityFitFor({ external_id, name, metadata: { discovered_query: q } }, 'თბილისი');
  assert.equal(fit('tbilisiarendakvartiry', 'Аренда квартир Тбилиси', 'аренда квартир тбилиси'), 'MATCH');
  assert.equal(fit('mybatumi_apartments', 'Квартиры Батуми | My Apartments', 'аренда квартир тбилиси'), 'OTHER', 'found by a Tbilisi search, still a Batumi channel');
  assert.equal(fit('moonlightbatumi2023', 'Недвижимость в Батуми - Real estate in Batumi', 'უძრავი ქონება'), 'OTHER');
  assert.equal(fit('apartments_ge', 'Квартиры Батуми / Тбилиси', 'аренда квартир тбилиси'), 'MATCH', 'names both cities');
  assert.equal(fit('udzravi_qoneba', 'უძრავი ქონება საქართველოში', 'უძრავი ქონება'), 'NATIONAL');
  assert.equal(fit('foo', 'Квартиры', 'недвижимость тбилиси'), 'MATCH', 'no city in the name: the search that found it decides');
  assert.equal(communityCityFit(['батуми недвижимость'], null), 'NATIONAL', 'no campaign city: nothing is excluded');
});

test('a campaign read keeps to its city: own city first, country-wide next, other cities dropped', () => {
  const rows = [
    { external_id: 'moonlightbatumi2023', name: 'Недвижимость в Батуми', last_checked_at: '2026-10-01T00:00:00Z' },
    { external_id: 'udzravi_qoneba', name: 'უძრავი ქონება საქართველოში', last_checked_at: '2026-10-01T00:00:00Z' },
    { external_id: 'tbilisikvartiri', name: 'Тбилиси Квартиры (RU)', last_checked_at: '2026-10-05T00:00:00Z' },
    { external_id: 'tbilisi_real_estate', name: 'Tbilisi Real Estate TG', last_checked_at: null },
  ];
  const ranked = rankCommunitiesForCampaign(rows, 'Tbilisi').map((r) => r.external_id);
  assert.deepEqual(ranked, ['tbilisi_real_estate', 'tbilisikvartiri', 'udzravi_qoneba']);
  assert.equal(rankCommunitiesForCampaign(rows, null).length, 4, 'no city: nothing dropped');
});

test('the Find Buyers plan: discovery outranks the read, carries the city, six languages, and the read is city-scoped', () => {
  const plan = compileDemandPlan({ market: 'GE', languages: ['ka'], property: SALE_TBILISI, switches: ALL_ON, limits: LIMITS, rotation: 3 });
  const jobs = plannedSourceJobs(plan, 'run-1');
  const discovery = jobs.find((j) => j.provider === 'TELEGRAM_SOURCES');
  const read = jobs.find((j) => j.provider === 'TELEGRAM');
  assert.ok(discovery.priority > read.priority, 'discovery runs first');
  assert.equal(discovery.metadata.city, 'თბილისი');
  assert.equal(discovery.metadata.transaction, 'SALE');
  assert.equal(discovery.metadata.queries.length, discovery.metadata.queryLanguages.length);
  assert.deepEqual([...new Set(discovery.metadata.queryLanguages.slice(0, 12))].sort(), [...SITE_LANGUAGES].sort(), 'UI language ka, discovery still six languages');
  assert.equal(read.metadata.city, 'თბილისი');
});

test('Find Property (SUPPLY) is unchanged: its own phrases, its order, no city scoping', () => {
  const { plan: search } = normalisePlan({ goal: 'RENT', countryCode: 'GE', city: 'Tbilisi', cityStrength: 'REQUIRED', languages: ['ka', 'ru'] });
  const plan = compileSupplyPlan({ plan: search, switches: { ...ALL_ON, portals: false }, limits: LIMITS });
  const jobs = plannedSourceJobs(plan, 'run-2');
  const discovery = jobs.find((j) => j.provider === 'TELEGRAM_SOURCES');
  const read = jobs.find((j) => j.provider === 'TELEGRAM');
  assert.ok(discovery.priority < read.priority);
  assert.equal(discovery.metadata.city, undefined);
  assert.equal(read.metadata.city, undefined);
});
