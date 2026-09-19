// MIGRATION HISTORY: THE DRIFT THAT ALREADY HAPPENED, AND CANNOT HAPPEN AGAIN
// WITHOUT THIS FAILING.
//
// WHAT WENT WRONG, TWICE
//
// First, production's ledger and this repository disagreed. 79 migration
// names appear twice under two versions, 72 of them as an api-then-cli pair:
// somebody applied a change through the Management API to get it live, then
// wrote the file, and the file went in under a different timestamp. Harmless
// until a repo file exists whose version the ledger has never seen while its
// EFFECT is already live — then `db push` applies it again, and whether that
// survives depends entirely on how the SQL was written. Four such files
// existed, and were reconciled by renaming them to the versions production
// had actually recorded.
//
// Then the fix acquired its own defect. It checked in a snapshot of the
// production ledger INCLUDING HOW MANY ROWS IT HELD, and that number was
// wrong within hours because another workstream legitimately applied a
// migration. Nothing failed — the file simply started lying, and the only
// remedy was a human editing a total. A row count of a shared,
// actively-changing database is not a safety invariant; it is a fact with a
// shelf life of minutes, and a test built on one teaches people to edit
// numbers until tests pass.
//
// WHAT IS CHECKED NOW
//
// One durable invariant, resting on the fact that history cannot change:
//
//   EVERY REPO MIGRATION AT OR BELOW THE FROZEN BASELINE MUST BE IN IT.
//
// A file older than the baseline that the baseline never saw is the drift. A
// file NEWER than the baseline is ordinary work and is out of scope by
// construction — which is exactly why another workstream shipping a
// migration cannot break this, and why nobody has to maintain a count.
//
// The audit is a pure function, so the cases that MUST fail are proven below
// by feeding it synthetic drift rather than asserted by a comment.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditAgainstLiveLedger,
  auditMigrations,
  parseMigrationFilename,
  readBaseline,
  readMigrationFiles,
} from '../../scripts/migration-baseline.mjs';

const baseline = readBaseline();
const files = readMigrationFiles();

/** A synthetic repository, for the cases that must fail. */
const file = (version, name) => parseMigrationFilename(`${version}_${name}.sql`);
const rules = (findings) => findings.map((f) => f.rule).sort();

// ── 1. CURRENT PRODUCTION ────────────────────────────────────────────────

test('CASE 1: the repository as it stands passes the audit', () => {
  const findings = auditMigrations({ files, baseline });
  assert.deepEqual(findings, [],
    findings.map((f) => `${f.rule}: ${f.items.join(', ')}`).join('\n'));
});

test('the baseline is frozen: it describes nothing above its own ceiling', () => {
  assert.ok(baseline.baselineThrough, 'a baseline with no ceiling is a mirror');
  for (const v of baseline.appliedVersions) {
    assert.ok(v <= baseline.baselineThrough, v);
  }
  for (const r of [...baseline.unversionedProductionChanges, ...baseline.duplicateLedgerRows]) {
    assert.ok(r.version <= baseline.baselineThrough, r.version);
  }
});

test('the baseline states no production row count, because that is not durable', () => {
  // The defect this refactor exists to remove. If a total ever reappears,
  // somebody will start maintaining it by hand again.
  assert.equal('totals' in baseline, false);
  assert.equal(
    /"(applied|ledgerRows|productionRows|total)"\s*:\s*\d+/.test(JSON.stringify(baseline)),
    false,
    'the baseline must not record an absolute count of production rows',
  );
});

// ── 2. A NEW LEGITIMATE MIGRATION ────────────────────────────────────────

test('CASE 2: a new migration passes, however much production has moved on', () => {
  const withNew = [...files, file('20260925090000', 'some_new_feature')];
  assert.deepEqual(auditMigrations({ files: withNew, baseline }), []);
});

test('CASE 2: other workstreams applying migrations cannot fail this audit', () => {
  // The audit never reads production, so rows appearing in the live ledger
  // are structurally incapable of breaking it — shown here by a repository
  // that has grown new migrations from three different workstreams.
  const busy = [
    ...files,
    file('20260920100000', 'market_lane_thing'),
    file('20260921110000', 'ai_talk_thing'),
    file('20260922120000', 'investment_thing'),
  ];
  assert.deepEqual(auditMigrations({ files: busy, baseline }), []);
});

// ── 3. A HISTORICAL REPO MIGRATION MISSING FROM THE LEDGER ───────────────

