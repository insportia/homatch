// FIND BUYERS / FIND TENANTS — the decision core (no network, no database).
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPropertyDna } from '../findBuyers/propertyDna.ts';
import { buildQueryPlan, mergeModelQueries, queriesFor, normalizeQuery } from '../findBuyers/queryPlanner.ts';
import { SEARCH_LANGUAGES, detectLanguage } from '../findBuyers/languages.ts';
import { extractTextFacts } from '../findBuyers/textFacts.ts';
import { scoreSimilarity, decideComments } from '../findBuyers/similarity.ts';
import { classifyByRules, boundModelVerdict, QUALIFYING } from '../findBuyers/intent.ts';
import { personKey, isMergeableKey, contentFingerprint } from '../findBuyers/identity.ts';
import { scoreLead } from '../findBuyers/leadScore.ts';
import { decideArm, armPriority, DEFAULT_SAMPLING } from '../findBuyers/allocator.ts';
import { normalizeDataset, safeHttpUrl } from '../findBuyers/normalize.ts';
import { buildInput, fitToSchema } from '../findBuyers/actorInputs.ts';
import { initialSocialJobs } from '../findBuyers/campaignPlan.ts';

const SALE = buildPropertyDna({ transactionType: 'SALE', propertyType: 'APARTMENT', city: 'Tbilisi', district: 'Krtsanisi', totalPrice: 120000, currency: 'USD', area: 75, bedrooms: 2 });
const RENT = buildPropertyDna({ transactionType: 'RENT', propertyType: 'APARTMENT', city: 'Batumi', totalPrice: 700, currency: 'USD', area: 50, bedrooms: 1 });

test('Property DNA uses stored fields only, with tolerance bands and named gaps', () => {
  assert.equal(SALE.counterpart, 'BUYER');
  assert.equal(RENT.counterpart, 'TENANT');
  assert.deepEqual(SALE.tolerances.area, { min: 60, max: 90 });
  assert.deepEqual(SALE.tolerances.bedrooms, { min: 1, max: 3 });
  assert.equal(SALE.pricePerSqm, 1600);
  assert.equal(RENT.pricePerSqm, null, 'price per sqm is not meaningful for rent');
  const bare = buildPropertyDna({ transactionType: 'SALE', city: 'Tbilisi' });
  assert.ok(bare.missing.includes('price') && bare.missing.includes('area') && bare.missing.includes('propertyType'));
  assert.equal(bare.areaSqm, null, 'a missing area is never guessed');
});

test('every campaign plans all six languages with native intent families, deduplicated', () => {
  const plan = buildQueryPlan(SALE);
  for (const lang of SEARCH_LANGUAGES) {
    assert.ok(queriesFor(plan, 'demand', lang).length >= 3, `demand queries in ${lang}`);
    assert.ok(queriesFor(plan, 'community', lang).length >= 1, `community queries in ${lang}`);
  }
  const keys = plan.queries.map((q) => `${q.language}|${normalizeQuery(q.query)}`);
  assert.equal(new Set(keys).size, keys.length, 'no duplicate query per language');
  assert.ok(plan.queries.some((q) => q.language === 'ka' && q.query.includes('თბილისში')), 'Georgian uses the locative');
  assert.ok(plan.queries.some((q) => q.language === 'ru' && /куплю/.test(q.query)));
  assert.ok(plan.queries.some((q) => q.language === 'he' && /טביליסי/.test(q.query)));
  assert.ok(plan.queries.some((q) => q.language === 'ar' && /تبليسي/.test(q.query)));
  assert.ok(plan.queries.some((q) => q.language === 'tr' && /Tiflis/.test(q.query)));
  const rent = buildQueryPlan(RENT);
  assert.ok(rent.queries.some((q) => q.language === 'ru' && /сниму/.test(q.query)), 'tenant mode uses rent intent');
  assert.ok(!rent.queries.some((q) => /куплю/.test(q.query)), 'tenant mode never searches buy intent');
  const merged = mergeModelQueries(plan, [{ language: 'en', query: 'want to buy flat tbilisi' }, { language: 'en', query: plan.queries.find((q) => q.language === 'en' && q.kind === 'demand').query }, { language: 'xx', query: 'nope' }]);
  assert.equal(merged.queries.length, plan.queries.length + 1, 'model phrasings deduplicated and limited to the six languages');
});

