// THE ADAPTIVE SEARCH LOOP — regression scenarios (2026-10-12).
//
// A campaign used to end the moment its first batch drained, even with zero
// qualified leads and most of its budget left. These scenarios prove the loop moves
// on through the fallback ladder on evidence, changes its strategy instead of
// repeating itself, and still never bypasses an allowlist, a budget or the
// evidence requirements.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actorExhausted, fallbackActions, flexBand, nextStep, stopIsPremature, validateActions, evidenceForModel,
  MAX_ADAPTIVE_ROUNDS, ADAPTIVE_ACTION_SCHEMA,
} from '../findBuyers/adaptiveLoop.ts';
import { classifyDemand } from '../findBuyers/demandClassifier.ts';
import { qualify } from '../findBuyers/qualify.ts';
import { buildPropertyDna } from '../findBuyers/propertyDna.ts';
import { normalizeQuery } from '../findBuyers/queryPlanner.ts';

const gate = (over = {}) => ({ probeSize: 20, priority: 50, startFeeMicros: 8_000, pricePer1kMicros: 1_500_000, ...over });
const GATES = {
  FB_GROUP_SEARCH: gate({ probeSize: 10, pricePer1kMicros: 1_900_000 }),
  FB_GROUP_POSTS: gate(),
  FB_COMMENTS: gate({ pricePer1kMicros: 490_000, startFeeMicros: 50_000 }),
  TIKTOK: gate({ probeSize: 15, pricePer1kMicros: 2_000_000 }),
  BLUESKY: gate({ probeSize: 15 }),
};
const actor = (actorKey, over = {}) => ({ actorKey, runs: 0, items: 0, useful: 0, qualified: 0, spentMicros: 0, emptyStreak: 0, failedStreak: 0,
  globalRuns: 0, globalItems: 0, globalQualified: 0, globalSpentMicros: 0, ...over });
const evidence = (over = {}) => ({
  transaction: 'SALE', family: 'APARTMENT', city: 'Tbilisi', district: 'Krtsanisi', price: 213840, currency: 'USD', areaSqm: 97.2,
  round: 0, passesTried: [], budgetMicros: 2_800_000, spentMicros: 400_000,
  sourcesDiscovered: 6, postsInspected: 40, signals: 0, qualified: 0, strong: 0, duplicates: 0, irrelevant: 30,
  lastRoundQualified: null,
  actors: [actor('FB_GROUP_SEARCH', { runs: 2, items: 12, useful: 8 }), actor('FB_GROUP_POSTS', { runs: 3, items: 40, useful: 2 })],
  languages: [{ language: 'en', queries: 3, items: 50, qualified: 0 }],
  usedQueries: [{ language: 'en', query: 'looking to buy apartment in Krtsanisi' }, { language: 'en', query: 'Tbilisi apartments' }],
  usedTargets: [],
  promisingParents: [],
  ...over,
});

test('1. zero qualified leads after the first batch does NOT end the campaign: the ladder moves to SEMANTIC', () => {
  const step = nextStep(evidence(), GATES);
  assert.deepEqual(step, { kind: 'RUN', pass: 'SEMANTIC' });
  /* …and the model cannot end it early either. */
  const v = validateActions([{ type: 'STOP_CAMPAIGN', stage: null, actorKey: null, queries: [], urls: [], rationale: 'nothing found' }],
    { evidence: evidence(), gates: GATES, pass: 'SEMANTIC' });
  assert.equal(v.stopCampaign, false);
  assert.equal(v.rejected[0].reason, 'PREMATURE_STOP');
  assert.equal(stopIsPremature(evidence({ passesTried: ['SEMANTIC', 'FLEXIBLE'] }), GATES), false, 'after two passes a stop is allowed');
});

test('2. wrong-language initial queries: the fallback searches the unsearched languages first, not English again', () => {
  const e = evidence();
  const actions = fallbackActions(e, 'SEMANTIC');
  const languages = actions.flatMap((a) => a.queries.map((q) => q.language));
  assert.ok(['ka', 'ru', 'ar', 'he', 'tr'].includes(languages[0]), `first: ${languages[0]}`);
  const v = validateActions(actions, { evidence: e, gates: GATES, pass: 'SEMANTIC' });
  assert.ok(v.jobs.length > 0, JSON.stringify(v.rejected));
  assert.ok(v.jobs.every((j) => j.language !== 'en' || !e.usedQueries.some((u) => normalizeQuery(u.query) === normalizeQuery(j.query))));
  assert.ok(new Set(v.jobs.map((j) => j.language)).size >= 2, 'more than one new language');
});

