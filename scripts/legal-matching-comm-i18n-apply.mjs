import { LEGAL_MATCHING_COMM_STRINGS } from './legal-matching-comm-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';
const problems = validate(LEGAL_MATCHING_COMM_STRINGS, 'legal-matching-comm');
if (problems.length) throw new Error(problems.join('\n'));
const file = new URL('../src/i18n/translations.ts', import.meta.url);
const result = splice(file, LEGAL_MATCHING_COMM_STRINGS, { banner: 'LEGAL MATCHING + COMMUNICATION (2026-10-25)', tag: 'legal-matching-comm', overwrite: process.argv.includes('--overwrite') });
if (result.collisions.length) throw new Error(result.collisions.join(', '));
console.log(`${result.added} added, ${result.replaced} replaced, ${result.unchanged} unchanged.`);
