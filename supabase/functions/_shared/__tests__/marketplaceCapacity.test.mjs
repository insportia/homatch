// FIND PROPERTY CAPACITY (_shared/marketplaceCapacity.ts + migration 20261116090000): shared portal
// runs answered by reference, a safe degraded dispatch, the customer notice, and the wiring in
// marketplace-search / processAndStore. The SQL itself is proven by tests/sql/run-find-property-capacity.sh.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.Deno ??= { env: { get: () => undefined } };
const cap = await import('../marketplaceCapacity.ts');

/* A PostgREST stand-in: eq/in/is filters, update().select(), insert, rpc. */
function fakeDb(tables, rpc = async () => ({ data: null, error: { message: 'down' } })) {
  const calls = [];
  const db = {
    calls,
    rpc: async (name, args) => { calls.push({ rpc: name, args }); return rpc(name, args); },
    from(name) {
      const st = { filters: [], patch: null, insert: null };
      const rows = () => (tables[name] ?? []).filter((r) => st.filters.every(([op, c, v]) => op === 'eq' ? r[c] === v : op === 'in' ? v.includes(r[c]) : op === 'is' ? (v === null ? r[c] == null : r[c] === v) : true));
      const b = {
        select: () => b, order: () => b, limit: () => b, range: () => b,
        eq: (c, v) => { st.filters.push(['eq', c, v]); return b; },
        in: (c, v) => { st.filters.push(['in', c, v]); return b; },
        is: (c, v) => { st.filters.push(['is', c, v]); return b; },
        update: (p) => { st.patch = p; return b; },
        insert: (r) => { st.insert = r; calls.push({ insert: name, rows: r }); (tables[name] ??= []).push(...r); return Promise.resolve({ error: null }); },
        then: (ok, bad) => Promise.resolve().then(() => {
          if (st.patch) { const hit = rows(); hit.forEach((r) => Object.assign(r, st.patch)); calls.push({ update: name, patch: st.patch, n: hit.length }); return { data: hit.map((r) => ({ id: r.id, status: r.status })), error: null }; }
          const data = rows(); return { data, count: data.length, error: null };
        }).then(ok, bad),
      };
      return b;
    },
  };
  return db;
}

const NOW = new Date('2026-10-18T12:00:00Z');

test('a follower takes its finished leader\'s outcome; a running leader keeps it waiting', async () => {
  const runs = [
    { id: 'L1', search_id: 'sA', status: 'COMPLETE', returned_count: 40, discovered_count: 55, errors: [], query_applied: { pages: 3 }, completed_at: '2026-10-18T11:58:00Z', deadline_at: '2026-10-18T12:10:00Z' },
    { id: 'L2', search_id: 'sB', status: 'SEARCHING', returned_count: 0, errors: [], deadline_at: '2026-10-18T12:10:00Z' },
    { id: 'F1', search_id: 'sC', worker_id: 'w', status: 'QUEUED', shared_run_id: 'L1' },
    { id: 'F2', search_id: 'sC', worker_id: 'w2', status: 'QUEUED', shared_run_id: 'L2' },
  ];
  const db = fakeDb({ discovery_marketplace_worker_runs: runs });
  const mine = runs.filter((r) => r.search_id === 'sC').map((r) => ({ ...r }));
  assert.equal(await cap.resolveSharedRuns(db, mine, NOW), 1);
  const f1 = runs.find((r) => r.id === 'F1');
  assert.equal(f1.status, 'COMPLETE');
  assert.equal(f1.returned_count, 40);
  assert.deepEqual(f1.query_applied, { pages: 3, sharedFromRun: 'L1', sharedCheckedAt: '2026-10-18T11:58:00Z' });
  assert.equal(runs.find((r) => r.id === 'F2').status, 'QUEUED', 'still shared with a live read');
  assert.equal(await cap.resolveSharedRuns(db, mine, NOW), 0, 'settles once');
});

