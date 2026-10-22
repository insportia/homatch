#!/usr/bin/env node
/*
 * Splice the Find Buyers 2.0 smart match expansion strings (hl_cat_*, hl_why_*, hl_unc_*,
 * hl_reach_*, hl_band_*, prices) into src/i18n/translations.ts. hl_bulk_standard now names
 * the nearby / similar tier, so the apply runs with --overwrite.
 *
 * Uses the shared applier in lib/i18nSplice.mjs: placeholder parity with
 * English, a non-Latin bundle identical to the English one, and a collision
 * with another workstream's key are all checked there rather than
 * re-implemented here.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIND_BUYERS_MATCH_EXPANSION_STRINGS } from './find-buyers-match-expansion-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

// fileURLToPath, not pathname.replace(/^\//,''): the second is right on
// Windows and wrong on Linux, and CI is Linux.
const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'find-buyers-match-expansion-i18n';

const problems = validate(FIND_BUYERS_MATCH_EXPANSION_STRINGS, TAG);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

const result = splice(FILE, FIND_BUYERS_MATCH_EXPANSION_STRINGS, {
  banner: 'FIND BUYERS 2.0 — SMART INTERNAL MATCH EXPANSION (categories, evidence, reach controls, tiered prices)',
  overwrite: process.argv.includes('--overwrite'),
});

console.log(`[${TAG}] ${result.added} added, ${result.replaced} replaced, ${result.unchanged} unchanged.`);
