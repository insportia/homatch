#!/usr/bin/env node
// Splice the Admin control-centre strings into src/i18n/translations.ts.
//
// Cloned from conversation-i18n-apply.mjs, and for the same reason: six
// bundles have to agree key for key, and hand-editing six places is how one
// of them ends up short. Idempotent — a key already present is left exactly
// as it is and reported as skipped, so another workstream's string is never
// overwritten.
//
// One addition: placeholder parity. Every {{name}} in the English value must
// appear in every translation and no other may, checked before a byte is
// written — a translation that names a hole the call site does not fill
// prints braces to an operator.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADMIN_CONTROL_STRINGS, ADMIN_CONTROL_STRINGS_2, ADMIN_CONTROL_STRINGS_3 } from './admin-control-i18n-data.mjs';

const STRINGS = { ...ADMIN_CONTROL_STRINGS, ...ADMIN_CONTROL_STRINGS_2, ...ADMIN_CONTROL_STRINGS_3 };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'src', 'i18n', 'translations.ts');
const LANGS = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];

function literal(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

function main() {
  let source = fs.readFileSync(FILE, 'utf8');
  const keys = Object.keys(STRINGS);

  for (const [key, values] of Object.entries(STRINGS)) {
    if (!Array.isArray(values) || values.length !== LANGS.length) {
      console.error(`[admin-control-i18n] FATAL: ${key} has ${values?.length} values, expected ${LANGS.length}`);
      process.exit(1);
    }
    for (let i = 0; i < LANGS.length; i += 1) {
      if (typeof values[i] !== 'string' || !values[i].trim()) {
        console.error(`[admin-control-i18n] FATAL: ${key} has an empty ${LANGS[i]} value`);
        process.exit(1);
      }
    }
  }

  const holes = (v) => [...String(v).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort().join(',');
  for (const [key, values] of Object.entries(STRINGS)) {
    const want = holes(values[0]);
    for (let i = 1; i < LANGS.length; i += 1) {
      if (holes(values[i]) !== want) {
        console.error(`[admin-control-i18n] FATAL: ${key} (${LANGS[i]}) has placeholders [${holes(values[i])}], English has [${want}]`);
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
      console.error(`[admin-control-i18n] FATAL: could not find the ${lang} bundle opener`);
      process.exit(1);
    }
    const end = source.indexOf('\n};', start);
    if (end === -1) {
      console.error(`[admin-control-i18n] FATAL: could not find the end of the ${lang} bundle`);
      process.exit(1);
    }
    const body = source.slice(start, end);

    const lines = [];
    for (const key of keys) {
      const existing = new RegExp(`^\\s{2}${key}:`, 'm');
      if (existing.test(body)) { skipped += 1; continue; }
      lines.push(`  ${key}: ${literal(STRINGS[key][langIndex])},`);
      added += 1;
    }

    if (!lines.length) continue;
    const block = `\n\n  /* ── HOMATCH ADMIN CONTROL CENTRE ────────────────────────────────── */\n${lines.join('\n')}`;
    source = source.slice(0, end) + block + source.slice(end);
  }

  fs.writeFileSync(FILE, source, 'utf8');
  console.log(`[admin-control-i18n] ${added} value(s) written, ${skipped} already present, across ${LANGS.length} bundles.`);
}

main();
