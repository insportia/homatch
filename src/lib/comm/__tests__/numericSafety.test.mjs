/*
 * ONE MORPHEME, AND A THOUSAND TIMES THE MONEY.
 *
 * Physical test on v110, production session 7d01064e, 2026-09-20 01:53:53Z.
 * The owner said a hundred and twenty THOUSAND. The session stored:
 *
 *   { currency: "USD", budgetMax: 120000000, locations: ["varketili"] }
 *
 * A hundred and twenty MILLION dollars, for a flat in Varketili, written into
 * the session as a fact and used as one.
 *
 * The forensics ruled out every layer but the recogniser. extractDeterministic
 * reads "120 ათასი დოლარი" as 120,000 and "120 მილიონი დოლარი" as 120,000,000,
 * both correctly, and it already outranks the model on digits. The arbitration
 * was never involved: all seven turns of that session reported
 * batch_final_chars 0, selected_source LIVE, selection_reason LIVE_ONLY, so
 * there was only ever one transcript and nothing to arbitrate. Chirp wrote
 * მილიონი where the speaker said ათასი.
 *
 * Chirp is not ours to fix. What is ours is that nothing downstream was
 * looking, so a factor-of-a-thousand slip became an authoritative fact in
 * silence. These tests pin the two places that now look.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  magnitudes, numericConflict, judgeBudget, safeBudget, BUDGET_CEILING, BUDGET_FLOOR,
} from '../numericSafety.ts';
import { extractDeterministic } from '../extraction.ts';
import { chooseTranscript } from '../transcriptChoice.ts';

/* ── The number itself ───────────────────────────────────────────────────*/

test('GEORGIAN_THOUSAND: ათასი is a thousand, in every declension it is spoken in', () => {
  for (const [text, want] of [
    ['120 ათასი დოლარი', 120_000],
    ['120 ათასამდე', 120_000],
    ['ბიუჯეტი მაქვს 120 ათასი დოლარი ვარკეთილში', 120_000],
    ['160k დოლარი', 160_000],
    ['120 thousand dollars', 120_000],
  ]) {
    assert.equal(extractDeterministic(text).budgetMax, want, text);
  }
});

test('GEORGIAN_MILLION: მილიონი is a million, and stays one', () => {
  // The parser was never wrong about this. It is here so that a future
  // "fix" cannot quietly make million mean thousand to dodge the incident.
  assert.equal(magnitudes('120 მილიონი დოლარი')[0].value, 120_000_000);
  assert.equal(magnitudes('1.2 მილიონი')[0].scale, 'million');
  assert.equal(extractDeterministic('2 მილიონი დოლარი').budgetMax, 2_000_000);
});

test('120_THOUSAND_NOT_120_MILLION: the session no longer learns the wrong magnitude', () => {
  /*
   * The exact production value. Refused, NOT corrected: deciding that
   * 120,000,000 "meant" 120,000 is the same guess that caused the incident,
   * made by us instead of the recogniser.
   */
  const bad = extractDeterministic('120 მილიონი დოლარი ვარკეთილში');
  assert.equal(bad.budgetMax, null, '120,000,000 was still written as a budget');
  assert.notEqual(bad.budgetMax, 120_000, 'the number was silently corrected instead of refused');
  // ...while the legitimate sentence is completely untouched.
  assert.equal(extractDeterministic('120 ათასი დოლარი ვარკეთილში').budgetMax, 120_000);
});

test('NUMERIC_MAGNITUDE_REGRESSION: the plausibility band is a band, not an opinion', () => {
  assert.equal(judgeBudget(120_000), 'PLAUSIBLE');
  assert.equal(judgeBudget(2_500_000), 'PLAUSIBLE', 'a real top-end Tbilisi price was refused');
  assert.equal(judgeBudget(120_000_000), 'IMPLAUSIBLY_HIGH');
  assert.equal(judgeBudget(500), 'IMPLAUSIBLY_LOW');
  assert.equal(judgeBudget(null), null);
  assert.equal(judgeBudget(0), null);
  assert.equal(safeBudget(120_000_000).value, null);
  assert.equal(safeBudget(120_000).value, 120_000);
  assert.ok(BUDGET_CEILING > 5_000_000 && BUDGET_FLOOR < 20_000,
    'the band tightened to where it would start refusing real budgets');
});

/* ── Two transcripts of one breath ───────────────────────────────────────*/

test('NUMERIC_MAGNITUDE_CONFLICT_DETECTED: scale disagreement is a conflict', () => {
  const r = numericConflict('120 ათასი დოლარი', '120 მილიონი დოლარი');
  assert.equal(r.conflict, true);
  assert.match(r.reason, /SCALE_DISAGREEMENT/);
});

