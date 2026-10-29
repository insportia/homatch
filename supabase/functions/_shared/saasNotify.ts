/*
 * Subscription notices. SQL writes them to the saas_subscription_events outbox (notify_type set);
 * jobs-worker claims them (saas_claim_notifications, at most once) and emits each through notify(),
 * so in-app, push and the transactional email leg (owned by the notifications workstream) all see
 * the same typed event. metadata.kind carries the type for templates; the title is the in-app
 * fallback text.
 */
import type { NotifyInput } from './notify.ts';

export interface SaasOutboxRow {
  id: string;
  user_id: string;
  notify_type: string;
  event_type: string;
  plan_code: string | null;
  payload: Record<string, unknown> | null;
}

const COPY: Record<string, { title: string; body: string; priority: NotifyInput['priority']; deepLink: string }> = {
  SUBSCRIPTION_ACTIVATED: { title: 'Your HOMATCH plan is active', body: 'Your subscription is active. Your allowances are ready to use.', priority: 'HIGH', deepLink: '/account/subscription' },
  SUBSCRIPTION_RENEWED: { title: 'Your HOMATCH plan was renewed', body: 'A new billing period has started and your allowances were reset.', priority: 'NORMAL', deepLink: '/account/subscription' },
  SUBSCRIPTION_ENDED: { title: 'Your HOMATCH plan has ended', body: 'Your subscription ended. You can choose a plan again at any time.', priority: 'HIGH', deepLink: '/pricing' },
  SUBSCRIPTION_PAYMENT_DUE: { title: 'Pay for your next month', body: 'Your billing period ended. Pay for the next month to keep your plan.', priority: 'HIGH', deepLink: '/account/subscription' },
  PAYMENT_FAILED: { title: 'Your payment did not go through', body: 'The payment for your HOMATCH plan failed. Nothing was charged for access you do not have.', priority: 'HIGH', deepLink: '/account/subscription' },
  TRIAL_USED: { title: 'You used your free first try', body: 'Your first one was free. Choose a plan to keep going.', priority: 'LOW', deepLink: '/pricing' },
};

export function subscriptionNotice(row: SaasOutboxRow): NotifyInput | null {
  const c = COPY[row.notify_type];
  if (!c) return null;
  return {
    userId: row.user_id,
    type: row.notify_type,
    title: c.title,
    body: c.body,
    priority: c.priority,
    deepLink: c.deepLink,
    entityType: 'saas_subscription_event',
    entityId: row.id,
    dedupeKey: `saas:${row.id}`,
    metadata: { kind: row.notify_type, event: row.event_type, plan: row.plan_code, ...(row.payload ?? {}) },
  };
}
