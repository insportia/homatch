// THE ONE SCREEN WHERE MONEY CHANGES HANDS, AND WHAT IT IS ALLOWED TO SEND.
//
// The Matches page blurs a locked preview with CSS. That is a legitimate visual
// treatment and a catastrophic security model, and which one it is depends entirely
// on what the server put in the payload:
//
//   blur over a server-REDACTED excerpt      a visual affordance. Fine.
//   blur over the full signal and contacts   a paywall a customer opens with F12
//
// Verified against production on 2026-09-26 before writing any of this, because the
// question is answerable and guessing it would have been unforgivable:
//
//   74 matches carry a preview_excerpt
//   71 are strictly shorter than the intent_profile.original_text they came from
//    3 equal it exactly -- and those originals are 87, 112 and 116 characters,
//      i.e. already under the 120-character cap, so nothing was withheld that
//      existed. Their statuses are UNLOCKED, REJECTED, REJECTED.
//   the longest original behind a 120-character excerpt is 6,924 characters
//
// So the contract holds, and these tests exist so it keeps holding. They assert the
// REDACTION rather than the blur, because the blur is decoration and the redaction
// is the boundary.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MATCHER = join(root, 'supabase', 'functions', 'run-matching-v2', 'index.ts');
const PAGE = join(root, 'src', 'pages', 'property', 'MatchesPage.tsx');

const matcherSource = readFileSync(MATCHER, 'utf8');
const pageSource = readFileSync(PAGE, 'utf8');

/**
 * redact() lifted out of the matcher and evaluated.
 *
 * Extracted from the real source rather than reimplemented: a copy here would test
 * the copy, and the whole point is to test what production actually runs.
 */
