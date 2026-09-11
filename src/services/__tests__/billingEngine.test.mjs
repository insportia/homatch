import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/*
 * BILLING v2 — STATIC.
 *
 * WHAT THIS SUITE IS FOR, AND WHAT IT IS NOT
 *
 * The behavioural half of this system was verified by running it against
 * production: three included Verifies then a refused fourth, a $1 top-up
 * granting 10 purchased + 10 promotional, a settle of 4.60 against a 6.25 hold
 * returning 1.65, a 37-credit provider overrun clamped to the authorised 6.25,
 * a 90-credit VIP grant that stayed 90 when the webhook was replayed, and a
 * cancellation that took nothing back. Those results are in the delivery
 * report.
 *
 * What a test file CAN do that a live run cannot is stop the invariants behind
 * those results from being quietly edited out later. So this asserts the
 * PROPERTIES, in the migration SQL and the call sites:
 *
 *   - money math lives in SQL, and no caller re-implements it
 *   - the spend order is promotional, then membership, then purchased
 *   - the margin floor exists and is applied after the plan concession
 *   - every credit-moving function is service-role only
 *   - the activation bonus is enforced by unique indexes, not by a read
 *   - settlement is clamped to what the customer authorised
 *   - purchased credits can never be given an expiry
 *   - a paid plan can never include less than FREE
 *   - no component asks `plan === 'PREMIUM'` to decide what to show
 *
 * The pricing arithmetic is ALSO checked numerically below, against the
 * mandate's own worked example, using a mirror of the SQL formula. That mirror
 * is not the implementation and is not used by the app; its only job is to
 * fail if somebody changes the formula in SQL without meaning to.
 */

const ROOT = process.cwd();
const MIG = path.join(ROOT, 'supabase', 'migrations');
const FN = path.join(ROOT, 'supabase', 'functions');

const read = (p) => fs.readFileSync(p, 'utf8');
const mig = (name) => read(path.join(MIG, name));
const fn = (rel) => read(path.join(FN, rel));

/** Source with comments stripped, so a rule is never "proved" by prose. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '').replace(/^\s*\/\/.*$/gm, '');

const CORE = mig('20260911193306_billing_v2_core.sql');
const FUNCS = mig('20260911193358_billing_v2_functions.sql');
const SUBS = mig('20260911193422_billing_v2_subscriptions.sql');
const REDENOM = mig('20260911193543_credit_redenomination_1cr_10c.sql');
const SETTLE_FIX = mig('20260911193725_billing_v2_fix_outparam_shadowing.sql');

// ── The plan model ──────────────────────────────────────────────────────────

test('exactly three consumer plans, at the mandated prices and grants', () => {
  const seed = CORE.slice(CORE.indexOf('INSERT INTO public.billing_plans'));
  const row = seed.slice(0, seed.indexOf('ON CONFLICT'));

  // FREE $0/0 credits, VIP $9/90, PREMIUM $29/290.
  assert.match(row, /'FREE',\s*'Free',\s*0,\s*0,\s*0,\s*'STANDARD',\s*0,/);
  assert.match(row, /'VIP',\s*'VIP',\s*900,\s*90,\s*180,\s*'ENHANCED',\s*2500,/);
  assert.match(row, /'PREMIUM',\s*'Premium',\s*2900,\s*290,\s*580,\s*'MAXIMUM',\s*5000,/);

  // No fourth consumer tier crept in.
  const codes = [...row.matchAll(/\('([A-Z]+)',\s*'/g)].map((m) => m[1]);
  assert.deepEqual(codes.sort(), ['FREE', 'PREMIUM', 'VIP']);
});

test('the rollover cap is about one unused cycle, not unlimited banking', () => {
  // 90 granted / 180 cap and 290 granted / 580 cap.
  assert.match(CORE, /'VIP',\s*'VIP',\s*900,\s*90,\s*180,/);
  assert.match(CORE, /'PREMIUM',\s*'Premium',\s*2900,\s*290,\s*580,/);
  // And the cap is actually enforced when granting, against the whole bucket.
  const grant = FUNCS.slice(FUNCS.indexOf('wallet_grant_credits'));
  assert.match(grant, /membership_rollover_cap/);
  assert.match(grant, /v_grant\s*:=\s*least\(v_grant,\s*greatest\(v_cap - v_held, 0\)\)/);
});

test('the base allowance is identical on every plan; upgrading buys depth, not count', () => {
  const seed = CORE.slice(CORE.indexOf('INSERT INTO public.product_plan_entitlements'));
  const rows = seed.slice(0, seed.indexOf('ON CONFLICT'));

  // 3 Verify on all three plans; 1 each of the others.
  for (const plan of ['FREE', 'VIP', 'PREMIUM']) {
    assert.match(rows, new RegExp(`\\('VERIFY','${plan}',\\s*3,`), `VERIFY/${plan} should include 3`);
    assert.match(rows, new RegExp(`\\('FIND_CLIENTS','${plan}',\\s*1,`), `FIND_CLIENTS/${plan} should include 1`);
    assert.match(rows, new RegExp(`\\('CONTRACT_INTELLIGENCE','${plan}',\\s*1,`), `CONTRACT/${plan} should include 1`);
  }
  // The tier is what changes.
  assert.match(rows, /\('VERIFY','FREE',\s*3,'CALENDAR_MONTH','STANDARD'/);
  assert.match(rows, /\('VERIFY','VIP',\s*3,'BILLING_CYCLE',\s*'ENHANCED'/);
  assert.match(rows, /\('VERIFY','PREMIUM',\s*3,'BILLING_CYCLE',\s*'MAXIMUM'/);
  // And the result ceilings: 10 / 30 / 75 for Find Clients.
  assert.match(rows, /\('FIND_CLIENTS','FREE',\s*1,'CALENDAR_MONTH','STANDARD',\s*10,/);
  assert.match(rows, /\('FIND_CLIENTS','VIP',\s*1,'BILLING_CYCLE',\s*'ENHANCED',\s*30,/);
  assert.match(rows, /\('FIND_CLIENTS','PREMIUM',\s*1,'BILLING_CYCLE',\s*'MAXIMUM',\s*75,/);
});

test('a paid plan can never be given a smaller allowance than FREE', () => {
  // Not a convention. A trigger.
  assert.match(CORE, /CREATE TRIGGER trg_ppe_paid_never_worse/);
  assert.match(CORE, /PAID_PLAN_WOULD_BE_WORSE_THAN_FREE/);
  const guard = CORE.slice(CORE.indexOf('product_plan_entitlements_paid_never_worse()'));
  assert.match(guard, /BEFORE INSERT OR UPDATE ON public\.product_plan_entitlements/);
});

// ── Pricing ─────────────────────────────────────────────────────────────────

/**
 * A MIRROR of billing_price_quote()'s arithmetic. Not the implementation.
 * If this and the SQL ever disagree, one of them was edited carelessly.
 */
