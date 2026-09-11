// ============================================================
// HOMATCH — payment-webhook Edge Function
//
// The ONLY place credits are issued and the ONLY place a subscription plan
// changes. Never from a frontend redirect, never from a `?success=true` query
// param, never from anything a client can forge.
//
// WHAT CHANGED WITH BILLING v2
//
// 1. Credits are no longer taken from session metadata. The old handler read
//    `metadata.credits` and credited that many. Stripe echoes back whatever we
//    set, so it was not directly forgeable, but it meant the number credited
//    came from the request that STARTED the checkout rather than from the money
//    that actually arrived. Now the amount paid is the input and
//    billing_cents_to_credits() is the conversion, server-side.
//
// 2. The once-per-customer activation bonus is granted inside
//    wallet_topup_with_promo(), in the same transaction as the top-up, where
//    unique indexes on promotion_redemptions decide eligibility. A redelivered
//    webhook, two concurrent deliveries, and a second account on the same card
//    all collide on an index rather than on a read-then-write check.
//
// 3. Subscription events are handled here too. checkout.session.completed in
//    subscription mode creates the plan; invoice.paid renews it and grants the
//    next cycle's membership credits; customer.subscription.deleted returns the
//    customer to FREE without touching a single purchased credit.
//
// IDEMPOTENCY, IN THREE LAYERS
//
//   provider_event_id unique index   the same webhook event, redelivered
//   idempotency_key                  the same payment, seen twice
//   credit_lots (user, source_type, source_ref)  the same grant, attempted twice
//
// The third is the one that actually holds, because it lives with the money.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getPaymentProvider } from '../_shared/payment_provider.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
};

const SUBSCRIPTION_EVENTS = new Set([
  'checkout.session.completed',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.deleted',
  'customer.subscription.updated',
]);

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const body = await req.text();
    const signature = req.headers.get('stripe-signature');
    const provider = getPaymentProvider();

    const verification = await provider.verifyWebhook(body, signature);
    if (!verification.valid) return json({ error: 'Invalid webhook signature' }, 400);

    const event = verification.event;
    const eventType = verification.eventType ?? '';
    const eventId: string | undefined = verification.eventId;

    if (!SUBSCRIPTION_EVENTS.has(eventType)) {
      return json({ received: true, processed: false, eventType });
    }

    // Webhook-level dedup, before anything is decided.
    if (eventId) {
      const { data: seen } = await sb
        .from('payments').select('id, status').eq('provider_event_id', eventId).maybeSingle();
      if (seen?.status === 'COMPLETED') {
        return json({ received: true, processed: false, reason: 'Event already processed', paymentId: seen.id });
      }
    }

    const object = event?.data?.object ?? {};
    const metadata = object.metadata ?? {};

    // ── Subscription lifecycle ────────────────────────────────
    if (eventType === 'checkout.session.completed' && object.mode === 'subscription') {
      return json(await handleSubscriptionStart(sb, provider, object, metadata, eventId));
    }
    if (eventType === 'invoice.paid') {
      return json(await handleSubscriptionRenewal(sb, object, eventId));
    }
    if (eventType === 'customer.subscription.deleted') {
      return json(await handleSubscriptionEnded(sb, object, eventId));
    }
    if (eventType === 'customer.subscription.updated' || eventType === 'invoice.payment_failed') {
      return json(await handleSubscriptionStatus(sb, object, eventType, eventId));
    }

    // ── Wallet top-up ─────────────────────────────────────────
    return json(await handleTopup(sb, provider, object, metadata, eventId, signature));
  } catch (err) {
    console.error('payment-webhook error:', err);
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});

// ── Top-up ───────────────────────────────────────────────────