test('language detection by script', () => {
  assert.equal(detectLanguage('ვეძებ ბინას'), 'ka');
  assert.equal(detectLanguage('أبحث عن شقة'), 'ar');
  assert.equal(detectLanguage('מחפש דירה'), 'he');
  assert.equal(detectLanguage('ищу квартиру'), 'ru');
  assert.equal(detectLanguage('kiralık daire arıyorum'), 'tr');
  assert.equal(detectLanguage('looking for a flat'), 'en');
  assert.equal(detectLanguage('❤️❤️'), null);
});

test('similarity gate: comparable listing ≥85 fetches comments; unrelated parents never do', () => {
  const similar = extractTextFacts('იყიდება 2 საძინებლიანი ბინა კრწანისში, 78 კვ.მ, ფასი $125 000');
  const s = scoreSimilarity(SALE, similar, { ageDays: 2 });
  assert.ok(s.score >= 85, `score ${s.score}`);
  assert.equal(decideComments(s.score, { commentCount: 12, ageDays: 2 }), 'FETCH');
  const rentPost = extractTextFacts('Сдается 2-комнатная квартира в Крцаниси 600$ в месяц');
  const r = scoreSimilarity(SALE, rentPost, { ageDays: 1 });
  assert.ok(r.conflicts.includes('transaction') && r.score <= 30, 'other transaction is a hard conflict');
  assert.equal(decideComments(r.score, { commentCount: 50, ageDays: 1, sourceYield: 1 }), 'SKIP_LOW_SIMILARITY');
  const vague = extractTextFacts('Nice apartment, DM for details');
  assert.ok(scoreSimilarity(SALE, vague, { ageDays: 3 }).score < 70, 'unknown dimensions never look like a match');
  assert.equal(decideComments(78, { commentCount: 1, ageDays: 40, sourceYield: 0 }), 'SKIP_WEAK_SIGNALS');
  assert.equal(decideComments(78, { commentCount: 9, ageDays: 2 }), 'FETCH_JUSTIFIED');
  assert.equal(decideComments(95, { commentCount: 0 }), 'SKIP_NO_COMMENTS');
  const price = extractTextFacts('Продается 2-комнатная квартира в Ваке 60 м2 90000$');
  assert.equal(price.price, 90000, 'area digits never leak into the price');
});

test('comment intent: buyer vs noise vs agent, conditioned on the parent', () => {
  const ctx = { campaign: 'SALE', kind: 'COMMENT', parentSimilarity: 91, parentStance: 'OFFER' };
  assert.equal(classifyByRules('Interested. Is this still available? Please send me the price.', ctx).intentClass, 'BUYER_HIGH');
  assert.equal(classifyByRules('Beautiful ❤️', ctx).intentClass, 'NOISE');
  assert.equal(classifyByRules('I am an agent, I have more apartments', ctx).intentClass, 'AGENT');
  assert.equal(classifyByRules('DM me, I am looking for something similar', ctx).intentClass, 'BUYER_HIGH');
  assert.equal(classifyByRules('Call me', { ...ctx, parentStance: 'REQUEST' }).intentClass, 'SELLER', '"call me" under a request is an offer');
  assert.equal(classifyByRules('Call me', { ...ctx, parentStance: null, parentSimilarity: 40 }).intentClass, 'UNCERTAIN');
  assert.equal(classifyByRules('Interested', { ...ctx, parentSimilarity: 40 }).intentClass, 'QUESTION', 'interest under an unrelated post is not a buyer');
  assert.equal(classifyByRules('ფასი?', ctx).intentClass, 'BUYER_MEDIUM');
  assert.equal(classifyByRules('Продаю похожую квартиру', ctx).intentClass, 'SELLER');
  const tenant = classifyByRules('Ищу квартиру в аренду, интересует', { campaign: 'RENT', kind: 'COMMENT', parentSimilarity: 80, parentStance: 'OFFER' });
  assert.equal(tenant.intentClass, 'TENANT_HIGH', 'tenant mode names tenants');
  assert.equal(boundModelVerdict('BUYER_HIGH', { ...ctx, parentSimilarity: 50 }).intentClass, 'BUYER_MEDIUM', 'the model cannot make HIGH under a non-comparable parent');
  assert.equal(boundModelVerdict('NOT_A_CLASS', ctx).intentClass, 'UNCERTAIN');
  assert.ok(!QUALIFYING.has('AGENT') && !QUALIFYING.has('NOISE') && QUALIFYING.has('TENANT_MEDIUM'));
});

