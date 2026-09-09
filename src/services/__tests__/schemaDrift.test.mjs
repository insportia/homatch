import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/*
 * SCHEMA DRIFT — STATIC.
 *
 * An entire typed product layer shipped against tables that did not exist:
 * developer_profiles, developer_projects, property_trust_scores,
 * canonical_property_groups, canonical_property_sources,
 * external_contact_unlocks, active_search_subscriptions and
 * sponsored_placements. Services called them, pages rendered them, an Edge
 * Function served them, and every query failed against a missing relation.
 *
 * Several of those call sites discard the Supabase error, so the pages showed
 * an empty state. "No data yet" and "this feature has no storage" looked
 * identical from the outside, which is why it survived.
 *
 * This test makes the next one impossible to ship quietly: every table the
 * application queries must be created by a migration in this repository.
 */

const ROOT = process.cwd();
const MIG = path.join(ROOT, 'supabase', 'migrations');

/** Relations any migration creates — tables, partitioned tables and views. */
function declaredRelations() {
  const out = new Set();
  for (const f of fs.readdirSync(MIG)) {
    if (!f.endsWith('.sql')) continue;
    const sql = fs.readFileSync(path.join(MIG, f), 'utf8');
    for (const m of sql.matchAll(
      /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?(?:table|view)\s+(?:if\s+not\s+exists\s+)?(?:public\.)?["']?([a-z_][a-z0-9_]*)["']?/gi
    )) {
      out.add(m[1].toLowerCase());
    }
    // `alter table x rename to y` also produces a relation named y.
    for (const m of sql.matchAll(/alter\s+table\s+(?:public\.)?[a-z_0-9]+\s+rename\s+to\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi)) {
      out.add(m[1].toLowerCase());
    }
  }
  return out;
}

/** Every `.from('x')` the application code issues. */
function queriedRelations() {
  const hits = new Map();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '__tests__') continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(e.name)) {
        const s = fs.readFileSync(full, 'utf8');
        for (const m of s.matchAll(/\.from\(\s*'([a-z_][a-z0-9_]*)'\s*\)/g)) {
          if (!hits.has(m[1])) hits.set(m[1], path.relative(ROOT, full));
        }
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  walk(path.join(ROOT, 'supabase', 'functions'));
  return hits;
}

/** Relations that live outside public and are not created by our migrations. */
const NOT_OURS = new Set([
  'objects',   // storage.objects, reached through the storage client
  'buckets',
]);

test('every table the application queries is created by a migration', () => {
  const declared = declaredRelations();
  const queried = queriedRelations();
  assert.ok(queried.size > 20, `expected many .from() calls, found ${queried.size}`);

  const missing = [...queried.entries()]
    .filter(([t]) => !declared.has(t) && !NOT_OURS.has(t))
    .map(([t, f]) => `${t}  (${f})`);

  assert.deepEqual(
    missing,
    [],
    'these relations are queried but no migration creates them:\n  ' + missing.join('\n  ')
  );
});

test('the phase 3 layer now has its schema', () => {
  const declared = declaredRelations();
  for (const t of [
    'developer_profiles',
    'developer_projects',
    'property_trust_scores',
    'canonical_property_groups',
    'canonical_property_sources',
    'external_contact_unlocks',
    'active_search_subscriptions',
    'sponsored_placements',
  ]) {
    assert.ok(declared.has(t), `${t} must be created by a migration`);
  }
});

test('derived intelligence is not writable by a customer', () => {
  // A customer must not be able to author a developer's trust score, a
  // property's provenance, or a record of a purchase they did not make.
  const sql = fs.readFileSync(path.join(MIG, '20260911140000_phase3_schema.sql'), 'utf8');
  const revoke = sql.slice(sql.toLowerCase().lastIndexOf('revoke insert'));
  for (const t of [
    'developer_profiles',
    'developer_projects',
    'property_trust_scores',
    'canonical_property_groups',
    'canonical_property_sources',
    'external_contact_unlocks',
  ]) {
    assert.match(revoke, new RegExp(t), `${t} must have client writes revoked`);
  }
  assert.match(revoke, /from authenticated, anon/i);
});

test('a paid unlock cannot be recorded twice for the same match', () => {
  const sql = fs.readFileSync(path.join(MIG, '20260911140000_phase3_schema.sql'), 'utf8');
  assert.match(
    sql,
    /create unique index[\s\S]*external_contact_unlocks \(user_id, match_id\)/i,
    'the same protection match_unlocks already has'
  );
});