test('LIVE_BATCH_NUMERIC_CONFLICT: containment must not settle a magnitude', () => {
  /*
   * THE TRAP. The batch string CONTAINS every word of the live one and is
   * materially longer, so the ordinary rule would hand it the turn -- and it
   * means a thousand times more money.
   */
  const live = '120 ათასი';
  const batch = '120 მილიონი დოლარი ვარკეთილში';
  const r = chooseTranscript(live, batch);
  assert.equal(r.source, 'LIVE', 'a magnitude was settled by length');
  assert.equal(r.reason, 'LIVE_KEPT_NUMERIC_CONFLICT');
});

test('an ordinary extension with no number is still allowed to win', () => {
  // The v109 repair must survive: this is the 16-vs-76 case, unchanged.
  const r = chooseTranscript('რამდენი ღირს', 'რამდენი ღირს ბინა ვაკეში და რა არის წინასწარი გადასახადი');
  assert.equal(r.source, 'BATCH');
  assert.equal(r.reason, 'BATCH_EXTENDS_LIVE');
});

test('agreeing numbers are not a conflict, so normal turns stay frictionless', () => {
  assert.equal(numericConflict('120 ათასი დოლარი', '120 ათასი დოლარი ვაკეში').conflict, false);
  // A bare digit difference is recogniser noise, not a magnitude claim.
  assert.equal(numericConflict('120 ათასი', '121 ათასი').conflict, false);
  // And a sentence with no magnitude at all can never conflict.
  assert.equal(numericConflict('რამდენი ღირს', 'რამდენი ღირს ბინა').conflict, false);
  const ok = chooseTranscript('120 ათასი', '120 ათასი დოლარი ვაკეში ორი ოთახით');
  assert.equal(ok.source, 'BATCH', 'an agreeing number blocked a legitimate extension');
});

/* ── The other property facts ────────────────────────────────────────────*/

test('AREA_REGRESSION / ROOM_REGRESSION / FLOOR_REGRESSION: not mangled into budgets', () => {
  /*
   * A decimal area, a room count and a floor are numbers that must NOT be
   * read as money. The band would not catch 97.2 becoming 972, so the point
   * here is narrower and honest: none of them silently becomes a budget.
   */
  for (const text of ['97.2 კვადრატი', 'ორი ოთახი', 'მეშვიდე სართული', '2 ოთახი მეშვიდე სართულზე']) {
    const e = extractDeterministic(text);
    assert.equal(judgeBudget(e.budgetMax) === 'IMPLAUSIBLY_HIGH', false,
      `${text} produced an implausible budget`);
  }
  // A room count in digits is still read as a room count.
  assert.equal(extractDeterministic('2 ოთახი მინდა').bedrooms, 2);
});

test('KNOWN GAP: spelled-out Georgian numerals extract nothing at all', () => {
  /*
   * NOT the reported incident, and not fixed here -- recorded because it was
   * found while proving that one, and because a silent null is the kind of
   * thing that gets rediscovered as a bug in six months.
   *
   * A speaker who says the number in WORDS rather than digits gives this
   * product nothing: "ას ოცი ათასი დოლარი" is a hundred and twenty thousand
   * dollars to any Georgian speaker and null here. That is a miss, which is
   * safe -- the session declines to learn a budget rather than learning a
   * wrong one -- and it is a real gap in recognition coverage.
   *
   * Deliberately left: closing it means a Georgian numeral parser, which is
   * a separate piece of work with its own failure modes, and the brief for
   * this pass was the magnitude that silently changed.
   */
  for (const spelled of ['ას ოცი ათასი დოლარი', 'ერთი მილიონი', 'ორასი ათასი']) {
    assert.equal(extractDeterministic(spelled).budgetMax, null,
      `${spelled} now parses -- update this test, the gap is closed`);
  }
  for (const spelled of ['ორი ოთახი მინდა', 'ორ ოთახიანი', '2-ოთახიანი']) {
    assert.equal(extractDeterministic(spelled).bedrooms, null,
      `${spelled} now parses -- update this test, the gap is closed`);
  }
});

test('PRICE_ENTITY_PRESERVED: a plausible budget still reaches the session', () => {
  const e = extractDeterministic('ბიუჯეტი 180 ათასამდე დოლარი, ვაკეში');
  assert.equal(e.budgetMax, 180_000);
  assert.equal(e.currency, 'USD');
  assert.ok(e.locations.length > 0, 'the location was lost along with the price');
});
