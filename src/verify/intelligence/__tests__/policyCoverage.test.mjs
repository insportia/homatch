// Every fact we store must have a freshness policy.
//
// WHY THIS FILE EXISTS.
//
// A fact with no policy is assessed STALE, which is the safe default but an
// indistinguishable one: an uncovered fact key looks exactly like an expired
// one, so the stage holding it never stops paying to re-find it and the graph
// never reduces anything.
//
// That is not hypothetical. The seeded policies were written against the fact
// vocabulary the stage planner discusses; harvest.ts emits a different one.
// On a property verified forty minutes earlier, every non-fresh fact gave the
// same reason — "no freshness policy for this kind of fact" — across three
// whole families. It had already been patched once, for `listing.`, one
// symptom at a time.
//
// So this reads the real seed out of the migrations and the real fact keys out
// of harvest.ts, and fails if they disagree. Adding a fact without a policy is
// now a failing test rather than a silent cost.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { policyFor } from '../freshness.ts';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..', '..', '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const HARVEST = join(here, '..', 'harvest.ts');

/** Every policy row any migration seeds, as freshness.ts would see them. */
function seededPolicies() {
  const rows = [];
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    if (!sql.includes('intelligence_freshness_policy')) continue;
    // ('pattern', 'CLASS', hours, '...')
    const re = /\(\s*'([^']+)'\s*,\s*'(HIGH_VOLATILITY|MEDIUM_VOLATILITY|LOW_VOLATILITY)'\s*,\s*(\d+)\s*,/g;
    for (let m = re.exec(sql); m; m = re.exec(sql)) {
      rows.push({ fact_key_pattern: m[1], freshness_class: m[2], max_age_hours: Number(m[3]) });
    }
  }
  return rows;
}

/**
 * Every fact key harvest.ts can write.
 *
 * Read from the source rather than from a hand-kept list, because a hand-kept
 * list is exactly the thing that fell out of step here. Two shapes are
 * emitted: a literal `factKey: 'x.y'`, and the tuple table used for the
 * company fields. A template key (`registry.${...}`) is represented by its
 * literal prefix.
 */
function harvestedFactKeys() {
  const src = readFileSync(HARVEST, 'utf8');
  const keys = new Set();

  for (const m of src.matchAll(/factKey:\s*'([A-Za-z][A-Za-z0-9.]*)'/g)) keys.add(m[1]);
  for (const m of src.matchAll(/\[\s*'[A-Za-z]+'\s*,\s*'([a-z][A-Za-z0-9.]*\.[A-Za-z0-9.]+)'\s*\]/g)) keys.add(m[1]);
  for (const m of src.matchAll(/factKey:\s*`([A-Za-z][A-Za-z0-9.]*)\$\{/g)) keys.add(`${m[1]}example`);

  return [...keys].sort();
}

test('harvest emits a fact vocabulary the test can actually see', () => {
  // A guard on the guard: if the regexes stop matching, everything below
  // passes vacuously and the coverage check silently stops running.
  const keys = harvestedFactKeys();
  assert.ok(keys.length >= 15, `only found ${keys.length} fact keys in harvest.ts — the reader is broken`);
  for (const expected of ['parcel.code', 'property.assetClass', 'company.name', 'project.floors', 'listing.price']) {
    assert.ok(keys.includes(expected), `${expected} was not found by the source reader`);
  }
});

test('the migrations seed a policy set the test can actually see', () => {
  const policies = seededPolicies();
  assert.ok(policies.length >= 19, `only parsed ${policies.length} policies — the reader is broken`);
  assert.ok(policies.some((p) => p.fact_key_pattern === 'registry.'));
});

test('every fact harvest can store has a freshness policy', () => {
  const policies = seededPolicies();
  const uncovered = harvestedFactKeys().filter((k) => !policyFor(k, policies));

  assert.deepEqual(
    uncovered,
    [],
    `these facts would be permanently STALE, so the stage holding them can never ease off:\n  ${uncovered.join('\n  ')}`
  );
});

test('no exact rule extends the life of a fast-moving family', () => {
  // An exact rule is MORE SPECIFIC than its prefix, not automatically tighter:
  // project.identity is a name and lives a year inside a project. family that
  // lives a fortnight, which is right. But a family marked HIGH_VOLATILITY is
  // one where being out of date is the failure, and an exact rule that outlives
  // it is how a stale ownership fact comes to be briefed as current.
  const policies = seededPolicies();
  for (const p of policies) {
    if (p.fact_key_pattern.endsWith('.')) continue;
    const parent = policies
      .filter((q) => q.fact_key_pattern.endsWith('.') && p.fact_key_pattern.startsWith(q.fact_key_pattern))
      .sort((a, b) => b.fact_key_pattern.length - a.fact_key_pattern.length)[0];
    if (!parent || parent.freshness_class !== 'HIGH_VOLATILITY') continue;
    assert.ok(
      p.max_age_hours <= parent.max_age_hours,
      `${p.fact_key_pattern} (${p.max_age_hours}h) outlives the fast-moving family ${parent.fact_key_pattern} (${parent.max_age_hours}h)`
    );
  }
});

test('the transaction-critical families stay at six hours', () => {
  // These are what a buyer is exposed to between agreeing a price and signing.
  // Nothing added for cost reasons may quietly extend them.
  const policies = seededPolicies();
  for (const family of ['ownership.', 'encumbrance.', 'rights.', 'registry.']) {
    const p = policyFor(`${family}anything`, policies);
    assert.ok(p, `${family} lost its policy`);
    assert.ok(p.max_age_hours <= 6, `${family} was extended to ${p.max_age_hours}h`);
    assert.equal(p.freshness_class, 'HIGH_VOLATILITY');
  }
});
