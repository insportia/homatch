import { splice, validate } from './lib/i18nSplice.mjs';
import { PUBLISHING_STRINGS } from './publishing-i18n-data.mjs';
const problems = validate(PUBLISHING_STRINGS, 'publishing');
if (problems.length) throw new Error(problems.join('\n'));
const result = splice(
  new URL('../src/i18n/translations.ts', import.meta.url),
  PUBLISHING_STRINGS,
  { banner: 'PROPERTY PUBLISHING', tag: 'publishing', overwrite: false },
);
if (result.collisions.length)
  throw new Error(`Translation collisions: ${result.collisions.join(', ')}`);
console.log(JSON.stringify(result));
