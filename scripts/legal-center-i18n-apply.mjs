import { LEGAL_CENTER_STRINGS } from './legal-center-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';
const problems = validate(LEGAL_CENTER_STRINGS, 'legal-center');
if (problems.length) throw new Error(problems.join('\n'));
const file = new URL('../src/i18n/translations.ts', import.meta.url);
const result = splice(file, LEGAL_CENTER_STRINGS, { banner: 'LEGAL CENTER (2026-10-25)', tag: 'legal-center', overwrite: process.argv.includes('--overwrite') });
if (result.collisions.length) throw new Error(result.collisions.join(', '));
console.log(`${result.added} added, ${result.replaced} replaced, ${result.unchanged} unchanged.`);
