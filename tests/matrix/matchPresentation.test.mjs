// WHAT A MATCH CARD IS ALLOWED TO CLAIM.
//
// The customer Match card was rejected for showing the matcher's working instead of the
// opportunity: five coloured strength bars, then "Transaction intent matches", "Country
// matches", "City matches" — in English, on a Georgian page — then "GOOGLE · KA · Score
// 87%", then four unlabelled icon buttons.
//
// src/matching/presentation.ts is the layer that fixes that, and everything in it is a
// CLAIM rather than a formatting choice, which is why it is a pure module with a test
// rather than a handful of ternaries inside the page:
//
//   THE TIER MAPPING. Five recorded strengths become three words, by a fixed rule. A
//   strength we have never seen must land on the most cautious of the three, because
//   calling an unknown grade "strong" is inventing confidence out of ignorance.
//
//   THE COUNTERPART. A rental has no buyers. Naming the wrong side of the market is a
//   small error that makes the whole card read as generated.
//
//   THE AGREEMENT COUNT. run-matching-v2 pushes a HEDGE into `match_reasons` — 'Transaction
//   intent partially known', for a signal that never said whether it wanted to buy or
//   rent — and awards it points. Counting that as agreement would let a card claim four
//   agreements when it has three and one absence.
//
//   THE REASON VOCABULARY. The reasons are matcher literals from a closed set. Every one
//   of them must map to an i18n key, and the set in the module has to stay in step with
//   the set in the edge function — which is the assertion that will fail the day somebody
//   adds a reason to score() and not to REASON_KEYS.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  agreementCount,
  counterpartFor,
  fitTier,
  hasEvidence,
  headlineKey,
  reasonKey,
  recencyParts,
  SIGNAL_STRENGTHS,
} from '../../src/matching/presentation.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');
/* Strip comments before grepping source, so a doc comment describing a forbidden thing
   is not mistaken for the forbidden thing. */
const code = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

/* ────────────────────────────────────────────────────────────────────────
 * Five grades, three words
 * ──────────────────────────────────────────────────────────────────────── */

test('the three strongest grades all read as one word, and GOOD keeps its own', () => {
  assert.equal(fitTier('EXCEPTIONAL'), 'STRONG');
  assert.equal(fitTier('VERY_STRONG'), 'STRONG');
  assert.equal(fitTier('STRONG'), 'STRONG');
  assert.equal(fitTier('GOOD'), 'GOOD');
  assert.equal(fitTier('POTENTIAL'), 'POSSIBLE');
});

test('every strength the matcher can record maps to one of exactly three words', () => {
  const words = new Set(SIGNAL_STRENGTHS.map(fitTier));
  assert.deepEqual([...words].sort(), ['GOOD', 'POSSIBLE', 'STRONG']);
});

test('a grade we have never seen is POSSIBLE, never STRONG', () => {
  /* The honest failure. A strength this module does not know might be anything, and the
     cautious word is the only one that cannot overstate it. */
  for (const unknown of ['MAGNIFICENT', '', '   ', null, undefined, 'strong ']) {
    const tier = fitTier(unknown);
    assert.ok(tier !== 'STRONG' || String(unknown).trim().toUpperCase() === 'STRONG',
      `${String(unknown)} must not be promoted to STRONG`);
  }
  assert.equal(fitTier('MAGNIFICENT'), 'POSSIBLE');
  assert.equal(fitTier(null), 'POSSIBLE');
  assert.equal(fitTier(undefined), 'POSSIBLE');
});

test('case and whitespace in a stored grade do not change the word', () => {
  assert.equal(fitTier('  very_strong  '), 'STRONG');
  assert.equal(fitTier('good'), 'GOOD');
});

/* ────────────────────────────────────────────────────────────────────────
 * Who is on the other side
 * ──────────────────────────────────────────────────────────────────────── */

test('a listing for sale has buyers and a rental has tenants', () => {
  assert.equal(counterpartFor('SALE'), 'BUYER');
  assert.equal(counterpartFor('RENT'), 'TENANT');
  assert.equal(counterpartFor('INVESTMENT'), 'INVESTOR');
});

test('a property with no transaction type names nobody rather than guessing', () => {
  /* A half-finished import is a real state, and guessing which half of the market
     somebody is in is the kind of small wrongness that makes a product read as
     generated. */
  assert.equal(counterpartFor(null), null);
  assert.equal(counterpartFor(undefined), null);
  assert.equal(counterpartFor(''), null);
  assert.equal(counterpartFor('LEASE_TO_OWN'), null);
});

