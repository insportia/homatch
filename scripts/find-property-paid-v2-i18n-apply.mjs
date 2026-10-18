#!/usr/bin/env node
/*
 * Splice the Find Property Deep Search v2 copy (owner, 2026-10-18) into src/i18n/translations.ts
 * (shared applier lib/i18nSplice.mjs: placeholder parity, non-Latin bundle checks).
 * Idempotent: a second run changes nothing.
 *
 *   REPLACED  existing keys whose wording changes (one confirmation; no source names)
 *             — written with overwrite, by owner instruction;
 *   ADDED     new keys — a different existing value is a collision and fails the run.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIND_PROPERTY_PAID_V2_ADDED, FIND_PROPERTY_PAID_V2_REPLACED } from './find-property-paid-v2-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'find-property-paid-v2-i18n';

const problems = [
  ...validate(FIND_PROPERTY_PAID_V2_REPLACED, TAG),
  ...validate(FIND_PROPERTY_PAID_V2_ADDED, TAG),
  ...Object.keys(FIND_PROPERTY_PAID_V2_ADDED).filter((k) => k in FIND_PROPERTY_PAID_V2_REPLACED).map((k) => `[${TAG}] FATAL: ${k} is in both sets`),
];
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}
const replaced = splice(FILE, FIND_PROPERTY_PAID_V2_REPLACED, {
  banner: 'FIND PROPERTY — Deep Search v2: one confirmation, no source names', overwrite: true, tag: TAG,
});
const added = splice(FILE, FIND_PROPERTY_PAID_V2_ADDED, {
  banner: 'FIND PROPERTY — Deep Search v2: process stages, paid results view', overwrite: process.argv.includes('--overwrite'), tag: TAG,
});
console.log(`[${TAG}] replaced set: ${replaced.replaced} replaced, ${replaced.added} added, ${replaced.unchanged} unchanged; new set: ${added.added} added, ${added.unchanged} unchanged.`);
if (added.collisions.length) {
  console.error(`[${TAG}] collision: another workstream owns ${added.collisions.join(', ')} with a different value; left untouched.`);
  process.exit(1);
}
