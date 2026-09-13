// Literal enum values the Communications service writes must satisfy the
// CHECK constraints the migrations actually declare.
//
// WHY
//
// createContact() wrote import_status: 'COMPLETED' into
// outreach_contact_lists. The column's CHECK is
// ('PENDING','ANALYZING','READY','FAILED','ARCHIVED'), so every insert was
// rejected and "Add contact" failed in production with nothing but a generic
// toast.
//
// The mistake was not careless. This schema also declares
//
//   create type import_status as enum ('PENDING','PROCESSING','COMPLETED','FAILED','CACHED')
//
// — a DIFFERENT thing, with the same name, that does allow 'COMPLETED'. Two
// vocabularies, one identifier. Reading either one and writing against the
// other looks correct right up until the database says no.
//
// A type-checker cannot catch this: both are plain `text` on the wire. So it
// is checked here, against the migrations themselves rather than against a
// list somebody maintains by hand.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const MIG = path.join(ROOT, 'supabase', 'migrations');

/**
 * Allowed values for `table.column`, read from the CHECK constraints declared
 * in the migrations.
 *
 * Only the inline `CHECK (col IN ('A','B'))` form is parsed, which is how this
 * repository writes them. A column whose constraint cannot be found yields
 * null and the assertion is skipped rather than passing vacuously — a check
 * that quietly finds nothing is the failure mode this file exists to prevent.
 */
function allowedValues(column) {
  const files = fs.readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
  let found = null;

  // Searched across all migrations rather than inside one CREATE TABLE body,
  // because this table was created as `contact_lists` and renamed to
  // `outreach_contact_lists` by a later migration — scoping to the current
  // name finds nothing at all.
  //
  // That is safe here because the pattern matches only the CHECK form. The
  // same-named enum TYPE is declared as `create type import_status as enum
  // (...)`, which this cannot match, so the two vocabularies stay separate.
  const check = new RegExp(`check\\s*\\(\\s*${column}\\s+in\\s*\\(([^)]*)\\)`, 'gi');

  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIG, f), 'utf8');
    for (const m of sql.matchAll(check)) {
      found = new Set(
        m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean),
      );
    }
  }
  return found;
}

/** Literal assigned to `key:` in a source file, e.g. `import_status: 'READY'`. */
function literalsAssignedTo(source, key) {
  const out = new Set();
  for (const m of source.matchAll(new RegExp(`${key}\\s*:\\s*'([A-Z_]+)'`, 'g'))) {
    out.add(m[1]);
  }
  return out;
}

const SERVICE = fs.readFileSync(
  path.join(ROOT, 'src', 'services', 'communications.ts'), 'utf8',
);

test('outreach_contact_lists.import_status literals satisfy the column CHECK', () => {
  const allowed = allowedValues('import_status');
  assert.ok(allowed && allowed.size > 0,
    'could not read the import_status CHECK from any migration — this test must not pass vacuously');

  // The exact defect: the enum TYPE of the same name allows COMPLETED, the
  // column does not.
  assert.ok(!allowed.has('COMPLETED'),
    'the constraint changed; this test encodes that COMPLETED is NOT valid here');

  const written = literalsAssignedTo(SERVICE, 'import_status');
  for (const value of written) {
    assert.ok(
      allowed.has(value),
      `communications.ts writes import_status: '${value}', which the column CHECK rejects `
      + `(allowed: ${[...allowed].sort().join(', ')})`,
    );
  }
});

test('a manually added contact lands in a list a campaign can actually select', () => {
  // CampaignBuilderPage offers audiences filtered to import_status READY. A
  // manual list in any other state would save fine and then be invisible in
  // the one place it is needed, which is a worse failure than a refusal.
  const builder = fs.readFileSync(
    path.join(ROOT, 'src', 'pages', 'outreach', 'CampaignBuilderPage.tsx'), 'utf8',
  );
  const required = builder.match(/import_status['"]?\s*,\s*['"]([A-Z_]+)['"]/);
  assert.ok(required, 'the campaign builder no longer filters audiences by import_status');

  const written = literalsAssignedTo(SERVICE, 'import_status');
  assert.ok(
    written.has(required[1]),
    `the campaign builder selects audiences with import_status '${required[1]}', `
    + `but communications.ts creates its manual list as ${[...written].join(', ') || '(nothing)'}`,
  );
});
