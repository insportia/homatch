#!/usr/bin/env node
/*
 * Splice the email builder + deliverability copy (2026-10-24) into src/i18n/translations.ts.
 *
 * Uses the shared applier in lib/i18nSplice.mjs: placeholder parity with English, non-Latin
 * bundles that are not copies of English, and collisions with another workstream's key are all
 * checked there. --overwrite replaces the existing Email Studio values this brief re-labels
 * (email-builder-i18n-data-4.mjs, the owner-approved Georgian).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILDER_PART_1 } from './email-builder-i18n-data-1.mjs';
import { BUILDER_PART_2 } from './email-builder-i18n-data-2.mjs';
import { BUILDER_PART_3 } from './email-builder-i18n-data-3.mjs';
import { BUILDER_OVERRIDES } from './email-builder-i18n-data-4.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'email-builder-i18n';
const STRINGS = { ...BUILDER_PART_1, ...BUILDER_PART_2, ...BUILDER_PART_3, ...BUILDER_OVERRIDES };

const problems = validate(STRINGS, TAG);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

const result = splice(FILE, STRINGS, {
  banner: 'EMAIL STUDIO · DRAG & DROP BUILDER · DELIVERABILITY',
  overwrite: process.argv.includes('--overwrite'),
});

console.log(`[${TAG}] ${result.added} key(s) added, ${result.replaced} replaced, ${result.unchanged} unchanged.`);
if (result.collisions.length) {
  console.error(`[${TAG}] existing keys with different values (run with --overwrite): ${result.collisions.join(', ')}`);
  process.exit(1);
}