test('a vanished or overdue leader closes its followers; a cancelled one hands over', async () => {
  const runs = [
    { id: 'L3', search_id: 'sX', status: 'QUEUED', deadline_at: '2026-10-18T11:59:00Z' },
    { id: 'L4', search_id: 'sY', status: 'FAILED', errors: [{ code: 'CANCELLED_BY_CUSTOMER' }], deadline_at: '2026-10-18T12:10:00Z' },
    { id: 'F3', status: 'QUEUED', shared_run_id: 'GONE' },
    { id: 'F4', status: 'QUEUED', shared_run_id: 'L3' },
    { id: 'F5', status: 'QUEUED', shared_run_id: 'L4' },
  ];
  const db = fakeDb({ discovery_marketplace_worker_runs: runs }, async () => ({ data: 1, error: null }));
  await cap.resolveSharedRuns(db, runs.filter((r) => r.id.startsWith('F')).map((r) => ({ ...r })), NOW);
  assert.equal(runs.find((r) => r.id === 'F3').errors[0].code, 'SHARED_RUN_GONE');
  assert.equal(runs.find((r) => r.id === 'F4').status, 'TIMED_OUT');
  assert.equal(runs.find((r) => r.id === 'F5').status, 'QUEUED', 'not failed with the cancelled leader');
  assert.deepEqual(db.calls.find((c) => c.rpc), { rpc: 'marketplace_hand_over_shared_runs', args: { p_search_id: 'sY' } });
});

test('shared listings are read in place; a fresh observation replaces a pool copy, once per listing', () => {
  const runs = [
    { id: 'F1', worker_id: 'myhome-agent', status: 'COMPLETE', shared_run_id: 'L1', returned_count: 2 },
    { id: 'F2', worker_id: 'ssge-agent', status: 'TIMED_OUT', shared_run_id: 'L2', returned_count: 0 },
    { id: 'R3', worker_id: 'homege-agent', status: 'COMPLETE', returned_count: 9 },
  ];
  assert.deepEqual([...cap.sharedLeaders(runs)], [['L1', 'myhome-agent']]);
  const row = (k, lvl, run = 'F1') => ({ source_key: 'myhome-ge', source_listing_id: k, worker_run_id: run, raw: { retrievalMetadata: lvl ? { observationLevel: lvl } : {} } });
  const merged = cap.mergeListingRows([row('1', 'CACHED'), row('2')], [row('1', null, 'L1'), row('2', null, 'L1'), row('3', null, 'L1')]);
  assert.deepEqual(merged.map((r) => `${r.source_listing_id}:${r.worker_run_id}`), ['1:L1', '2:F1', '3:L1']);
});

test('degraded dispatch: nothing goes live, every source answers from the pool, the customer is told', async () => {
  const db = fakeDb({});
  const out = await cap.dispatchSearch(db, { searchId: 's1', userId: 'u1', ip: '1.2.3.4', runs: [
    { workerId: 'myhome-agent', request: { a: 1 }, requestKey: 'k', deadlineAt: '2026-10-18T12:15:00Z' },
    { workerId: 'homege-agent', request: { a: 1 }, requestKey: 'k', deadlineAt: '2026-10-18T12:10:00Z' },
  ] }, NOW);
  assert.equal(out.degraded, true);
  assert.equal(out.live, 0);
  const ins = db.calls.find((c) => c.insert);
  assert.ok(ins.rows.every((r) => r.status === 'TIMED_OUT' && r.errors[0].code === 'LIVE_REFRESH_UNAVAILABLE' && r.completed_at), 'closed at once, never claimable');
  assert.deepEqual(cap.liveRefreshOf(out), { state: 'UNAVAILABLE' });
});

