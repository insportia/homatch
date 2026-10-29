/*
 * BANK OF GEORGIA and TBC — live subscription payment adapters (GEL).
 *
 * Each adapter is ACTIVE only when every one of its secrets exists as an edge secret; otherwise it
 * answers NOT_CONFIGURED to everything and capabilities().missingSecrets names what is absent.
 * Customers are sent to a bank only when the admin also selected it as the live provider
 * (admin_settings.saas_default_payment_provider, saas-checkout liveProvider()).
 *
 * Neither adapter trusts a browser redirect. BOG callbacks are verified with the bank's RSA public
 * key (SHA256withRSA over the raw body). TBC callbacks carry only a payment id and no signature, so
 * the adapter re-reads the payment from TBC's API (authenticated with our credentials) and uses
 * THAT answer; the callback body is never trusted for status or amount.
 *
 * Amounts: the banks take decimal GEL; HOMATCH keeps integer tetri. toGel()/toTetri() convert.
 */
import type {
  ConnectivityResult, CreateSessionInput, CreateSessionResult, LookupResult, NormalisedPaymentEvent, PaymentEventType, PaymentProviderAdapter,
  ProviderCapabilities, RecurringChargeInput, RecurringChargeResult, RefundResult, VerifyResult,
} from './types.ts';

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string>;
}>;
type SecretGetter = (name: string) => string | undefined;

export const BOG_SECRET_NAMES = ['BOG_CLIENT_ID', 'BOG_CLIENT_SECRET', 'BOG_CALLBACK_PUBLIC_KEY'] as const;
export const TBC_SECRET_NAMES = ['TBC_API_KEY', 'TBC_CLIENT_ID', 'TBC_CLIENT_SECRET'] as const;

