// THE R2 CREDENTIAL LIVES IN ONE FILE, AND LOGS NOTHING.
//
// Two invariants, both of which are the kind that hold on the day they are
// written and quietly stop holding six months later:
//
//   1. Exactly one module reads an R2 environment variable. If a second one
//      appears — a "quick fix" that reaches for Deno.env in a handler, or a
//      helper copied into src/ — the blast radius of a leak stops being one
//      file and nobody notices, because everything still works.
//
//   2. Nothing in the storage layer logs a URL. A presigned URL carries a
//      signature: it is a WORKING KEY to the object, and a log line
//      containing one is a credential sitting in a log aggregator with
//      whatever retention that has. The rule is enforced by grep rather than
//      by discipline, because discipline is what fails at 2am.
//
// Neither test can prove the deployment is clean — only that the source
// cannot make it dirty. The deployed side is proven by storage-selftest,
// which reports its own environment as booleans and never a value.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const R2_ENV_NAMES = [
  'R2_S3_ENDPOINT', 'R2_BUCKET', 'R2_REGION', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
];

/** The single file allowed to read them. */
const CREDENTIAL_HOLDER = join('supabase', 'functions', '_shared', 'objectStore.ts');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { walk(full, out); continue; }
    if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

test('exactly one module in the whole repository reads an R2 credential', () => {
  const files = [...walk('src'), ...walk(join('supabase', 'functions'))]
    // This file names them in order to check for them.
    .filter((f) => !f.endsWith('credentialContainment.test.mjs'));

  const readers = files.filter((file) => {
    const src = readFileSync(file, 'utf8');
    return R2_ENV_NAMES.some((name) => src.includes(name));
  }).sort();

  assert.deepEqual(readers, [CREDENTIAL_HOLDER],
    'An R2 environment variable is named outside the one module allowed to read it.\n'
    + `Found in:\n  ${readers.join('\n  ')}`);
});

test('nothing under src/ can reach an R2 credential, so the bundle cannot carry one', () => {
  const offenders = walk('src').filter((file) => {
    const src = readFileSync(file, 'utf8');
    return R2_ENV_NAMES.some((name) => src.includes(name))
      // A browser-side signer would mean a secret in the bundle even if the
      // env name never appeared.
      || /AWS4-HMAC-SHA256|aws4_request/.test(src);
  });
  assert.deepEqual(offenders, [],
    `Browser code must never sign or hold a credential: ${offenders.join(', ')}`);
});

test('the storage layer never logs a URL, a key, or an environment value', () => {
  const layer = [
    join('supabase', 'functions', '_shared', 'objectStore.ts'),
    join('supabase', 'functions', '_shared', 'storageAuth.ts'),
    join('supabase', 'functions', '_shared', 'storage', 'sigv4.ts'),
    join('supabase', 'functions', '_shared', 'storage', 'keys.ts'),
    join('supabase', 'functions', '_shared', 'storage', 'decide.ts'),
    join('supabase', 'functions', 'storage-sign', 'index.ts'),
    join('supabase', 'functions', 'storage-selftest', 'index.ts'),
    join('src', 'services', 'storage', 'objectStore.ts'),
    join('src', 'services', 'storage', 'images.ts'),
  ];

  // Anything that could hold a signed URL or a credential. `url` is included
  // deliberately: it is the variable name every leak of this kind has used.
  const FORBIDDEN_IN_A_LOG = /\b(url|signedUrl|presign|accessKeyId|secretAccessKey|token|Deno\.env)\b/;

  const findings = [];
  for (const file of layer) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // Skip comments: this file's own prose discusses exactly these words.
      const code = line.trim();
      if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
      const call = /console\.(log|info|warn|error|debug|trace)\(([^)]*)/.exec(code);
      if (!call) return;
      if (call[1] === 'log') {
        findings.push(`${file}:${i + 1} console.log has no place in the storage layer`);
        return;
      }
      if (FORBIDDEN_IN_A_LOG.test(call[2])) {
        findings.push(`${file}:${i + 1} logs something that may be a credential: ${code}`);
      }
    });
  }

  assert.deepEqual(findings, [], findings.join('\n'));
});
