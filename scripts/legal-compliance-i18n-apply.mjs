import { LEGAL_COMPLIANCE_STRINGS } from './legal-compliance-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';
const problems = validate(LEGAL_COMPLIANCE_STRINGS, 'legal-compliance');
if (problems.length) throw new Error(problems.join('\n'));
const file = new URL('../src/i18n/translations.ts', import.meta.url);
const result = splice(file, LEGAL_COMPLIANCE_STRINGS, { banner: 'LEGAL COMPLIANCE (2026-10-25)', tag: 'legal-compliance', overwrite: process.argv.includes('--overwrite') });
if (result.collisions.length) throw new Error(result.collisions.join(', '));
console.log(`${result.added} added, ${result.replaced} replaced, ${result.unchanged} unchanged.`);
