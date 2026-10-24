#!/usr/bin/env node
/*
 * Splice the purchased-leads → Email Campaigns / Contacts strings (mwe_*) into
 * src/i18n/translations.ts.
 *
 * Uses the shared applier in lib/i18nSplice.mjs: placeholder parity with
 * English, a non-Latin bundle identical to the English one, and a collision
 * with another workstream's key are all checked there. Idempotent: run it
 * again after other workstreams splice and it adds only what is missing.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MATCHING_EMAIL_STRINGS } from './matching-email-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

// fileURLToPath, not pathname.replace(/^\//,''): the second is right on
// Windows and wrong on Linux, and CI is Linux.
const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'matching-email-i18n';

const problems = validate(MATCHING_EMAIL_STRINGS, TAG);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

const result = splice(FILE, MATCHING_EMAIL_STRINGS, {
  banner: 'PURCHASED LEADS → EMAIL CAMPAIGNS + CONTACTS (mwe_*)',
  overwrite: process.argv.includes('--overwrite'),
});

console.log(`[${TAG}] ${result.added} added, ${result.replaced} replaced, ${result.unchanged} unchanged.`);
