// ============================================================
// HOMATCH — Payment provider abstraction (Master Prompt §10)
//
// The rest of the codebase must never hardcode "Stripe" — it talks
// to this interface only. StripePaymentProvider wraps the existing
// real (but SDK-free, raw-fetch) Stripe REST integration that
// already lived inline in credits-topup / payment-webhook. A future
// provider (local processor, alternative gateway) is a new class
// implementing the same interface — no caller changes.
//
// Never invent credentials. getPaymentProvider() falls back to a
// MockPaymentProvider — preserving the exact pre-existing dev/mock
// behavior — whenever PAYMENT_PROVIDER_SECRET is not configured.
// ============================================================

export interface CheckoutParams {
  amountCents: number; // VAT-inclusive total to charge, integer cents
  currency: string; // lowercase ISO code, e.g. 'usd'
  customerEmail?: string;
  productName: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}

export interface CheckoutResult {
  mock: boolean;
  checkoutUrl: string;
  providerCheckoutId: string;
}

export interface WebhookVerifyResult {
  valid: boolean;
  eventType?: string;
  eventId?: string;
  event?: any;
}

export type PaymentStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED';

export interface PaymentRecord {
  providerPaymentId: string;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  metadata: Record<string, string>;
}

export interface RefundResult {
  providerRefundId: string;
  amountCents: number;
  status: string;
}

export interface InvoiceReference {
  invoiceId: string | null;
  invoiceUrl: string | null;
  receiptUrl: string | null;
  // True only when the provider/tax setup actually issues a
  // legally valid tax invoice. Never claim this is true otherwise
  // (Master Prompt §13).
  supportsLegalInvoice: boolean;
}

// ── Subscriptions ──────────────────────────────────────────────
// A subscription is a recurring authorization, not a wallet top-up, and the
// two must not share a code path: buying VIP changes the plan and grants
// membership credits, while a top-up only adds purchased credits. Keeping
// them apart at the provider boundary is what stops one from ever being
// mistaken for the other downstream.
export interface SubscriptionCheckoutParams {
  planCode: string;
  planName: string;
  amountCentsPerMonth: number;
  currency: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}

export interface SubscriptionCheckoutResult {
  mock: boolean;
  checkoutUrl: string;
  providerCheckoutId: string;
}

// ── Capabilities ───────────────────────────────────────────────
//
// WHY THIS IS DECLARED IN CODE AND NOT IN A SETTINGS TABLE
//
// A capability is a fact about what an adapter can actually do. Putting it in
// admin_settings would let an operator tick "supports zero-amount setup" for a
// provider whose API has no such call, and the first person to find out would
// be a customer staring at a failed activation. The adapter declares what it
// can do; Admin READS it. Nothing writes it.
//
// `unknown` is a first-class value and is not a synonym for false. An adapter
// that has never been exercised against a live account should say so rather
// than claim a capability it has not demonstrated -- which is the whole
// difference between "we support this" and "we have not checked".
export type Capability = true | false | 'unknown';

export interface ProviderCapabilities {
  /** A one-off payment for a stated amount. */
  oneTimePayment: Capability;
  /**
   * Storing a reusable payment method with NO money captured. This is the one
   * the activation bonus depends on: if it is false, the $0 promise cannot be
   * kept and the offer must not be shown as "$0 charged now".
   */
  zeroAmountSetup: Capability;
  /** A stored method that can be charged again later, customer-initiated. */
  reusablePaymentMethod: Capability;
  /** A stable identifier for the instrument, for anti-abuse across accounts. */
  instrumentFingerprint: Capability;
  refunds: Capability;
  webhooks: Capability;
  /** True only where the provider issues a legally valid tax invoice. */
  legalInvoice: Capability;
  /** Provider transaction limits, in minor units. null = not published. */
  minAmountCents: number | null;
  maxAmountCents: number | null;
  currencies: string[];
  /**
   * Set when the adapter is a stand-in rather than a real integration. Admin
   * must render this prominently: a green tick next to a mock is a lie.
   */
  simulated: boolean;
  /** Free-text, shown to the operator. Say what is NOT proven. */
  notes: string;
}

export interface SetupParams {
  userId: string;
  customerEmail?: string;
  returnUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}

