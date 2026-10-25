import { LEGAL_CENTER_STRINGS as ALL } from './legal-center-i18n-data.mjs';
import { LEGAL_MATCHING_COMM_STRINGS } from './legal-matching-comm-i18n-data.mjs';
import { LEGAL_LISTING_CONTACT_STRINGS } from './legal-listing-contact-i18n-data.mjs';
/* Round 3 (legal-matching-comm) rewrites some of these keys and wins on a rerun. */
const LEGAL_CENTER_STRINGS = Object.fromEntries(Object.entries(ALL).filter(([k]) => !(k in LEGAL_MATCHING_COMM_STRINGS) && !(k in LEGAL_LISTING_CONTACT_STRINGS)));
import { splice, validate } from './lib/i18nSplice.mjs';
const problems = validate(LEGAL_CENTER_STRINGS, 'legal-center');
if (problems.length) throw new Error(problems.join('\n'));
const file = new URL('../src/i18n/translations.ts', import.meta.url);
const result = splice(file, LEGAL_CENTER_STRINGS, { banner: 'LEGAL CENTER (2026-10-25)', tag: 'legal-center', overwrite: process.argv.includes('--overwrite') });
if (result.collisions.length) throw new Error(result.collisions.join(', '));
console.log(`${result.added} added, ${result.replaced} replaced, ${result.unchanged} unchanged.`);
