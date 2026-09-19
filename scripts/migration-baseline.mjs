#!/usr/bin/env node
/*
 * THE MIGRATION-HISTORY INVARIANT, AS A FUNCTION.
 *
 * WHAT WENT WRONG WITH THE FIRST ATTEMPT
 *
 * The reconciliation that fixed the real drift also checked in a snapshot of
 * production's migration ledger — including how many rows it held. Within
 * hours that number was wrong, because another workstream legitimately
 * applied a migration. Nothing failed; the file simply started lying, and
 * the only way to stop it lying was for a human to go and edit a total.
 *
 * An absolute row count of a shared, actively-changing production database
 * is not a safety invariant. It is a fact with a shelf life of minutes, and
 * a test built on it teaches people to edit numbers until tests pass.
 *
 * WHAT IS DURABLE INSTEAD
 *
 * History does not change. The reconciliation established, once, which
 * migrations had been applied up to a fixed point — `baselineThrough` — and
 * what the anomalies among them were. That set is closed: nothing anybody
 * does tomorrow can add a migration to yesterday. So the baseline is frozen
 * at a version, describes only versions at or below it, and never needs
 * refreshing.
 *
 * The invariant it supports is the one that actually matters:
 *
 *   EVERY REPO MIGRATION AT OR BELOW THE BASELINE MUST BE IN THE BASELINE.
 *
 * A file older than the baseline that the baseline has never heard of is
 * either a change applied out-of-band under a different version, or a file
 * backdated into settled history. Both are the drift. A file NEWER than the
 * baseline is an ordinary new migration and is none of this function's
 * business — which is precisely why another workstream shipping one cannot
 * break anybody else's build.
 *
 * WHAT THIS CANNOT SEE
 *
 * Production. It reads the repository and a frozen file, so it cannot tell
 * you whether a migration written last Tuesday has been applied yet. That is
 * a live question and `--check` answers it, given a ledger export on stdin;
 * `supabase migration list` answers it too. The split is deliberate: the
 * part that runs on every commit needs no credentials and cannot go stale,
 * and the part that needs production runs where production is reachable.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MIGRATIONS_DIR = join('supabase', 'migrations');
export const BASELINE_FILE = join('supabase', 'migration-baseline.json');

/** `20260919180000_storage_migration_manifest.sql` -> its two halves. */
export function parseMigrationFilename(file) {
  const underscore = file.indexOf('_');
  if (underscore < 1) return null;
  return {
    file,
    version: file.slice(0, underscore),
    name: file.slice(underscore + 1).replace(/\.sql$/, ''),
  };
}

/** Every migration file in the repository, oldest first. */
export function readMigrationFiles(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map(parseMigrationFilename)
    .filter(Boolean)
    .sort((a, b) => (a.version < b.version ? -1 : 1));
}

export function readBaseline(file = BASELINE_FILE) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * The audit. Pure: give it files and a baseline, get findings back.
 *
 * Every finding is something a person has to decide about. An empty findings
 * array is the only passing state, and each entry says which invariant broke
 * so the fix is not a guess.
 */
