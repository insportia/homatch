import { LEGAL_LISTING_CONTACT_STRINGS } from './legal-listing-contact-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';
const problems = validate(LEGAL_LISTING_CONTACT_STRINGS, 'legal-listing-contact');
if (problems.length) throw new Error(problems.join('\n'));
const file = new URL('../src/i18n/translations.ts', import.meta.url);
const result = splice(file, LEGAL_LISTING_CONTACT_STRINGS, { banner: 'LEGAL LISTING CONTACT (2026-10-25)', tag: 'legal-listing-contact', overwrite: process.argv.includes('--overwrite') });
if (result.collisions.length) throw new Error(result.collisions.join(', '));
console.log(`${result.added} added, ${result.replaced} replaced, ${result.unchanged} unchanged.`);
