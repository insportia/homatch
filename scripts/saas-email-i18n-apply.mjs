#!/usr/bin/env node
/*
 * Splice the Email Marketing hidden / Copy email copy (scripts/saas-email-i18n-data.mjs) into
 * src/i18n/translations.ts through the shared applier (placeholder parity, untranslated
 * non-Latin bundles, collisions). The two relabels overwrite the historic `email_campaigns`
 * name and description, which now mean SMS campaigns. Re-running is a no-op.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAAS_EMAIL_RELABEL, SAAS_EMAIL_STRINGS } from './saas-email-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'saas-email-i18n';

const problems = [...validate(SAAS_EMAIL_STRINGS, TAG), ...validate(SAAS_EMAIL_RELABEL, TAG)];
for (const [key, values] of Object.entries({ ...SAAS_EMAIL_STRINGS, ...SAAS_EMAIL_RELABEL })) {
  values.forEach((v, i) => { if (/[–—]/.test(v)) problems.push(`${key}[${i}] uses a dash`); });
}
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}
const a = splice(FILE, SAAS_EMAIL_STRINGS, { banner: 'EMAIL MARKETING HIDDEN, COPY EMAIL', tag: TAG });
if (a.collisions.length) {
  console.error(`[${TAG}] collisions: ${a.collisions.join(', ')}`);
  process.exit(1);
}
const b = splice(FILE, SAAS_EMAIL_RELABEL, { banner: 'SMS CAMPAIGNS (historic email_campaigns key)', tag: TAG, overwrite: true });
console.log(`[${TAG}] ${a.added} added, ${a.unchanged} unchanged; relabel ${b.replaced} replaced, ${b.unchanged} unchanged.`);
