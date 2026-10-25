import { LEGAL_COMPLIANCE_STRINGS } from './legal-compliance-i18n-data.mjs';
import { LEGAL_CENTER_STRINGS } from './legal-center-i18n-data.mjs';
import { LEGAL_MATCHING_COMM_STRINGS } from './legal-matching-comm-i18n-data.mjs';
import { splice, validate } from './lib/i18nSplice.mjs';
/* Round 2 (legal-center) rewrites some of these keys; it wins, so a rerun of
   this applier never puts the round-1 wording back. */
const strings = Object.fromEntries(Object.entries(LEGAL_COMPLIANCE_STRINGS).filter(([k]) => !(k in LEGAL_CENTER_STRINGS) && !(k in LEGAL_MATCHING_COMM_STRINGS)));
const problems = validate(strings, 'legal-compliance');
if (problems.length) throw new Error(problems.join('\n'));
const file = new URL('../src/i18n/translations.ts', import.meta.url);
const result = splice(file, strings, { banner: 'LEGAL COMPLIANCE (2026-10-25)', tag: 'legal-compliance', overwrite: process.argv.includes('--overwrite') });
if (result.collisions.length) throw new Error(result.collisions.join(', '));
console.log(`${result.added} added, ${result.replaced} replaced, ${result.unchanged} unchanged.`);
