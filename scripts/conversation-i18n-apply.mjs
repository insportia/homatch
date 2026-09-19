#!/usr/bin/env node
// Splice the conversation-standard strings into src/i18n/translations.ts.
//
// Same machine as the investment and mortgage appliers, and for the same
// reason: six bundles have to agree key for key, and hand-editing six
// places is how one of them ends up short. Idempotent — a key already
// present is left exactly as it is and reported as skipped.
//
// These keys are not mortgage-specific: the suggested replies, the
// out-of-credits state and the welcome grant belong to every Homatch
// conversation, which is why they have their own file rather than
// living inside the mortgage data set.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONVERSATION_STRINGS } from './conversation-i18n-data.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'src', 'i18n', 'translations.ts');
const LANGS = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];

function literal(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

function main() {
  let source = fs.readFileSync(FILE, 'utf8');
  const keys = Object.keys(CONVERSATION_STRINGS);

  for (const [key, values] of Object.entries(CONVERSATION_STRINGS)) {
    if (!Array.isArray(values) || values.length !== LANGS.length) {
      console.error(`[conversation-i18n] FATAL: ${key} has ${values?.length} values, expected ${LANGS.length}`);
      process.exit(1);
    }
    for (let i = 0; i < LANGS.length; i += 1) {
      if (typeof values[i] !== 'string' || !values[i].trim()) {
        console.error(`[conversation-i18n] FATAL: ${key} has an empty ${LANGS[i]} value`);
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
      console.error(`[conversation-i18n] FATAL: could not find the ${lang} bundle opener`);
      process.exit(1);
    }
    const end = source.indexOf('\n};', start);
    if (end === -1) {
      console.error(`[conversation-i18n] FATAL: could not find the end of the ${lang} bundle`);
      process.exit(1);
    }
    const body = source.slice(start, end);

    const lines = [];
    for (const key of keys) {
      const existing = new RegExp(`^\\s{2}${key}:`, 'm');
      if (existing.test(body)) { skipped += 1; continue; }
      lines.push(`  ${key}: ${literal(CONVERSATION_STRINGS[key][langIndex])},`);
      added += 1;
    }

    if (!lines.length) continue;
    const block = `\n\n  /* ── HOMATCH CONVERSATION ────────────────────────────────────────── */\n${lines.join('\n')}`;
    source = source.slice(0, end) + block + source.slice(end);
  }

  fs.writeFileSync(FILE, source, 'utf8');
  console.log(`[conversation-i18n] ${added} value(s) written, ${skipped} already present, across ${LANGS.length} bundles.`);
}

main();
