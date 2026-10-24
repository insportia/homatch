#!/usr/bin/env node
/*
 * Splice the Email Studio UX-pass copy (2026-10-24) into src/i18n/translations.ts.
 *
 * Uses the shared applier in lib/i18nSplice.mjs: placeholder parity with English, non-Latin
 * bundles that are not copies of English, and collisions with another workstream's key are all
 * checked there. --overwrite replaces values this workstream owns (the new template names).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UX_PART_1 } from './email-studio-ux-i18n-data-1.mjs';
import { UX_PART_2 } from './email-studio-ux-i18n-data-2.mjs';
import { UX_PART_3 } from './email-studio-ux-i18n-data-3.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'email-studio-ux-i18n';
const STRINGS = { ...UX_PART_1, ...UX_PART_2, ...UX_PART_3 };

const problems = validate(STRINGS, TAG);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

const result = splice(FILE, STRINGS, {
  banner: 'EMAIL STUDIO · UX PASS · LEADS · TEMPLATES · ALLOWANCE · HOMI',
  overwrite: process.argv.includes('--overwrite'),
});

console.log(`[${TAG}] ${result.added} key(s) added, ${result.replaced} replaced, ${result.unchanged} unchanged.`);
