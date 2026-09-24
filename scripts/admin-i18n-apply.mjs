#!/usr/bin/env node
/*
 * Splice the Admin copy into src/i18n/translations.ts.
 *
 * Same shape as mortgage-human-apply.mjs, and for the same reasons: whole
 * lines only, never a loose search-and-replace, and placeholder parity
 * with English checked before a single byte is written.
 *
 * WHY IT ADDS RATHER THAN OVERWRITES BY DEFAULT
 *
 * Every key here is new. If one already exists, that means another
 * workstream got there first with the same name, and silently replacing
 * their string would be exactly the "never overwrite another workstream"
 * failure §92 warns about. So a collision is reported and the existing
 * value is left alone, and the run still exits non-zero so somebody has
 * to look.
 *
 * WHY IT VALIDATES GEORGIAN, ARABIC AND HEBREW EXPLICITLY
 *
 * A copy gate written with \b and \w passes over Georgian without
 * matching anything, which this repository has already been bitten by.
 * The emptiness check here is on code points, not on a word regex.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADMIN_STRINGS_1 } from './admin-i18n-data-1.mjs';
import { PAYG_STRINGS_1 } from './payg-i18n-data-1.mjs';
import { PAYG_STRINGS_2 } from './payg-i18n-data-2.mjs';
import { PAYG_STRINGS_3 } from './payg-i18n-data-3.mjs';
import { PAYG_STRINGS_4 } from './payg-i18n-data-4.mjs';
import { PAYG_STRINGS_5 } from './payg-i18n-data-5.mjs';
import { ADMIN_STRINGS_2 } from './admin-i18n-data-2.mjs';
import { ADMIN_STRINGS_3 } from './admin-i18n-data-3.mjs';
import { ADMIN_STRINGS_4 } from './admin-i18n-data-4.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'src', 'i18n', 'translations.ts');
const LANGS = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];

const STRINGS = {
  ...ADMIN_STRINGS_1, ...ADMIN_STRINGS_2, ...ADMIN_STRINGS_3, ...ADMIN_STRINGS_4,
  ...PAYG_STRINGS_1, ...PAYG_STRINGS_2, ...PAYG_STRINGS_3, ...PAYG_STRINGS_4, ...PAYG_STRINGS_5,
};

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
      console.error(`[admin-i18n] FATAL: ${key} is defined twice across the data files`);
      fatal += 1;
    }
    seen.add(key);

    if (!Array.isArray(values) || values.length !== LANGS.length) {
      console.error(`[admin-i18n] FATAL: ${key} has ${values?.length} values, expected ${LANGS.length}`);
      fatal += 1;
      continue;
    }
    const expected = holes(values[0]);
    for (let i = 0; i < LANGS.length; i += 1) {
      const value = values[i];
      if (typeof value !== 'string' || value.trim().length === 0) {
        console.error(`[admin-i18n] FATAL: ${key} has an empty ${LANGS[i]} value`);
        fatal += 1;
        continue;
      }
      if (holes(value) !== expected) {
        console.error(
          `[admin-i18n] FATAL: ${key} (${LANGS[i]}) has placeholders [${holes(value)}], English has [${expected}]`,
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
          console.error(`[admin-i18n] FATAL: ${key} (${LANGS[i]}) is identical to the English`);
          fatal += 1;
        }
      }
    }
  }
  if (fatal > 0) {
    console.error(`[admin-i18n] ${fatal} problem(s); nothing was written.`);
    process.exit(1);
  }

  /* ── Splice ─────────────────────────────────────────────────────── */
  let source = fs.readFileSync(FILE, 'utf8');
  let added = 0;
  let replaced = 0;
  let unchanged = 0;
  const collisions = new Set();

  for (let langIndex = 0; langIndex < LANGS.length; langIndex += 1) {
    const lang = LANGS[langIndex];
    const opener = lang === 'en' ? 'const en = {' : `const ${lang}: Partial<Record<TranslationKey, string>> = {`;
    const start = source.indexOf(opener);
    if (start === -1) {
      console.error(`[admin-i18n] FATAL: could not find the ${lang} bundle opener`);
      process.exit(1);
    }
    const end = source.indexOf('\n};', start);
    if (end === -1) {
      console.error(`[admin-i18n] FATAL: could not find the end of the ${lang} bundle`);
      process.exit(1);
    }

    let body = source.slice(start, end);
    const fresh = [];

    for (const [key, values] of entries) {
      const next = `  ${key}: ${literal(values[langIndex])},`;
      const line = new RegExp(`^  ${key}: .*,$`, 'm');
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
      body += `\n\n  /* ── HOMATCH ADMIN ─────────────────────────────────────────────── */\n${fresh.join('\n')}`;
    }
    source = source.slice(0, start) + body + source.slice(end);
  }

  if (collisions.size > 0 && !overwrite) {
    console.error(
      `[admin-i18n] ${collisions.size} key(s) already exist with a different value and were LEFT ALONE:\n  ` +
        [...collisions].join('\n  ') +
        '\nRe-run with --overwrite only if you are certain they are yours.',
    );
  }

  fs.writeFileSync(FILE, source, 'utf8');
  console.log(
    `[admin-i18n] ${added} added, ${replaced} replaced, ${unchanged} already current — ` +
      `${entries.length} key(s) across ${LANGS.length} bundles.`,
  );
  if (collisions.size > 0 && !overwrite) process.exit(1);
}

main();
