#!/usr/bin/env node
/*
 * Splice the HOMI cost round copy (scripts/saas-homi-i18n-data.mjs) into
 * src/i18n/translations.ts through the shared applier, which checks placeholder parity,
 * untranslated non-Latin bundles and collisions. Only the keys listed in
 * SAAS_HOMI_OVERWRITE may replace an existing value. Re-running is a no-op.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAAS_HOMI_OVERWRITE, SAAS_HOMI_STRINGS } from './saas-homi-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'saas-homi-i18n';

const problems = validate(SAAS_HOMI_STRINGS, TAG);
for (const [key, values] of Object.entries(SAAS_HOMI_STRINGS)) {
  values.forEach((v, i) => { if (/[–—]/.test(v)) problems.push(`${key}[${i}] uses a dash`); });
}
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}
const pick = (keep) => Object.fromEntries(Object.entries(SAAS_HOMI_STRINGS).filter(([k]) => keep(k)));
const replaced = splice(FILE, pick((k) => SAAS_HOMI_OVERWRITE.has(k)), { banner: 'HOMI COST ROUND', overwrite: true, tag: TAG });
const added = splice(FILE, pick((k) => !SAAS_HOMI_OVERWRITE.has(k)), { banner: 'HOMI COST ROUND (voice is free)', tag: TAG });
if (added.collisions.length) {
  console.error(`[${TAG}] collisions left untouched: ${added.collisions.join(', ')}`);
  process.exit(1);
}
console.log(`[${TAG}] ${added.added} added, ${replaced.replaced} replaced, ${added.unchanged + replaced.unchanged} unchanged.`);
