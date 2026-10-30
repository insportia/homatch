// VERIFY SETTLEMENT PER FUNDING (trial, plan, owner, access grant) on a REAL PostgreSQL 17, on top of the
// subscription and access migrations and the same stubs as realdb.mjs. Local only: never production.
// What research-agent's settlement sweep relies on since it also closes saas_usage-funded jobs
// (2026-10-30): verify_billing_close commits once, releases on a system failure, is idempotent,
// and a late delivery after the 48h expiry still commits — for every funding source.
// The legacy wallet path is the real SQL in tests/sql/run-verify-billing-node.mjs (stubbed here).
// Run: node tests/sql/saas/verifySettlement.realdb.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(`${process.env.PG_HARNESS_DIR ?? 'C:/Users/User/hm-wt/_pgreal'}/package.json`);
const pg = require('pg');

const CONN = { host: '127.0.0.1', port: Number(process.env.PG_PORT ?? 55432), user: 'postgres', password: process.env.PG_PASSWORD ?? 'local' };
const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const HERE = new URL('.', import.meta.url);
const DB = 'verify_settlement_real';
const MIGRATIONS = ['20261207100000_saas_subscriptions_core.sql', '20261207100100_saas_entitlement_wiring.sql',
  '20261208110000_owner_access_grants_core.sql', '20261208110100_owner_access_grants_admin.sql'];

{ const a = new pg.Client({ ...CONN, database: 'postgres' }); await a.connect();
  await a.query(`drop database if exists ${DB} with (force)`);
  await a.query(`create database ${DB} encoding 'UTF8' template template0 lc_collate 'C' lc_ctype 'C'`);
  await a.query(`alter database ${DB} set homatch.saas_sandbox_grants = 'on'`); await a.end(); }
const pool = new pg.Pool({ ...CONN, database: DB, max: 10 });
const q = async (sql, p) => (await pool.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];

await q(fs.readFileSync(new URL('stubs.sql', HERE), 'utf8'));
for (const m of MIGRATIONS) {
  const c = await pool.connect();
  try { await c.query('begin'); await c.query(fs.readFileSync(`${REPO}/supabase/migrations/${m}`, 'utf8')); await c.query('commit'); }
  catch (e) { await c.query('rollback'); throw new Error(`${m}: ${e.message}`); } finally { c.release(); }
}
console.log('migrations applied');

let passed = 0;
const ok = (name) => { passed++; console.log('  ok', name); };

