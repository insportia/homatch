// ============================================================
// HOMATCH — credits-topup Edge Function
// Creates a checkout session for a wallet top-up via the
// provider-agnostic PaymentProvider abstraction (Master Prompt §10).
// Minimum top-up: $30 = 30 Credits.
//
// Design note: wallet top-ups are treated as a deposit (like a gift
// card) and are NOT VAT-charged here — VAT applies to the research
// PRODUCT at purchase time (its price_cents is already VAT-inclusive,
// see research_products / research-purchase). This mirrors the
// customer flow in the master prompt spec, where the wallet balance
// is shown as a plain dollar figure and only research-product prices
// say "VAT included". A zero-rate tax snapshot is still stored on
// the payment row for schema consistency.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getPaymentProvider } from '../_shared/payment_provider.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MIN_TOPUP_USD = 30;
const CREDITS_PER_USD = 1; // $1 = 1 Credit

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const { amountUsd = 30, successUrl, cancelUrl } = await req.json();

    if (amountUsd < MIN_TOPUP_USD) {
      return json({ error: `Minimum top-up is $${MIN_TOPUP_USD}`, minAmount: MIN_TOPUP_USD }, 400);
    }

    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
    if (authErr || !user) return json({ error: 'Invalid session' }, 401);

    const { data: hmUser } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .eq('auth_id', user.id)
      .maybeSingle();
    if (!hmUser) return json({ error: 'User not found' }, 404);

    const totalCents = Math.round(amountUsd * 100);
    const creditsToIssue = amountUsd * CREDITS_PER_USD;
    const idempotencyKey = `topup_${hmUser.id}_${amountUsd}_${Date.now()}`;

    const provider = getPaymentProvider();

    const checkout = await provider.createCheckout({
      amountCents: totalCents,
      currency: 'usd',
      customerEmail: hmUser.email ?? undefined,
      productName: `Homatch Credits — ${creditsToIssue} Credits`,
      description: `${creditsToIssue} Credits ($1 = 1 Credit)`,
      successUrl: successUrl ?? `${Deno.env.get('SUPABASE_URL')}/credits?success=1`,
      cancelUrl: cancelUrl ?? `${Deno.env.get('SUPABASE_URL')}/credits?cancelled=1`,
      metadata: {
        user_id: hmUser.id,
        credits: String(creditsToIssue),
        idempotency_key: idempotencyKey,
      },
    });

    const { data: payment } = await supabaseAdmin
      .from('payments')
      .insert({
        user_id: hmUser.id,
        provider: provider.name,
        provider_id: checkout.providerCheckoutId,
        amount_usd: amountUsd,
        credits_issued: creditsToIssue,
        status: 'PENDING',
        webhook_verified: false,
        idempotency_key: idempotencyKey,
        subtotal_cents: totalCents,
        vat_rate_bps: 0,
        vat_amount_cents: 0,
        total_cents: totalCents,
        currency: 'usd',
        metadata: { checkout_id: checkout.providerCheckoutId, mock: checkout.mock },
      })
      .select('id')
      .maybeSingle();

    return json({
      success: true,
      mock: checkout.mock,
      paymentId: payment?.id,
      checkoutUrl: checkout.checkoutUrl,
      creditsToIssue,
      amountUsd,
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
