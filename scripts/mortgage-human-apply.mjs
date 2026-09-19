#!/usr/bin/env node
/*
 * Splice the humanised Mortgage copy into src/i18n/translations.ts.
 *
 * WHY THIS ONE REPLACES AND THE OTHER APPLIERS DO NOT
 *
 * mortgage-i18n-apply.mjs, investment-i18n-apply.mjs and
 * conversation-i18n-apply.mjs all ADD: a key already in the bundle is
 * left alone and reported as skipped, which is right when the job is
 * "these strings are new".
 *
 * This job is the opposite. Most of the keys here already exist and the
 * reason for the change IS the value: copy that was grammatically
 * correct and unmistakably translated, formal where the rest of the
 * product is familiar, and in several places carrying an internal label
 * into a customer's sentence. Skipping what exists would apply nothing.
 *
 * So this one overwrites in place, key by key and language by language,
 * and prints what it changed. It is still idempotent: a value already
 * equal to the new one is reported as unchanged.
 *
 * SAFETY
 *
 *   - every key must carry six values, all non-empty, or the run aborts
 *     before touching the file;
 *   - a value may only be replaced on a line the parser matched exactly,
 *     never by a loose search-and-replace;
 *   - the placeholder set of each new value is compared with English's,
 *     because a key that names {{monthly}} where the call site passes
 *     {{amount}} is the exact defect this whole change is fixing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MORTGAGE_HUMAN_STRINGS } from './mortgage-human-data.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'src', 'i18n', 'translations.ts');
const LANGS = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];

function literal(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

const HOLE = /\{\{\s*(\w+)\s*\}\}/g;
function holes(value) {
  return [...String(value).matchAll(HOLE)].map((m) => m[1]).sort().join(',');
}

function main() {
  const entries = Object.entries(MORTGAGE_HUMAN_STRINGS);

  for (const [key, values] of entries) {
    if (!Array.isArray(values) || values.length !== LANGS.length) {
      console.error(`[mortgage-human] FATAL: ${key} has ${values?.length} values, expected ${LANGS.length}`);
      process.exit(1);
    }
    const expected = holes(values[0]);
    for (let i = 0; i < LANGS.length; i += 1) {
      const value = values[i];
      if (typeof value !== 'string' || !value.trim()) {
        console.error(`[mortgage-human] FATAL: ${key} has an empty ${LANGS[i]} value`);
        process.exit(1);
      }
      if (holes(value) !== expected) {
        console.error(
          `[mortgage-human] FATAL: ${key} (${LANGS[i]}) has placeholders [${holes(value)}], English has [${expected}]`,
        );
        process.exit(1);
      }
    }
  }

  let source = fs.readFileSync(FILE, 'utf8');
  let replaced = 0;
  let added = 0;
  let unchanged = 0;

  for (let langIndex = 0; langIndex < LANGS.length; langIndex += 1) {
    const lang = LANGS[langIndex];
    const opener = lang === 'en' ? 'const en = {' : `const ${lang}: Partial<Record<TranslationKey, string>> = {`;
    const start = source.indexOf(opener);
    if (start === -1) {
      console.error(`[mortgage-human] FATAL: could not find the ${lang} bundle opener`);
      process.exit(1);
    }
    const end = source.indexOf('\n};', start);
    if (end === -1) {
      console.error(`[mortgage-human] FATAL: could not find the end of the ${lang} bundle`);
      process.exit(1);
    }

    let body = source.slice(start, end);
    const fresh = [];

    for (const [key, values] of entries) {
      const next = `  ${key}: ${literal(values[langIndex])},`;
      /* The whole line, anchored: `  key: '…',` on one line, which is how
         every applier in this repo writes them and how the parser in
         scripts/i18n-lib.mjs reads them back. */
      const line = new RegExp(`^  ${key}: .*,$`, 'm');
      const found = body.match(line);
      if (!found) { fresh.push(next); added += 1; continue; }
      if (found[0] === next) { unchanged += 1; continue; }
      body = body.replace(line, () => next);
      replaced += 1;
    }

    if (fresh.length) {
      body += `\n\n  /* ── MORTGAGE, IN PLAIN LANGUAGE ──────────────────────────────────── */\n${fresh.join('\n')}`;
    }
    source = source.slice(0, start) + body + source.slice(end);
  }

  fs.writeFileSync(FILE, source, 'utf8');
  console.log(
    `[mortgage-human] ${replaced} replaced, ${added} added, ${unchanged} already current — `
    + `${entries.length} key(s) across ${LANGS.length} bundles.`,
  );
}

main();
