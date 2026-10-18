#!/usr/bin/env node
/*
 * Splice the System health queues card copy (2026-10-18) into src/i18n/translations.ts
 * (shared applier lib/i18nSplice.mjs: placeholder parity, non-Latin bundle checks).
 * Idempotent: a second run changes nothing; a different existing value is a collision.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPS_HEALTH_ADDED } from './ops-health-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'ops-health-i18n';

const problems = validate(OPS_HEALTH_ADDED, TAG);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}
const added = splice(FILE, OPS_HEALTH_ADDED, {
  banner: 'SYSTEM HEALTH — queues and stuck work', overwrite: false, tag: TAG,
});
console.log(`[${TAG}] ${added.added} added, ${added.unchanged} unchanged.`);
if (added.collisions.length) {
  console.error(`[${TAG}] collision: ${added.collisions.join(', ')} already exist with a different value; left untouched.`);
  process.exit(1);
}
