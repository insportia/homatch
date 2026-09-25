// WHICH LANGUAGES A CAMPAIGN SEARCHES IN, AND WHO GETS TO DECIDE.
//
// The requirement these tests come from is short and has a sharp edge:
// "Do not silently search arbitrary languages when the customer explicitly
// selected a language set." Everything below is that sentence, plus the four
// places it would otherwise leak — the market default, the AUTO recommender,
// the resume path, and the UI locale.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  CAMPAIGN_SEARCH_LANGUAGES,
  estimateLanguagePlan,
  isCampaignSearchLanguage,
  languageDelta,
  marketLanguages,
  resolveCampaignLanguages,
  summariseCoverage,
} from '../discovery/campaign-languages.ts';
import { RESEARCH_LANGUAGES } from '../discovery/lexicon.ts';

const GE = { countryCode: 'GE' };

/* ── the set on offer ──────────────────────────────────────────────────── */

test('the campaign languages are the six that were asked for', () => {
  assert.deepEqual([...CAMPAIGN_SEARCH_LANGUAGES], ['ka', 'en', 'ru', 'he', 'ar', 'tr']);
});

test('every campaign language is a research language, not a second taxonomy', () => {
  // The failure this prevents: a campaign offering a language the lexicon has
  // no phrases for, which produces a plan with zero queries and a customer
  // charged for a language nothing searched in.
  for (const language of CAMPAIGN_SEARCH_LANGUAGES) {
    assert.ok(RESEARCH_LANGUAGES.includes(language), `${language} has no lexicon`);
  }
});

test('hi is researched but not offered, and that asymmetry is deliberate', () => {
  // There is a real Indian buyer population in Georgia and a job typed in
  // English should reach it — but Homatch renders no Hindi UI and nobody here
  // can review a Hindi lexicon, so it is not a checkbox.
  assert.ok(RESEARCH_LANGUAGES.includes('hi'));
  assert.equal(isCampaignSearchLanguage('hi'), false);
});

/* ── EXPLICIT is a ceiling ─────────────────────────────────────────────── */

test('an explicit selection is exactly what runs', () => {
  const selection = resolveCampaignLanguages({ ...GE, mode: 'EXPLICIT', selected: ['he', 'ru', 'en'] });
  assert.deepEqual(selection.languages, ['he', 'ru', 'en']);
  assert.equal(selection.mode, 'EXPLICIT');
});

test('the market cannot widen an explicit selection', () => {
  /*
   * THE ONE THAT MATTERS. Georgia's market languages are ka, ru, en, tr, ar,
   * he. A customer who chose Hebrew alone must get Hebrew alone — the market
   * default is a default, and a default that overrides a choice is not a
   * default.
   */
  assert.ok(marketLanguages('GE').length > 1);
  const selection = resolveCampaignLanguages({ ...GE, mode: 'EXPLICIT', selected: ['he'] });
  assert.deepEqual(selection.languages, ['he']);
});

test('strong evidence for another language cannot widen an explicit selection', () => {
  // The subtler version: the registry knows Russian produces investors here,
  // and says so in `recommended` — where the customer can see it and act on
  // it — without adding it to what runs.
  const selection = resolveCampaignLanguages({
    ...GE,
    mode: 'EXPLICIT',
    selected: ['he'],
    evidence: [{ language: 'ru', knownSources: 40, usefulSignals: 900 }],
  });
  assert.deepEqual(selection.languages, ['he']);
  assert.ok(selection.recommended.includes('ru'), 'the recommendation is not even shown');
});

test('an unsupported code is dropped and named, never silently swallowed', () => {
  const selection = resolveCampaignLanguages({ ...GE, mode: 'EXPLICIT', selected: ['he', 'zz', 'hi'] });
  assert.deepEqual(selection.languages, ['he']);
  assert.equal(selection.warnings.length, 2);
  assert.match(selection.warnings.join(' '), /zz/);
});

test('duplicates collapse rather than fanning out twice', () => {
  const selection = resolveCampaignLanguages({ ...GE, mode: 'EXPLICIT', selected: ['ru', 'RU', ' ru '] });
  assert.deepEqual(selection.languages, ['ru']);
});

test('an empty explicit set falls back, changes mode, and says so', () => {
  /*
   * A campaign searching nothing is not a campaign, so something has to run —
   * but it is a different set from the one requested, so it must stop calling
   * itself EXPLICIT. Running the recommendation under the customer's label is
   * exactly the silent substitution this module exists to prevent.
   */
  const selection = resolveCampaignLanguages({ ...GE, mode: 'EXPLICIT', selected: ['zz'] });
  assert.equal(selection.mode, 'AUTO');
  assert.ok(selection.languages.length > 0);
  assert.equal(selection.warnings.length, 2);
});

