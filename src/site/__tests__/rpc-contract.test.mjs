import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * THE CLIENT AND THE DATABASE MUST AGREE ON ARGUMENT NAMES.
 *
 * PostgREST resolves an RPC by the NAMES of the arguments in the request
 * body, not their order or types. So renaming a parameter on either side
 * produces a 404 at runtime and nothing at all at compile time: the
 * TypeScript is valid, the SQL is valid, and the feature is silently dead.
 *
 * That is not hypothetical. It shipped: the client sent `p_note` to
 * site_save_draft, whose third parameter is `p_title`, and every save
 * returned 404 while the editor showed no error. It was found by applying
 * the migration and pressing the button, which is an expensive way to
 * discover a typo.
 *
 * This test reads both files and compares them directly. It needs no
 * database, so it runs in the normal suite and fails the moment the two
 * drift apart.
 */

const service = readFileSync('src/services/siteContent.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20260912090000_site_studio.sql', 'utf8');

/** Every supabase.rpc('name', { p_x: ..., p_y: ... }) in the service. */
function clientCalls(source) {
  const calls = new Map();
  const re = /supabase\.rpc\(\s*'([a-z_]+)'\s*,\s*\{([^}]*)\}/gs;
  for (const m of source.matchAll(re)) {
    const args = [...m[2].matchAll(/(\bp_[a-z_]+)\s*:/g)].map(a => a[1]);
    calls.set(m[1], args.sort());
  }
  // The single-argument form written inline on one line.
  const inline = /supabase\.rpc\(\s*'([a-z_]+)'\s*,\s*\{\s*(p_[a-z_]+)\s*:[^}]*\}\s*\)/g;
  for (const m of source.matchAll(inline)) {
    if (!calls.has(m[1])) calls.set(m[1], [m[2]]);
  }
  return calls;
}

/** Every create-or-replace function signature in the migration. */
function sqlSignatures(sql) {
  const sigs = new Map();
  const re = /create\s+or\s+replace\s+function\s+public\.([a-z_]+)\s*\(([^)]*)\)/gis;
  for (const m of sql.matchAll(re)) {
    const params = [...m[2].matchAll(/(\bp_[a-z_]+)\s+[a-z]/gi)].map(p => p[1]);
    sigs.set(m[1], params.sort());
  }
  return sigs;
}

const calls = clientCalls(service);
const sigs = sqlSignatures(migration);

test('the service actually calls the Site Studio RPCs', () => {
  // Guards the guard: a regex that quietly matches nothing would make every
  // assertion below vacuously true.
  assert.ok(calls.size >= 5, `expected at least 5 rpc call sites, found ${calls.size}`);
  assert.ok(sigs.size >= 5, `expected at least 5 sql functions, found ${sigs.size}`);
});

test('every RPC the client calls exists in the migration', () => {
  for (const name of calls.keys()) {
    assert.ok(sigs.has(name), `client calls ${name}(), which the migration does not define`);
  }
});

test('every RPC call sends exactly the argument names the function declares', () => {
  for (const [name, sent] of calls) {
    const declared = sigs.get(name);
    if (!declared) continue;

    for (const arg of sent) {
      assert.ok(
        declared.includes(arg),
        `${name}(): client sends "${arg}", which the function does not declare. `
        + `PostgREST resolves by name, so this is a 404 at runtime. `
        + `Declared: ${declared.join(', ')}`,
      );
    }
  }
});

test('no required parameter is left unsent', () => {
  // A parameter with no DEFAULT must be supplied or the call cannot resolve.
  for (const [name, sent] of calls) {
    const body = migration.match(
      new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(([^)]*)\\)`, 'is'),
    );
    if (!body) continue;

    const required = [...body[1].matchAll(/(\bp_[a-z_]+)\s+[a-z ]+?(?=,|$)/gi)]
      .filter(p => !/default/i.test(p[0]))
      .map(p => p[1]);

    for (const arg of required) {
      assert.ok(
        sent.includes(arg),
        `${name}(): "${arg}" has no default and the client never sends it`,
      );
    }
  }
});
