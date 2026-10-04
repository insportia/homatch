#!/usr/bin/env node
/*
 * Splice the Find Buyers live-search copy into src/i18n/translations.ts
 * (shared applier lib/i18nSplice.mjs: placeholder parity, non-Latin bundle
 * checks, cross-workstream collisions). Idempotent.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIND_BUYERS_LIVE_STRINGS } from './find-buyers-live-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'find-buyers-live-i18n';

const problems = validate(FIND_BUYERS_LIVE_STRINGS, TAG);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}
const result = splice(FILE, FIND_BUYERS_LIVE_STRINGS, {
  banner: 'FIND BUYERS / FIND TENANTS — live search, lifecycle, pagination, media',
  overwrite: process.argv.includes('--overwrite'),
});
console.log(`[${TAG}] ${result.added} key(s) added, ${result.skipped} already present.`);