test('the headline is a key, and the unknown case has a key of its own', () => {
  assert.equal(headlineKey('BUYER'), 'match_headline_buyer');
  assert.equal(headlineKey('TENANT'), 'match_headline_tenant');
  assert.equal(headlineKey('INVESTOR'), 'match_headline_investor');
  assert.equal(headlineKey(null), 'match_headline_generic');
  /* Never a sentence: Georgian and Arabic do not put "looking for" where English does,
     so a phrase assembled here would be English word order imposed on six languages. */
  for (const counterpart of ['BUYER', 'TENANT', 'INVESTOR', null]) {
    assert.match(headlineKey(counterpart), /^match_headline_[a-z_]+$/);
  }
});

test('the headline names a possibility, not somebody’s status', () => {
  /*
   * It said "A buyer looking for a 3-bedroom in Tbilisi". The first two words were a claim
   * the product cannot support: what was found is a person who wrote something compatible
   * with this property, sometimes years ago, who has agreed to nothing.
   *
   * The DIRECTION is safe — it comes from the property's transaction type rather than from
   * the person — so the key still varies by counterpart. The identity does not, and the
   * city and room-count variants are gone: those were facts, and they belong in the facts
   * row rather than inside a sentence that also named who somebody was.
   */
  assert.equal(headlineKey('BUYER'), 'match_headline_buyer');
  assert.equal(headlineKey('TENANT'), 'match_headline_tenant');
  assert.equal(headlineKey('INVESTOR'), 'match_headline_investor');
  assert.equal(headlineKey(null), 'match_headline_generic');

  const bundles = read('src', 'i18n', 'translations.ts');
  for (const counterpart of ['BUYER', 'TENANT', 'INVESTOR', null]) {
    const key = headlineKey(counterpart);
    const hits = bundles.match(new RegExp(`^  ${key}:`, 'gm')) ?? [];
    assert.equal(hits.length, 6, `${key} is defined in ${hits.length} bundles, not 6`);
  }
});

test('no locale calls a discovered person a buyer', () => {
  /*
   * THE CLAIM AUDIT, IN ALL SIX. The correction is semantic, not Georgian-only: every
   * bundle has to describe interest rather than assert an identity, and a word-for-word
   * translation of one language's hedge is how the other five end up sounding translated.
   *
   * Checked against the words that assert a completed transaction. "Interested in buying"
   * passes; "buyer" does not.
   */
  const bundles = read('src', 'i18n', 'translations.ts');
  const FORBIDDEN = [
    /^  match_headline_\w+: '[^']*\bbuyers?\b/im,
    /^  match_headline_\w+: '[^']*\btenants?\b/im,
    /^  match_headline_\w+: '[^']*მყიდველ/m,
    /^  match_headline_\w+: '[^']*მოიჯარ/m,
    /^  match_headline_\w+: '[^']*Покупател/m,
  ];
  for (const pattern of FORBIDDEN) {
    assert.ok(!pattern.test(bundles),
      `a headline asserts an identity the evidence does not support: ${pattern}`);
  }
});


/* ────────────────────────────────────────────────────────────────────────
 * The count on the card
 * ──────────────────────────────────────────────────────────────────────── */

test('the hedge does not count as agreement', () => {
  const reasons = [
    'Transaction intent partially known',
    'City matches',
    'Property type matches',
  ];
  /* Three entries, two agreements. The first is an ABSENCE — the signal never said
     whether it wanted to buy or rent — and run-matching-v2 scores it 12 because that
     absence is not evidence against the match. It is not evidence for it either. */
  assert.equal(agreementCount(reasons), 2);
});

test('the hedge is recognised whatever its case, and nothing else is excluded', () => {
  assert.equal(agreementCount(['transaction intent partially known']), 0);
  assert.equal(agreementCount(['  TRANSACTION INTENT PARTIALLY KNOWN  ']), 0);
  assert.equal(agreementCount(['Transaction intent matches']), 1);
});

test('blanks and absent lists count as nothing', () => {
  assert.equal(agreementCount(null), 0);
  assert.equal(agreementCount(undefined), 0);
  assert.equal(agreementCount([]), 0);
  assert.equal(agreementCount(['', '   ']), 0);
});

