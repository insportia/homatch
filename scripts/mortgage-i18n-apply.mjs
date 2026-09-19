#!/usr/bin/env node
// Splice the Home Financing strings into src/i18n/translations.ts.
//
// Same machine as scripts/investment-i18n-apply.mjs and for the same
// reason: translations.ts holds six bundles that must agree key for key,
// and hand-editing six places for each of ~380 keys is how a bundle ends
// up missing forty of them.
//
// IDEMPOTENT AND NON-DESTRUCTIVE. A key already present in a bundle is
// left exactly as it is and reported as skipped; nothing is overwritten.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MORTGAGE_STRINGS_1 } from './mortgage-i18n-data1.mjs';
import { MORTGAGE_STRINGS_2 } from './mortgage-i18n-data2.mjs';
import { MORTGAGE_STRINGS_3 } from './mortgage-i18n-data3.mjs';
import { MORTGAGE_STRINGS_4 } from './mortgage-i18n-data4.mjs';
import { MORTGAGE_STRINGS_5 } from './mortgage-i18n-data5.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'src', 'i18n', 'translations.ts');
const LANGS = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];

const TABLE = {
  ...MORTGAGE_STRINGS_1,
  ...MORTGAGE_STRINGS_2,
  ...MORTGAGE_STRINGS_3,
  ...MORTGAGE_STRINGS_4,
  ...MORTGAGE_STRINGS_5,
};

function literal(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

function main() {
  let source = fs.readFileSync(FILE, 'utf8');
  const keys = Object.keys(TABLE);

  for (const [key, values] of Object.entries(TABLE)) {
    if (!Array.isArray(values) || values.length !== LANGS.length) {
      console.error(`[mortgage-i18n] FATAL: ${key} has ${values?.length} values, expected ${LANGS.length}`);
      process.exit(1);
    }
    for (let i = 0; i < LANGS.length; i += 1) {
      if (typeof values[i] !== 'string' || !values[i].trim()) {
        console.error(`[mortgage-i18n] FATAL: ${key} has an empty ${LANGS[i]} value`);
        process.exit(1);
      }
    }
  }

  let added = 0;
  let skipped = 0;

  for (let langIndex = 0; langIndex < LANGS.length; langIndex += 1) {
    const lang = LANGS[langIndex];
    const opener = lang === 'en' ? 'const en = {' : `const ${lang}: Partial<Record<TranslationKey, string>> = {`;
    const start = source.indexOf(opener);
    if (start === -1) {
      console.error(`[mortgage-i18n] FATAL: could not find the ${lang} bundle opener`);
      process.exit(1);
    }
    const end = source.indexOf('\n};', start);
    if (end === -1) {
      console.error(`[mortgage-i18n] FATAL: could not find the end of the ${lang} bundle`);
      process.exit(1);
    }
    const body = source.slice(start, end);

    const lines = [];
    for (const key of keys) {
      const existing = new RegExp(`^\\s{2}${key}:`, 'm');
      if (existing.test(body)) {
        skipped += 1;
        continue;
      }
      lines.push(`  ${key}: ${literal(TABLE[key][langIndex])},`);
      added += 1;
    }

    if (!lines.length) continue;
    const block = `\n\n  /* ── HOMATCH HOME FINANCING ──────────────────────────────────────── */\n${lines.join('\n')}`;
    source = source.slice(0, end) + block + source.slice(end);
  }

  fs.writeFileSync(FILE, source, 'utf8');
  console.log(`[mortgage-i18n] ${added} value(s) written, ${skipped} already present, across ${LANGS.length} bundles.`);
}

main();
