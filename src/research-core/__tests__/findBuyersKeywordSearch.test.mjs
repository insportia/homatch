// FIND BUYERS — Facebook keyword buyer/tenant discovery (owner, 2026-10-18):
// tropical_thunderstuck~facebook-post-search. Pure: no network, no database, no Actor run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildPropertyDna } from '../findBuyers/propertyDna.ts';
import { buildQueryPlan } from '../findBuyers/queryPlanner.ts';
import { classifyDemand } from '../findBuyers/demandClassifier.ts';
import { initialSocialJobs, keywordSearchPhrases, DEFAULT_KEYWORD_BATCH_SIZE } from '../findBuyers/campaignPlan.ts';
import { buildInput, essentialMissing, STAGE_ACTOR, STAGE_NETWORK, STAGE_OUTPUT } from '../findBuyers/actorInputs.ts';
import { classifyActor, REGISTRY_SEEDS } from '../findBuyers/actorCatalog.ts';

const SALE = buildPropertyDna({ transactionType: 'SALE', propertyType: 'APARTMENT', city: 'Tbilisi', district: 'Krtsanisi', totalPrice: 213840, currency: 'USD', area: 97.2, rooms: 3, bedrooms: 2 });
const RENT = buildPropertyDna({ transactionType: 'RENT', propertyType: 'APARTMENT', city: 'Tbilisi', district: 'Vake', totalPrice: 900, currency: 'USD', area: 70, rooms: 3, bedrooms: 2 });
const SIX = ['ka', 'ru', 'en', 'ar', 'he', 'tr'];
const enabled = { FB_KEYWORD_SEARCH: { probeSize: 30, priority: 58 } };
const now = Date.parse('2026-10-18T10:00:00Z');
const plan = (dna, extra = {}) => initialSocialJobs({ dna, plan: buildQueryPlan(dna), knownSources: [], enabledActors: enabled, nativeTelegramActive: false, now, ...extra });

test('the stage is a Facebook post search, primary discovery, registered disabled and unpriced by verification', () => {
  assert.equal(STAGE_ACTOR.FB_KEYWORD_SEARCH, 'FB_KEYWORD_SEARCH');
  assert.equal(STAGE_NETWORK.FB_KEYWORD_SEARCH, 'FACEBOOK');
  assert.equal(STAGE_OUTPUT.FB_KEYWORD_SEARCH, 'POSTS');
  const c = classifyActor('FB_KEYWORD_SEARCH');
  assert.equal(c.cls, 'PRIMARY_DISCOVERY');
  assert.equal(c.needsSeed, false, 'independent of known groups: it complements them');
  assert.equal(REGISTRY_SEEDS.FB_KEYWORD_SEARCH.actor_id, 'tropical_thunderstuck~facebook-post-search');
});

test('every phrase reads as a person seeking THIS transaction, in all six languages, never a listing phrase', () => {
  for (const [dna, seeker] of [[SALE, 'BUY_SEEKER'], [RENT, 'RENT_SEEKER']]) {
    const phrases = keywordSearchPhrases(buildQueryPlan(dna), dna.transaction, SIX);
    assert.deepEqual([...new Set(phrases.map((p) => p.language))].sort(), [...SIX].sort(), `${dna.transaction}: all six languages`);
    for (const p of phrases) {
      const r = classifyDemand(p.query);
      assert.ok(r.role === seeker || (r.role === 'UNCLEAR' && r.evidence.includes('first_person_seeking')), `${p.language}: ${p.query} → ${r.role}`);
    }
    const keys = phrases.map((p) => p.query.toLowerCase());
    assert.equal(new Set(keys).size, keys.length, 'no repeated phrase');
    assert.ok(phrases.length <= 15, 'bounded: unique coverage, not volume');
  }
  /* The Turkish listing-shaped phrase is not bought. */
  assert.ok(!keywordSearchPhrases(buildQueryPlan(SALE), 'SALE', ['tr']).some((p) => p.query === 'Krtsanisi satılık 2+1 daire'));
  /* A rental searches rental phrasing only. */
  assert.ok(!keywordSearchPhrases(buildQueryPlan(RENT), 'RENT', SIX).some((p) => classifyDemand(p.query).role === 'BUY_SEEKER'));
});