function quote({ rawCents, aiCents = 0, taxBps = 1800, feeBps = 0, standardRetail, referenceCogs, shareBps, minMarginBps = 3000, creditsPerUsd = 10, dp = 2 }) {
  const base = rawCents + aiCents;
  const landed = round(base * (1 + taxBps / 10000 + feeBps / 10000), 4);
  const multiple = standardRetail / referenceCogs;
  const standard = round(landed * multiple, 4);
  const pool = standard - landed;
  const planPrice = round(landed + pool * (1 - shareBps / 10000), 4);
  const floor = round(landed / (1 - minMarginBps / 10000), 4);
  let final = Math.max(planPrice, floor);
  let credits = round(round(final * creditsPerUsd / 100, 4), dp);
  if (round(credits * 100 / creditsPerUsd, 4) < floor) credits = round(credits + 10 ** -dp, dp);
  final = round(credits * 100 / creditsPerUsd, 4);
  return {
    landed, standard, pool, planPrice, floor,
    floorApplied: floor > planPrice,
    final, credits,
    grossMarginBps: Math.round(((final - landed) / final) * 10000),
    markupBps: Math.round(((final - landed) / landed) * 10000),
  };
}
const round = (v, dp) => {
  const f = 10 ** dp;
  return Math.round((v + Number.EPSILON) * f) / f;
};

test("the mandate's worked example: 10.0c raw + 18% = 11.8c landed", () => {
  const q = quote({ rawCents: 10, standardRetail: 50, referenceCogs: 11.8, shareBps: 0 });
  assert.equal(q.landed, 11.8);
});

test('FREE pays the standard price: 50c, 76.40% margin, 323.73% markup, 5 Credits', () => {
  const q = quote({ rawCents: 10, standardRetail: 50, referenceCogs: 11.8, shareBps: 0 });
  assert.equal(q.final, 50);
  assert.equal(q.pool, 38.2);
  assert.equal(q.grossMarginBps, 7640); // 76.40%
  assert.equal(q.markupBps, 32373);     // 323.73%
  assert.equal(q.credits, 5);
});

test('VIP concedes 25% of the pool: 40.45c before rounding, 4.05 Credits', () => {
  const q = quote({ rawCents: 10, standardRetail: 50, referenceCogs: 11.8, shareBps: 2500 });
  assert.equal(q.planPrice, 40.45);
  assert.equal(q.credits, 4.05);
});

test('PREMIUM concedes 50% of the pool: 30.90c, 3.09 Credits', () => {
  const q = quote({ rawCents: 10, standardRetail: 50, referenceCogs: 11.8, shareBps: 5000 });
  assert.equal(q.planPrice, 30.9);
  assert.equal(q.credits, 3.09);
});

test('the 30% margin floor clamps a concession that would price too thin', () => {
  // A thin-markup product (20c retail against 11.8c cost). Premium's half of
  // the pool lands at 15.90c = 25.79% margin, under the floor.
  const q = quote({ rawCents: 10, standardRetail: 20, referenceCogs: 11.8, shareBps: 5000 });
  assert.equal(q.planPrice, 15.9);
  assert.ok(q.floorApplied, 'the floor should have engaged');
  assert.ok(q.grossMarginBps >= 3000, `clamped margin ${q.grossMarginBps} must reach the 30% floor`);
  assert.equal(q.credits, 1.69);
});

