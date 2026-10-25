#!/usr/bin/env node
/*
 * Splice the UX round's Contracts copy into src/i18n/translations.ts.
 *
 * Its own applier (not another import in homi-i18n-apply.mjs) so parallel
 * workstreams do not edit the same script. Uses the shared splicer, which
 * checks placeholder parity, untranslated non-Latin bundles and collisions.
 * All ux_ct_* keys belong to this workstream, so re-running overwrites them
 * with the current data and is otherwise a no-op.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UX_CONTRACTS_STRINGS } from './ux-contracts-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'ux-contracts-i18n';

const problems = validate(UX_CONTRACTS_STRINGS, TAG);
for (const key of Object.keys(UX_CONTRACTS_STRINGS)) {
  if (!key.startsWith('ux_ct_')) problems.push(`${key}: this applier only owns ux_ct_* keys`);
}
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

const r = splice(FILE, UX_CONTRACTS_STRINGS, { banner: 'UX CONTRACTS', overwrite: true, tag: TAG });
console.log(`[${TAG}] ${r.added} added, ${r.replaced ?? 0} replaced, ${r.unchanged} unchanged.`);