test('3. overly narrow neighbourhood: FLEXIBLE widens to nearby districts and the city', () => {
  const e = evidence({ passesTried: ['SEMANTIC'] });
  assert.deepEqual(nextStep(e, GATES), { kind: 'RUN', pass: 'FLEXIBLE' });
  const actions = fallbackActions(e, 'FLEXIBLE');
  const queries = actions.flatMap((a) => a.queries.map((q) => q.query)).join(' | ');
  assert.match(queries, /Tbilisi|Тбилиси|თბილის/, 'the city level is searched');
  assert.doesNotMatch(queries, /Krtsanisi real estate/i, 'not only the original district');
  const v = validateActions(actions, { evidence: e, gates: GATES, pass: 'FLEXIBLE' });
  assert.ok(v.jobs.length > 0, JSON.stringify(v.rejected));
  assert.ok(v.jobs.every((j) => j.stage === 'FB_GROUP_SEARCH'));
});

test('4. a budget slightly outside the price: ±12% flexibility, and a flexible match is never reported as exact', () => {
  assert.deepEqual(flexBand(213840), { min: 188179, max: 239501 });
  const dna = buildPropertyDna({ transactionType: 'SALE', propertyType: 'APARTMENT', countryCode: 'GE', city: 'Tbilisi', district: 'Krtsanisi', totalPrice: 213840, currency: 'USD', area: 97.2, rooms: 3, bedrooms: 2 });
  const exact = qualify(classifyDemand('ვიყიდი 2 საძინებლიან ბინას კრწანისში, ბიუჯეტი 215 000$'), dna, { ageDays: 1 });
  const flexible = qualify(classifyDemand('ვიყიდი 2 საძინებლიან ბინას კრწანისში, ბიუჯეტი 195 000$'), dna, { ageDays: 1 });
  const tooLow = qualify(classifyDemand('ვიყიდი 2 საძინებლიან ბინას კრწანისში, ბიუჯეტი 160 000$'), dna, { ageDays: 1 });
  assert.equal(tooLow.category, 'REJECTED', 'beyond the controlled flexibility is not a lead');
  assert.notEqual(flexible.category, 'REJECTED', JSON.stringify(flexible));
  assert.ok(flexible.limitations.includes('BUDGET_STRETCH'), `a stretch is labelled: ${flexible.limitations}`);
  assert.ok(!exact.limitations.includes('BUDGET_STRETCH'));
  assert.notEqual(flexible.category, 'STRONG', 'a stretch is never Strong');
});

test('5. high-volume irrelevant Actor output: that Actor is stopped and gets no new run', () => {
  const noisy = actor('TIKTOK', { runs: 3, items: 150, useful: 2 });
  assert.equal(actorExhausted(noisy), 'IRRELEVANT_OUTPUT');
  const e = evidence({ actors: [...evidence().actors, noisy] });
  const v = validateActions([{ type: 'REFINE_QUERIES', stage: 'TIKTOK_SEARCH', actorKey: null, queries: [{ language: 'ru', query: 'куплю квартиру в Тбилиси' }], urls: [], rationale: '' }],
    { evidence: e, gates: GATES, pass: 'SEMANTIC' });
  assert.equal(v.jobs.length, 0);
  assert.equal(v.rejected[0].reason, 'IRRELEVANT_OUTPUT');
  assert.ok(fallbackActions(e, 'SEMANTIC').some((a) => a.type === 'STOP_ACTOR' && a.actorKey === 'TIKTOK'));
});

