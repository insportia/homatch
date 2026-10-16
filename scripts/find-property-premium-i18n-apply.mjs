#!/usr/bin/env node
/*
 * Splice the Find Property premium-results strings (fpp_*) into src/i18n/translations.ts.
 * Idempotent: a second run adds nothing. Checks (placeholder parity, non-Latin
 * bundles not identical to English, collisions) live in lib/i18nSplice.mjs.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIND_PROPERTY_PREMIUM_STRINGS } from './find-property-premium-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'find-property-premium-i18n';

const problems = validate(FIND_PROPERTY_PREMIUM_STRINGS, TAG);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

const result = splice(FILE, FIND_PROPERTY_PREMIUM_STRINGS, {
  banner: 'FIND PROPERTY PREMIUM RESULTS (labels, recommendation, status, live search)',
  tag: TAG,
  overwrite: process.argv.includes('--overwrite'),
});
if (result.collisions?.length) { console.error(`[${TAG}] collisions: ${result.collisions.join(', ')}`); process.exit(1); }
console.log(`[${TAG}] ${result.added} added, ${result.replaced} replaced, ${result.unchanged} unchanged.`);
