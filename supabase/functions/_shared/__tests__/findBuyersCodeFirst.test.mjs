// FIND BUYERS / SIGNALS — code first, the model only behind default-OFF switches (owner, 2026-10-29).
//
// Pins the decision functions (aiPolicy.ts), how the switches are read (a missing, unreadable or
// retired setting is OFF), and that with every switch OFF the changed Find Buyers paths and
// classify-signals-v2 never reach a model call: QUERY_PLAN, adaptive rounds, candidate
// classification, signal classification.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('https://esm.sh/')) {
      return { url: 'data:text/javascript,export const createClient = () => { throw new Error("no network in tests"); };', shortCircuit: true };
    }
    return next(spec, ctx);
  }`));

let fetches = 0;
globalThis.Deno ??= { env: { get: () => undefined } };
const realGet = globalThis.Deno.env.get;
globalThis.Deno.env.get = (k) => (k === 'OPENAI_API_KEY' ? 'test-key' : realGet(k));
globalThis.fetch = async () => { fetches++; throw new Error('no model call is allowed with the switches off'); };

const policy = await import('../../../../src/research-core/findBuyers/aiPolicy.ts');
const { loadFindBuyersSettings, planQueries } = await import('../findBuyers/campaign.ts');
const { buildPropertyDna } = await import('../../../../src/research-core/findBuyers/propertyDna.ts');
const { buildQueryPlan } = await import('../../../../src/research-core/findBuyers/queryPlanner.ts');
const { SEARCH_LANGUAGES } = await import('../../../../src/research-core/findBuyers/languages.ts');

const read = (p) => readFileSync(new URL(`../../../../${p}`, import.meta.url), 'utf8');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ── the decision functions ─────────────────────────────────────────────── */

test('aiSwitchOn: only a stored true is ON; missing, unreadable or anything else is OFF', () => {
  for (const on of [true, 'true', '"true"', ' TRUE ']) assert.equal(policy.aiSwitchOn(on), true, String(on));
  for (const off of [undefined, null, false, 'false', 1, 0, 'yes', 'on', {}, [], { enabled: true }, '']) assert.equal(policy.aiSwitchOn(off), false, JSON.stringify(off));
});

test('explicitlyAmbiguous: only real-estate text the rules could not decide', () => {
  assert.equal(policy.explicitlyAmbiguous({ needsModel: true, realEstate: true }, 'ბინა კრწანისში'), true);
  assert.equal(policy.explicitlyAmbiguous({ needsModel: false, realEstate: true }, 'ბინა კრწანისში'), false, 'decided by rules');
  assert.equal(policy.explicitlyAmbiguous({ needsModel: true, realEstate: false }, 'USDT'), false, 'not real estate');
  assert.equal(policy.explicitlyAmbiguous({ needsModel: true, realEstate: true }, ' a '), false, 'nothing to read');
  assert.equal(policy.explicitlyAmbiguous(null, 'x'), false);
});

test('selectForModel: nothing when OFF; ambiguous only, deduplicated, hard-capped when ON', () => {
  const items = Array.from({ length: 60 }, (_, i) => ({ id: i, amb: i % 2 === 0, text: `t${i % 50}` }));
  const opts = { ambiguous: (x) => x.amb, key: (x) => x.text, cap: 20, maxCap: policy.FIND_BUYERS_AI_MAX_ITEMS_PER_RUN };
  assert.deepEqual(policy.selectForModel(items, { ...opts, enabled: false }), []);
  assert.deepEqual(policy.selectForModel(items, { ...opts, enabled: 'true' }), [], 'a truthy non-boolean is not ON');
  const on = policy.selectForModel(items, { ...opts, enabled: true });
  assert.equal(on.length, 20);
  assert.ok(on.every((x) => x.amb));
  assert.equal(new Set(on.map((x) => x.text)).size, on.length, 'the same words once');
  assert.equal(policy.selectForModel(items, { ...opts, enabled: true, cap: 10_000 }).length, 20, 'a caller cannot lift the hard cap');
  assert.equal(policy.selectForModel(items, { ...opts, enabled: true, cap: Number.NaN }).length, 0);
  assert.equal(policy.FIND_BUYERS_AI_MAX_ITEMS_PER_RUN, 20);
  assert.ok(policy.SIGNALS_AI_MAX_ITEMS_PER_TICK > 0 && policy.SIGNALS_AI_MAX_ITEMS_PER_TICK <= 50);
});

/* ── how the switches are read ──────────────────────────────────────────── */

const settingsDb = (rows, error = null) => ({
  from: () => ({ select: () => ({ in: async () => ({ data: error ? null : rows, error }) }) }),
});

test('settings: no rows, a read error, or the retired find_buyers_ai_first=true all mean every model switch OFF', async () => {
  for (const db of [settingsDb([]), settingsDb(null, { message: 'permission denied' }), settingsDb([{ key: 'find_buyers_ai_first', value: true }])]) {
    const s = await loadFindBuyersSettings(db);
    assert.equal(s.aiAmbiguous, false);
    assert.equal(s.aiPlanning, false);
    assert.equal('aiFirst' in s, false, 'the retired AI-first setting is not read');
  }
});

test('settings: an explicit true turns a switch on (JSON boolean or JSON-encoded string)', async () => {
  const s = await loadFindBuyersSettings(settingsDb([
    { key: policy.AI_SWITCHES.FIND_BUYERS_AMBIGUOUS, value: true },
    { key: policy.AI_SWITCHES.FIND_BUYERS_PLANNING, value: 'true' },
  ]));
  assert.equal(s.aiAmbiguous, true);
  assert.equal(s.aiPlanning, true);
  const off = await loadFindBuyersSettings(settingsDb([{ key: policy.AI_SWITCHES.FIND_BUYERS_AMBIGUOUS, value: 'yes' }]));
  assert.equal(off.aiAmbiguous, false);
});

/* ── with the switches OFF no Find Buyers path reaches a model ──────────── */

test('QUERY_PLAN: with planning OFF the plan is the deterministic one and no model is asked', async () => {
  fetches = 0;
  const dna = buildPropertyDna({ transactionType: 'SALE', propertyType: 'APARTMENT', city: 'Tbilisi', district: 'Krtsanisi', totalPrice: 213840, currency: 'USD', area: 97.2, rooms: 3, bedrooms: 2 });
  const upserts = [];
  const db = { from: (t) => {
    const b = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: null, error: null }), upsert: async (row) => { upserts.push({ t, row }); return { error: null }; } };
    return b;
  } };
  const plan = await planQueries(db, dna, 'job-1', null, null);
  assert.equal(fetches, 0, 'no OpenAI request');
  assert.equal(upserts.length, 0, 'nothing cached');
  assert.deepEqual(plan, buildQueryPlan(dna, SEARCH_LANGUAGES, null), 'exactly the code-built plan');
  assert.ok(plan.queries.length > 0);
});

test('adaptive rounds: the model call sits behind the planning switch; the deterministic ladder is the default', () => {
  const src = code('supabase/functions/_shared/findBuyers/adaptive.ts');
  const call = src.indexOf('openAiJson<');
  assert.ok(call > 0);
  const guard = src.lastIndexOf('if (settings.aiPlanning === true', call);
  assert.ok(guard > 0 && call - guard < 400, 'the adaptive model call is guarded by aiPlanning');
  assert.ok(src.indexOf('fallbackActions(evidence, step.pass)') > call, 'the deterministic ladder runs when the model did not');
});

test('pipeline: the classification model call sits behind aiAmbiguous and sees only explicitly ambiguous candidates', () => {
  const src = code('supabase/functions/_shared/findBuyers/pipeline.ts');
  const call = src.indexOf('await classifyCandidates(');
  const guard = src.lastIndexOf('if (ctx.aiAmbiguous === true', call);
  assert.ok(call > 0 && guard > 0, 'guarded');
  const block = src.slice(guard, call);
  assert.match(block, /for \(const a of ambiguous\)/, 'only the ambiguous candidates are grouped for the model');
  assert.match(block, /cap: FIND_BUYERS_AI_MAX_ITEMS_PER_RUN/);
  assert.match(src.slice(src.lastIndexOf('const ambiguous =', guard), guard), /explicitlyAmbiguous\(a\.reading, a\.item\.text\)/);
  assert.doesNotMatch(src, /openAiJson/, 'no other model call in the pipeline');
  assert.doesNotMatch(src, /aiFirst/, 'the retired AI-first path is gone');
});

test('classify-signals-v2: rules first; the model sees only the capped ambiguous remainder, and only with its switch ON', () => {
  const src = code('supabase/functions/classify-signals-v2/index.ts');
  assert.match(src, /eq\('key',AI_SWITCHES\.SIGNALS_AMBIGUOUS\)/);
  assert.match(src, /const aiAmbiguousEnabled=aiSwitchOn\(/);
  assert.match(src, /selectForModel\(ambiguousSignals,\{enabled:aiAmbiguousEnabled,[^}]*cap:SIGNALS_AI_MAX_ITEMS_PER_TICK/);
  const rules = src.indexOf('ruleSignalVerdict(');
  const handoff = src.indexOf('aiSignals.length=0;aiSignals.push(...toAi);');
  const model = src.indexOf("fetch('https://api.openai.com/");
  assert.ok(rules > 0 && handoff > rules && model > handoff, 'rules → capped ambiguous handoff → model');
  assert.ok(src.indexOf("Deno.env.get('OPENAI_API_KEY')") > handoff, 'the key is read only once something may go to the model');
  assert.match(src.slice(handoff, model), /const key=aiSignals\.length\?/);
  assert.match(src, /reason!==AMBIGUOUS_AI_OFF/, 'a switched-off ambiguous verdict is never reused as a cached answer');
});