const redact = (() => {
  const start = matcherSource.indexOf('function redact(');
  assert.ok(start > 0, 'guard: run-matching-v2 still has a redact()');
  let depth = 0;
  let i = matcherSource.indexOf('{', start);
  for (; i < matcherSource.length; i += 1) {
    if (matcherSource[i] === '{') depth += 1;
    else if (matcherSource[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const body = matcherSource.slice(start, i + 1);

  /*
   * ONE type annotation is stripped, and the exact text of it is asserted first.
   * new Function() cannot parse TypeScript, and a silent regex strip would let a
   * changed signature quietly evaluate something else -- so if the parameter is
   * ever anything but `text: string`, this fails here rather than passing on a
   * function that is no longer the one production runs.
   */
  assert.match(
    body,
    /^function redact\(text: string\)/,
    'redact()’s signature changed; this lift is no longer evaluating production code',
  );
  const js = body.replace('function redact(text: string)', 'function redact(text)');
  // eslint-disable-next-line no-new-func
  return new Function(`${js}; return redact;`)();
})();

/* ────────────────────────────────────────────────────────────────────────
 * What the customer is actually paying for is removed
 * ──────────────────────────────────────────────────────────────────────── */

test('a phone number never reaches a locked preview', () => {
  // The contact route IS the product. If it ships in the excerpt, the unlock sells
  // something the customer already has.
  for (const text of [
    'Ищу квартиру в Сабуртало, звоните +995 555 123 456',
    'looking for a flat, call 0555123456 please',
    'ვეძებ ბინას, დამიკავშირდით 995555987654',
  ]) {
    const out = redact(text);
    assert.match(out, /\[contact\]/, `no contact placeholder in: ${out}`);
    assert.doesNotMatch(out, /\d{6,}/, `a long digit run survived redaction: ${out}`);
  }
});

test('a profile handle never reaches a locked preview', () => {
  const out = redact('DM me @tbilisi_flats for details');
  assert.match(out, /\[profile\]/);
  assert.doesNotMatch(out, /@tbilisi_flats/);
});

test('a link never reaches a locked preview', () => {
  const out = redact('see https://ss.ge/ka/udzravi-qoneba/12345 for the flat');
  assert.match(out, /\[link\]/);
  assert.doesNotMatch(out, /ss\.ge/);
});

test('all three are stripped from one message, not just the first', () => {
  const out = redact('flat at https://ss.ge/x, write @agent or call +995 555 111 222');
  assert.match(out, /\[link\]/);
  assert.match(out, /\[profile\]/);
  assert.match(out, /\[contact\]/);
});

/* ────────────────────────────────────────────────────────────────────────
 * And the length is capped, so a long signal keeps most of itself back
 * ──────────────────────────────────────────────────────────────────────── */

test('a long signal is truncated and says so', () => {
  // Production holds an original of 6,924 characters behind a 120-character
  // excerpt. Without the cap, the preview would be the product.
  const long = 'Ищу двухкомнатную квартиру в Сабуртало. '.repeat(20);
  const out = redact(long);
  assert.ok(out.length <= 121, `excerpt was ${out.length} characters`);
  assert.match(out, /…$/, 'a truncated excerpt must show that it was truncated');
});

test('a short signal is not padded, mangled, or falsely marked truncated', () => {
  // The three production rows where excerpt === original_text are exactly this
  // case: 87, 112 and 116 characters, already under the cap. Nothing was withheld
  // that existed, and the ellipsis must not claim otherwise.
  const short = 'Students in or coming to Georgia/Tbilisi – Need help finding apartments (TRC-friendly)?';
  // 87, which is what production measured. I wrote 86 from my own eyeballing and
  // the guard caught it -- the string contains an en dash, not a hyphen.
  assert.equal(short.length, 87, 'guard: this is the real production string');
  const out = redact(short);
  assert.equal(out, short, 'a short clean signal passes through unchanged');
  assert.doesNotMatch(out, /…$/, 'nothing was truncated, so nothing may claim it was');
});

test('the cap is 120, and it is a real cap rather than a suggestion', () => {
  const out = redact('x'.repeat(5000));
  assert.equal(out.length, 121, '120 characters plus the ellipsis');
});

/* ────────────────────────────────────────────────────────────────────────
 * The page blurs the redacted excerpt, and nothing else
 * ──────────────────────────────────────────────────────────────────────── */

test('the blur is applied to the preview excerpt, never to the full signal', () => {
  // The distinction between a visual affordance and a paywall opened with F12.
  const blurred = pageSource.indexOf('blur-[1.5px]');
  assert.ok(blurred > 0, 'guard: the locked preview is still blurred');

  // The blurred element's content must be preview_excerpt. Sliced tightly so a
  // later unrelated field cannot satisfy this by accident.
  const region = pageSource.slice(blurred, blurred + 260);
  assert.match(region, /match\.preview_excerpt/, 'the blur must cover the redacted excerpt');
  assert.doesNotMatch(
    region,
    /full_signal_text|original_text|contact/,
    'a blurred full signal is a paywall a customer opens with devtools',
  );
});

test('the full signal is rendered only from an unlock record', () => {
  // full_signal_text arrives from getUnlockedMatch, i.e. after the server accepted
  // payment. It must never be read off the match row that every listing carries.
  assert.match(pageSource, /unlock\.full_signal_text/, 'the full text comes from the unlock');
  assert.doesNotMatch(
    pageSource,
    /match\.full_signal_text/,
    'reading the full signal off the match row would ship it to every visitor',
  );
});

test('an included match is not blurred, because it was already paid for', () => {
  // Blurring a result the customer has already bought charges them a second time in
  // the only currency the interface has left: making them ask for it again.
  // The card was rebuilt around relevance rather than around a lock, and the
  // condition is now the single `forSale` boolean it derives once as
  // `!included && !opened`. Strictly stronger than the `included ? ...` ternary this
  // replaces: that one still blurred nothing for an included match but also still
  // showed a padlock hint on an already-opened one, because an unlocked match is not
  // `included`.
  assert.match(
    pageSource,
    /const forSale = !included && !opened;/,
    'the card no longer derives one answer for whether anything is being sold',
  );
  assert.match(
    pageSource,
    /forSale \? ' blur-\[1\.5px\] select-none' : ''/,
    'the blur must be conditional on something actually being sold',
  );
  assert.match(pageSource, /unlock_included_reservation_id/);
  assert.match(pageSource, /unlock_included_allowance_id/);
});
