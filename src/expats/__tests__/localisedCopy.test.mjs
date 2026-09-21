// The Georgian a Georgian speaker actually reads, and the links that exist.
//
// The owner tested FOR EXPATS in production and reported three things.
// Two of them were invisible to every gate the product had, because both
// gates were asking the wrong question:
//
//   THE COPY GATE ASKED WHETHER KEYS EXISTED. All 326 did, in all six
//   languages, and several of the Georgian ones were wrong Georgian. A key
//   census cannot tell "the plan remembers" from "the plan you remember",
//   and it cannot see a verb agreeing with the wrong subject. What it CAN
//   see is the machinery that produces those faults: Latin words left in
//   Georgian prose, a placeholder given a case ending Georgian does not
//   attach that way, and the specific sentences that were already wrong
//   once. Those are what is checked here.
//
//   THE ROUTE GATE ASKED WHETHER ROUTES RENDERED. Seven links on the
//   landing page pointed at paths that were never added to the router, so
//   all seven rendered — correctly, quickly, and with "We do not have this
//   page" on them. A link is not covered by testing the pages that exist.
//   Every internal destination in this product is resolved here against
//   the router and against the anchor ids on the page it lives on.
//
// Both checks are static and take milliseconds. The browser-level proof
// that a row is READABLE lives in tests/mobile/expatsReadable.test.mjs;
// this file is the part that can run everywhere, every time.
//
// A NOTE ON MATCHING GEORGIAN
//
// \b and \w are ASCII. A rule written with them sweeps a Georgian bundle,
// matches nothing, and reports success over every string in it. Nothing
// here uses either: Georgian is matched by its Unicode block and Latin
// runs by an explicit character class.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const GEORGIAN = /[Ⴀ-ჿ]/;
const LATIN_RUN = /[A-Za-z][A-Za-z'’-]*/g;

/** Every `key: 'value'` in one locale's object literal. */
function bundleFor(src, locale) {
  const opener =
    locale === 'en'
      ? 'const en = {'
      : `const ${locale}: Partial<Record<TranslationKey, string>> = {`;
  const start = src.indexOf(opener);
  assert.notEqual(start, -1, `locale bundle ${locale} not found`);
  const body = src.slice(start, src.indexOf('\n};', start));
  const out = {};
  for (const m of body.matchAll(/^ {2}([a-z0-9_]+): '((?:[^'\\]|\\.)*)',$/gm)) {
    out[m[1]] = m[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  }
  return out;
}

const SRC = read('src/i18n/translations.ts');
const EN = bundleFor(SRC, 'en');
const KA = bundleFor(SRC, 'ka');
const EXPAT_KEYS = Object.keys(EN).filter((k) => k.startsWith('expat_')).sort();

/**
 * Latin that belongs in Georgian copy.
 *
 * Proper names, currency and unit symbols. Everything else in Latin script
 * inside a Georgian string is English that was never translated — which is
 * precisely the leakage the owner asked to be ruled out, and it is allowed
 * to be a name without being allowed to be a sentence.
 */
const LATIN_ALLOWED = new Set([
  'Homatch', 'Magticom', 'GEL', 'USD', 'EUR', 'UTC', 'IT',
  'Mbps', 'kWh', 'GNERC',
]);

test('the Georgian bundle is Georgian, and every expat key has one', () => {
  const missing = EXPAT_KEYS.filter((k) => !KA[k]);
  assert.deepEqual(missing, [], `Georgian missing for: ${missing.join(', ')}`);

  /* A Georgian string with no Georgian letters in it is either untranslated
     English or a bare placeholder that slipped through. Keys whose English
     is itself only a symbol or a number are exempt. */
  const notGeorgian = EXPAT_KEYS.filter(
    (k) => GEORGIAN.test(EN[k]) === false && /[A-Za-z]{3}/.test(EN[k]) && !GEORGIAN.test(KA[k]),
  );
  assert.deepEqual(notGeorgian, [], `no Georgian characters in: ${notGeorgian.join(', ')}`);

  const identical = EXPAT_KEYS.filter((k) => KA[k] === EN[k] && /[A-Za-z]{4}/.test(EN[k]));
  assert.deepEqual(identical, [], `Georgian is a copy of the English for: ${identical.join(', ')}`);
});

