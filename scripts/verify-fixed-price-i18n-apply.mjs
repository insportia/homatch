#!/usr/bin/env node
/*
 * Splice the Verify fixed-price / validity copy into src/i18n/translations.ts.
 *
 * Uses the shared applier in lib/i18nSplice.mjs: placeholder parity with
 * English, a non-Latin bundle identical to the English one, and a collision
 * with another workstream's key are all checked there. The corrected
 * rt_policy_verify is the one key written over an existing value.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERIFY_FIXED_PRICE_STRINGS, VERIFY_RETENTION_POLICY_STRINGS } from './verify-fixed-price-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

// fileURLToPath, not pathname.replace(/^\//,''): the second is right on
// Windows and wrong on Linux, and CI is Linux.
const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'verify-fixed-price-i18n';

const problems = [...validate(VERIFY_FIXED_PRICE_STRINGS, TAG), ...validate(VERIFY_RETENTION_POLICY_STRINGS, TAG)];
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

const added = splice(FILE, VERIFY_FIXED_PRICE_STRINGS, { banner: 'VERIFY FIXED PRICE', overwrite: process.argv.includes('--overwrite') });
const policy = splice(FILE, VERIFY_RETENTION_POLICY_STRINGS, { banner: 'VERIFY REPORT VALIDITY', overwrite: true });
console.log(`[${TAG}] ${added.added} key(s) added, ${policy.added ?? 0} policy key(s) written.`);
