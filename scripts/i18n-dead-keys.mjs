#!/usr/bin/env node
// Dead translation-key auditor — `node scripts/i18n-dead-keys.mjs [--fix]`.
//
// Verify V2 left keys behind that nothing renders any more, and a bundle
// that keeps growing with keys no screen reads is a bundle nobody can trust
// to describe the product.
//
// DELIBERATELY CONSERVATIVE. Deleting a key that IS used ships a raw
// `verify_foo_bar` to a customer, which is far worse than carrying a few
// stale strings. So a key counts as USED if any of these hold:
//
//   1. the exact quoted key appears anywhere under src/ outside the bundle
//      — this covers t('k'), a key held in a constant, a key in an array,
//      and a key passed through a variable;
//   2. it matches the static prefix of a key built in a template literal,
//      e.g. t(`verify_pstep_${phase}`) protects every verify_pstep_* key;
//   3. it matches a prefix this file explicitly protects below.
//
// Only what survives all three is reported, and --fix removes it from every
// language bundle at once.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const BUNDLE = join(ROOT, 'src/i18n/translations.ts');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.dist-ci', 'coverage', '__tests__', 'tests']);
const CODE_EXT = new Set(['.ts', '.tsx', '.mjs', '.js']);

/*
 * Prefixes whose keys are chosen at runtime from data rather than written
 * out in source. Anything here is off limits to the remover regardless of
 * whether a literal occurrence can be found.
 */
const DYNAMIC_PREFIXES = [
  'prop_condition_',   // property condition enum
  'verify_role_',      // participant roles
  'verify_pstep_',     // research phase labels
  'verify_dim_',       // summary dimensions
  'verify_mkt_',       // market comparison tiers
  'verify_narr_',      // research narrative lines
  'verify_fact_',      // live fact captions
  'verify_src_',       // evidence provenance labels
  'notif_type_',       // notification type copy
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (CODE_EXT.has(extname(name))) yield full;
  }
}

const bundleSrc = readFileSync(BUNDLE, 'utf8');

/** Keys of the canonical `en` bundle, which defines TranslationKey. */
const enStart = bundleSrc.indexOf('const en = {');
const enEnd = bundleSrc.indexOf('\n};', enStart);
const enKeys = [...bundleSrc.slice(enStart, enEnd).matchAll(/^ {2}([a-zA-Z0-9_]+):/gm)].map((m) => m[1]);

/** Everything the app could possibly be reading, bundle excluded. */
let code = '';
for (const file of walk(join(ROOT, 'src'))) {
  if (file === BUNDLE) continue;
  // A TEST that names a key is not a screen that renders it — and several
  // tests name keys precisely to assert they are GONE. Counting those as
  // usage is how verify_ir_actions_title survived the first sweep.
  if (/\.test\.mjs$/.test(file)) continue;
  code += readFileSync(file, 'utf8') + '\n';
}
for (const dir of ['scripts', 'supabase/functions']) {
  try {
    for (const file of walk(join(ROOT, dir))) code += readFileSync(file, 'utf8') + '\n';
  } catch { /* optional */ }
}

/** Static prefixes of keys assembled in template literals. */
const templatePrefixes = [...code.matchAll(/`([a-zA-Z0-9_]+)\$\{/g)].map((m) => m[1]);
const protectedPrefixes = [...new Set([...DYNAMIC_PREFIXES, ...templatePrefixes])];

const dead = enKeys.filter((key) => {
  if (code.includes(`'${key}'`) || code.includes(`"${key}"`) || code.includes(`\`${key}\``)) return false;
  if (protectedPrefixes.some((p) => p && key.startsWith(p))) return false;
  return true;
});

console.log(`\n=== i18n dead-key audit ===`);
console.log(`Canonical keys: ${enKeys.length}`);
console.log(`Protected dynamic prefixes: ${protectedPrefixes.filter(Boolean).length}`);
console.log(`Unreferenced: ${dead.length}`);
if (dead.length) console.log(dead.map((k) => `  ${k}`).join('\n'));

if (!process.argv.includes('--fix')) {
  console.log(dead.length ? '\nRun with --fix to remove them from every bundle.' : '\n[i18n:dead] No dead keys.');
  process.exit(0);
}

if (!dead.length) process.exit(0);

const doomed = new Set(dead);
const kept = bundleSrc
  .split('\n')
  .filter((line) => {
    const m = line.match(/^ {2}([a-zA-Z0-9_]+):/);
    return !(m && doomed.has(m[1]));
  })
  .join('\n');

writeFileSync(BUNDLE, kept, 'utf8');
console.log(`\nRemoved ${dead.length} keys from every language bundle.`);
