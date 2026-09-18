// PLACEHOLDERS HAVE TO SURVIVE THE ROUND TRIP, IN EVERY LANGUAGE.
//
// WHY THIS EXISTS
//
// LanguageContext.t() interpolates `{{name}}`. It does NOT interpolate
// `{name}` — a single-braced token is left alone and renders to the customer
// exactly as written, so a metric card says "{{n}} years" as "{n} years" and
// a cost line says "No figure supplied for: {list}".
//
// That is precisely what shipped in the first draft of Investment
// Intelligence: 210 placeholders authored with single braces, across six
// bundles. Every gate was green — coverage passed, key-existence passed, the
// hardcoded-string audit passed, the type-check passed, 3,337 unit tests
// passed, the production build passed — because none of them looks at what a
// placeholder is spelled like. It was caught by opening the page.
//
// A defect that survives eight gates and is only visible to a human eye is
// exactly the kind worth a gate of its own.
//
// TWO PROPERTIES, AND THE SECOND IS THE ONE THAT WILL FIRE LATER
//
//   1. No inv_* value carries a single-brace placeholder.
//   2. No value ANYWHERE names a placeholder English does not have.
//   3. No inv_* value DROPS a placeholder English has.
//
// WHY 2 AND 3 ARE DIFFERENT RULES WITH DIFFERENT SCOPES
//
// An UNKNOWN placeholder is always a bug: `{{ay}}` where the call site
// passes `n` can never be substituted, so the braces reach the customer.
// That is true of every key in every language, so rule 2 is global.
//
// A DROPPED placeholder is not always a bug. Arabic and Hebrew render the
// singular of admin_spend_cap_warning_one as "one spend cap…" — the number
// spelled as a word — where English interpolates `{{count}}`. That is better
// localisation than forcing a numeral into a singular, and the count at that
// call site is always 1. Failing it would be this test telling a translator
// their language is wrong. So rule 3 is scoped to inv_*, where the copy is
// this change's own and no such idiom applies; every one of those sentences
// genuinely needs its number.
//
// SCOPE OF RULE 1. inv_* only, because the older `{n}` keys (doc_pages,
// doc_findings_count) are deliberately substituted with .replace() at their
// call sites — a different, pre-existing convention that works, and that
// this test is not here to relitigate.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSourceFile, extractStringRecordLiterals } from '../../../scripts/i18n-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'translations.ts');
const LANGS = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];

const bundles = extractStringRecordLiterals(parseSourceFile(FILE), LANGS);

/** `{{name}}` — the form t() actually substitutes. */
const DOUBLE = /\{\{\s*(\w+)\s*\}\}/g;
/** `{name}` with no second brace on either side — the form that renders raw. */
const SINGLE = /(?<!\{)\{\s*(\w+)\s*\}(?!\})/g;

function placeholdersIn(value) {
  return new Set([...value.matchAll(DOUBLE)].map((m) => m[1]));
}

test('no Investment Intelligence string uses a placeholder t() cannot substitute', () => {
  const offenders = [];
  for (const lang of LANGS) {
    const values = bundles[lang]?.values ?? {};
    for (const [key, value] of Object.entries(values)) {
      if (!key.startsWith('inv_')) continue;
      const singles = [...String(value).matchAll(SINGLE)].map((m) => m[0]);
      if (singles.length) offenders.push(`${lang}.${key}: ${singles.join(' ')}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these would render their braces to a customer:\n${offenders.join('\n')}`,
  );
});

test('no translation invents a placeholder the call site cannot supply', () => {
  const english = bundles.en?.values ?? {};
  const offenders = [];

  for (const [key, enValue] of Object.entries(english)) {
    const expected = placeholdersIn(String(enValue));
    for (const lang of LANGS) {
      if (lang === 'en') continue;
      const value = bundles[lang]?.values?.[key];
      // A key absent from a bundle falls back to English and is the coverage
      // checker's business, not this one's.
      if (typeof value !== 'string') continue;
      const extra = [...placeholdersIn(value)].filter((n) => !expected.has(n));
      if (extra.length) offenders.push(`${lang}.${key}: unknown {{${extra.join('}} {{')}}}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these braces would reach a customer unsubstituted:\n${offenders.join('\n')}`,
  );
});

test('no Investment Intelligence translation drops a number it needs', () => {
  const english = bundles.en?.values ?? {};
  const offenders = [];

  for (const [key, enValue] of Object.entries(english)) {
    if (!key.startsWith('inv_')) continue;
    const expected = placeholdersIn(String(enValue));
    if (!expected.size) continue;
    for (const lang of LANGS) {
      if (lang === 'en') continue;
      const value = bundles[lang]?.values?.[key];
      if (typeof value !== 'string') continue;
      const actual = placeholdersIn(value);
      const missing = [...expected].filter((n) => !actual.has(n));
      if (missing.length) offenders.push(`${lang}.${key}: missing {{${missing.join('}} {{')}}}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these sentences have lost the figure they were written around:\n${offenders.join('\n')}`,
  );
});

test('the placeholders the Investment product relies on are actually present', () => {
  // A spot-check with teeth: these are the keys whose whole point is the
  // number inside them, and an empty one is a sentence with a hole.
  const required = {
    inv_unit_years: ['n'],
    inv_unit_months: ['n'],
    inv_vacancy_option: ['n'],
    inv_cost_gaps: ['list'],
    inv_recovery_crossing: ['years', 'month'],
    inv_hold_scenario_warning: ['price'],
    inv_evidence_support: ['observations', 'sources', 'properties'],
    inv_price_vs_implied: ['amount', 'direction'],
    inv_dscr_below: ['amount'],
    inv_debt_split: ['months'],
  };
  for (const [key, names] of Object.entries(required)) {
    for (const lang of LANGS) {
      const value = bundles[lang]?.values?.[key];
      if (typeof value !== 'string') continue;
      const actual = placeholdersIn(value);
      for (const name of names) {
        assert.ok(actual.has(name), `${lang}.${key} has lost its {{${name}}}`);
      }
    }
  }
});
