// PRIVACY P0 (owner, 2026-10-29): another person's search requests and data
// never enter this person's HOMI context.
//
// Two kinds of proof:
//   1. SOURCE: every table HOMI READS is on an allowlist with the scope that
//      ties it to the verified caller, and the caller id comes from the JWT,
//      never from the request body. A new read without a scope fails here.
//   2. BEHAVIOUR: two users' fixtures in a fake database; user B's text never
//      appears in user A's prompt section, even when the database ignores the
//      filters (defence in depth in ownContext.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadOwnContext, MATCH_COLUMNS } from '../../../../supabase/functions/homatch-ai/ownContext.ts';
import { internalDataForPrompt, planInternalSections } from '../contextPlan.ts';

const root = new URL('../../../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const EDGE = strip(read('supabase/functions/homatch-ai/index.ts'));
const OWN = strip(read('supabase/functions/homatch-ai/ownContext.ts'));

/* ── 1. Source-level scope audit ─────────────────────────────────────── */

/** Every `.from('table')` followed by a read, with the statement that follows it. */
function reads(src) {
  const out = [];
  for (const m of src.matchAll(/\.from\('([a-z_]+)'\)/g)) {
    const rest = src.slice(m.index, m.index + 700);
    const stmt = rest.slice(0, Math.max(rest.indexOf(';'), 0) || rest.length);
    if (/^\.from\('[a-z_]+'\)\s*\.(insert|update|upsert|delete)\(/.test(stmt.replace(/\s+/g, ' ').replace(/\) \./g, ').'))) continue;
    if (!/\.select\(/.test(stmt)) continue;
    out.push({ table: m[1], stmt, at: m.index });
  }
  return out;
}

/** The scope each readable table must carry, tied to the verified caller. */
const SCOPES = {
  anonymous_sessions: [/\.eq\('token_sha256', await sha256Hex\(token\)\)/],
  users: [/\.eq\('auth_id', user\.id\)/],
  ai_conversations: [/\.eq\('id', conversationId\)/],
  ai_messages: [/\.eq\('conversation_id', conversationId\)/],
  rate_limit_events: [/head: true/],
  usage_reservations: [/\.eq\('user_id', uid\)/],
  credit_accounts: [/\.eq\('user_id', uid\)/],
  research_jobs: [/\.eq\('user_id', callerId\)/],
  expat_profiles: [/\.eq\('user_id', callerId\)/],
  properties: [/\.eq\('user_id', callerId\)/],
  matches: [/\.in\('property_id', ids\)/],
  // Not personal data: one global setting, so HOMI can say honestly whether online payment works.
  admin_settings: [/\.eq\('key', 'saas_default_payment_provider'\)/],
};

test('every table HOMI reads is allowlisted and scoped to the verified caller', () => {
  const all = [...reads(EDGE), ...reads(OWN)];
  assert.ok(all.length >= 10, `the audit found ${all.length} reads; the parser broke`);
  for (const r of all) {
    assert.ok(r.table in SCOPES, `homatch-ai reads ${r.table}, which is not on the privacy allowlist: add it with its caller scope`);
    for (const re of SCOPES[r.table]) assert.match(r.stmt, re, `${r.table} read without its caller scope:\n${r.stmt.slice(0, 300)}`);
  }
  // Other people's data is never a source.
  for (const forbidden of ['intent_profiles', 'raw_signals', 'active_search_subscriptions', 'discovery_marketplace_searches', 'external_leads', 'ai_chat_leads\').select']) {
    assert.ok(!EDGE.includes(`'${forbidden}`) || forbidden.endsWith('select'), forbidden);
    assert.ok(!OWN.includes(`'${forbidden}`), forbidden);
  }
  assert.doesNotMatch(EDGE, /intent_profiles|original_text\.ilike|\.ilike\(|\.or\(/, 'no cross-user free-text search');
});

test('a conversation (and so its messages) is only read once it is proven the caller\'s', () => {
  const conv = EDGE.indexOf(".from('ai_conversations').select('id,context')");
  assert.ok(conv > 0);
  const block = EDGE.slice(conv, conv + 600);
  assert.match(block, /q\.eq\('anon_session_id', anonSession\.id\)/);
  assert.match(block, /q\.eq\('user_id', user!\.id\)/);
  assert.match(block, /if \(!c\) return json\(\{ error: 'Conversation not found' \}, 404\)/);
  // The pitch history reads only the `meta` column of that conversation's answers.
  assert.match(EDGE, /from\('ai_messages'\)\.select\('meta'\)/);
});

test('the caller id comes from the verified JWT, never from the request body', () => {
  assert.match(EDGE, /const \{ data: \{ user \} \} = await sb\.auth\.getUser\(jwt\)/);
  assert.match(EDGE, /from\('users'\)\.select\('id, plan'\)\.eq\('auth_id', user\.id\)/);
  assert.match(EDGE, /const uid = profile\?\.id;/);
  assert.match(EDGE, /loadOwnContext\(sb, uid, sections,/);
  assert.doesNotMatch(EDGE, /body\??\.(userId|user_id|uid|ownerId|callerId)/, 'no caller identity from the body');
  // The marketplace helper scopes the search to the same verified id.
  const mp = strip(read('supabase/functions/_shared/marketplacePropertyContext.ts'));
  assert.match(mp, /from\('discovery_marketplace_searches'\)[\s\S]{0,120}\.eq\('user_id', userId\)/);
  assert.match(EDGE, /marketplacePropertyContext\(sb, uid, body\.context, resultCatalogue\)/);
});

test('a match never carries the other person\'s own words', () => {
  assert.doesNotMatch(MATCH_COLUMNS, /excerpt|original_text|contact|phone|email|name/);
  assert.match(OWN, /\.select\(MATCH_COLUMNS\)/);
});

/* ── 2. Two users, one fake database ─────────────────────────────────── */

const A = 'aaaaaaaa-0000-0000-0000-00000000000a';
const B = 'bbbbbbbb-0000-0000-0000-00000000000b';
const SECRET_B = 'B-SECRET looking for a 3 room flat in Vake under 90000, call me';

const FIXTURES = {
  research_jobs: [
    { id: 'jobA', user_id: A, status: 'COMPLETE', deleted_at: null, query: 'A report on Saburtalo 12', completed_at: '2026-10-01', synthesis_json: { report: { summary: { label: 'OK', statement: 'A own report' } } } },
    { id: 'jobB', user_id: B, status: 'COMPLETE', deleted_at: null, query: SECRET_B, completed_at: '2026-10-02', synthesis_json: { report: { summary: { label: 'X', statement: SECRET_B } } } },
  ],
  expat_profiles: [
    { user_id: A, first_name: 'Ana', property_intent: 'BUY', personal_notes: 'A note', onboarding_completed_at: '2026-10-01' },
    { user_id: B, first_name: 'Bob', property_intent: 'RENT', personal_notes: SECRET_B, onboarding_completed_at: '2026-10-01' },
  ],
  properties: [
    { id: 'propA', user_id: A, title: 'A flat', is_deleted: false },
    { id: 'propB', user_id: B, title: SECRET_B, is_deleted: false },
  ],
  matches: [
    { id: 'mA', property_id: 'propA', match_score: 80, preview_city: 'Tbilisi', preview_excerpt: 'stranger words on A' },
    { id: 'mB', property_id: 'propB', match_score: 90, preview_city: SECRET_B, preview_excerpt: SECRET_B },
  ],
};

/** A tiny PostgREST-shaped fake. `honest: false` ignores every filter, like a bug would. */
function fakeDb({ honest }) {
  const calls = [];
  const from = (table) => {
    let rows = [...(FIXTURES[table] ?? [])];
    let cols = null;
    const q = {
      select(c) { cols = c; calls.push({ table, cols: c }); return q; },
      eq(k, v) { if (honest) rows = rows.filter((r) => r[k] === v); return q; },
      is(k, v) { if (honest) rows = rows.filter((r) => (r[k] ?? null) === v); return q; },
      in(k, vs) { if (honest) rows = rows.filter((r) => vs.includes(r[k])); return q; },
      order() { return q; },
      limit() { return q; },
      maybeSingle() { return Promise.resolve({ data: project(rows[0] ?? null), error: null }); },
      then(res, rej) { return Promise.resolve({ data: rows.map(project), error: null }).then(res, rej); },
    };
    const project = (r) => {
      if (!r || !cols || cols.includes('*')) return r;
      const keep = cols.split(',').map((s) => s.trim());
      return Object.fromEntries(Object.entries(r).filter(([k]) => keep.includes(k)));
    };
    return q;
  };
  return { from, calls };
}

const ALL = new Set(['verifications', 'properties', 'matches', 'myGeorgia']);
const noneExpired = async () => new Set();

for (const honest of [true, false]) {
  test(`user B's data never reaches user A's prompt (${honest ? 'scoped database' : 'database ignoring every filter'})`, async () => {
    const db = fakeDb({ honest });
    const ctx = await loadOwnContext(db, A, ALL, noneExpired);
    for (const tier of ['LIGHT', 'FULL']) {
      const prompt = internalDataForPrompt(ctx, tier);
      assert.ok(!prompt.includes('B-SECRET'), `${tier}: user B's text reached user A's prompt`);
      assert.ok(!prompt.includes('Bob'), `${tier}: user B's profile reached user A's prompt`);
      assert.ok(!prompt.includes('stranger words'), `${tier}: a match excerpt (another person's words) reached the prompt`);
    }
    assert.deepEqual(ctx.verifications.map((v) => v.jobId), ['jobA']);
    assert.deepEqual(ctx.properties.map((p) => p.id), ['propA']);
    assert.deepEqual(ctx.matches.map((m) => m.id), ['mA']);
    assert.equal(ctx.myGeorgia[0]?.firstName, 'Ana');
    assert.ok(ctx.properties.every((p) => !('user_id' in p)), 'owner ids are not echoed into the prompt');
  });
}

test('and the same holds the other way round, and with no caller nothing is read', async () => {
  const ctxB = await loadOwnContext(fakeDb({ honest: false }), B, ALL, noneExpired);
  const prompt = internalDataForPrompt(ctxB, 'FULL');
  assert.ok(!prompt.includes('A own report') && !prompt.includes('A note') && !prompt.includes('A flat'));
  const db = fakeDb({ honest: false });
  const empty = await loadOwnContext(db, '', ALL, noneExpired);
  assert.deepEqual(empty, { verifications: [], properties: [], matches: [], myGeorgia: [] });
  assert.equal(db.calls.length, 0, 'no caller, no query');
});

test('a generic turn reads nothing at all', async () => {
  const sections = new Set(planInternalSections('Is Vake good for families?', { tier: 'LIGHT', service: null }));
  const db = fakeDb({ honest: true });
  await loadOwnContext(db, A, sections, noneExpired);
  assert.equal(db.calls.length, 0);
});

test('an expired report or a failed expiry check gives no report context', async () => {
  const expired = await loadOwnContext(fakeDb({ honest: true }), A, new Set(['verifications']), async () => new Set(['jobA']));
  assert.deepEqual(expired.verifications, []);
  const failed = await loadOwnContext(fakeDb({ honest: true }), A, new Set(['verifications']), async () => { throw new Error('x'); });
  assert.deepEqual(failed.verifications, []);
});
