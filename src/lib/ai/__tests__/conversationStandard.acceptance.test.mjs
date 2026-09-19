// WHAT THE HOMATCH CONVERSATION IS, AND WHAT IT MAY NOT BECOME.
//
// Three properties that are easy to lose and expensive to lose:
//
//   ONE PERSONALITY. The moment a second surface writes its own tone
//   paragraph, the product has two voices and nobody notices for a
//   year. Every first-party prompt takes the shared block.
//
//   ONE CHIP COMPONENT, ONE VALIDATOR. Two copies of either is two
//   behaviours, and the one nobody looks at is the one that ships the
//   unvalidated model output.
//
//   THE BROWSER NEVER DECIDES MONEY. Tokens, cost and credits are
//   measured and settled on the server; the client is told the result
//   and nothing else.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const CHAT_FN = 'supabase/functions/homatch-ai/index.ts';
const HOOK = 'src/hooks/useAIChat.ts';
/** Every first-party surface that renders a Homatch conversation. */
const SURFACES = [
  'src/pages/AIPage.tsx',
  'src/components/mortgage/ConsultantPanel.tsx',
  'src/components/assistant/AssistantDrawer.tsx',
];

/* ── One personality ────────────────────────────────────────────── */

test('the conversation standard is shared, not written per surface', () => {
  const identity = read('src/lib/ai/identity.ts');
  assert.ok(identity.includes('HOMATCH_CONVERSATION_STYLE'));
  assert.ok(identity.includes('SUGGESTED_REPLIES_INSTRUCTION'));

  const fn = read(CHAT_FN);
  assert.ok(fn.includes('HOMATCH_CONVERSATION_STYLE'), 'the assistant does not use the shared style');
  assert.ok(fn.includes('SUGGESTED_REPLIES_INSTRUCTION'), 'the assistant is never asked for suggestions');

  // A surface that writes its own tone instructions is the failure this
  // guards. Prompts belong in the shared module.
  for (const file of SURFACES) {
    const src = read(file);
    assert.ok(!/You are Homatch AI/i.test(src), `${file} carries its own system prompt`);
    assert.ok(!/system prompt|instructions:/i.test(src), `${file} looks like it is prompting`);
  }
});

test('the assistant no longer refuses an ordinary human aside', () => {
  const fn = read(CHAT_FN);
  const style = read('src/lib/ai/identity.ts');
  // The old rule told it to bounce anything unrelated in two sentences,
  // which is how a swear word about interest rates became a policy event.
  assert.ok(
    /ordinary human aside|not that, and is covered by the style rules/i.test(fn),
    'the scope rule was not narrowed to genuinely large unrelated jobs',
  );
  assert.ok(style.includes('OFF-TOPIC, PROFANITY AND PROVOCATION'));
  assert.ok(/never lecture/i.test(style));
  // And it still knows when to stop being funny.
  assert.ok(/fraud|legal exposure/i.test(style), 'nothing tells it when to become serious');
});

test('brevity is an instruction, not a hope', () => {
  // Usage-based billing makes a padded answer cost the customer money,
  // so the prompt must not leave length to the model's taste.
  const style = read('src/lib/ai/identity.ts');
  assert.ok(/SHORTEST USEFUL ANSWER/i.test(style));
  assert.ok(/Length is never evidence of effort/i.test(style));
});

/* ── One component, one validator ───────────────────────────────── */

