// ============================================================
// HOMATCH — billing Edge Function
//
// The customer-facing billing API. Every answer it gives is computed
// server-side; nothing here trusts a number the client sent.
//
//   GET  ?action=catalogue      plans, packs and the activation offer (public)
//   POST { action: 'entitlements' }   what this customer may do right now
//   POST { action: 'quote' }          what one execution would cost them
//   POST { action: 'subscribe' }      start a VIP/Premium checkout
//   POST { action: 'cancel' }         cancel at period end
//   POST { action: 'upgrade-savings' } what a plan WOULD have saved them
//
// WHY upgrade-savings IS COMPUTED FROM THE LEDGER
//
// The mandate is explicit that a savings claim may only be shown when it comes
// from the customer's real usage and the current pricing rules. So it replays
// their actual charged executions through billing_price_quote() at the target
// plan and reports the difference. There is no percentage anywhere in this
// file, and when a customer has no paid history it returns eligible:false
// rather than an invented figure.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getPaymentProvider } from '../_shared/payment_provider.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    // The plan catalogue is public: a signed-out visitor must be able to read
    // the pricing page.
    const url = new URL(req.url);
    if (req.method === 'GET' || url.searchParams.get('action') === 'catalogue') {
      return json(await catalogue(sb));
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const sbUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await sbUser.auth.getUser();
    if (authErr || !user) return json({ error: 'Invalid session' }, 401);

    const { data: hmUser } = await sb
      .from('users').select('id, email').eq('auth_id', user.id).maybeSingle();
    if (!hmUser) return json({ error: 'User not found' }, 404);

    const body = await req.json().catch(() => ({}));
    const action = body?.action ?? 'entitlements';

    switch (action) {
      case 'catalogue':
        return json(await catalogue(sb));

      case 'entitlements': {
        const { data, error } = await sb.rpc('billing_entitlements', { p_user_id: hmUser.id });
        if (error) throw new Error(error.message);
        return json({ entitlements: data });
      }

      case 'quote': {
        const productCode = String(body.productCode ?? '');
        const expectedUnits = Number(body.expectedUnits ?? 1);
        if (!productCode) return json({ error: 'productCode required' }, 400);
        // Called with the service role but scoped to THIS user's id, so a
        // client cannot quote as somebody else.
        const { data, error } = await sb.rpc('billing_entitlements', { p_user_id: hmUser.id });
        if (error) throw new Error(error.message);
        return json({ quote: await quoteFor(sb, hmUser.id, data, productCode, expectedUnits) });
      }

      case 'subscribe':
        return json(await subscribe(sb, hmUser, body));

      case 'cancel':
        return json(await cancel(sb, hmUser.id));

      case 'upgrade-savings':
        return json(await upgradeSavings(sb, hmUser.id, String(body.targetPlan ?? 'VIP')));

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error('billing error:', err);
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});

// ── catalogue ────────────────────────────────────────────────

async function catalogue(sb: any) {
  const [{ data: plans }, { data: packs }, { data: promo }, { data: ents }, { data: cpu }] = await Promise.all([
    sb.from('billing_plans')
      .select('code, name, monthly_price_cents, membership_credits_grant, membership_rollover_cap, quality_tier, badge_key, priority_level, marketing_label_key, sort_order')
      .eq('enabled', true).order('sort_order'),
    sb.from('topup_packs').select('code, amount_cents, credits, sort_order').eq('enabled', true).order('sort_order'),
    sb.from('promotions').select('code, name, min_amount_cents, bonus_match_bps, max_bonus_credits, enabled')
      .eq('code', 'FIRST_TOPUP_DOUBLE').maybeSingle(),
    // The plan comparison grid. provider_budget_ceiling_cents is not granted to
    // the client at the column level, so it cannot be selected here.
    sb.from('product_plan_entitlements')
      .select('product_code, plan_code, included_per_period, period, quality_tier, result_ceiling, priority_level'),
    sb.from('admin_settings').select('value').eq('key', 'credits_per_usd').maybeSingle(),
  ]);

  return {
    plans: plans ?? [],
    topupPacks: packs ?? [],
    firstTopupPromo: promo?.enabled ? promo : null,
    entitlementMatrix: ents ?? [],
    creditsPerUsd: Number(cpu?.value ?? 10),
  };
}

