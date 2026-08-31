// ============================================================
// HOMATCH — payment-webhook Edge Function
// Handles the payment provider's webhook via the provider-agnostic
// PaymentProvider abstraction (Master Prompt §10/§11/§14).
// Idempotent: issues Credits exactly once per payment, verified
// with credit_topup_atomic() (row-locked, atomic balance update +
// ledger row — fixes a pre-existing non-atomic read-then-write race
// in the credit_accounts update).
//
// Security: credits are NEVER issued from a frontend redirect or a
// `?success=true` query param — only from this verified webhook.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getPaymentProvider } from '../_shared/payment_provider.ts';

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
    const signature = req.headers.get('stripe-signature');
    const provider = getPaymentProvider();

    const verification = await provider.verifyWebhook(body, signature);
    if (!verification.valid) {
      return json({ error: 'Invalid webhook signature' }, 400);
    }

    const event = verification.event;
    const eventType = verification.eventType;
    const eventId: string | undefined = verification.eventId;

    if (eventType !== 'checkout.session.completed') {
      return json({ received: true, processed: false, eventType });
    }

    const session = event.data.object;
    const providerCheckoutId = session.id;
    const metadata = session.metadata ?? {};
    const userId: string = metadata.user_id;
    const creditsToIssue = Number(metadata.credits ?? 0);
    const idempotencyKey: string = metadata.idempotency_key ?? providerCheckoutId;

    if (!userId || creditsToIssue <= 0) {
      return json({ error: 'Missing metadata in session', providerCheckoutId }, 400);
    }

    // Idempotency: check both the provider event id (webhook-level
    // dedup — Stripe can and does retry delivery) and the
    // idempotency_key (payment-level dedup).
    if (eventId) {
      const { data: byEvent } = await supabaseAdmin
        .from('payments').select('id, status').eq('provider_event_id', eventId).maybeSingle();
      if (byEvent?.status === 'COMPLETED') {
        return json({ received: true, processed: false, reason: 'Event already processed', paymentId: byEvent.id });
      }
    }

    const { data: existingPayment } = await supabaseAdmin
      .from('payments')
      .select('id, status, credits_issued, total_cents')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (existingPayment?.status === 'COMPLETED') {
      return json({ received: true, processed: false, reason: 'Already completed', paymentId: existingPayment.id });
    }

    // ── ATOMIC: credit account + ledger, in one row-locked function ──
    const { data: topupResult, error: topupErr } = await supabaseAdmin.rpc('credit_topup_atomic', {
      p_user_id: userId,
      p_credits: creditsToIssue,
      p_reference: `${provider.name}:${providerCheckoutId}`,
      p_payment_id: existingPayment?.id ?? null,
    });
    if (topupErr) throw new Error(`credit_topup_atomic failed: ${topupErr.message}`);
    const { ledger_entry_id: ledgerId, balance_after: newBalance } = topupResult?.[0] ?? {};

    const invoiceRef = await provider.createInvoiceReference(providerCheckoutId).catch(() => null);

    const paymentUpdate = {
      status: 'COMPLETED',
      webhook_verified: !!signature,
      provider_id: providerCheckoutId,
      provider_event_id: eventId ?? null,
      metadata: { checkout_id: providerCheckoutId, ledger_id: ledgerId },
      ...(invoiceRef ? {
        invoice_id: invoiceRef.invoiceId,
        invoice_url: invoiceRef.invoiceUrl,
        receipt_url: invoiceRef.receiptUrl,
      } : {}),
    };

    if (existingPayment) {
      await supabaseAdmin.from('payments').update(paymentUpdate).eq('id', existingPayment.id);
    } else {
      await supabaseAdmin.from('payments').insert({
        user_id: userId,
        provider: provider.name,
        provider_id: providerCheckoutId,
        provider_event_id: eventId ?? null,
        amount_usd: session.amount_total ? session.amount_total / 100 : creditsToIssue,
        credits_issued: creditsToIssue,
        subtotal_cents: session.amount_total ?? creditsToIssue * 100,
        vat_rate_bps: 0,
        vat_amount_cents: 0,
        total_cents: session.amount_total ?? creditsToIssue * 100,
        idempotency_key: idempotencyKey,
        ...paymentUpdate,
      });
    }

    await supabaseAdmin.from('notifications').insert({
      user_id: userId,
      type: 'CREDITS_TOPPED_UP',
      title: `${creditsToIssue} Credits added`,
      body: `Your balance is now ${Number(newBalance ?? 0).toFixed(2)} Credits.`,
      metadata: { credits_added: creditsToIssue, new_balance: newBalance },
    });

    await supabaseAdmin.from('activity_events').insert({
      user_id: userId,
      event_type: 'CREDITS_TOPPED_UP',
      metadata: { credits_added: creditsToIssue, new_balance: newBalance },
    });

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

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