test('a match with nothing recorded offers no disclosure to open', () => {
  /* A chevron that opens an empty drawer is worse than no chevron, and the earliest
     matches predate reason recording — a real state, not a bug. */
  assert.equal(hasEvidence(null, null), false);
  assert.equal(hasEvidence([], []), false);
  assert.equal(hasEvidence(['City matches'], null), true);
  assert.equal(hasEvidence(null, ['Budget differs']), true);
});

test('a card whose only recorded reason is the hedge offers no drawer, and that is the trade', () => {
  /* agreementCount() refuses to call it agreement; hasEvidence() is a different question
     — "is there anything to show?" — and "they never said whether they want to buy or
     rent" is something a seller should be able to see. */
  assert.equal(hasEvidence(['Transaction intent partially known'], null), false);
  /* ...and when it is the only entry, the count is zero, so the disclosure would be the
     one place it appears. Documented here as the known consequence rather than left to be
     discovered: the drawer opens only when a countable reason or a gap exists. */
});

/* ────────────────────────────────────────────────────────────────────────
 * Every phrase the matcher can write is translatable
 * ──────────────────────────────────────────────────────────────────────── */

test('the reason vocabulary covers exactly what run-matching-v2 writes', () => {
  const engine = code(read('supabase', 'functions', 'run-matching-v2', 'index.ts'));
  const literals = new Set();
  for (const match of engine.matchAll(/(?:reasons|mismatches)\.push\(\s*'([^']+)'\s*\)/g)) {
    literals.add(match[1]);
  }
  /* If this is empty the regex has drifted, not the vocabulary. */
  assert.ok(literals.size >= 15, `expected the closed set, found ${literals.size}`);

  const untranslated = [...literals].filter((phrase) => reasonKey(phrase) === null);
  assert.deepEqual(untranslated, [],
    'these reasons reach the card with no i18n key and would render in English: '
    + untranslated.join(' | '));
});

test('an unrecognised reason returns null so the caller can still show it', () => {
  /* Null rather than a guess. The card then renders the stored phrase — English, but
     present. Dropping it would silently shorten the product's own account of why a match
     exists, which is the one thing the evidence drawer must not do. */
  assert.equal(reasonKey('Sunlight compatible'), null);
  assert.equal(reasonKey(''), null);
  assert.equal(reasonKey(null), null);
});

test('every key the vocabulary returns exists in all six locales', () => {
  const bundles = read('src', 'i18n', 'translations.ts');
  const engine = code(read('supabase', 'functions', 'run-matching-v2', 'index.ts'));
  const keys = new Set();
  for (const match of engine.matchAll(/(?:reasons|mismatches)\.push\(\s*'([^']+)'\s*\)/g)) {
    const key = reasonKey(match[1]);
    if (key) keys.add(key);
  }
  for (const key of keys) {
    const hits = bundles.match(new RegExp(`^  ${key}:`, 'gm')) ?? [];
    assert.equal(hits.length, 6, `${key} is defined in ${hits.length} bundles, not 6`);
  }
});

/* ────────────────────────────────────────────────────────────────────────
 * What the card is no longer allowed to do
 * ──────────────────────────────────────────────────────────────────────── */

test('the match card does not tint its own surface by strength', () => {
  const page = code(read('src', 'pages', 'property', 'MatchesPage.tsx'));
  /* The rejected card carried `bg-yellow-400/10` for EXCEPTIONAL, `bg-blue-400/10` for
     GOOD and so on, and applied it to the whole card. Five grades, five coloured
     surfaces, and a list of opportunities that read as a status board. */
  for (const tint of ['bg-yellow-400/10', 'bg-blue-400/10', 'bg-green-400/10']) {
    assert.ok(!page.includes(tint), `${tint} is back on the match card`);
  }
});

/* The card's own source, so an assertion about the CARD is not satisfied or broken by
   something elsewhere on the page. Both of the checks below failed on their first run
   against legitimate code — the score inside the AI prompt, and the "top up" button in the
   unlock dialog — which is exactly why they are scoped to the component under test. */
function matchCardSource() {
  /*
   * ITS OWN FILE NOW. MatchCard was deleted rather than edited: three redesigns
   * rearranged its children and produced the same screenshot each time, because its
   * appearance came from the primitives it composed — shadcn's Card, Badge and Button,
   * which on the root light palette resolve to a white rectangle, grey capsules and a
   * black filled button.
   */
  return code(read('src', 'components', 'customer', 'OpportunityCard.tsx'));
}

