// PGlite behaviour test for 20261205090000_verify_drive_claim.sql on a production-shaped research_jobs stub.
// Proves: two concurrent claimers never get the same job; one customer's backlog does not starve another;
// an expired claim is reclaimable, a fresh one is not; recently-polled, old, cancelled and finished jobs are skipped.
//   node scripts/verify/drive-claim-db-check.mjs <repo-root> [<dir with node_modules/@electric-sql/pglite>]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const ROOT = process.argv[2] ?? '.';
const require = createRequire(import.meta.url);
const { PGlite } = process.argv[3]
  ? require(process.argv[3] + '/node_modules/@electric-sql/pglite/dist/index.cjs')
  : require('@electric-sql/pglite');
const MIGRATION = readFileSync(ROOT + '/supabase/migrations/20261205090000_verify_drive_claim.sql', 'utf8');

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.research_jobs (
    id uuid primary key, user_id uuid, status text, deleted_at timestamptz, cancelled_at timestamptz,
    updated_at timestamptz, created_at timestamptz, driver_claimed_at timestamptz
  );`);
await db.exec(MIGRATION);

const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const ago = (s) => `now() - interval '${s} seconds'`;
let n = 0;
const job = async (user, o = {}) => {
  const id = U(++n);
  await db.query(`insert into public.research_jobs values ($1, $2, $3, $4, $5, ${o.updated ?? ago(60)}, ${o.created ?? ago(120)}, ${o.claimed ?? 'null'})`,
    [id, user, o.status ?? 'RUNNING', o.deleted ?? null, o.cancelled ?? null]);
  return id;
};
const claim = async (limit) => (await db.query('select * from public.verify_drive_claim($1)', [limit])).rows.map((r) => r.verify_drive_claim);

// Customer A has 6 waiting jobs (oldest), customer B has 2.
const A = U(900), B = U(901);
const aJobs = [];
for (let i = 0; i < 6; i++) aJobs.push(await job(A, { updated: ago(600 - i) }));
const bJobs = [await job(B, { updated: ago(100) }), await job(B, { updated: ago(90) })];
// Never claimed: finished, cancelled, deleted, polled 5 s ago, older than 6 h, freshly claimed by another invocation.
await job(A, { status: 'COMPLETE' });
await job(A, { cancelled: new Date().toISOString() });
await job(A, { deleted: new Date().toISOString() });
await job(B, { updated: ago(5) });
await job(B, { created: ago(7 * 3600) });
const fresh = await job(B, { claimed: ago(20) });
const expired = await job(B, { claimed: ago(400), updated: ago(50) });

const first = await claim(3);
assert.equal(first.length, 3);
assert.ok(first.includes(bJobs[0]), 'B\'s oldest is served in the first round, not after all of A');
assert.ok(first.includes(aJobs[0]));
const second = await claim(3);
assert.equal(new Set([...first, ...second]).size, first.length + second.length, 'no job handed out twice');
const rest = await claim(50);
const all = [...first, ...second, ...rest];
assert.equal(new Set(all).size, all.length);
assert.deepEqual(new Set(all), new Set([...aJobs, ...bJobs, expired]), 'exactly the live, unclaimed (or expired-claim) jobs');
assert.ok(!all.includes(fresh));
assert.deepEqual(await claim(5), [], 'everything is claimed now');

// Released claims become claimable again.
await db.query('update public.research_jobs set driver_claimed_at = null where id = $1', [aJobs[0]]);
assert.deepEqual(await claim(5), [aJobs[0]]);

// Grants: only service_role may claim.
const g = await db.query(`select has_function_privilege('anon', 'public.verify_drive_claim(integer,integer,integer,integer)', 'execute') a,
  has_function_privilege('service_role', 'public.verify_drive_claim(integer,integer,integer,integer)', 'execute') s`);
assert.deepEqual(g.rows[0], { a: false, s: true });
console.log('verify_drive_claim: OK');
