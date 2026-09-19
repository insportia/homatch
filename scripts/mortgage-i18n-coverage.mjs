#!/usr/bin/env node
// Every i18n key Home Financing can reach — including the ones that
// live in a DATABASE ROW rather than in source.
//
// WHY THIS GATE EXISTS
//
// `t(rule.humanExplanation)` is invisible to every scanner in this
// repository: the key is a column value, so neither i18n-keys-check's
// literal scan nor a `inv_`-style identifier sweep can see it. On
// 2026-09-19 the live Home Financing page was printing the literal
// string "mortgage_kb_subsidy_human_explanation" into the subsidy card,
// in every language, because nine `mortgage_kb_*` keys referenced by
// mortgage_rules rows had never been added to any bundle. Eight gates
// were green.
//
// So this gate checks three sources:
//
//   1. quoted `mortgage_*` identifiers anywhere under the mortgage
//      product — the same blunt sweep the investment gate uses;
//   2. keys assembled from a template, listed here with the set that
//      builds them;
//   3. keys stored as DATA, read from the knowledge-base seed
//      migrations, because those are the rows production holds.
//
// Source 3 is the one that would have caught the live defect, and it is
// read from the migrations rather than from a hand-maintained list for
// the same reason the rest of the knowledge base is: a list somebody
// has to remember to update is a list that goes stale.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const SCAN_ROOTS = [
  'src/mortgage',
  'src/components/mortgage',
  'src/components/workspace',
  'src/pages/MortgagePage.tsx',
];

/** Keys built by string template, with the set that builds them. */
const TEMPLATED = [];

function walk(target, out) {
  const stats = statSync(target);
  if (stats.isDirectory()) {
    for (const entry of readdirSync(target)) walk(path.join(target, entry), out);
    return out;
  }
  if (/\.(ts|tsx)$/.test(target) && !target.includes('__tests__')) out.push(target);
  return out;
}

/**
 * Keys that reach the UI as knowledge-base column values.
 *
 * Read out of every mortgage migration: `human_explanation` is rendered
 * through t() directly, and the jsonb payloads carry description,
 * prompt and subsidy-text keys that the programme view renders the same
 * way. The blunt pattern is deliberate — a key spelled inside a
 * jsonb_build_object call is still a key, and a narrower parser would
 * be one schema change away from missing the next one.
 */
function knowledgeBaseKeys() {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const keys = new Set();
  for (const file of readdirSync(dir).filter((f) => f.includes('mortgage') && f.endsWith('.sql'))) {
    const sql = readFileSync(path.join(dir, file), 'utf8');
    for (const match of sql.matchAll(/'(mortgage_kb_[A-Za-z0-9_]+)'/g)) keys.add(match[1]);
  }
  return [...keys];
}

function main() {
  const files = [];
  for (const root of SCAN_ROOTS) walk(path.join(ROOT, root), files);

  /** key -> the first place that referenced it, for the failure message. */
  const referenced = new Map();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/['"`](mortgage_[A-Za-z0-9_]+)['"`]/g)) {
      if (!referenced.has(match[1])) referenced.set(match[1], path.relative(ROOT, file));
    }
    for (const match of source.matchAll(/['"`](wk_[A-Za-z0-9_]+)['"`]/g)) {
      if (!referenced.has(match[1])) referenced.set(match[1], path.relative(ROOT, file));
    }
  }
  for (const group of TEMPLATED) {
    for (const key of group.keys) {
      if (!referenced.has(key)) referenced.set(key, `${group.where} (template)`);
    }
  }
  for (const key of knowledgeBaseKeys()) {
    if (!referenced.has(key)) referenced.set(key, 'supabase/migrations (knowledge-base row)');
  }

  const translations = readFileSync(path.join(ROOT, 'src', 'i18n', 'translations.ts'), 'utf8');
  const start = translations.indexOf('const en = {');
  if (start === -1) {
    console.error('[mortgage-i18n:coverage] FATAL: could not find the English bundle.');
    process.exit(1);
  }
  const english = translations.slice(start, translations.indexOf('\n};', start));
  const present = new Set();
  for (const match of english.matchAll(/^\s+((?:mortgage|wk)_[A-Za-z0-9_]+):/gm)) present.add(match[1]);

  const missing = [...referenced.keys()].filter((key) => !present.has(key)).sort();

  console.log('=== Home Financing i18n coverage ===');
  console.log(`Keys reachable from the product: ${referenced.size}`);
  console.log(`  of which stored in knowledge-base rows: ${knowledgeBaseKeys().length}`);
  console.log(`Keys in the English bundle: ${present.size}`);

  if (missing.length) {
    console.error(`\n${missing.length} MISSING key(s):\n`);
    for (const key of missing) console.error(`  ${key}  <-  ${referenced.get(key)}`);
    console.error('\n[mortgage-i18n:coverage] FAILED — add these to scripts/mortgage-i18n-data*.mjs');
    console.error('and run `node scripts/mortgage-i18n-apply.mjs`.');
    process.exit(1);
  }

  console.log('\n[mortgage-i18n:coverage] PASSED — every reachable key resolves.');
}

main();