test('the card shows no raw confidence figure at all', () => {
  const card = matchCardSource();
  /*
   * STRICTER THAN BEFORE. The old assertion allowed the score once, inside a disclosure.
   * The collapsed card no longer has a disclosure — every matched dimension, the
   * provenance and the score moved to the detail view — so the right assertion is that
   * the number is not on the card in any form. 87% is a figure nobody can act on
   * differently from 84%.
   */
  assert.doesNotMatch(card, /match_score/, 'a raw score is back on the collapsed card');
  assert.doesNotMatch(card, /match_found_on/, 'the platform is back on the collapsed card');
});

test('the card leads with who this is', () => {
  const card = matchCardSource();
  const headline = card.indexOf('{headline}');
  const facts = card.indexOf('shown.map');
  /* `<SourceQuote`, not `SourceQuote`: the bare name also matches the import at the top
     of the file, which is above everything and would fail this for the wrong reason. */
  const excerpt = card.indexOf('<SourceQuote');
  assert.ok(headline > 0, 'the card has no headline');
  assert.ok(headline < facts, 'the facts row appears before the headline');
  assert.ok(headline < excerpt, 'the source excerpt appears before the headline');
});

test('the card refuses the primitives that produced the rejected look', () => {
  /*
   * THE ROOT CAUSE, AS A GUARD. Card, Badge and Button are written in terms of the root
   * palette's tokens, so on a customer page they resolve to a white rounded rectangle, a
   * grey capsule and a black filled button no matter what is put inside them. Importing
   * any of the three back into this component would reproduce the rejected screenshot
   * whatever else changed.
   */
  const source = read('src', 'components', 'customer', 'OpportunityCard.tsx');
  for (const forbidden of [
    '@/components/ui/card',
    '@/components/ui/badge',
    '@/components/ui/button',
  ]) {
    assert.ok(!source.includes(forbidden), `${forbidden} is back in the opportunity card`);
  }
});

test('the card offers one labelled action and a menu, not a row of bare icons', () => {
  const card = matchCardSource();
  /* Four icon-only buttons, each with its label behind `hidden md:inline`, which meant
     that on every phone this product supports a customer had to press one to find out
     what it did. */
  assert.ok(!card.includes('hidden md:inline'), 'a button label is hidden below md again');
  assert.ok(card.includes('CardAction'), 'the single labelled action is gone');
  assert.ok(card.includes('overflow'), 'the secondary actions have no overflow home');
});

test('the wallet balance is gone from the matches HEADER and kept where it is load-bearing', () => {
  const page = code(read('src', 'pages', 'property', 'MatchesPage.tsx'));
  /*
   * A balance is load-bearing at exactly one moment: when it is about to change. The
   * unlock dialog shows it there, with the price and what the balance becomes, and there
   * is a "top up" route out of it when the answer is negative. All of that stays.
   *
   * What was wrong was a chip in the HEADER of a screen about one property — an
   * account-level number, top right, the first thing the eye landed on. So the assertion
   * is scoped to the header, between the page container and the first deferred panel.
   * Twice this test was written against the whole file and twice it failed on legitimate
   * code; a claim about a region has to be checked against that region.
   */
  /* The header is now <CustomerPageHeader>, which takes an eyebrow, a title and a count
     and has no slot a balance could occupy. The region is checked anyway, because the
     rule is about the region rather than about one component. */
  const from = page.indexOf('<CustomerPageHeader');
  const to = page.indexOf('<FilterRail');
  assert.ok(from !== -1 && to > from, 'the matches header could not be located');
  const header = page.slice(from, to);

  assert.ok(!header.includes('balance'),
    'the credits chip is back in the matches header');
  assert.ok(!header.includes("navigate('/credits')"),
    'the matches header links to the wallet again');
  assert.ok(page.includes('balanceAfter'),
    'the unlock dialog must still tell the customer what their balance becomes');
  assert.ok(page.includes('matches_current_balance'),
    'the unlock dialog must still show the balance it is about to change');
});

test('the header names the people, and the action names what it does', () => {
  const page = code(read('src', 'pages', 'property', 'MatchesPage.tsx'));
  /* "Matches" is the name of a table's worth of rows; "Buyers for your property" is what
     the reader came for. And "Start matching" asks somebody to switch on a mode, where
     "Find buyers" is a thing to do. Both are chosen by the property's transaction type, so
     a rental is never offered buyers. */
  assert.ok(page.includes('matches_title_${slug}'),
    'the heading does not name the counterpart');
  assert.ok(page.includes('matches_find_${slug}'),
    'the primary action does not name the counterpart');
  assert.ok(page.includes("counterpartFor(property?.transaction_type)"),
    'the counterpart is not derived from the property');
});

