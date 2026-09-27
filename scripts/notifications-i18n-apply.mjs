#!/usr/bin/env node
// Splice the Notification Center strings into src/i18n/translations.ts.
//
// Same machine as the conversation, investment and mortgage appliers, and for the same
// reason: six bundles have to agree key for key, and hand-editing six places is how one
// of them ends up short. Idempotent — a key already present is left exactly as it is
// and reported as skipped.
//
// It also applies a short list of CORRECTIONS to existing notification values that were
// wrong (see notifications-i18n-data.mjs). A correction replaces that key's line in that
// one bundle; a value that is already correct is not rewritten.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOTIFICATION_CORRECTIONS, NOTIFICATION_STRINGS } from './notifications-i18n-data.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'src', 'i18n', 'translations.ts');
const LANGS = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];

function literal(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

function bundleRange(source, lang) {
  const opener = lang === 'en' ? 'const en = {' : `const ${lang}: Partial<Record<TranslationKey, string>> = {`;
  const start = source.indexOf(opener);
  if (start === -1) {
    console.error(`[notifications-i18n] FATAL: could not find the ${lang} bundle opener`);
    process.exit(1);
  }
  const end = source.indexOf('\n};', start);
  if (end === -1) {
    console.error(`[notifications-i18n] FATAL: could not find the end of the ${lang} bundle`);
    process.exit(1);
  }
  return { start, end };
}

function main() {
  let source = fs.readFileSync(FILE, 'utf8');
  const keys = Object.keys(NOTIFICATION_STRINGS);

  for (const [key, values] of Object.entries(NOTIFICATION_STRINGS)) {
    if (!Array.isArray(values) || values.length !== LANGS.length) {
      console.error(`[notifications-i18n] FATAL: ${key} has ${values?.length} values, expected ${LANGS.length}`);
      process.exit(1);
    }
    for (let i = 0; i < LANGS.length; i += 1) {
      if (typeof values[i] !== 'string' || !values[i].trim()) {
        console.error(`[notifications-i18n] FATAL: ${key} has an empty ${LANGS[i]} value`);
        process.exit(1);
      }
      /* A placeholder in one language must be in all of them, or that language
         renders a literal "{{n}}" or drops the number. */
      const want = (values[0].match(/\{\{\w+\}\}/g) ?? []).sort().join(',');
      const got = (values[i].match(/\{\{\w+\}\}/g) ?? []).sort().join(',');
      if (want !== got) {
        console.error(`[notifications-i18n] FATAL: ${key} placeholders differ in ${LANGS[i]}: ${got} vs ${want}`);
        process.exit(1);
      }
    }
  }

  let added = 0;
  let skipped = 0;
  let corrected = 0;

  for (let langIndex = 0; langIndex < LANGS.length; langIndex += 1) {
    const lang = LANGS[langIndex];
    const { start, end } = bundleRange(source, lang);
    const body = source.slice(start, end);

    const lines = [];
    for (const key of keys) {
      const existing = new RegExp(`^\\s{2}${key}:`, 'm');
      if (existing.test(body)) { skipped += 1; continue; }
      lines.push(`  ${key}: ${literal(NOTIFICATION_STRINGS[key][langIndex])},`);
      added += 1;
    }

    if (!lines.length) continue;
    const block = `\n\n  /* ── HOMATCH NOTIFICATION CENTER ──────────────────────────────────── */\n${lines.join('\n')}`;
    source = source.slice(0, end) + block + source.slice(end);
  }

  for (const [lang, fixes] of Object.entries(NOTIFICATION_CORRECTIONS)) {
    for (const [key, value] of Object.entries(fixes)) {
      const { start, end } = bundleRange(source, lang);
      const body = source.slice(start, end);
      const line = new RegExp(`^(\\s{2}${key}: )'(?:[^'\\\\]|\\\\.)*',$`, 'm');
      const m = line.exec(body);
      if (!m) {
        console.error(`[notifications-i18n] FATAL: ${lang}.${key} is not present to correct`);
        process.exit(1);
      }
      const replacement = `${m[1]}${literal(value)},`;
      if (m[0] === replacement) continue;
      const at = start + m.index;
      source = source.slice(0, at) + replacement + source.slice(at + m[0].length);
      corrected += 1;
    }
  }

  fs.writeFileSync(FILE, source, 'utf8');
  console.log(`[notifications-i18n] ${added} value(s) written, ${skipped} already present, ${corrected} corrected, across ${LANGS.length} bundles.`);
}

main();
