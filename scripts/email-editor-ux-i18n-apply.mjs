#!/usr/bin/env node
/*
 * Splice the email editor UX rebuild copy (2026-10-24) into src/i18n/translations.ts.
 * Shared applier (lib/i18nSplice.mjs): placeholder parity, non-Latin bundles that are not copies of
 * English, and collisions with existing keys are all checked there.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDITOR_UX } from './email-editor-ux-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'email-editor-ux-i18n';

const problems = validate(EDITOR_UX, TAG);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}
const result = splice(FILE, EDITOR_UX, { banner: 'EMAIL STUDIO · EDITOR UX REBUILD', overwrite: process.argv.includes('--overwrite') });
console.log(`[${TAG}] ${result.added} key(s) added, ${result.replaced} replaced, ${result.unchanged} unchanged.`);
if (result.collisions.length) {
  console.error(`[${TAG}] existing keys with different values: ${result.collisions.join(', ')}`);
  process.exit(1);
}