test('person identity: public identifiers only; one person never becomes two leads', () => {
  const a = personKey('FACEBOOK', { url: 'https://www.facebook.com/profile.php?id=100012345678' }, 'c1');
  const b = personKey('FACEBOOK', { url: 'https://m.facebook.com/profile.php?id=100012345678&ref=x' }, 'c2');
  assert.equal(a, b);
  assert.equal(personKey('FACEBOOK', { url: 'https://facebook.com/John.Doe/' }, 'c3'), 'u:john.doe');
  const anon = personKey('FACEBOOK', { name: 'John Doe' }, 'c4');
  assert.ok(!isMergeableKey(anon), 'a display name alone never merges people');
  assert.equal(personKey('LINKEDIN', { url: 'https://www.linkedin.com/in/jane-doe-123/' }, 'x'), 'u:jane-doe-123');
  assert.equal(contentFingerprint('Looking for a flat!! https://x.y'), contentFingerprint('looking for a FLAT'));
});

test('lead ranking: explainable components; several signals strengthen one lead', () => {
  const sig = (id, intent, sim, age) => ({ signalId: id, parentSignalId: 'p', kind: 'COMMENT', source: 'FACEBOOK', intentClass: intent, intentScore: intent === 'BUYER_HIGH' ? 92 : 68, similarity: sim, ageDays: age, sourceQuality: 0.6, specific: false, text: 't', url: null, parentUrl: null, parentExcerpt: null, language: 'en', publishedAt: new Date(Date.now() - age * 864e5).toISOString(), explanation: '{}' });
  const one = scoreLead([sig('a', 'BUYER_HIGH', 91, 2)]);
  const two = scoreLead([sig('a', 'BUYER_HIGH', 91, 2), sig('b', 'BUYER_MEDIUM', 80, 5)]);
  assert.ok(one.qualified && two.overall > one.overall, 'support raises the score');
  assert.equal(two.best.signalId, 'a', 'strongest evidence first');
  assert.ok(['similarity', 'intent', 'recency', 'sourceQuality', 'support', 'specificity'].every((k) => k in two.components));
  assert.equal(scoreLead([{ ...sig('n', 'NOISE', 99, 1), intentScore: 0 }]), null, 'noise is never a lead');
  const old = scoreLead([sig('o', 'BUYER_MEDIUM', 60, 60)]);
  assert.ok(!old || old.overall < one.overall, 'history is penalised');
});