test('CASE 3: a historical file the baseline never saw is a finding', () => {
  // Exactly the original defect: a file whose version production has never
  // recorded, sitting below the baseline, so db push would apply it again.
  const drifted = [...files, file('20260915999999', 'applied_by_hand_elsewhere')];
  const findings = auditMigrations({ files: drifted, baseline });
  assert.deepEqual(rules(findings), ['HISTORICAL_FILE_NOT_IN_BASELINE']);
  assert.deepEqual(findings[0].items, ['20260915999999_applied_by_hand_elsewhere.sql']);
});

test('CASE 3: the four storage migrations are safe under EITHER spelling, and why', () => {
  /*
   * Worth stating precisely, because it looks like a gap and is not.
   *
   * Two repairs for the same drift landed within minutes of each other: one
   * renamed these four files down to the versions production had recorded,
   * the other inserted the repo's own versions into the ledger. Both shipped.
   * So production now holds BOTH spellings of all four, and the baseline
   * records both — which means renaming one back would not be caught here.
   *
   * That is the correct answer rather than a hole: a file is a replay risk
   * only when production has never seen its version, and production has seen
   * both of these. What the guard protects is the general rule, proven by the
   * test above with a version the ledger genuinely does not have.
   */
  const applied = new Set(baseline.appliedVersions);
  for (const [renamed, original] of [
    ['20260918205420', '20260919120000'],
    ['20260918213214', '20260919160000'],
    ['20260918213458', '20260919170000'],
    ['20260918214127', '20260919180000'],
  ]) {
    assert.ok(applied.has(renamed), `${renamed} must be recorded applied`);
    assert.ok(applied.has(original), `${original} must be recorded applied`);
  }
  // The repository carries the renamed spelling, which is the one production
  // recorded first and the one the reconciliation proved the SQL against.
  const byVersion = new Map(files.map((m) => [m.version, m.name]));
  assert.equal(byVersion.get('20260918205420'), 'storage_proof_tickets');
  assert.equal(byVersion.get('20260918213214'), 'storage_objects_and_authorize');
  assert.equal(byVersion.get('20260918213458'), 'storage_account_scope_and_explorer');
  assert.equal(byVersion.get('20260918214127'), 'storage_migration_manifest');
  // And the superseded spellings are NOT files, so nothing pushes them.
  for (const v of ['20260919120000', '20260919160000', '20260919170000', '20260919180000']) {
    assert.equal(byVersion.has(v), false, `${v} must not be a file`);
  }
});

// ── 4. NEW UNEXPECTED HISTORICAL DRIFT ───────────────────────────────────

test('CASE 4: a backdated file is caught even with a plausible-looking version', () => {
  const backdated = [...files, file('20260829000009', 'quietly_inserted_into_history')];
  assert.deepEqual(rules(auditMigrations({ files: backdated, baseline })),
    ['HISTORICAL_FILE_NOT_IN_BASELINE']);
});

test('CASE 4: a NEW duplicate migration name is a finding', () => {
  // The shape that produced all 76 duplicate ledger rows in the first place.
  const collided = [...files, file('20260926090000', 'developer_os_storage')];
  const findings = auditMigrations({ files: collided, baseline });
  assert.deepEqual(rules(findings), ['DUPLICATE_MIGRATION_NAME']);
  assert.match(findings[0].items[0], /developer_os_storage/);
});

test('CASE 4: a baseline recording rows above its ceiling is malformed', () => {
  // The unfreezing failure mode: if the ceiling stops bounding the contents,
  // the file has drifted back into being a mirror of production.
  const thawed = {
    ...baseline,
    appliedVersions: [...baseline.appliedVersions, '20270101000000'],
  };
  assert.ok(rules(auditMigrations({ files, baseline: thawed })).includes('BASELINE_MALFORMED'));
});

test('CASE 4: a duplicate classification with no matching file is a finding', () => {
  const wrong = {
    ...baseline,
    duplicateLedgerRows: [...baseline.duplicateLedgerRows,
      { version: '20260901000000', name: 'no_such_migration_anywhere' }],
  };
  assert.ok(rules(auditMigrations({ files, baseline: wrong }))
    .includes('DUPLICATE_ROW_HAS_NO_FILE'));
});

// ── 5. GRANDFATHERED EXCEPTIONS, DOCUMENTED AND BOUNDED ──────────────────

