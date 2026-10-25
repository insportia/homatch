#!/usr/bin/env node
/*
 * Splice the For Expats / My Georgia UX copy (scripts/ux-expats-i18n-data.mjs) into
 * src/i18n/translations.ts through the shared applier, which checks placeholder parity,
 * untranslated non-Latin bundles and collisions. Re-running is a no-op.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UX_EXPATS_STRINGS } from './ux-expats-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'ux-expats-i18n';

const problems = validate(UX_EXPATS_STRINGS, TAG);
for (const [key, values] of Object.entries(UX_EXPATS_STRINGS)) {
  values.forEach((v, i) => { if (/[–—]/.test(v)) problems.push(`${key}[${i}] uses a dash`); });
}
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}
const r = splice(FILE, UX_EXPATS_STRINGS, { banner: 'MY GEORGIA UX (For Expats entry, places)', tag: TAG });
console.log(`[${TAG}] ${r.added} added, ${r.unchanged} unchanged.`);