export interface SetupResult {
  mock: boolean;
  /** Where to send the customer to enter card details ON THE PROVIDER. */
  setupUrl: string;
  providerSetupId: string;
  /** How this provider proves reusability, so the record is honest. */
  setupMode: 'ZERO_AMOUNT_SETUP' | 'VERIFICATION_CHARGE' | 'FIRST_PAYMENT';
}

export interface StoredPaymentMethod {
  providerMethodRef: string;
  providerCustomerRef: string | null;
  instrumentFingerprint: string | null;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
}

export interface PaymentProvider {
  /**
   * What this adapter can actually do. Never inferred from the provider's
   * marketing, only from calls this adapter genuinely implements.
   */
  capabilities(): ProviderCapabilities;
  /**
   * Begin storing a reusable payment method. Throws SETUP_UNSUPPORTED when
   * capabilities().zeroAmountSetup is not true -- callers must check first and
   * must not present a "$0 charged now" promise they cannot keep.
   */
  createSetup(params: SetupParams): Promise<SetupResult>;
  /**
   * Read back the stored method after the provider says setup completed.
   * Returning null means "not stored", which must never be treated as success.
   */
  getStoredPaymentMethod(providerSetupId: string): Promise<StoredPaymentMethod | null>;
  readonly name: string;
  createCheckout(params: CheckoutParams): Promise<CheckoutResult>;
  createSubscriptionCheckout(params: SubscriptionCheckoutParams): Promise<SubscriptionCheckoutResult>;
  verifyWebhook(rawBody: string, signatureHeader: string | null): Promise<WebhookVerifyResult>;
  getPayment(providerPaymentId: string): Promise<PaymentRecord | null>;
  getPaymentStatus(providerPaymentId: string): Promise<PaymentStatus>;
  refundPayment(providerPaymentId: string, amountCents?: number): Promise<RefundResult>;
  createInvoiceReference(providerPaymentId: string): Promise<InvoiceReference>;
  /**
   * A stable identifier for the payment INSTRUMENT behind a completed
   * checkout — Stripe's payment_method fingerprint, which is the same string
   * for the same card however many accounts present it.
   *
   * This is what makes the once-per-customer activation bonus resistant to
   * someone signing up twice with the same card. Returning null is always
   * allowed and is not a failure: the per-user unique index still holds, and
   * inventing an identifier would be worse than admitting we have none.
   */
  getPaymentInstrumentFingerprint(providerPaymentId: string): Promise<string | null>;
}