async function mkUser({ admin = false } = {}) {
  const auth = (await one('select gen_random_uuid() id')).id;
  await q('insert into auth.users values ($1, $2, null)', [auth, new Date()]);
  const u = await one('insert into public.users (auth_id, email, is_admin) values ($1, $2, $3) returning id', [auth, `${auth}@t.ge`, admin]);
  await q('insert into public.credit_accounts values ($1, 0, 0)', [u.id]);
  return { id: u.id, auth };
}
async function asUser(u, sql, params) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('test.uid', $1, true), set_config('test.role', 'authenticated', true)`, [u.auth]);
    const r = await c.query(sql, params); await c.query('commit'); return r.rows[0];
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
async function pay(u, plan) {
  const co = (await one(`select public.saas_checkout_create($1, $2, 'SANDBOX') r`, [u.id, plan])).r;
  return (await one(`select public.saas_payment_event_apply('SANDBOX', $1, 'PAYMENT_SUCCEEDED', $2, 'GEL', $3, null) r`,
    [`ev_${co.checkoutId}`, co.amountTetri, co.checkoutId])).r;
}
const job = async (u) => (await one('insert into research_jobs (user_id) values ($1) returning id', [u.auth])).id;
const open = async (u, j) => (await one(`select public.verify_billing_open($1, $2, $3) r`, [j, u.auth, `verify:${j}:s1`])).r;
const close = async (j, outcome) => (await one(`select public.verify_billing_close($1, $2) r`, [j, outcome])).r;
const usage = async (j) => one(`select funding, state, release_reason, committed_at, over_allowance from saas_usage where idempotency_key = $1`, [`verify:${j}`]);
const usageRows = async (j) => Number((await one(`select count(*)::int n from saas_usage where idempotency_key = $1`, [`verify:${j}`])).n);
const trialState = async (u) => (await one(`select state from saas_trials where user_id = $1 and feature = 'VERIFY'`, [u.id]))?.state ?? null;
// Wallet movement: any change to any account's balance or reservation (the stubs' wallet).
const walletCalls = async () => (await one(`select coalesce(sum(balance), 0)::text || '/' || coalesce(sum(reserved), 0)::text s from credit_accounts`)).s;

/* 1. TRIAL: delivered → committed once; the trial is consumed; a second close changes nothing */
{
  const u = await mkUser();
  const j = await job(u);
  const o = await open(u, j);
  assert.equal(o.funding, 'TRIAL'); assert.equal(o.priceCredits, 0, 'a trial charges nothing');
  assert.equal((await usage(j)).state, 'RESERVED');
  const ledger = await walletCalls();
  const c1 = await close(j, 'COMPLETE');
  assert.equal(c1.funding, 'TRIAL'); assert.equal(c1.charged, 0); assert.equal(c1.usage.ok, true); assert.equal(c1.usage.duplicate, false);
  assert.equal((await usage(j)).state, 'COMMITTED');
  assert.equal(await trialState(u), 'CONSUMED');
  const c2 = await close(j, 'COMPLETE');
  assert.equal((await usage(j)).state, 'COMMITTED'); assert.equal(await usageRows(j), 1);
  assert.equal(await walletCalls(), ledger, 'no wallet movement for a trial, ever');
  assert.notEqual(c2.usage?.duplicate === false && c2.billing === false, true, 'the second close does not commit again');
  // The trial is gone: the next Verify is not free.
  const j2 = await job(u);
  const o2 = await open(u, j2);
  assert.notEqual(o2.funding, 'TRIAL', 'a consumed trial is never offered again');
  ok('TRIAL: delivered → committed once and the trial consumed; a repeated close changes nothing');
}

/* 2. TRIAL: the system failed → released, the trial is offered again; releasing twice is harmless */
{
  const u = await mkUser();
  const j = await job(u);
  assert.equal((await open(u, j)).funding, 'TRIAL');
  await close(j, 'SYSTEM_FAILED');
  assert.deepEqual([(await usage(j)).state, (await usage(j)).release_reason], ['RELEASED', 'SYSTEM_FAILED']);
  assert.equal(await trialState(u), 'RELEASED');
  await close(j, 'SYSTEM_FAILED');
  assert.equal((await usage(j)).state, 'RELEASED');
  assert.equal((await open(u, await job(u))).funding, 'TRIAL', 'the customer keeps their free try');
  ok('TRIAL: a system failure releases it and the trial stays available; a repeated release is harmless');
}

/* 3. TRIAL: delivered after the 48h reservation expired → the late delivery still commits, and the sweeper never undoes it */
{
  const u = await mkUser();
  const j = await job(u);
  await open(u, j);
  await q(`update saas_usage set expires_at = now() - interval '1 minute' where idempotency_key = $1`, [`verify:${j}`]);
  assert.ok(Number((await one('select public.saas_usage_sweep() n')).n) >= 1);
  assert.deepEqual([(await usage(j)).state, (await usage(j)).release_reason], ['RELEASED', 'EXPIRED']);
  await close(j, 'COMPLETE');
  assert.equal((await usage(j)).state, 'COMMITTED', 'the report the customer received counts');
  assert.equal(await trialState(u), 'CONSUMED');
  await one('select public.saas_usage_sweep() n');
  assert.equal((await usage(j)).state, 'COMMITTED');
  ok('TRIAL: delivered after the reservation expired still commits; a later sweep leaves it committed');
}

/* 4. PLAN: delivered → one allowance used, exactly once; a system failure returns its slot */
{
  const u = await mkUser();
  await pay(u, 'STANDARD');
  const t = await job(u); await open(u, t); await close(t, 'COMPLETE'); // the trial goes first
  const used = async () => Number((await one(`select count(*)::int n from saas_usage where user_id = $1 and feature = 'VERIFY' and funding = 'PLAN' and state = 'COMMITTED'`, [u.id])).n);
  const j = await job(u);
  const o = await open(u, j);
  assert.equal(o.funding, 'PLAN'); assert.equal(o.priceCredits, 0);
  await close(j, 'COMPLETE'); await close(j, 'COMPLETE');
  assert.equal(await used(), 1, 'one delivered report, one allowance');
  const f = await job(u);
  assert.equal((await open(u, f)).funding, 'PLAN');
  await close(f, 'SYSTEM_FAILED');
  assert.equal((await usage(f)).state, 'RELEASED');
  const status = (await asUser(u, 'select public.entitlement_status_for_me() r')).r;
  const v = status.features.find((x) => x.feature === 'VERIFY');
  assert.equal(v.used, 1, 'the failed report does not count against the plan');
  ok('PLAN: one delivered report uses one allowance once; a failed one gives its slot back');
}

/* 5. OWNER (Unlimited): included, committed as OWNER, never a trial, plan or wallet movement; idempotent */
{
  const owner = await mkUser({ admin: true });
  await q(`insert into public.platform_owner (user_id, designated_by) values ($1, 'test')`, [owner.id]);
  const ledger = await walletCalls();
  const j = await job(owner);
  const o = await open(owner, j);
  assert.equal(o.funding, 'OWNER'); assert.equal(o.priceMode, 'INCLUDED'); assert.equal(o.priceCredits, 0);
  await close(j, 'COMPLETE'); await close(j, 'COMPLETE');
  assert.deepEqual([(await usage(j)).funding, (await usage(j)).state], ['OWNER', 'COMMITTED']);
  assert.equal(await trialState(owner), null, 'the owner never spends a trial');
  assert.equal(await walletCalls(), ledger);
  const f = await job(owner); await open(owner, f); await close(f, 'SYSTEM_FAILED');
  assert.equal((await usage(f)).state, 'RELEASED');
  assert.equal((await open(owner, await job(owner))).funding, 'OWNER', 'still unlimited afterwards');
  ok('OWNER: included and committed once, no trial, plan or wallet touched; still Unlimited after a failure');
}

/* 6. GRANT (Admin access grant, limited): delivered counts against the grant once; a failure returns it */
{
  const admin = await mkUser({ admin: true });
  await q(`insert into public.platform_owner (user_id, designated_by) select $1, 'test' where not exists (select 1 from public.platform_owner)`, [admin.id]);
  const owner = (await one('select user_id from public.platform_owner')).user_id;
  const actor = owner === admin.id ? admin : { id: owner, auth: (await one('select auth_id from users where id = $1', [owner])).auth_id };
  const u = await mkUser();
  const g = (await asUser(actor, `select public.admin_access_grant($1, 'CUSTOM', null, $2::jsonb, null, 'pilot customer') r`,
    [u.id, JSON.stringify([{ feature: 'VERIFY', limit: 2, period: 'TOTAL' }])])).r;
  const j = await job(u);
  assert.equal((await open(u, j)).funding, 'GRANT');
  await close(j, 'COMPLETE'); await close(j, 'COMPLETE');
  const f = await job(u); await open(u, f); await close(f, 'SYSTEM_FAILED');
  const gj = (await one('select public.saas_access_grant_json($1) r', [g.id])).r;
  assert.equal(gj.allowances.find((a) => a.feature === 'VERIFY').used, 1, 'one delivered, one failed: one counted');
  ok('GRANT: a delivered report counts once against the grant; a failed one does not');
}

/* 7. Settlement only ever touches the reservation of THIS job (the sweep passes job ids) */
{
  const a = await mkUser(); const b = await mkUser();
  const ja = await job(a); const jb = await job(b);
  await open(a, ja); await open(b, jb);
  await close(ja, 'COMPLETE');
  assert.equal((await usage(jb)).state, 'RESERVED', 'another customer\'s open job is untouched');
  assert.equal(await trialState(b), 'RESERVED');
  ok('closing one job never settles another customer\'s reservation');
}

await pool.end();
console.log(`\n${passed} passed`);
