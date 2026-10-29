#!/usr/bin/env node
/*
 * Splice the Verify cost-round Admin copy (scripts/saas-verify-i18n-data.mjs) into
 * src/i18n/translations.ts through the shared applier, which checks placeholder parity,
 * untranslated non-Latin bundles and collisions. Re-running is a no-op.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAAS_VERIFY_STRINGS } from './saas-verify-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'saas-verify-i18n';

const problems = validate(SAAS_VERIFY_STRINGS, TAG);
for (const [key, values] of Object.entries(SAAS_VERIFY_STRINGS)) {
  values.forEach((v, i) => { if (/[–—]/.test(v)) problems.push(`${key}[${i}] uses a dash`); });
}
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}
const r = splice(FILE, SAAS_VERIFY_STRINGS, { banner: 'VERIFY V3 AND VERSION MANAGEMENT', tag: TAG });
console.log(`[${TAG}] ${r.added} added, ${r.unchanged} unchanged.`);
