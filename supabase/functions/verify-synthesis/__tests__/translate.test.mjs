// verify-synthesis `translate` (owner P0, 2026-10-12): cache first, misses to
// the model in checked chunks, every model call taken from the job+language
// allowance, the cost recorded against the job (never a silent zero), and the
// action authorised exactly like reading the report.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { translateTexts, TRANSLATION_OPERATION } from '../translate.ts';
import { sourceHash } from '../../../../src/verify/translation/textTranslation.ts';

const JOB = '8ba97da9-0000-4000-8000-000000000601';
const PRICES = [
  { provider: 'OPENAI', model: 'gpt-5.6-luna', unit: 'INPUT_TOKEN', rate: '0.20', per_units: '1000000', effective_from: '2026-07-30T00:00:00Z' },
  { provider: 'OPENAI', model: 'gpt-5.6-luna', unit: 'CACHED_INPUT_TOKEN', rate: '0.02', per_units: '1000000', effective_from: '2026-07-30T00:00:00Z' },
  { provider: 'OPENAI', model: 'gpt-5.6-luna', unit: 'OUTPUT_TOKEN', rate: '1.20', per_units: '1000000', effective_from: '2026-07-30T00:00:00Z' },
];

/** A tiny stand-in for the service client: just what translate.ts calls. */
function fakeDb({ cache = [], allow = true, prices = PRICES } = {}) {
  const state = { cache: [...cache], costs: [], quota: [], upserts: [] };
  const db = {
    state,
    from(table) {
      const q = { table, filters: {} };
      const api = {
        select() { return api; },
        eq(k, v) { q.filters[k] = v; return api; },
        in(k, v) { q.filters[k] = v; return api; },
        then(res, rej) {
          let data = [];
          if (table === 'verify_text_translations') data = state.cache.filter((r) => r.lang === q.filters.lang && q.filters.source_hash.includes(r.source_hash));
          if (table === 'provider_price_book') data = prices;
          return Promise.resolve({ data, error: null }).then(res, rej);
        },
        insert(rows) { if (table === 'cost_events') state.costs.push(...rows); return Promise.resolve({ error: null }); },
        upsert(rows, opts) { state.upserts.push({ rows, opts }); state.cache.push(...rows); return Promise.resolve({ error: null }); },
      };
      return api;
    },
    rpc(name, args) { state.quota.push({ name, args }); return Promise.resolve({ data: typeof allow === 'function' ? allow(args) : allow, error: null }); },
  };
  return db;
}

function stubOpenAi(answer) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const input = JSON.parse(body.input[1].content);
    const out = answer ? answer(input) : Object.fromEntries(Object.entries(input).map(([k, v]) => [k, `EN ${v.replace(/[Ⴀ-ჿ]+/g, 'word')}`]));
    return new Response(JSON.stringify({ output_text: JSON.stringify(out), usage: { input_tokens: 1000, output_tokens: 500, input_tokens_details: { cached_tokens: 0 } } }), { status: 200 });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('cache hits are answered for free; misses go to the model, are cached and costed against the job', async () => {
  const cachedText = 'ბინა 12';
  const db = fakeDb({ cache: [{ source_hash: await sourceHash(cachedText), lang: 'en', source: cachedText, translated: 'Apartment 12' }] });
  const ai = stubOpenAi();
  try {
    const r = await translateTexts(db, { jobId: JOB, lang: 'en', texts: [cachedText, 'სართული 5', 'ფართი 80 კვ.მ'] }, { apiKey: 'sk-test', model: 'gpt-5.6-luna' });
    assert.equal(r.cached, 1);
    assert.equal(r.translated, 2);
    assert.equal(r.translations[cachedText], 'Apartment 12');
    assert.match(r.translations['სართული 5'], /^EN word 5$/);
    // Only the misses reached the model, as JSON in and out.
    assert.equal(ai.calls.length, 1);
    assert.deepEqual(Object.values(JSON.parse(ai.calls[0].body.input[1].content)), ['სართული 5', 'ფართი 80 კვ.მ']);
    assert.deepEqual(ai.calls[0].body.text, { format: { type: 'json_object' } });
    // Shared from now on, keyed on the text.
    assert.equal(db.state.upserts[0].opts.onConflict, 'source_hash,lang');
    assert.equal(db.state.upserts[0].rows.length, 2);
    // The allowance was asked before the call.
    assert.equal(db.state.quota[0].name, 'verify_translation_quota_take');
    assert.equal(db.state.quota[0].args.p_job_id, JOB);
    // COGS: one priced row on the job, not under VERIFY_* (written once per job elsewhere).
    assert.equal(db.state.costs.length, 1);
    const c = db.state.costs[0];
    assert.equal(c.operation_type, TRANSLATION_OPERATION);
    assert.ok(!c.operation_type.startsWith('VERIFY_'));
    assert.equal(c.job_id, JOB);
    assert.equal(c.provider, 'OPENAI');
    assert.equal(c.pricing_state, 'ESTIMATED');
    assert.ok(c.cost_usd > 0);
    assert.match(c.source, /model=gpt-5\.6-luna;lang=en/);
  } finally { ai.restore(); }
});