test('no English leaks into Georgian copy except names and units', () => {
  const offenders = [];
  for (const key of EXPAT_KEYS) {
    /* {{placeholders}} are substituted before a reader sees them, and a
       Latin stem carrying a Georgian case suffix (Homatch-ის) is correct
       Georgian typography rather than leakage. */
    const prose = KA[key]
      .replace(/\{\{[^}]*\}\}/g, ' ')
      .replace(/[A-Za-z]+-(?=[Ⴀ-ჿ])/g, ' ');
    const latin = [...prose.matchAll(LATIN_RUN)]
      .map((m) => m[0])
      .filter((w) => w.length > 1 && !LATIN_ALLOWED.has(w));
    if (latin.length) offenders.push(`${key}: ${[...new Set(latin)].join(' ')}`);
  }
  assert.deepEqual(offenders, [], `English words inside Georgian strings:\n  ${offenders.join('\n  ')}`);
});

test('Georgian never hyphenates a case ending onto an interpolated name', () => {
  /*
   * `{{city}}-ში` renders "თბილისი-ში". Georgian attaches the postposition
   * directly and drops the nominative ending — თბილისში — so the hyphen
   * form is wrong for any Georgian value, and t() cannot inflect. The only
   * safe construction is one that needs no case ending on the placeholder,
   * which is why these headings are written with the name in apposition.
   *
   * Numerals and dates are the opposite case: 3-ს and 2026-04-01-დან are
   * exactly how Georgian suffixes those, so the rule is scoped to the
   * placeholders that carry a WORD — a city, a development, a task title.
   */
  const NAMED = new Set(['city', 'project', 'what', 'name', 'publisher', 'district', 'title']);
  const offenders = [];
  for (const key of EXPAT_KEYS) {
    for (const m of KA[key].matchAll(/\{\{(\w+)\}\}-[Ⴀ-ჿ]/g)) {
      if (NAMED.has(m[1])) offenders.push(`${key}: {{${m[1]}}}-…`);
    }
  }
  assert.deepEqual(offenders, [], `case ending hyphenated onto a name:\n  ${offenders.join('\n  ')}`);
});

test('the Georgian faults the owner found do not come back', () => {
  /*
   * Each of these shipped. They are listed as the exact wrong string so a
   * regeneration of the bundle that reintroduces one fails here rather
   * than in front of a reader.
   */
  const FORBIDDEN = [
    ['expat_changed_title', 'გცვლით', 'reads as "whether we replace YOU"'],
    ['expat_col_gap_body', 'ისინი ჯამს არაფერს მატებს', 'plural subject, singular verb'],
    ['expat_hero_free_note', 'რომელიც გახსოვთ', 'the plan remembers, not the reader'],
    ['expat_plan_invite_title', 'აქცევს ამ ყველაფერს', 'indicative where the title is imperative'],
    ['expat_task_budget_why', 'სანამ აქ ხართ', 'says "while you are here"; means "before"'],
    ['expat_stage_settle_note', 'უკვე დარჩა', 'unfinished without უკან'],
    ['expat_eco_contract_body', 'რას გავალდებულებთ', 'verb agrees with the wrong subject'],
    ['expat_task_temp_housing_why', 'უბანზე, რომელშიც', 'postposition and relative disagree'],
  ];
  const back = FORBIDDEN.filter(([key, bad]) => KA[key]?.includes(bad))
    .map(([key, bad, why]) => `${key}: "${bad}" — ${why}`);
  assert.deepEqual(back, [], `a corrected Georgian string regressed:\n  ${back.join('\n  ')}`);

  /* Orthography: არც ერთი and ვერც ერთი are two words. */
  const joined = EXPAT_KEYS.filter((k) => /არცერთი|ვერცერთი/.test(KA[k]));
  assert.deepEqual(joined, [], `არც ერთი written as one word in: ${joined.join(', ')}`);
});

