#!/usr/bin/env node
/*
 * Splice the campaign workspace / contact library / Email Studio copy into
 * src/i18n/translations.ts.
 *
 * Uses the shared applier in lib/i18nSplice.mjs: placeholder parity with
 * English, non-Latin bundles that are not copies of English, and collisions
 * with another workstream's key are all checked there.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAMPAIGN_STUDIO_STRINGS } from './campaign-studio-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'campaign-studio-i18n';

const problems = validate(CAMPAIGN_STUDIO_STRINGS, TAG);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

const result = splice(FILE, CAMPAIGN_STUDIO_STRINGS, {
  banner: 'CAMPAIGN WORKSPACE · CONTACT LIBRARY · EMAIL STUDIO',
  overwrite: process.argv.includes('--overwrite'),
});

console.log(`[${TAG}] ${result.added} key(s) added, ${result.replaced} replaced, ${result.unchanged} unchanged.`);
