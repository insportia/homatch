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

export interface PaymentProvider {
  readonly name: string;
  createCheckout(params: CheckoutParams): Promise<CheckoutResult>;
  verifyWebhook(rawBody: string, signatureHeader: string | null): Promise<WebhookVerifyResult>;
  getPayment(providerPaymentId: string): Promise<PaymentRecord | null>;
  getPaymentStatus(providerPaymentId: string): Promise<PaymentStatus>;
  refundPayment(providerPaymentId: string, amountCents?: number): Promise<RefundResult>;
  createInvoiceReference(providerPaymentId: string): Promise<InvoiceReference>;
}

// ── Stripe (real, SDK-free REST integration) ───────────────────
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe';
  constructor(private readonly secretKey: string, private readonly webhookSecret?: string) {}

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
}

// ── Mock provider (dev / no credentials configured) ────────────
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'stripe_mock';

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