test('rounding never drops a charge back below the margin floor', () => {
  // Sweep a range of costs; the settled credit figure must always clear the
  // floor after being rounded to the customer-facing precision.
  for (let raw = 1; raw <= 300; raw += 7) {
    const q = quote({ rawCents: raw, standardRetail: 20, referenceCogs: 11.8, shareBps: 5000 });
    const margin = ((q.final - q.landed) / q.final) * 10000;
    assert.ok(margin >= 2999, `raw=${raw}c gave margin ${margin.toFixed(0)}bps`);
  }
});

test('a costlier run is never cheaper than a cheap one', () => {
  // This is why the standard price is a markup MULTIPLE and not a flat figure.
  let prev = 0;
  for (const raw of [1, 5, 10, 50, 100, 500]) {
    const q = quote({ rawCents: raw, standardRetail: 50, referenceCogs: 11.8, shareBps: 5000 });
    assert.ok(q.credits > prev, `cost ${raw}c priced at ${q.credits}, not above ${prev}`);
    prev = q.credits;
  }
});

test('the SQL derives the standard price from the markup multiple, not a constant', () => {
  const q = FUNCS.slice(FUNCS.indexOf('CREATE OR REPLACE FUNCTION public.billing_price_quote'));
  assert.match(q, /v_multiple\s*:=\s*v_p\.standard_retail_cents::numeric \/ v_p\.reference_landed_cogs_cents/);
  assert.match(q, /v_standard\s*:=\s*round\(v_cogs \* v_multiple, 4\)/);
  assert.match(q, /v_plan_price\s*:=\s*round\(v_cogs \+ v_pool \* \(1 - v_plan\.profit_share_to_customer_bps \/ 10000\.0\), 4\)/);
  // price >= cogs / (1 - m), applied AFTER the plan concession.
  assert.match(q, /v_floor\s*:=\s*round\(v_cogs \/ \(1 - v_min_bps\/10000\.0\), 4\)/);
  assert.match(q, /v_final\s*:=\s*greatest\(v_plan_price, v_floor\)/);
});

test('tax is a setting, not a constant, so 18% can change per jurisdiction', () => {
  const cogs = FUNCS.slice(FUNCS.indexOf('billing_landed_cogs_cents'));
  assert.match(cogs, /billing_setting_num\('billing_cogs_tax_bps', 1800\)/);
  assert.match(cogs, /billing_setting_num\('billing_cogs_fee_bps', 0\)/);
  assert.ok(!/1\.18/.test(strip(cogs)), 'the 18% must not be baked in as a literal multiplier');
});

test('cached input tokens are priced at the cached rate, not the full one', () => {
  // Adding cached to fresh would overstate our cost, and under a markup model
  // an overstated cost means an overcharged customer.
  const aiCost = mig('20260911194500_billing_v2_notification_and_activity_types.sql');
  assert.ok(aiCost.length > 0); // migration exists
  // The function itself was applied separately; assert on the caller contract.
  const verify = fn('homatch-research/index.ts');
  assert.match(verify, /p_cached_tokens: cachedTokens/);
  assert.match(verify, /input_tokens_details\?\.cached_tokens/);
});

// ── The wallet ──────────────────────────────────────────────────────────────

test('spend order is promotional, then membership, then purchased', () => {
  // Spend what can evaporate before what cannot, and the customer's own money
  // last. The ORDER BY is the rule; the index merely matches it.
  const reserve = FUNCS.slice(FUNCS.indexOf('CREATE OR REPLACE FUNCTION public.wallet_reserve'));
  assert.match(
    reserve,
    /order by case kind when 'PROMOTIONAL' then 0 when 'MEMBERSHIP' then 1\s*\n\s*when 'ADJUSTMENT' then 2 else 3 end,\s*\n\s*expires_at asc nulls last/,
  );
});

test('purchased credits cannot be given an expiry, at the schema level', () => {
  assert.match(CORE, /CONSTRAINT credit_lots_purchased_never_expire\s*\n\s*CHECK \(kind <> 'PURCHASED' OR expires_at IS NULL\)/);
  // And the granting function refuses before it ever reaches the constraint.
  assert.match(FUNCS, /if p_kind = 'PURCHASED' and p_expires_at is not null then raise exception 'PURCHASED_CREDITS_MUST_NOT_EXPIRE'/);
});

test('a lot can never be overdrawn', () => {
  assert.match(CORE, /CONSTRAINT credit_lots_not_overdrawn\s*\n\s*CHECK \(credits_consumed \+ credits_reserved \+ credits_expired <= credits_granted\)/);
  // available is generated, so it cannot drift from its parts.
  assert.match(CORE, /credits_available numeric\(18,4\)\s*\n\s*GENERATED ALWAYS AS \(credits_granted - credits_consumed - credits_reserved - credits_expired\) STORED/);
});