async function handleTopup(
  sb: any, provider: any, session: any, metadata: any,
  eventId: string | undefined, signature: string | null,
) {
  const providerCheckoutId = session.id;
  const userId: string = metadata.user_id;
  const idempotencyKey: string = metadata.idempotency_key ?? providerCheckoutId;

  if (!userId) return { error: 'Missing user_id in session metadata', providerCheckoutId };

  // The amount PAID is the source of truth, not what the checkout request said
  // it would be. `amount_cents` in metadata is only a fallback for providers
  // that do not report a total.
  const paidCents = Number(session.amount_total ?? metadata.amount_cents ?? 0);
  if (!Number.isFinite(paidCents) || paidCents <= 0) {
    return { error: 'No payable amount on session', providerCheckoutId };
  }

  const { data: existingPayment } = await sb
    .from('payments').select('id, status').eq('idempotency_key', idempotencyKey).maybeSingle();
  if (existingPayment?.status === 'COMPLETED') {
    return { received: true, processed: false, reason: 'Already completed', paymentId: existingPayment.id };
  }

  // A stable identity for the card, where the provider offers one. Null is a
  // normal answer, not a failure — the per-user index still holds.
  const fingerprint = await provider.getPaymentInstrumentFingerprint(providerCheckoutId).catch(() => null);

  // Make sure a payment row exists BEFORE crediting, so the ledger entry and
  // the promotion redemption can both point at it.
  let paymentId = existingPayment?.id ?? null;
  if (!paymentId) {
    const { data: inserted } = await sb.from('payments').insert({
      user_id: userId,
      provider: provider.name,
      provider_id: providerCheckoutId,
      provider_event_id: eventId ?? null,
      amount_usd: paidCents / 100,
      credits_issued: 0,
      status: 'PENDING',
      idempotency_key: idempotencyKey,
      subtotal_cents: paidCents,
      vat_rate_bps: 0,
      vat_amount_cents: 0,
      total_cents: paidCents,
      currency: session.currency ?? 'usd',
      webhook_verified: !!signature,
    }).select('id').maybeSingle();
    paymentId = inserted?.id ?? null;
  }

  // One transaction: purchased credits, the activation bonus if this customer
  // has never had one, both lots, both ledger rows.
  const { data: result, error } = await sb.rpc('wallet_topup_with_promo', {
    p_user_id: userId,
    p_amount_cents: paidCents,
    p_payment_id: paymentId,
    p_payment_reference: providerCheckoutId,
    p_payment_fingerprint: fingerprint,
  });
  if (error) throw new Error(`wallet_topup_with_promo failed: ${error.message}`);

  const purchased = Number(result?.credits_purchased ?? 0);
  const bonus = Number(result?.credits_bonus ?? 0);
  const wasDuplicate = !!result?.duplicate;

  const invoiceRef = await provider.createInvoiceReference(providerCheckoutId).catch(() => null);

  await sb.from('payments').update({
    status: 'COMPLETED',
    webhook_verified: !!signature,
    provider_id: providerCheckoutId,
    provider_event_id: eventId ?? null,
    credits_issued: purchased + bonus,
    metadata: {
      checkout_id: providerCheckoutId, kind: 'TOPUP',
      credits_purchased: purchased, credits_bonus: bonus,
      instrument_fingerprint_present: !!fingerprint,
    },
    ...(invoiceRef ? {
      invoice_id: invoiceRef.invoiceId,
      invoice_url: invoiceRef.invoiceUrl,
      receipt_url: invoiceRef.receiptUrl,
    } : {}),
  }).eq('id', paymentId);

  if (!wasDuplicate) {
    await notify(sb, userId, 'CREDITS_TOPPED_UP',
      `${purchased + bonus} Credits added`,
      bonus > 0
        ? `${purchased} Credits purchased plus ${bonus} bonus Credits. Your balance is now ${Number(result?.balance_after ?? 0)} Credits.`
        : `Your balance is now ${Number(result?.balance_after ?? 0)} Credits.`,
      { credits_purchased: purchased, credits_bonus: bonus, new_balance: result?.balance_after });

    // A campaign parked for lack of funds can run again.
    await sb.from('matching_campaigns')
      .update({ status_v2: 'ACTIVE' }).eq('user_id', userId).eq('status_v2', 'LOW_BALANCE');
  }

  return {
    received: true, processed: !wasDuplicate, duplicate: wasDuplicate,
    userId, creditsPurchased: purchased, creditsBonus: bonus,
    newBalance: result?.balance_after,
  };
}

// ── Subscriptions ────────────────────────────────────────────

async function handleSubscriptionStart(
  sb: any, provider: any, session: any, metadata: any, eventId: string | undefined,
) {
  const userId: string = metadata.user_id;
  const planCode: string = metadata.plan_code;
  if (!userId || !planCode) return { error: 'Missing user_id or plan_code in subscription metadata' };

  const subscriptionId = session.subscription ?? session.id;
  const periodStart = session.current_period_start ? new Date(session.current_period_start * 1000) : new Date();
  const periodEnd = session.current_period_end
    ? new Date(session.current_period_end * 1000)
    : new Date(periodStart.getTime() + 30 * 24 * 3600 * 1000);

  const { data, error } = await sb.rpc('subscription_apply_plan', {
    p_user_id: userId,
    p_plan_code: planCode,
    // Keyed to the provider event, so a redelivery is a no-op.
    p_idempotency_key: `sub_start:${eventId ?? subscriptionId}`,
    p_event_type: 'CREATED',
    p_period_start: periodStart.toISOString(),
    p_period_end: periodEnd.toISOString(),
    p_provider: provider.name,
    p_provider_subscription_id: subscriptionId,
    p_payload: { source: 'checkout.session.completed' },
  });
  if (error) throw new Error(`subscription_apply_plan failed: ${error.message}`);

  if (!data?.duplicate) {
    await notify(sb, userId, 'SUBSCRIPTION_ACTIVATED',
      `${planCode} is active`,
      Number(data?.credits_granted ?? 0) > 0
        ? `${data.credits_granted} membership Credits have been added to your balance.`
        : 'Your membership is now active.',
      { plan_code: planCode, credits_granted: data?.credits_granted });
  }
  return { received: true, processed: !data?.duplicate, kind: 'SUBSCRIPTION_START', ...data };
}

