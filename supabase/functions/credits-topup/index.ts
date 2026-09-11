// ============================================================
// HOMATCH — credits-topup Edge Function
//
// Creates a checkout session for a wallet top-up through the
// provider-agnostic PaymentProvider abstraction.
//
// WHAT CHANGED WITH BILLING v2
//
// The minimum was $30 and one dollar bought one Credit. It is now $1 and one
// dollar buys ten, because the wallet's job changed: it used to be a
// prepayment for research packs, and it is now the thing that lets a FREE
// customer continue past their included allowance without subscribing. A $30
// floor in front of a $0.50 Verify is a wall, not a price.
//
// The credit figure is NOT sent to the webhook to act on. It is computed here
// only so the checkout page can say what the customer is buying; the webhook
// recomputes it from the amount actually paid, server-side, through
// billing_cents_to_credits(). A client that tampers with this request changes
// what it is charged, never what it receives.
//
// Wallet top-ups are still treated as a deposit and are NOT VAT-charged here.
// VAT applies to the SERVICE at the point of consumption, whose price is
// already VAT-inclusive. Charging it at both ends would tax the same dollar
// twice. (Flagged for the operator in the original report; unchanged.)
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getPaymentProvider } from '../_shared/payment_provider.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Fallbacks only. The real values live in admin_settings / topup_packs so an
// operator can change them without a deploy.
const FALLBACK_MIN_CENTS = 100;
const FALLBACK_CREDITS_PER_USD = 10;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const { packCode, amountUsd, successUrl, cancelUrl } = body ?? {};

    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
    if (authErr || !user) return json({ error: 'Invalid session' }, 401);

    const { data: hmUser } = await supabaseAdmin
      .from('users').select('id, email').eq('auth_id', user.id).maybeSingle();
    if (!hmUser) return json({ error: 'User not found' }, 404);

    const [{ data: minSetting }, { data: cpuSetting }] = await Promise.all([
      supabaseAdmin.from('admin_settings').select('value').eq('key', 'billing_min_topup_cents').maybeSingle(),
      supabaseAdmin.from('admin_settings').select('value').eq('key', 'credits_per_usd').maybeSingle(),
    ]);
    const minCents = Number(minSetting?.value ?? FALLBACK_MIN_CENTS);
    const creditsPerUsd = Number(cpuSetting?.value ?? FALLBACK_CREDITS_PER_USD);

    // A named pack is authoritative over a raw amount, so the common path
    // cannot be off-by-a-cent from what the customer was shown.
    let totalCents: number;
    if (packCode) {
      const { data: pack } = await supabaseAdmin
        .from('topup_packs').select('amount_cents, enabled').eq('code', packCode).maybeSingle();
      if (!pack || !pack.enabled) return json({ error: 'Unknown or disabled top-up pack' }, 400);
      totalCents = pack.amount_cents;
    } else {
      totalCents = Math.round(Number(amountUsd ?? 0) * 100);
    }

    if (!Number.isFinite(totalCents) || totalCents < minCents) {
      return json({
        error: `Minimum top-up is $${(minCents / 100).toFixed(2)}`,
        minAmountCents: minCents,
      }, 400);
    }

    const creditsToIssue = (totalCents / 100) * creditsPerUsd;

    // Is this customer still eligible for the once-per-account activation
    // bonus? Read only, for the checkout description. The DECISION is made by
    // wallet_topup_with_promo() at webhook time, against unique indexes.
    const { data: ent } = await supabaseAdmin.rpc('billing_entitlements', { p_user_id: hmUser.id });
    const promoAvailable = !!ent?.first_topup_promo_available;

    let bonusCredits = 0;
    if (promoAvailable) {
      const { data: promo } = await supabaseAdmin
        .from('promotions')
        .select('min_amount_cents, bonus_match_bps, max_bonus_credits, enabled')
        .eq('code', 'FIRST_TOPUP_DOUBLE').maybeSingle();
      if (promo?.enabled && totalCents >= promo.min_amount_cents) {
        bonusCredits = Math.min(
          (creditsToIssue * promo.bonus_match_bps) / 10000,
          Number(promo.max_bonus_credits),
        );
      }
    }

    const idempotencyKey = `topup_${hmUser.id}_${totalCents}_${Date.now()}`;
    const provider = getPaymentProvider();

    const totalCredits = creditsToIssue + bonusCredits;
    const checkout = await provider.createCheckout({
      amountCents: totalCents,
      currency: 'usd',
      customerEmail: hmUser.email ?? undefined,
      productName: `Homatch Credits — ${totalCredits} Credits`,
      description: bonusCredits > 0
        ? `${creditsToIssue} Credits plus ${bonusCredits} bonus Credits`
        : `${creditsToIssue} Credits`,
      successUrl: successUrl ?? `${Deno.env.get('APP_URL') ?? ''}/credits?success=1`,
      cancelUrl: cancelUrl ?? `${Deno.env.get('APP_URL') ?? ''}/credits?cancelled=1`,
      metadata: {
        user_id: hmUser.id,
        kind: 'TOPUP',
        amount_cents: String(totalCents),
        idempotency_key: idempotencyKey,
      },
    });

    const { data: payment } = await supabaseAdmin
      .from('payments')
      .insert({
        user_id: hmUser.id,
        provider: provider.name,
        provider_id: checkout.providerCheckoutId,
        amount_usd: totalCents / 100,
        credits_issued: creditsToIssue,
        status: 'PENDING',
        webhook_verified: false,
        idempotency_key: idempotencyKey,
        subtotal_cents: totalCents,
        vat_rate_bps: 0,
        vat_amount_cents: 0,
        total_cents: totalCents,
        currency: 'usd',
        metadata: { checkout_id: checkout.providerCheckoutId, mock: checkout.mock, kind: 'TOPUP' },
      })
      .select('id').maybeSingle();

    return json({
      success: true,
      mock: checkout.mock,
      paymentId: payment?.id,
      checkoutUrl: checkout.checkoutUrl,
      amountCents: totalCents,
      creditsToIssue,
      bonusCredits,
      totalCredits,
      // Advisory. The webhook decides for real.
      firstTopupBonusExpected: bonusCredits > 0,
      ...(checkout.mock ? { message: 'Payment provider not configured. Mock payment created.' } : {}),
    });
  } catch (err) {
    console.error('credits-topup error:', err);
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
