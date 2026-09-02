#!/usr/bin/env node
// i18n coverage checker — run as `npm run i18n:check`.
//
// Verifies that every translation key defined in the canonical English
// bundle (src/i18n/translations.ts) has a REAL, non-empty, non-English-copy
// value in every other supported language, mirroring how the app actually
// resolves strings at runtime (`{ ...en, ...ka }` in translations.ts, then
// LanguageContext.t() falling back to English for anything still missing).
// A key that only exists in `en` silently renders in English for every
// other language — this script's whole job is to make that failure loud
// and CI-visible instead of silent.
//
// Exits 0 when every language has full, real coverage; exits 1 and prints a
// per-language report otherwise. This is a build-time/CI check, distinct
// from LanguageContext's dev-only console.warn (which flags a missing key
// the moment it's actually rendered, at runtime, in development only).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSourceFile, extractStringRecordLiterals } from './i18n-lib.mjs';
import { ALLOW_DUPLICATE_KEYS, isAutoInvariantValue } from './i18n-allowlist.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRANSLATIONS_FILE = path.join(__dirname, '..', 'src', 'i18n', 'translations.ts');
const LANGS = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];
const NON_ENGLISH = LANGS.filter(l => l !== 'en');

function main() {
  const sourceFile = parseSourceFile(TRANSLATIONS_FILE);
  const extracted = extractStringRecordLiterals(sourceFile, LANGS);

  const enBucket = extracted.en;
  if (!enBucket || Object.keys(enBucket.values).length === 0) {
    console.error(`[i18n:check] FATAL: could not find a \`const en = { ... }\` string literal object in ${TRANSLATIONS_FILE}`);
    process.exit(1);
  }
  const enKeys = Object.keys(enBucket.values);
  if (enBucket.nonString.length) {
    console.warn(`[i18n:check] WARNING: ${enBucket.nonString.length} key(s) in \`en\` are not plain string literals and were skipped: ${enBucket.nonString.join(', ')}`);
  }

  let hadFailure = false;
  const report = [];

  for (const lang of NON_ENGLISH) {
    const bucket = extracted[lang];
    if (!bucket) {
      console.error(`[i18n:check] FATAL: could not find \`const ${lang} = { ... }\` in ${TRANSLATIONS_FILE}`);
      process.exit(1);
    }
    const missing = [];
    const empty = [];
    const duplicateOfEnglish = [];

    for (const key of enKeys) {
      const hasOwn = Object.prototype.hasOwnProperty.call(bucket.values, key);
      const enValue = enBucket.values[key];
      if (!hasOwn) {
        missing.push(key);
        continue;
      }
      const value = bucket.values[key];
      if (value.trim() === '') {
        empty.push(key);
        continue;
      }
      if (value === enValue) {
        if (ALLOW_DUPLICATE_KEYS.has(key) || isAutoInvariantValue(enValue)) continue;
        duplicateOfEnglish.push(key);
      }
    }

    const total = enKeys.length;
    const realCoverage = total - missing.length - empty.length - duplicateOfEnglish.length;
    const pct = ((realCoverage / total) * 100).toFixed(1);
    report.push({ lang, total, missing, empty, duplicateOfEnglish, pct });
    if (missing.length || empty.length || duplicateOfEnglish.length) hadFailure = true;
  }

  console.log('\n=== i18n coverage report ===');
  console.log(`Canonical keys (en): ${enKeys.length}\n`);
  for (const r of report) {
    const status = (r.missing.length || r.empty.length || r.duplicateOfEnglish.length) ? 'FAIL' : 'OK';
    console.log(`[${status}] ${r.lang}: ${r.pct}% real coverage (${r.total - r.missing.length - r.empty.length - r.duplicateOfEnglish.length}/${r.total})`);
    if (r.missing.length) console.log(`  missing (${r.missing.length}): ${r.missing.slice(0, 25).join(', ')}${r.missing.length > 25 ? ', …' : ''}`);
    if (r.empty.length) console.log(`  empty (${r.empty.length}): ${r.empty.slice(0, 25).join(', ')}${r.empty.length > 25 ? ', …' : ''}`);
    if (r.duplicateOfEnglish.length) console.log(`  identical-to-English, likely untranslated (${r.duplicateOfEnglish.length}): ${r.duplicateOfEnglish.slice(0, 25).join(', ')}${r.duplicateOfEnglish.length > 25 ? ', …' : ''}`);
  }
  console.log('');

  if (hadFailure) {
    console.error('[i18n:check] FAILED — one or more languages have incomplete or placeholder translations.');
    console.error('If a flagged key is an INTENTIONAL cross-language invariant (a brand name, a code, a unit), add it to ALLOW_DUPLICATE_KEYS in scripts/i18n-allowlist.mjs — do not silently ignore this report.');
    process.exit(1);
  }
  console.log('[i18n:check] PASSED — all languages have full, real coverage.');
  process.exit(0);
}

main();
