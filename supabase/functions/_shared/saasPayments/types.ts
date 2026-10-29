/*
 * PROVIDER-INDEPENDENT CHECKOUT (subscriptions, owner decision 2026-10-29).
 *
 * Every payment provider is one adapter behind this interface. The rest of HOMATCH sees only
 * NormalisedPaymentEvent, and access is granted ONLY by saas_payment_event_apply() after
 * verifyWebhook() proved the event came from the provider. A browser redirect back to HOMATCH
 * never grants anything: the confirming page polls the server, which waits for the event (or, for
 * providers that support it, asks lookupTransaction()).
 *
 * Amounts are GEL tetri (1 GEL = 100 tetri), integers, VAT inclusive.
 * The legacy Stripe/mock top-up code (_shared/payment_provider.ts) is untouched: it serves the
 * history of credit top-ups, not subscriptions.
 */

export type ProviderId = 'SANDBOX' | 'BOG' | 'TBC';
export type PaymentEventType = 'PAYMENT_SUCCEEDED' | 'PAYMENT_FAILED' | 'REFUNDED' | 'OTHER';

export interface NormalisedPaymentEvent {
  provider: ProviderId;
  /** The provider's own unique id for this event. (provider, eventId) is the idempotency key. */
  eventId: string;
  type: PaymentEventType;
  amountTetri: number | null;
  currency: string | null;
  /** Our checkout id, round-tripped through the provider. */
  reference: string | null;
  /** The provider's recurring agreement id, when it has one. */
  subscriptionRef: string | null;
  /** Short, non-sensitive facts for the admin log (never card data, never the raw body). */
  summary?: Record<string, string | number | boolean | null>;
}

export interface ProviderCapabilities {
  configured: boolean;
  recurring: boolean;
  refunds: boolean;
  lookup: boolean;
  /** True for test adapters. The UI labels every screen of a test provider. */
  test: boolean;
  /** Edge secret NAMES that are absent (never their values). Empty when configured. */
  missingSecrets?: string[];
}

export interface CreateSessionInput {
  checkoutId: string;
  amountTetri: number;
  currency: 'GEL';
  planCode: string;
  description: string;
  customerEmail?: string | null;
  /** Where the provider sends the customer back. It only shows "confirming"; it grants nothing. */
  returnUrl: string;
  cancelUrl: string;
  /** The customer consented to automatic monthly renewal from a saved card. */
  saveCard?: boolean;
}

export interface RecurringChargeInput {
  /** BOG: the parent order id the card was saved under. TBC: the saved card's recId. */
  subscriptionRef: string;
  /** Our new RENEWAL checkout id (idempotency + external reference). */
  checkoutId: string;
  amountTetri: number;
}

export type RecurringChargeResult =
  | { ok: true; sessionRef: string; event: NormalisedPaymentEvent | null }
  | { ok: false; reason: 'NOT_CONFIGURED' | 'UNSUPPORTED' | 'PROVIDER_ERROR' };

export type ConnectivityResult =
  | { ok: true; detail: string }
  | { ok: false; reason: 'NOT_CONFIGURED' | 'UNSUPPORTED' | 'PROVIDER_ERROR'; detail?: string };

export type CreateSessionResult =
  | { ok: true; sessionRef: string; redirectUrl: string }
  | { ok: false; reason: 'NOT_CONFIGURED' | 'DISABLED' | 'PROVIDER_ERROR'; message?: string };

export type VerifyResult =
  | { ok: true; event: NormalisedPaymentEvent }
  | { ok: false; reason: 'NOT_CONFIGURED' | 'BAD_SIGNATURE' | 'BAD_PAYLOAD' | 'DISABLED' };

export type LookupResult =
  | { ok: true; event: NormalisedPaymentEvent | null }
  | { ok: false; reason: 'NOT_CONFIGURED' | 'UNSUPPORTED' | 'PROVIDER_ERROR' };

export type RefundResult =
  | { ok: true; refundRef: string }
  | { ok: false; reason: 'NOT_CONFIGURED' | 'UNSUPPORTED' | 'PROVIDER_ERROR' };

export interface PaymentProviderAdapter {
  readonly id: ProviderId;
  capabilities(): ProviderCapabilities;
  createSession(input: CreateSessionInput): Promise<CreateSessionResult>;
  verifyWebhook(rawBody: string, headers: Headers): Promise<VerifyResult>;
  lookupTransaction(sessionRef: string, checkoutId: string): Promise<LookupResult>;
  refund(sessionRef: string, amountTetri: number): Promise<RefundResult>;
  /** Merchant-initiated renewal from a saved card, where the provider supports it. */
  chargeRecurring?(input: RecurringChargeInput): Promise<RecurringChargeResult>;
  /** Obtain a token / ping the provider WITHOUT charging anything. Admin only. */
  testConnectivity(): Promise<ConnectivityResult>;
}

/** Reads an env var under Deno; undefined under Node tests. */
export function env(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  try { return deno?.env.get(name) ?? undefined; } catch { return undefined; }
}

export function isPositiveTetri(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 10_000_000;
}