async function handleSubscriptionRenewal(sb: any, invoice: any, eventId: string | undefined) {
  // The first invoice arrives with the checkout and is already handled by
  // handleSubscriptionStart. Acting on it here too would be a second grant
  // attempt — harmless, because the lot's source_ref is the same, but noisy.
  if (invoice.billing_reason && invoice.billing_reason !== 'subscription_cycle') {
    return { received: true, processed: false, reason: `billing_reason=${invoice.billing_reason}` };
  }

  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return { received: true, processed: false, reason: 'No subscription on invoice' };

  const { data: sub } = await sb
    .from('user_subscriptions').select('user_id, plan_code')
    .eq('provider_subscription_id', subscriptionId).maybeSingle();
  if (!sub) return { received: true, processed: false, reason: 'Unknown subscription' };

  const line = invoice.lines?.data?.[0]?.period;
  const periodStart = line?.start ? new Date(line.start * 1000) : new Date();
  const periodEnd = line?.end ? new Date(line.end * 1000)
                              : new Date(periodStart.getTime() + 30 * 24 * 3600 * 1000);

  const { data, error } = await sb.rpc('subscription_apply_plan', {
    p_user_id: sub.user_id,
    p_plan_code: sub.plan_code,
    p_idempotency_key: `sub_renew:${eventId ?? `${subscriptionId}:${periodStart.toISOString()}`}`,
    p_event_type: 'RENEWED',
    p_period_start: periodStart.toISOString(),
    p_period_end: periodEnd.toISOString(),
    p_provider_subscription_id: subscriptionId,
    p_payload: { source: 'invoice.paid', invoice_id: invoice.id },
  });
  if (error) throw new Error(`subscription renewal failed: ${error.message}`);

  if (Number(data?.credits_granted ?? 0) > 0) {
    await notify(sb, sub.user_id, 'SUBSCRIPTION_RENEWED',
      `${data.credits_granted} membership Credits added`,
      'Your membership renewed and this cycle’s Credits are in your balance.',
      { plan_code: sub.plan_code, credits_granted: data.credits_granted });
  }
  return { received: true, processed: !data?.duplicate, kind: 'SUBSCRIPTION_RENEWAL', ...data };
}

async function handleSubscriptionEnded(sb: any, subscription: any, eventId: string | undefined) {
  const { data: sub } = await sb
    .from('user_subscriptions').select('user_id, plan_code')
    .eq('provider_subscription_id', subscription.id).maybeSingle();
  if (!sub) return { received: true, processed: false, reason: 'Unknown subscription' };

  // Back to FREE. The wallet is untouched: purchased credits stay, and
  // membership credits already granted keep their own expiry.
  const { data, error } = await sb.rpc('subscription_apply_plan', {
    p_user_id: sub.user_id,
    p_plan_code: 'FREE',
    p_idempotency_key: `sub_end:${eventId ?? subscription.id}`,
    p_event_type: 'CANCELLED',
    p_payload: { source: 'customer.subscription.deleted' },
  });
  if (error) throw new Error(`subscription cancellation failed: ${error.message}`);

  if (!data?.duplicate) {
    await notify(sb, sub.user_id, 'SUBSCRIPTION_ENDED',
      'Your membership has ended',
      'Your Credits stay in your balance and pay as you go continues to work.',
      { previous_plan: sub.plan_code });
  }
  return { received: true, processed: !data?.duplicate, kind: 'SUBSCRIPTION_ENDED', ...data };
}

async function handleSubscriptionStatus(
  sb: any, subscription: any, eventType: string, eventId: string | undefined,
) {
  const { data: sub } = await sb
    .from('user_subscriptions').select('id, user_id, status')
    .eq('provider_subscription_id', subscription.id ?? subscription.subscription).maybeSingle();
  if (!sub) return { received: true, processed: false, reason: 'Unknown subscription' };

  // PAST_DUE keeps the plan's entitlements alive through the provider's
  // dunning window. It does NOT grant credits — only invoice.paid does that.
  const status = eventType === 'invoice.payment_failed'
    ? 'PAST_DUE'
    : (subscription.cancel_at_period_end ? sub.status : sub.status);

  await sb.from('user_subscriptions').update({
    status,
    cancel_at_period_end: !!subscription.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  }).eq('id', sub.id);

  return { received: true, processed: true, kind: 'SUBSCRIPTION_STATUS', status, eventId };
}

// ── helpers ──────────────────────────────────────────────────

async function notify(sb: any, userId: string, type: string, title: string, body: string, metadata: unknown) {
  await sb.from('notifications').insert({ user_id: userId, type, title, body, metadata });
  await sb.from('activity_events').insert({ user_id: userId, event_type: type, metadata });
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
