// PGlite behaviour test for 20261201091000_verify_queue_position.sql: position counts the same lane in claim order,
// the estimate comes from measured throughput only, and a job with nothing waiting reports zero.
//   node scripts/verify/queue-position-db-check.mjs <repo-root> [<dir with node_modules/@electric-sql/pglite>]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const ROOT = process.argv[2] ?? '.';
const require = createRequire(import.meta.url);
const { PGlite } = process.argv[3]
  ? require(process.argv[3] + '/node_modules/@electric-sql/pglite/dist/index.cjs')
  : require('@electric-sql/pglite');
const MIGRATION = readFileSync(ROOT + '/supabase/migrations/20261201091000_verify_queue_position.sql', 'utf8');

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.verify_tasks (
    id serial primary key, job_id uuid, source text, lane text, state text, priority int default 100,
    run_after timestamptz default now(), created_at timestamptz default now(), finished_at timestamptz, cancel_requested boolean default false
  );`);
await db.exec(MIGRATION);
const J = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const add = (job, source, lane, state, o = {}) => db.query(
  `insert into public.verify_tasks (job_id, source, lane, state, created_at, finished_at) values ($1,$2,$3,$4, now() - ($5 || ' seconds')::interval, ${o.finishedAgo != null ? `now() - interval '${o.finishedAgo} seconds'` : 'null'})`,
  [job, source, lane, state, String(o.age ?? 0)]);
const pos = async (job) => (await db.query('select public.verify_queue_position($1) p', [job])).rows[0].p;

// Ten browser tasks of other jobs wait ahead; ours is the eleventh; 30 browser tasks finished in the last 15 min.
for (let i = 0; i < 10; i++) await add(J(100 + i), 'TAS_MAP', 'BROWSER', 'QUEUED', { age: 100 - i });
await add(J(1), 'TAS_MAP', 'BROWSER', 'QUEUED', { age: 50 });
await add(J(1), 'mygov', 'HTTP', 'QUEUED', { age: 50 });
await add(J(1), 'rstax', 'BROWSER', 'QUEUED', { age: 60 });
for (let i = 0; i < 30; i++) await add(J(200 + i), 'enreg', 'BROWSER', 'SUCCEEDED', { finishedAgo: 60 + i });
await add(J(300), 'enreg', 'BROWSER', 'SUCCEEDED', { finishedAgo: 3600 });

const p = await pos(J(1));
assert.equal(p.waiting, 2, 'rstax never counts: it does not hold the stage');
assert.equal(p.lane, 'BROWSER', 'the first waiting task in claim order');
assert.equal(p.ahead, 10);
assert.equal(Number(p.perMinute), 2, '30 in 15 minutes');
assert.equal(p.etaSeconds, Math.ceil(11 / 2 * 60));

// No recent throughput: a position, no promise.
const fresh = new PGlite();
await fresh.exec(`create role anon; create role authenticated; create role service_role;
  create table public.verify_tasks (id serial primary key, job_id uuid, source text, lane text, state text, priority int default 100,
  run_after timestamptz default now(), created_at timestamptz default now(), finished_at timestamptz, cancel_requested boolean default false);`);
await fresh.exec(MIGRATION);
await fresh.query(`insert into public.verify_tasks (job_id, source, lane, state) values ($1,'TAS_MAP','BROWSER','QUEUED')`, [J(5)]);
const q = (await fresh.query('select public.verify_queue_position($1) p', [J(5)])).rows[0].p;
assert.equal(q.etaSeconds, null);
assert.equal(q.ahead, 0);

// Nothing waiting.
assert.deepEqual(await pos(J(999)), { waiting: 0, ahead: 0, perMinute: null, etaSeconds: null });
console.log('verify_queue_position: OK');
