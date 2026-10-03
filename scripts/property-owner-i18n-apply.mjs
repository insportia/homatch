#!/usr/bin/env node
/*
 * Splice the Property Owner Workspace copy into src/i18n/translations.ts.
 *
 * Uses the shared applier in lib/i18nSplice.mjs: placeholder parity with
 * English, a non-Latin bundle identical to the English one, and a collision
 * with another workstream's key are all checked there. Idempotent.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROPERTY_OWNER_STRINGS } from './property-owner-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'property-owner-i18n';

const problems = validate(PROPERTY_OWNER_STRINGS, TAG);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

const result = splice(FILE, PROPERTY_OWNER_STRINGS, {
  banner: 'PROPERTY OWNER WORKSPACE',
  overwrite: process.argv.includes('--overwrite'),
  tag: TAG,
});
if (result.collisions.length) {
  console.error(`[${TAG}] collisions (left untouched): ${result.collisions.join(', ')}`);
  process.exit(1);
}
console.log(`[${TAG}] ${result.added} value(s) added, ${result.unchanged} unchanged, ${result.keys} key(s).`);
