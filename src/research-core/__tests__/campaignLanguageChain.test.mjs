// THE CHAIN, END TO END: A CHOICE THAT SURVIVES EVERY HOP.
//
// campaignLanguages.test.mjs proves the resolver is correct in isolation.
// This proves the correct answer actually ARRIVES — that no link between the
// launch screen and the query plan quietly re-decides, widens, or forgets.
//
//   launch screen   → the same resolver the server runs
//   request body    → the CHOICE, never the conclusion
//   edge function   → re-resolves, persists, snapshots onto the job
//   planner         → narrows to the resolved set and never adds
//   evidence        → the language it was WRITTEN in, not searched for
//   resume          → the stored choice, not today's default
//   continuation    → only the languages that are new
//   matching        → not filtered by search language at all
//
// Each hop is a place the requirement could be satisfied on paper and broken
// in practice, so each is asserted against the real modules rather than
// described.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertStripped, stripComments } from '../../../scripts/lib/stripComments.mjs';
import {
  CAMPAIGN_SEARCH_LANGUAGES,
  communicationVerdict,
  estimateLanguagePlan,
  excludedByCommunication,
  languageDelta,
  resolveCampaignLanguages,
} from '../discovery/campaign-languages.ts';
import { planQueries } from '../discovery/query-plan.ts';
import { classifyDirection, satisfiesJob } from '../signals/direction.ts';

const read = (p) => readFileSync(p, 'utf8');
const code = (p) => stripComments(read(p));

const SUBJECT = {
  countryCode: 'GE',
  city: 'Tbilisi',
  district: 'Vake',
  propertyTerms: ['apartment'],
  transaction: 'SALE',
};

/* ── hop 1: the screen and the server run the same function ────────────── */