test('budget allocation: probe → deepen on yield → stop poor arms; never past the budget', () => {
  const base = { arm: 'FB:ka', duplicates: 0, failures: 0, runs: 1, avgSimilarity: null, avgIntent: null };
  assert.equal(decideArm({ ...base, runs: 0, itemsBought: 0, spendMicros: 0, useful: 0, qualified: 0, strong: 0 }, DEFAULT_SAMPLING, 5e6, 5e5).action, 'DEEPEN');
  const good = decideArm({ ...base, itemsBought: 20, spendMicros: 10_000, useful: 6, qualified: 2, strong: 1 }, DEFAULT_SAMPLING, 5e6, 5e5);
  assert.deepEqual([good.action, good.nextSize], ['DEEPEN', 30], 'probe 20 → +30 (50 total)');
  const step2 = decideArm({ ...base, runs: 2, itemsBought: 50, spendMicros: 25_000, useful: 12, qualified: 3, strong: 1 }, DEFAULT_SAMPLING, 5e6, 5e5);
  assert.deepEqual([step2.action, step2.nextSize], ['DEEPEN', 50], '50 → +50 (100 total)');
  assert.equal(decideArm({ ...base, runs: 3, itemsBought: 100, spendMicros: 50_000, useful: 20, qualified: 5, strong: 2 }, DEFAULT_SAMPLING, 5e6, 5e5).reason, 'sampling_complete');
  assert.equal(decideArm({ ...base, runs: 2, itemsBought: 20, spendMicros: 10_000, useful: 0, qualified: 0, strong: 0 }, DEFAULT_SAMPLING, 5e6, 5e5).reason, 'probe_unproductive');
  assert.equal(decideArm({ ...base, itemsBought: 20, spendMicros: 10_000, useful: 6, qualified: 2, strong: 0 }, DEFAULT_SAMPLING, 1_000, 5e5).reason, 'budget_exhausted');
  assert.equal(decideArm({ ...base, failures: 2, itemsBought: 0, spendMicros: 0, useful: 0, qualified: 0, strong: 0 }, DEFAULT_SAMPLING, 5e6, 5e5).reason, 'repeated_failures');
  assert.equal(decideArm({ ...base, runs: 2, itemsBought: 50, spendMicros: 2_000_000, useful: 3, qualified: 1, strong: 0 }, DEFAULT_SAMPLING, 5e6, 5e5).reason, 'yield_below_threshold', 'a weak arm loses budget');
  const strong = armPriority({ ...base, itemsBought: 50, spendMicros: 25_000, useful: 12, qualified: 6, strong: 2 });
  const weak = armPriority({ ...base, itemsBought: 50, spendMicros: 2_000_000, useful: 1, qualified: 0, strong: 0, failures: 1 });
  assert.ok(strong > weak, 'a strong arm is served first');
});

test('normalizers: tolerant fields, safe links, inline comments, no fabricated ids', () => {
  const posts = normalizeDataset('POSTS', 'FACEBOOK', [
    { postId: '1', text: 'For sale 2 bedroom', url: 'https://facebook.com/groups/1/posts/1', user: { name: 'A', id: '77' }, time: 1759500000, commentsCount: '1.2K' },
    { text: 'no id no url' },
    { postId: '2', text: 'x', url: 'javascript:alert(1)' },
    { error: 'blocked' },
  ]);
  assert.equal(posts.length, 2);
  assert.equal(posts[0].engagement.comments, 1200);
  assert.equal(posts[0].author.id, '77');
  assert.equal(posts[1].url, null, 'unsafe links are dropped');
  assert.equal(safeHttpUrl('ftp://x'), null);
  const vk = normalizeDataset('POSTS', 'VK', [{ id: 9, text: 'Сдаю квартиру', comments: [{ id: 5, text: 'Ищу похожую', from_id: 42 }] }]);
  assert.equal(vk[0].inlineComments.length, 1, 'VK comments come free with the post');
  assert.equal(vk[0].inlineComments[0].parentExternalId, 'post:9');
  const groups = normalizeDataset('GROUP_SEARCH', 'LINKEDIN', [{ GroupID: 123, GroupName: 'Expats in Tbilisi', Grouplink: 'https://www.linkedin.com/groups/123', GroupMember: '4,500', Summary: 'housing' }]);
  assert.equal(groups[0].group.members, 4500);
});

test('actor inputs: verified schema drops unknown keys and reports them', () => {
  const { input, dropped } = buildInput('FB_COMMENTS', { targetUrl: 'https://facebook.com/x/posts/1', size: 20 }, { schemaProperties: ['startUrls', 'maxItems'] });
  assert.deepEqual(Object.keys(input).sort(), ['maxItems', 'startUrls']);
  assert.deepEqual(dropped, ['commentsMode']);
  assert.deepEqual(fitToSchema({ a: 1 }, undefined), { input: { a: 1 }, dropped: [] });
  const renamed = buildInput('LINKEDIN_POSTS', { query: 'relocating to tbilisi', size: 10 }, { rename: { searchQueries: 'keywords' } });
  assert.deepEqual(renamed.input.keywords, ['relocating to tbilisi']);
});

