// SUBSCRIPTIONS (20261207100000 / 100100) on a REAL PostgreSQL 17, against minimal stubs of their
// dependencies (stubs.sql). Local only: never production. Run: node tests/sql/saas/realdb.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
// pg comes from the local harness install (PG_HARNESS_DIR, default the sibling _pgreal folder).
const require = createRequire(`${process.env.PG_HARNESS_DIR ?? 'C:/Users/User/hm-wt/_pgreal'}/package.json`);
const pg = require('pg');

const CONN = { host: '127.0.0.1', port: Number(process.env.PG_PORT ?? 55432), user: 'postgres', password: process.env.PG_PASSWORD ?? 'local' };
const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const HERE = new URL('.', import.meta.url);
// Hardcoded developer machine default above is only a fallback; set PG_HARNESS_DIR elsewhere.
const MIGRATIONS = ['20261207100000_saas_subscriptions_core.sql', '20261207100100_saas_entitlement_wiring.sql'];

{ const a = new pg.Client({ ...CONN, database: 'postgres' }); await a.connect();
  await a.query('drop database if exists saas_real with (force)'); await a.query("create database saas_real encoding 'UTF8' template template0 lc_collate 'C' lc_ctype 'C'");
  // A TEST database: sandbox events may grant here (production never sets this).
  await a.query("alter database saas_real set homatch.saas_sandbox_grants = 'on'"); await a.end(); }
const pool = new pg.Pool({ ...CONN, database: 'saas_real', max: 10 });
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

