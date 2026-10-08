import { FIND_PROPERTY_RESULTS_STRINGS } from './find-property-results-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';
const problems = validate(FIND_PROPERTY_RESULTS_STRINGS, 'find-property-results');
if (problems.length) throw new Error(problems.join('\n'));
const file = new URL('../src/i18n/translations.ts', import.meta.url);
const result = splice(file, FIND_PROPERTY_RESULTS_STRINGS, { banner: 'FIND PROPERTY RESULTS', tag: 'find-property-results', overwrite: process.argv.includes('--overwrite') });
if (result.collisions.length) throw new Error(result.collisions.join(', '));
console.log(`${result.added} localized result strings added.`);