test('first tranche: registry reuse before rediscovery, native Telegram first, disabled actors absent', () => {
  const plan = buildQueryPlan(SALE);
  const enabled = { FB_GROUP_SEARCH: { probeSize: 10, priority: 80 }, FB_GROUP_POSTS: { probeSize: 20, priority: 80 }, TIKTOK: { probeSize: 15, priority: 60 }, TELEGRAM_CHANNEL: { probeSize: 30, priority: 30 } };
  const now = Date.now();
  const known = [
    ...['a', 'b', 'c'].map((id) => ({ id, platform: 'FACEBOOK', url: `https://facebook.com/groups/${id}`, languages: ['ru'], city: 'Tbilisi', historicalYield: 3, lastCheckedAt: new Date(now - 864e5).toISOString() })),
    { id: 't1', platform: 'TELEGRAM', url: 'https://t.me/x', languages: ['ru'], city: 'Tbilisi', historicalYield: null, lastCheckedAt: null },
  ];
  const jobs = initialSocialJobs({ dna: SALE, plan, knownSources: known, enabledActors: enabled, nativeTelegramActive: true, now });
  assert.equal(jobs.filter((j) => j.stage === 'FB_GROUP_POSTS').length, 3, 'known groups are read first');
  assert.ok(!jobs.some((j) => j.stage === 'FB_GROUP_SEARCH' && j.language === 'ru'), 'a covered language is not rediscovered');
  assert.equal(jobs.filter((j) => j.stage === 'FB_GROUP_SEARCH').length, 5, 'the other five languages discover');
  assert.ok(!jobs.some((j) => j.stage === 'TELEGRAM_CHANNEL'), 'native Telegram is primary');
  assert.ok(!jobs.some((j) => j.stage === 'LINKEDIN_POSTS' || j.stage === 'VK_WALL'), 'disabled actors are never planned');
  assert.ok(new Set(jobs.filter((j) => j.stage === 'TIKTOK_SEARCH').map((j) => j.language)).size === 6, 'TikTok probes all six languages');
  const fallback = initialSocialJobs({ dna: SALE, plan, knownSources: known, enabledActors: enabled, nativeTelegramActive: false, now });
  assert.equal(fallback.filter((j) => j.stage === 'TELEGRAM_CHANNEL').length, 1, 'memo23 Telegram only as fallback');
});

import { judgeFreshness, sinceFloor, MAX_SIGNAL_AGE_DAYS } from '../findBuyers/freshness.ts';

test('30-day rule: stale, undated and future-dated content never enters; undated comments only under a fresh parent', () => {
  const now = Date.parse('2026-10-04T12:00:00Z');
  const d = (days) => new Date(now - days * 864e5).toISOString();
  assert.equal(MAX_SIGNAL_AGE_DAYS, 30);
  assert.equal(judgeFreshness({ kind: 'POST', publishedAt: d(3) }, null, { now }).keep, true);
  assert.equal(judgeFreshness({ kind: 'POST', publishedAt: d(30) }, null, { now }).keep, true, 'day 30 is still inside');
  assert.equal(judgeFreshness({ kind: 'POST', publishedAt: d(31) }, null, { now }).reason, 'STALE');
  assert.equal(judgeFreshness({ kind: 'POST', publishedAt: null }, null, { now }).reason, 'UNDATED');
  assert.equal(judgeFreshness({ kind: 'POST', publishedAt: 'not a date' }, null, { now }).reason, 'INVALID_DATE');
  assert.equal(judgeFreshness({ kind: 'POST', publishedAt: d(-3) }, null, { now }).reason, 'INVALID_DATE');
  assert.equal(judgeFreshness({ kind: 'COMMENT', publishedAt: null }, d(5), { now }).reason, 'FRESH_BY_PARENT');
  assert.equal(judgeFreshness({ kind: 'COMMENT', publishedAt: null }, d(45), { now }).keep, false);
  assert.equal(judgeFreshness({ kind: 'COMMENT', publishedAt: null }, null, { now }).keep, false);
  assert.equal(judgeFreshness({ kind: 'COMMENT', publishedAt: d(40) }, d(2), { now }).reason, 'STALE', 'an old comment is old whatever the parent');
  assert.equal(judgeFreshness({ kind: 'GROUP', publishedAt: null }, null, { now }).keep, true, 'groups are sources, not demand');
  assert.equal(sinceFloor(now), d(30));
});

