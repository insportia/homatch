#!/usr/bin/env node
/*
 * Splice the Service Control Center strings (svc_*, admin_nav_service_control) into
 * src/i18n/translations.ts, through the shared applier in lib/i18nSplice.mjs
 * (placeholder parity with English, non-Latin bundles not identical to English,
 * collisions with another workstream's key).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVICE_CONTROLS_STRINGS } from './service-controls-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'src', 'i18n', 'translations.ts');
const TAG = 'service-controls-i18n';

const problems = validate(SERVICE_CONTROLS_STRINGS, TAG);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(`[${TAG}] ${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}
const result = splice(FILE, SERVICE_CONTROLS_STRINGS, {
  banner: 'SERVICE CONTROL CENTER — Admin pause / resume for six services',
  overwrite: process.argv.includes('--overwrite'),
});
console.log(`[${TAG}] ${result.added} added, ${result.replaced} replaced, ${result.unchanged} unchanged.`);
