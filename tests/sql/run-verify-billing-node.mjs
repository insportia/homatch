// Verify billing on a REAL Postgres 17, any OS, no psql or Docker: the same
// file order as tests/sql/run-verify-billing.sh, and every parallel block run
// as truly concurrent connections (node-pg pool). Scratch database only —
// never production. Not part of `npm test`: it needs two dev tools that are
// deliberately not dependencies (same pattern as scripts/design-studio/rls-check.mjs):
//   npm i --no-save embedded-postgres@17.9.0-beta.17 pg@8
//   node tests/sql/run-verify-billing-node.mjs .
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const repo = process.argv[2] ?? '.';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-verify-pg-'));
const port = 55400 + Math.floor(Math.random() * 400);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
await server.initialise();
await server.start();
await server.createDatabase('verify_billing_t');
const pool = new pg.Pool({ host: 'localhost', port, user: 'postgres', password: 'postgres', database: 'verify_billing_t', max: 40 });
const notices = [];
// The fixture's auth.role() reads request.jwt.claim.role; a transaction-local set
// leaves '' behind on a pooled connection. Each connection is the service by default.
pool.on('connect', (c) => { c.on('notice', (n) => notices.push(n.message)); c.query("select set_config('request.jwt.claim.role', 'service_role', false)"); });
const one = async (sql) => { const c = await pool.connect(); try { return await c.query(sql); } finally { c.release(); } };
const file = async (f) => {
  const sql = fs.readFileSync(path.join(repo, f), 'utf8').split(/\r?\n/).filter((l) => !/^\s*\\/.test(l)).join('\n');
  await one(sql);
  console.log('OK  ', f);
};
let failed = false;
const step = async (name, fn) => {
  try { await fn(); } catch (e) { failed = true; console.log('FAIL', name, '\n     ', e.message, e.where ? `\n      where: ${String(e.where).slice(0, 300)}` : ''); throw e; }
};

