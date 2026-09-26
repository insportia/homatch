// A DEEPER SEARCH MUST NOT SELL WHAT THE CAMPAIGN ALREADY OWNS.
//
// The pure arithmetic is proven in
// src/research-core/__tests__/searchExpansion.test.mjs. This file guards the
// WIRING, which is where each of those properties can be quietly lost without a
// single assertion there going red:
//
//   1. the exclusion set has to actually reach the sweep
//   2. the idempotency key has to be the derived one, not a fresh uuid
//   3. the receipt has to be written, or the next expansion has nothing to
//      exclude and re-buys everything
//   4. the customer-facing panel must not reach past the narrow shape
//
// Point 2 is the one that would cost real money and look like nothing. Every
// other search in this codebase generates its own key with crypto.randomUUID(),
// so the natural thing to write is the same line again — and then every click of
// Expand Search is a new purchase.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CAMPAIGN = readFileSync('supabase/functions/match-campaign/index.ts', 'utf8');
const SUPPLY = readFileSync('supabase/functions/supply-discovery/index.ts', 'utf8');
const API = readFileSync('src/services/api.ts', 'utf8');
const PANEL = readFileSync('src/components/campaign/DeeperSearchPanel.tsx', 'utf8');
const SEAM = readFileSync('src/campaign/searchExpansion.ts', 'utf8');
const MIGRATION = readFileSync('supabase/migrations/20260926200000_sources_read_receipt.sql', 'utf8');

/** Strip comments, so a rule cannot be satisfied by a sentence describing it. */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the expansion key is DERIVED, never freshly generated', () => {
  /*
   * THE EXPENSIVE MISTAKE. startMatching does
   * `String(body.idempotencyKey || crypto.randomUUID())`, which is right for a
   * new search and catastrophic for an expansion: a random key per click means the
   * prior-job lookup finds nothing, beginExecution holds a second reservation,
   * and the customer pays twice for one button.
   */
  const body = code(CAMPAIGN);

  assert.match(body, /const suppliedKey = expansion\s*\n?\s*\? expansion\.plan\.idempotencyKey/,
    'an expansion does not use the derived key');

  /* And the client must not send one at all, or it could override the derived
     one with something that changes per click. */
  const apiFn = code(API).slice(code(API).indexOf('export async function expandCampaignSearch'));
  const callBody = apiFn.slice(0, apiFn.indexOf('});'));
  assert.equal(/idempotencyKey/.test(callBody), false,
    'the client posts its own idempotency key for an expansion, which can defeat the derived one');
  assert.equal(/randomUUID|Date\.now\(\)/.test(callBody), false,
    'the expansion request carries a clock or a random value, so every click is a new purchase');
});

test('the derived key is reached through the SAME idempotency path as any search', () => {
  // Not a parallel check of its own. The prior-job lookup and beginExecution both
  // key off `idempotencyKey`, and an expansion that bypassed either would be a
  // second billing path.
  const body = code(CAMPAIGN);
  const keyLine = body.indexOf('const idempotencyKey = `${homatchUser.id}:${suppliedKey}`');
  assert.ok(keyLine > 0, 'the shared key derivation was changed or removed');

  const after = body.slice(keyLine);
  assert.match(after, /\.eq\('idempotency_key', idempotencyKey\)/,
    'the expansion does not go through the prior-job lookup');
  assert.match(after, /idempotencyKey: `findclients:\$\{idempotencyKey\}`/,
    'the expansion does not go through the same billing grant');
});

