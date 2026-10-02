#!/usr/bin/env node
/*
 * Splice the PHASE 2 Universal Discovery copy into src/i18n/translations.ts
 * through the shared applier (placeholder parity, non-Latin bundles that are
 * not English copies, cross-workstream collisions). Idempotent: a key already
 * present is skipped unless --overwrite.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASE2_DISCOVERY_STRINGS } from './phase2-discovery-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');

const problems = validate(PHASE2_DISCOVERY_STRINGS, 'phase2-discovery-i18n');
if (problems.length) {
  for (const p of problems) console.error(p);
  console.error(`[phase2-discovery-i18n] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}
const result = splice(FILE, PHASE2_DISCOVERY_STRINGS, {
  banner: 'PHASE 2 — UNIVERSAL DISCOVERY', overwrite: process.argv.includes('--overwrite'),
});
console.log(`[phase2-discovery-i18n] ${result.added} added, ${result.unchanged} unchanged, ${result.replaced} replaced.`);
