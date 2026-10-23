#!/usr/bin/env node
/*
 * Splice the Admin Leads Database strings (admin_ldb_*) into src/i18n/translations.ts.
 *
 * Uses the shared applier in lib/i18nSplice.mjs: placeholder parity with English, a non-Latin
 * bundle identical to the English one, and a collision with another workstream's key are all
 * checked there. Idempotent: running it twice adds nothing the second time.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splice, validate } from './lib/i18nSplice.mjs';
import { MATCHING_ADMIN_STRINGS } from './matching-admin-i18n-data.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'matching-admin-i18n';

const problems = validate(MATCHING_ADMIN_STRINGS, TAG);
for (const key of Object.keys(MATCHING_ADMIN_STRINGS)) {
  if (!key.startsWith('admin_ldb_')) problems.push(`[${TAG}] FATAL: ${key} must start with admin_ldb_ (admin chunk)`);
}
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

const result = splice(FILE, MATCHING_ADMIN_STRINGS, {
  banner: 'ADMIN LEADS DATABASE (curated leads import, catalog, batches, user lists, matching controls)',
  overwrite: process.argv.includes('--overwrite'),
  tag: TAG,
});

if (result.collisions.length) {
  console.error(`[${TAG}] ${result.collisions.length} key(s) already exist with different text (use --overwrite): ${result.collisions.join(', ')}`);
  process.exit(1);
}
console.log(`[${TAG}] ${result.added} added, ${result.replaced} replaced, ${result.unchanged} unchanged.`);