export function auditMigrations({ files, baseline }) {
  const findings = [];
  const through = baseline.baselineThrough;
  const applied = new Set(baseline.appliedVersions);

  const add = (rule, detail, items) => findings.push({ rule, detail, items });

  // ── The baseline must describe itself ────────────────────────────────
  if (!through) add('BASELINE_MALFORMED', 'baselineThrough is missing', []);
  const aboveCeiling = baseline.appliedVersions.filter((v) => v > through);
  if (aboveCeiling.length) {
    add('BASELINE_MALFORMED',
      'the baseline records versions newer than its own ceiling, so it is not frozen',
      aboveCeiling);
  }
  if (applied.size !== baseline.appliedVersions.length) {
    add('BASELINE_MALFORMED', 'duplicate versions in appliedVersions', []);
  }

  // ── THE INVARIANT ────────────────────────────────────────────────────
  // A repo file at or below the ceiling that the baseline never saw.
  const historical = files.filter((m) => m.version <= through);
  const unknown = historical.filter((m) => !applied.has(m.version));
  if (unknown.length) {
    add('HISTORICAL_FILE_NOT_IN_BASELINE',
      'This file is older than the reconciled baseline but the production ledger '
      + 'has never seen its version. Either the change was applied out-of-band '
      + 'under a different version — rename the file to that version once the SQL '
      + 'is proven to match — or a file has been backdated into settled history.',
      unknown.map((m) => m.file));
  }

  // ── Name collisions: the shape that produced the duplicates ──────────
  const byName = new Map();
  for (const m of files) byName.set(m.name, [...(byName.get(m.name) ?? []), m.file]);
  const grandfathered = new Set(baseline.grandfatheredDuplicateNames.map((g) => g.name));
  const collisions = [...byName.entries()].filter(([, f]) => f.length > 1);

  const newCollisions = collisions.filter(([name]) => !grandfathered.has(name));
  if (newCollisions.length) {
    add('DUPLICATE_MIGRATION_NAME',
      'Two migration files share a name. That is how the same change ends up '
      + 'applied twice under two versions.',
      newCollisions.map(([name, f]) => `${name}: ${f.join(', ')}`));
  }

  // A grandfathered exception that no longer exists is an exception nobody
  // is entitled to any more, and leaving it in the list quietly widens the
  // allowance for the next collision.
  const stale = [...grandfathered].filter((n) => !collisions.some(([name]) => name === n));
  if (stale.length) {
    add('STALE_GRANDFATHERED_EXCEPTION',
      'This name is excused in the baseline but no longer collides. Remove it.',
      stale);
  }

  // ── The recorded anomalies must still be describable ─────────────────
  const names = new Set(files.map((m) => m.name));
  const duplicatesWithoutAFile = (baseline.duplicateLedgerRows ?? [])
    .filter((r) => !names.has(r.name));
  if (duplicatesWithoutAFile.length) {
    add('DUPLICATE_ROW_HAS_NO_FILE',
      'The baseline classifies this ledger row as a duplicate of a repo file, but '
      + 'no file of that name exists. Its classification is wrong, or the file was '
      + 'deleted and the row is now an unversioned production change.',
      duplicatesWithoutAFile.map((r) => `${r.version}|${r.name}`));
  }

  return findings;
}

/**
 * Compare the repository against a LIVE ledger export. This is the half that
 * needs production and therefore does not run on every commit.
 *
 * Input: the versions currently in supabase_migrations.schema_migrations.
 * Answers the question the frozen baseline structurally cannot — has a
 * migration written since the baseline actually been applied yet?
 */
export function auditAgainstLiveLedger({ files, appliedVersions, baseline }) {
  const applied = new Set(appliedVersions);
  const pending = files.filter((m) => !applied.has(m.version));
  const historicalPending = pending.filter((m) => m.version <= baseline.baselineThrough);
  return {
    repoMigrations: files.length,
    liveLedgerRows: appliedVersions.length,
    // Ordinary work: written, not yet applied. `db push` will apply these.
    pendingNew: pending.filter((m) => m.version > baseline.baselineThrough).map((m) => m.file),
    // The dangerous kind: settled history that production does not have.
    pendingHistorical: historicalPending.map((m) => m.file),
    historicalMigrationsToReplay: historicalPending.length,
  };
}

// ── CLI ────────────────────────────────────────────────────────────────
// `--audit`  repo-only, no credentials, what CI runs.
// `--check`  reads a JSON array of applied versions on stdin and adds the
//            live comparison. Feed it from the migration workflow, where
//            production is already reachable.
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`
  || process.argv[1]?.endsWith('migration-baseline.mjs')) {
  const mode = process.argv.includes('--check') ? 'check' : 'audit';
  const files = readMigrationFiles();
  const baseline = readBaseline();

  const findings = auditMigrations({ files, baseline });
  for (const f of findings) {
    console.error(`\n[${f.rule}] ${f.detail}`);
    for (const item of f.items) console.error(`   - ${item}`);
  }

  let liveBad = 0;
  if (mode === 'check') {
    const raw = readFileSync(0, 'utf8').trim();
    const appliedVersions = raw
      ? JSON.parse(raw).map((r) => String(typeof r === 'string' ? r : r.version))
      : [];
    const live = auditAgainstLiveLedger({ files, appliedVersions, baseline });
    console.log(`repo migrations              ${live.repoMigrations}`);
    console.log(`live ledger rows             ${live.liveLedgerRows}`);
    console.log(`pending (new, expected)      ${live.pendingNew.length}`);
    console.log(`HISTORICAL TO REPLAY         ${live.historicalMigrationsToReplay}`);
    for (const f of live.pendingHistorical) console.error(`   - ${f}`);
    liveBad = live.historicalMigrationsToReplay;
  }

  if (findings.length || liveBad) {
    console.error(`\n[migration-baseline] FAILED — ${findings.length} finding(s)`
      + (mode === 'check' ? `, ${liveBad} historical migration(s) to replay` : ''));
    process.exit(1);
  }
  console.log(`[migration-baseline] OK — ${files.length} migration files, `
    + `baseline frozen through ${baseline.baselineThrough}`);
}
