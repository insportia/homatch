// ============================================================
// HOMATCH — credits-topup Edge Function
// Creates a Stripe Checkout Session for credit top-up.
// Minimum top-up: $30 = 30 Credits.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

    // Verify session
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
    if (authErr || !user) return json({ error: 'Invalid session' }, 401);

    const { data: hmUser } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .eq('auth_id', user.id)
      .maybeSingle();
    if (!hmUser) return json({ error: 'User not found' }, 404);

    const creditsToIssue = amountUsd * CREDITS_PER_USD;
    const idempotencyKey = `topup_${hmUser.id}_${amountUsd}_${Date.now()}`;

    const stripeSecretKey = Deno.env.get('PAYMENT_PROVIDER_SECRET');
    const isMock = !stripeSecretKey;

    if (isMock) {
      // Mock: create pending payment record and return a mock session URL
      const { data: payment } = await supabaseAdmin
        .from('payments')
        .insert({
          user_id: hmUser.id,
          provider: 'stripe_mock',
          amount_usd: amountUsd,
          credits_issued: creditsToIssue,
          status: 'PENDING',
          webhook_verified: false,
          idempotency_key: idempotencyKey,
          metadata: { mock: true },
        })
        .select('id')
        .maybeSingle();

      return json({
        success: true,
        mock: true,
        paymentId: payment?.id,
        checkoutUrl: `https://mock-stripe.homatch.com/pay?amount=${amountUsd}&credits=${creditsToIssue}&payment_id=${payment?.id}`,
        creditsToIssue,
        amountUsd,
        message: 'Stripe not configured. Mock payment created.',
      });
    }

    // Real Stripe Checkout Session
    const stripeParams = new URLSearchParams({
      'payment_method_types[]': 'card',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][product_data][name]': `Homatch Credits — ${creditsToIssue} Credits`,
      'line_items[0][price_data][product_data][description]': `${creditsToIssue} Credits ($1 = 1 Credit)`,
      'line_items[0][price_data][unit_amount]': String(amountUsd * 100), // cents
      'line_items[0][quantity]': '1',
      mode: 'payment',
      customer_email: hmUser.email ?? '',
      success_url: successUrl ?? `${Deno.env.get('SUPABASE_URL')}/credits?success=1`,
      cancel_url: cancelUrl ?? `${Deno.env.get('SUPABASE_URL')}/credits?cancelled=1`,
      'metadata[user_id]': hmUser.id,
      'metadata[credits]': String(creditsToIssue),
      'metadata[idempotency_key]': idempotencyKey,
    });

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: stripeParams.toString(),
    });

    if (!stripeRes.ok) {
      const err = await stripeRes.text();
      throw new Error(`Stripe error: ${err}`);
    }

    const session = await stripeRes.json();

    // Create pending payment record
    await supabaseAdmin.from('payments').insert({
      user_id: hmUser.id,
      provider: 'stripe',
      provider_id: session.id,
      amount_usd: amountUsd,
      credits_issued: creditsToIssue,
      status: 'PENDING',
      webhook_verified: false,
      idempotency_key: idempotencyKey,
      metadata: { session_id: session.id },
    });

    return json({
      success: true,
      mock: false,
      checkoutUrl: session.url,
      creditsToIssue,
      amountUsd,
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