test('6. duplicates across platforms and rounds: a used query, or a near copy, is never paid for again', () => {
  const e = evidence({ usedQueries: [{ language: 'ru', query: 'куплю квартиру в Тбилиси' }] });
  const v = validateActions([{ type: 'REFINE_QUERIES', stage: 'BLUESKY_SEARCH', actorKey: null, queries: [
    { language: 'ru', query: 'Куплю квартиру в Тбилиси!' },
    { language: 'ru', query: 'куплю квартиру в тбилиси срочно' },
    { language: 'ru', query: 'ищу квартиру для покупки в Тбилиси' },
  ], urls: [], rationale: '' }], { evidence: e, gates: GATES, pass: 'SEMANTIC' });
  assert.deepEqual(v.rejected.map((r) => r.reason), ['REPEATS_A_USED_QUERY', 'REPEATS_A_USED_QUERY']);
  assert.equal(v.jobs.length, 1);
});

test('7. useful parent posts: comments are read only under parents that qualified as promising', () => {
  const parent = { url: 'https://www.facebook.com/groups/1/posts/2', stage: 'FB_COMMENTS', similarity: 82 };
  const e = evidence({ passesTried: ['SEMANTIC', 'FLEXIBLE', 'EXPLORE'], promisingParents: [parent] });
  assert.deepEqual(nextStep(e, GATES), { kind: 'RUN', pass: 'COMMENTS' });
  const v = validateActions([{ type: 'INSPECT_COMMENTS', stage: 'FB_COMMENTS', actorKey: null, queries: [],
    urls: [parent.url, 'https://www.facebook.com/groups/9/posts/9'], rationale: '' }], { evidence: e, gates: GATES, pass: 'COMMENTS' });
  assert.equal(v.jobs.length, 1);
  assert.equal(v.jobs[0].targetUrl, parent.url);
  assert.equal(v.rejected[0].reason, 'PARENT_NOT_QUALIFIED');
  /* Without promising parents the COMMENTS pass is skipped, not run blind. */
  assert.deepEqual(nextStep(evidence({ passesTried: ['SEMANTIC', 'FLEXIBLE', 'EXPLORE'] }), GATES), { kind: 'STOP', reason: 'COVERAGE_COMPLETE' });
});

test('8. an Actor that repeatedly returns nothing is not run again', () => {
  const empty = actor('BLUESKY', { runs: 2, emptyStreak: 2 });
  assert.equal(actorExhausted(empty), 'REPEATEDLY_EMPTY');
  const v = validateActions([{ type: 'REFINE_QUERIES', stage: 'BLUESKY_SEARCH', actorKey: null, queries: [{ language: 'en', query: 'want to buy apartment in Tbilisi' }], urls: [], rationale: '' }],
    { evidence: evidence({ actors: [...evidence().actors, empty] }), gates: GATES, pass: 'SEMANTIC' });
  assert.equal(v.jobs.length, 0);
  assert.equal(v.rejected[0].reason, 'REPEATEDLY_EMPTY');
  assert.equal(actorExhausted(actor('TIKTOK', { globalRuns: 10, globalItems: 150, globalQualified: 0 })), 'NO_YIELD_ACROSS_CAMPAIGNS', 'learned across campaigns');
});

test('9. budget exhausted: the loop stops honestly, and a round never commits past its share of what is left', () => {
  assert.deepEqual(nextStep(evidence({ spentMicros: 2_799_000 }), GATES), { kind: 'STOP', reason: 'BUDGET_EXHAUSTED' });
  const tight = evidence({ spentMicros: 2_700_000 });
  const many = ['Сабуртало', 'Ваке', 'Сололаки', 'Глдани', 'Дидубе', 'Исани', 'Надзаладеви', 'Мтацминда'].map((d) => ({ language: 'ru', query: `недвижимость ${d} Тбилиси` }));
  const v = validateActions([{ type: 'EXPLORE_SOURCES', stage: 'FB_GROUP_SEARCH', actorKey: null, queries: many, urls: [], rationale: '' }],
    { evidence: tight, gates: GATES, pass: 'EXPLORE' });
  assert.ok(v.committedMicros <= 0.6 * 100_000);
  assert.ok(v.rejected.some((r) => r.reason === 'OVER_BUDGET'));
  assert.deepEqual(nextStep(evidence({ round: MAX_ADAPTIVE_ROUNDS }), GATES), { kind: 'STOP', reason: 'MAX_ROUNDS' });
});

