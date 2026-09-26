// A BROKER WE FOUND MUST NEVER BECOME A BROKER WHO PAID US.
//
// The separation is structural rather than procedural, and these tests are what stop
// it becoming procedural later. Proven against production on 2026-09-26 before any of
// them were written:
//
//   a discovery-shaped insert into broker_directory_listings is REFUSED by the
//   database: SQLSTATE 23502, "null value in column owner_user_id ... violates
//   not-null constraint". Discovery has no user and therefore cannot register anybody.
//
//   three registrations inserted -- ACTIVE and current, ACTIVE and lapsed by one day,
//   PENDING_REVIEW and paid -- and broker_directory_public showed exactly ONE: the
//   current one. The probe was rolled back and all three broker tables are at zero.
//
// WHAT EACH TEST HERE GUARDS, AND WHY A COMMENT WOULD NOT
//
// The migration's own comments say broker_intelligence has no paid column. A comment
// cannot stop somebody adding one, and the moment one exists every rule above becomes
// a filter somebody has to remember. So the absence is asserted.
//
// These read the repository rather than the database, deliberately: a schema check
// against production would pass on a machine that cannot reach production, and a
// guard that can be absent is not a guard.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const MIGRATION = join(
  root, 'supabase', 'migrations', '20260926270000_broker_intelligence_and_directory.sql',
);
const migration = readFileSync(MIGRATION, 'utf8');