/* ── AUTO is visible and overridable ───────────────────────────────────── */

test('auto recommends from the market and explains each choice', () => {
  const selection = resolveCampaignLanguages({ ...GE, mode: 'AUTO' });
  assert.equal(selection.mode, 'AUTO');
  assert.ok(selection.languages.length > 0);
  assert.equal(selection.rationale.length, selection.languages.length,
    'a language was selected with no reason a customer could read');
  for (const entry of selection.rationale) {
    assert.ok(entry.reason.length > 10, `${entry.language} has no real reason`);
  }
});

test('evidence re-ranks the recommendation rather than filtering it', () => {
  /*
   * A language with no record is not a language known to be useless — every
   * language had no record once. A recommender that only suggests what
   * already worked can never find out that a market has an Arabic-speaking
   * investor population, so evidence decides ORDER inside the market pool.
   */
  const selection = resolveCampaignLanguages({
    ...GE,
    mode: 'AUTO',
    maxAuto: 6,
    evidence: [
      { language: 'he', knownSources: 12, usefulSignals: 140 },
      { language: 'ka', knownSources: 30, usefulSignals: 0 },
    ],
  });
  assert.equal(selection.languages[0], 'he', 'the proven language is not first');
  assert.ok(selection.languages.includes('ar'), 'an unproven language was filtered out');
  assert.ok(
    selection.languages.indexOf('ka') > selection.languages.indexOf('ar'),
    'a language with a record of producing nothing outranks an unproven one',
  );
});

test('auto is capped, so it cannot quietly become ALL', () => {
  const selection = resolveCampaignLanguages({ ...GE, mode: 'AUTO' });
  assert.ok(selection.languages.length <= 3, `auto chose ${selection.languages.length}`);
});

test('ALL means all, and is its own mode rather than a long selection', () => {
  const selection = resolveCampaignLanguages({ ...GE, mode: 'ALL' });
  assert.deepEqual(selection.languages, [...CAMPAIGN_SEARCH_LANGUAGES]);
  assert.equal(selection.mode, 'ALL');
});

test('the recommendation is always available, whatever the mode', () => {
  // So the UI can show "you chose HE; we suggest HE, RU, EN" without a second
  // call, and without that suggestion changing what runs.
  for (const mode of ['EXPLICIT', 'AUTO', 'ALL']) {
    const selection = resolveCampaignLanguages({ ...GE, mode, selected: ['he'] });
    assert.ok(selection.recommended.length > 0, `${mode} exposes no recommendation`);
  }
});

/* ── UI locale is not search language ──────────────────────────────────── */

test('nothing here can see the interface locale', () => {
  /*
   * A customer reading Homatch in Georgian routinely wants a Hebrew and
   * Russian campaign. The coupling would be easy to add and hard to notice,
   * so it is prevented structurally: this module has no locale input, imports
   * no i18n, and a test fails if it grows one.
   */
  const src = readFileSync('src/research-core/discovery/campaign-languages.ts', 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const forbidden of [/LanguageContext/, /useLanguage/, /i18n/, /\blocale\b/i, /uiLanguage/]) {
    assert.equal(forbidden.test(code), false, `discovery language is coupled to the interface: ${forbidden}`);
  }
});

/* ── resume must not bill for work already done ────────────────────────── */

test('adding a language discovers only that language', () => {
  // HE + EN, then the customer adds RU. Resuming must run Russian and nothing
  // else: re-running Hebrew would bill a second time for results already
  // sitting in the campaign, so the customer pays for the edit, not the
  // language.
  const delta = languageDelta(['he', 'en'], ['he', 'en', 'ru']);
  assert.deepEqual(delta.added, ['ru']);
  assert.deepEqual(delta.unchanged, ['he', 'en']);
  assert.deepEqual(delta.removed, []);
});

test('an unchanged language set produces no new work at all', () => {
  const delta = languageDelta(['he', 'ru'], ['ru', 'he']);
  assert.deepEqual(delta.added, []);
  assert.equal(delta.unchanged.length, 2);
});

test('removing a language stops the spending and keeps the evidence', () => {
  /*
   * Narrowing a campaign says "stop spending on this", not "pretend you never
   * found it". Hebrew results from last week are still real facts about the
   * world, so `removed` is reported for the planner to stop scheduling and
   * nothing anywhere deletes what was found.
   */
  const delta = languageDelta(['he', 'en'], ['en']);
  assert.deepEqual(delta.removed, ['he']);
  assert.deepEqual(delta.added, []);
  const src = readFileSync('src/research-core/discovery/campaign-languages.ts', 'utf8');
  assert.equal(/delete|purge|remove.*evidence/i.test(src.split('export function languageDelta')[1] ?? ''), false);
});

