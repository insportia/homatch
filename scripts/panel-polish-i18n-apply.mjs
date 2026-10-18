#!/usr/bin/env node
/*
 * Splice the Panel polish copy (owner, 2026-10-17) into src/i18n/translations.ts
 * (shared applier lib/i18nSplice.mjs: placeholder parity, non-Latin bundle checks).
 * Idempotent: a second run changes nothing; a different existing value is a collision.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PANEL_POLISH_ADDED } from './panel-polish-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'panel-polish-i18n';

const problems = validate(PANEL_POLISH_ADDED, TAG);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}
const added = splice(FILE, PANEL_POLISH_ADDED, {
  banner: 'PANEL POLISH — earlier matches band, opened contacts choice, push turn off', overwrite: false, tag: TAG,
});
console.log(`[${TAG}] ${added.added} added, ${added.unchanged} unchanged.`);
if (added.collisions.length) {
  console.error(`[${TAG}] collision: ${added.collisions.join(', ')} already exist with a different value; left untouched.`);
  process.exit(1);
}
