// FIND BUYERS — campaign speed and coverage, from campaign 719a57ac (2026-10-17):
// 13 min 16 s; 16 single-group FB_GROUP_POSTS runs and 4 single-channel Telegram runs
// through an Actor concurrency of 2; ka/ru deepening spent the $0.168 Phase-1 ceiling so
// the en/ar/he/tr first probes were cancelled; six known-group reads waited ~6 min for
// discovery they did not need; TikTok re-ran the same query at the same size.
import test from 'node:test';
import assert from 'node:assert/strict';
import { batchSourceReads, attributeBatchItems, communityKey, MAX_URLS_PER_RUN } from '../findBuyers/batching.ts';
import { phase1Admission, waitsForPhase1, deepenBuysNewItems } from '../findBuyers/campaignPhases.ts';
import { buildInput } from '../findBuyers/actorInputs.ts';

/* The 16 group reads of 719a57ac (10 ka + 5 ru + 1 en), 20 posts each. */
const GROUPS = ['1398119893863502', '2104336639903209', '857282362246871', '613549196206051', '758693946926620', '1124469959971936', '1184731542269658', '680606255673838', '1026892426126212', '478494531655177', 'real.tbilisi', '274027677004095', '583951125698448', '655427182648357', 'jobingeorgia', 'rentapartmentintbilisi'];
const read = (g, i) => ({ stage: 'FB_GROUP_POSTS', actorKey: 'FB_GROUP_POSTS', language: 'multi', query: null, targetUrl: `https://www.facebook.com/groups/${g}`, sourceId: `src-${i}`, size: 20, arm: `FB_GROUP_POSTS:src-${i}`, priority: 60 + (i % 3), reason: i < 6 ? 'known_source_reuse' : 'group_followup' });

test('16 single-group reads become 4 runs (≤ the per-run cap and the Actor maximum each), nothing lost', () => {
  const jobs = batchSourceReads(GROUPS.map(read), { maxResults: { FB_GROUP_POSTS: 100 } });
  assert.equal(jobs.length, 4);
  const urls = jobs.flatMap((j) => (j.batch ? j.batch.map((b) => b.targetUrl) : [j.targetUrl]));
  assert.equal(new Set(urls).size, 16);
  for (const j of jobs) {
    assert.ok((j.batch?.length ?? 1) <= MAX_URLS_PER_RUN);
    assert.ok(j.size <= 100);
    assert.equal(j.size, (j.batch?.length ?? 1) * 20);
  }
  /* reasons are not mixed: known-source reads keep their (no-wait) reason */
  for (const j of jobs) assert.ok(j.batch ? j.batch.every((b) => b.arm) : true);
  assert.equal(jobs.filter((j) => j.reason === 'known_source_reuse').reduce((n, j) => n + (j.batch?.length ?? 1), 0), 6);
  /* the Actor receives every URL of a batch */
  const input = buildInput('FB_GROUP_POSTS', { targetUrls: jobs[0].batch.map((b) => b.targetUrl), size: jobs[0].size }, null).input;
  assert.equal(input.startUrls.length, jobs[0].batch.length);
  assert.equal(input.maxItems, jobs[0].size);
});

test('searches, comments and lone reads pass through unchanged; the Actor maximum splits a batch', () => {
  const search = { ...read('x', 0), stage: 'FB_GROUP_SEARCH', actorKey: 'FB_GROUP_SEARCH', query: 'ბინები თბილისი', targetUrl: null };
  assert.equal(batchSourceReads([search])[0], search);
  const one = read('1398119893863502', 0);
  assert.equal(batchSourceReads([one])[0], one);
  const small = batchSourceReads(GROUPS.slice(0, 4).map(read).map((j) => ({ ...j, reason: 'r' })), { maxResults: { FB_GROUP_POSTS: 40 } });
  assert.deepEqual(small.map((j) => j.batch?.length ?? 1), [2, 2]);
});

test('items return to the community they came from', () => {
  const entries = ['1398119893863502', 'real.tbilisi'].map((g, i) => ({ targetUrl: `https://www.facebook.com/groups/${g}/`, sourceId: `s${i}`, arm: `a${i}`, size: 20 }));
  const items = [
    { url: 'https://www.facebook.com/groups/1398119893863502/permalink/1/', parentUrl: null, parentExternalId: null },
    { url: 'https://www.facebook.com/groups/real.tbilisi/posts/2/', parentUrl: null, parentExternalId: null },
    { url: 'https://www.facebook.com/x', parentUrl: null, parentExternalId: 'group:1398119893863502' },
    { url: 'https://example.com/unknown', parentUrl: null, parentExternalId: null },
  ];
  const slices = attributeBatchItems(items, entries);
  const by = Object.fromEntries(slices.map((s) => [s.entry?.sourceId ?? 'none', s.items.length]));
  assert.deepEqual(by, { s0: 2, s1: 1, none: 1 });
  assert.equal(communityKey('https://t.me/rent_tbilisi_ge'), 'rent_tbilisi_ge');
  assert.equal(communityKey('https://t.me/s/flats_in_georgia/123'), 'flats_in_georgia');
});

