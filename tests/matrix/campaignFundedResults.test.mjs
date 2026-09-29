// A RESULT THE CAMPAIGN ALREADY PAID FOR IS NOT FOR SALE.
//
// Under the PAYG campaign model the customer buys a SEARCH. Presenting its
// findings behind a second, per-result purchase charges twice for one thing:
// once in credits, and once in the only currency an interface has left --
// making somebody ask for what they already bought.
//
// THE DEFECT THIS GUARDS, found 2026-09-26.
//
// match-campaign stamped its results as included only `if
// (grant.reservationId)`. Per the ExecutionGrant contract, reservationId is
// present for PAYG runs and an INCLUDED run carries allowanceId with a NULL
// reservationId instead. FIND_CLIENTS on the FREE plan includes one search per
// calendar month, so the first search of every month produced matches with no
// funding stamp at all — and MatchesPage, which tested the reservation column
// alone, blurred them and offered "Unlock · 35.00 CR".
//
// Both halves had to be wrong together for it to be invisible, and both were.
//
// HISTORY IS NOT THE TARGET. match_unlocks, the credit ledger and the legacy
// RPC path all stay: a NULL stamp on an older match still means what it meant,
// and atomic_match_unlock still charges a genuinely unfunded reveal. What is
// forbidden is selling a result whose search was already funded.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CAMPAIGN = readFileSync('supabase/functions/match-campaign/index.ts', 'utf8');
const MATCHES = readFileSync('src/pages/property/MatchesPage.tsx', 'utf8');
const API = readFileSync('src/services/api.ts', 'utf8');

const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('a campaign stamps its results from the reservation that paid for them', () => {
  /* A campaign is PAYG-only now: no plan allowance can fund one, so the
     allowance half of the original defect cannot recur -- and the stamp is
     written from the reservation in the one campaign ending both paths use.
     Older allowance-stamped results keep their stamp and the screen still
     honours either column (next test). */
  assert.match(code(CAMPAIGN), /allowIncluded: false/, 'a plan allowance can fund a campaign again');
  const run = code(readFileSync('supabase/functions/_shared/campaignRun.ts', 'utf8'));
  assert.match(run, /unlock_included_reservation_id: grant\.reservationId/);
  // And it must not overwrite a stamp that is already there.
  assert.match(run, /\.is\('unlock_included_reservation_id', null\)/);
  assert.match(run, /\.is\('unlock_included_allowance_id', null\)/);
});

test('the results screen treats either funding source as paid', () => {
  const body = code(MATCHES);
  assert.match(body, /Boolean\(match\.unlock_included_reservation_id\)/);
  assert.match(body, /Boolean\(match\.unlock_included_allowance_id\)/);
  /*
   * The two must be OR'd. An AND, or a test of one alone, is the original
   * defect — and reads identically at a glance.
   */
  const included = body.slice(body.indexOf('const included ='), body.indexOf('const included =') + 260);
  assert.match(included, /\|\|/, 'the two funding sources are not OR-ed together');
  assert.equal(/&&\s*Boolean\(match\.unlock_included_allowance_id\)/.test(included), false,
    'the funding sources are AND-ed, so a result needs both to count as paid');
});

test('the column reaches the screen at all', () => {
  /*
   * The silent-failure version of this fix: the UI reads a field the query
   * never selected, `undefined` is falsy, and every campaign result goes back
   * to being blurred and priced while the code looks correct.
   */
  assert.match(API, /unlock_included_allowance_id/,
    'the matches query does not select the allowance column the screen reads');
});

test('an included result is never shown a price or a padlock', () => {
  const body = code(MATCHES);
  /*
   * Both the price and the blur must sit behind `forSale`, the single boolean the card
   * derives once as `!included && !opened`.
   *
   * THIS CHECK HAS NOW BEEN REWRITTEN TWICE FOR THE SAME REASON, so it is finally written
   * against the rule instead of the shape. It first asserted on `included ? '' :`, then on
   * text appearing some number of characters before the price — and that second form
   * survived the card being rebuilt from `forSale && <priced/>` into `forSale ? A : B`
   * without noticing, because "forSale appears above the price" is true no matter which
   * branch the price ended up in. B is the branch a customer who has already paid reaches.
   * So: extract the true branch, and look inside it.
   */
  assert.match(body, /const forSale = !included && !opened;/,
    'the card no longer derives one answer for whether anything is being sold');

  /*
   * ONE CONDITIONAL LEFT, because the card no longer sells anything. The blur still keys
   * off the same boolean — it reflects the server-side redaction, which is a real access
   * rule and stays — and the price and the purchase wording are gone from the card
   * entirely rather than confined to a branch.
   */
  assert.match(body, /excerptObscured=\{forSale\}/,
    'the blur is not conditional on something actually being for sale');

  const card = code(readFileSync('src/components/customer/OpportunityCard.tsx', 'utf8'));
  assert.doesNotMatch(card, /unlock_price_credits/, 'a price is back on the card');
  assert.doesNotMatch(card, /matches_unlock_btn/, 'purchase wording is back on the card');
  assert.match(body, /actionLabel=\{t\('match_view_btn'\)\}/,
    'the action is no longer the same on every result');
});

