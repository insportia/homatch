#!/usr/bin/env node
/*
 * Splice the broker lifecycle copy into src/i18n/translations.ts.
 *
 * Uses the shared applier in lib/i18nSplice.mjs: placeholder parity with
 * English, non-Latin bundles that are not copies of English, and collisions
 * with another workstream's key are all checked there.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROKER_LIFECYCLE_STRINGS } from './broker-lifecycle-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'broker-lifecycle-i18n';

const problems = validate(BROKER_LIFECYCLE_STRINGS, TAG);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

const result = splice(FILE, BROKER_LIFECYCLE_STRINGS, {
  banner: 'BROKER LIFECYCLE',
  overwrite: process.argv.includes('--overwrite'),
});

console.log(`[${TAG}] ${result.added} key(s) added, ${result.skipped} already present.`);
