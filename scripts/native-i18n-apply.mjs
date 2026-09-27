#!/usr/bin/env node
// Splice the native-relationship strings (Message, Call, potential interest) into
// src/i18n/translations.ts. Same idempotent machine as the other appliers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NATIVE_STRINGS } from './native-i18n-data.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'src', 'i18n', 'translations.ts');
const LANGS = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];

function literal(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

function main() {
  let source = fs.readFileSync(FILE, 'utf8');
  const keys = Object.keys(NATIVE_STRINGS);

  for (const [key, values] of Object.entries(NATIVE_STRINGS)) {
    if (!Array.isArray(values) || values.length !== LANGS.length) {
      console.error(`[native-i18n] FATAL: ${key} has ${values?.length} values, expected ${LANGS.length}`);
      process.exit(1);
    }
    for (let i = 0; i < LANGS.length; i += 1) {
      if (typeof values[i] !== 'string' || !values[i].trim()) {
        console.error(`[native-i18n] FATAL: ${key} has an empty ${LANGS[i]} value`);
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
      console.error(`[native-i18n] FATAL: could not find the ${lang} bundle opener`);
      process.exit(1);
    }
    const end = source.indexOf('\n};', start);
    if (end === -1) {
      console.error(`[native-i18n] FATAL: could not find the end of the ${lang} bundle`);
      process.exit(1);
    }
    const body = source.slice(start, end);

    const lines = [];
    for (const key of keys) {
      const existing = new RegExp(`^\\s{2}${key}:`, 'm');
      if (existing.test(body)) { skipped += 1; continue; }
      lines.push(`  ${key}: ${literal(NATIVE_STRINGS[key][langIndex])},`);
      added += 1;
    }

    if (!lines.length) continue;
    const block = `\n\n  /* ── HOMATCH NATIVE RELATIONSHIPS ────────────────────────────────────────── */\n${lines.join('\n')}`;
    source = source.slice(0, end) + block + source.slice(end);
  }

  fs.writeFileSync(FILE, source, 'utf8');
  console.log(`[native-i18n] ${added} value(s) written, ${skipped} already present, across ${LANGS.length} bundles.`);
}

main();
