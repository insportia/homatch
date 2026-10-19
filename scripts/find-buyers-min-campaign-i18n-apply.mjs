#!/usr/bin/env node
/*
 * Splice the Find Buyers $5 minimum campaign strings (the 50-credit research preset) into
 * src/i18n/translations.ts. Idempotent; uses the shared applier in lib/i18nSplice.mjs
 * (placeholder parity, non-Latin bundles, collisions with other workstreams' keys).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIND_BUYERS_MIN_CAMPAIGN_STRINGS } from './find-buyers-min-campaign-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

// fileURLToPath, not pathname.replace(/^\//,''): the second is right on
// Windows and wrong on Linux, and CI is Linux.
const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'find-buyers-min-campaign-i18n';

const problems = validate(FIND_BUYERS_MIN_CAMPAIGN_STRINGS, TAG);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

const result = splice(FILE, FIND_BUYERS_MIN_CAMPAIGN_STRINGS, {
  banner: 'FIND BUYERS — $5 MINIMUM CAMPAIGN (50-credit research preset)',
  overwrite: process.argv.includes('--overwrite'),
});

console.log(`[${TAG}] ${result.added} added, ${result.replaced} replaced, ${result.unchanged} unchanged.`);
