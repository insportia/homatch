#!/usr/bin/env node
/*
 * Splice the RS.ge taxpayer-registry row copy into src/i18n/translations.ts.
 *
 * New keys are added (a collision with another workstream fails loudly);
 * the keys in RS_REPLACED_STRINGS are overwritten on purpose — see the data
 * file. Running it again changes nothing.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RS_STRINGS, RS_REPLACED_STRINGS } from './verify-rsge-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'verify-rsge-i18n';

const problems = [...validate(RS_STRINGS, TAG), ...validate(RS_REPLACED_STRINGS, TAG)];
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

const added = splice(FILE, RS_STRINGS, { banner: 'VERIFY RS.GE TAXPAYER REGISTRY', overwrite: process.argv.includes('--overwrite'), tag: TAG });
if (added.collisions.length) {
  console.error(`[${TAG}] collision(s) with existing keys: ${added.collisions.join(', ')}`);
  process.exit(1);
}
const replaced = splice(FILE, RS_REPLACED_STRINGS, { banner: 'VERIFY RS.GE TAXPAYER REGISTRY (replaced)', overwrite: true, tag: TAG });

console.log(`[${TAG}] ${added.added} key-locale(s) added, ${added.replaced} updated, ${added.unchanged} unchanged; ${replaced.replaced} replaced, ${replaced.unchanged} unchanged.`);
