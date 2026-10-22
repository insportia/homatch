#!/usr/bin/env node
/*
 * Splice the buyer-via-broker label (owner, 2026-10-18) into src/i18n/translations.ts
 * (shared applier lib/i18nSplice.mjs: placeholder parity, non-Latin bundle checks).
 * Idempotent: a second run changes nothing; a different existing value is a collision.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FB_BUYER_VIA_BROKER_ADDED } from './fb-buyer-via-broker-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'fb-buyer-via-broker-i18n';

const problems = validate(FB_BUYER_VIA_BROKER_ADDED, TAG);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}
const added = splice(FILE, FB_BUYER_VIA_BROKER_ADDED, {
  banner: 'FIND BUYERS — request through a broker', overwrite: false, tag: TAG,
});
console.log(`[${TAG}] ${added.added} added, ${added.unchanged} unchanged.`);
if (added.collisions.length) {
  console.error(`[${TAG}] collision: ${added.collisions.join(', ')} already exist with a different value; left untouched.`);
  process.exit(1);
}