async function mkUser({ verified = true, balance = 0, admin = false } = {}) {
  const auth = (await one('select gen_random_uuid() id')).id;
  await q('insert into auth.users values ($1, $2, null)', [auth, verified ? new Date() : null]);
  const u = await one('insert into public.users (auth_id, email, is_admin) values ($1, $2, $3) returning id', [auth, `${auth}@t.ge`, admin]);
  await q('insert into public.credit_accounts values ($1, $2, 0)', [u.id, balance]);
  return { id: u.id, auth };
}
const begin = async (u, f, k) => (await one('select public.saas_usage_begin($1, $2, $3) r', [u.id, f, k])).r;
const commit = async (u, f, k) => (await one('select public.saas_usage_commit($1, $2, $3) r', [u.id, f, k])).r;
const release = async (u, f, k) => (await one('select public.saas_usage_release($1, $2, $3) r', [u.id, f, k])).r;
async function pay(u, plan, { amount, eventId } = {}) {
  const co = (await one(`select public.saas_checkout_create($1, $2, 'SANDBOX') r`, [u.id, plan])).r;
  if (!co.ok) return { checkout: co };
  const ev = eventId ?? `ev_${co.checkoutId}`;
  const r = (await one(`select public.saas_payment_event_apply('SANDBOX', $1, 'PAYMENT_SUCCEEDED', $2, 'GEL', $3, null) r`,
    [ev, amount ?? co.amountTetri, co.checkoutId])).r;
  return { checkout: co, result: r, eventId: ev };
}
async function asUser(u, sql, params) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('test.uid', $1, true), set_config('test.role', 'authenticated', true)`, [u.auth]);
    const r = await c.query(sql, params); await c.query('commit'); return r.rows[0];
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}

/* 1. trials: once per account per feature, success-only */
{
  const a = await mkUser();
  let r = await begin(a, 'VERIFY', 'job-000001');
  assert.equal(r.funding, 'TRIAL');
  r = await begin(a, 'VERIFY', 'job-000002');
  assert.equal(r.ok, false); assert.equal(r.reason, 'SUBSCRIPTION_REQUIRED');
  await release(a, 'VERIFY', 'job-000001');
  assert.equal((await one(`select state from saas_trials where user_id=$1`, [a.id])).state, 'RELEASED');
  r = await begin(a, 'VERIFY', 'job-000002'); assert.equal(r.funding, 'TRIAL');
  r = await commit(a, 'VERIFY', 'job-000002'); assert.equal(r.ok, true);
  assert.equal((await one(`select state from saas_trials where user_id=$1`, [a.id])).state, 'CONSUMED');
  r = await commit(a, 'VERIFY', 'job-000002'); assert.equal(r.duplicate, true);
  r = await begin(a, 'VERIFY', 'job-000002'); assert.equal(r.duplicate, true);
  r = await begin(a, 'VERIFY', 'job-000003'); assert.equal(r.ok, false);
  r = await begin(a, 'VERIFY', 'job-000001'); assert.equal(r.ok, false, 'a released key cannot replay the consumed trial');
  assert.equal((await one(`select count(*)::int n from saas_subscription_events where user_id=$1 and event_type='TRIAL_USED'`, [a.id])).n, 1);
  r = await begin(a, 'CONTRACT_ANALYSIS', 'doc-000001'); assert.equal(r.funding, 'TRIAL', 'each feature has its own trial');
  ok('trial reserve / release / consume / replay');
}
/* 2. unverified account gets no trial */
{
  const c = await mkUser({ verified: false });
  const r = await begin(c, 'VERIFY', 'job-unv-01');
  assert.equal(r.ok, false); assert.equal(r.trialBlocked, 'ACCOUNT_NOT_VERIFIED');
  ok('unverified account: no trial');
}
/* 3. funding order: trial -> legacy credits */
{
  const b = await mkUser({ balance: 50 });
  assert.equal((await begin(b, 'VERIFY', 'job-leg-01')).funding, 'TRIAL');
  await commit(b, 'VERIFY', 'job-leg-01');
  const r = await begin(b, 'VERIFY', 'job-leg-02');
  assert.equal(r.funding, 'LEGACY_CREDITS'); assert.equal(r.fallbackReason, 'SUBSCRIPTION_REQUIRED');
  ok('trial first, then legacy balance');
}
/* 4. checkout + webhook: activation, replay, amount mismatch */
let d;
{
  d = await mkUser();
  const bad = await pay(d, 'STANDARD', { amount: 1 });
  assert.equal(bad.result.reason, 'AMOUNT_MISMATCH');
  assert.equal((await one(`select count(*)::int n from saas_subscriptions where user_id=$1`, [d.id])).n, 0);
  const p = await pay(d, 'STANDARD');
  assert.equal(p.checkout.amountTetri, 990); assert.equal(p.result.applied, 'PAYMENT_SUCCEEDED');
  const replay = (await one(`select public.saas_payment_event_apply('SANDBOX', $1, 'PAYMENT_SUCCEEDED', 990, 'GEL', $2, null) r`, [p.eventId, p.checkout.checkoutId])).r;
  assert.equal(replay.duplicate, true);
  const second = (await one(`select public.saas_payment_event_apply('SANDBOX', 'ev_other_x', 'PAYMENT_SUCCEEDED', 990, 'GEL', $1, null) r`, [p.checkout.checkoutId])).r;
  assert.equal(second.applied, 'ALREADY_PAID');
  assert.equal((await one(`select count(*)::int n from saas_subscriptions where user_id=$1`, [d.id])).n, 1);
  const again = (await one(`select public.saas_checkout_create($1, 'STANDARD', 'SANDBOX') r`, [d.id])).r;
  assert.equal(again.reason, 'ALREADY_ACTIVE');
  const down = (await one(`select public.saas_checkout_create($1, 'STANDARD', 'BOG') r`, [d.id])).r;
  assert.equal(down.reason, 'ALREADY_ACTIVE');
  assert.equal((await one(`select count(*)::int n from saas_subscription_events where user_id=$1 and event_type='ACTIVATED'`, [d.id])).n, 1);
  ok('activation, webhook replay, second event, amount mismatch');
}
/* 5. allowance: trial first, then 5 plan uses; concurrency cannot exceed */
{
  assert.equal((await begin(d, 'VERIFY', 'd-job-0000')).funding, 'TRIAL');
  await commit(d, 'VERIFY', 'd-job-0000');
  for (let i = 1; i <= 4; i++) assert.equal((await begin(d, 'VERIFY', `d-job-000${i}`)).funding, 'PLAN');
  const c1 = await pool.connect(); const c2 = await pool.connect();
  await c1.query('begin'); await c2.query('begin');
  const r1 = (await c1.query(`select public.saas_usage_begin($1, 'VERIFY', 'd-job-race-1') r`, [d.id])).rows[0].r;
  const p2 = c2.query(`select public.saas_usage_begin($1, 'VERIFY', 'd-job-race-2') r`, [d.id]);
  await new Promise((res) => setTimeout(res, 300));
  await c1.query('commit');
  const r2 = (await p2).rows[0].r; await c2.query('commit'); c1.release(); c2.release();
  assert.equal(r1.funding, 'PLAN'); assert.equal(r2.ok, false); assert.equal(r2.reason, 'ALLOWANCE_EXHAUSTED');
  assert.equal((await one(`select count(*)::int n from saas_usage where user_id=$1 and funding='PLAN' and state<>'RELEASED'`, [d.id])).n, 5);
  await release(d, 'VERIFY', 'd-job-0001');
  assert.equal((await begin(d, 'VERIFY', 'd-job-0009')).funding, 'PLAN', 'a released use returns its slot');
  const st = (await asUser(d, 'select public.entitlement_status_for_me() r')).r;
  const v = st.features.find((f) => f.feature === 'VERIFY');
  assert.equal(st.plan, 'STANDARD'); assert.equal(v.limit, 5); assert.equal(v.used, 5); assert.equal(v.remaining, 0);
  assert.equal(st.features.find((f) => f.feature === 'HOMI_UNLIMITED').unlimited, true);
  ok('allowance math, two concurrent reservations, release returns the slot, status for me');
}
/* 6. upgrade now: new period, allowances reset */
{
  const up = await pay(d, 'VIP');
  assert.equal(up.checkout.kind, 'UPGRADE'); assert.equal(up.result.planCode, 'VIP');
  const st = (await asUser(d, 'select public.entitlement_status_for_me() r')).r;
  const v = st.features.find((f) => f.feature === 'VERIFY');
  assert.equal(v.limit, 15); assert.equal(v.used, 0);
  ok('upgrade: immediate, period restarts, counters reset');
}
/* 7. downgrade at period end through a paid renewal; tick rolls the period */
{
  const r = (await asUser(d, `select public.saas_my_subscription_action('DOWNGRADE', 'STANDARD') r`)).r;
  assert.equal(r.ok, true);
  const early = (await one(`select public.saas_checkout_create($1, 'STANDARD', 'SANDBOX') r`, [d.id])).r;
  assert.equal(early.reason, 'ALREADY_ACTIVE', 'renewal only inside the window');
  await q(`update saas_subscriptions set current_period_end = now() + interval '1 day' where user_id=$1 and status='ACTIVE'`, [d.id]);
  const ren = await pay(d, 'STANDARD');
  assert.equal(ren.checkout.kind, 'RENEWAL');
  assert.equal((await one(`select next_period_paid from saas_subscriptions where user_id=$1 and status='ACTIVE'`, [d.id])).next_period_paid, true);
  await q(`update saas_subscriptions set current_period_start = now() - interval '31 days', current_period_end = now() - interval '1 minute' where user_id=$1 and status='ACTIVE'`, [d.id]);
  const t = (await one('select public.saas_subscription_tick() r')).r;
  assert.equal(t.renewed, 1); assert.equal(t.downgraded, 1);
  const s = await one(`select plan_code, status, next_period_paid, current_period_end > now() fresh from saas_subscriptions where user_id=$1 and status='ACTIVE'`, [d.id]);
  assert.equal(s.plan_code, 'STANDARD'); assert.equal(s.fresh, true); assert.equal(s.next_period_paid, false);
  ok('downgrade scheduled, renewal paid ahead, tick renews into the lower plan');
}
/* 8. unpaid period end -> PAST_DUE (grace) -> EXPIRED; cancel at period end */
{
  await q(`update saas_subscriptions set current_period_start = now() - interval '31 days', current_period_end = now() - interval '1 minute' where user_id=$1 and status='ACTIVE'`, [d.id]);
  let t = (await one('select public.saas_subscription_tick() r')).r; assert.equal(t.pastDue, 1);
  let s = await one(`select status, grace_until > now() + interval '2 days' g from saas_subscriptions where user_id=$1 order by created_at desc limit 1`, [d.id]);
  assert.equal(s.status, 'PAST_DUE'); assert.equal(s.g, true);
  assert.equal((await begin(d, 'CONTRACT_ANALYSIS', 'd-doc-000001')).funding, 'TRIAL');
  assert.equal((await begin(d, 'CONTRACT_ANALYSIS', 'd-doc-000002')).funding, 'PLAN', 'grace keeps access');
  const lapsed = await pay(d, 'STANDARD');
  assert.equal(lapsed.result.applied, 'PAYMENT_SUCCEEDED');
  s = await one(`select status from saas_subscriptions where user_id=$1 order by created_at desc limit 1`, [d.id]);
  assert.equal(s.status, 'ACTIVE');
  await q(`update saas_subscriptions set current_period_start = now() - interval '31 days', current_period_end = now() - interval '1 minute' where user_id=$1 and status='ACTIVE'`, [d.id]);
  await one('select public.saas_subscription_tick() r');
  await q(`update saas_subscriptions set grace_until = now() - interval '1 minute' where user_id=$1 and status='PAST_DUE'`, [d.id]);
  t = (await one('select public.saas_subscription_tick() r')).r; assert.equal(t.expired, 1);
  assert.equal((await begin(d, 'VERIFY', 'd-job-after')).reason, 'SUBSCRIPTION_REQUIRED');
  const e = await mkUser(); await pay(e, 'UNLIMITED');
  await asUser(e, `select public.saas_my_subscription_action('CANCEL') r`);
  for (let i = 0; i < 25; i++) assert.equal((await begin(e, 'VERIFY', `e-job-${String(i).padStart(4, '0')}`)).ok, true, 'unlimited');
  await q(`update saas_subscriptions set current_period_start = now() - interval '31 days', current_period_end = now() - interval '1 minute' where user_id=$1`, [e.id]);
  t = (await one('select public.saas_subscription_tick() r')).r; assert.equal(t.expired, 1);
  const n = await q('select * from public.saas_claim_notifications(100)');
  const types = new Set(n.map((x) => x.notify_type));
  for (const ty of ['SUBSCRIPTION_ACTIVATED', 'SUBSCRIPTION_RENEWED', 'SUBSCRIPTION_ENDED', 'TRIAL_USED', 'SUBSCRIPTION_PAYMENT_DUE']) assert.ok(types.has(ty), ty);
  assert.equal((await q('select * from public.saas_claim_notifications(100)')).length, 0, 'claimed once');
  ok('past due, grace, lapsed payment, expiry, cancel at period end, unlimited, notification outbox');
}
/* 9. payment failed; sweeper */
{
  const f = await mkUser();
  const co = (await one(`select public.saas_checkout_create($1, 'VIP', 'SANDBOX') r`, [f.id])).r;
  const r = (await one(`select public.saas_payment_event_apply('SANDBOX', 'ev_fail_1', 'PAYMENT_FAILED', 2900, 'GEL', $1, null, '{"reason":"DECLINED"}') r`, [co.checkoutId])).r;
  assert.equal(r.applied, 'PAYMENT_FAILED');
  assert.equal((await one(`select status from saas_checkouts where id=$1`, [co.checkoutId])).status, 'FAILED');
  assert.equal((await one(`select count(*)::int n from saas_subscriptions where user_id=$1`, [f.id])).n, 0);
  await begin(f, 'VERIFY', 'f-job-stale');
  await q(`update saas_usage set expires_at = now() - interval '1 minute' where user_id=$1`, [f.id]);
  assert.equal((await one('select public.saas_usage_sweep() n')).n, 1);
  assert.equal((await one(`select state from saas_trials where user_id=$1`, [f.id])).state, 'RELEASED');
  const late = await commit(f, 'VERIFY', 'f-job-stale');
  assert.equal(late.ok, true, 'delivered after expiry still counts');
  ok('payment failed, sweeper, late delivery');
}
/* 10. Verify wrapper */
{
  const g = await mkUser();
  const job = (await one('insert into research_jobs (user_id) values ($1) returning id', [g.auth])).id;
  let r = (await one(`select public.verify_billing_open($1, $2, 'verify:x:s1') r`, [job, g.auth])).r;
  assert.equal(r.funding, 'TRIAL'); assert.equal(r.priceCredits, 0);
  r = (await one(`select public.verify_billing_close($1, 'STOPPED') r`, [job])).r; assert.equal(r.funding, 'TRIAL');
  r = (await one(`select public.verify_billing_open($1, $2, 'verify:x:s2') r`, [job, g.auth])).r; assert.equal(r.funding, 'TRIAL');
  r = (await one(`select public.verify_billing_close($1, 'COMPLETE') r`, [job])).r; assert.equal(r.usage.ok, true);
  const job2 = (await one('insert into research_jobs (user_id) values ($1) returning id', [g.auth])).id;
  r = (await one(`select public.verify_billing_open($1, $2, 'verify:y:s1') r`, [job2, g.auth])).r;
  assert.equal(r.ok, false); assert.equal(r.reason, 'SUBSCRIPTION_REQUIRED');
  await q('update credit_accounts set balance = 5 where user_id=$1', [g.id]);
  r = (await one(`select public.verify_billing_open($1, $2, 'verify:y:s1') r`, [job2, g.auth])).r;
  assert.equal(r.reason, 'SUBSCRIPTION_REQUIRED', 'too few legacy credits -> subscribe prompt'); assert.equal(r.legacyReason, 'INSUFFICIENT_CREDITS');
  await q('update credit_accounts set balance = 50 where user_id=$1', [g.id]);
  r = (await one(`select public.verify_billing_open($1, $2, 'verify:y:s1') r`, [job2, g.auth])).r;
  assert.equal(r.funding, 'LEGACY_CREDITS'); assert.equal(r.priceCredits, 19);
  r = (await one(`select public.verify_billing_close($1, 'COMPLETE') r`, [job2])).r; assert.equal(r.wallet, true);
  const lq = (await asUser(g, 'select public.verify_launch_quote() r')).r;
  assert.equal(lq.entitlement.funding, 'LEGACY_CREDITS');
  ok('Verify: trial, stop and resume, refusal, legacy wallet path');
}
/* 11. internal lead unlock */
{
  const h = await mkUser(); await pay(h, 'STANDARD');
  const ids = ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'];
  let r = (await one(`select public.internal_leads_unlock($1, $2::uuid[], 'ilu:abcdef01') r`, [h.id, ids])).r;
  assert.equal(r.chargedCredits, 0); assert.equal(r.freeForSubscriber, true); assert.equal(r.unlocked.length, 2);
  const quote = (await one(`select public.internal_leads_unlock_quote_for($1, $2::uuid[]) r`, [h.id, ids])).r;
  assert.equal(quote.totalCredits, 0); assert.equal(quote.freeForSubscriber, true);
  const k = await mkUser();
  await assert.rejects(q(`select public.internal_leads_unlock($1, $2::uuid[], 'ilu:abcdef02')`, [k.id, ids]), /SUBSCRIPTION_REQUIRED/);
  await q('update credit_accounts set balance = 10 where user_id=$1', [k.id]);
  r = (await one(`select public.internal_leads_unlock($1, $2::uuid[], 'ilu:abcdef03') r`, [k.id, ids])).r;
  assert.equal(r.chargedCredits, 6);
  assert.equal(Number((await one('select balance from credit_accounts where user_id=$1', [k.id])).balance), 4);
  ok('unlock free for subscribers, refused without plan or credits, priced for credit holders');
}
/* 12. admin RPCs are admin-only and audited */
{
  const plain = await mkUser(); const admin = await mkUser({ admin: true });
  await assert.rejects(asUser(plain, `select public.admin_saas_set_entitlement('VIP', 'VERIFY', true, 20, false, 'test raise')`), /FORBIDDEN/);
  await asUser(admin, `select public.admin_saas_set_entitlement('VIP', 'VERIFY', true, 20, false, 'owner asked')`);
  await asUser(admin, `select public.admin_saas_set_plan('VIP', 3100, null, null, 'price test')`);
  await assert.rejects(asUser(admin, `select public.admin_saas_set_plan('VIP', 3100, null, null, '')`), /REASON_REQUIRED/);
  const a = await one(`select count(*)::int n from admin_audit_log where action in ('SAAS_ENTITLEMENT_UPDATED','SAAS_PLAN_UPDATED') and admin_id=$1`, [admin.id]);
  assert.equal(a.n, 2);
  const audit = await one(`select metadata from admin_audit_log where action='SAAS_PLAN_UPDATED'`);
  assert.equal(audit.metadata.old.price_gel_tetri, 2900); assert.equal(audit.metadata.new.price_gel_tetri, 3100);
  const g = await asUser(admin, `select public.admin_saas_support('GRANT', $1, 'VIP', 30, 'support case 1') r`, [plain.id]);
  assert.equal(g.r.plan_code, 'VIP');
  const plans = (await one('select public.saas_public_plans() r')).r;
  assert.equal(plans.plans.length, 3); assert.equal(plans.plans[1].priceTetri, 3100);
  ok('admin RPCs: forbidden for customers, reason required, audit old/new, support grant');
}
/* 12b. owner rule: without the database-level test switch a SANDBOX event grants nothing */
{
  const z = await mkUser();
  const co = (await one(`select public.saas_checkout_create($1, 'VIP', 'SANDBOX') r`, [z.id])).r;
  const c = await pool.connect();
  try {
    await c.query(`set homatch.saas_sandbox_grants = 'off'`);
    const r = (await c.query(`select public.saas_payment_event_apply('SANDBOX', 'ev_prod_1', 'PAYMENT_SUCCEEDED', $2, 'GEL', $1, null) r`, [co.checkoutId, co.amountTetri])).rows[0].r;
    assert.equal(r.applied, 'SANDBOX_RECORDED_NO_ACCESS', JSON.stringify(r) + JSON.stringify(co));
    await c.query('reset homatch.saas_sandbox_grants');
  } finally { c.release(); }
  assert.equal((await one(`select count(*)::int n from saas_subscriptions where user_id=$1`, [z.id])).n, 0);
  const row = await one(`select status, is_test from saas_checkouts where id=$1`, [co.checkoutId]);
  assert.equal(row.status, 'SANDBOX_NO_GRANT'); assert.equal(row.is_test, true);
  assert.equal((await one(`select is_test from saas_payment_events where event_id='ev_prod_1'`)).is_test, true);
  ok('sandbox events never grant without the database test switch; rows labelled is_test');
}
/* 12c. a bank: callback by payment id, saved card only with consent, recurring and reconciliation queues */
{
  const y = await mkUser();
  const co = (await one(`select public.saas_checkout_create($1, 'STANDARD', 'TBC', true) r`, [y.id])).r;
  await q(`select public.saas_checkout_attach($1, 'tbcpay_000123', 'https://ecom.example/pay')`, [co.checkoutId]);
  await q(`update saas_checkouts set updated_at = now() - interval '5 minutes' where id=$1`, [co.checkoutId]);
  assert.equal((await q('select * from public.saas_pending_checkouts(10)')).filter((r) => r.id === co.checkoutId).length, 1);
  const r = (await one(`select public.saas_payment_event_apply('TBC', 'tbcpay_000123:Succeeded', 'PAYMENT_SUCCEEDED', 990, 'GEL', 'tbcpay_000123', 'rec_abc') r`)).r;
  assert.equal(r.applied, 'PAYMENT_SUCCEEDED');
  let s = await one(`select recurring, provider_subscription_ref from saas_subscriptions where user_id=$1`, [y.id]);
  assert.equal(s.recurring, true); assert.equal(s.provider_subscription_ref, 'rec_abc');
  assert.equal((await q('select * from public.saas_pending_checkouts(10)')).filter((x) => x.id === co.checkoutId).length, 0);
  await q(`update saas_subscriptions set current_period_end = now() + interval '2 hours' where user_id=$1`, [y.id]);
  const due = (await q('select * from public.saas_recurring_due(10)')).filter((x) => x.user_id === y.id);
  assert.equal(due.length, 1); assert.equal(due[0].provider_subscription_ref, 'rec_abc');
  const ren = (await one(`select public.saas_checkout_create($1, 'STANDARD', 'TBC') r`, [y.id])).r;
  assert.equal(ren.kind, 'RENEWAL');
  assert.equal((await q('select * from public.saas_recurring_due(10)')).filter((x) => x.user_id === y.id).length, 0, 'one attempt per period');
  const x = await mkUser();
  const co2 = (await one(`select public.saas_checkout_create($1, 'STANDARD', 'BOG', false) r`, [x.id])).r;
  await one(`select public.saas_payment_event_apply('BOG', 'bog_1:completed', 'PAYMENT_SUCCEEDED', 990, 'GEL', $1, 'bog_1') r`, [co2.checkoutId]);
  s = await one(`select recurring, provider_subscription_ref from saas_subscriptions where user_id=$1`, [x.id]);
  assert.equal(s.recurring, false, 'no consent, no saved card'); assert.equal(s.provider_subscription_ref, null);
  ok('bank callbacks by payment id, consented saved card, recurring due once, reconciliation queue');
}
/* 13. period arithmetic in Tbilisi */
{
  const r = await one(`select public.saas_period_end('2027-01-31T10:00:00+04') e`);
  assert.equal(new Date(r.e).toISOString(), '2027-02-28T06:00:00.000Z');
  ok('calendar month in Asia/Tbilisi');
}
console.log(`\n${passed} groups passed`);
await pool.end();
