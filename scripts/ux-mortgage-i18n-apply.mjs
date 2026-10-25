#!/usr/bin/env node
/*
 * Splice the UX MORTGAGE copy (scripts/ux-mortgage-i18n-data.mjs) into
 * src/i18n/translations.ts through the shared applier, which checks
 * placeholder parity and untranslated ka/ar/he values. Re-running is a no-op;
 * every key is this workstream's own, so a changed value is rewritten in place.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splice, validate } from './lib/i18nSplice.mjs';
import { UX_MORTGAGE_STRINGS } from './ux-mortgage-i18n-data.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'ux-mortgage-i18n';

const problems = validate(UX_MORTGAGE_STRINGS, TAG);
for (const [key, values] of Object.entries(UX_MORTGAGE_STRINGS)) {
  values.forEach((v, i) => { if (/[–—]/.test(v)) problems.push(`[${TAG}] FATAL: ${key}[${i}] uses a dash as punctuation`); });
}
if (problems.length) {
  for (const p of problems) console.error(p);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}
const r = splice(FILE, UX_MORTGAGE_STRINGS, { banner: 'UX MORTGAGE', overwrite: true, tag: TAG });
console.log(`[${TAG}] ${r.added} added, ${r.replaced} replaced, ${r.unchanged} unchanged (${r.keys} keys).`);
