import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stripComments } from '../../../scripts/lib/stripComments.mjs';

/*
 * A RESULT THE CAMPAIGN ALREADY PAID FOR IS NOT FOR SALE.
 *
 * match-campaign stamps unlock_included_reservation_id on every match a paid
 * Find Clients run produced, and both unlock RPCs charge ZERO for a match
 * carrying it. That half has been right since September.
 *
 * The interface did not know. It rendered the excerpt blurred, behind a
 * padlock, under a button reading "Unlock · 0.00 CR" — an offer to sell
 * something at no price, which reads as either a mistake or a trick. The
 * customer had already paid for that result; being asked to unlock it charges
 * them a second time in the only currency the interface has left.
 *
 * WHY THESE ARE STATIC ASSERTIONS
 *
 * The failure this guards against is not a wrong pixel. It is the flag never
 * arriving: drop the column from the select and `included` is undefined for
 * every match, the blur comes back everywhere, and nothing anywhere fails.
 * That is a data-flow fact and it can be read off the source.
 *
 * Comments are stripped with the string-aware stripper rather than a regex.
 * A doc comment here quotes "Unlock · 0.00 CR", and a naive scan would find
 * this file's own explanation and report it as the defect.
 */

const ROOT = process.cwd();
const page = stripComments(
  fs.readFileSync(path.join(ROOT, 'src', 'pages', 'property', 'MatchesPage.tsx'), 'utf8'),
);
const api = stripComments(fs.readFileSync(path.join(ROOT, 'src', 'services', 'api.ts'), 'utf8'));
const types = stripComments(fs.readFileSync(path.join(ROOT, 'src', 'types', 'types.ts'), 'utf8'));

test('the flag is selected, or every match looks unpaid-for', () => {
  /*
   * THE ASSERTION THAT MATTERS MOST. PostgREST returns only the columns
   * asked for, so a match row without this column has it undefined —
   * indistinguishable from "this result was not included". The blur returns
   * for everybody and every other test still passes.
   */
  assert.match(
    api,
    /unlock_included_reservation_id/,
    'the matches query does not select unlock_included_reservation_id',
  );
  assert.match(
    types,
    /unlock_included_reservation_id\??:/,
    'the Match type does not declare unlock_included_reservation_id',
  );
});

test('inclusion is read from the reservation, never from a price of zero', () => {
  /*
   * A zero price can also mean "we have not worked out what this costs" —
   * the ambiguity pricing_state exists to resolve one layer down. Deciding
   * the UI from unlock_price_credits === 0 would make those two render
   * identically, and one of them is a number nobody has verified.
   */
  const decl = page.match(/const included = [^;]+;/);
  assert.ok(decl, 'MatchesPage no longer decides whether a result is included');
  assert.match(decl[0], /unlock_included_reservation_id/);
  assert.doesNotMatch(
    decl[0],
    /unlock_price_credits/,
    'inclusion is being inferred from the price rather than from the reservation',
  );
});

test('one boolean decides whether anything is being sold', () => {
  /*
   * These used to assert on `included ?` appearing near the blur and near the
   * price, which pinned the SHAPE of the old implementation rather than the rule.
   * The card was rebuilt around relevance instead of around a lock, and the rule is
   * now named once:
   *
   *   const forSale = !included && !opened;
   *
   * Strictly stronger than what it replaced, because it also excludes a result the
   * customer has ALREADY opened -- which the old `included ?` branches did not, so
   * an unlocked match still rendered its padlock hint. Asserting the definition and
   * then asserting that blur and price both key off it is what makes the rule
   * un-bypassable: there is one answer per card, not four that can disagree.
   */
  const decl = page.match(/const forSale = [^;]+;/);
  assert.ok(decl, 'MatchesPage no longer names the one boolean that decides this');
  assert.match(decl[0], /!included/, 'forSale does not exclude campaign-funded results');
  assert.match(decl[0], /!opened/, 'forSale does not exclude results already opened');
  assert.doesNotMatch(
    decl[0],
    /unlock_price_credits/,
    'whether something is for sale is being inferred from its price',
  );
});

