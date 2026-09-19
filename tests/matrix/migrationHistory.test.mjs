// MIGRATION HISTORY: THE DRIFT THAT ALREADY HAPPENED, AND CANNOT HAPPEN AGAIN
// WITHOUT THIS FAILING.
//
// WHAT WENT WRONG
//
// Production's ledger and this repository disagreed. 328 rows were recorded
// applied; 226 files existed. The cause is visible in the data: 72 migrations
// appear TWICE under two different versions — once applied through the
// Management API or the dashboard (those rows carry their SQL), and once
// pushed later from a repo file (those rows carry none). Somebody applied a
// change to get it live, then wrote the file, and the file went in under a
// different timestamp.
//
// That is harmless right up until a repo file exists whose version the ledger
// has never seen while its EFFECT is already live. Then `supabase db push`
// tries to apply it again, and whether that is survivable depends entirely on
// how the SQL was written. Four such files existed (the storage/R2 set) and
// were reconciled by renaming them to the versions production had actually
// recorded, after proving their content was token-identical to what ran.
//
// WHAT THIS TEST ENFORCES
//
//   1. Nothing pending that is secretly already live. Any repo file older
//      than the newest applied migration must be IN the snapshot. A genuinely
//      new migration is newer than everything applied, so it passes freely —
//      this is not a rule against writing migrations.
//   2. One name, one file. Two files with the same migration name is the
//      shape that produced all 72 duplicates.
//   3. The snapshot stays honest about what it is: the count of known
//      ledger-only rows is asserted, so silently editing it to make a
//      failure go away shows up as a diff in this file too.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// It does not talk to production. A unit test with a database credential is
// a unit test nobody can run; the snapshot is refreshed by a human doing a
// deliberate reconciliation, and the whole point is that between those, drift
// is caught by arithmetic on files.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join('supabase', 'migrations');
const snapshot = JSON.parse(readFileSync(join('supabase', 'migration-ledger.json'), 'utf8'));

/** Every migration file, split into the version and the name. */
function repoMigrations() {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((file) => {
      const underscore = file.indexOf('_');
      return {
        file,
        version: file.slice(0, underscore),
        name: file.slice(underscore + 1).replace(/\.sql$/, ''),
      };
    })
    .sort((a, b) => (a.version < b.version ? -1 : 1));
}

test('the snapshot describes itself honestly', () => {
  const applied = new Set(snapshot.applied_versions);
  assert.equal(applied.size, snapshot.applied_versions.length, 'duplicate versions in snapshot');
  assert.equal(snapshot.totals.applied, applied.size);
  assert.equal(snapshot.totals.ledger_only, snapshot.ledger_only.length);
  // The reconciliation found 72 duplicates and 30 genuinely unversioned
  // production changes. Those numbers are the finding; if they move, the
  // reconciliation has to be redone rather than the number edited.
  //
  // 72 became 76 the same day, and the reconciliation WAS redone rather than
  // the number edited. A concurrent repair had taken the other route through
  // the storage drift -- recording the repo's own versions as applied instead
  // of renaming the files down to the versions production already had. The
  // rename is what shipped, so those four extra ledger rows now name nothing
  // in this repository. Each was re-verified before being counted here: its
  // complete SQL matches the row it duplicates, normalized only for comments,
  // the dollar-quote tag and whitespace, and every object it creates was
  // confirmed live. They are inert, and they are counted because production
  // holds them.
  assert.equal(snapshot.totals.ledger_only_duplicate, 76);
  assert.equal(snapshot.totals.ledger_only_unversioned, 30);
  assert.equal(
    snapshot.ledger_only.filter((r) => r.kind === 'UNVERSIONED').length,
    snapshot.totals.ledger_only_unversioned,
  );
});

test('every migration file has a version and a name', () => {
  for (const m of repoMigrations()) {
    assert.match(m.version, /^[0-9]{5,14}$/, `${m.file} has no usable version`);
    assert.ok(m.name.length > 0, `${m.file} has no name`);
  }
});

