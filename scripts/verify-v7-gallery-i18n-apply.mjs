#!/usr/bin/env node
/*
 * Splice the Verify gallery's v7 photo-dating copy into src/i18n/translations.ts
 * (idempotent; the shared applier in lib/i18nSplice.mjs checks placeholder
 * parity, untranslated bundles and key collisions).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERIFY_V7_GALLERY_STRINGS } from './verify-v7-gallery-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'verify-v7-gallery-i18n';

const problems = validate(VERIFY_V7_GALLERY_STRINGS, TAG);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

const result = splice(FILE, VERIFY_V7_GALLERY_STRINGS, {
  banner: 'VERIFY V7 GALLERY',
  overwrite: process.argv.includes('--overwrite'),
});

console.log(`[${TAG}] ${result.added} key(s) added, ${result.skipped} already present.`);