/* The card is its own component now — src/components/customer/OpportunityCard.tsx — so
   the rendering and the decision live in two files. Both are read. */
const CARD = stripComments(fs.readFileSync(
  path.join(ROOT, 'src', 'components', 'customer', 'OpportunityCard.tsx'), 'utf8'));

test('the blur is applied only when something is genuinely for sale', () => {
  /*
   * The excerpt blur was once an unconditional class on the preview. If it ever becomes
   * unconditional again, a paid-for result goes back behind frosted glass.
   *
   * It now crosses a component boundary: the page decides `forSale` and hands it over as
   * `excerptObscured`, and the card is the only thing that owns the class. So the rule is
   * checked in two halves, which is what it now is.
   */
  const blurs = [...CARD.matchAll(/blur-\[1\.5px\]/g)];
  assert.ok(blurs.length > 0, 'the blur is gone entirely — this test is measuring nothing');
  for (const hit of blurs) {
    const context = CARD.slice(Math.max(0, hit.index - 200), hit.index);
    assert.match(context, /excerptObscured/,
      'a blur is applied without asking whether anything is actually being sold');
  }
  assert.match(page, /excerptObscured=\{forSale\}/,
    'the page no longer passes its one for-sale decision to the card');
});

test('no button offers to sell something for 0.00 CR', () => {
  /*
   * THE SIMPLEST FORM THIS RULE HAS EVER HAD, because the lock model is gone: no result
   * card carries a price at all. Every card offers the same action, and the sale — when
   * there is one — happens in the confirmation dialog, which shows the balance, the price
   * and what the balance becomes.
   *
   * Written twice before against "which branch is the price in", and both times that was
   * satisfiable by the price sitting in the wrong one.
   */
  const card = CARD;
  assert.doesNotMatch(card, /unlock_price_credits/,
    'a price is back on the result card');
  assert.doesNotMatch(card, /\bCR\b/,
    'a credit amount is back on the result card');

  /* And the sale still exists where it belongs. */
  assert.match(page, /unlock_price_credits/,
    'the sale was deleted rather than moved');
  assert.match(page, /matches_confirm_unlock_btn/,
    'the confirmation that authorises a purchase is gone');
});

