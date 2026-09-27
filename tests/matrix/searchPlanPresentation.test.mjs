// THE PLAN IS SOMETHING YOU READ.
//
// Find Property's middle step is the reason the product is not a chat box: the model
// proposes a reading, the customer checks it, and only then does anything run. That is
// only true if the reading is legible. For as long as the step existed it was six stacked
// cards of labelled Selects and Inputs — a filter form, which is the thing this product
// exists to replace, and which asks the customer to supply what the system had already
// worked out.
//
// So the plan states, and the form is one control behind it. These tests hold the
// properties that make the statement trustworthy rather than the arrangement of its
// pixels, because the arrangement is going to keep changing.
//
//   IT SAYS ONLY WHAT IS THERE. A field the planner did not return produces no row. Not
//   "Any city" — that is a claim about the search nobody made.
//
//   IT KEEPS REQUIRED APART FROM PREFERRED. The matcher disqualifies on one and ranks on
//   the other; the plan step exists to show which was heard. UNKNOWN shows nothing,
//   because it is confidence rather than a promise.
//
//   IT SPEAKS THE READER'S LANGUAGE. Including about its own failures: `rejected` is an
//   English sentence written for an operator, and it must not be the only thing a
//   Georgian customer is offered.
//
//   IT DOES NOT BORROW THE GENERIC STACK. Card, Badge and Button resolve against whatever
//   palette a page happens to sit on, and three redesigns died of that.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');

/**
 * Comments out, code in.
 *
 * Half of what this file forbids is explained, at length, in a comment directly above the
 * line that avoids it — "dir="auto", NOT dir="ltr"" is the clearest statement in the
 * component that the row does not force a direction, and a grep for the forbidden thing
 * finds it there first. A source-reading test that matches its own documentation reports
 * the opposite of the truth.
 */
const code = (text) => text
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const primitives = read('src', 'components', 'workspace', 'primitives.tsx');
const page = read('src', 'pages', 'FindPropertyPage.tsx');
const summary = code(read('src', 'components', 'customer', 'SearchPlanSummary.tsx'));
/**
 * The row alone.
 *
 * The language chips below it are two-letter ASCII codes and carry dir="ltr" on purpose:
 * a code is a code in every locale. The VALUE of a row is the thing that must not be
 * forced, because it can be a bare amount or a whole sentence.
 */
const planRow = summary.slice(
  summary.indexOf('export function PlanRow'),
  summary.indexOf('export function SearchPlanSummary'),
);

/** The PLAN branch alone. The RESULTS branch below it is a different screen. */
const listingCard = code(read('src', 'components', 'customer', 'ListingCard.tsx'));
/** The RESULTS branch and the card adapter above it. */
const resultsStage = code(page.slice(
  page.indexOf('{/* ── RESULTS'),
  page.indexOf('</CustomerSurface>'),
));
const resultCard = code(page.slice(
  page.indexOf('function ResultCard'),
  page.indexOf('export default function FindPropertyPage'),
));

const planStage = code(page.slice(
  page.indexOf('{/* ── PLAN'),
  page.indexOf('{/* ── RESULTS'),
));
/** The row builder alone — where a plan becomes lines of a statement. */
const rowBuilder = code(page.slice(
  page.indexOf('const planRows'),
  page.indexOf('const header = useMemo'),
));

test('the plan stage was actually found', () => {
  /* Every test below slices this file. A rename that silently produced two empty strings
     would turn all of them green. */
  assert.ok(planStage.length > 1000, 'the PLAN branch could not be located');
  assert.ok(rowBuilder.length > 800, 'the row builder could not be located');
});

/* ────────────────────────────────────────────────────────────────────────
 * It says only what is there
 * ──────────────────────────────────────────────────────────────────────── */

test('every optional constraint is rendered behind a check that it exists', () => {
  /*
   * A row for a field the planner did not return is an invented search. Each of these is
   * nullable in SearchPlan, so each one has to be asked about before it is stated.
   */
  for (const field of ['city', 'districts', 'propertyTypes', 'budget', 'bedrooms', 'areaSqm']) {
    assert.match(rowBuilder, new RegExp(`if \\(plan\\.${field}`),
      `${field} is rendered without checking that the plan carries it`);
  }
});

