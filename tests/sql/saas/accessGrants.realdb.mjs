// OWNER UNLIMITED + ADMIN ACCESS GRANTS (20261208110000 / 110100) on a REAL PostgreSQL 17, on top of
// the subscription migrations and the same stubs as realdb.mjs. Local only: never production.
// Run: node tests/sql/saas/accessGrants.realdb.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(`${process.env.PG_HARNESS_DIR ?? 'C:/Users/User/hm-wt/_pgreal'}/package.json`);
const pg = require('pg');

const CONN = { host: '127.0.0.1', port: Number(process.env.PG_PORT ?? 55432), user: 'postgres', password: process.env.PG_PASSWORD ?? 'local' };
const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const HERE = new URL('.', import.meta.url);
const MIGRATIONS = ['20261207100000_saas_subscriptions_core.sql', '20261207100100_saas_entitlement_wiring.sql',
  '20261208110000_owner_access_grants_core.sql', '20261208110100_owner_access_grants_admin.sql'];

{ const a = new pg.Client({ ...CONN, database: 'postgres' }); await a.connect();
  await a.query('drop database if exists access_real with (force)');
  await a.query("create database access_real encoding 'UTF8' template template0 lc_collate 'C' lc_ctype 'C'");
  await a.query("alter database access_real set homatch.saas_sandbox_grants = 'on'"); await a.end(); }