test('a model the price book does not know is UNPRICED, never a silent zero', async () => {
  const db = fakeDb({ prices: [] });
  const ai = stubOpenAi();
  try {
    await translateTexts(db, { jobId: JOB, lang: 'ru', texts: ['სართული 5'] }, { apiKey: 'sk-test', model: 'gpt-unknown' });
    assert.equal(db.state.costs[0].pricing_state, 'UNPRICED');
  } finally { ai.restore(); }
});

test('an answer that lost a number or stayed Georgian is neither cached nor returned', async () => {
  const db = fakeDb();
  const ai = stubOpenAi((input) => ({ t0: 'Floor five', t1: input.t1 }));
  try {
    const r = await translateTexts(db, { jobId: JOB, lang: 'en', texts: ['სართული 15', 'ბინა მშენებარეა'] }, { apiKey: 'sk-test', model: 'gpt-5.6-luna' });
    assert.deepEqual(r.translations, {});
    assert.equal(r.failed, 2);
    // One second pass in smaller chunks, then given up.
    assert.equal(ai.calls.length, 2);
    assert.equal(db.state.upserts.length, 0);
    // The call was still made and still costed.
    assert.equal(db.state.costs.length, 1);
  } finally { ai.restore(); }
});

test('an exhausted allowance makes no model call and says limited', async () => {
  const db = fakeDb({ allow: false });
  const ai = stubOpenAi();
  try {
    const r = await translateTexts(db, { jobId: JOB, lang: 'en', texts: ['სართული 5'] }, { apiKey: 'sk-test', model: 'gpt-5.6-luna' });
    assert.equal(r.limited, true);
    assert.equal(ai.calls.length, 0);
    assert.equal(db.state.costs.length, 0);
  } finally { ai.restore(); }
});

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('the action is authorised like the report read, before any stored report is touched', () => {
  const src = read('supabase/functions/verify-synthesis/index.ts');
  const at = src.indexOf("body?.action === 'translate'");
  assert.ok(at > 0, 'translate action missing');
  assert.ok(at < src.indexOf('READY FAST PATH'), 'translate must be answered before the report read paths');
  const branch = src.slice(at, at + 900);
  // The CALLER's RLS-scoped client proves the job is theirs; 404 otherwise.
  assert.match(branch, /await supabase\.from\('research_jobs'\)\.select\('id'\)\.eq\('id', jobId\)\.maybeSingle\(\)/);
  assert.match(branch, /return json\(\{ error: 'not found' \}, 404\)/);
  // The cache, allowance and cost row go through the service client.
  assert.match(branch, /translateTexts\(writer, parsed\.request/);
  // The key comes from the environment, never from code.
  assert.match(branch, /Deno\.env\.get\('OPENAI_API_KEY'\)/);
});

test('the cache tables are service-role only', () => {
  const sql = read('supabase/migrations/20261101090000_verify_text_translations.sql');
  assert.match(sql, /primary key \(source_hash, lang\)/);
  for (const t of ['verify_text_translations', 'verify_text_translation_usage']) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`));
    assert.match(sql, new RegExp(`revoke all on public\\.${t} from public, anon, authenticated`));
  }
  assert.doesNotMatch(sql, /create policy/i);
  assert.match(sql, /revoke all on function public\.verify_translation_quota_take\(uuid, text, integer, integer, integer\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.verify_translation_quota_take\(uuid, text, integer, integer, integer\) to service_role/);
});

test('a refused answer gets one smaller second pass, which can recover it', async () => {
  const db = fakeDb();
  let n = 0;
  const ai = stubOpenAi((input) => (n++ === 0 ? { t0: 'Floor five', t1: 'Apartment 7' } : { t0: 'Floor 15' }));
  try {
    const r = await translateTexts(db, { jobId: JOB, lang: 'en', texts: ['სართული 15', 'ბინა 7'] }, { apiKey: 'sk-test', model: 'gpt-5.6-luna' });
    assert.deepEqual(r.translations, { 'სართული 15': 'Floor 15', 'ბინა 7': 'Apartment 7' });
    assert.equal(r.failed, 0);
    assert.equal(ai.calls.length, 2);
    assert.deepEqual(Object.values(JSON.parse(ai.calls[1].body.input[1].content)), ['სართული 15']);
    assert.equal(db.state.costs.length, 1);
  } finally { ai.restore(); }
});