test('CASE 5: exactly two duplicate names are excused, and they are named', () => {
  assert.deepEqual(
    baseline.grandfatheredDuplicateNames.map((g) => g.name).sort(),
    ['intent_profile_persistence_fix', 'security_hardening'],
  );
  // Both halves of each are recorded applied, which is why neither can be
  // renamed away without recreating the hazard.
  const applied = new Set(baseline.appliedVersions);
  for (const g of baseline.grandfatheredDuplicateNames) {
    assert.equal(g.versions.length, 2, g.name);
    for (const v of g.versions) assert.ok(applied.has(v), `${g.name} ${v}`);
  }
});

test('CASE 5: the excuses are exactly the collisions that exist, no more', () => {
  const byName = new Map();
  for (const m of files) byName.set(m.name, [...(byName.get(m.name) ?? []), m.file]);
  const colliding = [...byName.entries()].filter(([, f]) => f.length > 1).map(([n]) => n).sort();
  assert.deepEqual(colliding, baseline.grandfatheredDuplicateNames.map((g) => g.name).sort());
});

test('CASE 5: an excuse for a collision that no longer exists is a finding', () => {
  // So the allowance cannot quietly widen, and clearing one is deliberate.
  const overbroad = {
    ...baseline,
    grandfatheredDuplicateNames: [...baseline.grandfatheredDuplicateNames,
      { name: 'not_actually_colliding', versions: ['00001', '00002'] }],
  };
  assert.ok(rules(auditMigrations({ files, baseline: overbroad }))
    .includes('STALE_GRANDFATHERED_EXCEPTION'));
});

// ── The reconciliation knowledge, preserved ──────────────────────────────

test('the 30 unversioned production changes are still recorded', () => {
  assert.equal(baseline.unversionedProductionChanges.length, 30);
  for (const r of baseline.unversionedProductionChanges) {
    assert.match(r.version, /^[0-9]{5,14}$/);
    assert.ok(r.name.length > 0);
  }
  // A sample from each closed workstream they belong to, so a silent
  // truncation of the list is visible rather than merely smaller.
  const names = new Set(baseline.unversionedProductionChanges.map((r) => r.name));
  for (const n of [
    'communications_hub_part1_agents_channels_templates',
    'site_studio_tables_rls_grants',
    'developer_os_buyer_room_surface',
    'billing_ai_cost_from_price_book',
  ]) assert.ok(names.has(n), n);
});

test('every duplicate ledger row still names a file that exists', () => {
  const names = new Set(files.map((m) => m.name));
  assert.deepEqual(baseline.duplicateLedgerRows.filter((r) => !names.has(r.name)), []);
});

test('every migration file has a usable version and a name', () => {
  for (const m of files) {
    assert.match(m.version, /^[0-9]{5,14}$/, `${m.file} has no usable version`);
    assert.ok(m.name.length > 0, `${m.file} has no name`);
  }
});

// ── 6. FUTURE DB PUSH ────────────────────────────────────────────────────

test('CASE 6: against the ledger, historical migrations to replay is 0', () => {
  // The frozen baseline cannot answer a question about live production, so
  // the live comparison is its own function. Given the versions the
  // reconciliation observed, every repo file at or below the baseline is
  // accounted for: db push has no settled history to replay.
  const live = auditAgainstLiveLedger({
    files, appliedVersions: baseline.appliedVersions, baseline,
  });
  assert.equal(live.historicalMigrationsToReplay, 0);
  assert.deepEqual(live.pendingHistorical, []);
});

test('CASE 6: a new unapplied migration is pending, NOT a replay risk', () => {
  // The distinction the whole design rests on: written-but-not-yet-applied
  // is ordinary, settled-history-missing-from-production is the emergency.
  const live = auditAgainstLiveLedger({
    files: [...files, file('20260925090000', 'written_today')],
    appliedVersions: baseline.appliedVersions,
    baseline,
  });
  assert.deepEqual(live.pendingNew, ['20260925090000_written_today.sql']);
  assert.equal(live.historicalMigrationsToReplay, 0);
});

test('CASE 6: a historical migration missing from the live ledger IS a replay risk', () => {
  const live = auditAgainstLiveLedger({
    files,
    appliedVersions: baseline.appliedVersions.filter((v) => v !== '20260918213214'),
    baseline,
  });
  assert.equal(live.historicalMigrationsToReplay, 1);
  assert.deepEqual(live.pendingHistorical, ['20260918213214_storage_objects_and_authorize.sql']);
});