/* ── what a language actually costs ────────────────────────────────────── */

test('a shared source is not paid for twice', () => {
  /*
   * A Tbilisi expat group carries Russian and English at once. Quoting six
   * languages at six times one language would overprice the exact
   * configuration Homatch wants customers to choose.
   */
  const estimate = estimateLanguagePlan([
    { language: 'ru', plannedSources: 10, sharedSources: 6, freshSources: 0 },
    { language: 'en', plannedSources: 10, sharedSources: 6, freshSources: 0 },
  ]);
  assert.equal(estimate.naiveScans, 20);
  assert.ok(estimate.incrementalScans < estimate.naiveScans, 'sharing bought nothing');
  assert.equal(estimate.savedScans, 6);
});

test('a second language is cheaper than the first, and never free', () => {
  // Not zero: a second language still costs its own queries and its own
  // extraction pass over the same page, even when the fetch is shared.
  const estimate = estimateLanguagePlan([
    { language: 'he', plannedSources: 8, sharedSources: 8, freshSources: 0 },
  ]);
  assert.ok(estimate.incrementalScans > 0, 'a fully shared language was quoted as free');
  assert.ok(estimate.incrementalScans < 8);
});

test('fresh intelligence removes work rather than discounting it', () => {
  const estimate = estimateLanguagePlan([
    { language: 'ka', plannedSources: 10, sharedSources: 0, freshSources: 10 },
  ]);
  assert.equal(estimate.incrementalScans, 0);
  assert.equal(estimate.perLanguage[0].servedFromFresh, 10);
});

test('the estimate cannot be talked into a negative or an overcount', () => {
  const estimate = estimateLanguagePlan([
    { language: 'ar', plannedSources: 5, sharedSources: 99, freshSources: 99 },
    { language: 'tr', plannedSources: -3, sharedSources: 2, freshSources: Number.NaN },
  ]);
  for (const row of estimate.perLanguage) {
    assert.ok(row.incrementalScans >= 0, `${row.language} costs less than nothing`);
    assert.ok(Number.isFinite(row.incrementalScans));
  }
  assert.ok(estimate.savedScans >= 0);
});

/* ── coverage is a statement, not a percentage ─────────────────────────── */

test('coverage reports what happened and invents no denominator', () => {
  /*
   * "73% source coverage" would be a fraction of the number of relevant
   * sources in the world, which nobody can produce. So coverage is attempted,
   * reached, blocked and found — four counts a query can defend.
   */
  const summary = summariseCoverage([
    { language: 'he', attempted: 12, reached: 9, blocked: 2, signalsFound: 140, uniqueResults: 11 },
    { language: 'ru', attempted: 20, reached: 18, blocked: 1, signalsFound: 310, uniqueResults: 24 },
  ]);
  assert.equal(summary.totals.attempted, 32);
  assert.equal(summary.totals.uniqueResults, 35);
  for (const key of Object.keys(summary.totals)) {
    assert.equal(typeof summary.totals[key], 'number');
    assert.ok(!key.includes('percent') && !key.includes('coverage'));
  }
});

test('a language that reached nothing is surfaced, not averaged away', () => {
  // Twelve Hebrew sources attempted and none reached is the single most
  // important thing on the page, and it disappears into a total.
  const summary = summariseCoverage([
    { language: 'he', attempted: 12, reached: 0, blocked: 12, signalsFound: 0, uniqueResults: 0 },
    { language: 'ru', attempted: 20, reached: 18, blocked: 1, signalsFound: 310, uniqueResults: 24 },
  ]);
  assert.equal(summary.anyLanguageFullyBlocked, true);
});

/* ── nothing else gets to decide ───────────────────────────────────────── */

test('no other module re-derives a campaign language set from the market', () => {
  /*
   * The leak this closes: a worker calling languagesForMarket() directly
   * turns "the customer chose Hebrew" into "we searched six languages and
   * billed for them", and it would look completely reasonable in review.
   * The planner and this module are the only callers; everything else is
   * handed the resolved set.
   */
  const allowed = new Set([
    join('src', 'research-core', 'discovery', 'lexicon.ts'),
    join('src', 'research-core', 'discovery', 'campaign-languages.ts'),
    join('src', 'research-core', 'discovery', 'query-plan.ts'),
    join('src', 'research-core', 'index.ts'),
  ]);

  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '__tests__') continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry) && !allowed.has(path)) {
        if (readFileSync(path, 'utf8').includes('languagesForMarket(')) offenders.push(path);
      }
    }
  };
  walk('src');
  assert.deepEqual(offenders, [],
    'a module outside the planner decides campaign languages for itself');
});