// ── quote ────────────────────────────────────────────────────

async function quoteFor(sb: any, userId: string, ent: any, productCode: string, expectedUnits: number) {
  const planCode = ent?.plan_code ?? 'FREE';
  const product = (ent?.products ?? []).find((p: any) => p.product_code === productCode);
  if (!product) return { productCode, funding: 'UNAVAILABLE', reason: 'NOT_AVAILABLE_ON_PLAN' };

  if (Number(product.included_remaining) > 0) {
    return {
      productCode, planCode,
      qualityTier: product.quality_tier,
      funding: 'INCLUDED',
      includedRemaining: Number(product.included_remaining),
      includedPerPeriod: Number(product.included_per_period),
      estimateMinCredits: 0, estimateMaxCredits: 0, authorizedMaxCredits: 0,
      resultCeiling: product.result_ceiling ?? null,
    };
  }

  if (!product.payg_available) {
    return { productCode, planCode, qualityTier: product.quality_tier, funding: 'UNAVAILABLE', includedRemaining: 0 };
  }

  const { data: q, error } = await sb.rpc('billing_price_quote', {
    p_product_code: productCode, p_plan_code: planCode, p_landed_cogs_cents: null,
  });
  if (error || !q?.[0]) {
    return { productCode, planCode, funding: 'UNAVAILABLE', reason: 'PRICING_INACTIVE' };
  }

  const { data: prod } = await sb.from('billable_products').select('config').eq('code', productCode).maybeSingle();
  const spread = Number(prod?.config?.estimate_spread_bps ?? 2500) / 10000;
  const expected = Number(q[0].credits) * Math.max(expectedUnits, 0.0001);

  // Deliberately NOT returned: landed_cogs_cents, standard_price_cents,
  // base_profit_pool_cents, gross_margin_bps, markup_bps. Those are ours.
  return {
    productCode, planCode,
    qualityTier: product.quality_tier,
    funding: 'PAYG',
    includedRemaining: 0,
    includedPerPeriod: Number(product.included_per_period),
    unitCredits: Number(q[0].credits),
    estimateMinCredits: round2(expected * (1 - spread)),
    estimateMaxCredits: round2(expected * (1 + spread)),
    authorizedMaxCredits: round2(expected * (1 + spread)),
    resultCeiling: product.result_ceiling ?? null,
    memberRateKey: planCode === 'FREE' ? 'rate_standard' : planCode === 'VIP' ? 'rate_vip' : 'rate_best',
    walletBalance: Number(ent?.wallet?.balance ?? 0),
    creditsPerUsd: Number(ent?.wallet?.credits_per_usd ?? 10),
  };
}

// ── subscribe / cancel ───────────────────────────────────────

async function subscribe(sb: any, hmUser: any, body: any) {
  const planCode = String(body.planCode ?? '');
  if (!['VIP', 'PREMIUM'].includes(planCode)) {
    return { error: 'planCode must be VIP or PREMIUM' };
  }

  const { data: plan } = await sb
    .from('billing_plans').select('code, name, monthly_price_cents, enabled').eq('code', planCode).maybeSingle();
  if (!plan?.enabled) return { error: 'Plan unavailable' };

  const current = await sb.rpc('billing_current_plan', { p_user_id: hmUser.id });
  if (current.data === planCode) {
    return { error: 'ALREADY_ON_PLAN', planCode };
  }

  const provider = getPaymentProvider();
  const checkout = await provider.createSubscriptionCheckout({
    planCode: plan.code,
    planName: `Homatch ${plan.name}`,
    // The price comes from the database, never from the request.
    amountCentsPerMonth: plan.monthly_price_cents,
    currency: 'usd',
    customerEmail: hmUser.email ?? undefined,
    successUrl: body.successUrl ?? `${Deno.env.get('APP_URL') ?? ''}/pricing?subscribed=1`,
    cancelUrl: body.cancelUrl ?? `${Deno.env.get('APP_URL') ?? ''}/pricing?cancelled=1`,
    metadata: { user_id: hmUser.id, plan_code: plan.code, kind: 'SUBSCRIPTION' },
  });

  return {
    success: true,
    mock: checkout.mock,
    checkoutUrl: checkout.checkoutUrl,
    planCode: plan.code,
    monthlyPriceCents: plan.monthly_price_cents,
    ...(checkout.mock
      ? { message: 'Payment provider not configured. No subscription was created and no money moved.' }
      : {}),
  };
}