test('phrases go out in batches (one run carries several), Georgian first; the batch size is the admin setting', () => {
  const jobs = plan(SALE).filter((j) => j.stage === 'FB_KEYWORD_SEARCH');
  const phrases = keywordSearchPhrases(buildQueryPlan(SALE), 'SALE', SIX);
  assert.equal(jobs.length, Math.ceil(phrases.length / DEFAULT_KEYWORD_BATCH_SIZE));
  assert.deepEqual(jobs.flatMap((j) => j.queries), phrases.map((p) => p.query), 'every phrase exactly once');
  assert.ok(jobs.every((j) => j.queries.length <= DEFAULT_KEYWORD_BATCH_SIZE && j.query === j.queries[0] && j.reason === 'demand_keyword_search'));
  assert.equal(jobs[0].queries[0], phrases[0].query);
  assert.equal(phrases[0].language, 'ka');
  const one = plan(SALE, { keywordBatchSize: 1 }).filter((j) => j.stage === 'FB_KEYWORD_SEARCH');
  assert.equal(one.length, phrases.length);
  assert.ok(one.every((j) => j.language !== 'multi'), 'a single-language run keeps its language');
  assert.equal(plan(SALE, { keywordBatchSize: 99 }).filter((j) => j.stage === 'FB_KEYWORD_SEARCH').length, Math.ceil(phrases.length / 10), 'never above 10 per run');
});

test('the owner\'s chosen languages limit the phrases; a disabled Actor plans nothing', () => {
  const jobs = plan(SALE, { targetLanguages: ['ka', 'ar'] }).filter((j) => j.stage === 'FB_KEYWORD_SEARCH');
  const langs = new Set(jobs.flatMap((j) => j.queries).map((q) => keywordSearchPhrases(buildQueryPlan(SALE), 'SALE', SIX).find((p) => p.query === q)?.language));
  assert.deepEqual([...langs].sort(), ['ar', 'ka']);
  const none = initialSocialJobs({ dna: SALE, plan: buildQueryPlan(SALE), knownSources: [], enabledActors: {}, nativeTelegramActive: false, now });
  assert.ok(!none.some((j) => j.stage === 'FB_KEYWORD_SEARCH'));
});

test('the input is fitted to the schema verified from Apify; without one, the run is refused at $0', () => {
  const p = { query: 'ვყიდულობ ბინას თბილისში', queries: ['ვყიდულობ ბინას თბილისში', 'куплю квартиру в Тбилиси'], size: 30, since: '2026-09-18T00:00:00Z' };
  const unverified = buildInput('FB_KEYWORD_SEARCH', p, null);
  assert.deepEqual(essentialMissing('FB_KEYWORD_SEARCH', unverified.input, null), ['schema:unverified']);
  const contract = { schemaProperties: ['keywords', 'maxItems', 'startDate'], required: ['keywords'] };
  const { input, dropped } = buildInput('FB_KEYWORD_SEARCH', p, contract);
  assert.deepEqual(input, { keywords: p.queries, maxItems: 30, startDate: '2026-09-18' });
  assert.ok(dropped.includes('query') && dropped.includes('searchQueries'));
  assert.deepEqual(essentialMissing('FB_KEYWORD_SEARCH', input, contract), []);
  /* A schema with no keyword field at all is refused, never sent. */
  const wrong = { schemaProperties: ['startUrls', 'maxItems'] };
  assert.ok(essentialMissing('FB_KEYWORD_SEARCH', buildInput('FB_KEYWORD_SEARCH', p, wrong).input, wrong).some((x) => x.startsWith('essential:')));
  /* Unicode survives untouched (Georgian, Arabic, Hebrew). */
  const u = buildInput('FB_KEYWORD_SEARCH', { queries: ['أريد شراء شقة في تبليسي', 'רוצה לקנות דירה בטביליסי'], size: 5 }, { schemaProperties: ['keywords'] }).input;
  assert.deepEqual(u.keywords, ['أريد شراء شقة في تبليسي', 'רוצה לקנות דירה בטביליסי']);
});

test('the Apify door admits this Actor by its exact id only, and the window setting is clamped to the 30-day rule', async () => {
  const client = readFileSync(new URL('../../../supabase/functions/_shared/findBuyers/memo23Client.ts', import.meta.url), 'utf8');
  assert.match(client, /ALLOWED_THIRD_PARTY_ACTORS: ReadonlySet<string> = new Set\(\[\s*\/\*[^*]*\*\/\s*'tropical_thunderstuck~facebook-post-search',\s*\]\)/);
  const campaign = readFileSync(new URL('../../../supabase/functions/_shared/findBuyers/campaign.ts', import.meta.url), 'utf8');
  assert.match(campaign, /Math\.min\(30, d\)/, 'never past the 30-day rule');
  assert.match(campaign, /Math\.min\(10, b\)/, 'never more than 10 phrases per run');
});
