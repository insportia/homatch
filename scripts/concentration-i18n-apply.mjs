#!/usr/bin/env node
/*
 * Splice the included-result copy into src/i18n/translations.ts.
 *
 * Uses the shared applier in lib/i18nSplice.mjs: placeholder parity with
 * English, a non-Latin bundle identical to the English one, and a collision
 * with another workstream's key are all checked there rather than
 * re-implemented here.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONCENTRATION_STRINGS } from './concentration-i18n-data.mjs';
import { LANGS, splice, validate } from './lib/i18nSplice.mjs';

// fileURLToPath, not pathname.replace(/^\//,''): the second is right on
// Windows and wrong on Linux, and CI is Linux.
const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'concentration-i18n';

const problems = validate(CONCENTRATION_STRINGS, TAG);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

const result = splice(FILE, CONCENTRATION_STRINGS, {
  banner: 'ADMIN SOURCE CONCENTRATION',
  overwrite: process.argv.includes('--overwrite'),
  tag: TAG,
});

console.log(
  `[${TAG}] ${result.added} added, ${result.replaced} replaced, `
  + `${result.unchanged} already current — ${result.keys} key(s) across ${LANGS.length} bundles.`,
);

if (result.collisions.length > 0) {
  console.error(
    `[${TAG}] ${result.collisions.length} key(s) already exist with a different value and were LEFT ALONE:\n  `
    + result.collisions.join('\n  ')
    + '\nRe-run with --overwrite only if you are certain they are yours.',
  );
  process.exit(1);
}