async function cancel(sb: any, userId: string) {
  const { data: sub } = await sb
    .from('user_subscriptions').select('id, plan_code, current_period_end, status')
    .eq('user_id', userId).in('status', ['ACTIVE', 'PAST_DUE']).maybeSingle();
  if (!sub) return { error: 'NO_ACTIVE_SUBSCRIPTION' };

  // Cancel at period end, not immediately: the customer paid for this month.
  // The plan drops to FREE when the provider's deletion webhook arrives, or
  // when subscription_expire_lapsed() sweeps the lapsed period.
  await sb.from('user_subscriptions')
    .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
    .eq('id', sub.id);

  return {
    success: true,
    cancelAtPeriodEnd: true,
    activeUntil: sub.current_period_end,
    planCode: sub.plan_code,
    // Said plainly because it is the thing customers actually worry about.
    creditsRetained: true,
  };
}

// ── upgrade savings, from real usage only ────────────────────

async function upgradeSavings(sb: any, userId: string, targetPlan: string) {
  if (!['VIP', 'PREMIUM'].includes(targetPlan)) return { eligible: false, reason: 'INVALID_TARGET' };

  // Only genuinely charged executions count. Allowance-funded and
  // non-billable runs cost the customer nothing, so they cannot have been
  // cheaper on another plan.
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const { data: events } = await sb
    .from('usage_events')
    .select('product_code, landed_cogs_cents, charged_credits, plan_code')
    .eq('user_id', userId).eq('billable', true).gt('charged_credits', 0)
    .gte('created_at', since)
    .limit(500);

  if (!events?.length) {
    // No history, no claim. Never fabricate a savings figure.
    return { eligible: false, reason: 'NO_PAID_USAGE_YET', targetPlan };
  }

  let actual = 0;
  let wouldHavePaid = 0;
  const byProduct: Record<string, { actual: number; target: number; runs: number }> = {};

  for (const e of events) {
    const cogs = Number(e.landed_cogs_cents) > 0 ? Number(e.landed_cogs_cents) : null;
    const { data: q } = await sb.rpc('billing_price_quote', {
      p_product_code: e.product_code, p_plan_code: targetPlan, p_landed_cogs_cents: cogs,
    });
    if (!q?.[0]) continue;
    const was = Number(e.charged_credits);
    const would = Number(q[0].credits);
    actual += was;
    wouldHavePaid += would;
    byProduct[e.product_code] ??= { actual: 0, target: 0, runs: 0 };
    byProduct[e.product_code].actual += was;
    byProduct[e.product_code].target += would;
    byProduct[e.product_code].runs += 1;
  }

  const { data: plan } = await sb
    .from('billing_plans').select('membership_credits_grant, monthly_price_cents')
    .eq('code', targetPlan).maybeSingle();

  const creditsSaved = round2(actual - wouldHavePaid);
  return {
    eligible: creditsSaved > 0,
    targetPlan,
    windowDays: 90,
    runsConsidered: events.length,
    creditsChargedActual: round2(actual),
    creditsOnTargetPlan: round2(wouldHavePaid),
    // The honest headline: what the member rate alone would have saved, plus
    // the included monthly grant stated separately rather than blended in.
    creditsSavedOnRates: creditsSaved,
    monthlyMembershipCredits: Number(plan?.membership_credits_grant ?? 0),
    monthlyPriceCents: Number(plan?.monthly_price_cents ?? 0),
    byProduct,
  };
}

function round2(v: number): number { return Math.round(v * 100) / 100; }

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