test('there is exactly one chip component and one validator', () => {
  assert.ok(exists('src/components/ai/SuggestedReplies.tsx'));
  assert.ok(exists('src/lib/ai/suggestedReplies.ts'));

  for (const file of SURFACES) {
    const src = read(file);
    assert.ok(
      src.includes('SuggestedReplies'),
      `${file} does not offer suggested replies`,
    );
    // Nobody re-implements the chips locally.
    assert.ok(
      !/rounded-full border[^"]*px-4[^"]*text-xs[^"]*suggest/i.test(src),
      `${file} looks like a second chip implementation`,
    );
  }
});

test('model output is validated on the server before it is sent', () => {
  const fn = read(CHAT_FN);
  assert.ok(fn.includes('parseSuggestedReplies'), 'the edge function trusts raw model JSON');
  // The parse must happen before the payload is built, not in the browser.
  assert.ok(
    fn.indexOf('parseSuggestedReplies') < fn.lastIndexOf('return json({'),
    'suggestions are attached without being validated',
  );
});

test('a chip click is a user turn and nothing else', () => {
  const component = read('src/components/ai/SuggestedReplies.tsx');
  // No navigation, no routing, no side effects: onSelect gets text.
  assert.ok(!/useNavigate|navigate\(|window\.location|href=/.test(component));
  assert.ok(component.includes('onSelect'));
  // And it cannot be pressed twice — every response is billable.
  assert.ok(component.includes('setChosen'), 'no double-send guard');
  assert.ok(/min-h-11/.test(component), 'the chips are not a 44px target');
});

/* ── Mortgage keeps its deterministic half ──────────────────────── */

test('the mortgage starters are deterministic and the figures stay engine-owned', () => {
  const panel = read('src/components/mortgage/ConsultantPanel.tsx');
  assert.ok(panel.includes('STARTERS'), 'the opening prompts were deleted rather than converted');
  // Offered only once a scenario exists: "shorten the term" is
  // meaningless before there is a term.
  assert.ok(/brief\s*\?/.test(panel));
  // The brief is still what the model is told, and it is still built
  // from the engines.
  assert.ok(panel.includes('mortgage: brief'));
  const brief = read('src/mortgage/consultantBrief.ts');
  assert.ok(brief.includes('runFullMortgageCalculation'));
  assert.ok(!/Math\.pow\(/.test(brief));
});

/* ── The browser never decides money ────────────────────────────── */

test('billing is server-authoritative end to end', () => {
  const hook = read(HOOK);
  // The client may send an idempotency key and read a result. It may
  // not compute, choose or propose an amount.
  assert.ok(hook.includes('interactionId'), 'no idempotency key is sent');
  /* Converting money is always a multiply or a divide — cents to
     credits, credits to a rate. Reading a number the server sent and
     comparing its type is not arithmetic; scaling it is. */
  const hookCode = hook.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
  assert.ok(
    !/[A-Za-z]*[Cc]redits\s*[*/]|[*/]\s*[A-Za-z]*[Cc]redits/.test(hookCode),
    'the browser is scaling a credit amount',
  );
  assert.ok(!/credits_per_usd|creditsPerUsd/i.test(hookCode), 'the browser knows the denomination');

  const fn = read(CHAT_FN);
  for (const call of ['beginExecution', 'settleExecution', 'releaseExecution']) {
    assert.ok(fn.includes(call), `${call} is not used — billing bypasses the gateway`);
  }
  // Measured, never labelled: the model is never asked how hard it worked.
  assert.ok(fn.includes('billing_ai_cost_cents'), 'cost is not computed from measured tokens');
  assert.ok(!/complexity|simple.*medium.*complex/i.test(fn), 'the model is labelling its own price');
  // No economics in application code.
  assert.ok(!/markup|margin_bps|\* *1\.[0-9]|credits_per_usd *=/.test(fn), 'a price lives in the edge function');
});

test('a failed response is released, never settled', () => {
  const fn = read(CHAT_FN);
  for (const failure of ['PROVIDER_UNREACHABLE', 'PROVIDER_BAD_RESPONSE', 'EMPTY_RESPONSE']) {
    assert.ok(fn.includes(failure), `${failure} does not release the hold`);
  }
  // The hold is taken before the provider is called, so an empty wallet
  // is discovered before the money is spent rather than after.
  assert.ok(
    fn.indexOf('beginExecution') < fn.indexOf('api.openai.com'),
    'the reservation happens after the provider call',
  );
  assert.ok(fn.includes('INSUFFICIENT_CREDITS'));
});

test('anonymous visitors are never billed', () => {
  const fn = read(CHAT_FN);
  // The grant is only ever attempted for a resolved account id.
  assert.ok(/if \(uid && billingEnabled/.test(fn), 'billing is not gated on an account');
  assert.ok(fn.includes('ANON_USER_MESSAGE_LIMIT'), 'the anonymous message cap was removed');
});

test('fair use survived as a rate ceiling rather than a free allowance', () => {
  const fn = read(CHAT_FN);
  assert.ok(fn.includes('ai_fair_use_daily') || fn.includes('RATE_LIMIT_OPERATION'));
  // The comment that said chat is free and never deducts a credit is
  // now false, and a false comment beside live billing code is worse
  // than no comment.
  assert.ok(!/AI Chat is FREE on every plan and never deducts/.test(fn));
  assert.ok(/RATE CEILING, NOT A PRICE/i.test(fn), 'nothing explains what the limit is for now');
});

/* ── Welcome grant ──────────────────────────────────────────────── */

test('the welcome grant goes through the canonical wallet function', () => {
  const migration = read('supabase/migrations/20260919152027_signup_welcome_credits.sql');
  assert.ok(migration.includes('wallet_grant_credits'), 'credits are created outside the wallet');
  assert.ok(!/update\s+public\.credit_accounts\s+set\s+balance/i.test(migration), 'a balance is written directly');
  assert.ok(migration.includes("'PROMOTIONAL'"), 'the lot is not promotional');
  assert.ok(migration.includes("'signup_welcome'"), 'the grant has no provenance');
  // Idempotency comes from the source_ref, which is the account itself.
  assert.ok(migration.includes('p_source_ref => p_user_id::text'));
  // It fires on INSERT only, so nobody who is already registered is
  // retroactively granted.
  assert.ok(/after insert on public\.users/i.test(migration));
  assert.ok(!/update on public\.users/i.test(migration));
  // And it can never fail a registration.
  assert.ok(/exception when others/i.test(migration));
});

test('the amount is configuration, not a constant in code', () => {
  const migration = read('supabase/migrations/20260919152027_signup_welcome_credits.sql');
  assert.ok(migration.includes('signup_welcome_credits'), 'the amount is not an admin setting');
  // 50 appears once, in the settings row, not sprinkled through logic.
  const inLogic = migration.split('billing_grant_signup_welcome')[1] ?? '';
  assert.ok(!/\b50\b/.test(inLogic), 'the grant function hardcodes the amount');
  for (const file of [...SURFACES, HOOK, CHAT_FN]) {
    assert.ok(!/50 credits/i.test(read(file)), `${file} hardcodes the welcome amount`);
  }
});

/* ── The chat price ─────────────────────────────────────────────── */

const PRICING = 'supabase/migrations/20260919161304_ai_chat_measured_pricing.sql';

test('the chat price is a measurement, not a number somebody picked', () => {
  const pricing = read(PRICING);

  // The reference COGS has to be traceable to real production usage, and
  // the sample behind it has to travel with the price. A price whose
  // provenance is a sentence in a pull request is still a guess.
  assert.ok(pricing.includes('cogs_sample'), 'the price carries no measurement behind it');
  for (const field of ['min_landed_cents', 'median_landed_cents', 'max_landed_cents', 'measured_at', 'model']) {
    assert.ok(pricing.includes(field), `the sample does not record ${field}`);
  }

  // The markup is the house multiple, written AS the ratio so it cannot
  // drift away from the other products through a rounding.
  assert.ok(pricing.includes('50.0 / 11.8'), 'the markup is not the existing house multiple');

  /* No CHARGE is fixed anywhere: every one comes out of
     billing_price_quote against the measured cost of the answer that
     ran. min_viable_budget_credits is deliberately not covered by this
     — it is the balance below which the product declines to run at all,
     which is a refusal threshold rather than a price. */
  assert.ok(!/charged_credits\s*=\s*[0-9]/i.test(pricing), 'a charge is hardcoded in the migration');
  assert.ok(!/\bcredits\s*(:?=)\s*[0-9]/i.test(pricing.replace(/min_viable_budget_credits\s*=\s*[0-9.]+/gi, '')),
    'a credit price is hardcoded in the migration');
  assert.ok(!/0\.0[0-9]\s*credit/i.test(read(CHAT_FN)), 'a credit price is hardcoded in the edge function');
});

test('widening the retail column did not disturb the other products', () => {
  const pricing = read(PRICING);
  // A sub-cent retail price cannot live in an integer column — 0.90c
  // would store as 1 and silently raise this product's markup by 15%.
  // The cast is the narrowest fix, and it must touch nobody else's row.
  assert.ok(/alter column standard_retail_cents type numeric/i.test(pricing));
  const updates = pricing.match(/update public\.billable_products/gi) ?? [];
  assert.equal(updates.length, 1, 'more than one product row is being rewritten');
  assert.ok(pricing.includes("where code = 'AI_CHAT_RESPONSE'"), 'the update is not scoped to one product');
});
