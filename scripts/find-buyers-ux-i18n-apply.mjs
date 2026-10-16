#!/usr/bin/env node
/*
 * Splice the Find Buyers customer UX copy into src/i18n/translations.ts
 * (shared applier lib/i18nSplice.mjs: placeholder parity, non-Latin bundle
 * checks, cross-workstream collisions). Idempotent.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIND_BUYERS_UX_STRINGS } from './find-buyers-ux-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'find-buyers-ux-i18n';

const problems = validate(FIND_BUYERS_UX_STRINGS, TAG);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}
const result = splice(FILE, FIND_BUYERS_UX_STRINGS, {
  banner: 'FIND BUYERS / FIND TENANTS — customer UX: three tabs, compact card, filters, lead detail, live search',
  overwrite: process.argv.includes('--overwrite'),
});
console.log(`[${TAG}] ${result.added} value(s) added, ${result.unchanged} already present, ${result.replaced} replaced.`);
if (result.collisions.length) {
  console.error(`[${TAG}] collision: another workstream owns ${result.collisions.join(', ')} with a different value; left untouched.`);
  process.exit(1);
}