test('the notice: limited with the reason and time, busy with the earliest time, otherwise live', () => {
  const base = { tier: 'NORMAL', live: 0, degraded: false };
  assert.deepEqual(cap.liveRefreshOf({ ...base, limit: { reason: 'HOURLY', retryAt: 'T', maxActive: 3 }, runs: [{ workerId: 'a', mode: 'LIVE_REFRESH_LIMIT', retryAt: 'T' }, { workerId: 'b', mode: 'SHARED', retryAt: null }] }),
    { state: 'LIMITED', reason: 'HOURLY', retryAt: 'T', maxActive: 3 });
  assert.deepEqual(cap.liveRefreshOf({ ...base, limit: null, runs: [{ workerId: 'a', mode: 'SOURCE_BUSY', retryAt: '2026-10-18T12:30:00Z' }, { workerId: 'b', mode: 'SOURCE_BUSY', retryAt: '2026-10-18T12:20:00Z' }] }),
    { state: 'BUSY', retryAt: '2026-10-18T12:20:00Z' });
  assert.deepEqual(cap.liveRefreshOf({ ...base, limit: null, runs: [{ workerId: 'a', mode: 'SOURCE_BUSY', retryAt: 'x' }, { workerId: 'b', mode: 'REUSED', retryAt: null }] }), { state: 'LIVE' });
});

test('client IP is the first forwarded hop, bounded; absent stays absent', () => {
  assert.equal(cap.clientIp(new Request('https://x', { headers: { 'x-forwarded-for': ' 203.0.113.9 , 10.0.0.1' } })), '203.0.113.9');
  assert.equal(cap.clientIp(new Request('https://x')), null);
});

test('the limits the migration enforces are the approved ones', () => {
  const sql = readFileSync(new URL('../../../migrations/20261116090000_find_property_capacity.sql', import.meta.url), 'utf8');
  const { NORMAL: n, SUSPICIOUS: s, ipSoftPerHour } = cap.LIVE_SEARCH_LIMITS;
  assert.deepEqual([n.concurrent, n.perHour, n.perDay, s.concurrent, s.perHour, s.perDay, ipSoftPerHour], [3, 20, 100, 1, 5, 20, 60]);
  assert.match(sql, /v_tier := 'NORMAL'; v_max_active := 3; v_max_hour := 20; v_max_day := 100;/);
  assert.match(sql, /v_tier := 'SUSPICIOUS'; v_max_active := 1; v_max_hour := 5; v_max_day := 20;/);
  assert.match(sql, /c_ip_soft_hour constant integer := 60;/);
  assert.match(sql, /v_established := coalesce\(v_created <= now\(\) - interval '7 days', true\) or coalesce\(v_confirmed, false\);/, 'established accounts are never suspicious');
  assert.match(sql, /if v_live > 0 then\s+insert into public\.rate_limit_events/, 'only a search that went live counts');
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /wallet|usage_reservations|credit/i, 'free search: no money object in the code');
  for (const fn of ['marketplace_dispatch_search(uuid, uuid, text, jsonb)', 'marketplace_hand_over_shared_runs(uuid)', 'claim_marketplace_worker_runs(text, integer, integer)', 'marketplace_expected_run_seconds(text)', 'marketplace_portal_finish_seconds(text, uuid)']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn.replace(/[()]/g, '\\$&')} from public, anon, authenticated;`), fn);
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn.replace(/[()]/g, '\\$&')} to service_role;`), fn);
  }
});