test('the pulsing campaign banner and the publication CTAs are deferred, not deleted', () => {
  const page = code(read('src', 'pages', 'property', 'MatchesPage.tsx'));
  /* Hidden behind a named flag, with the components still imported and still on disk, so
     bringing them back is one edit rather than an archaeology exercise. */
  assert.ok(page.includes('FEATURES.matchesCampaignOperatorControls && campaignActive'),
    'the campaign status banner is not behind its flag');
  assert.ok(page.includes('FEATURES.matchesOutboundPublication'),
    'the publication CTAs are not behind their flag');
  assert.ok(page.includes('CommunityOutreachPanel') && page.includes('ExternalSitesCard'),
    'a deferred panel was deleted rather than hidden');
  /* Expand Search is a PAYG continuation and was explicitly preserved: finding MORE than
     the campaign covered is a new purchase, which is a different question from re-selling
     a result the campaign already found. */
  assert.ok(page.includes('DeeperSearchPanel'),
    'Expand Search must not be caught up in the deferral');
  assert.ok(page.includes('MatchingJobProgress'),
    'live job progress must not be caught up in the deferral');
});

test('the page is not a phone column on a desktop', () => {
  const page = code(read('src', 'pages', 'property', 'MatchesPage.tsx'));
  assert.ok(!page.includes('max-w-3xl'),
    'the matches page is back to a 768px column inside a 1920px canvas');
  assert.ok(/grid gap-2\.5 md:grid-cols-2/.test(page),
    'the match list does not become columns on a desktop');
});

test('a product page picks its own ground, and the shell is never one of them', () => {
  /*
   * THE BOUNDARY, AS A GUARD, AND IT REPLACES THE OPPOSITE ASSERTION.
   *
   * This used to require that the customer pages all wore one shared premium canvas. That
   * requirement was the defect: `AppLayout surfaceClass` wraps everything a layout renders
   * for a page, so handing it the SHELL's token block made the shell's palette the skin of
   * every product inside it — which is how Matches came out gold.
   *
   * Three scopes now, and no page may inherit another's:
   *
   *   .hm-customer   the application shell and the Dashboard
   *   .hm-discovery  the matching and discovery product
   *   .hm-product    a neutral ground for products that want one
   */
  const SHELL = 'hm-customer';

  for (const [file, expected] of [
    ['src/pages/property/MatchesPage.tsx', 'DISCOVERY_SURFACE'],
    ['src/pages/FindPropertyPage.tsx', 'DISCOVERY_SURFACE'],
  ]) {
    const source = code(read(...file.split('/')));
    assert.match(source, new RegExp(`surfaceClass=\\{${expected}\\}`),
      `${file} is not on its own product surface`);
    assert.ok(!source.includes(SHELL),
      `${file} wears the application shell's token block`);
  }

  /* The shell's block belongs to the shell and to the panel home. */
  const surface = read('src', 'components', 'customer', 'surface.tsx');
  assert.match(surface, /hm-discovery hm-discovery-canvas/,
    'the discovery product has no surface of its own');
  assert.ok(!/export const \w*SURFACE = '[^']*hm-customer/.test(surface),
    'a product surface constant hands out the shell theme');

  /*
   * AND THE PRIMITIVES DO NOT CHOOSE A COLOUR. They read --primary, so the same component
   * is gold on the discovery workspace and ink on a light product ground. A primitive that
   * named gold directly would carry the shell's palette wherever it was used, which is the
   * same leak one layer down.
   */
  for (const file of ['surface.tsx', 'OpportunityCard.tsx', 'SearchComposer.tsx']) {
    const source = code(read('src', 'components', 'customer', file));
    assert.ok(!source.includes('--gold'),
      `${file} names the shell's accent instead of reading --primary`);
  }
});

/* ────────────────────────────────────────────────────────────────────────
 * When the person spoke
 * ──────────────────────────────────────────────────────────────────────── */

