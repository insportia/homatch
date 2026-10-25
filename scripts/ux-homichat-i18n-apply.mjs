#!/usr/bin/env node
/*
 * Splice the HOMI chat UX copy into src/i18n/translations.ts through the
 * shared applier (lib/i18nSplice.mjs: placeholder parity, untranslated
 * non-Latin bundles, collisions). New keys only, added where absent.
 * Re-running is a no-op.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UX_HOMICHAT_STRINGS } from './ux-homichat-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'ux-homichat-i18n';

const problems = validate(UX_HOMICHAT_STRINGS, TAG);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

const result = splice(FILE, UX_HOMICHAT_STRINGS, { banner: 'HOMI CHAT UX' });
console.log(`[${TAG}] ${result.added} added, ${result.unchanged} unchanged.`);
if (result.collisions?.length) {
  for (const c of result.collisions) console.error(`collision: ${c}`);
  process.exit(1);
}