export function toGel(tetri: number): number { return Math.round(tetri) / 100; }
export function toTetri(gel: unknown): number | null {
  const n = typeof gel === 'string' ? Number(gel) : typeof gel === 'number' ? gel : Number.NaN;
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function missing(names: readonly string[], get: SecretGetter): string[] {
  return names.filter((k) => !get(k));
}

const enc = new TextEncoder();

function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s+/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** SHA256withRSA (RSASSA-PKCS1-v1_5) over the exact raw body; signature is base64. */
export async function verifyRsaSha256(publicKeyPem: string, rawBody: string, signatureB64: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('spki', pemToDer(publicKeyPem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64ToBytes(signatureB64), enc.encode(rawBody));
  } catch {
    return false;
  }
}

/** A bearer token cached for the life of the isolate, refreshed a minute before it lapses. */
class TokenCache {
  private token: string | null = null;
  private until = 0;
  async get(fetcher: () => Promise<{ token: string; ttlSeconds: number } | null>): Promise<string | null> {
    if (this.token && Date.now() < this.until) return this.token;
    const t = await fetcher();
    if (!t) return null;
    this.token = t.token;
    // BOG's docs describe expires_in as seconds but show a millisecond-looking sample: cap at 1 hour either way.
    const ttl = t.ttlSeconds > 0 && t.ttlSeconds < 86_400 ? t.ttlSeconds : 3600;
    this.until = Date.now() + Math.max(ttl - 60, 30) * 1000;
    return this.token;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * BANK OF GEORGIA — Online Payments API
 *   auth      https://api.bog.ge/docs/en/payments/authentication
 *   order     https://api.bog.ge/docs/en/payments/standard-process/create-order
 *   callback  https://api.bog.ge/docs/en/payments/standard-process/callback
 *   details   https://api.bog.ge/docs/en/payments/standard-process/get-payment-details
 *   refund    https://api.bog.ge/docs/en/payments/refund
 *   save card https://api.bog.ge/docs/en/payments/saved-card/offline
 *   charge    https://api.bog.ge/docs/en/payments/saved-card/offline-payment
 * ══════════════════════════════════════════════════════════════════════════ */

export const BOG = {
  token: 'https://oauth2.bog.ge/auth/realms/bog/protocol/openid-connect/token',
  orders: 'https://api.bog.ge/payments/v1/ecommerce/orders',
  receipt: (id: string) => `https://api.bog.ge/payments/v1/receipt/${encodeURIComponent(id)}`,
  refund: (id: string) => `https://api.bog.ge/payments/v1/payment/refund/${encodeURIComponent(id)}`,
  saveCard: (id: string) => `https://api.bog.ge/payments/v1/orders/${encodeURIComponent(id)}/subscriptions`,
  charge: (parent: string) => `https://api.bog.ge/payments/v1/ecommerce/orders/${encodeURIComponent(parent)}/subscribe`,
} as const;

/** order_status.key -> our event type. Only `completed` is money received. */
export function bogEventType(statusKey: unknown): PaymentEventType {
  switch (String(statusKey ?? '')) {
    case 'completed': return 'PAYMENT_SUCCEEDED';
    case 'rejected': return 'PAYMENT_FAILED';
    case 'refunded': case 'refunded_partially': return 'REFUNDED';
    default: return 'OTHER'; // created, processing, refund_requested, auth_requested, blocked, partial_completed
  }
}

/** The receipt / callback body -> normalised event. reference = external_order_id = our checkout id. */
export function bogEventFromReceipt(b: Record<string, any>): NormalisedPaymentEvent | null {
  const orderId = typeof b?.order_id === 'string' ? b.order_id : null;
  if (!orderId) return null;
  const status = String(b?.order_status?.key ?? '');
  const pu = b?.purchase_units ?? {};
  const amount = toTetri(pu.transfer_amount ?? pu.request_amount);
  const parent = b?.payment_detail?.parent_order_id;
  const saved = b?.payment_detail?.saved_card_type;
  return {
    provider: 'BOG',
    eventId: `${orderId}:${status}`,
    type: bogEventType(status),
    amountTetri: amount,
    currency: typeof pu.currency_code === 'string' ? pu.currency_code.toUpperCase() : null,
    reference: typeof b?.external_order_id === 'string' && b.external_order_id ? b.external_order_id : orderId,
    // A renewal order names its parent; a first order whose card was saved is its own parent.
    subscriptionRef: typeof parent === 'string' && parent ? parent : saved ? orderId : null,
    summary: { status, orderId, reason: typeof b?.reject_reason === 'string' ? b.reject_reason : null },
  };
}

export class BankOfGeorgiaAdapter implements PaymentProviderAdapter {
  readonly id = 'BOG' as const;
  private readonly get: SecretGetter;
  private readonly fetcher: FetchLike;
  private readonly callbackUrl: string;
  private readonly tokens = new TokenCache();
  constructor(get: SecretGetter, fetcher: FetchLike, callbackUrl: string) {
    this.get = get;
    this.fetcher = fetcher;
    this.callbackUrl = callbackUrl;
  }

  capabilities(): ProviderCapabilities {
    const m = missing(BOG_SECRET_NAMES, this.get);
    return { configured: m.length === 0, recurring: m.length === 0, refunds: m.length === 0, lookup: m.length === 0, test: false, missingSecrets: m };
  }

  private async token(): Promise<string | null> {
    return this.tokens.get(async () => {
      const basic = btoa(`${this.get('BOG_CLIENT_ID')}:${this.get('BOG_CLIENT_SECRET')}`);
      const r = await this.fetcher(BOG.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
        body: 'grant_type=client_credentials',
      });
      if (!r.ok) return null;
      const j = (await r.json()) as { access_token?: string; expires_in?: number };
      return j.access_token ? { token: j.access_token, ttlSeconds: Number(j.expires_in ?? 0) } : null;
    });
  }

  /** The create-order request, built from the checkout only. Exported shape for tests. */
  buildOrder(input: CreateSessionInput): Record<string, unknown> {
    const gel = toGel(input.amountTetri);
    return {
      callback_url: this.callbackUrl,
      external_order_id: input.checkoutId,
      capture: 'automatic',
      ttl: 60,
      payment_method: ['card', 'google_pay', 'apple_pay'],
      purchase_units: {
        currency: 'GEL',
        total_amount: gel,
        basket: [{ product_id: input.planCode, description: input.description, quantity: 1, unit_price: gel }],
      },
      redirect_urls: { success: input.returnUrl, fail: input.cancelUrl },
    };
  }

  async createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
    if (!this.capabilities().configured) return { ok: false, reason: 'NOT_CONFIGURED' };
    const token = await this.token();
    if (!token) return { ok: false, reason: 'PROVIDER_ERROR', message: 'token' };
    const r = await this.fetcher(BOG.orders, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': input.checkoutId, 'Accept-Language': 'ka' },
      body: JSON.stringify(this.buildOrder(input)),
    });
    if (!r.ok) return { ok: false, reason: 'PROVIDER_ERROR', message: `create ${r.status}` };
    const j = (await r.json()) as { id?: string; _links?: { redirect?: { href?: string } } };
    if (!j.id || !j._links?.redirect?.href) return { ok: false, reason: 'PROVIDER_ERROR', message: 'no redirect' };
    if (input.saveCard) {
      // Saved card for automatic renewals: requested BEFORE the customer is redirected (BOG docs).
      const s = await this.fetcher(BOG.saveCard(j.id), { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() } });
      if (!s.ok) console.error('[bog] save card request refused', s.status);
    }
    return { ok: true, sessionRef: j.id, redirectUrl: j._links.redirect.href };
  }

  async verifyWebhook(rawBody: string, headers: Headers): Promise<VerifyResult> {
    if (!this.capabilities().configured) return { ok: false, reason: 'NOT_CONFIGURED' };
    const sig = headers.get('Callback-Signature') ?? '';
    // Verified on the RAW body before parsing, so field order is preserved (BOG docs).
    if (!sig || !(await verifyRsaSha256(this.get('BOG_CALLBACK_PUBLIC_KEY')!, rawBody, sig))) return { ok: false, reason: 'BAD_SIGNATURE' };
    let b: Record<string, any>;
    try { b = JSON.parse(rawBody); } catch { return { ok: false, reason: 'BAD_PAYLOAD' }; }
    if (b?.event !== 'order_payment') return { ok: false, reason: 'BAD_PAYLOAD' };
    const claimed = bogEventFromReceipt(b.body ?? {});
    if (!claimed) return { ok: false, reason: 'BAD_PAYLOAD' };
    // Signed, and still re-queried: the bank's receipt, read now with our credentials, is what counts.
    const confirmed = await this.lookupTransaction(String(b.body.order_id));
    if (!confirmed.ok) return { ok: false, reason: 'BAD_PAYLOAD' };
    // Not final yet (processing, ...): recorded as OTHER; the reconciliation job re-checks it.
    return { ok: true, event: confirmed.event ?? { ...claimed, type: 'OTHER' } };
  }

  async lookupTransaction(sessionRef: string): Promise<LookupResult> {
    if (!this.capabilities().configured) return { ok: false, reason: 'NOT_CONFIGURED' };
    const token = await this.token();
    if (!token) return { ok: false, reason: 'PROVIDER_ERROR' };
    const r = await this.fetcher(BOG.receipt(sessionRef), { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return { ok: false, reason: 'PROVIDER_ERROR' };
    const e = bogEventFromReceipt((await r.json()) as Record<string, any>);
    return { ok: true, event: e && e.type !== 'OTHER' ? e : null };
  }

  async refund(sessionRef: string, amountTetri: number): Promise<RefundResult> {
    if (!this.capabilities().configured) return { ok: false, reason: 'NOT_CONFIGURED' };
    const token = await this.token();
    if (!token) return { ok: false, reason: 'PROVIDER_ERROR' };
    const r = await this.fetcher(BOG.refund(sessionRef), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ amount: toGel(amountTetri) }),
    });
    if (!r.ok) return { ok: false, reason: 'PROVIDER_ERROR' };
    const j = (await r.json()) as { action_id?: string };
    return { ok: true, refundRef: j.action_id ?? sessionRef };
  }

  async testConnectivity(): Promise<ConnectivityResult> {
    const m = this.capabilities().missingSecrets ?? [];
    if (m.length) return { ok: false, reason: 'NOT_CONFIGURED', detail: m.join(', ') };
    const t = await this.token();
    if (!t) return { ok: false, reason: 'PROVIDER_ERROR', detail: 'token request refused (check BOG_CLIENT_ID / BOG_CLIENT_SECRET)' };
    try {
      await crypto.subtle.importKey('spki', pemToDer(this.get('BOG_CALLBACK_PUBLIC_KEY')!), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    } catch {
      return { ok: false, reason: 'PROVIDER_ERROR', detail: 'BOG_CALLBACK_PUBLIC_KEY is not a valid PEM public key' };
    }
    return { ok: true, detail: 'OAuth token obtained; callback public key parsed. Nothing was charged.' };
  }

  /** Automatic renewal from the saved card: amount and currency come from the parent order. */
  async chargeRecurring(input: RecurringChargeInput): Promise<RecurringChargeResult> {
    if (!this.capabilities().configured) return { ok: false, reason: 'NOT_CONFIGURED' };
    const token = await this.token();
    if (!token) return { ok: false, reason: 'PROVIDER_ERROR' };
    const r = await this.fetcher(BOG.charge(input.subscriptionRef), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': input.checkoutId },
      body: JSON.stringify({ callback_url: this.callbackUrl, external_order_id: input.checkoutId }),
    });
    if (!r.ok) return { ok: false, reason: 'PROVIDER_ERROR' };
    const j = (await r.json()) as { id?: string };
    // The outcome arrives by signed callback (or lookup); nothing is granted from this response.
    return j.id ? { ok: true, sessionRef: j.id, event: null } : { ok: false, reason: 'PROVIDER_ERROR' };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * TBC — TBC Checkout (tpay) API
 *   token     https://developers.tbcbank.ge/docs/checkout-get-checkout-access-token
 *   create    https://developers.tbcbank.ge/docs/checkout-create-checkout-payment
 *   details   https://developers.tbcbank.ge/docs/checkout-get-checkout-payment-details
 *   cancel    https://developers.tbcbank.ge/docs/checkout-cancel-checkout-payment
 *   recurring https://developers.tbcbank.ge/docs/checkout-execute-recurring-payment
 *   callback  https://developers.tbcbank.ge/docs/e-commerce-faq  (payment id POSTed on a final state)
 * ══════════════════════════════════════════════════════════════════════════ */

export const TBC = {
  token: 'https://api.tbcbank.ge/v1/tpay/access-token',
  payments: 'https://api.tbcbank.ge/v1/tpay/payments',
  payment: (id: string) => `https://api.tbcbank.ge/v1/tpay/payments/${encodeURIComponent(id)}`,
  cancel: (id: string) => `https://api.tbcbank.ge/v1/tpay/payments/${encodeURIComponent(id)}/cancel`,
  execution: 'https://api.tbcbank.ge/v1/tpay/payments/execution',
} as const;

/** tpay status -> our event type. Only Succeeded is money received. */
export function tbcEventType(status: unknown): PaymentEventType {
  switch (String(status ?? '')) {
    case 'Succeeded': return 'PAYMENT_SUCCEEDED';
    case 'Failed': case 'Expired': return 'PAYMENT_FAILED';
    case 'Returned': case 'PartialReturned': return 'REFUNDED';
    default: return 'OTHER'; // Created, Processing, WaitingConfirm, CancelPaymentProcessing, PaymentCompletionProcessing
  }
}

/** A Get Payment answer -> normalised event. reference = payId (saas_checkouts.provider_session_ref). */
export function tbcEventFromPayment(p: Record<string, any>): NormalisedPaymentEvent | null {
  const payId = typeof p?.payId === 'string' ? p.payId : null;
  if (!payId) return null;
  const status = String(p?.status ?? '');
  const rec = p?.recurringCard?.recId;
  return {
    provider: 'TBC',
    eventId: `${payId}:${status}`,
    type: tbcEventType(status),
    amountTetri: toTetri(p?.amount),
    currency: typeof p?.currency === 'string' ? p.currency.toUpperCase() : null,
    reference: payId,
    subscriptionRef: typeof rec === 'string' && rec ? rec : null,
    summary: { status, payId, resultCode: typeof p?.resultCode === 'string' ? p.resultCode : null },
  };
}

export class TbcAdapter implements PaymentProviderAdapter {
  readonly id = 'TBC' as const;
  private readonly get: SecretGetter;
  private readonly fetcher: FetchLike;
  private readonly callbackUrl: string;
  private readonly tokens = new TokenCache();
  constructor(get: SecretGetter, fetcher: FetchLike, callbackUrl: string) {
    this.get = get;
    this.fetcher = fetcher;
    this.callbackUrl = callbackUrl;
  }

  capabilities(): ProviderCapabilities {
    const m = missing(TBC_SECRET_NAMES, this.get);
    return { configured: m.length === 0, recurring: m.length === 0, refunds: m.length === 0, lookup: m.length === 0, test: false, missingSecrets: m };
  }

  private async token(): Promise<string | null> {
    return this.tokens.get(async () => {
      const form = new URLSearchParams({ client_id: this.get('TBC_CLIENT_ID')!, client_secret: this.get('TBC_CLIENT_SECRET')! });
      const r = await this.fetcher(TBC.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', apikey: this.get('TBC_API_KEY')! },
        body: form.toString(),
      });
      if (!r.ok) return null;
      const j = (await r.json()) as { access_token?: string; expires_in?: number };
      return j.access_token ? { token: j.access_token, ttlSeconds: Number(j.expires_in ?? 0) } : null;
    });
  }

  private async headers(): Promise<Record<string, string> | null> {
    const token = await this.token();
    return token ? { 'Content-Type': 'application/json', apikey: this.get('TBC_API_KEY')!, Authorization: `Bearer ${token}` } : null;
  }

  /** The create-payment request, built from the checkout only. Exported shape for tests. */
  buildPayment(input: CreateSessionInput): Record<string, unknown> {
    return {
      amount: { currency: 'GEL', total: toGel(input.amountTetri), subTotal: 0, tax: 0, shipping: 0 },
      returnurl: input.returnUrl,
      callbackUrl: this.callbackUrl,
      expirationMinutes: 60,
      language: 'KA',
      merchantPaymentId: input.checkoutId,
      description: input.description.slice(0, 30),
      preAuth: false,
      ...(input.saveCard ? { saveCard: true } : {}),
    };
  }

  async createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
    if (!this.capabilities().configured) return { ok: false, reason: 'NOT_CONFIGURED' };
    const h = await this.headers();
    if (!h) return { ok: false, reason: 'PROVIDER_ERROR', message: 'token' };
    const r = await this.fetcher(TBC.payments, { method: 'POST', headers: h, body: JSON.stringify(this.buildPayment(input)) });
    if (!r.ok) return { ok: false, reason: 'PROVIDER_ERROR', message: `create ${r.status}` };
    const j = (await r.json()) as { payId?: string; links?: Array<{ uri?: string; rel?: string }> };
    const approval = (j.links ?? []).find((l) => l.rel === 'approval_url')?.uri;
    if (!j.payId || !approval) return { ok: false, reason: 'PROVIDER_ERROR', message: 'no approval_url' };
    return { ok: true, sessionRef: j.payId, redirectUrl: approval };
  }

  /** The callback names a payment; its status and amount are re-read from TBC, never taken from the body. */
  async verifyWebhook(rawBody: string): Promise<VerifyResult> {
    if (!this.capabilities().configured) return { ok: false, reason: 'NOT_CONFIGURED' };
    let payId = '';
    try {
      const b = JSON.parse(rawBody) as Record<string, unknown>;
      payId = String(b.PaymentId ?? b.paymentId ?? b.payId ?? '');
    } catch {
      payId = new URLSearchParams(rawBody).get('PaymentId') ?? '';
    }
    if (!/^[A-Za-z0-9_-]{4,80}$/.test(payId)) return { ok: false, reason: 'BAD_PAYLOAD' };
    const looked = await this.lookupTransaction(payId);
    if (!looked.ok || !looked.event) return { ok: false, reason: 'BAD_PAYLOAD' };
    return { ok: true, event: looked.event };
  }

  async lookupTransaction(sessionRef: string): Promise<LookupResult> {
    if (!this.capabilities().configured) return { ok: false, reason: 'NOT_CONFIGURED' };
    const h = await this.headers();
    if (!h) return { ok: false, reason: 'PROVIDER_ERROR' };
    const r = await this.fetcher(TBC.payment(sessionRef), { method: 'GET', headers: h });
    if (!r.ok) return { ok: false, reason: 'PROVIDER_ERROR' };
    const e = tbcEventFromPayment((await r.json()) as Record<string, any>);
    return { ok: true, event: e && e.type !== 'OTHER' ? e : null };
  }

  async refund(sessionRef: string, amountTetri: number): Promise<RefundResult> {
    if (!this.capabilities().configured) return { ok: false, reason: 'NOT_CONFIGURED' };
    const h = await this.headers();
    if (!h) return { ok: false, reason: 'PROVIDER_ERROR' };
    const r = await this.fetcher(TBC.cancel(sessionRef), { method: 'POST', headers: h, body: JSON.stringify({ amount: toGel(amountTetri) }) });
    return r.ok ? { ok: true, refundRef: sessionRef } : { ok: false, reason: 'PROVIDER_ERROR' };
  }

  async testConnectivity(): Promise<ConnectivityResult> {
    const m = this.capabilities().missingSecrets ?? [];
    if (m.length) return { ok: false, reason: 'NOT_CONFIGURED', detail: m.join(', ') };
    const t = await this.token();
    return t ? { ok: true, detail: 'Access token obtained. Nothing was charged.' }
      : { ok: false, reason: 'PROVIDER_ERROR', detail: 'token request refused (check TBC_API_KEY / TBC_CLIENT_ID / TBC_CLIENT_SECRET)' };
  }

  /** Merchant-initiated renewal from the saved card (recId). The answer is TBC's own, read over our authenticated call. */
  async chargeRecurring(input: RecurringChargeInput): Promise<RecurringChargeResult> {
    if (!this.capabilities().configured) return { ok: false, reason: 'NOT_CONFIGURED' };
    const h = await this.headers();
    if (!h) return { ok: false, reason: 'PROVIDER_ERROR' };
    const r = await this.fetcher(TBC.execution, {
      method: 'POST', headers: h,
      body: JSON.stringify({ recId: input.subscriptionRef, money: { amount: toGel(input.amountTetri), currency: 'GEL' }, initiator: 'merchant', preAuth: false, merchantPaymentId: input.checkoutId }),
    });
    if (!r.ok) return { ok: false, reason: 'PROVIDER_ERROR' };
    const e = tbcEventFromPayment((await r.json()) as Record<string, any>);
    if (!e) return { ok: false, reason: 'PROVIDER_ERROR' };
    return { ok: true, sessionRef: e.reference ?? '', event: e.type === 'OTHER' ? null : { ...e, subscriptionRef: e.subscriptionRef ?? input.subscriptionRef } };
  }
}