const functionsDir = join(root, 'supabase', 'functions');
const edgeFunctions = readdirSync(functionsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
  .map((entry) => ({
    name: entry.name,
    source: (() => {
      try {
        return readFileSync(join(functionsDir, entry.name, 'index.ts'), 'utf8');
      } catch {
        return '';
      }
    })(),
  }))
  .filter((fn) => fn.source);

/* ────────────────────────────────────────────────────────────────────────
 * The schema cannot express a promotion
 * ──────────────────────────────────────────────────────────────────────── */

test('the discovered-broker table has no column that could claim a relationship', () => {
  /*
   * Everything between `create table ... broker_intelligence (` and its closing
   * paren. A paid, verified, plan or registered column here would make every other
   * rule in this file a convention.
   */
  const start = migration.indexOf('create table if not exists public.broker_intelligence (');
  assert.ok(start > -1, 'broker_intelligence is not created by this migration');
  const end = migration.indexOf('comment on table public.broker_intelligence', start);
  assert.ok(end > start, 'could not bound the broker_intelligence definition');
  /*
   * COMMENTS STRIPPED FIRST. Without this the scan below matches the migration's own
   * comment explaining that FRESH must never be written into a ValidationState
   * column -- a test failing on the sentence that documents the bug it is guarding
   * against. This has happened before in this repository, which is why the rule is
   * to assert on the declarations and not on the prose around them.
   */
  const body = migration.slice(start, end).replace(/--.*$/gm, '');

  for (const forbidden of [
    /\bpaid_until\b/, /\bis_paid\b/, /\bpaid\b(?!-)/, /\bverified\b/, /\bis_verified\b/,
    /\bplan\b/, /\bsubscription/, /\bregistered\b/, /\bowner_user_id\b/, /\btier\b/,
  ]) {
    assert.ok(!forbidden.test(body),
      `broker_intelligence declares ${forbidden} -- a discovered firm cannot know that`);
  }

  /* And what it DOES have: the ValidationState vocabulary, not DeliveryVerdict. */
  assert.match(body, /validation_state text not null default 'UNVERIFIED'/);
  assert.match(body, /'UNVERIFIED', 'VALID', 'INVALID', 'REMOVED', 'UNVERIFIABLE'/);
  assert.ok(!/FRESH|NEEDS_REVALIDATION|NEW_UNVERIFIED/.test(body),
    'a DeliveryVerdict has been written into a ValidationState column again');
});

test('a registration requires an owning account, with no default', () => {
  assert.match(
    migration,
    /owner_user_id uuid not null references auth\.users \(id\)/,
    'owner_user_id is what makes automatic promotion impossible; it must be NOT NULL',
  );
  /* A default would hand discovery the one thing it is missing. */
  const ownerLine = migration
    .split('\n')
    .find((line) => line.includes('owner_user_id uuid not null'));
  assert.ok(ownerLine && !/default/i.test(ownerLine),
    'owner_user_id has a default, which would let a discovery insert succeed');
});

test('the customer-visible directory is a view that tests paid-and-current', () => {
  const start = migration.indexOf('create or replace view public.broker_directory_public');
  assert.ok(start > -1, 'broker_directory_public does not exist');
  const view = migration.slice(start, migration.indexOf('comment on view', start));
  assert.match(view, /l\.status = 'ACTIVE'/);
  assert.match(view, /l\.paid_until is not null/);
  assert.match(view, /l\.paid_until > now\(\)/);
  /* It reads the registrations and nothing else. A join to intelligence here would
     be the promotion this whole design exists to prevent. */
  assert.ok(!/broker_intelligence/.test(view),
    'the public directory view reaches into discovered brokers');
});

/* ────────────────────────────────────────────────────────────────────────
 * No code path writes a registration
 * ──────────────────────────────────────────────────────────────────────── */

test('no edge function writes to the paid directory', () => {
  /*
   * Not "no discovery function" -- NO function. There is no registration flow yet,
   * so the correct number of writers is zero, and this test is what makes the first
   * one a deliberate decision instead of a side effect. When a real registration
   * flow is built, this assertion is the place it gets declared.
   */
  const writers = [];
  for (const fn of edgeFunctions) {
    const touches = /broker_directory_listings/.test(fn.source);
    if (!touches) continue;
    const writes = /from\('broker_directory_listings'\)\s*\n?\s*\.(insert|upsert|update|delete)/
      .test(fn.source)
      || /\.from\('broker_directory_listings'\)\.(insert|upsert|update|delete)/.test(fn.source);
    if (writes) writers.push(fn.name);
  }
  assert.deepEqual(writers, [],
    `these functions write directory registrations: ${writers.join(', ')}`);
});

test('discovery writes intelligence and lineage, and only those', () => {
  const discovery = edgeFunctions.find((fn) => fn.name === 'supply-discovery');
  assert.ok(discovery, 'supply-discovery is missing');

  assert.match(discovery.source, /from\('broker_intelligence'\)/);
  assert.match(discovery.source, /from\('broker_intelligence_sources'\)/);
  assert.ok(!/broker_directory_listings|broker_directory_public/.test(discovery.source),
    'supply-discovery names the paid directory');
});

test('the matcher reads the role column, not source_status', () => {
  /*
   * THE BUG THIS REPLACES. supply-matching derived the supply role from
   * `source_status`, a column that holds AVAILABLE or null -- so supplyRoleFrom
   * returned null for every row and all 25 persisted matches carried supply_role
   * null with PARTICIPANTS unknown. BROKER and AGENCY were declared participants
   * that had never once participated.
   */
  const matcher = edgeFunctions.find((fn) => fn.name === 'supply-matching');
  assert.ok(matcher, 'supply-matching is missing');
  assert.match(matcher.source, /supplyRoleFrom\(\(supplyRow\.supply_role as string \| null\)/,
    'the matcher is not reading supply_role');
  assert.ok(!/supplyRoleFrom\(\(supplyRow\.source_status/.test(matcher.source),
    'the matcher is reading the role out of source_status again');
});

/* ────────────────────────────────────────────────────────────────────────
 * What the customer is told
 * ──────────────────────────────────────────────────────────────────────── */

test('the customer read discloses standing through the one function that decides it', () => {
  const read = edgeFunctions.find((fn) => fn.name === 'find-property');
  assert.ok(read, 'find-property is missing');

  assert.match(read.source, /directoryStandingOf\(/);
  assert.match(read.source, /discloseBroker\(/);
  /* It asks the VIEW whether a broker is registered, so the paid-and-current test is
     the view's and not a filter repeated here. */
  assert.match(read.source, /from\('broker_directory_public'\)/);
  /* And it never invents a standing from the intelligence record. */
  assert.ok(!/registeredWithHomatch:\s*true/.test(read.source),
    'find-property hardcodes a registered claim');
});

test('the brokers page reads the directory view and never the intelligence table', () => {
  const page = readFileSync(join(root, 'src', 'pages', 'BrokersPage.tsx'), 'utf8');
  assert.match(page, /from\('broker_directory_public'\)/);
  assert.ok(!/broker_intelligence/.test(page.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')),
    'the directory page queries discovered brokers');
});

test('both disclosure labels exist in all six languages', () => {
  /*
   * The distinction is worthless if one half of it falls back to English. Counted
   * rather than spot-checked: six bundles, both keys, every time.
   */
  const translations = readFileSync(join(root, 'src', 'i18n', 'translations.ts'), 'utf8');
  for (const key of [
    'broker_disclosure_directory', 'broker_disclosure_observed',
    'broker_distinction_directory', 'broker_distinction_observed',
    'broker_directory_empty_body',
  ]) {
    const count = translations.split(new RegExp(`^  ${key}:`, 'm')).length - 1;
    assert.equal(count, 6, `${key} is in ${count} bundles, not 6`);
  }
});

test('BROKER_FINDER is not advertised while it has no execution path', () => {
  /*
   * The migration that registered it said so in writing: priced, entitled,
   * `enabled = false`, "Deliberately not advertised until then." Confirmed live on
   * 2026-09-26: enabled=false, pricing_active=true. Nothing built here turns it on,
   * and the /brokers page does not offer it -- the directory it shows is free to
   * read and empty, which is the truth rather than a teaser.
   */
  const page = readFileSync(join(root, 'src', 'pages', 'BrokersPage.tsx'), 'utf8');
  assert.ok(!/BROKER_FINDER/.test(page),
    'the brokers page references a product that is switched off');

  const enabling = edgeFunctions.filter((fn) => (
    /BROKER_FINDER/.test(fn.source) && /enabled:\s*true/.test(fn.source)
  ));
  assert.deepEqual(enabling.map((fn) => fn.name), [],
    'something enables BROKER_FINDER without an execution path');
});
