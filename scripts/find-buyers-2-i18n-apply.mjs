#!/usr/bin/env node
/*
 * Splice the Find Buyers 2.0 strings (fim_*, fbx2_*, fb2_cmp_*, hl_*, crm_*, lp_*, lo_*,
 * es_schedule_*) into src/i18n/translations.ts. Premium is relabelled VIP, so the
 * apply runs with --overwrite.
 *
 * Uses the shared applier in lib/i18nSplice.mjs: placeholder parity with
 * English, a non-Latin bundle identical to the English one, and a collision
 * with another workstream's key are all checked there rather than
 * re-implemented here.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIND_BUYERS_2_STRINGS } from './find-buyers-2-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

// fileURLToPath, not pathname.replace(/^\//,''): the second is right on
// Windows and wrong on Linux, and CI is Linux.
const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'find-buyers-2-i18n';

const problems = validate(FIND_BUYERS_2_STRINGS, TAG);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

const result = splice(FILE, FIND_BUYERS_2_STRINGS, {
  banner: 'FIND BUYERS 2.0 (internal matches, unlocked leads CRM, AI outreach, Email Studio scheduling)',
  overwrite: process.argv.includes('--overwrite'),
});

console.log(`[${TAG}] ${result.added} added, ${result.replaced} replaced, ${result.unchanged} unchanged.`);