test('the reasons a match exists are shown before anything is bought', () => {
  /*
   * match_reasons has been stored on every match since matching was built, and was
   * rendered in exactly ONE place: inside the dialog reached AFTER unlocking. The
   * explanation of relevance was behind the paywall and what the customer got in its
   * place was a percentage. mismatch_reasons was stored and rendered nowhere at all.
   *
   * Neither is what is being sold -- the contact details are -- so both belong on the
   * card, and this asserts they are on it rather than only in the dialog.
   */
  const body = code(MATCHES);
  /*
   * match_reasons no longer reaches the card as a list. It reaches it as a SENTENCE —
   * matchFacets() collapses the eleven literals onto at most three nouns and whyLineFor()
   * turns them into one line — because a checklist of the matcher's own vocabulary was
   * the thing the customer read first and understood least.
   *
   * What this test has always been about is the boundary, not the widget: the explanation
   * of relevance must be FREE, and only the contact details sold. So it asserts that the
   * reasons are read on the page and handed to the card outside any purchase branch.
   */
  assert.match(body, /matchFacets\(match\.match_reasons\)/,
    'the card does not show why the match is there');
  assert.match(body, /whyLine=\{whyLineFor\(match\)\}/,
    'the fit sentence is not handed to the card');
  assert.doesNotMatch(body, /forSale \?[^;]{0,120}whyLine/,
    'the explanation of relevance has been put behind the purchase');

  /*
   * WHAT THE EXPLANATION LOOKS LIKE CHANGED; WHETHER IT IS FREE DID NOT.
   *
   * It was a checklist in the matcher's own words — "Transaction intent matches",
   * "Country matches", "City matches" — read before the customer reached who the person
   * was, and then a count that said how much agreed without saying what. It is now one
   * sentence naming at most three facets, on the collapsed card, costing nothing. The
   * complete dimension-by-dimension account lives in the detail view, which also costs
   * nothing to open. Only the contact details are sold.
   */
  assert.match(body, /match_why_line/,
    'nothing on the unopened card says what agrees');
});

test('the same person is not matched twice to one property', () => {
  /*
   * THE DUPLICATE THIS PREVENTS, measured in production 2026-09-26.
   *
   * The guard keyed on intent_profile_id, and that id does not survive
   * re-classification: classify-signals-v2 deletes a signal's profile and
   * inserts a fresh row, so the same forum post returned with a new id and
   * the guard matched nothing. forum.ge post 14328580 held two matches on one
   * property -- one already UNLOCKED for 35 credits, one offered for another
   * 20.
   *
   * The signal is the person. A profile is this week's reading of what they
   * said and is allowed to change; a re-read scoring 78 where the first
   * scored 84 is a reason to look at the scorer, not to sell the lead again.
   */
  const matcher = readFileSync('supabase/functions/run-matching-v2/index.ts', 'utf8');
  const body = code(matcher);
  assert.match(body, /\.eq\('signal_id', profile\.signal_id\)/,
    'the duplicate guard does not key on the signal');
  assert.equal(/\.eq\('intent_profile_id', profile\.id\)/.test(body), false,
    'the guard still keys on the profile id, which changes on every re-classification');
  /* Reported separately: already-matched is not a rejection. The person
     qualified, they are simply already in the customer's list. */
  assert.match(body, /alreadyMatched\+\+/);

  /* And the database enforces it too, so a backfill cannot reintroduce it. */
  const migration = readFileSync(
    'supabase/migrations/20260926180000_one_match_per_signal.sql', 'utf8',
  );
  assert.match(migration, /create unique index[\s\S]*matches \(property_id, signal_id\)/);
  assert.match(migration, /where signal_id is not null/);
});

test('historical unlock records and the charging path are left alone', () => {
  /*
   * Removing the sale is not the same as removing the history. A genuinely
   * unfunded match -- one nobody's campaign paid for -- must still be
   * chargeable, or the fix becomes "everything is free".
   */
  const body = code(MATCHES);
  assert.match(body, /handleUnlockClick/, 'the reveal handler was removed rather than the sale');
  /*
   * The sale moved to the confirmation dialog — a card no longer carries a price — but it
   * still EXISTS. Removing it would make the fix "everything is free", which is the other
   * way to get this wrong.
   */
  assert.match(body, /unlockMatch\(/, 'the charging call is gone');
  assert.match(body, /matches_confirm_unlock_btn/,
    'the confirmation that authorises a real purchase was deleted');
  assert.match(body, /balanceAfter/,
    'the customer is no longer told what their balance becomes');
});
