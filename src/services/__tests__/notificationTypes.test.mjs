import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/*
 * NOTIFICATION TYPE CONTRACT — STATIC.
 *
 * notifications.type is a Postgres enum. Sending a value that is not in it
 * makes the INSERT fail, and every call site wraps that insert in a catch, so
 * the failure is silent: the customer is simply never told.
 *
 * That is exactly what happened. Four of the five types the code sent --
 * MATCH_AVAILABLE, CREDITS_TOPPED_UP, RESEARCH_PRODUCT_PURCHASED -- were not
 * in the enum, so active-search matches, matching results, credit top-ups and
 * research purchases produced no notification at all, for as long as the code
 * had existed.
 *
 * This test makes that class of failure impossible to reintroduce quietly.
 */

const ROOT = process.cwd();

/** The six values the enum was originally created with. */
const ORIGINAL = [
  'IMPORT_COMPLETED',
  'IMPORT_FAILED',
  'MATCHING_STARTED',
  'MATCHING_PAUSED',
  'LOW_CREDITS',
  'MATCH_FOUND',
];

/** Everything later migrations add. Read from the migrations themselves so
 * the test cannot drift from what production actually has. */
function addedByMigrations() {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const out = new Set();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.sql')) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of sql.matchAll(
      /alter\s+type\s+(?:public\.)?notification_type\s+add\s+value\s+(?:if\s+not\s+exists\s+)?'([A-Z_]+)'/gi
    )) {
      out.add(m[1]);
    }
  }
  return out;
}

/** Every `type:` value on an insert into notifications, across the repo. */
function typesUsedInCode() {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '__tests__') continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(e.name)) files.push(full);
    }
  };
  walk(path.join(ROOT, 'src'));
  walk(path.join(ROOT, 'supabase', 'functions'));

  const used = new Map();
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    let i = s.indexOf("from('notifications')");
    while (i !== -1) {
      // The insert payload follows the call; a short window is enough and
      // avoids picking up unrelated `type:` fields elsewhere in the file.
      const window = s.slice(i, i + 700);
      for (const m of window.matchAll(/\btype:\s*'([A-Z_]+)'/g)) {
        if (!used.has(m[1])) used.set(m[1], path.relative(ROOT, f));
      }
      i = s.indexOf("from('notifications')", i + 1);
    }
  }
  return used;
}

test('every notification type the code sends exists in the enum', () => {
  const valid = new Set([...ORIGINAL, ...addedByMigrations()]);
  const used = typesUsedInCode();
  assert.ok(used.size > 0, 'expected to find notification inserts');

  const invalid = [...used.entries()].filter(([t]) => !valid.has(t));
  assert.deepEqual(
    invalid,
    [],
    `these types would fail the enum and be swallowed by the call site's catch:\n` +
      invalid.map(([t, f]) => `  ${t} (${f})`).join('\n')
  );
});

test('the migration adds every type that was previously failing', () => {
  const added = addedByMigrations();
  for (const t of ['MATCH_AVAILABLE', 'CREDITS_TOPPED_UP', 'RESEARCH_PRODUCT_PURCHASED']) {
    assert.ok(added.has(t), `${t} was being sent and must be added to the enum`);
  }
});

test('notification inserts use the real column name', () => {
  // The column is `read`. `is_read` does not exist, and an insert naming it
  // fails -- silently, like the enum mismatch did.
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '__tests__') continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(e.name)) files.push(full);
    }
  };
  walk(path.join(ROOT, 'src'));
  walk(path.join(ROOT, 'supabase', 'functions'));

  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    if (!s.includes("from('notifications')")) continue;
    assert.ok(
      !/\bis_read\s*:/.test(s),
      `${path.relative(ROOT, f)} writes is_read; the column is "read"`
    );
  }
});

/* ---------------------------------------------------------------- *
 * Billing idempotency                                               *
 * ---------------------------------------------------------------- */

test('credit_ledger has a unique key so a retry cannot charge twice', () => {
  const sql = fs.readFileSync(
    path.join(ROOT, 'supabase', 'migrations', '20260911130000_credit_ledger_idempotency.sql'),
    'utf8'
  );
  assert.match(sql, /create unique index[\s\S]*credit_ledger \(user_id, type, reference\)/i);
  // Partial: a NULL reference makes no idempotency claim.
  assert.match(sql, /where reference is not null/i);
  // Keyed on type as well, so reserve -> capture -> release may share a
  // reference while an exact retry of one of them cannot. Checked against the
  // statement itself, not the file: the rationale comment above it discusses
  // the (user_id, reference) form it deliberately rejects.
  const stmt = sql.slice(sql.toLowerCase().indexOf('create unique index'));
  assert.ok(!/on public\.credit_ledger \(user_id, reference\)/i.test(stmt));
});