test('NOTHING PENDING IS ALREADY LIVE: no repo file predates the ledger unseen', () => {
  const applied = new Set(snapshot.applied_versions);
  const newestApplied = snapshot.applied_versions.reduce((a, b) => (a > b ? a : b));

  const suspicious = repoMigrations()
    // A version newer than everything applied is an ordinary pending
    // migration and is none of this test's business.
    .filter((m) => m.version <= newestApplied)
    .filter((m) => !applied.has(m.version));

  assert.deepEqual(suspicious.map((m) => m.file), [],
    'These files are older than the newest applied migration but the production\n'
    + 'ledger has never seen their version. Either the change was applied\n'
    + 'out-of-band under a different version — in which case RENAME the file to\n'
    + 'that version after proving the SQL matches — or the ledger snapshot is\n'
    + 'stale and needs regenerating from production.');
});

/*
 * Two name collisions predate this reconciliation and BOTH versions of each
 * are recorded applied in production — the drift, caught in amber. They are
 * grandfathered rather than renamed, because renaming a file whose version
 * the ledger already knows would recreate the exact "pending but already
 * live" hazard this whole exercise removed.
 */
const GRANDFATHERED_DUPLICATE_NAMES = new Set([
  'security_hardening',                 // 00021 and 20260829000002
  'intent_profile_persistence_fix',     // 00025 and 20260829000003
]);

test('one name, one file: the shape that produced 72 duplicate ledger rows', () => {
  const byName = new Map();
  for (const m of repoMigrations()) {
    byName.set(m.name, [...(byName.get(m.name) ?? []), m.file]);
  }
  const collisions = [...byName.entries()]
    .filter(([, files]) => files.length > 1)
    .filter(([name]) => !GRANDFATHERED_DUPLICATE_NAMES.has(name));
  assert.deepEqual(collisions, [],
    'Two migration files share a name. That is how the same change ends up\n'
    + 'applied twice under two versions.');
});

test('the grandfathered collisions are still exactly the two known ones', () => {
  // So the allowlist cannot quietly absorb a new mistake, and so that
  // cleaning these up later is a visible, deliberate act.
  const byName = new Map();
  for (const m of repoMigrations()) {
    byName.set(m.name, [...(byName.get(m.name) ?? []), m.file]);
  }
  const actual = [...byName.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([name]) => name)
    .sort();
  assert.deepEqual(actual, [...GRANDFATHERED_DUPLICATE_NAMES].sort());
  // Both halves of each pair really are applied, which is why neither can
  // simply be deleted or renamed.
  const applied = new Set(snapshot.applied_versions);
  for (const [, files] of byName) {
    if (files.length < 2) continue;
    for (const f of files) assert.ok(applied.has(f.slice(0, f.indexOf('_'))), f);
  }
});

test('the four reconciled storage migrations carry the versions production recorded', () => {
  // Named explicitly because these are the ones that were renamed, and a
  // future "tidy up the timestamps" would silently recreate the exact
  // problem this reconciliation fixed.
  const expected = {
    '20260918205420': 'storage_proof_tickets',
    '20260918213214': 'storage_objects_and_authorize',
    '20260918213458': 'storage_account_scope_and_explorer',
    '20260918214127': 'storage_migration_manifest',
  };
  const byVersion = new Map(repoMigrations().map((m) => [m.version, m.name]));
  for (const [version, name] of Object.entries(expected)) {
    assert.equal(byVersion.get(version), name,
      `${version} must remain ${name}: production applied it under that version`);
    assert.ok(snapshot.applied_versions.includes(version));
  }
});

test('a migration that is already live is never also pending', () => {
  // The headline invariant, stated as the number the reconciliation reports.
  const applied = new Set(snapshot.applied_versions);
  const newestApplied = snapshot.applied_versions.reduce((a, b) => (a > b ? a : b));
  const pendingButOld = repoMigrations()
    .filter((m) => m.version <= newestApplied && !applied.has(m.version));
  assert.equal(pendingButOld.length, 0);
});