test('the price and the padlock never reach a result the customer owns', () => {
  /*
   * The old card had a hint line under the excerpt keyed on `included`, so an
   * already-UNLOCKED match — which is not `included`, because inclusion is explicitly
   * cleared once a match is unlocked — fell through to "unlock to see the rest" under
   * text it had already paid to see.
   *
   * The rebuilt card has no hint line at all: a blurred quote sits directly above an
   * action that names its price, which says the same thing without a sentence. So the
   * rule is now checked where it actually lives — one boolean, derived once, gating both
   * the blur and the price.
   */
  assert.match(page, /const forSale = !included && !opened;/,
    'the card no longer derives one answer for whether anything is being sold');
  assert.ok(!page.includes('matches_included_hint'),
    'the owned-result hint is back under an excerpt that is not blurred');

  /*
   * THE SHORT-CIRCUIT, which is the whole rule now.
   *
   * Taking the price off the card routed every result through one handler, and that
   * handler opens the purchase confirmation. An included match would have met a dialog
   * reading "price 0.00 CR — confirm": the second charge, in a new place. It now calls the
   * RPC and opens, without ever offering a sale.
   */
  const at = page.indexOf('const included = Boolean(match.unlock_included_reservation_id)');
  assert.ok(at > 0, 'the included short-circuit is gone from the open handler');
  /* To the end of the branch, not a fixed window: 900 characters ran past the closing
     brace and swallowed the PAYG path, whose confirmation is the correct one. */
  const branch = page.slice(at, page.indexOf('setPendingUnlock(match);', at));
  assert.match(branch, /if \(included\) \{/, 'the short-circuit is not taken');
  assert.match(branch, /unlockMatch\(match\.id\)/, 'an included result no longer opens');
  assert.doesNotMatch(branch, /setShowUnlockConfirm\(true\)/,
    'an included result is still sent to the purchase confirmation');
});

test('credits are never rendered with a currency symbol', () => {
  /*
   * The admin matches table had a column headed "Price (Credits)" whose
   * cells rendered $5.00.
   *
   * Credits are not money. What one buys depends on the customer's plan,
   * which is precisely why wallet balance, campaign budget, actual customer
   * spend and internal COGS are four separate numbers in this system. An
   * admin reading a dollar sign in that column is reading revenue that does
   * not exist.
   */
  const admin = stripComments(
    fs.readFileSync(path.join(ROOT, 'src', 'pages', 'admin', 'AdminMatchesPage.tsx'), 'utf8'),
  );
  /*
   * A dollar sign that is NOT the opening of a template placeholder.
   *
   * The first version of this test matched a bare /\$/ and failed on
   * `${Number(x).toFixed(2)} CR` — flagging the interpolation syntax as a
   * currency symbol. A test that reports the fix as the defect would have
   * driven the next change in the wrong direction.
   */
  const CURRENCY = /\$(?!\{)/;

  const rendered = admin.match(/unlock_price_credits[\s\S]{0,160}/g) ?? [];
  assert.ok(rendered.length > 0, 'the admin table no longer renders a credit price');
  for (const fragment of rendered) {
    assert.doesNotMatch(fragment, CURRENCY, `credits rendered with a currency symbol: ${fragment}`);
  }

  // The same rule on the customer path.
  for (const fragment of page.match(/unlock_price_credits[\s\S]{0,160}/g) ?? []) {
    assert.doesNotMatch(fragment, CURRENCY, `credits rendered as money: ${fragment}`);
  }
});

test('the copy does not call it a free unlock', () => {
  /*
   * "Unlock for free" describes a discount. Nothing was discounted: the
   * customer bought the search, and this is one of the things it bought. The
   * strings say the campaign paid, because that is what happened.
   */
  const strings = fs.readFileSync(
    path.join(ROOT, 'scripts', 'included-unlock-i18n-data.mjs'), 'utf8',
  );
  const english = [...stripComments(strings).matchAll(/^\s*'([^']+)',/gm)].map((m) => m[1]);
  assert.ok(english.length >= 3, 'the copy is gone');
  for (const value of english) {
    assert.doesNotMatch(value, /\bfree\b/i, `"${value}" offers a free unlock rather than a paid-for result`);
    assert.doesNotMatch(value, /0\.00|0 CR/i, `"${value}" quotes a price of zero`);
  }
});

test('an included EXTERNAL result opens without a price screen either', () => {
  /*
   * handleUnlockClick sends every external signal to ExternalContactUnlockModal BEFORE
   * its own included short-circuit, so the short-circuit above never saw them: a
   * campaign-funded external result arrived at "price 0 credits — Confirm". The page now
   * tells the modal the result is included, and the modal requests the reveal straight
   * from the preview without rendering a price. The server still sets the price.
   */
  const modal = stripComments(fs.readFileSync(
    path.join(ROOT, 'src', 'components', 'matching', 'ExternalContactUnlockModal.tsx'), 'utf8'));
  assert.match(page, /included=\{Boolean\(externalUnlockMatch\.unlock_included_reservation_id\)/,
    'the page does not tell the reveal dialog that a result is included');
  assert.match(modal, /\} else if \(included\) \{\s*setPreview\(p\);\s*void reveal\(p\);/,
    'an included external result is still shown a price and a confirm button');
  /* The charge is whatever the server says it was, and a zero is not announced as a charge. */
  assert.match(modal, /toast\.success\(charged > 0/);
});
