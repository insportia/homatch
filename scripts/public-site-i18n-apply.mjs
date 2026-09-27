#!/usr/bin/env node
// Splice the public-site copy into src/i18n/translations.ts.
//
// Cloned from conversation-i18n-apply.mjs, with one difference: a key that
// already exists is REWRITTEN to the value in public-site-i18n-data.mjs rather
// than skipped. This data file is the source of truth for its own keys, and a
// reworded Georgian sentence has to reach the bundle without somebody
// deleting six lines by hand first. Still idempotent: a second run changes
// nothing, and reports every key as unchanged.
//
//   node scripts/public-site-i18n-apply.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_SITE_STRINGS } from './public-site-i18n-data.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'src', 'i18n', 'translations.ts');
const LANGS = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];
const TAG = '[public-site-i18n]';

function literal(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function main() {
  let source = fs.readFileSync(FILE, 'utf8');
  const keys = Object.keys(PUBLIC_SITE_STRINGS);

  for (const [key, values] of Object.entries(PUBLIC_SITE_STRINGS)) {
    if (!Array.isArray(values) || values.length !== LANGS.length) {
      console.error(`${TAG} FATAL: ${key} has ${values?.length} values, expected ${LANGS.length}`);
      process.exit(1);
    }
    for (let i = 0; i < LANGS.length; i += 1) {
      if (typeof values[i] !== 'string' || !values[i].trim()) {
        console.error(`${TAG} FATAL: ${key} has an empty ${LANGS[i]} value`);
        process.exit(1);
      }
    }
    /* The one Georgian word this copy must never use for "match". */
    if (values[1].includes('შესატყვის')) {
      console.error(`${TAG} FATAL: ${key} says შესატყვისი; a match is დამთხვევა`);
      process.exit(1);
    }
  }

  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (let langIndex = 0; langIndex < LANGS.length; langIndex += 1) {
    const lang = LANGS[langIndex];
    const opener = lang === 'en' ? 'const en = {' : `const ${lang}: Partial<Record<TranslationKey, string>> = {`;
    const start = source.indexOf(opener);
    if (start === -1) {
      console.error(`${TAG} FATAL: could not find the ${lang} bundle opener`);
      process.exit(1);
    }
    let end = source.indexOf('\n};', start);
    if (end === -1) {
      console.error(`${TAG} FATAL: could not find the end of the ${lang} bundle`);
      process.exit(1);
    }

    const lines = [];
    for (const key of keys) {
      const wanted = `  ${key}: ${literal(PUBLIC_SITE_STRINGS[key][langIndex])},`;
      const line = new RegExp(`^\\s{2}${escapeRegExp(key)}:.*$`, 'm');
      const body = source.slice(start, end);
      const match = line.exec(body);
      if (!match) {
        lines.push(wanted);
        added += 1;
        continue;
      }
      if (match[0] === wanted) { unchanged += 1; continue; }
      const at = start + match.index;
      source = source.slice(0, at) + wanted + source.slice(at + match[0].length);
      end = source.indexOf('\n};', start);
      updated += 1;
    }

    if (!lines.length) continue;
    const block = `\n\n  /* ── HOMATCH PUBLIC SITE ───────────────────────────────────────── */\n${lines.join('\n')}`;
    source = source.slice(0, end) + block + source.slice(end);
  }

  fs.writeFileSync(FILE, source, 'utf8');
  console.log(`${TAG} ${added} added, ${updated} updated, ${unchanged} unchanged, across ${LANGS.length} bundles.`);
}

main();
