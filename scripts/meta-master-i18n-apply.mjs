#!/usr/bin/env node
/*
 * Splice the Meta Ads master copy (builder, campaign drill-down, workspace,
 * admin + notifications) into src/i18n/translations.ts.
 *
 * Uses the shared applier in lib/i18nSplice.mjs: placeholder parity with
 * English, non-Latin bundles that are not copies of English, and collisions
 * with another workstream's key are all checked there. Idempotent: a key
 * already present is skipped unless --overwrite.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { META_MASTER_BUILDER_STRINGS } from './meta-master-builder-i18n-data.mjs';
import { META_MASTER_CAMPAIGN_STRINGS } from './meta-master-campaign-i18n-data.mjs';
import { META_MASTER_WORKSPACE_STRINGS } from './meta-master-workspace-i18n-data.mjs';
import { META_MASTER_ADMIN_STRINGS } from './meta-master-admin-i18n-data.mjs';
import { META_FINAL_STRINGS } from './meta-final-i18n-data.mjs';
import { META_MOBILE_STRINGS } from './meta-mobile-i18n-data.mjs';
import { META_CLOSURE_STRINGS } from './meta-closure-i18n-data.mjs';
import { META_CLOSURE_FORMS_STRINGS } from './meta-closure-forms-i18n-data.mjs';
import { META_CLOSURE_AI_STRINGS } from './meta-closure-ai-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');

const PARTS = [
  ['META ADS MASTER — BUILDER', 'meta-master-builder-i18n', META_MASTER_BUILDER_STRINGS],
  ['META ADS MASTER — CAMPAIGN', 'meta-master-campaign-i18n', META_MASTER_CAMPAIGN_STRINGS],
  ['META ADS MASTER — WORKSPACE', 'meta-master-workspace-i18n', META_MASTER_WORKSPACE_STRINGS],
  ['META ADS MASTER — ADMIN + NOTIFICATIONS', 'meta-master-admin-i18n', META_MASTER_ADMIN_STRINGS],
  ['META ADS — FINAL PRODUCT FINISH', 'meta-final-i18n', META_FINAL_STRINGS],
  ['META ADS — MOBILE SIMPLIFICATION', 'meta-mobile-i18n', META_MOBILE_STRINGS],
  ['META ADS — CLOSURE: TERMS, LOCATIONS, HINTS', 'meta-closure-i18n', META_CLOSURE_STRINGS],
  ['META ADS — CLOSURE: LEAD FORM BUILDER', 'meta-closure-forms-i18n', META_CLOSURE_FORMS_STRINGS],
  ['META ADS — CLOSURE: HOMATCH AI CREATIVES + VIDEO', 'meta-closure-ai-i18n', META_CLOSURE_AI_STRINGS],
];

// One key, one owner: the parts must not define the same key twice.
const seen = new Map();
let problems = 0;
for (const [, tag, strings] of PARTS) {
  for (const key of Object.keys(strings)) {
    if (seen.has(key)) { console.error(`[${tag}] ${key} is also defined by ${seen.get(key)}`); problems += 1; }
    seen.set(key, tag);
  }
  for (const p of validate(strings, tag)) { console.error(p); problems += 1; }
}
if (problems > 0) {
  console.error(`[meta-master-i18n] ${problems} problem(s); nothing was written.`);
  process.exit(1);
}

for (const [banner, tag, strings] of PARTS) {
  const result = splice(FILE, strings, { banner, overwrite: process.argv.includes('--overwrite') });
  console.log(`[${tag}] ${result.added} key(s) added, ${result.skipped} already present.`);
}