const pool = new pg.Pool({ ...CONN, database: 'access_real', max: 10 });
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
const balance = async (u) => Number((await one('select balance from credit_accounts where user_id=$1', [u.id])).balance);
async function asUser(u, sql, params) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('test.uid', $1, true), set_config('test.role', 'authenticated', true)`, [u.auth]);
    const r = await c.query(sql, params); await c.query('commit'); return r.rows[0];
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
const statusOf = async (u) => (await asUser(u, 'select public.entitlement_status_for_me() r')).r;
const feat = (st, f) => st.features.find((x) => x.feature === f);
const grant = (actor, target, kind, plan, allowances, expires, reason = 'support case') =>
  asUser(actor, 'select public.admin_access_grant($1, $2, $3, $4::jsonb, $5, $6) r',
    [target.id, kind, plan, allowances == null ? null : JSON.stringify(allowances), expires, reason]).then((x) => x.r);
async function pay(u, plan) {
  const co = (await one(`select public.saas_checkout_create($1, $2, 'SANDBOX') r`, [u.id, plan])).r;
  return (await one(`select public.saas_payment_event_apply('SANDBOX', $1, 'PAYMENT_SUCCEEDED', $2, 'GEL', $3, null) r`,
    [`ev_${co.checkoutId}`, co.amountTetri, co.checkoutId])).r;
}

/* 0. the seed is a no-op where the production owner row does not exist */
{
  assert.equal((await one('select count(*)::int n from platform_owner')).n, 0);
  ok('owner seed is a no-op on a database without the production owner row');
}

const owner = await mkUser({ admin: true, balance: 50 });
await q(`insert into platform_owner (user_id, designated_by) values ($1, 'TEST')`, [owner.id]);

/* 1. owner: unlimited, consumes nothing, real pipeline functions */
{
  for (let i = 0; i < 20; i++) {
    const r = await begin(owner, 'VERIFY', `own-job-${String(i).padStart(4, '0')}`);
    assert.equal(r.funding, 'OWNER'); assert.equal(r.unlimited, true);
    assert.equal((await commit(owner, 'VERIFY', `own-job-${String(i).padStart(4, '0')}`)).ok, true);
  }
  assert.equal((await begin(owner, 'CONTRACT_ANALYSIS', 'own-doc-0001')).funding, 'OWNER');
  assert.equal((await one('select count(*)::int n from saas_trials where user_id=$1', [owner.id])).n, 0, 'no trial touched');
  assert.equal((await one(`select count(*)::int n from saas_usage where user_id=$1 and funding<>'OWNER'`, [owner.id])).n, 0);
  assert.equal(await balance(owner), 50, 'legacy credits untouched');
  // Verify wrapper: included, no wallet session.
  const job = (await one('insert into research_jobs (user_id) values ($1) returning id', [owner.auth])).id;
  let r = (await one(`select public.verify_billing_open($1, $2, 'verify:own:s1') r`, [job, owner.auth])).r;
  assert.equal(r.funding, 'OWNER'); assert.equal(r.priceMode, 'INCLUDED'); assert.equal(r.priceCredits, 0);
  r = (await one(`select public.verify_billing_close($1, 'COMPLETE') r`, [job])).r; assert.equal(r.usage.ok, true);
  assert.equal((await one('select count(*)::int n from verify_billing where job_id=$1', [job])).n, 0);
  const lq = (await asUser(owner, 'select public.verify_launch_quote() r')).r;
  assert.equal(lq.entitlement.funding, 'OWNER');
  assert.equal((await asUser(owner, 'select public.contract_analysis_entitlement_for_me() r')).r.funding, 'OWNER');
  // Internal lead unlock: free, no wallet call.
  const ids = ['11111111-1111-1111-1111-111111111111'];
  r = (await one(`select public.internal_leads_unlock($1, $2::uuid[], 'ilu:owner001') r`, [owner.id, ids])).r;
  assert.equal(r.chargedCredits, 0); assert.equal(r.freeForSubscriber, true);
  assert.equal(await balance(owner), 50);
  for (const f of ['HOMI_UNLIMITED', 'INTERNAL_SEARCH', 'INTERNAL_MATCHING', 'INTERNAL_UNLOCK_FREE']) {
    assert.equal((await one('select public.saas_user_has_feature($1, $2) r', [owner.id, f])).r, true, f);
  }
  // Premium discovery is not an included internal service.
  assert.notEqual((await one(`select public.saas_access_resolve($1, 'PREMIUM_DISCOVERY') r`, [owner.id])).r.funding, 'OWNER');
  const st = await statusOf(owner);
  assert.equal(st.access.owner, true); assert.equal(st.access.unlimited, true); assert.equal(st.access.source, 'OWNER');
  const v = feat(st, 'VERIFY');
  assert.equal(v.source, 'OWNER'); assert.equal(v.unlimited, true); assert.equal(v.limit, null); assert.equal(v.remaining, null);
  assert.equal(v.used, 21, 'real count of this month, not a made-up number');
  ok('owner: unlimited Verify / contract / unlock / HOMI, no trial, no allowance, no credits, recorded as OWNER');
}
/* 2. owner across period ends: a subscription lapsing changes nothing */
{
  await pay(owner, 'STANDARD');
  await q(`update saas_subscriptions set current_period_start = now() - interval '31 days', current_period_end = now() - interval '1 minute' where user_id=$1`, [owner.id]);
  await one('select public.saas_subscription_tick() r');
  await q(`update saas_subscriptions set grace_until = now() - interval '1 minute' where user_id=$1 and status='PAST_DUE'`, [owner.id]);
  await one('select public.saas_subscription_tick() r');
  assert.equal((await one(`select status from saas_subscriptions where user_id=$1`, [owner.id])).status, 'EXPIRED');
  assert.equal((await begin(owner, 'VERIFY', 'own-after-expiry')).funding, 'OWNER');
  assert.equal((await one(`select count(*)::int n from saas_usage where user_id=$1 and funding='PLAN'`, [owner.id])).n, 0);
  ok('owner: unaffected by a subscription period ending, past due or expiring');
}
/* 3. owner is protected */
{
  await assert.rejects(q('delete from platform_owner'), /OWNER_PROTECTED/);
  await assert.rejects(q('update platform_owner set note = $1', ['x']), /OWNER_PROTECTED/);
  await assert.rejects(q('truncate platform_owner'), /OWNER_PROTECTED/);
  const other = await mkUser({ admin: true });
  await assert.rejects(q(`insert into platform_owner (user_id, designated_by) values ($1, 'TEST')`, [other.id]), /duplicate key|unique/);
  await assert.rejects(grant(other, owner, 'CUSTOM', null, [{ feature: 'VERIFY', limit: 1 }], null), /OWNER_PROTECTED|FORBIDDEN_SELF/);
  await assert.rejects(asUser(owner, `select public.admin_access_users(null, 5)`).then(() => grant(owner, owner, 'UNLIMITED', null, null, null)), /FORBIDDEN_SELF/);
  assert.equal((await one('select count(*)::int n from platform_owner where user_id=$1', [owner.id])).n, 1);
  ok('owner: cannot be deleted, changed, truncated, replaced, granted or self-granted');
}
/* 4. another admin is NOT unlimited */
{
  const adm = await mkUser({ admin: true });
  assert.equal((await begin(adm, 'VERIFY', 'adm-job-0001')).funding, 'TRIAL');
  assert.equal((await begin(adm, 'VERIFY', 'adm-job-0002')).ok, false);
  const st = await statusOf(adm);
  assert.equal(st.access.owner, false); assert.equal(st.access.unlimited, false);
  ok('a non-owner admin is an ordinary customer for entitlements');
}
/* 5. manual Unlimited grant: GRANT funding, nothing else consumed; expiry ends it */
let cust;
{
  cust = await mkUser({ balance: 30 });
  const g = await grant(owner, cust, 'UNLIMITED', null, null, new Date(Date.now() + 7 * 86400e3).toISOString(), 'press demo');
  assert.equal(g.kind, 'UNLIMITED'); assert.equal(g.permanent, false);
  for (let i = 0; i < 8; i++) {
    const r = await begin(cust, 'VERIFY', `cu-job-${String(i).padStart(4, '0')}`);
    assert.equal(r.funding, 'GRANT'); assert.equal(r.grantId, g.id);
    await commit(cust, 'VERIFY', `cu-job-${String(i).padStart(4, '0')}`);
  }
  assert.equal((await one('select count(*)::int n from saas_trials where user_id=$1', [cust.id])).n, 0, 'trial untouched');
  assert.equal(await balance(cust), 30);
  const st = await statusOf(cust);
  assert.equal(st.access.unlimited, true); assert.equal(st.access.source, 'GRANT'); assert.equal(st.access.owner, false);
  assert.equal(st.access.grants[0].kind, 'UNLIMITED'); assert.equal(feat(st, 'VERIFY').source, 'GRANT');
  assert.equal(st.subscription, null, 'a manual grant is never a paid subscription row');
  const ev = await one(`select actor_id, action, reason, expires_at from saas_access_events where target_user_id=$1`, [cust.id]);
  assert.equal(ev.actor_id, owner.id); assert.equal(ev.action, 'GRANTED'); assert.equal(ev.reason, 'press demo'); assert.ok(ev.expires_at);
  const au = await one(`select admin_id, target_id, metadata from admin_audit_log where action='SAAS_ACCESS_GRANTED' and target_id=$1`, [cust.id]);
  assert.equal(au.admin_id, owner.id); assert.equal(au.metadata.new.kind, 'UNLIMITED'); assert.equal(au.metadata.reason, 'press demo');
  // Expiry: the grant stops counting by itself; the account falls back to its own trial.
  await q(`update saas_access_grants set starts_at = now() - interval '8 days', expires_at = now() - interval '1 minute' where id=$1`, [g.id]);
  assert.equal((await begin(cust, 'VERIFY', 'cu-job-after')).funding, 'TRIAL');
  assert.equal((await statusOf(cust)).access.unlimited, false);
  ok('Unlimited grant: GRANT funding, no trial / credits used, audited, expires on its own');
}
/* 6. custom 3 Verify: 3 successes consume 3, failures consume none, the 4th is refused */
{
  const c3 = await mkUser();
  await q(`insert into saas_trials (user_id, feature, state, consumed_at) values ($1, 'VERIFY', 'CONSUMED', now())`, [c3.id]);
  const g = await grant(owner, c3, 'CUSTOM', null, [{ feature: 'VERIFY', limit: 3 }], null, 'three verifies for a partner');
  assert.equal(g.permanent, true);
  let r = await begin(c3, 'VERIFY', 'c3-fail-0001'); assert.equal(r.funding, 'GRANT');
  await release(c3, 'VERIFY', 'c3-fail-0001');
  r = await begin(c3, 'VERIFY', 'c3-fail-0002'); await release(c3, 'VERIFY', 'c3-fail-0002');
  for (let i = 1; i <= 3; i++) {
    r = await begin(c3, 'VERIFY', `c3-ok-000${i}`); assert.equal(r.funding, 'GRANT'); assert.equal(r.used, i); assert.equal(r.limit, 3);
    assert.equal((await commit(c3, 'VERIFY', `c3-ok-000${i}`)).ok, true);
  }
  r = await begin(c3, 'VERIFY', 'c3-ok-0004');
  assert.equal(r.ok, false); assert.equal(r.reason, 'ALLOWANCE_EXHAUSTED');
  let st = await statusOf(c3);
  const v = feat(st, 'VERIFY');
  assert.equal(v.source, 'NONE');
  const det = (await asUser(owner, 'select public.admin_access_user($1) r', [c3.id])).r;
  const al = det.grants[0].allowances.find((a) => a.feature === 'VERIFY');
  assert.equal(al.used, 3); assert.equal(al.remaining, 0);
  assert.equal(det.usage.filter((u) => u.funding === 'GRANT' && u.state === 'COMMITTED').length, 3);
  assert.equal(det.usage.filter((u) => u.state === 'RELEASED').length, 2);
  // Contract analysis is not in this grant.
  assert.notEqual((await begin(c3, 'CONTRACT_ANALYSIS', 'c3-doc-0001')).funding, 'GRANT');
  // Reset, then adjust.
  await asUser(owner, `select public.admin_access_allowance_reset($1, 'VERIFY', 'new quarter')`, [g.id]);
  assert.equal((await begin(c3, 'VERIFY', 'c3-ok-0005')).funding, 'GRANT');
  await asUser(owner, `select public.admin_access_grant_update($1, 'DATE', now() + interval '30 days', $2::jsonb, 'raise to five')`,
    [g.id, JSON.stringify([{ feature: 'VERIFY', limit: 5 }])]);
  st = await statusOf(c3);
  assert.equal(feat(st, 'VERIFY').limit, 5); assert.equal(feat(st, 'VERIFY').used, 1); assert.equal(feat(st, 'VERIFY').remaining, 4);
  assert.equal(st.access.grants[0].permanent, false);
  const actions = (await q(`select action from saas_access_events where grant_id=$1 order by created_at`, [g.id])).map((x) => x.action);
  assert.deepEqual(actions, ['GRANTED', 'ALLOWANCE_RESET', 'MODIFIED']);
  const mod = await one(`select previous, new from saas_access_events where grant_id=$1 and action='MODIFIED'`, [g.id]);
  assert.equal(mod.previous.allowances[0].limit, 3); assert.equal(mod.new.allowances[0].limit, 5);
  ok('custom 3 Verify: success-only counting, 4th refused, reset and adjust audited with previous/new');
}
/* 7. permissions: nobody grants themselves; customers cannot touch anything; admins cannot raise admins */
{
  const plain = await mkUser(); const other = await mkUser();
  await assert.rejects(grant(plain, plain, 'UNLIMITED', null, null, null), /FORBIDDEN/);
  await assert.rejects(grant(plain, other, 'UNLIMITED', null, null, null), /FORBIDDEN/);
  await assert.rejects(asUser(plain, 'select public.admin_access_user($1)', [other.id]), /FORBIDDEN/);
  await assert.rejects(asUser(plain, 'select public.admin_access_users(null, 5)'), /FORBIDDEN/);
  const adm = await mkUser({ admin: true }); const adm2 = await mkUser({ admin: true });
  await assert.rejects(grant(adm, adm, 'UNLIMITED', null, null, null), /FORBIDDEN_SELF/);
  await assert.rejects(grant(adm, adm2, 'UNLIMITED', null, null, null), /OWNER_ONLY/);
  const g = await grant(adm, other, 'CUSTOM', null, [{ feature: 'CONTRACT_ANALYSIS', limit: 50 }], null);
  assert.equal(g.kind, 'CUSTOM');
  await assert.rejects(grant(owner, other, 'CUSTOM', null, [{ feature: 'VERIFY', limit: 1 }], null, ''), /REASON_REQUIRED/);
  await assert.rejects(grant(owner, other, 'CUSTOM', null, [{ feature: 'HOMI_UNLIMITED', limit: 3 }], null), /BOOLEAN_FEATURE_IS_ON_OR_OFF/);
  await assert.rejects(grant(owner, other, 'CUSTOM', null, [{ feature: 'VERIFY', limit: 1 }], new Date(Date.now() - 1000).toISOString()), /INVALID_EXPIRY/);
  const g2 = await grant(owner, adm2, 'CUSTOM', null, [{ feature: 'VERIFY', unlimited: true }], null);
  assert.equal(g2.allowances[0].unlimited, true, 'the owner may grant an admin');
  await assert.rejects(asUser(adm2, `select public.admin_access_grant_revoke($1, 'mine', 'REVOKE')`, [g2.id]), /FORBIDDEN_SELF/);
  ok('permissions: self-grant, customer calls, admin-to-admin, bad reason / kind / expiry refused');
}
/* 8. revoke needs confirmation; revoked access stops at once */
{
  const r1 = await mkUser();
  await q(`insert into saas_trials (user_id, feature, state) values ($1, 'VERIFY', 'CONSUMED')`, [r1.id]);
  const g = await grant(owner, r1, 'CUSTOM', null, [{ feature: 'VERIFY', unlimited: true }, { feature: 'INTERNAL_UNLOCK_FREE', unlimited: true }], null);
  assert.equal((await one(`select public.saas_user_has_feature($1, 'INTERNAL_UNLOCK_FREE') r`, [r1.id])).r, true);
  const ids = ['33333333-3333-3333-3333-333333333333'];
  assert.equal((await one(`select public.internal_leads_unlock($1, $2::uuid[], 'ilu:grant001') r`, [r1.id, ids])).r.chargedCredits, 0);
  await assert.rejects(asUser(owner, `select public.admin_access_grant_revoke($1, 'abuse', 'yes')`, [g.id]), /CONFIRMATION_REQUIRED/);
  const rv = (await asUser(owner, `select public.admin_access_grant_revoke($1, 'abuse', 'REVOKE') r`, [g.id])).r;
  assert.equal(rv.status, 'REVOKED'); assert.equal(rv.revokeReason, 'abuse');
  assert.equal((await begin(r1, 'VERIFY', 'r1-job-0001')).ok, false);
  assert.equal((await one(`select public.saas_user_has_feature($1, 'INTERNAL_UNLOCK_FREE') r`, [r1.id])).r, false);
  await assert.rejects(asUser(owner, `select public.admin_access_grant_update($1, 'PERMANENT', null, null, 'undo')`, [g.id]), /GRANT_REVOKED/);
  ok('revoke: explicit confirmation, immediate effect, cannot be edited afterwards');
}
/* 9. overlap is deterministic: unlimited beats limited; the soonest-expiring limited grant is used first */
{
  const o = await mkUser();
  await q(`insert into saas_trials (user_id, feature, state) values ($1, 'CONTRACT_ANALYSIS', 'CONSUMED')`, [o.id]);
  const late = await grant(owner, o, 'CUSTOM', null, [{ feature: 'CONTRACT_ANALYSIS', limit: 2 }], null);
  const soon = await grant(owner, o, 'CUSTOM', null, [{ feature: 'CONTRACT_ANALYSIS', limit: 1 }], new Date(Date.now() + 3 * 86400e3).toISOString());
  let r = await begin(o, 'CONTRACT_ANALYSIS', 'o-doc-00001'); assert.equal(r.grantId, soon.id, 'expiring capacity first');
  r = await begin(o, 'CONTRACT_ANALYSIS', 'o-doc-00002'); assert.equal(r.grantId, late.id);
  const unl = await grant(owner, o, 'CUSTOM', null, [{ feature: 'CONTRACT_ANALYSIS', unlimited: true }], new Date(Date.now() + 86400e3).toISOString());
  r = await begin(o, 'CONTRACT_ANALYSIS', 'o-doc-00003'); assert.equal(r.grantId, unl.id, 'unlimited wins');
  ok('overlap resolution: unlimited first, then soonest-expiring limited grant');
}
/* 10. a plan as a MANUAL grant: the plan's allowances per month, labelled PLAN, no subscription row */
{
  const p = await mkUser();
  const g = await grant(owner, p, 'PLAN', 'VIP', null, null, 'partner on VIP');
  assert.equal(g.kind, 'PLAN'); assert.equal(g.planCode, 'VIP');
  const v = g.allowances.find((a) => a.feature === 'VERIFY');
  assert.equal(v.limit, 15); assert.equal(v.period, 'MONTHLY');
  assert.equal(g.allowances.find((a) => a.feature === 'HOMI_UNLIMITED').unlimited, true);
  assert.equal((await begin(p, 'VERIFY', 'p-job-00001')).funding, 'GRANT');
  const st = await statusOf(p);
  assert.equal(st.plan, 'FREE', 'never shown as a paid plan'); assert.equal(st.subscription, null);
  assert.equal(st.access.grants[0].planCode, 'VIP'); assert.equal(st.access.unlimited, false);
  assert.equal((await one('select count(*)::int n from saas_subscriptions where user_id=$1', [p.id])).n, 0);
  ok('manual plan grant: VIP allowances monthly, GRANT funding, no payment / subscription row');
}
/* 11. monthly window arithmetic (Tbilisi calendar months) */
{
  const r = await one(`select public.saas_grant_period_start('2027-01-31T10:00:00+04', '2027-03-05T00:00:00+04') a,
                              public.saas_grant_period_start('2027-01-31T10:00:00+04', '2027-02-27T00:00:00+04') b`);
  assert.equal(new Date(r.a).toISOString(), '2027-02-28T06:00:00.000Z');
  assert.equal(new Date(r.b).toISOString(), '2027-01-31T06:00:00.000Z');
  ok('monthly grant windows anchored at the grant start');
}
console.log(`\n${passed} groups passed`);
await pool.end();
