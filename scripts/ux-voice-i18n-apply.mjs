#!/usr/bin/env node
/*
 * Splice the HOMI voice message copy (scripts/ux-voice-i18n-data.mjs) into
 * src/i18n/translations.ts through the shared applier, which checks
 * placeholder parity, untranslated non-Latin bundles and collisions.
 * Re-running is a no-op.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UX_VOICE_STRINGS } from './ux-voice-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'ux-voice-i18n';

const problems = validate(UX_VOICE_STRINGS, TAG);
for (const [key, values] of Object.entries(UX_VOICE_STRINGS)) {
  if (values.some((v) => /[–—]/.test(v))) problems.push(`${key}: no dashes as punctuation`);
}
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

const added = splice(FILE, UX_VOICE_STRINGS, { banner: 'HOMI VOICE MESSAGES', overwrite: true });
console.log(`[${TAG}] ${added.added} added, ${added.replaced ?? 0} replaced, ${added.unchanged} unchanged.`);
