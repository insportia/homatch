#!/usr/bin/env node
// Splice the Investment Intelligence strings into src/i18n/translations.ts.
//
// WHY A SCRIPT AND NOT SIX HAND EDITS
//
// translations.ts is 40,000 lines and holds six bundles that must agree key
// for key. Hand-editing six places for every one of ~330 keys is how a bundle
// ends up missing forty of them, which i18n-check.mjs then reports as a wall
// of failures with no obvious cause. Writing all six from one table makes the
// drift impossible at authoring time rather than detectable afterwards.
//
// IDEMPOTENT AND NON-DESTRUCTIVE. A key that already exists in a bundle is
// left exactly as it is and reported as skipped; nothing is ever overwritten.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INVESTMENT_STRINGS } from './investment-i18n-data.mjs';
import { INVESTMENT_STRINGS_2 } from './investment-i18n-data2.mjs';
import { INVESTMENT_STRINGS_3 } from './investment-i18n-data3.mjs';
import { INVESTMENT_STRINGS_4 } from './investment-i18n-data4.mjs';
import { INVESTMENT_STRINGS_5 } from './investment-i18n-data5.mjs';
import { INVESTMENT_STRINGS_6 } from './investment-i18n-data6.mjs';
import { INVESTMENT_STRINGS_7 } from './investment-i18n-data7.mjs';
import { INVESTMENT_STRINGS_8 } from './investment-i18n-data8.mjs';
import { INVESTMENT_STRINGS_9, INVESTMENT_STRINGS_9B } from './investment-i18n-data9.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'src', 'i18n', 'translations.ts');
const LANGS = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];

const TABLE = {
  ...INVESTMENT_STRINGS,
  ...INVESTMENT_STRINGS_2,
  ...INVESTMENT_STRINGS_3,
  ...INVESTMENT_STRINGS_4,
  ...INVESTMENT_STRINGS_5,
  ...INVESTMENT_STRINGS_6,
  ...INVESTMENT_STRINGS_7,
  ...INVESTMENT_STRINGS_8,
  ...INVESTMENT_STRINGS_9,
  ...INVESTMENT_STRINGS_9B,
};

/** Single-quoted TS literal, escaping only what must be escaped. */
function literal(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

function main() {
  let source = fs.readFileSync(FILE, 'utf8');
  const keys = Object.keys(TABLE);

  for (const [key, values] of Object.entries(TABLE)) {
    if (!Array.isArray(values) || values.length !== LANGS.length) {
      console.error(`[investment-i18n] FATAL: ${key} has ${values?.length} values, expected ${LANGS.length}`);
      process.exit(1);
    }
    for (let i = 0; i < LANGS.length; i += 1) {
      if (typeof values[i] !== 'string' || !values[i].trim()) {
        console.error(`[investment-i18n] FATAL: ${key} has an empty ${LANGS[i]} value`);
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
      console.error(`[investment-i18n] FATAL: could not find the ${lang} bundle opener`);
      process.exit(1);
    }
    // The bundle ends at the first line that is exactly "};" after the opener.
    const end = source.indexOf('\n};', start);
    if (end === -1) {
      console.error(`[investment-i18n] FATAL: could not find the end of the ${lang} bundle`);
      process.exit(1);
    }
    const body = source.slice(start, end);

    const lines = [];
    for (const key of keys) {
      // Word-boundary match on the key as a property name at line start.
      const existing = new RegExp(`^\\s{2}${key}:`, 'm');
      if (existing.test(body)) {
        skipped += 1;
        continue;
      }
      lines.push(`  ${key}: ${literal(TABLE[key][langIndex])},`);
      added += 1;
    }

    if (!lines.length) continue;
    const block = `\n\n  /* ── HOMATCH INVESTMENT INTELLIGENCE ─────────────────────────────── */\n${lines.join('\n')}`;
    source = source.slice(0, end) + block + source.slice(end);
  }

  fs.writeFileSync(FILE, source, 'utf8');
  console.log(`[investment-i18n] ${added} value(s) written, ${skipped} already present, across ${LANGS.length} bundles.`);
}

main();
