#!/usr/bin/env node
/*
 * Splice the Verify gallery's visual-evolution copy into src/i18n/translations.ts
 * (idempotent; the shared applier in lib/i18nSplice.mjs checks placeholder
 * parity, untranslated bundles and key collisions).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERIFY_V6_VISUALS_STRINGS } from './verify-v6-visuals-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'verify-v6-visuals-i18n';

const problems = validate(VERIFY_V6_VISUALS_STRINGS, TAG);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

const result = splice(FILE, VERIFY_V6_VISUALS_STRINGS, {
  banner: 'VERIFY V6 VISUALS',
  overwrite: process.argv.includes('--overwrite'),
});

console.log(`[${TAG}] ${result.added} key(s) added, ${result.skipped} already present.`);