/* ── Links ───────────────────────────────────────────────────────── */

/**
 * The paths the router serves SPELLED OUT, with the parameterised ones
 * deliberately left out.
 *
 * This is the whole reason the seven dead links survived every gate. Four
 * of them were /for-expats/georgia/move and its siblings, and
 * /for-expats/georgia/:slug matches all four — so a check that resolved
 * literals against patterns declared them live, while the page they
 * actually rendered said "We do not have this page". A `:slug` route
 * serves the values its DATA contains, and a hard-coded link is a promise
 * about one particular value that nobody checked.
 *
 * So the rule is literal-to-literal. A destination built from data is a
 * template string and is skipped by the caller; a destination spelled out
 * in the source has to match a path spelled out in the router.
 */
function literalRoutes() {
  const src = read('src/routes.tsx');
  const paths = [...src.matchAll(/path: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(paths.length > 20, 'route table did not parse');
  return new Set(paths.filter((p) => !p.includes(':') && !p.includes('*')));
}

test('every internal FOR EXPATS link resolves to a route or an anchor on its page', () => {
  const routes = literalRoutes();
  const anchorIds = new Set(
    [...read('src/pages/ForExpatsPage.tsx').matchAll(/id="([a-z0-9-]+)"/g)].map((m) => m[1]),
  );

  const files = [
    ...fs.readdirSync(path.join(ROOT, 'src/components/expats')).map((f) => `src/components/expats/${f}`),
    'src/pages/ForExpatsPage.tsx',
    'src/pages/ExpatTopicPage.tsx',
    'src/pages/ExpatPlanPage.tsx',
  ];

  const dead = [];
  for (const rel of files) {
    const src = read(rel);
    /* Literal destinations only. A template destination built from data —
       `/for-expats/georgia/${topic.slug}` — is covered by the :slug route
       and by the six-topic check in the browser gate. */
    const targets = [
      ...[...src.matchAll(/\bto=["'`]([^"'`${]+)["'`]/g)].map((m) => m[1]),
      ...[...src.matchAll(/\bhref=["'`]([^"'`${]+)["'`]/g)].map((m) => m[1]),
      ...[...src.matchAll(/^\s*[A-Z_]+: '(\/[^']*|#[^']*)',$/gm)].map((m) => m[1]),
    ];
    for (const raw of targets) {
      if (!raw.startsWith('/') && !raw.startsWith('#')) continue;
      if (raw.startsWith('#')) {
        if (!anchorIds.has(raw.slice(1))) dead.push(`${rel}: ${raw} — no element carries that id`);
        continue;
      }
      const [pathOnly] = raw.split('?');
      if (!routes.has(pathOnly)) dead.push(`${rel}: ${raw} — no route is declared with that path`);
    }
  }
  assert.deepEqual(dead, [], `links to nowhere:\n  ${dead.join('\n  ')}`);
});

test('the landing page still offers every pathway and every city', () => {
  /* The fix for seven dead links was to stop them being links. That is only
     correct while the content is still THERE — a later tidy-up that drops
     the cards because "they do not go anywhere" would remove the product's
     orientation, so the hooks are pinned. */
  const hero = read('src/components/expats/ExpatHero.tsx');
  for (const p of ['MOVE', 'LIVE', 'BUY', 'INVEST']) {
    assert.ok(hero.includes(`${p}: '#`), `hero pathway ${p} is not an in-page anchor`);
  }
  const glance = read('src/components/expats/GeorgiaAtAGlance.tsx');
  assert.match(glance, /data-expat-city=\{city\.key\}/, 'the city cards lost their hook');
  assert.match(glance, /city\.blurbKey/, 'the city cards lost their orientation line');
});
