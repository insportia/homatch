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

test('the blur is applied only when something is genuinely for sale', () => {
  /*
   * The excerpt blur used to be an unconditional class on the preview. If it ever
   * becomes unconditional again, a paid-for result goes back behind frosted glass.
   */
  const blurs = [...page.matchAll(/blur-\[1\.5px\]/g)];
  assert.ok(blurs.length > 0, 'the blur is gone entirely — this test is measuring nothing');

  for (const match of blurs) {
    const context = page.slice(Math.max(0, match.index - 400), match.index);
    assert.match(
      context,
      /forSale \?|forSale &&/,
      'a blur is applied without asking whether anything is actually being sold',
    );
  }
});

test('no button offers to sell something for 0.00 CR', () => {
  /*
   * The price is still rendered — for results that genuinely cost credits — so this
   * checks WHERE it is rendered: inside the single branch that only an unpaid,
   * unopened result reaches.
   */
  const price = page.indexOf('unlock_price_credits.toFixed(2)');
  assert.ok(price > 0, 'the price is no longer rendered at all');

  const surrounding = page.slice(Math.max(0, price - 800), price);
  assert.match(
    surrounding,
    /forSale &&/,
    'the credit price is rendered outside the for-sale branch',
  );
});

test('the padlock hint is not shown on a result the customer owns', () => {
  /*
   * The hint under the excerpt had two branches keyed on `included`, so an
   * already-UNLOCKED match -- which is not `included`, because inclusion is
   * explicitly cleared once a match is unlocked -- fell through to the padlock and
   * "unlock to see the rest" under text it had already paid to see.
   */
  const hint = page.indexOf('matches_unlock_hint');
  assert.ok(hint > 0, 'the padlock hint is gone entirely');
  const surrounding = page.slice(Math.max(0, hint - 400), hint);
  assert.match(surrounding, /forSale \?/,
    'the padlock hint does not key off forSale');
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
