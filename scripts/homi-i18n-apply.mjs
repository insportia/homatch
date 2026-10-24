#!/usr/bin/env node
/*
 * Splice the HOMI workstream copy into src/i18n/translations.ts.
 *
 * Two passes through the shared applier (lib/i18nSplice.mjs, which checks
 * placeholder parity, untranslated non-Latin bundles and collisions):
 *   1. new keys, added only where absent;
 *   2. the HOMI rename, which deliberately replaces the "Homatch AI" copy of a
 *      small, named set of existing keys.
 * Re-running is a no-op.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOMI_STRINGS, HOMI_REBRAND_STRINGS } from './homi-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'homi-i18n';

const problems = [...validate(HOMI_STRINGS, TAG), ...validate(HOMI_REBRAND_STRINGS, `${TAG}-rebrand`)];
for (const key of Object.keys(HOMI_REBRAND_STRINGS)) {
  if (key in HOMI_STRINGS) problems.push(`${key} is both new and a rebrand`);
}
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

const added = splice(FILE, HOMI_STRINGS, { banner: 'HOMI ASSISTANT', overwrite: true }); // all keys are this workstream's own
const renamed = splice(FILE, HOMI_REBRAND_STRINGS, { banner: 'HOMI ASSISTANT (rename)', overwrite: true });
console.log(`[${TAG}] new: ${added.added} added, ${added.unchanged} unchanged; rename: ${renamed.replaced} replaced, ${renamed.added} added, ${renamed.unchanged} unchanged.`);
