#!/usr/bin/env node
/*
 * Splice the Publish to Portals workspace strings (nav_publishing, pubw_*) into src/i18n/translations.ts.
 *
 * Uses the shared applier in lib/i18nSplice.mjs: placeholder parity with
 * English, a non-Latin bundle identical to the English one, and a collision
 * with another workstream's key are all checked there rather than
 * re-implemented here.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLISHING_PORTALS_STRINGS } from './publishing-portals-i18n-data.mjs';
import { PUBLISHING_WORKSPACE_STRINGS } from './publishing-workspace-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

// fileURLToPath, not pathname.replace(/^\//,''): the second is right on
// Windows and wrong on Linux, and CI is Linux.
const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'publishing-workspace-i18n';

// The 2026-10-16 eight-portal set is applied on top: where it repeats a key, it wins.
const STRINGS = { ...PUBLISHING_WORKSPACE_STRINGS, ...PUBLISHING_PORTALS_STRINGS };

const problems = validate(STRINGS, TAG);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

const result = splice(FILE, STRINGS, {
  banner: 'PUBLISH TO PORTALS — the standalone publishing workspace (/publishing)',
  overwrite: process.argv.includes('--overwrite'),
});

console.log(`[${TAG}] ${result.added} added, ${result.replaced} replaced, ${result.unchanged} unchanged.`);
