#!/usr/bin/env node
/*
 * Splice the Verify official-history and Admin official-sources strings into src/i18n/translations.ts.
 *
 * Uses the shared applier in lib/i18nSplice.mjs: placeholder parity with
 * English, a non-Latin bundle identical to the English one, and a collision
 * with another workstream's key are all checked there rather than
 * re-implemented here.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERIFY_OFFICIAL_STRINGS } from './verify-official-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

// fileURLToPath, not pathname.replace(/^\//,''): the second is right on
// Windows and wrong on Linux, and CI is Linux.
const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'verify-official-i18n';

const problems = validate(VERIFY_OFFICIAL_STRINGS, TAG);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

const result = splice(FILE, VERIFY_OFFICIAL_STRINGS, {
  banner: 'VERIFY OFFICIAL HISTORY + ADMIN OFFICIAL SOURCES',
  overwrite: process.argv.includes('--overwrite'),
});

console.log(`[${TAG}] ${result.added} key(s) added, ${result.skipped} already present.`);
