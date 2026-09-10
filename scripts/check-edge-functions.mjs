#!/usr/bin/env node
/*
 * Syntax-check the Supabase edge functions.
 *
 * WHY THIS EXISTS
 *
 * `tsc --noEmit` covers src/ and nothing else. The edge functions under
 * supabase/functions/ are Deno TypeScript with URL and jsr: imports, so they
 * are outside the tsconfig — and nothing else parses them either. The whole
 * pipeline was green (type-check, lint, 796 tests, mobile) on a
 * research-agent/index.ts that could not be parsed at all:
 *
 *   Failed to bundle the function (reason: The module's source code could not
 *   be parsed: Expected ',', got '<lexing error ...>')
 *
 * The first thing that noticed was the deploy step, after CI had passed and
 * after the commit was on main. A syntax error in a customer-facing function
 * should be a failing check, not a failed deployment.
 *
 * HOW
 *
 * tsc with --noResolve parses each file and reports syntax errors while
 * ignoring the imports it cannot resolve, which is exactly the split we want:
 * a Deno URL import is not a mistake, an unbalanced quote is. Type errors are
 * not meaningful without resolution, so only syntax diagnostics are failed on.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = 'supabase/functions';

const entries = [];
for (const dir of readdirSync(ROOT)) {
  const full = join(ROOT, dir);
  if (!statSync(full).isDirectory()) continue;
  const index = join(full, 'index.ts');
  try {
    if (statSync(index).isFile()) entries.push(index);
  } catch {
    /* a directory without an index.ts is shared code, not a function */
  }
}

if (entries.length === 0) {
  console.error(`No edge functions found under ${ROOT}/ — refusing to report success.`);
  process.exit(1);
}

console.log(`[edge-check] parsing ${entries.length} edge function(s)...`);

const res = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsc', '--noEmit', '--noResolve', '--allowJs', 'false', '--target', 'esnext', '--module', 'esnext', ...entries],
  { encoding: 'utf8', shell: process.platform === 'win32' }
);

const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;

/*
 * TS1xxx is the syntax range. Everything outside it here is a resolution or
 * type complaint caused by --noResolve, and is expected.
 *
 * Two things live in that range, and only one of them stops a deploy:
 *
 *   fatal    the file cannot be parsed — an unterminated string, a stray
 *            brace, an invalid character. Deno refuses to bundle it, which
 *            is the failure this script exists to catch.
 *   grammar  legal JavaScript that TypeScript objects to, such as TS1117,
 *            a duplicate key in an object literal. Deno bundles it happily.
 *
 * The grammar ones are reported, because they are usually mistakes worth
 * knowing about, but they do not fail the check: there is one in
 * import-property/index.ts today, and failing on it would block every
 * unrelated change until somebody fixes it.
 */
const NON_FATAL = new Set([
  'TS1117', // duplicate property in an object literal
]);

const inSyntaxRange = output.split('\n').filter((l) => /error TS1\d{3}:/.test(l));
const fatal = inSyntaxRange.filter((l) => !NON_FATAL.has((l.match(/error (TS1\d{3}):/) ?? [])[1]));
const grammar = inSyntaxRange.filter((l) => NON_FATAL.has((l.match(/error (TS1\d{3}):/) ?? [])[1]));

if (grammar.length) {
  console.warn('[edge-check] grammar warnings (these still bundle):');
  for (const w of grammar) console.warn('  ' + w.trim());
}

if (fatal.length) {
  console.error('\n[edge-check] the following cannot be parsed and WILL fail the deploy:\n');
  for (const e of fatal) console.error('  ' + e.trim());
  process.exit(1);
}

/*
 * PASS 2 — does everything it calls actually exist?
 *
 * Pass 1 proves the file PARSES. It cannot prove the file is coherent: a call
 * to a function that has been moved or renamed is perfectly good syntax, and
 * the Supabase bundler does not check references either. So a
 * research-agent/index.ts calling a function that had moved into a shared
 * module passed the syntax gate, passed the bundler, deployed successfully,
 * and returned
 *
 *   500 {"error":"Internal server error","detail":"extractControlStructure is not defined"}
 *
 * on the customer's very next report view.
 *
 * With module resolution ON, tsc reports exactly that as TS2304. The only
 * TS2304s on a healthy tree are the Deno runtime globals, which are real and
 * simply absent from this repo's lib — so they are allowed by name, and
 * anything else is a genuine missing reference.
 */
const DENO_GLOBALS = new Set(['Deno', 'EdgeRuntime']);

console.log('[edge-check] checking references...');

const refRes = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsc', '--noEmit', '--allowJs', 'false', '--target', 'esnext', '--module', 'esnext', '--moduleResolution', 'bundler', ...entries],
  { encoding: 'utf8', shell: process.platform === 'win32' }
);

const refOutput = `${refRes.stdout ?? ''}${refRes.stderr ?? ''}`;
const missing = refOutput
  .split('\n')
  .filter((l) => l.startsWith('supabase/functions') && l.includes('TS2304'))
  .filter((l) => {
    const name = (l.match(/Cannot find name '([^']+)'/) ?? [])[1];
    return name && !DENO_GLOBALS.has(name);
  });

if (missing.length) {
  console.error('\n[edge-check] these are called but do not exist — the function will throw at runtime:\n');
  for (const m of missing) console.error('  ' + m.trim());
  process.exit(1);
}

console.log(`[edge-check] all ${entries.length} edge functions parse, and every reference resolves.`);
