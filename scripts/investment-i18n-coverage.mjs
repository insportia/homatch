#!/usr/bin/env node
// Every i18n key Investment Intelligence can reach, including the ones
// i18n-keys-check.mjs cannot see.
//
// WHY THIS GATE EXISTS ON TOP OF i18n:keys
//
// i18n-keys-check.mjs finds literal `t('some_key')` calls. Most of the
// investment product does not have any: the strategy tables, the preset
// engine and the summary builder carry key NAMES as data, and the component
// renders `t(definition.labelKey)`. Every one of those is invisible to the
// literal scan, so before this file existed the entire input form could be
// pointing at keys that do not exist and eight gates would still be green —
// the page would simply render its own key names back at the customer.
//
// The check is deliberately blunt: anything in src/investment or
// src/components/investment that LOOKS like an investment key (a quoted
// `inv_` identifier) must exist in the English bundle. A false positive is
// cheap to fix — it means an identifier was named like a key and is not one,
// and the answer is to rename it. A false negative is a shipped page full of
// `inv_f_purchase_price`.
//
// Keys assembled from a template (`inv_cost_row_${row.key}`) cannot be found
// by any scan, so the small closed sets are listed here by hand and must be
// kept in step with their call sites. There is exactly one such set today.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const SCAN_ROOTS = [
  'src/investment',
  'src/components/investment',
  'src/pages/InvestmentPage.tsx',
];

/**
 * Keys built by string template.
 *
 * A template hides its keys from every scan, so each set is named here —
 * and wherever the set already exists in code, it is READ from that code
 * rather than retyped. The operating-cost list is the reason: it gained two
 * entries in the engine, the breakdown rendered `inv_cost_hoa` at a
 * customer, and a hand-copied list here would have gone stale in exactly
 * the same way.
 */
function operatingCostKeys() {
  const src = readFileSync(
    path.join(ROOT, 'src', 'investment', 'calculations', 'income.ts'),
    'utf8',
  );
  const block = /export const OPERATING_COST_KEYS = \[([\s\S]*?)\] as const;/.exec(src);
  if (!block) {
    console.error('[investment-i18n:coverage] FATAL: could not read OPERATING_COST_KEYS.');
    process.exit(1);
  }
  return [...block[1].matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
}

const TEMPLATED = [
  {
    where: 'src/components/investment/results/RenovateResults.tsx',
    keys: [
      'purchasePrice',
      'acquisitionCosts',
      'renovation',
      'furnishing',
      'otherRenovationCosts',
      'holdingCosts',
    ].map((row) => `inv_cost_row_${row}`),
  },
  {
    where: 'src/investment/calculations/income.ts OPERATING_COST_KEYS',
    keys: operatingCostKeys().map((key) => `inv_cost_${key}`),
  },
];

function walk(target, out) {
  const stats = statSync(target);
  if (stats.isDirectory()) {
    for (const entry of readdirSync(target)) walk(path.join(target, entry), out);
    return out;
  }
  if (/\.(ts|tsx)$/.test(target) && !target.includes('__tests__')) out.push(target);
  return out;
}

function main() {
  const files = [];
  for (const root of SCAN_ROOTS) walk(path.join(ROOT, root), files);

  /** key -> the first file that referenced it, for the failure message. */
  const referenced = new Map();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/['"`](inv_[A-Za-z0-9_]+)['"`]/g)) {
      if (!referenced.has(match[1])) referenced.set(match[1], path.relative(ROOT, file));
    }
  }
  for (const group of TEMPLATED) {
    for (const key of group.keys) {
      if (!referenced.has(key)) referenced.set(key, `${group.where} (template)`);
    }
  }

  // The English bundle is the canonical set; the other five are checked
  // against it by i18n-check.mjs, so a key present here is present in all.
  const translations = readFileSync(
    path.join(ROOT, 'src', 'i18n', 'translations.ts'),
    'utf8',
  );
  const start = translations.indexOf('const en = {');
  if (start === -1) {
    console.error('[investment-i18n:coverage] FATAL: could not find the English bundle.');
    process.exit(1);
  }
  const english = translations.slice(start, translations.indexOf('\n};', start));
  const present = new Set();
  for (const match of english.matchAll(/^\s+(inv_[A-Za-z0-9_]+):/gm)) present.add(match[1]);

  const missing = [...referenced.keys()].filter((key) => !present.has(key)).sort();

  console.log('=== Investment Intelligence i18n coverage ===');
  console.log(`Keys reachable from the product: ${referenced.size}`);
  console.log(`Keys in the English bundle: ${present.size}`);

  /*
   * Every template this gate cannot see into, named out loud.
   *
   * Adding a value to one of these enums adds a key nothing checks — which
   * is exactly how `inv_cost_hoa` reached a customer's screen. Two of them
   * are covered by TEMPLATED above; the rest are listed here every run so
   * the hole is visible rather than assumed away.
   */
  const covered = new Set(TEMPLATED.flatMap((g) => g.keys.map((k) => k.replace(/[^_]+$/, ''))));
  const unchecked = new Set();
  for (const file of files) {
    for (const m of readFileSync(file, 'utf8').matchAll(/`(inv_[a-z_]+)\$\{/g)) {
      if (!covered.has(m[1])) unchecked.add(m[1]);
    }
  }
  if (unchecked.size) {
    console.log(`
Built by template, not checked here: ${[...unchecked].sort().join(', ')}`);
  }

  if (missing.length) {
    console.error(`\n${missing.length} MISSING key(s):\n`);
    for (const key of missing) console.error(`  ${key}  <-  ${referenced.get(key)}`);
    console.error(
      '\n[investment-i18n:coverage] FAILED — add these to scripts/investment-i18n-data*.mjs',
    );
    console.error('and run `node scripts/investment-i18n-apply.mjs`.');
    process.exit(1);
  }

  console.log('\n[investment-i18n:coverage] PASSED — every reachable key resolves.');
}

main();
