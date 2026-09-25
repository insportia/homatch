#!/usr/bin/env node
/*
 * Splice the search-languages copy into src/i18n/translations.ts.
 *
 * Uses the shared applier in lib/i18nSplice.mjs rather than a fourth copy of
 * the same 160 lines — the checks inside it (placeholder parity, a non-Latin
 * bundle identical to the English one, a collision with another workstream's
 * key) are the part worth not re-implementing.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAMPAIGN_LANGUAGE_STRINGS } from './campaign-languages-i18n-data.mjs';
import { LANGS, splice, validate } from './lib/i18nSplice.mjs';

// fileURLToPath, not pathname.replace(/^\//,''): the second is right on
// Windows and wrong on Linux, and CI is Linux.
const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'campaign-languages-i18n';

const problems = validate(CAMPAIGN_LANGUAGE_STRINGS, TAG);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

const result = splice(FILE, CAMPAIGN_LANGUAGE_STRINGS, {
  banner: 'CAMPAIGN SEARCH LANGUAGES',
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
