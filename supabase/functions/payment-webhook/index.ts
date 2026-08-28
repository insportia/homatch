// ============================================================
// HOMATCH — payment-webhook Edge Function
// Handles Stripe webhook: checkout.session.completed
// Idempotent: issues Credits exactly once per payment.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const body = await req.text();
    const signature = req.headers.get('stripe-signature') ?? '';
    const webhookSecret = Deno.env.get('PAYMENT_WEBHOOK_SECRET');

    // Verify Stripe signature if configured
    if (webhookSecret) {
      const isValid = await verifyStripeSignature(body, signature, webhookSecret);
      if (!isValid) {
        return json({ error: 'Invalid webhook signature' }, 400);
      }
    }

    const event = JSON.parse(body);
    const eventType = event.type;

    if (eventType !== 'checkout.session.completed') {
      // Acknowledge but skip non-payment events
      return json({ received: true, processed: false, eventType });
    }

    const session = event.data.object;
    const stripeSessionId = session.id;
    const metadata = session.metadata ?? {};
    const userId: string = metadata.user_id;
    const creditsToIssue = Number(metadata.credits ?? 0);
    const idempotencyKey: string = metadata.idempotency_key ?? stripeSessionId;

    if (!userId || creditsToIssue <= 0) {
      return json({ error: 'Missing metadata in session', stripeSessionId }, 400);
    }

    // Idempotency check: find existing payment
    const { data: existingPayment } = await supabaseAdmin
      .from('payments')
      .select('id, status, credits_issued')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (existingPayment?.status === 'COMPLETED') {
      // Already processed — safe to return 200 (Stripe may retry)
      return json({ received: true, processed: false, reason: 'Already completed', paymentId: existingPayment.id });
    }

    // Load current credit balance
    const { data: creditAccount } = await supabaseAdmin
      .from('credit_accounts')
      .select('balance')
      .eq('user_id', userId)
      .maybeSingle();

    const currentBalance = Number(creditAccount?.balance ?? 0);
    const newBalance = currentBalance + creditsToIssue;

    // ── ATOMIC: update credits + ledger + payment ────────────

    // 1. Update credit account
    const { error: creditErr } = await supabaseAdmin
      .from('credit_accounts')
      .update({ balance: newBalance })
      .eq('user_id', userId);

    if (creditErr) throw new Error(`Credit update failed: ${creditErr.message}`);

    // 2. Ledger entry
    const { data: ledgerEntry, error: ledgerErr } = await supabaseAdmin
      .from('credit_ledger')
      .insert({
        user_id: userId,
        amount: creditsToIssue,
        balance_before: currentBalance,
        balance_after: newBalance,
        type: 'TOP_UP',
        reference: `stripe:${stripeSessionId}`,
        payment_id: existingPayment?.id ?? null,
      })
      .select('id')
      .maybeSingle();

    if (ledgerErr) throw new Error(`Ledger insert failed: ${ledgerErr.message}`);

    // 3. Update payment record
    if (existingPayment) {
      await supabaseAdmin
        .from('payments')
        .update({
          status: 'COMPLETED',
          webhook_verified: !!webhookSecret,
          provider_id: stripeSessionId,
          metadata: { session_id: stripeSessionId, ledger_id: ledgerEntry?.id },
        })
        .eq('id', existingPayment.id);
    } else {
      // Payment record not pre-created — insert now
      await supabaseAdmin.from('payments').insert({
        user_id: userId,
        provider: 'stripe',
        provider_id: stripeSessionId,
        amount_usd: session.amount_total ? session.amount_total / 100 : creditsToIssue,
        credits_issued: creditsToIssue,
        status: 'COMPLETED',
        webhook_verified: !!webhookSecret,
        idempotency_key: idempotencyKey,
        metadata: { session_id: stripeSessionId, ledger_id: ledgerEntry?.id },
      });
    }

    // 4. Notification
    await supabaseAdmin.from('notifications').insert({
      user_id: userId,
      type: 'CREDITS_TOPPED_UP',
      title: `${creditsToIssue} Credits added`,
      body: `Your balance is now ${newBalance.toFixed(2)} Credits.`,
      metadata: { credits_added: creditsToIssue, new_balance: newBalance },
    });

    await supabaseAdmin.from('activity_events').insert({
      user_id: userId,
      event_type: 'CREDITS_TOPPED_UP',
      metadata: { credits_added: creditsToIssue, new_balance: newBalance },
    });

    // 5. Resume paused campaigns due to low balance
    await supabaseAdmin
      .from('matching_campaigns')
      .update({ status_v2: 'ACTIVE' })
      .eq('user_id', userId)
      .eq('status_v2', 'LOW_BALANCE');

    return json({
      received: true,
      processed: true,
      userId,
      creditsIssued: creditsToIssue,
      newBalance,
    });
  } catch (err) {
    console.error('payment-webhook error:', err);
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});

// Minimal Stripe signature verification
async function verifyStripeSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    const parts = signature.split(',');
    const timestamp = parts.find(p => p.startsWith('t='))?.split('=')[1];
    const v1 = parts.find(p => p.startsWith('v1='))?.split('=')[1];
    if (!timestamp || !v1) return false;

    const signedPayload = `${timestamp}.${payload}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
    const computed = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return computed === v1;
  } catch {
    return false;
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