test('the launch screen resolves with the module the server resolves with', () => {
  /*
   * Not a copy of the rules and not an approximation: a preview that
   * disagrees with what gets billed is worse than no preview. Asserted
   * structurally, because the drift would be invisible at runtime until a
   * customer compared the screen to the receipt.
   */
  const picker = read('src/components/campaign/SearchLanguagePicker.tsx');
  assert.match(picker, /resolveCampaignLanguages/);
  /*
   * Through the seam, not straight into the core. runtimeNeutrality.test.mjs
   * holds the rule and its reasoning; what matters here is that the seam
   * RE-EXPORTS rather than re-implements, so the function the screen runs is
   * byte-for-byte the one the server runs.
   */
  assert.match(picker, /@\/campaign\/searchLanguages/);
  const seam = read('src/campaign/searchLanguages.ts');
  assert.match(seam, /export \{[\s\S]*resolveCampaignLanguages/);
  assert.match(seam, /@\/research-core\/discovery\/campaign-languages/);
  assert.equal(/function resolveCampaignLanguages/.test(seam), false,
    'the seam has grown its own copy of the resolver');

  const server = read('supabase/functions/_shared/campaignLanguages.ts');
  assert.match(server, /resolveCampaignLanguages/);
  assert.match(server, /src\/research-core\/discovery\/campaign-languages\.ts/);
});

/* ── hop 2: the wire carries the choice, not the conclusion ────────────── */

test('the client sends the choice and cannot post a wider resolved set', () => {
  /*
   * THE HOLE THIS CLOSES. If the request carried `resolved: [all six]`, a
   * modified client could widen its own campaign past what its mode allows
   * and the server would bill for it. So the body carries mode + ticks, and
   * the server re-runs the resolver over them.
   */
  const api = code('src/services/api.ts');
  assert.match(api, /searchLanguages/);
  assert.equal(/resolved\s*:/.test(api.split('match-campaign')[1] ?? ''), false,
    'the client posts a resolved language set');

  const shared = code('supabase/functions/_shared/campaignLanguages.ts');
  assert.match(shared, /readChoice/);
  // readChoice only ever reads `mode` and `selected`.
  const reader = shared.slice(shared.indexOf('export function readChoice'));
  assert.equal(/value\.resolved/.test(reader.slice(0, 900)), false);
});

test('an unsupported language on the wire is dropped before it reaches anything', () => {
  const selection = resolveCampaignLanguages({
    mode: 'EXPLICIT', countryCode: 'GE', selected: ['he', 'xx', 'hi', 'RU'],
  });
  assert.deepEqual(selection.languages, ['he', 'ru']);
  assert.ok(selection.warnings.length >= 2);
});

/* ── hop 3: the campaign remembers, and the job snapshots ──────────────── */

test('the campaign stores all four parts of the decision', () => {
  const shared = read('supabase/functions/_shared/campaignLanguages.ts');
  for (const column of [
    'search_language_mode',
    'search_languages_selected',
    'search_languages_resolved',
    'search_language_rationale',
  ]) {
    assert.match(shared, new RegExp(column), `${column} is never written`);
  }
});

test('the job carries its own snapshot, not a pointer to a mutable column', () => {
  /*
   * The campaign's set can change before the next run. A job that read the
   * campaign column would answer with today's configuration about last
   * week's work, and the audit trail would be a lie that updates itself.
   */
  const fn = read('supabase/functions/match-campaign/index.ts');
  assert.match(fn, /search_languages: languages\.selection\.languages/);
  assert.match(fn, /search_language_mode: languages\.selection\.mode/);
});

/* ── hop 4: the planner narrows and never adds ─────────────────────────── */

test('the plan is built only in the resolved languages', () => {
  const plan = planQueries(SUBJECT, 'DEMAND', { languages: ['he', 'ru'], maxQueries: 200 });
  assert.deepEqual([...new Set(plan.queries.map((q) => q.language))].sort(), ['he', 'ru']);
  assert.ok(plan.queries.length > 0, 'a two-language plan produced no queries at all');
});

test('the market default cannot leak back in through the planner', () => {
  /*
   * planQueries defaults to languagesForMarket() when given nothing, and
   * Georgia is six languages. A caller that forgets to pass the campaign's
   * set therefore searches six and bills for six. This asserts the narrowing
   * actually narrows, which is the property the whole chain rests on.
   */
  const wide = planQueries(SUBJECT, 'DEMAND', { maxQueries: 400 });
  const narrow = planQueries(SUBJECT, 'DEMAND', { languages: ['he'], maxQueries: 400 });
  const wideLanguages = new Set(wide.queries.map((q) => q.language));
  assert.ok(wideLanguages.size > 1, 'the default plan was not multilingual to begin with');
  assert.deepEqual([...new Set(narrow.queries.map((q) => q.language))], ['he']);
});

test('the plan is deterministic, so the same choice produces the same work', () => {
  // Otherwise a resume cannot tell "this is new work" from "the plan moved".
  const a = planQueries(SUBJECT, 'DEMAND', { languages: ['he', 'ru'], maxQueries: 60 });
  const b = planQueries(SUBJECT, 'DEMAND', { languages: ['he', 'ru'], maxQueries: 60 });
  assert.deepEqual(a.queries.map((q) => q.id), b.queries.map((q) => q.id));
});

test('each language produces queries in its own words, not a translation', () => {
  /*
   * The requirement, asserted rather than asserted-about: a Russian query
   * must contain Cyrillic and a Hebrew one Hebrew script. A plan whose six
   * languages all read like English would be six copies of one search.
   */
  const scripts = {
    ru: /[Ѐ-ӿ]/,
    he: /[֐-׿]/,
    ar: /[؀-ۿ]/,
    ka: /[Ⴀ-ჿ]/,
  };
  for (const [language, script] of Object.entries(scripts)) {
    const plan = planQueries(SUBJECT, 'DEMAND', { languages: [language], maxQueries: 40 });
    assert.ok(plan.queries.length > 0, `${language} produced no queries`);
    assert.ok(plan.queries.some((q) => script.test(q.text)),
      `${language} queries contain none of its own script`);
  }
});

/* ── hop 5: evidence records what was written, not what was searched ───── */

test('a signal keeps the language it was written in', () => {
  /*
   * A Russian post found by a Hebrew-language campaign is a Russian post.
   * Recording the campaign's search language on the evidence would make every
   * later "which language produced this lead" answer wrong — and that answer
   * is what the AUTO recommender learns from, so the error would compound.
   */
  const verdict = classifyDirection('Ищу квартиру в Тбилиси для инвестиций', { languages: ['he', 'ru'] });
  assert.deepEqual(verdict.languages, ['ru']);

  /*
   * The normalizer IS given the campaign's language set — the classifier has
   * to know which lexicons to consult, and consulting all seven on every post
   * would be slower and no more accurate. What it must never do is write that
   * set onto the evidence.
   *
   * So the assertion is on the assignment, not on the import: `language`
   * comes from detectLanguage (the script the text is in) or from
   * verdict.languages (the vocabularies that actually matched), and both are
   * observations of the text. `context.languages` is the candidate list and
   * appears nowhere in the field.
   */
  const normalize = code('src/research-core/adapters/telegram/normalize.ts');
  const assignment = normalize.slice(
    normalize.indexOf('const language: ResearchLanguage | null'),
  ).split(';')[0];
  assert.match(assignment, /detected\.language/);
  assert.match(assignment, /verdict\.languages\[0\]/);
  assert.equal(/context\.languages/.test(assignment), false,
    'the campaign\'s search language is being written onto the evidence');
});

test('a translation never overwrites the original', () => {
  const types = read('src/research-core/signals/types.ts');
  assert.match(types, /originalText/);
  assert.match(types, /translatedText/);
  // Two fields, so the original survives whatever is written beside it.
  const normalize = read('src/research-core/adapters/telegram/normalize.ts');
  assert.match(normalize, /translatedText: null/);
});

/* ── hop 6: resume keeps the choice ────────────────────────────────────── */

test('a resume with no new choice keeps the stored mode as well as the set', () => {
  /*
   * Keeping the SET but not the MODE is the subtle version of the bug: an
   * EXPLICIT campaign silently becomes AUTO, and the next run picks up two
   * languages the customer never chose.
   */
  const shared = read('supabase/functions/_shared/campaignLanguages.ts');
  const resolveForRun = shared.slice(shared.indexOf('export async function resolveForRun'));
  assert.match(resolveForRun, /stored\.search_language_mode/);
  assert.match(resolveForRun, /options\.choice \?\?/);
});

test('the launch screen reopens on the customer\'s choice, not the recommendation', () => {
  const panel = read('src/components/campaign/CampaignLaunchPanel.tsx');
  assert.match(panel, /getCampaignLanguageState/);
  assert.match(panel, /if \(next\.mode\)/);
});

/* ── hop 7: continuation buys only what is new ─────────────────────────── */

test('HE + EN, then add RU: the run discovers Russian and nothing else', () => {
  // The scenario, verbatim from the requirement.
  const stored = ['he', 'en'];
  const next = resolveCampaignLanguages({ mode: 'EXPLICIT', countryCode: 'GE', selected: ['he', 'en', 'ru'] });
  const delta = languageDelta(stored, next.languages);

  assert.deepEqual(delta.added, ['ru']);
  assert.deepEqual(delta.unchanged.sort(), ['en', 'he']);
  assert.deepEqual(delta.removed, []);
});

test('a plain resume with an unchanged set schedules no discovery at all', () => {
  const next = resolveCampaignLanguages({ mode: 'EXPLICIT', countryCode: 'GE', selected: ['he', 'en'] });
  assert.deepEqual(languageDelta(['he', 'en'], next.languages).added, []);
});

test('a language is only marked bought after discovery actually ran', () => {
  /*
   * The inverse failure, and the more expensive one. Marking a language
   * discovered after a run that reached no source makes the next resume skip
   * it — so the customer paid for a language that was never searched, and
   * nothing will ever search it.
   */
  const fn = read('supabase/functions/match-campaign/index.ts');
  const block = fn.slice(fn.indexOf('markLanguagesDiscovered(db, campaignId'));
  const guard = fn.slice(Math.max(0, fn.indexOf('markLanguagesDiscovered(db, campaignId') - 400));
  assert.match(guard, /externalResult && Number\(externalResult\?\.processed \|\| 0\) > 0/);
  assert.ok(block.length > 0);
});

/* ── hop 8: economics ──────────────────────────────────────────────────── */

test('three languages over shared sources cost less than three separate searches', () => {
  const shared = estimateLanguagePlan([
    { language: 'he', plannedSources: 12, sharedSources: 8, freshSources: 2 },
    { language: 'ru', plannedSources: 12, sharedSources: 8, freshSources: 2 },
    { language: 'en', plannedSources: 12, sharedSources: 10, freshSources: 0 },
  ]);
  assert.equal(shared.naiveScans, 36);
  assert.ok(shared.incrementalScans < 36 * 0.75, 'sharing and freshness bought almost nothing');
  assert.ok(shared.incrementalScans > 0);
});

test('one language is not quoted the same as six', () => {
  // The other half: not multiplying is not the same as not charging.
  const one = estimateLanguagePlan([{ language: 'he', plannedSources: 12, sharedSources: 0, freshSources: 0 }]);
  const six = estimateLanguagePlan(CAMPAIGN_SEARCH_LANGUAGES.map((language) => ({
    language, plannedSources: 12, sharedSources: 4, freshSources: 0,
  })));
  assert.ok(six.incrementalScans > one.incrementalScans * 3,
    'six languages were quoted as barely more than one');
});

test('an unknown cost is never quoted as zero', () => {
  /*
   * The estimator counts SCANS, which it can count. It deliberately does not
   * turn them into money — that is the billing spine's job and it has a
   * price book. A cost function here would be a second answer to a question
   * that already has one, and the day they disagree the customer is quoted
   * one figure and charged the other.
   */
  const source = code('src/research-core/discovery/campaign-languages.ts');
  assert.equal(/costUsd|credits|price/i.test(source), false,
    'the language estimator has started pricing things itself');
});

/* ── hop 9: matching is not filtered by where we looked ────────────────── */

test('a Hebrew-discovered buyer matches a Georgian-language listing', () => {
  /*
   * The distinction the requirement names explicitly. The property does not
   * care what language the buyer reads, and treating "we searched Hebrew
   * sources" as "this buyer requires Hebrew" would throw away most of the
   * point of searching several languages at once.
   */
  const buyer = classifyDirection('מחפש דירה להשקעה בטביליסי', { languages: ['he'] });
  assert.equal(buyer.direction, 'DEMAND');
  assert.equal(satisfiesJob(buyer, 'DEMAND'), true);

  // satisfiesJob takes no language argument at all, which is the structural
  // reason it cannot accidentally become one.
  /*
   * assertStripped, because this is an ABSENCE assertion and those are the
   * dangerous kind. A comment stripper that ate `satisfiesJob` would make
   * indexOf return -1, slice return the empty string, and this pass while
   * proving nothing. direction.ts is the file where the naive stripper lost
   * seven kilobytes.
   */
  const src = assertStripped(
    readFileSync('src/research-core/signals/direction.ts', 'utf8'),
    ['export function satisfiesJob', 'export function classifyDirection'],
  );
  const fn = src.slice(src.indexOf('export function satisfiesJob'));
  assert.ok(fn.length > 100, 'satisfiesJob was not found in the stripped source');
  assert.equal(/language/i.test(fn.slice(0, 500)), false,
    'the job filter has grown a language condition');
});

test('a communication requirement is separate, explicit and usually absent', () => {
  assert.equal(communicationVerdict(null, ['ka']), 'NO_REQUIREMENT');
  assert.equal(communicationVerdict({ required: [] }, ['ka']), 'NO_REQUIREMENT');
  assert.equal(communicationVerdict({ required: ['ru'] }, ['ru', 'en']), 'COMPATIBLE');
  assert.equal(communicationVerdict({ required: ['ru'] }, ['ka']), 'INCOMPATIBLE');
});

test('a person whose language we never read is not silently dropped', () => {
  /*
   * UNKNOWN is not INCOMPATIBLE. "We could not tell what language they write
   * in" is a fact about our reading, not about them, and excluding on it
   * would hide every lead whose post was too short to detect a language from.
   */
  assert.equal(communicationVerdict({ required: ['ru'] }, []), 'UNKNOWN');
  assert.equal(excludedByCommunication('UNKNOWN'), false);
  assert.equal(excludedByCommunication('NO_REQUIREMENT'), false);
  assert.equal(excludedByCommunication('COMPATIBLE'), false);
  assert.equal(excludedByCommunication('INCOMPATIBLE'), true);
});

test('the search-language set is never passed to the communication check', () => {
  // They are different concepts with the same word, and the only protection
  // against merging them is that nothing ever hands one to the other.
  const src = code('src/research-core/discovery/campaign-languages.ts');
  const fn = src.slice(src.indexOf('export function communicationVerdict'));
  assert.equal(/resolveCampaignLanguages|CAMPAIGN_SEARCH_LANGUAGES|marketLanguages/.test(fn), false);
});

/* ── the database agrees with the code ─────────────────────────────────── */

test('the supported set is the same in TypeScript and in Postgres', () => {
  /*
   * Two lists of the same six codes in two languages. The failure this
   * catches is a seventh language added in TypeScript, shipped, and rejected
   * by a CHECK constraint on the row that mattered.
   */
  const sql = read('supabase/migrations/20260925140000_campaign_search_languages.sql');
  const array = sql.match(/select array\[([^\]]+)\]::text\[\]/);
  assert.ok(array, 'the database no longer declares the supported set');
  const declared = [...array[1].matchAll(/'([a-z]{2})'/g)].map((m) => m[1]).sort();
  assert.deepEqual(declared, [...CAMPAIGN_SEARCH_LANGUAGES].sort());
});

test('coverage is stored as counts, with no percentage anywhere', () => {
  const sql = read('supabase/migrations/20260925140000_campaign_search_languages.sql');
  const table = sql.slice(sql.indexOf('create table if not exists public.campaign_language_coverage'));
  const columns = table.slice(0, table.indexOf(');'));
  assert.equal(/percent|ratio|coverage_pct|score/i.test(columns), false,
    'a manufactured coverage figure has appeared in the schema');
  for (const counted of ['attempted', 'reached', 'blocked', 'signals_unique']) {
    assert.match(columns, new RegExp(counted));
  }
});