test('no row falls back to a word the planner never said', () => {
  /* "Any city", "All types", "No limit" — each of them is a statement about what the
     search will do, made by the interface rather than by the plan. */
  assert.doesNotMatch(rowBuilder, /\b(Any|All|No limit|Unlimited)\b/,
    'the row builder carries a fallback value of its own');
});

/* ────────────────────────────────────────────────────────────────────────
 * Required is not preferred
 * ──────────────────────────────────────────────────────────────────────── */

test('UNKNOWN never becomes a promise on screen', () => {
  /*
   * REQUIRED, PREFERRED and FLEXIBLE are things the customer said. UNKNOWN is what the
   * matcher thinks of its own reading, and rendering it beside the others would turn a
   * confidence into a commitment.
   */
  assert.match(rowBuilder, /'UNKNOWN' \? null/,
    'UNKNOWN is not being suppressed before it reaches a row');
  assert.match(summary, /\{strength \?/,
    'a row with no strength still renders a strength slot');
});

test('the summary tag and the editor question are different words', () => {
  /*
   * plan_strength_* answers "how firmly?" and several of those answers are whole clauses
   * — Georgian "სასურველია" is "it is desirable". Correct in a picker, a sentence
   * fragment trailing off the end of a value. The summary has its own adjectives.
   */
  assert.match(summary, /plan_firmness_\$\{/, 'the summary is not using the tag words');
  assert.doesNotMatch(summary, /plan_strength_/, 'the summary is using the picker words');
  assert.match(page, /plan_strength_\$\{/, 'the picker lost its own words');
});

/* ────────────────────────────────────────────────────────────────────────
 * It speaks the reader's language
 * ──────────────────────────────────────────────────────────────────────── */

test('a discard is translated when it can be and shown either way', () => {
  /*
   * `rejected` is written for whoever reads a log. `rejections` is the same fact as a key
   * and the customer's own word. The interface prefers the key — and still renders the
   * sentence, because a production server that has not been redeployed sends only that,
   * and showing nothing would hide the discard entirely.
   */
  assert.match(planStage, /rejections\.length > 0/,
    'the translated discards are not preferred');
  assert.match(planStage, /: rejected\.slice/,
    'there is no fallback for a server that sends only the English sentence');
});

test('a range is a phrase from a key, never a label glued to a number', () => {
  /*
   * "Up to" is a preposition in English, a suffix in Georgian ("$150,000-მდე") and a
   * two-word phrase in Turkish. `${label} ${amount}` produced "მდე $150,000", which is
   * not a sentence anybody would write.
   */
  assert.match(rowBuilder, /plan_value_upto/, 'the ceiling is not built from a key');
  assert.match(rowBuilder, /plan_value_from/, 'the floor is not built from a key');
  assert.doesNotMatch(rowBuilder, /\$\{t\('plan_field_budget_(min|max)'\)\} \$\{/,
    'a range is still being assembled by concatenation');
});

test('an amount carries its own direction inside a sentence that runs the other way', () => {
  /*
   * FSI … PDI around every amount, and dir="auto" on the row. Forcing the row left to
   * right dragged the Hebrew "עד" to the wrong side of the money and swallowed the space
   * between them; forcing it right to left would break the Georgian suffix.
   */
  /* The isolate lives beside formatMoney, because the results below this screen format
     amounts too and a second copy of the rule is how two screens stop agreeing. */
  assert.match(primitives, /export function isolate/,
    'the isolating formatter is gone');
  assert.match(primitives, /\\u2068\$\{text\}\\u2069/,
    'isolate() no longer isolates');
  assert.match(rowBuilder, /\biso\(/, 'amounts are not being isolated');
  assert.match(planRow, /dir="auto"/, 'the row does not detect its own direction');
  assert.doesNotMatch(planRow, /dir=\{?["']ltr/, 'the row forces a direction');
});

/* ────────────────────────────────────────────────────────────────────────
 * Not the generic stack
 * ──────────────────────────────────────────────────────────────────────── */

test('the summary is built from nothing that resolves against the root palette', () => {
  /*
   * THE ROOT CAUSE OF THREE FAILED REDESIGNS, in one assertion. shadcn's Card, Badge and
   * Button read tokens from wherever they are mounted; on a page that never opted into a
   * scope they are a white rectangle, a grey capsule and a black button, and rearranging
   * their children cannot change that.
   */
  for (const primitive of ['ui/card', 'ui/badge', 'ui/button']) {
    assert.ok(!summary.includes(primitive),
      `the plan summary imports ${primitive}, which resolves against whatever palette it lands on`);
  }
});

test('the plan stage itself renders no generic card or badge', () => {
  assert.doesNotMatch(planStage, /<Card[ >]/, 'the plan stage is back to stacked cards');
  assert.doesNotMatch(planStage, /<Badge[ >]/, 'the plan stage grew a badge');
  assert.doesNotMatch(planStage, /<Button[ >]/, 'the plan stage grew a generic button');
});

test('the summary wears the discovery surface and no other family', () => {
  /* Find Property and Matches are one product family; the owner workspace and the
     customer shell are two others. A component cannot wear two. */
  assert.match(summary, /hm-discovery-panel/, 'the summary is not on the discovery surface');
  for (const other of ['hm-owner', 'hm-customer', 'hm-invest', 'hm-workspace']) {
    assert.ok(!summary.includes(other),
      `the plan summary names ${other}, which belongs to another product family`);
  }
});

/* ─────────────────────────────────────────────────────────────────
 * The results are the same product
 * ───────────────────────────────────────────────────────────────── */

test('a result is not built from the generic stack either', () => {
  /* The plan being rebuilt and the results below it staying as stacked shadcn cards
     would be half a migration, which is what the last three rejections looked like. */
  for (const primitive of ['ui/card', 'ui/badge', 'ui/button']) {
    assert.ok(!listingCard.includes(primitive),
      `the listing card imports ${primitive}`);
  }
  assert.doesNotMatch(resultsStage, /<Card[ >]/, 'the results are back to stacked cards');
  assert.doesNotMatch(resultsStage, /<Badge[ >]/, 'the results grew a badge');
});

test('a price is money and a place is a place name', () => {
  /*
   * WHAT THIS CAUGHT. The price was `${currency}${amount.toLocaleString()}` — a currency
   * CODE glued to a number in the browser's locale rather than the reader's, so a
   * Georgian customer read "USD142000". The city and district were printed raw, in Latin
   * script, on a Georgian page. Both formatters have existed since Matches.
   */
  assert.match(resultCard, /formatMoney\(/, 'the price is not going through the formatter');
  assert.match(resultCard, /placeName\(/, 'places are not going through the name table');
  assert.doesNotMatch(resultCard, /toLocaleString\(/, 'a number is being formatted by hand');
});

test('a listing age is an age, and absent when nobody recorded one', () => {
  /*
   * toLocaleDateString() printed an absolute date, in the browser's locale, for a fact
   * whose whole meaning is how old it is. The scale is the one Matches uses — days, then
   * months, then years — so the same gap reads the same on both screens.
   */
  assert.match(resultCard, /recencyFromDate\(/, 'the age is not on the shared scale');
  assert.doesNotMatch(resultCard, /toLocaleDateString\(/, 'the age is an absolute date again');
  assert.match(resultCard, /age \? t\(/, 'a listing with no recorded date still claims one');
});

test('a discovered broker is never described as a registered one', () => {
  /*
   * THE INVARIANT, HELD AT THE ONE PLACE IT COULD BE BROKEN BY A UI DECISION.
   * Discovered broker ≠ HOMATCH registration ≠ paid directory listing. The card renders
   * the server's own labelKey; a composed English word here would be the product making
   * a claim about a firm it has only read about.
   */
  assert.match(resultCard, /broker\.labelKey/, 'the broker label is not the server key');
  assert.ok(!listingCard.includes('registeredWithHomatch'),
    'the card is making its own judgement about registration');
});