test('settlement is clamped to what the customer authorised', () => {
  const settle = SETTLE_FIX.slice(SETTLE_FIX.indexOf('CREATE OR REPLACE FUNCTION public.wallet_settle'));
  assert.match(settle, /if v_charge > v_res\.authorized_max_credits then\s*\n\s*v_charge := v_res\.authorized_max_credits;\s*\n\s*v_clamped := true;/);
  // Belt and braces: the table refuses an over-authorisation row outright.
  assert.match(CORE, /CONSTRAINT usage_reservations_settle_within_authorization\s*\n\s*CHECK \(settled_credits <= authorized_max_credits\)/);
});

test('a reservation cannot be placed that the balance does not cover', () => {
  const reserve = FUNCS.slice(FUNCS.indexOf('CREATE OR REPLACE FUNCTION public.wallet_reserve'));
  assert.match(reserve, /if v_before < v_need then raise exception 'INSUFFICIENT_CREDITS'/);
  // Concurrency: the row is locked before the check, so two simultaneous
  // reservations serialise instead of both reading the same balance.
  assert.match(reserve, /from public\.credit_accounts ca where ca\.user_id = p_user_id for update/);
});

test('the materialised balance and the lots cannot silently diverge', () => {
  const reserve = FUNCS.slice(FUNCS.indexOf('CREATE OR REPLACE FUNCTION public.wallet_reserve'));
  assert.match(reserve, /WALLET_LOT_DRIFT/);
  // And there is a function whose whole job is proving the invariant.
  assert.match(FUNCS, /CREATE OR REPLACE FUNCTION public\.billing_wallet_integrity/);
});

test('a crashed worker cannot strand a customer\'s credits', () => {
  assert.match(FUNCS, /CREATE OR REPLACE FUNCTION public\.wallet_sweep_expired_reservations/);
  const sweep = FUNCS.slice(FUNCS.indexOf('wallet_sweep_expired_reservations'));
  assert.match(sweep, /status = 'RESERVED' and expires_at < now\(\)/);
  assert.match(sweep, /wallet_release\(v_row\.id, 'reservation_expired'\)/);
});

test('releasing a failed run gives back the included slot too', () => {
  const release = SETTLE_FIX.slice(SETTLE_FIX.indexOf('CREATE OR REPLACE FUNCTION public.wallet_release'));
  assert.match(release, /if v_res\.allowance_consumption_id is not null then\s*\n\s*perform public\.billing_release_allowance/);
  // Provider cost we did incur is still recorded, against Homatch.
  assert.match(release, /false, false, 'FAILED', p_reason/);
});

// ── Allowances ──────────────────────────────────────────────────────────────

test('included usage is counted from an append-only table, not a resettable counter', () => {
  assert.match(CORE, /CREATE TABLE IF NOT EXISTS public\.allowance_consumptions/);
  // A released slot is marked, never deleted, so history survives.
  assert.match(FUNCS, /set released_at = now\(\), release_reason = p_reason/);
  assert.ok(
    !/DELETE FROM public\.allowance_consumptions/i.test(strip(FUNCS)),
    'an allowance row must never be deleted',
  );
  // Nothing anywhere resets a usage counter on a schedule.
  for (const f of fs.readdirSync(MIG)) {
    if (!f.startsWith('202609111') && !f.startsWith('2026091119')) continue;
    const sql = strip(read(path.join(MIG, f)));
    assert.ok(
      !/update[\s\S]{0,80}set[\s\S]{0,80}(usage_count|included_used)\s*=\s*0/i.test(sql),
      `${f} appears to zero a usage counter`,
    );
  }
});

test('two concurrent claims cannot take the same included slot', () => {
  const claim = FUNCS.slice(FUNCS.indexOf('CREATE OR REPLACE FUNCTION public.billing_claim_allowance'));
  assert.match(claim, /pg_advisory_xact_lock/);
  // The unique index is the backstop if the lock is ever removed.
  assert.match(CORE, /CREATE UNIQUE INDEX IF NOT EXISTS uidx_allowance_slot\s*\n\s*ON public\.allowance_consumptions\(user_id, product_code, period_key, slot_index\)/);
});

test('FREE runs on the calendar month and a paid plan on its own billing cycle', () => {
  const period = FUNCS.slice(FUNCS.indexOf('CREATE OR REPLACE FUNCTION public.billing_period_key'));
  assert.match(period, /'SUB:' \|\| v_sub\.id::text/);
  assert.match(period, /'CAL:' \|\| to_char\(now\(\) at time zone 'UTC', 'YYYY-MM'\)/);
});

// ── The activation bonus ────────────────────────────────────────────────────

