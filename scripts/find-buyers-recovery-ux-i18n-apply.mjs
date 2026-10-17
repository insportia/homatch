#!/usr/bin/env node
/*
 * Splice the Find Buyers recovery UX copy (owner, 2026-10-17) into src/i18n/translations.ts
 * (shared applier lib/i18nSplice.mjs: placeholder parity, non-Latin bundle checks).
 * Idempotent: a second run changes nothing.
 *
 *   REPLACED  existing customer keys whose wording changes ("buyers found", "free vs paid")
 *             — written with overwrite, by owner instruction;
 *   ADDED     new keys — a different existing value is a collision and fails the run.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIND_BUYERS_RECOVERY_ADDED, FIND_BUYERS_RECOVERY_REPLACED } from './find-buyers-recovery-ux-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'find-buyers-recovery-ux-i18n';

const problems = [
  ...validate(FIND_BUYERS_RECOVERY_REPLACED, TAG),
  ...validate(FIND_BUYERS_RECOVERY_ADDED, TAG),
  ...Object.keys(FIND_BUYERS_RECOVERY_ADDED).filter((k) => k in FIND_BUYERS_RECOVERY_REPLACED).map((k) => `[${TAG}] FATAL: ${k} is in both sets`),
];
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}
const replaced = splice(FILE, FIND_BUYERS_RECOVERY_REPLACED, {
  banner: 'FIND BUYERS — recovery UX: interested people, not buyers; no free vs paid labels', overwrite: true, tag: TAG,
});
const added = splice(FILE, FIND_BUYERS_RECOVERY_ADDED, {
  banner: 'FIND BUYERS — recovery UX: campaign dashboard, latest search, clear old results', overwrite: process.argv.includes('--overwrite'), tag: TAG,
});
console.log(`[${TAG}] replaced set: ${replaced.replaced} replaced, ${replaced.added} added, ${replaced.unchanged} unchanged; new set: ${added.added} added, ${added.unchanged} unchanged.`);
if (added.collisions.length) {
  console.error(`[${TAG}] collision: another workstream owns ${added.collisions.join(', ')} with a different value; left untouched.`);
  process.exit(1);
}