test('the exclusion set reaches the sweep, and only as an expansion', () => {
  const campaign = code(CAMPAIGN);
  assert.match(campaign, /excludeAdapterIds: expansion\.plan\.excludeSourceIds/,
    'the sources already read are never passed to supply-discovery');
  /*
   * Spread, not passed as []. An empty array and "not an expansion" are
   * different requests: the sweep reports `expansion` only when asked, so its
   * absence cannot be mistaken for an expansion that excluded nothing.
   */
  assert.match(campaign, /\.\.\.\(expansion \? \{ excludeAdapterIds/);

  const supply = code(SUPPLY);
  assert.match(supply, /body\.excludeAdapterIds/, 'the sweep ignores the exclusion set');
  assert.match(supply, /withoutAlreadyRead\(/,
    'the sweep filters by hand instead of using the tested function');
});

test('the exclusion runs AFTER the entitlement gate, never instead of it', () => {
  /*
   * An expansion widens what a customer bought. It must not be able to reach a
   * source the entitlement gate refused for a reason of its own — a source can be
   * outside the envelope for reasons that have nothing to do with having been
   * read.
   */
  const supply = code(SUPPLY);
  const gate = supply.indexOf('withinPriorityCeiling(tiered, budget)');
  const exclusion = supply.indexOf('withoutAlreadyRead(');
  assert.ok(gate > 0 && exclusion > 0, 'the gate or the exclusion could not be found');
  assert.ok(gate < exclusion,
    'the exclusion runs before the entitlement gate, so an expansion could widen past the envelope');

  /* And it filters the gate's OUTPUT, not the raw list. */
  assert.match(supply, /withoutAlreadyRead\(gate\.eligible\.map/,
    'the exclusion is applied to something other than the gate result');
});

test('an expansion that excludes everything reads nothing, and says so', () => {
  /*
   * The silent-fallback failure: an exclusion set covering every eligible source
   * leaves an empty permitted map, and a sweep that treated empty as "no
   * entitlement applied, read them all" would charge for the expansion and then
   * re-read what the customer already owns.
   */
  const supply = code(SUPPLY);
  assert.match(supply, /if \(expansion && permitted\.size === 0\)/,
    'an exhausted expansion is not distinguished from an unrestricted sweep');
  const branch = supply.slice(supply.indexOf('if (expansion && permitted.size === 0)'));
  const untilReturn = branch.slice(0, branch.indexOf('});') + 3);
  assert.match(untilReturn, /sourcesPermitted: 0/);
  assert.equal(/createPortalRuntime/.test(untilReturn), false,
    'an exhausted expansion still builds a fetch runtime');
});

test('THE RECEIPT is written, or the next expansion re-buys everything', () => {
  const campaign = code(CAMPAIGN);
  assert.match(campaign, /supply\.data\?\.sourcesRead/,
    'the sweep result is never read for what it actually read');
  assert.match(campaign, /sources_read: sourcesRead/,
    'the receipt is not persisted, so a second expansion has nothing to exclude');

  /*
   * And it is written OUTSIDE the entitlement branch. An ungated sweep reads
   * sources too, and a campaign that started ungated and was later expanded
   * would otherwise re-buy every one of them.
   */
  const headroomAt = campaign.indexOf('discovery_headroom: {');
  const receiptAt = campaign.indexOf('sources_read: sourcesRead');
  assert.ok(headroomAt > 0 && receiptAt > headroomAt);
  const between = campaign.slice(headroomAt, receiptAt);
  assert.match(between, /\}\s*\n?\s*\)\.catch\(\(\) => undefined\);\s*\n?\s*\}/,
    'the receipt appears to be inside the `if (ent?.applied)` branch');

  assert.match(SUPPLY, /sourcesRead: perSourceReport/, 'the sweep does not report what it read');
  assert.match(code(SUPPLY), /row\.outcome === 'OK'/,
    'the receipt counts failed reads as read, so an errored source is never retried');
});

test('a receipt that cannot be written is reported, not swallowed', () => {
  /*
   * THE HOUR THIS COST, on 2026-09-26.
   *
   * `sources_read` shipped in the same commit as the code writing to it.
   * Migrations in this repository run only on a manual workflow_dispatch with
   * `run_migrations` set -- a push never applies one -- so the column did not
   * exist in production, and `.catch(() => undefined)` swallowed every write.
   * Expand Search would have looked like it worked: the first expansion excludes
   * correctly from an empty set, and the second re-buys every source the first
   * one read.
   *
   * The write stays non-fatal, because a bookkeeping row must never fail a search
   * the customer has already paid for. It just stops being invisible.
   */
  const campaign = code(CAMPAIGN);
  assert.match(campaign, /RECEIPT_WRITE_FAILED/,
    'a failed receipt write is silent, so a missing column disables Expand Search economics '
    + 'without anything saying so');
  const branch = campaign.slice(campaign.indexOf('sources_read: sourcesRead'));
  const handler = branch.slice(0, branch.indexOf('});') + 3);
  assert.equal(/catch\(\(\) => undefined\)/.test(handler.split('event(')[0]), false,
    'the receipt write still discards its error before reporting it');
  assert.match(handler, /consequence/,
    'the event does not say what breaks when the receipt is missing');
});

test('the receipt is INTERNAL and the headroom is CUSTOMER-FACING, in two columns', () => {
  /*
   * discovery_headroom's own comment promises the customer's vocabulary: no
   * tiers, no adapter ids, no supplier names. Folding `portal:myhome.ge` into it
   * for the convenience of skipping a migration would put a supplier name one
   * render away from a customer's screen.
   */
  assert.match(MIGRATION, /add column if not exists sources_read text\[\]/);
  assert.match(MIGRATION, /never rendered to a customer/);

  const campaign = code(CAMPAIGN);
  const headroomBlock = campaign.slice(
    campaign.indexOf('discovery_headroom: {'),
    campaign.indexOf('}', campaign.indexOf('moreAvailable')),
  );
  assert.equal(/sources_read|sourcesRead|adapter/.test(headroomBlock), false,
    'an adapter id was written into the customer-facing headroom column');
});

test('the panel cannot reach past the narrow customer shape', () => {
  /*
   * The seam re-exports customerFacingHeadroom and deliberately NOT
   * planExpansion: whether an expansion may be sold, and what it excludes, is
   * decided on the server holding the campaign's real history. A client
   * computing its own answer would be a second opinion about money.
   */
  assert.match(SEAM, /export \{ customerFacingHeadroom \}/);
  assert.equal(/planExpansion|withoutAlreadyRead|expansionIdempotencyKey/.test(code(SEAM)), false,
    'the UI seam exposes server-side expansion logic');

  const panel = code(PANEL);
  assert.match(panel, /customerFacingHeadroom\(headroom\)/);
  /* It must not read the raw record's internal fields directly. */
  for (const field of ['searchDepth', 'resultCeiling']) {
    assert.equal(new RegExp(`headroom\\.${field}`).test(panel), false,
      `the panel reads headroom.${field} directly instead of going through the narrow shape`);
  }
  /* And it must not import the core directly, bypassing the seam. */
  assert.equal(/@\/research-core/.test(PANEL), false,
    'the panel imports research-core directly, so the seam has stopped being a seam');
});

test('"we recorded nothing" and "there is nothing left" are different sentences', () => {
  /*
   * The quiet dishonesty this prevents. A first sweep that crashed writes no
   * headroom; rendering that as "every relevant source has already been
   * searched" tells a customer their search was complete when it barely ran.
   */
  const panel = code(PANEL);
  assert.match(panel, /refusal === 'NOTHING_DEEPER' \? t\('deeper_none_left'\)/);
  assert.match(panel, /refusal === 'NO_HEADROOM_RECORDED' \? t\('deeper_unknown'\)/);

  const en = readFileSync('src/i18n/translations.ts', 'utf8');
  const noneLeft = /deeper_none_left: '([^']+)'/.exec(en)?.[1] ?? '';
  const unknown = /deeper_unknown: '([^']+)'/.exec(en)?.[1] ?? '';
  assert.ok(noneLeft.length > 10 && unknown.length > 10, 'one of the two keys is missing');
  assert.notEqual(noneLeft, unknown, 'the two states share one sentence');
  assert.match(unknown, /not known/i);
});

