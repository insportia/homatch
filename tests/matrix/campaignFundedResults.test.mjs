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

test('a campaign stamps its results whichever way the search was funded', () => {
  const body = code(CAMPAIGN);
  assert.match(body, /if \(grant\.reservationId \|\| grant\.allowanceId\)/,
    'an allowance-funded search still leaves its results unstamped');
  assert.match(body, /unlock_included_allowance_id: grant\.allowanceId/);
  // And it must not overwrite a stamp that is already there.
  assert.match(body, /\.is\('unlock_included_reservation_id', null\)/);
  assert.match(body, /\.is\('unlock_included_allowance_id', null\)/);
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
  /* The price string and the blur must both be on the not-included branch. */
  const priced = body.indexOf('matches_unlock_btn');
  const blur = body.indexOf('blur-[1.5px]');
  assert.ok(priced > 0 && blur > 0, 'the priced/blurred branch could not be found');
  assert.match(body.slice(Math.max(0, blur - 200), blur), /included \? '' :/,
    'the blur is not conditional on the result being unpaid');
  assert.match(body.slice(Math.max(0, priced - 400), priced), /included \?/,
    'the credit price is not conditional on the result being unpaid');
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
  assert.match(body, /onUnlock/, 'the reveal handler was removed rather than the sale');
  assert.match(body, /matches_unlock_btn/,
    'the priced branch was deleted, so an unfunded match can no longer be sold');
});
