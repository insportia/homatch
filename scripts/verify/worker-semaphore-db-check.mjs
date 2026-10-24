// PGlite behaviour test for 20261201093000_worker_global_semaphore.sql and 20261201092000_verify_market_runs.sql:
// at most p_max live holders per key across "replicas", renew by re-acquire, release frees, expiry frees, grants.
//   node scripts/verify/worker-semaphore-db-check.mjs <repo-root> [<dir with node_modules/@electric-sql/pglite>]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const ROOT = process.argv[2] ?? '.';
const require = createRequire(import.meta.url);
const { PGlite } = process.argv[3]
  ? require(process.argv[3] + '/node_modules/@electric-sql/pglite/dist/index.cjs')
  : require('@electric-sql/pglite');
const db = new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role;');
await db.exec(readFileSync(ROOT + '/supabase/migrations/20261201093000_worker_global_semaphore.sql', 'utf8'));
await db.exec(readFileSync(ROOT + '/supabase/migrations/20261201092000_verify_market_runs.sql', 'utf8'));

const acq = async (key, holder, max, ttl = 120) => (await db.query('select public.worker_semaphore_acquire($1,$2,$3,$4) a', [key, holder, max, ttl])).rows[0].a;
const rel = async (key, holder) => (await db.query('select public.worker_semaphore_release($1,$2) r', [key, holder])).rows[0].r;

// Six replicas race for MyHome's single slot: exactly one wins.
const wins = [];
for (let r = 1; r <= 6; r++) if (await acq('myhome', `replica-${r}`, 1)) wins.push(r);
assert.deepEqual(wins, [1]);
assert.equal(await acq('myhome', 'replica-1', 1), true, 'the holder renews its own slot');
assert.equal(await acq('other-key', 'replica-2', 1), true, 'keys are independent');
assert.equal(await rel('myhome', 'replica-1'), true);
assert.equal(await acq('myhome', 'replica-3', 1), true, 'a released slot is taken by the next replica');
assert.equal(await rel('myhome', 'nobody'), false);

// A dead holder's slot frees itself at its TTL.
await db.query(`update public.worker_semaphore_slots set expires_at = now() - interval '1 second' where key = 'myhome'`);
assert.equal(await acq('myhome', 'replica-4', 1), true);

// A limit above one admits exactly that many.
let n = 0;
for (let r = 1; r <= 10; r++) if (await acq('tas.ge', `r-${r}`, 4)) n++;
assert.equal(n, 4);
assert.equal(await acq('x', 'h', 0), false, 'a zero limit admits nobody');

// Market runs: upsert by id, status constrained.
await db.query(`insert into public.verify_market_runs (id, status, payload) values ('00000000-0000-0000-0000-000000000001', 'RUNNING', '{}')`);
await db.query(`insert into public.verify_market_runs (id, status, payload) values ('00000000-0000-0000-0000-000000000001', 'COMPLETE', '{"comparables":[1]}') on conflict (id) do update set status = excluded.status, payload = excluded.payload`);
assert.equal((await db.query(`select status from public.verify_market_runs`)).rows[0].status, 'COMPLETE');
await assert.rejects(db.query(`insert into public.verify_market_runs (id, status) values ('00000000-0000-0000-0000-000000000002', 'LOST')`));

const g = await db.query(`select has_function_privilege('authenticated','public.worker_semaphore_acquire(text,text,integer,integer)','execute') a,
  has_table_privilege('anon','public.verify_market_runs','select') m, has_function_privilege('service_role','public.worker_semaphore_acquire(text,text,integer,integer)','execute') s`);
assert.deepEqual(g.rows[0], { a: false, m: false, s: true });
console.log('worker_semaphore + verify_market_runs: OK');