test('Reddit, Quora and Bluesky shapes normalize with real permalinks, authors and dates', () => {
  const reddit = normalizeDataset('POSTS', 'REDDIT', [{ id: 'abc', title: 'Moving to Tbilisi', selftext: 'Looking for a 2 bedroom flat to buy', permalink: '/r/tbilisi/comments/abc/moving/', author: 'nomad42', created_utc: 1759400000, num_comments: 7 }]);
  assert.equal(reddit[0].url, 'https://www.reddit.com/r/tbilisi/comments/abc/moving/');
  assert.equal(reddit[0].author.url, 'https://www.reddit.com/user/nomad42');
  assert.match(reddit[0].text, /Moving to Tbilisi\nLooking for a 2 bedroom/);
  assert.equal(reddit[0].engagement.comments, 7);
  assert.ok(reddit[0].publishedAt);
  const quora = normalizeDataset('POSTS', 'QUORA', [{ id: 'q1', title: 'Is it a good idea to buy an apartment in Batumi?', url: 'https://www.quora.com/Is-it-a-good-idea', createdAt: '2026-09-30T10:00:00Z', answers: [{ id: 'a1', text: 'I am looking too, DM me', author: { name: 'Ann', url: 'https://www.quora.com/profile/Ann' } }] }]);
  assert.equal(quora[0].inlineComments.length, 1, 'answers ride with the question');
  assert.equal(quora[0].inlineComments[0].author.url, 'https://www.quora.com/profile/Ann');
  const sky = normalizeDataset('POSTS', 'BLUESKY', [{ uri: 'at://did:plc:x/app.bsky.feed.post/3kq', author: { handle: 'ana.bsky.social', displayName: 'Ana' }, record: { text: 'Looking to rent in Tbilisi', createdAt: '2026-10-01T09:00:00Z' }, replyCount: 2 }]);
  assert.equal(sky[0].url, 'https://bsky.app/profile/ana.bsky.social/post/3kq');
  assert.equal(sky[0].author.url, 'https://bsky.app/profile/ana.bsky.social');
  assert.equal(sky[0].publishedAt, '2026-10-01T09:00:00.000Z');
});

test('Reddit, Quora and Bluesky are probed in their realistic languages when enabled', () => {
  const plan = buildQueryPlan(SALE);
  const jobs = initialSocialJobs({ dna: SALE, plan, knownSources: [], nativeTelegramActive: true,
    enabledActors: { REDDIT: { probeSize: 20, priority: 55 }, QUORA: { probeSize: 10, priority: 35 }, BLUESKY: { probeSize: 15, priority: 30 } } });
  assert.deepEqual(jobs.filter((j) => j.stage === 'REDDIT_SEARCH').map((j) => j.language), ['en', 'ru']);
  assert.deepEqual(jobs.filter((j) => j.stage === 'QUORA_SEARCH').map((j) => j.language), ['en']);
  assert.deepEqual(jobs.filter((j) => j.stage === 'BLUESKY_SEARCH').map((j) => j.language), ['en', 'ru', 'tr']);
  const { input } = buildInput('REDDIT_SEARCH', { query: 'relocating to tbilisi', size: 20 }, null);
  assert.equal(input.time, 'month', 'Reddit search asks for the last month only');
});