test('the strategy changes on evidence: round two never repeats round one', () => {
  const e1 = evidence();
  const r1 = validateActions(fallbackActions(e1, 'SEMANTIC'), { evidence: e1, gates: GATES, pass: 'SEMANTIC' });
  const e2 = evidence({ round: 1, passesTried: ['SEMANTIC'], lastRoundQualified: 0,
    usedQueries: [...e1.usedQueries, ...r1.jobs.map((j) => ({ language: j.language, query: j.query }))] });
  const step = nextStep(e2, GATES);
  assert.equal(step.pass, 'FLEXIBLE');
  const r2 = validateActions(fallbackActions(e2, step.pass), { evidence: e2, gates: GATES, pass: step.pass });
  const first = new Set(r1.jobs.map((j) => `${j.language}|${normalizeQuery(j.query)}`));
  assert.ok(r2.jobs.length > 0);
  assert.ok(r2.jobs.every((j) => !first.has(`${j.language}|${normalizeQuery(j.query)}`)), 'no query of round one comes back');
});

test('the model can never launch what the allowlist, the stage or the evidence forbid', () => {
  const v = validateActions([
    { type: 'REFINE_QUERIES', stage: 'LINKEDIN_POSTS', actorKey: null, queries: [{ language: 'en', query: 'want to buy apartment in Tbilisi' }], urls: [], rationale: '' },
    { type: 'REFINE_QUERIES', stage: 'TIKTOK_SEARCH', actorKey: null, queries: [{ language: 'en', query: '3 room apartment for sale in Tbilisi' }], urls: [], rationale: '' },
    { type: 'REFINE_QUERIES', stage: 'TIKTOK_SEARCH', actorKey: null, queries: [{ language: 'fr', query: 'acheter appartement Tbilissi' }], urls: [], rationale: '' },
    { type: 'INSPECT_COMMENTS', stage: 'FB_COMMENTS', actorKey: null, queries: [], urls: ['https://x'], rationale: '' },
  ], { evidence: evidence(), gates: GATES, pass: 'SEMANTIC' });
  assert.equal(v.jobs.length, 0);
  assert.deepEqual(v.rejected.map((r) => r.reason), ['ACTOR_NOT_ALLOWED', 'NOT_DEMAND_INTENT', 'LANGUAGE_NOT_SUPPORTED', 'WRONG_PASS']);
});

test('the model sees numbers, never raw posts; its answer is a strict schema', () => {
  const m = evidenceForModel(evidence(), 'SEMANTIC');
  assert.equal(m.pass, 'SEMANTIC');
  assert.equal(m.budget.remainingUsd, 2.4);
  assert.ok(!JSON.stringify(m).includes('facebook.com/groups/1/posts'));
  assert.equal(ADAPTIVE_ACTION_SCHEMA.strict, true);
});

test('the owner sees which passes ran and why the search ended, never costs or queries', async () => {
  const { publicSearchPasses } = await import('../findBuyers/adaptiveLoop.ts');
  assert.deepEqual(publicSearchPasses(undefined), { rounds: 0, passes: ['DIRECT'], stop: null });
  const out = publicSearchPasses({
    rounds: [
      { pass: 'SEMANTIC', queued: 4, evidence: { spentUsd: 0.4 }, rejected: [{ detail: 'secret query' }] },
      { pass: 'SEMANTIC', queued: 0 },
      { pass: 'FLEXIBLE', queued: 3 },
      { pass: null, stop: 'MAX_ROUNDS' },
      { pass: 'NOT_A_PASS' },
    ],
    stop: 'MAX_ROUNDS',
  });
  assert.deepEqual(out.passes, ['DIRECT', 'SEMANTIC', 'FLEXIBLE']);
  assert.equal(out.stop, 'MAX_ROUNDS');
  assert.equal(out.rounds, 4);
  assert.ok(!JSON.stringify(out).includes('secret') && !JSON.stringify(out).includes('spent'));
});

test('the driver runs an adaptive round before finalizing a drained campaign', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../../../supabase/functions/discovery-queue-worker/driver.ts', import.meta.url), 'utf8');
  const hook = src.indexOf('adaptiveRound(db, row.id)');
  const finalize = src.indexOf("status: 'classifying', progress: 82");
  assert.ok(hook > 0 && finalize > hook, 'adaptiveRound must run before the campaign moves to classifying');
  assert.match(src.slice(hook, finalize), /queued > 0[\s\S]*continue;/);
});
