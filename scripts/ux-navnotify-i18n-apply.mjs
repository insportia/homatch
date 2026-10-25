#!/usr/bin/env node
/*
 * Splice the UX round's finished-job notification copy into
 * src/i18n/translations.ts through the shared applier (lib/i18nSplice.mjs:
 * placeholder parity, untranslated ka/ar/he, collisions). Its own small
 * applier rather than another import in homi-i18n-apply.mjs, so the parallel
 * UX workstreams do not all edit one import list. Re-running is a no-op.
 *
 *   node scripts/ux-navnotify-i18n-apply.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splice, validate } from './lib/i18nSplice.mjs';
import { UX_NAVNOTIFY_STRINGS } from './ux-navnotify-i18n-data.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'ux-navnotify-i18n';

const problems = validate(UX_NAVNOTIFY_STRINGS, TAG);
/* The owner's copy rule: no dash used as punctuation. */
for (const [key, values] of Object.entries(UX_NAVNOTIFY_STRINGS)) {
  values.forEach((v, i) => { if (/[–—]/.test(v)) problems.push(`[${TAG}] FATAL: ${key} (${i}) uses a dash`); });
}
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

const r = splice(FILE, UX_NAVNOTIFY_STRINGS, { banner: 'UX ROUND · FINISHED JOB NOTIFICATIONS', tag: TAG });
console.log(`[${TAG}] ${r.added} added, ${r.unchanged} unchanged${r.collisions?.length ? `, collisions: ${r.collisions.join(', ')}` : ''}.`);
if (r.collisions?.length) process.exit(1);
