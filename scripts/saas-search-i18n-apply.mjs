#!/usr/bin/env node
/*
 * Splice the Find Property query-engine copy (scripts/saas-search-i18n-data.mjs) into
 * src/i18n/translations.ts through the shared applier, which checks placeholder parity,
 * untranslated non-Latin bundles and collisions. Re-running is a no-op.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAAS_SEARCH_STRINGS } from './saas-search-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'saas-search-i18n';

const problems = validate(SAAS_SEARCH_STRINGS, TAG);
for (const [key, values] of Object.entries(SAAS_SEARCH_STRINGS)) {
  values.forEach((v, i) => { if (/[–—]/.test(v)) problems.push(`${key}[${i}] uses a dash`); });
}
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}
const r = splice(FILE, SAAS_SEARCH_STRINGS, { banner: 'FIND PROPERTY QUERY ENGINE (clarification chips)', tag: TAG });
console.log(`[${TAG}] ${r.added} added, ${r.unchanged} unchanged.`);