test('both generations of formatRecency are understood', () => {
  /* run-matching writes "5 min ago"; run-matching-v2 writes "5m ago". Both are on real
     rows, and the card rendered them in English on a Georgian page — the audit for
     hardcoded strings never saw them, because the English is in a database column. */
  assert.deepEqual(recencyParts('5 min ago'), { key: 'match_recency_minutes', count: 5 });
  assert.deepEqual(recencyParts('5m ago'), { key: 'match_recency_minutes', count: 5 });
  assert.deepEqual(recencyParts('3h ago'), { key: 'match_recency_hours', count: 3 });
  assert.deepEqual(recencyParts('12d ago'), { key: 'match_recency_days', count: 12 });
  assert.deepEqual(recencyParts('  12D AGO '), { key: 'match_recency_days', count: 12 });
});

test('a day count nobody can read becomes months, and then years', () => {
  /*
   * MEASURED ON PRODUCTION, on a real customer's matches, in Georgian: "6309 დღის წინ",
   * on a card asking 35 credits for the contact details. Six thousand three hundred and
   * nine days. Nobody reads that as seventeen years.
   *
   * The number was not wrong — raw_signals.published_at for that row is 2009-06-18, and
   * the matcher's arithmetic is exact. These are genuinely old forum threads rather than
   * broken timestamps, which is why the age is still shown rather than suppressed: it is
   * the most decision-relevant fact about a lead. Only the unit changed.
   */
  assert.deepEqual(recencyParts('6309d ago'), { key: 'match_recency_years', count: 17 });
  assert.deepEqual(recencyParts('4468d ago'), { key: 'match_recency_years', count: 12 });
  assert.deepEqual(recencyParts('888d ago'), { key: 'match_recency_years', count: 2 });
  assert.deepEqual(recencyParts('122d ago'), { key: 'match_recency_months', count: 4 });
  assert.deepEqual(recencyParts('99d ago'), { key: 'match_recency_months', count: 3 });
  /* Below the months threshold a day count is still the most useful unit: "8 days ago"
     says something "0 months ago" does not. */
  assert.deepEqual(recencyParts('59d ago'), { key: 'match_recency_days', count: 59 });
  assert.deepEqual(recencyParts('8d ago'), { key: 'match_recency_days', count: 8 });
  /* No unit ever rounds to zero, which would read as "just now" on a year-old signal. */
  for (const days of [60, 61, 100, 364, 365, 729, 730, 1000, 6309]) {
    const parsed = recencyParts(`${days}d ago`);
    assert.ok(parsed && parsed.count >= 1, `${days}d rounded to ${parsed?.count}`);
  }
});

test('a label neither matcher wrote returns null so the stored text still shows', () => {
  /* An unparsed label is still true. Inventing a duration for it, or hiding when somebody
     spoke, would not be. */
  assert.equal(recencyParts('last week'), null);
  assert.equal(recencyParts('yesterday'), null);
  assert.equal(recencyParts(''), null);
  assert.equal(recencyParts(null), null);
  assert.equal(recencyParts('ago'), null);
});

test('the recency wording exists in all six locales', () => {
  const bundles = read('src', 'i18n', 'translations.ts');
  for (const key of [
    'match_recency_minutes', 'match_recency_hours', 'match_recency_days',
    'match_recency_months', 'match_recency_years',
  ]) {
    const hits = bundles.match(new RegExp(`^  ${key}:`, 'gm')) ?? [];
    assert.equal(hits.length, 6, `${key} is defined in ${hits.length} bundles, not 6`);
  }
});

test('neither matcher writes a recency shape this cannot read', () => {
  /*
   * The guard that fails the day formatRecency grows a fourth shape and the card starts
   * rendering English again. Both edge functions are read, because both are live and they
   * already disagree about minutes.
   *
   * It reads the SUFFIX of each template literal in the function — the part after the
   * interpolated number — and asks whether a label ending that way parses.
   */
  for (const fn of ['run-matching', 'run-matching-v2']) {
    const source = code(read('supabase', 'functions', fn, 'index.ts'));
    const at = source.indexOf('function formatRecency');
    assert.ok(at > 0, `${fn} has no formatRecency to check`);
    const body = source.slice(at, at + 600);
    const suffixes = [...body.matchAll(/\}([^`$]*)`/g)].map((m) => m[1]).filter(Boolean);
    assert.ok(suffixes.length >= 2, `${fn}: found ${suffixes.length} recency shapes`);
    for (const suffix of suffixes) {
      assert.ok(recencyParts(`7${suffix}`) !== null,
        `${fn} writes a recency label this cannot read: "7${suffix}"`);
    }
  }
});
