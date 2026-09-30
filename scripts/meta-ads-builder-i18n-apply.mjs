#!/usr/bin/env node
/*
 * Splice the Meta Ads campaign-builder copy into src/i18n/translations.ts.
 *
 * Uses the shared applier in lib/i18nSplice.mjs: placeholder parity with
 * English, non-Latin bundles that are not copies of English, and collisions
 * with another workstream's key are all checked there.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { META_ADS_BUILDER_STRINGS } from './meta-ads-builder-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'meta-ads-builder-i18n';

const problems = validate(META_ADS_BUILDER_STRINGS, TAG);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

const result = splice(FILE, META_ADS_BUILDER_STRINGS, {
  banner: 'META ADS CAMPAIGN BUILDER',
  overwrite: process.argv.includes('--overwrite'),
});

console.log(`[${TAG}] ${result.added} key(s) added, ${result.skipped} already present.`);