test('start: counted only after readiness, duplicate and reuse checks; never refused; cancel hands over', () => {
  const fn = readFileSync(new URL('../../marketplace-search/index.ts', import.meta.url), 'utf8');
  const start = fn.slice(fn.indexOf("if (action === 'start')"), fn.indexOf("if (action === 'status')"));
  const at = (s) => { const i = start.indexOf(s); assert.ok(i > 0, s); return i; };
  const order = [
    "if (prior) return json({ search: await summary(db, prior), replayed: true });",
    "if (readiness.state !== 'READY') return json({ error: 'SEARCH_NOT_READY', readiness }, 422);",
    "if (twin) return json({ search: await summary(db, twin), replayed: true });",
    "if (recent) return json({ search: await summary(db, recent), replayed: true, reused: true });",
    'const outcome = await dispatchSearch(db, {',
  ].map(at);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'replay → readiness → open twin → recent reuse → dispatch');
  assert.doesNotMatch(start, /from\('discovery_marketplace_worker_runs'\)\.insert/, 'runs are created only by the dispatch transaction');
  assert.doesNotMatch(start, /429|RATE_LIMIT_EXCEEDED/, 'a start is never refused by the live quota');
  assert.match(start, /ip: clientIp\(req\)/);
  assert.match(start, /return json\(\{ search: await summary\(db, search\), liveRefresh \}, 202\);/);
  const cancel = fn.slice(fn.indexOf("if (action === 'cancel')"));
  assert.match(cancel, /db\.rpc\('marketplace_hand_over_shared_runs', \{ p_search_id: search\.id \}\)/);
  const shared = readFileSync(new URL('../marketplaceSearch.ts', import.meta.url), 'utf8');
  const proc = shared.slice(shared.indexOf('export async function processAndStore'));
  assert.ok(proc.indexOf('await resolveSharedRuns(') < proc.indexOf('await reapRuns('), 'shared runs settle before their own deadline reaps them');
  assert.match(proc, /mergeListingRows\(ownRows, await sharedListingRows\(db, \[\.\.\.leaders\.keys\(\)\]\)\)/);
  assert.match(shared, /\.eq\('status', 'QUEUED'\)\.is\('shared_run_id', null\)/, 'followers are never copied by shareRecentResults');
});

test('UI: every deferred code and the shared state have a line; the start notice is never silent', () => {
  const ui = readFileSync(new URL('../../../../src/components/findProperty/workspace/SourceStates.tsx', import.meta.url), 'utf8');
  assert.match(ui, /t\(`fpx_src_deferred_\$\{s\.deferred\}`\)/);
  assert.match(ui, /t\('fpx_src_shared'\)/);
  const tr = readFileSync(new URL('../../../../src/i18n/translations.ts', import.meta.url), 'utf8');
  for (const code of cap.DEFERRED_CODES) assert.equal(tr.split(`fpx_src_deferred_${code}:`).length - 1, 6, code);
  const exp = readFileSync(new URL('../../../../src/components/findProperty/MarketplaceSearchExperience.tsx', import.meta.url), 'utf8');
  for (const k of ['mps_live_limited_concurrent', 'mps_live_limited_until', 'mps_live_busy_until', 'mps_live_unavailable', 'mps_reused_recent']) assert.match(exp, new RegExp(`t\\('${k}'`), k);
});

test('CPU bound: the instant pool answer stops at its budget; owed sources are finished by status polls', async () => {
  const shared = readFileSync(new URL('../marketplaceSearch.ts', import.meta.url), 'utf8');
  const fn = shared.slice(shared.indexOf('export async function serveCachedListings'));
  assert.match(shared, /export const POOL_BUDGET_MS = 400;/);
  assert.ok(fn.indexOf('if (Date.now() - began >= budgetMs) break;') < fn.indexOf('processSearch('), 'checked before each source is ranked');
  assert.match(fn, /update\(\{ pool_pending: false \}\)\s*\.eq\('id', run\.id\)\.eq\('pool_pending', true\)/, 'claimed once across concurrent requests');
  assert.match(fn, /if \(pending\) await db\.from\('discovery_marketplace_worker_runs'\)\.update\(\{ pool_pending: true \}\)/, 'a failure leaves it owed');
  const ms = readFileSync(new URL('../../marketplace-search/index.ts', import.meta.url), 'utf8');
  const start = ms.slice(ms.indexOf("if (action === 'start')"), ms.indexOf("if (action === 'status')"));
  assert.doesNotMatch(start, /serveCachedListings\(/, 'start ranks the pool only through processAndStore (one bounded pass)');
  const status = ms.slice(ms.indexOf("if (action === 'status')"), ms.indexOf("if (action === 'browse')"));
  assert.match(status, /if \(overdue \|\| late \|\| poolOwed \|\| leaderDone\) \{/, 'a poll finishes owed pool answers and resolves shared runs whose leader ended');
  const sql = readFileSync(new URL('../../../migrations/20261116090000_find_property_capacity.sql', import.meta.url), 'utf8');
  assert.match(sql, /add column if not exists pool_pending boolean not null default false;/, 'existing runs keep their behaviour');
});
