#!/usr/bin/env node
/*
 * Splice the HOMATCH Design Studio strings into src/i18n/translations.ts.
 *
 * The same idempotent pattern as nav-i18n-apply.mjs: whole lines only,
 * placeholder parity with English checked before anything is written, and a
 * key that already exists with a different value is reported and LEFT ALONE
 * (another workstream's string is never silently replaced). Re-running with
 * the same data changes nothing.
 *
 * Data files: scripts/design-studio-i18n-data-*.mjs, order [en, ka, ru, tr, ar, he].
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DS_STRINGS_1 } from './design-studio-i18n-data-1.mjs';
import { DS_STRINGS_2 } from './design-studio-i18n-data-2.mjs';
import { DS_STRINGS_3 } from './design-studio-i18n-data-3.mjs';
import { DS_STRINGS_4 } from './design-studio-i18n-data-4.mjs';
import { DS_STRINGS_5 } from './design-studio-i18n-data-5.mjs';
import { DS_STRINGS_6 } from './design-studio-i18n-data-6.mjs';
import { DS_STRINGS_7 } from './design-studio-i18n-data-7.mjs';
import { DS_STRINGS_8 } from './design-studio-i18n-data-8.mjs';
import { DS_STRINGS_9 } from './design-studio-i18n-data-9.mjs';
import { DS_STRINGS_10 } from './design-studio-i18n-data-10.mjs';
import { DS_STRINGS_11 } from './design-studio-i18n-data-11.mjs';
import { DS_STRINGS_12 } from './design-studio-i18n-data-12.mjs';
import { DS_STRINGS_13 } from './design-studio-i18n-data-13.mjs';
import { DS_STRINGS_14 } from './design-studio-i18n-data-14.mjs';
import { DS_STRINGS_15 } from './design-studio-i18n-data-15.mjs';
import { DS_STRINGS_16 } from './design-studio-i18n-data-16.mjs';
import { DS_STRINGS_17 } from './design-studio-i18n-data-17.mjs';
import { DS_STRINGS_18 } from './design-studio-i18n-data-18.mjs';
import { DS_STRINGS_20 } from './design-studio-i18n-data-20.mjs';
import { DS_STRINGS_21 } from './design-studio-i18n-data-21.mjs';
import { DS_STRINGS_22 } from './design-studio-i18n-data-22.mjs';
import { DS_STRINGS_23 } from './design-studio-i18n-data-23.mjs';
import { DS_STRINGS_24 } from './design-studio-i18n-data-24.mjs';
import { DS_STRINGS_25 } from './design-studio-i18n-data-25.mjs';
import { DS_STRINGS_26 } from './design-studio-i18n-data-26.mjs';
import { DS_STRINGS_27 } from './design-studio-i18n-data-27.mjs';
import { DS_STRINGS_28 } from './design-studio-i18n-data-28.mjs';
import { DS_STRINGS_29, DS_STRINGS_29B } from './design-studio-i18n-data-29.mjs';
import { DS_STRINGS_30 } from './design-studio-i18n-data-30.mjs';
import { DS_STRINGS_31 } from './design-studio-i18n-data-31.mjs';
import { DS_STRINGS_32 } from './design-studio-i18n-data-32.mjs';
import { DS_STRINGS_33 } from './design-studio-i18n-data-33.mjs';
import { DS_STRINGS_34 } from './design-studio-i18n-data-34.mjs';
import { DS_STRINGS_35 } from './design-studio-i18n-data-35.mjs';
import { DS_STRINGS_36 } from './design-studio-i18n-data-36.mjs';
import { DS_STRINGS_37 } from './design-studio-i18n-data-37.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'src', 'i18n', 'translations.ts');
const LANGS = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];

/* Every Design Studio data file, merged. A key defined twice across files is
   FATAL below rather than last-one-wins. */
const SOURCES = [DS_STRINGS_1, DS_STRINGS_2, DS_STRINGS_3, DS_STRINGS_4, DS_STRINGS_5, DS_STRINGS_6, DS_STRINGS_7, DS_STRINGS_8, DS_STRINGS_9, DS_STRINGS_10, DS_STRINGS_11, DS_STRINGS_12, DS_STRINGS_13, DS_STRINGS_14, DS_STRINGS_15, DS_STRINGS_16, DS_STRINGS_17, DS_STRINGS_18, DS_STRINGS_20, DS_STRINGS_21, DS_STRINGS_22, DS_STRINGS_23, DS_STRINGS_24, DS_STRINGS_25, DS_STRINGS_26, DS_STRINGS_27, DS_STRINGS_28, DS_STRINGS_29, DS_STRINGS_29B, DS_STRINGS_30, DS_STRINGS_31, DS_STRINGS_32, DS_STRINGS_33, DS_STRINGS_34, DS_STRINGS_35, DS_STRINGS_36, DS_STRINGS_37];
const STRINGS = {};
const duplicates = [];
for (const source of SOURCES) {
  for (const [key, values] of Object.entries(source)) {
    if (key in STRINGS) duplicates.push(key);
    STRINGS[key] = values;
  }
}
if (duplicates.length) {
  console.error(`[design-studio-i18n] FATAL: defined in more than one data file: ${duplicates.join(', ')}`);
  process.exit(1);
}

