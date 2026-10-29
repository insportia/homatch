#!/usr/bin/env node
/*
 * Splice the transactional notification copy (scripts/saas-notify-i18n-data.mjs) into
 * src/i18n/translations.ts through the shared applier (placeholder parity, untranslated
 * non-Latin bundles, collisions), then regenerate the Deno copy table
 * (scripts/saas-notify-copy.mjs). Re-running is a no-op.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAAS_NOTIFY_STRINGS } from './saas-notify-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'saas-notify-i18n';

const problems = validate(SAAS_NOTIFY_STRINGS, TAG);
for (const [key, values] of Object.entries(SAAS_NOTIFY_STRINGS)) {
  values.forEach((v, i) => { if (/[–—]/.test(v)) problems.push(`${key}[${i}] uses a dash`); });
}
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}
const r = splice(FILE, SAAS_NOTIFY_STRINGS, { banner: 'TRANSACTIONAL NOTIFICATIONS (saas-notify)', tag: TAG });
console.log(`[${TAG}] ${r.added} added, ${r.unchanged} unchanged.`);

/* The Deno copy table is generated from the bundle just written. */
const gen = spawnSync(process.execPath, [path.join(here, 'saas-notify-copy.mjs')], { stdio: 'inherit' });
process.exit(gen.status ?? 1);
