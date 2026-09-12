// The test harness must never become a production auth bypass.
//
// A signed-in browser test needs a session. There are two ways to get one, and
// only one of them is safe:
//
//   1. Add a flag to the app — `if (import.meta.env.VITE_E2E) fakeSession()`.
//      This is the dangerous one. It lives in src/, it ships in the bundle,
//      and it is one misconfigured environment variable away from letting
//      anybody sign in as anybody. Plenty of real breaches started here.
//
//   2. Leave the app completely alone and lie to it from OUTSIDE — build the
//      ordinary bundle against an origin that does not resolve, intercept the
//      network in the test driver, and seed localStorage the way the browser
//      would have. The shipped code cannot tell the difference, and there is
//      nothing in it to misconfigure.
//
// tests/browser/ takes route 2. This file is what keeps it there. It fails if
// anyone ever drifts toward route 1, and it fails loudly enough to explain
// why rather than just going red.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js|jsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/*
 * Shapes that would make a shipped bundle able to fabricate a session.
 *
 * Deliberately about the DANGEROUS shape, not about the word "harness": a
 * bypass named `devLogin` would be just as fatal and would sail past a
 * name-based check.
 */
const DANGEROUS = [
  { re: /\bVITE_(E2E|TEST_AUTH|AUTH_BYPASS|SKIP_AUTH|HARNESS_AUTH)\b/, why: 'an env flag that could switch authentication off in a shipped bundle' },
  { re: /\bsetSession\s*\(\s*\{[^}]*access_token\s*:\s*['"`]/, why: 'a hardcoded access token handed to supabase.auth.setSession' },
  { re: /\bbypass[_A-Za-z]*auth\b/i, why: 'an authentication bypass' },
  { re: /\bfake(Session|Auth|User)\s*\(/, why: 'a fabricated session inside application code' },
];

test('no application source can fabricate or skip a session', () => {
  const found = [];
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const { re, why } of DANGEROUS) {
      if (re.test(text)) found.push(`${relative(ROOT, file)}: ${why}`);
    }
  }
  assert.deepEqual(found, [],
    'application code must never be able to manufacture a session. The browser ' +
    'harness works by intercepting the network from outside the bundle, exactly ' +
    'so that this stays true:\n  - ' + found.join('\n  - '));
});

test('no application source imports anything from the test harness', () => {
  const offenders = [];
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (/(^|\/)tests\//.test(spec) || /commFixtures/.test(spec) || /harness/i.test(spec)) {
        offenders.push(`${relative(ROOT, file)} imports ${spec}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    'a fixture reachable from src/ is a fixture that can ship:\n  - ' + offenders.join('\n  - '));
});

test('the production build config knows nothing about the harness', () => {
  const vite = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
  assert.ok(!/harness|stubproj|commFixtures/i.test(vite),
    'vite.config.ts must not reference the harness. The harness is a MODE ' +
    '(.env.harness) over the ordinary config, not a second build with different ' +
    'code in it — that is the whole reason the sweep tests what actually ships.');

  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.ok(!/harness|stubproj/i.test(html), 'index.html must not reference the harness');
});

test('the harness origin is inert and the harness key is not a credential', () => {
  const env = readFileSync(join(ROOT, '.env.harness'), 'utf8');

  const url = /VITE_SUPABASE_URL=(\S+)/.exec(env)?.[1] ?? '';
  assert.equal(url, 'https://stubproj.supabase.co',
    'the harness must point at the non-resolving stub origin; a harness aimed at ' +
    'a real project is a test that mutates real data');

  const key = /VITE_SUPABASE_ANON_KEY=(\S+)/.exec(env)?.[1] ?? '';
  // A real Supabase key is a JWT: three base64url segments. Anything with that
  // shape in a committed file is a leaked credential, whatever it is called.
  assert.ok(!/^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key),
    '.env.harness contains something shaped like a real JWT. Committed files may ' +
    'never carry a credential, even an expired or low-privilege one.');

  // And the real .env, which does carry a key, must stay untracked.
  if (existsSync(join(ROOT, '.env'))) {
    const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
    assert.ok(/^\.env$/m.test(ignore) || /^\.env\b/m.test(ignore),
      '.env exists but .gitignore does not exclude it');
  }
});

test('the sweep fixtures carry no secret-shaped values', () => {
  const dir = join(ROOT, 'tests', 'browser');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.mjs'))) {
    const text = readFileSync(join(dir, file), 'utf8');
    /*
     * The fixture reports whether a provider's credentials are PRESENT. That
     * boolean is the entire contract with the admin UI — there is no field a
     * secret could travel in. This checks the fixture never grows one.
     */
    const leaks = [];
    for (const m of text.matchAll(/(sk-[A-Za-z0-9]{16,}|EAA[A-Za-z0-9]{20,}|SG\.[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})/g)) {
      leaks.push(m[1].slice(0, 8) + '…');
    }
    assert.deepEqual(leaks, [], `${file} contains something shaped like a real secret: ${leaks.join(', ')}`);
  }
});