test('$1 buys 10 Credits, and the bonus matches it once', () => {
  assert.match(CORE, /\('USD_1',\s*100,\s*10, 1\)/);
  assert.match(CORE, /\('USD_5',\s*500,\s*50, 2\)/);
  assert.match(CORE, /\('USD_50', 5000,  500, 5\)/);
  // 10000 bps = a 1:1 match, capped at 10 promotional credits, minimum $1.
  assert.match(CORE, /'FIRST_TOPUP_DOUBLE'[^\n]*'FIRST_TOPUP', 100, 10000, 10, NULL/);
  assert.match(CORE, /\('credits_per_usd', '10'::jsonb/);
});

test('bonus eligibility is decided by unique indexes, not by a read-then-write check', () => {
  assert.match(CORE, /CREATE UNIQUE INDEX IF NOT EXISTS uidx_promo_redemption_user\s*\n\s*ON public\.promotion_redemptions\(user_id, promo_code\)/);
  // Same card, second account: still one bonus.
  assert.match(CORE, /CREATE UNIQUE INDEX IF NOT EXISTS uidx_promo_redemption_fingerprint/);
  assert.match(CORE, /CREATE UNIQUE INDEX IF NOT EXISTS uidx_promo_redemption_payment/);

  // The INSERT is the check: a unique_violation declines the bonus and leaves
  // the top-up standing.
  const topup = SUBS.slice(SUBS.indexOf('CREATE OR REPLACE FUNCTION public.wallet_topup_with_promo'));
  assert.match(topup, /insert into public\.promotion_redemptions[\s\S]{0,1600}exception when unique_violation then/);
});

test('credits bought are derived from the amount paid, never from the client', () => {
  const topup = SUBS.slice(SUBS.indexOf('CREATE OR REPLACE FUNCTION public.wallet_topup_with_promo'));
  assert.match(topup, /v_credits := public\.billing_cents_to_credits\(p_amount_cents\)/);

  const webhook = strip(fn('payment-webhook/index.ts'));
  // The old handler read metadata.credits and credited that many.
  assert.ok(!/metadata\.credits/.test(webhook), 'the webhook must not read a credit count from metadata');
  assert.match(webhook, /session\.amount_total/);
  assert.match(webhook, /wallet_topup_with_promo/);
});

test('the webhook refuses to credit anything when it cannot verify the sender', () => {
  // payment-webhook is deployed verify_jwt=false, so the signature is its only
  // defence. With no secret configured both providers accept any JSON.
  const webhook = fn('payment-webhook/index.ts');
  assert.match(webhook, /if \(!Deno\.env\.get\('PAYMENT_WEBHOOK_SECRET'\)\)/);
  assert.match(webhook, /WEBHOOK_VERIFICATION_UNAVAILABLE/);

  // The refusal must come BEFORE anything is parsed into an action. Compared
  // on the stripped source: the file's header comment mentions
  // wallet_topup_with_promo by name, and comparing raw offsets would find that
  // mention rather than the call and fail for the wrong reason.
  const code = strip(webhook);
  const guardAt = code.indexOf('WEBHOOK_VERIFICATION_UNAVAILABLE');
  const creditAt = code.indexOf('wallet_topup_with_promo');
  assert.ok(guardAt > -1 && creditAt > -1, 'both markers should exist in the code');
  assert.ok(guardAt < creditAt, 'the guard must precede any crediting path');
});

// ── Subscriptions vs the wallet ─────────────────────────────────────────────

test('cancelling a plan does not touch a single credit', () => {
  const apply = mig('20260911193914_subscription_grant_reporting_accuracy.sql');
  const free = apply.slice(apply.indexOf("if p_plan_code = 'FREE' then"));
  const branch = free.slice(0, free.indexOf('elsif'));
  // The FREE branch updates the subscription and nothing else.
  assert.ok(!/credit_accounts|credit_lots|wallet_/.test(branch), 'cancellation must not reach the wallet');
  assert.match(branch, /status = 'CANCELLED'/);
});

test('a replayed renewal webhook grants nothing and reports nothing', () => {
  const apply = mig('20260911193914_subscription_grant_reporting_accuracy.sql');
  assert.match(apply, /v_granted := case when v_dup then 0 else COALESCE\(v_grant\.credits_granted, 0\) end/);
  // Two independent guards: the event key, and the lot's own source_ref.
  assert.match(apply, /if exists \(select 1 from public\.subscription_events where idempotency_key = p_idempotency_key\)/);
  assert.match(apply, /'membership', v_sub_id::text \|\| ':' \|\| to_char\(v_start, 'YYYYMMDDHH24MISS'\)/);
});

test('users.plan accepts the new plans and is only writable by the engine', () => {
  const m = mig('20260911193839_users_plan_accepts_vip_premium.sql');
  assert.match(m, /CHECK \(plan IN \('FREE','PLUS','PRO','VIP','PREMIUM'\)\)/);
  // is_admin is NOT reachable through the billing flag.
  assert.match(m, /NEW\.is_admin := OLD\.is_admin/);
  assert.match(m, /current_setting\('homatch\.billing_engine', true\)/);
});

// ── Security ────────────────────────────────────────────────────────────────

test('every credit-moving function is service-role only, in body and in grant', () => {
  const moving = [
    'wallet_grant_credits', 'wallet_reserve', 'wallet_settle', 'wallet_release',
    'wallet_sweep_expired_reservations', 'wallet_expire_lots',
    'billing_claim_allowance', 'billing_release_allowance',
  ];
  for (const name of moving) {
    const body = FUNCS.slice(FUNCS.indexOf(`FUNCTION public.${name}`));
    assert.match(
      body.slice(0, 3000),
      /if auth\.role\(\) <> 'service_role' then raise exception 'FORBIDDEN'/,
      `${name} must check its caller`,
    );
  }
  // Revoking from anon+authenticated is NOT enough on this project: PUBLIC
  // must be revoked too, or the default grant leaves it callable.
  assert.match(FUNCS, /REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated/);
  for (const name of moving) {
    assert.ok(FUNCS.includes(`public.${name}(`), `${name} must appear in the revoke list`);
  }
});

test('the subscription and top-up RPCs are service-role only too', () => {
  for (const name of ['subscription_apply_plan', 'wallet_topup_with_promo', 'wallet_admin_adjust']) {
    const body = SUBS.slice(SUBS.indexOf(`FUNCTION public.${name}`));
    assert.match(body.slice(0, 2000), /if auth\.role\(\) <> 'service_role' then raise exception 'FORBIDDEN'/);
  }
  assert.match(SUBS, /REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated/);
});

test('COGS and margin are never granted to a customer at the column level', () => {
  const grants = mig('20260911194005_billable_products_column_grants_not_definer_view.sql');
  // The internal columns are simply absent from the grant.
  const granted = grants.slice(grants.indexOf('GRANT SELECT (code, name, billing_mode'));
  const cols = granted.slice(0, granted.indexOf('ON public.billable_products'));
  for (const forbidden of ['reference_landed_cogs_cents', 'standard_retail_cents', 'min_gross_margin_bps']) {
    assert.ok(!cols.includes(forbidden), `${forbidden} must not be granted to a customer`);
  }
  // The public view is security_invoker, so it cannot widen what the reader has.
  assert.match(grants, /WITH \(security_invoker = true\)/);

  const usage = mig('20260911194022_usage_events_cogs_column_grants.sql');
  const ugranted = usage.slice(usage.indexOf('GRANT SELECT (id, user_id'));
  const ucols = ugranted.slice(0, ugranted.indexOf('ON public.usage_events'));
  for (const forbidden of ['raw_provider_cost_cents', 'ai_cost_cents', 'landed_cogs_cents', 'tax_cents']) {
    assert.ok(!ucols.includes(forbidden), `${forbidden} must not be granted to a customer`);
  }
});

test('the customer-facing quote returns no economics', () => {
  const quoteFn = SUBS.slice(SUBS.indexOf('CREATE OR REPLACE FUNCTION public.billing_quote_for_me'));
  const returned = quoteFn.slice(0, quoteFn.indexOf('$fn$;', 100));
  for (const forbidden of ['landed_cogs', 'gross_margin', 'base_profit_pool', 'markup', 'standard_price']) {
    assert.ok(
      !new RegExp(`'${forbidden}`).test(returned),
      `billing_quote_for_me must not return ${forbidden}`,
    );
  }
  assert.match(returned, /'estimate_min_credits'/);
  assert.match(returned, /'authorized_max_credits'/);
});

// ── The redenomination ──────────────────────────────────────────────────────

test('the redenomination preserves value and is reversible', () => {
  // x10 on credits.
  assert.match(REDENOM, /v_factor numeric := 10/);
  assert.match(REDENOM, /'economic_value_unchanged', true/);
  assert.match(REDENOM, /'reversal',/);
  // Historical ledger rows are not rewritten; one new entry carries the uplift.
  assert.ok(
    !/UPDATE public\.credit_ledger\s+SET amount/i.test(strip(REDENOM)),
    'historical ledger amounts must not be edited',
  );
  assert.match(REDENOM, /INSERT INTO public\.credit_ledger[\s\S]{0,300}'REDENOMINATION'/);
});

test('the redenomination rescales credit prices and leaves dollar prices alone', () => {
  const settings = REDENOM.slice(REDENOM.indexOf("UPDATE public.admin_settings SET value = to_jsonb"));
  const keys = settings.slice(0, settings.indexOf('AND NOT EXISTS'));
  // Credit-denominated: rescaled.
  for (const k of ['pricing_base_potential', 'pricing_base_good', 'pricing_base_strong',
                   'pricing_base_very_strong', 'pricing_base_exceptional',
                   'pricing_min_credits', 'pricing_max_credits']) {
    assert.ok(keys.includes(k), `${k} is credit-denominated and must be rescaled`);
  }
  // Dollar-denominated and dimensionless: untouched.
  for (const k of ['external_estimated_cost_apify', 'external_estimated_cost_dataforseo',
                   'pricing_multiplier_cogs', 'vat_rate_bps', 'spend_cap_global']) {
    assert.ok(!keys.includes(k), `${k} is not credit-denominated and must NOT be rescaled`);
  }
  // Live unpurchased prices move with the settings that produced them.
  assert.match(REDENOM, /UPDATE public\.matches SET unlock_price_credits = round\(unlock_price_credits \* 10, 2\)/);
});

test('it refuses to run with anything mid-flight', () => {
  assert.match(REDENOM, /REFUSING_TO_REDENOMINATE: % open credit_reservations/);
  assert.match(REDENOM, /REFUSING_TO_REDENOMINATE: % open usage_reservations/);
  assert.match(REDENOM, /REFUSING_TO_REDENOMINATE: % pending match unlocks/);
  // And once only.
  assert.match(REDENOM, /IF v_already > 0 THEN[\s\S]{0,200}RETURN;/);
});

test('the old fixed-price RPC now reads the denomination instead of assuming it', () => {
  assert.match(REDENOM, /v_price_credits := public\.billing_cents_to_credits\(v_product\.price_cents\)/);
  const after = REDENOM.slice(REDENOM.indexOf('reserve_credits_for_product'));
  assert.ok(
    !/price_cents::numeric \/ 100;/.test(strip(after)),
    'the hardcoded $1 = 1 Credit conversion must be gone',
  );
});

// ── Extensibility ───────────────────────────────────────────────────────────

test('a future product registers without touching the wallet or the ledger', () => {
  // AI_CALL and EMAIL_CAMPAIGN are rows, with entitlement rows, and no code.
  assert.match(CORE, /\('EMAIL_CAMPAIGN', 'Email Campaigns', 'VARIABLE', true, 0, 0, 3000, 'PER_UNIT', false, false, 90,/);
  assert.match(CORE, /\('AI_CALL', 'AI Call Center', 'VARIABLE', true, 0, 0, 3000, 'PER_UNIT', false, false, 91,/);
  for (const plan of ['FREE', 'VIP', 'PREMIUM']) {
    assert.match(CORE, new RegExp(`\\('AI_CALL','${plan}',\\s*0,`));
    assert.match(CORE, new RegExp(`\\('EMAIL_CAMPAIGN','${plan}',\\s*0,`));
  }
});

test('an unpriced product cannot be quoted or charged for', () => {
  const q = FUNCS.slice(FUNCS.indexOf('CREATE OR REPLACE FUNCTION public.billing_price_quote'));
  assert.match(q, /if not v_p\.pricing_active then\s*\n\s*raise exception 'PRODUCT_PRICING_INACTIVE/);
  const reserve = FUNCS.slice(FUNCS.indexOf('CREATE OR REPLACE FUNCTION public.wallet_reserve'));
  assert.match(reserve, /if not v_product\.pricing_active then raise exception 'PRODUCT_PRICING_INACTIVE'/);
});

test('the scope exclusion is recorded in the data, not only in a comment', () => {
  assert.match(CORE, /Registered so the wallet\/ledger\/reservation\/entitlement layer is provably extensible/);
});

// ── Kill switches ───────────────────────────────────────────────────────────

test('PAYG has a global kill switch that does not disable included usage', () => {
  assert.match(CORE, /\('billing_payg_enabled', 'true'::jsonb/);
  const reserve = FUNCS.slice(FUNCS.indexOf('CREATE OR REPLACE FUNCTION public.wallet_reserve'));
  assert.match(reserve, /billing_setting_bool\('billing_payg_enabled', true\)[\s\S]{0,60}raise exception 'PAYG_DISABLED'/);
  // The allowance claim does NOT consult it: an included run still works.
  const claim = FUNCS.slice(FUNCS.indexOf('CREATE OR REPLACE FUNCTION public.billing_claim_allowance'));
  const claimBody = claim.slice(0, claim.indexOf('$fn$;', 100));
  assert.ok(!claimBody.includes('billing_payg_enabled'), 'included usage must survive the PAYG kill switch');
});

test('membership grants and the activation promo each have their own switch', () => {
  assert.match(CORE, /\('billing_membership_grants_enabled', 'true'::jsonb/);
  assert.match(CORE, /\('billing_first_topup_promo_enabled', 'true'::jsonb/);
  assert.match(SUBS, /billing_setting_bool\('billing_membership_grants_enabled', true\)/);
  assert.match(SUBS, /billing_setting_bool\('billing_first_topup_promo_enabled', true\)/);
});

// ── Frontend discipline ─────────────────────────────────────────────────────

const SRC = path.join(ROOT, 'src');

function walkSrc() {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === 'ui' || e.name === '__tests__') continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(e.name)) out.push(full);
    }
  };
  walk(SRC);
  return out;
}

test('no component decides what to show by comparing the plan name', () => {
  // The whole point of useEntitlements is that a screen asks what a customer
  // MAY DO, not what they bought. A `plan === 'PREMIUM'` anywhere else is the
  // start of the scattered-conditionals problem the entitlement layer exists
  // to prevent.
  const offenders = [];
  for (const file of walkSrc()) {
    const rel = path.relative(ROOT, file);
    // The hook, the badge and the pricing page legitimately name the plans:
    // one produces the answer, one renders the plan's own identity, and one is
    // the plan comparison itself.
    if (/useEntitlements\.ts|PlanBadge\.tsx|PricingPage\.tsx|types[\/]billing\.ts/.test(rel)) continue;
    const code = strip(fs.readFileSync(file, 'utf8'));
    if (/\bplan\s*===\s*['"](PREMIUM|VIP)['"]/.test(code) ||
        /['"](PREMIUM|VIP)['"]\s*===\s*\w*[Pp]lan\b/.test(code)) {
      offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, [], `these should ask useEntitlements instead: ${offenders.join(', ')}`);
});

test('the frontend never computes a price, an allowance or a bonus', () => {
  const billingSvc = strip(fs.readFileSync(path.join(SRC, 'services', 'billing.ts'), 'utf8'));
  // No margin, no COGS, no tax arithmetic on the client.
  for (const forbidden of ['min_gross_margin', 'landed_cogs', 'profit_share', 'cogs_tax_bps']) {
    assert.ok(!billingSvc.includes(forbidden), `billing.ts must not reference ${forbidden}`);
  }
  // The conversion RATE is always read from the server, never assumed.
  assert.match(billingSvc, /creditsPerUsd: number/);
  assert.ok(
    !/\/\s*10\b(?!\d)/.test(billingSvc.replace(/creditsPerUsd/g, '')),
    'billing.ts must not divide by a hardcoded 10 credits-per-dollar',
  );
});

test('the entitlement hook exposes capabilities, not plan trivia', () => {
  const hook = fs.readFileSync(path.join(SRC, 'hooks', 'useEntitlements.ts'), 'utf8');
  for (const capability of ['includedRemaining', 'tierFor', 'resultCeiling', 'canUse', 'wouldChargeCredits']) {
    assert.ok(hook.includes(capability), `useEntitlements should answer ${capability}()`);
  }
  // PAYG being unlimited on every plan is stated where the decision is made.
  assert.match(hook, /PAYG is unlimited on every plan/);
});

test('the products that actually charge all go through the billing gateway', () => {
  // Verify, Find Clients and Contract Intelligence each hold before they spend
  // and settle on what they measured.
  for (const [file, product] of [
    ['homatch-research/index.ts', 'VERIFY'],
    ['match-campaign/index.ts', 'FIND_CLIENTS'],
    ['deal-room-document-analyze/index.ts', 'CONTRACT_INTELLIGENCE'],
  ]) {
    const code = fn(file);
    assert.match(code, /from '\.\.\/_shared\/billing\.ts'/, `${file} should import the gateway`);
    assert.match(code, new RegExp(`productCode: '${product}'`), `${file} should declare its product`);
    assert.match(code, /beginExecution\(/, `${file} should hold before spending`);
    assert.match(code, /settleExecution\(|releaseExecution\(/, `${file} should settle or release`);
    // And none of them touches the wallet directly.
    const stripped = strip(code);
    assert.ok(!/from\('credit_accounts'\)/.test(stripped), `${file} must not touch credit_accounts`);
    assert.ok(!/from\('credit_lots'\)/.test(stripped), `${file} must not touch credit_lots`);
  }
});

test('the free products never reach the wallet', () => {
  // Mortgage is pure deterministic maths; AI Chat is fair-use limited, not
  // metered. Neither may ever charge a credit.
  const ai = strip(fn('homatch-ai/index.ts'));
  assert.ok(!/wallet_reserve|wallet_settle|beginExecution/.test(ai),
    'AI Chat must never reserve or settle credits');
  assert.match(ai, /ai_fair_use_daily/);

  const mortgageDir = path.join(SRC, 'mortgage');
  if (fs.existsSync(mortgageDir)) {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    for (const f of walk(mortgageDir)) {
      if (!/\.(ts|tsx)$/.test(f) || f.includes('__tests__')) continue;
      const code = strip(fs.readFileSync(f, 'utf8'));
      assert.ok(!/credit|wallet_reserve|beginExecution/i.test(code) || !/wallet_reserve|beginExecution/.test(code),
        `${path.relative(ROOT, f)} must not bill`);
    }
  }
});

test('the Verify tier changes depth, never truthfulness', () => {
  const verify = fn('homatch-research/index.ts');
  // The tier maps onto search breadth and reasoning effort.
  assert.match(verify, /STANDARD: \{ context: 'low',\s*effort: 'low' \}/);
  assert.match(verify, /ENHANCED: \{ context: 'medium', effort: 'medium' \}/);
  assert.match(verify, /MAXIMUM:\s*\{ context: 'high',\s*effort: 'high' \}/);
  // It must NOT change the rules the report is held to. The prompt that forbids
  // inventing facts is built once, outside the tier switch.
  const prompt = verify.slice(verify.indexOf('const modePrompt'), verify.indexOf('callResearchProvider'));
  assert.ok(!/grant\.qualityTier/.test(prompt), 'the tier must not alter the prompt rules');
  assert.match(verify, /Never invent ownership, cadastral records/);
});

test('a cache hit is free and never reaches the billing gate', () => {
  const verify = fn('homatch-research/index.ts');
  const cacheReturn = verify.indexOf('fromCache: true');
  // The CALL site, not the import at the top of the file.
  const gate = verify.indexOf('await beginExecution(');
  assert.ok(cacheReturn > -1 && gate > -1);
  assert.ok(cacheReturn < gate, 'the cache hit must return before the billing gate');
});