// ── Stripe (real, SDK-free REST integration) ───────────────────
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe';
  constructor(private readonly secretKey: string, private readonly webhookSecret?: string) {}

  /*
   * Stripe genuinely supports all of this and this adapter genuinely
   * implements it: Checkout in `setup` mode stores a card without capturing
   * money, and card.fingerprint is stable for the same instrument across
   * customers, which is what makes the activation bonus resistant to the same
   * card on a second account.
   *
   * legalInvoice stays FALSE on purpose. Stripe Invoicing can emit a
   * document; whether that document satisfies Georgian statutory requirements
   * for an LLC is a question for an accountant, not for this file. Claiming
   * true here would be claiming a compliance nobody has verified.
   */
  capabilities(): ProviderCapabilities {
    return {
      oneTimePayment: true,
      zeroAmountSetup: true,
      reusablePaymentMethod: true,
      instrumentFingerprint: true,
      refunds: true,
      webhooks: true,
      legalInvoice: false,
      minAmountCents: 50,
      maxAmountCents: null,
      currencies: ['usd', 'eur'],
      simulated: false,
      notes:
        'Reference implementation, used to prove the architecture. Georgian statutory invoicing is NOT '
        + 'claimed and NOT implemented. GEL settlement depends on the connected account and has not been '
        + 'exercised by this adapter.',
    };
  }

  async createSetup(params: SetupParams): Promise<SetupResult> {
    const body = new URLSearchParams();
    body.set('mode', 'setup');
    body.set('success_url', params.returnUrl);
    body.set('cancel_url', params.cancelUrl);
    if (params.customerEmail) body.set('customer_email', params.customerEmail);
    body.set('payment_method_types[0]', 'card');
    for (const [k, v] of Object.entries(params.metadata)) body.set(`metadata[${k}]`, v);

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(`STRIPE_SETUP_FAILED: ${payload?.error?.message ?? res.status}`);
    return {
      mock: false,
      setupUrl: String(payload.url),
      providerSetupId: String(payload.id),
      setupMode: 'ZERO_AMOUNT_SETUP',
    };
  }

  async getStoredPaymentMethod(providerSetupId: string): Promise<StoredPaymentMethod | null> {
    try {
      const session = await this.getJson(`/v1/checkout/sessions/${providerSetupId}`);
      const intentId = typeof session?.setup_intent === 'string'
        ? session.setup_intent
        : session?.setup_intent?.id;
      if (!intentId) return null;
      const intent = await this.getJson(`/v1/setup_intents/${intentId}`);
      /* Anything other than succeeded is not a stored card, whatever the
         checkout page appeared to do on screen. */
      if (intent?.status !== 'succeeded') return null;
      const methodId = typeof intent.payment_method === 'string'
        ? intent.payment_method
        : intent.payment_method?.id;
      if (!methodId) return null;
      const method = await this.getJson(`/v1/payment_methods/${methodId}`);
      const card = method?.card ?? {};
      return {
        providerMethodRef: String(methodId),
        providerCustomerRef: typeof method?.customer === 'string' ? method.customer : null,
        instrumentFingerprint: typeof card.fingerprint === 'string' ? card.fingerprint : null,
        brand: typeof card.brand === 'string' ? card.brand : null,
        last4: typeof card.last4 === 'string' ? card.last4 : null,
        expMonth: Number.isFinite(Number(card.exp_month)) ? Number(card.exp_month) : null,
        expYear: Number.isFinite(Number(card.exp_year)) ? Number(card.exp_year) : null,
      };
    } catch {
      return null;
    }
  }

  private async getJson(path: string): Promise<any> {
    const res = await fetch(`https://api.stripe.com${path}`, {
      headers: { Authorization: `Bearer ${this.secretKey}` },
    });
    if (!res.ok) throw new Error(`STRIPE_GET_FAILED ${res.status}`);
    return await res.json();
  }

  async createCheckout(params: CheckoutParams): Promise<CheckoutResult> {
    const body = new URLSearchParams({
      'payment_method_types[]': 'card',
      'line_items[0][price_data][currency]': params.currency,
      'line_items[0][price_data][product_data][name]': params.productName,
      'line_items[0][price_data][product_data][description]': params.description,
      'line_items[0][price_data][unit_amount]': String(params.amountCents),
      'line_items[0][quantity]': '1',
      mode: 'payment',
      customer_email: params.customerEmail ?? '',
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });
    for (const [k, v] of Object.entries(params.metadata)) body.set(`metadata[${k}]`, v);

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`Stripe checkout error: ${await res.text()}`);
    const session = await res.json();
    return { mock: false, checkoutUrl: session.url, providerCheckoutId: session.id };
  }

  async verifyWebhook(rawBody: string, signatureHeader: string | null): Promise<WebhookVerifyResult> {
    if (!this.webhookSecret) {
      // No webhook secret configured — accept but flag as unverified upstream.
      const event = JSON.parse(rawBody);
      return { valid: true, eventType: event.type, eventId: event.id, event };
    }
    if (!signatureHeader) return { valid: false };
    try {
      const parts = signatureHeader.split(',');
      const timestamp = parts.find(p => p.startsWith('t='))?.split('=')[1];
      const v1 = parts.find(p => p.startsWith('v1='))?.split('=')[1];
      if (!timestamp || !v1) return { valid: false };
      const signedPayload = `${timestamp}.${rawBody}`;
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(this.webhookSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
      const computed = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
      if (computed !== v1) return { valid: false };
      const event = JSON.parse(rawBody);
      return { valid: true, eventType: event.type, eventId: event.id, event };
    } catch {
      return { valid: false };
    }
  }

  async getPayment(providerPaymentId: string): Promise<PaymentRecord | null> {
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${providerPaymentId}`, {
      headers: { Authorization: `Bearer ${this.secretKey}` },
    });
    if (!res.ok) return null;
    const session = await res.json();
    return {
      providerPaymentId: session.id,
      status: session.payment_status === 'paid' ? 'COMPLETED' : 'PENDING',
      amountCents: session.amount_total ?? 0,
      currency: session.currency ?? 'usd',
      metadata: session.metadata ?? {},
    };
  }

  async getPaymentStatus(providerPaymentId: string): Promise<PaymentStatus> {
    const record = await this.getPayment(providerPaymentId);
    return record?.status ?? 'PENDING';
  }

  async refundPayment(providerPaymentId: string, amountCents?: number): Promise<RefundResult> {
    const body = new URLSearchParams({ payment_intent: providerPaymentId });
    if (amountCents != null) body.set('amount', String(amountCents));
    const res = await fetch('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`Stripe refund error: ${await res.text()}`);
    const refund = await res.json();
    return { providerRefundId: refund.id, amountCents: refund.amount, status: refund.status };
  }

  async createInvoiceReference(providerPaymentId: string): Promise<InvoiceReference> {
    // Stripe Checkout Sessions in one-off 'payment' mode do not
    // automatically generate a legal tax invoice — that requires
    // Stripe Tax / Stripe Invoicing to be separately configured,
    // which is not set up in this account. Returning the receipt
    // URL when available is honest; supportsLegalInvoice stays
    // false until that configuration is confirmed (Master Prompt §13).
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${providerPaymentId}`, {
      headers: { Authorization: `Bearer ${this.secretKey}` },
    });
    if (!res.ok) return { invoiceId: null, invoiceUrl: null, receiptUrl: null, supportsLegalInvoice: false };
    const session = await res.json();
    return {
      invoiceId: session.invoice ?? null,
      invoiceUrl: null,
      receiptUrl: session.receipt_url ?? null,
      supportsLegalInvoice: false,
    };
  }

  async createSubscriptionCheckout(params: SubscriptionCheckoutParams): Promise<SubscriptionCheckoutResult> {
    // price_data in `subscription` mode with a monthly recurring interval, so
    // no pre-created Stripe Price object is needed and the plan's price can be
    // edited in Admin -> Pricing without touching the Stripe dashboard.
    const body = new URLSearchParams({
      'line_items[0][price_data][currency]': params.currency,
      'line_items[0][price_data][product_data][name]': params.planName,
      'line_items[0][price_data][unit_amount]': String(params.amountCentsPerMonth),
      'line_items[0][price_data][recurring][interval]': 'month',
      'line_items[0][quantity]': '1',
      mode: 'subscription',
      customer_email: params.customerEmail ?? '',
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });
    for (const [k, v] of Object.entries(params.metadata)) {
      body.set(`metadata[${k}]`, v);
      // Stripe does not copy Checkout Session metadata onto the Subscription,
      // and renewal webhooks arrive against the SUBSCRIPTION. Without this the
      // second month would have no user_id to credit.
      body.set(`subscription_data[metadata][${k}]`, v);
    }

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`Stripe subscription checkout error: ${await res.text()}`);
    const session = await res.json();
    return { mock: false, checkoutUrl: session.url, providerCheckoutId: session.id };
  }

  async getPaymentInstrumentFingerprint(providerPaymentId: string): Promise<string | null> {
    try {
      const sres = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${providerPaymentId}?expand[]=payment_intent.payment_method`,
        { headers: { Authorization: `Bearer ${this.secretKey}` } });
      if (!sres.ok) return null;
      const session = await sres.json();
      const pm = session?.payment_intent?.payment_method;
      // Card fingerprint is the only one Stripe guarantees is stable across
      // customers. Anything else we simply do not have.
      return pm?.card?.fingerprint ?? null;
    } catch {
      return null;
    }
  }
}

// ── Mock provider (dev / no credentials configured) ────────────
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'stripe_mock';

  /*
   * EVERY ANSWER HERE IS 'unknown', AND THAT IS THE POINT.
   *
   * A mock can simulate any flow, so saying "yes, zero-amount setup works"
   * would be true of the simulation and tell an operator nothing about
   * whether Homatch can actually take money. `simulated: true` is what Admin
   * leads with, and the capability rows underneath say unknown rather than
   * pretending the stand-in is evidence about a real provider.
   *
   * This is what makes the Admin screen honest while no provider is
   * connected -- which is the case in production today.
   */
  capabilities(): ProviderCapabilities {
    return {
      oneTimePayment: 'unknown',
      zeroAmountSetup: 'unknown',
      reusablePaymentMethod: 'unknown',
      instrumentFingerprint: false,
      refunds: 'unknown',
      webhooks: 'unknown',
      legalInvoice: false,
      minAmountCents: null,
      maxAmountCents: null,
      currencies: [],
      simulated: true,
      notes:
        'No payment provider is configured: PAYMENT_PROVIDER_SECRET is unset, so this stand-in is in use. '
        + 'It can move a customer through the screens and it can take no money and store no card. '
        + 'Nothing here is evidence about Bank of Georgia, TBC, Keepz or any other provider.',
    };
  }

  async createSetup(params: SetupParams): Promise<SetupResult> {
    const mockId = `mock_setup_${crypto.randomUUID()}`;
    return {
      mock: true,
      setupUrl: `https://mock-stripe.homatch.com/setup?user=${encodeURIComponent(params.userId)}&session=${mockId}`,
      providerSetupId: mockId,
      setupMode: 'ZERO_AMOUNT_SETUP',
    };
  }

  /*
   * No card was ever entered, so there is no stored method to report. Null is
   * the honest answer and the caller must treat it as "not stored" -- which
   * means the activation bonus is NOT granted against a mock setup. A mock
   * that handed back a plausible-looking card would let the bonus be claimed
   * without a payment method existing anywhere, which is the exact fraud the
   * promotion is designed to resist.
   */
  async getStoredPaymentMethod(): Promise<StoredPaymentMethod | null> { return null; }

  async createCheckout(params: CheckoutParams): Promise<CheckoutResult> {
    const mockId = `mock_${crypto.randomUUID()}`;
    return {
      mock: true,
      checkoutUrl: `https://mock-stripe.homatch.com/pay?amount=${params.amountCents}&payment_id=${mockId}`,
      providerCheckoutId: mockId,
    };
  }
  async verifyWebhook(rawBody: string): Promise<WebhookVerifyResult> {
    try {
      const event = JSON.parse(rawBody);
      return { valid: true, eventType: event.type, eventId: event.id, event };
    } catch {
      return { valid: false };
    }
  }
  async getPayment(): Promise<PaymentRecord | null> { return null; }
  async getPaymentStatus(): Promise<PaymentStatus> { return 'PENDING'; }
  async refundPayment(providerPaymentId: string, amountCents = 0): Promise<RefundResult> {
    return { providerRefundId: `mock_refund_${crypto.randomUUID()}`, amountCents, status: 'succeeded' };
  }
  async createInvoiceReference(): Promise<InvoiceReference> {
    return { invoiceId: null, invoiceUrl: null, receiptUrl: null, supportsLegalInvoice: false };
  }
  async createSubscriptionCheckout(params: SubscriptionCheckoutParams): Promise<SubscriptionCheckoutResult> {
    const mockId = `mock_sub_${crypto.randomUUID()}`;
    return {
      mock: true,
      checkoutUrl: `https://mock-stripe.homatch.com/subscribe?plan=${params.planCode}&session=${mockId}`,
      providerCheckoutId: mockId,
    };
  }
  // No real instrument exists behind a mock checkout, so there is no
  // fingerprint to report. The per-user unique index still enforces
  // one activation bonus per account.
  async getPaymentInstrumentFingerprint(): Promise<string | null> { return null; }
}

export function getPaymentProvider(): PaymentProvider {
  const secretKey = Deno.env.get('PAYMENT_PROVIDER_SECRET');
  if (!secretKey) return new MockPaymentProvider();
  return new StripePaymentProvider(secretKey, Deno.env.get('PAYMENT_WEBHOOK_SECRET') ?? undefined);
}

// ── Centralized VAT math (Master Prompt §3, §12, §16) ──────────
// All amounts are integer cents. subtotal + vat = total, always.
export function computeVatBreakdown(totalCents: number, vatRateBps: number) {
  // total = subtotal * (1 + rate) => subtotal = total / (1 + rate)
  const subtotalCents = Math.round((totalCents * 10000) / (10000 + vatRateBps));
  const vatAmountCents = totalCents - subtotalCents;
  return { subtotalCents, vatAmountCents, totalCents };
}
