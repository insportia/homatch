/*
 * npm run homatch:migrations — local migration hygiene, before anything
 * touches production.
 *
 * Checks: 14-digit ordered timestamps, no duplicates, lower_snake_case
 * names, and no migration opening its own transaction (the runner owns it —
 * the broker-directory migration had to be patched for exactly this).
 *
 * NO production access here. The authoritative ledger comparison for a real
 * deployment stays with the deploy workflow / `npm run deploy:status`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, parseMigrations, checkMigrations, findInnerTransactions, changedFiles } from './lib.mjs';

/*
 * Grandfathered history. These migrations are ALREADY APPLIED in production
 * and violate today's hygiene rules (5-digit era prefixes; early files that
 * wrap themselves in begin/commit). They are frozen facts, not fixable —
 * editing an applied migration is forbidden. Listed explicitly so the gate
 * stays green on a clean tree while ANY new violation still fails.
 */
const LEGACY = new Set([
  '00021_security_hardening.sql:BAD_TIMESTAMP',
  '00022_security_hardening_v2.sql:BAD_TIMESTAMP',
  '00023_drop_global_query_hash_unique.sql:BAD_TIMESTAMP',
  '00024_matching_jobs_pipeline_v2_repo.sql:BAD_TIMESTAMP',
  '00025_intent_profile_persistence_fix.sql:BAD_TIMESTAMP',
  '00026_phase3_chat_viewing_unlock_dedup_trust.sql:BAD_TIMESTAMP',
  '00029_ai_conversations_sponsored_placements.sql:BAD_TIMESTAMP',
  '00033_phase7_community_outreach_engine.sql:BAD_TIMESTAMP',
  '20260920200000_for_expats_content_seed.sql:INNER_TRANSACTION',
  '20260921021500_for_expats_georgian_copy.sql:INNER_TRANSACTION',
  '20260921023315_for_expats_cost_notes_localised.sql:INNER_TRANSACTION',
  '20260926270000_broker_intelligence_and_directory.sql:INNER_TRANSACTION',
  '20260926280000_property_archive.sql:INNER_TRANSACTION',
]);

const migrations = parseMigrations();
const problems = checkMigrations(migrations);

for (const m of migrations) {
  const sql = readFileSync(join(ROOT, 'supabase/migrations', m.file), 'utf8');
  const inner = findInnerTransactions(sql);
  if (inner.length) {
    problems.push({ file: m.file, kind: 'INNER_TRANSACTION', detail: `top-level ${inner.join(', ')} — the runner owns the transaction` });
  }
}

const { files } = changedFiles();
const newOnes = files.filter((f) => f.startsWith('supabase/migrations/'));

console.log(`${migrations.length} migrations in repo; ${newOnes.length} changed/new in this diff.`);
for (const f of newOnes) console.log(`  ~ ${f}`);

const legacy = problems.filter((p) => LEGACY.has(`${p.file}:${p.kind}`));
const fresh = problems.filter((p) => !LEGACY.has(`${p.file}:${p.kind}`));

if (legacy.length) console.log(`${legacy.length} grandfathered legacy issue(s) (already applied; frozen).`);

if (fresh.length === 0) {
  console.log('MIGRATIONS: PASS — ordering, naming, and transaction ownership clean (beyond frozen history).');
  process.exit(0);
}
console.log(`MIGRATIONS: ${fresh.length} problem(s)`);
for (const p of fresh) console.log(`  ✗ ${p.file}: ${p.kind} — ${p.detail}`);
process.exit(1);