try {
  console.log('server', (await one('select version()')).rows[0].version.slice(0, 40));
  for (const f of [
    'tests/sql/verify_durable_execution_fixture.sql',
    'supabase/migrations/20261026090000_verify_durable_execution.sql',
    'tests/sql/verify_credit_budget_fixture.sql',
    'supabase/migrations/20261026100000_verify_credit_budget.sql',
    'supabase/migrations/20261027090000_verify_wallet_owner.sql',
    'tests/sql/verify_fixed_price_fixture.sql',
    'supabase/migrations/20261127090000_verify_fixed_price_validity.sql',
    'supabase/migrations/20261127090000_verify_fixed_price_validity.sql',
  ]) await step(f, () => file(f));
  await one("update public.billable_products set billing_mode = 'VARIABLE' where code = 'VERIFY'");
  for (const f of ['tests/sql/verify_durable_execution.sql', 'tests/sql/verify_credit_budget.sql', 'tests/sql/verify_billing_audit_regressions.sql',
    'tests/sql/verify_incremental_budget.sql', 'tests/sql/verify_wallet_owner.sql']) await step(f, () => file(f));

  /* ---- cost-based concurrency (as in the .sh), on the rewritten functions ---- */
  await step('cost-based concurrency', async () => {
    const U = '00000000-0000-4000-8000-0000000000c1', W = '00000000-0000-4000-8000-0000000000d9', J = '00000000-0000-4000-8000-00000000c0b1';
    await one(`insert into public.users (id, auth_id) values ('${W}', '${U}');
      insert into public.credit_accounts (user_id, balance) values ('${W}', 60);
      insert into public.credit_lots (user_id, kind, credits_granted, source_type) values ('${W}','PURCHASED',60,'TOPUP');
      insert into public.research_jobs (id, user_id) values ('${J}', '${U}');`);
    await Promise.allSettled([
      ...Array.from({ length: 30 }, (_, i) => one(`select public.verify_billing_open('${J}', '${U}', 'verify:c0b1:click${i + 1}')`)),
      ...Array.from({ length: 6 }, (_, i) => one(`select public.wallet_reserve('${W}', 'VERIFY', 5, 'other-product-${i + 1}')`)),
    ]);
    await one(`update public.research_jobs set result_json = '{"_cost":{"identity":{"input_tokens":200000,"output_tokens":20000}}}' where id = '${J}'`);
    await Promise.allSettled(Array.from({ length: 30 }, () => one(`select public.verify_billing_close('${J}', 'COMPLETE')`)));
    const r = (await one(`select
      (select count(*) from public.verify_billing_sessions where job_id = '${J}')::int sessions,
      (select count(*) from public.usage_reservations where user_id = '${W}' and product_code = 'VERIFY' and job_ref = '${J}')::int res,
      (select count(*) from public.credit_ledger where user_id = '${W}' and type = 'SERVICE_CAPTURE')::int caps,
      (select balance from public.credit_accounts where user_id = '${W}') bal,
      (select reserved from public.credit_accounts where user_id = '${W}') reserved,
      (select charged_total_credits from public.verify_billing where job_id = '${J}') charged,
      (select coalesce(sum(reserved_credits),0) from public.usage_reservations where user_id = '${W}' and idempotency_key like 'other-product-%' and status = 'RESERVED') other`)).rows[0];
    if (r.sessions !== 1 || r.res !== 1 || r.caps !== 1) throw new Error(`cost-based: ${JSON.stringify(r)}`);
    if (Number(r.bal) < 0 || Number(r.reserved) < 0 || Number(r.bal) + Number(r.reserved) !== 60 - Number(r.charged) || Number(r.reserved) !== Number(r.other)) throw new Error(`cost-based wallet: ${JSON.stringify(r)}`);
    console.log('OK   cost-based concurrency: 30 opens + 6 other holds + 30 closes → 1 session, 1 capture, wallet consistent', JSON.stringify(r));
  });

  /* ---- fixed price: acceptance, then concurrency ---- */
  await one("update public.billable_products set billing_mode = 'FIXED' where code = 'VERIFY'");
  await step('tests/sql/verify_fixed_price.sql', () => file('tests/sql/verify_fixed_price.sql'));

  await step('fixed concurrency: 30 starts + 30 deliveries of one job', async () => {
    const U = '00000000-0000-4000-8000-0000000000c3', J = '00000000-0000-4000-8000-00000000c0b3';
    await one(`insert into public.users (id, auth_id) values ('${U}', '${U}');
      insert into public.credit_accounts (user_id, balance) values ('${U}', 100);
      insert into public.credit_lots (user_id, kind, credits_granted, source_type) values ('${U}','PURCHASED',100,'TOPUP');
      insert into public.research_jobs (id, user_id) values ('${J}', '${U}');`);
    await Promise.allSettled(Array.from({ length: 30 }, (_, i) => one(`select public.verify_billing_open('${J}', '${U}', 'verify:c0b3:click${i + 1}', false, null, 19)`)));
    await Promise.allSettled(Array.from({ length: 30 }, () => one(`select public.verify_billing_close('${J}', 'COMPLETE')`)));
    const r = (await one(`select (select count(*) from public.usage_reservations where job_ref = '${J}')::int res,
      (select count(*) from public.credit_ledger where user_id = '${U}' and type = 'SERVICE_CAPTURE')::int caps,
      (select balance from public.credit_accounts where user_id = '${U}') bal, (select reserved from public.credit_accounts where user_id = '${U}') reserved,
      (select charged_total_credits from public.verify_billing where job_id = '${J}') charged`)).rows[0];
    if (r.res !== 1 || r.caps !== 1 || Number(r.charged) !== 19 || Number(r.bal) !== 81 || Number(r.reserved) !== 0) throw new Error(JSON.stringify(r));
    console.log('OK   fixed concurrency: 30 starts + 30 deliveries → 1 reservation, 1 capture, exactly 19, balance 81, nothing held', JSON.stringify(r));
  });

  await step('fixed concurrency: stop/deliver race and 30 distinct jobs on one wallet', async () => {
    const U = '00000000-0000-4000-8000-0000000000c4';
    await one(`insert into public.users (id, auth_id) values ('${U}', '${U}');
      insert into public.credit_accounts (user_id, balance) values ('${U}', 1000);
      insert into public.credit_lots (user_id, kind, credits_granted, source_type) values ('${U}','PURCHASED',1000,'TOPUP');`);
    const jobs = (await one(`insert into public.research_jobs (user_id) select '${U}' from generate_series(1, 30) returning id`)).rows.map((x) => x.id);
    // 30 different jobs started at once on one wallet: each holds 19, never more, never negative.
    await Promise.all(jobs.map((j, i) => one(`select public.verify_billing_open('${j}', '${U}', 'verify:many:${i}:s1', false, null, 19)`)));
    // Half delivered, half stopped — and every one closed 3 times concurrently (stop vs deliver race on the first five).
    const closes = [];
    jobs.forEach((j, i) => {
      const outcome = i < 15 ? 'COMPLETE' : 'STOPPED';
      for (let k = 0; k < 3; k++) closes.push(one(`select public.verify_billing_close('${j}', '${outcome}')`));
      if (i < 5) closes.push(one(`select public.verify_billing_close('${j}', 'STOPPED')`));
    });
    await Promise.allSettled(closes);
    const r = (await one(`select
      (select balance from public.credit_accounts where user_id = '${U}') bal, (select reserved from public.credit_accounts where user_id = '${U}') reserved,
      (select coalesce(sum(charged_total_credits),0) from public.verify_billing b join public.research_jobs j on j.id = b.job_id where j.user_id = '${U}') charged,
      (select count(*) from public.verify_billing b join public.research_jobs j on j.id = b.job_id where j.user_id = '${U}' and b.charged_total_credits not in (0, 19))::int odd,
      (select count(*) from public.credit_ledger where user_id = '${U}' and type = 'SERVICE_CAPTURE')::int caps`)).rows[0];
    // Every job charged 0 or exactly 19; the wallet equals 1000 minus what was charged; nothing left held.
    if (r.odd !== 0 || Number(r.reserved) !== 0 || Number(r.bal) !== 1000 - Number(r.charged) || r.caps !== Number(r.charged) / 19) throw new Error(JSON.stringify(r));
    console.log('OK   fixed: 30 jobs on one wallet, deliver/stop races → each job 0 or 19, captures', r.caps, 'balance', r.bal, 'nothing held');
  });

  await step('fixed concurrency: price changes racing purchases', async () => {
    const U = '00000000-0000-4000-8000-0000000000c5', A = '00000000-0000-4000-8000-0000000000a5';
    await one(`insert into public.users (id, auth_id, is_admin) values ('${A}', '${A}', true), ('${U}', '${U}', false);
      insert into public.credit_accounts (user_id, balance) values ('${U}', 2000);
      insert into public.credit_lots (user_id, kind, credits_granted, source_type) values ('${U}','PURCHASED',2000,'TOPUP');`);
    const jobs = (await one(`insert into public.research_jobs (user_id) select '${U}' from generate_series(1, 30) returning id`)).rows.map((x) => x.id);
    const admin = (cents, i) => one(`begin; select set_config('request.jwt.claim.role','authenticated',true), set_config('request.jwt.claim.sub','${A}',true);
      select public.admin_set_verify_price(${cents}, 'race ${i}'); commit;`);
    // Every buyer was shown 19, but the price is 25 when they start, and it
    // flips 19 <-> 25 between their starts (purchases staggered across the flips).
    await admin(250, 'pre');
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await Promise.allSettled([
      ...jobs.map(async (j, i) => { await sleep(i * 4); return one(`select public.verify_billing_open('${j}', '${U}', 'verify:race:${i}:s1', false, null, 19)`); }),
      ...Array.from({ length: 10 }, async (_, i) => { await sleep(i * 12); return admin(i % 2 ? 250 : 190, i); }),
    ]);
    await Promise.allSettled(jobs.map((j) => one(`select public.verify_billing_close('${j}', 'COMPLETE')`)));
    const r = (await one(`select
      (select count(*) from public.verify_billing b join public.research_jobs j on j.id = b.job_id where j.user_id = '${U}')::int opened,
      (select count(*) from public.verify_billing b join public.research_jobs j on j.id = b.job_id where j.user_id = '${U}' and b.price_credits <> 19)::int wrong_snapshot,
      (select count(*) from public.verify_billing b join public.research_jobs j on j.id = b.job_id where j.user_id = '${U}' and b.charged_total_credits <> 19)::int wrong_charge,
      (select balance from public.credit_accounts where user_id = '${U}') bal, (select reserved from public.credit_accounts where user_id = '${U}') reserved,
      (select count(*) from public.admin_audit_log where action = 'VERIFY_PRICE_UPDATED' and metadata->>'reason' like 'race %')::int audits,
      (select count(*) from public.research_jobs j where j.user_id = '${U}' and not exists (select 1 from public.verify_billing b where b.job_id = j.id))::int refused`)).rows[0];
    // A start either saw 19 and paid exactly 19, or was refused PRICE_CHANGED and holds nothing.
    if (r.wrong_snapshot !== 0 || r.wrong_charge !== 0 || Number(r.reserved) !== 0 || Number(r.bal) !== 2000 - 19 * r.opened || r.audits !== 11) throw new Error(JSON.stringify(r));
    if (r.refused === 0) console.log('WARN price race: no start landed on a 25 window this run');
    console.log('OK   price race: price 25 at start + 10 flips during 30 staggered starts → opened', r.opened, 'all charged 19, refused', r.refused, '(PRICE_CHANGED, nothing held), 11 audit rows, wallet', r.bal);
  });
} catch {
  /* reported above */
} finally {
  await pool.end().catch(() => {});
  await server.stop().catch(() => {});
  fs.rmSync(dir, { recursive: true, force: true });
  for (const n of notices.filter((m) => /passed|consistent|concurrency|closed on its own/i.test(m))) console.log('NOTICE', n);
  console.log(failed ? 'RESULT: FAILED' : 'RESULT: ALL PASSED');
  process.exit(failed ? 1 : 0);
}
