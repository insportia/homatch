#!/usr/bin/env node
/*
 * Splice the HOMATCH Leads CRM strings (crm_*, crm_pref_*) and the Leads notification
 * copy (notif_property_offer_*, notif_native_supply_new_*, notif_crm_follow_up_*) into
 * src/i18n/translations.ts.
 *
 * Uses the shared applier in lib/i18nSplice.mjs: placeholder parity with
 * English, a non-Latin bundle identical to the English one, and a collision
 * with another workstream's key are all checked there rather than
 * re-implemented here.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEADS_CRM_STRINGS } from './leads-crm-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

// fileURLToPath, not pathname.replace(/^\//,''): the second is right on
// Windows and wrong on Linux, and CI is Linux.
const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'leads-crm-i18n';

const problems = validate(LEADS_CRM_STRINGS, TAG);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

const result = splice(FILE, LEADS_CRM_STRINGS, {
  banner: 'HOMATCH LEADS CRM (buyer relationships, lead contact preferences, Leads notifications)',
  overwrite: process.argv.includes('--overwrite'),
});

console.log(`[${TAG}] ${result.added} added, ${result.replaced} replaced, ${result.unchanged} unchanged.`);
