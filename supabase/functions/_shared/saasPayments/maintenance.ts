/*
 * Periodic payment work, run by jobs-worker:
 *
 *   reconcilePending   checkouts still PENDING at a bank are re-read from the bank's API
 *                      (lookupTransaction) and the bank's answer goes through the same idempotent
 *                      apply as a callback. A lost callback therefore never loses a payment.
 *   chargeRecurringDue subscriptions with a saved card (customer consent) due within a day get ONE
 *                      renewal charge per period. BOG confirms by signed callback / reconciliation;
 *                      TBC answers on our authenticated call. Nothing is granted on a request alone.
 *
 * Logs carry ids and statuses only: never a secret, token, card number or raw provider body.
 */
import { adapterFor, applyPaymentEvent, isProviderId, type AdapterContext } from './index.ts';

interface Db {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export async function reconcilePending(sb: Db, ctx: AdapterContext, limit = 20): Promise<{ checked: number; applied: number }> {
  const { data } = await sb.rpc('saas_pending_checkouts', { p_limit: limit });
  let checked = 0, applied = 0;
  for (const row of (data ?? []) as Array<{ id: string; provider: string; provider_session_ref: string }>) {
    if (!isProviderId(row.provider)) continue;
    const adapter = adapterFor(row.provider, ctx);
    if (!adapter.capabilities().lookup) continue;
    checked++;
    const r = await adapter.lookupTransaction(row.provider_session_ref, row.id);
    if (r.ok && r.event) {
      const a = await applyPaymentEvent(sb, r.event);
      if (a.ok) applied++;
      else console.error('[saas-payments] reconcile apply failed', row.provider, row.id);
    }
  }
  return { checked, applied };
}

export async function chargeRecurringDue(sb: Db, ctx: AdapterContext, limit = 10): Promise<{ attempted: number; failed: number }> {
  const { data } = await sb.rpc('saas_recurring_due', { p_limit: limit });
  let attempted = 0, failed = 0;
  for (const s of (data ?? []) as Array<{ subscription_id: string; user_id: string; plan_code: string; provider: string; provider_subscription_ref: string }>) {
    if (!isProviderId(s.provider)) continue;
    const adapter = adapterFor(s.provider, ctx);
    if (!adapter.capabilities().recurring || !adapter.chargeRecurring) continue;
    // The renewal checkout is created first (price from the plan row); it is the one attempt this period.
    const { data: co } = await sb.rpc('saas_checkout_create', { p_user_id: s.user_id, p_plan_code: s.plan_code, p_provider: s.provider, p_auto_renew: true });
    const c = co as { ok?: boolean; checkoutId?: string; amountTetri?: number; reason?: string } | null;
    if (!c?.ok || !c.checkoutId || !c.amountTetri) continue;
    attempted++;
    const r = await adapter.chargeRecurring({ subscriptionRef: s.provider_subscription_ref, checkoutId: c.checkoutId, amountTetri: c.amountTetri });
    if (!r.ok) {
      failed++;
      console.error('[saas-payments] recurring charge refused', s.provider, c.checkoutId, r.reason);
      await sb.rpc('saas_payment_event_apply', {
        p_provider: s.provider, p_event_id: `recurring-refused:${c.checkoutId}`, p_type: 'PAYMENT_FAILED', p_amount_tetri: c.amountTetri,
        p_currency: 'GEL', p_reference: c.checkoutId, p_subscription_ref: s.provider_subscription_ref, p_summary: { reason: r.reason },
      });
      continue;
    }
    await sb.rpc('saas_checkout_attach', { p_checkout_id: c.checkoutId, p_provider_ref: r.sessionRef, p_redirect_url: null });
    if (r.event) await applyPaymentEvent(sb, { ...r.event, reference: c.checkoutId });
  }
  return { attempted, failed };
}