test('Phase 1: first probes of every language before any deepening; a probe that does not fit is cancelled', () => {
  /* 7 probes × 24,000 = 168,000 cap; after the two ka probes (48,000) a ka deepen of 81,000
     would leave too little for the 5 waiting probes (120,000): it waits. */
  assert.deepEqual(phase1Admission({ isDeepen: true, committedMicros: 48_000, estimateMicros: 81_000, capMicros: 168_000, pendingFirstProbesMicros: 120_000 }), { decision: 'WAIT', reason: 'PHASE1_COVERAGE_FIRST' });
  assert.deepEqual(phase1Admission({ isDeepen: false, committedMicros: 48_000, estimateMicros: 24_000, capMicros: 168_000, pendingFirstProbesMicros: 0 }), { decision: 'START', reason: null });
  /* after every probe ran, a deepen may use what is left */
  assert.equal(phase1Admission({ isDeepen: true, committedMicros: 150_000, estimateMicros: 12_000, capMicros: 168_000, pendingFirstProbesMicros: 0 }).decision, 'START');
  assert.equal(phase1Admission({ isDeepen: false, committedMicros: 160_000, estimateMicros: 24_000, capMicros: 168_000, pendingFirstProbesMicros: 0 }).decision, 'CANCEL');
});

test('known communities do not wait for discovery; deepens must buy new items', () => {
  assert.equal(waitsForPhase1('known_source_reuse'), false);
  assert.equal(waitsForPhase1('group_followup'), true);
  assert.equal(deepenBuysNewItems(15, [15]), false); /* TikTok second_probe, same size */
  assert.equal(deepenBuysNewItems(4, [10]), false);  /* group search 10 → 4 */
  assert.equal(deepenBuysNewItems(40, [10]), true);
  assert.equal(deepenBuysNewItems(10, []), true);
});

test('languages: items come from the runs (not the qualified count); ar/he/tr queries name the place natively', async () => {
  const { languageOutcomes } = await import('../findBuyers/languageOutcomes.ts');
  const queue = [{ language: 'ka', status: 'DONE', result_count: 0 }, { language: 'ar', status: 'CANCELLED', cancel_reason: 'PHASE1_BUDGET' }];
  const runs = [{ language: 'ka', items_fetched: 166 }, { language: 'multi', items_fetched: 60 }];
  const rep = Object.fromEntries(languageOutcomes(queue, [], runs).map((r) => [r.language, r]));
  assert.equal(rep.ka.items, 166);
  assert.equal(rep.ka.outcome, 'RESULTS_FILTERED');
  assert.equal(rep.ar.outcome, 'NOT_RUN');
  assert.equal(rep.ar.notRunReason, 'PHASE1_BUDGET');
  const { buildQueryPlan } = await import('../findBuyers/queryPlanner.ts');
  const { buildPropertyDna } = await import('../findBuyers/propertyDna.ts');
  const dna = buildPropertyDna({ transactionType: 'SALE', propertyType: 'APARTMENT', countryCode: 'GE', city: 'Tbilisi', district: 'Krtsanisi', totalPrice: 213840, currency: 'USD', rooms: 3, bedrooms: 2 });
  const plan = buildQueryPlan(dna, ['ar', 'he', 'tr']);
  const demand = (lang) => plan.queries.filter((q) => q.language === lang && q.kind === 'demand').map((q) => q.query).join(' | ');
  assert.match(demand('ar'), /كرتسانيسي/);
  assert.match(demand('he'), /קרצניסי/);
  assert.match(demand('tr'), /Krtsanisi satılık 2\+1 daire/);
});

test('languages no longer split runs; the same group queued twice is read once (campaign d0af0a47, 2026-10-18)', () => {
  const langs = ['ka', 'ru', 'en', 'ar', 'he', 'tr'];
  const jobs = GROUPS.slice(0, 6).map((g, i) => ({ ...read(g, i), reason: 'discovered_group', language: langs[i] }));
  jobs.push({ ...jobs[0], arm: 'dup', language: 'ka' });
  const out = batchSourceReads(jobs, { maxResults: { FB_GROUP_POSTS: 400 } });
  assert.equal(out.length, 1, 'six languages, one run');
  assert.equal(out[0].batch.length, 6, 'the duplicate group is dropped');
  assert.equal(out[0].language, 'multi');
  assert.ok(MAX_URLS_PER_RUN >= 10);
});
