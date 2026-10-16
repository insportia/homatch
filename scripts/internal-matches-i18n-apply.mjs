#!/usr/bin/env node
/*
 * Splice the HOMATCH Internal Matches copy (internal vs external sections, the
 * buyer profile view, the DEMO buyer and its simulated conversation) into
 * src/i18n/translations.ts. Idempotent; uses the shared applier in
 * lib/i18nSplice.mjs (placeholder parity, untranslated non-Latin bundles, key
 * collisions with another workstream).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTERNAL_MATCHES_STRINGS } from './internal-matches-i18n-data.mjs';
import { LANGS, splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'internal-matches-i18n';

const problems = validate(INTERNAL_MATCHES_STRINGS, TAG);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

const result = splice(FILE, INTERNAL_MATCHES_STRINGS, {
  banner: 'HOMATCH INTERNAL MATCHES',
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
