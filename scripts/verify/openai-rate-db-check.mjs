// PGlite behaviour test for 20261201095000_openai_rate_budget.sql: the shared per-model OpenAI budget admits up to
// RPM requests and TPM tokens per minute across callers, then answers with the wait to the next minute.
//   node scripts/verify/openai-rate-db-check.mjs <repo-root> [<dir with node_modules/@electric-sql/pglite>]
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
await db.exec(readFileSync(ROOT + '/supabase/migrations/20261201095000_openai_rate_budget.sql', 'utf8'));

const reserve = async (bucket, tokens, rpm, tpm) => (await db.query('select public.openai_rate_reserve($1,$2,$3,$4) w', [bucket, tokens, rpm, tpm])).rows[0].w;

// Unlimited: nothing is recorded.
assert.equal(await reserve('m', 100, 0, 0), 0);
assert.equal((await db.query('select count(*)::int n from public.openai_rate_minutes')).rows[0].n, 0);

// RPM 3: three callers pass, the fourth is told to wait (> 0, ≤ 60 s).
for (let i = 0; i < 3; i++) assert.equal(await reserve('gpt-a', 10, 3, 0), 0);
const w = await reserve('gpt-a', 10, 3, 0);
assert.ok(w > 0 && w <= 60_000, `wait ${w}`);
assert.equal(await reserve('gpt-b', 10, 3, 0), 0, 'models have separate budgets');

// TPM 1000: the first call always passes (even if large); the next that would exceed waits.
assert.equal(await reserve('gpt-c', 1500, 0, 1000), 0, 'one oversized call is admitted rather than starved');
assert.ok(await reserve('gpt-c', 10, 0, 1000) > 0);
assert.equal(await reserve('gpt-d', 600, 0, 1000), 0);
assert.ok(await reserve('gpt-d', 600, 0, 1000) > 0);

// The next minute starts fresh; rows older than 10 minutes are swept.
await db.exec(`update public.openai_rate_minutes set minute_start = minute_start - interval '11 minutes' where bucket = 'gpt-a'`);
assert.equal(await reserve('gpt-a', 10, 3, 0), 0);
assert.equal((await db.query(`select count(*)::int n from public.openai_rate_minutes where bucket = 'gpt-a'`)).rows[0].n, 1, 'old minute swept');

const grants = (await db.query(`select grantee from information_schema.routine_privileges where routine_name = 'openai_rate_reserve'`)).rows.map((r) => r.grantee);
assert.ok(grants.includes('service_role') && !grants.includes('anon') && !grants.includes('authenticated'));
console.log('openai-rate-db-check: OK');