test('Expand Search is not a subscription upsell', () => {
  /*
   * Phase 1 is pay-as-you-go. A panel that answered "more sources exist" with
   * "upgrade your plan" would rebuild FREE-versus-VIP as the primary discovery
   * product, which is the model this replaced.
   */
  const panel = code(PANEL);
  for (const word of ['VIP', 'PREMIUM', 'upgrade', 'Upgrade', '/pricing', 'subscription', 'plan_code']) {
    assert.equal(panel.includes(word), false, `the deeper-search panel mentions ${word}`);
  }
  /* It reuses the ordinary budget surface rather than inventing a payment UI. */
  assert.match(panel, /<SearchBudgetOffer/,
    'the panel does not reuse the standard budget authorisation');
});

test('the incremental budget is shown BEFORE the request is sent', () => {
  const panel = code(PANEL);
  const confirmAt = panel.indexOf('deeper_confirm_body');
  const offerAt = panel.indexOf('<SearchBudgetOffer');
  const startAt = panel.indexOf('const start =');
  assert.ok(confirmAt > 0 && offerAt > 0, 'the confirmation copy or the budget offer is missing');
  /* The offer's own callback is what fires the request, so authorisation cannot
     happen after the charge. */
  assert.match(panel.slice(offerAt, offerAt + 200), /onRun=\{start\}/);
  assert.ok(startAt > 0);
  assert.match(panel, /t\('deeper_only_new'\)/,
    'the customer is not told that already-searched sources are not re-charged');
});

test('a refusal is rendered as a reason, not as a generic failure', () => {
  /*
   * A 409 here is the server declining to sell something. supabase-js folds a
   * non-2xx into `error` and puts the body out of reach, so without deliberate
   * unwrapping the customer sees "Edge Function returned a non-2xx status code"
   * where they should see "every relevant source has already been searched".
   */
  const api = code(API);
  const fn = api.slice(api.indexOf('export async function expandCampaignSearch'));
  assert.match(fn, /context/, 'the error body is never read, so reasonCode cannot reach the UI');
  assert.match(fn, /reasonCode/);
  assert.match(code(CAMPAIGN), /reasonCode: plan\.refusal/,
    'the server does not return the refusal reason');
});