function literal(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

const HOLE = /\{\{\s*(\w+)\s*\}\}/g;
const holes = (v) => [...String(v).matchAll(HOLE)].map((m) => m[1]).sort().join(',');

function main() {
  const overwrite = process.argv.includes('--overwrite');
  const entries = Object.entries(STRINGS);

  /* ── Validate everything before touching the file ──────────────── */
  let fatal = 0;
  const seen = new Set();
  for (const [key, values] of entries) {
    if (seen.has(key)) {
      console.error(`[design-studio-i18n] FATAL: ${key} is defined twice across the data files`);
      fatal += 1;
    }
    seen.add(key);

    if (!Array.isArray(values) || values.length !== LANGS.length) {
      console.error(`[design-studio-i18n] FATAL: ${key} has ${values?.length} values, expected ${LANGS.length}`);
      fatal += 1;
      continue;
    }
    const expected = holes(values[0]);
    for (let i = 0; i < LANGS.length; i += 1) {
      const value = values[i];
      if (typeof value !== 'string' || value.trim().length === 0) {
        console.error(`[design-studio-i18n] FATAL: ${key} has an empty ${LANGS[i]} value`);
        fatal += 1;
        continue;
      }
      if (holes(value) !== expected) {
        console.error(
          `[design-studio-i18n] FATAL: ${key} (${LANGS[i]}) has placeholders [${holes(value)}], English has [${expected}]`,
        );
        fatal += 1;
      }
      /* A value that is byte-identical to the English one in a non-Latin
         language is almost always a translation somebody forgot. Georgian,
         Arabic and Hebrew share no code points with English, so this is a
         safe check; Russian and Turkish are skipped because a product name
         or a bare "Push" legitimately matches. */
      if ((LANGS[i] === 'ka' || LANGS[i] === 'ar' || LANGS[i] === 'he') && value === values[0]) {
        if (!/^[\p{Lu}\p{Ll}\s.,'’—–-]*$/u.test(value) || value.length > 24) {
          console.error(`[design-studio-i18n] FATAL: ${key} (${LANGS[i]}) is identical to the English`);
          fatal += 1;
        }
      }
    }
  }
  if (fatal > 0) {
    console.error(`[design-studio-i18n] ${fatal} problem(s); nothing was written.`);
    process.exit(1);
  }

  /* ── Splice ─────────────────────────────────────────────────────── */
  let source = fs.readFileSync(FILE, 'utf8');
  /* A Windows checkout (core.autocrlf) has CRLF line endings. New lines are
     written in whatever the file already uses, and existing lines are matched
     either way, so a re-run on either platform is a no-op, never a duplicate. */
  const EOL = source.includes('\r\n') ? '\r\n' : '\n';
  let added = 0;
  let replaced = 0;
  let unchanged = 0;
  const collisions = new Set();

  for (let langIndex = 0; langIndex < LANGS.length; langIndex += 1) {
    const lang = LANGS[langIndex];
    const opener = lang === 'en' ? 'const en = {' : `const ${lang}: Partial<Record<TranslationKey, string>> = {`;
    const start = source.indexOf(opener);
    if (start === -1) {
      console.error(`[design-studio-i18n] FATAL: could not find the ${lang} bundle opener`);
      process.exit(1);
    }
    const end = source.indexOf(`${EOL}};`, start);
    if (end === -1) {
      console.error(`[design-studio-i18n] FATAL: could not find the end of the ${lang} bundle`);
      process.exit(1);
    }

    let body = source.slice(start, end);
    const fresh = [];

    for (const [key, values] of entries) {
      const next = `  ${key}: ${literal(values[langIndex])},`;
      const line = new RegExp(`^  ${key}: [^\r\n]*,(?=\r?$)`, 'm');
      const found = body.match(line);
      if (!found) {
        fresh.push(next);
        added += 1;
        continue;
      }
      if (found[0] === next) {
        unchanged += 1;
        continue;
      }
      if (!overwrite) {
        collisions.add(key);
        continue;
      }
      body = body.replace(line, () => next);
      replaced += 1;
    }

    if (fresh.length) {
      body += `${EOL}${EOL}  /* ── HOMATCH DESIGN STUDIO ──────────────────────────────────────── */${EOL}${fresh.join(EOL)}`;
    }
    source = source.slice(0, start) + body + source.slice(end);
  }

  if (collisions.size > 0 && !overwrite) {
    console.error(
      `[design-studio-i18n] ${collisions.size} key(s) already exist with a different value and were LEFT ALONE:\n  ` +
        [...collisions].join('\n  ') +
        '\nRe-run with --overwrite only if you are certain they are yours.',
    );
  }

  fs.writeFileSync(FILE, source, 'utf8');
  console.log(
    `[design-studio-i18n] ${added} added, ${replaced} replaced, ${unchanged} already current — ` +
      `${entries.length} key(s) across ${LANGS.length} bundles.`,
  );
  if (collisions.size > 0 && !overwrite) process.exit(1);
}

main();
