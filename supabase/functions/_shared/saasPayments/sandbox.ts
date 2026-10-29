/*
 * SANDBOX PAYMENT PROVIDER — a TEST adapter, clearly labelled, no money moves.
 *
 * It exists so the whole subscription path (checkout -> provider -> signed webhook -> access) can
 * be exercised end to end before a Georgian bank is contracted. Its events are HMAC-SHA256 signed
 * with SAAS_SANDBOX_SECRET, and they reach the SAME normalised webhook handler a real bank's would.
 *
 * Disabled unless BOTH hold: the edge secret SAAS_SANDBOX_SECRET is set AND
 * admin_settings.saas_sandbox_payments_enabled = true. Even then the saas-checkout function lets
 * only an ADMIN complete a sandbox payment, so a live customer can never "pay" with it.
 */
import type {
  ConnectivityResult, CreateSessionInput, CreateSessionResult, LookupResult, NormalisedPaymentEvent, PaymentProviderAdapter,
  ProviderCapabilities, RefundResult, VerifyResult,
} from './types.ts';
import { isPositiveTetri } from './types.ts';

export const SANDBOX_SIGNATURE_HEADER = 'x-homatch-sandbox-signature';

const enc = new TextEncoder();

export async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of two hex strings. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

export interface SandboxEventBody {
  eventId: string;
  type: 'PAYMENT_SUCCEEDED' | 'PAYMENT_FAILED';
  amountTetri: number;
  currency: 'GEL';
  reference: string;
  test: true;
}

/** Build and sign a sandbox event. Returns the exact raw body the webhook must receive. */
export async function signSandboxEvent(secret: string, body: SandboxEventBody): Promise<{ raw: string; signature: string }> {
  const raw = JSON.stringify(body);
  return { raw, signature: await hmacHex(secret, raw) };
}

export class SandboxAdapter implements PaymentProviderAdapter {
  readonly id = 'SANDBOX' as const;
  private readonly secret: string | undefined;
  private readonly enabled: boolean;
  private readonly appUrl: string;
  constructor(secret: string | undefined, enabled: boolean, appUrl: string) {
    this.secret = secret;
    this.enabled = enabled;
    this.appUrl = appUrl;
  }

  capabilities(): ProviderCapabilities {
    const missingSecrets = this.secret ? [] : ['SAAS_SANDBOX_SECRET'];
    return { configured: Boolean(this.secret) && this.enabled, recurring: false, refunds: false, lookup: false, test: true, missingSecrets };
  }

  async createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
    if (!this.secret) return { ok: false, reason: 'NOT_CONFIGURED' };
    if (!this.enabled) return { ok: false, reason: 'DISABLED' };
    const url = `${this.appUrl.replace(/\/$/, '')}/subscription/sandbox-pay?checkout=${encodeURIComponent(input.checkoutId)}`;
    return { ok: true, sessionRef: `sbx_${input.checkoutId}`, redirectUrl: url };
  }

  async verifyWebhook(rawBody: string, headers: Headers): Promise<VerifyResult> {
    if (!this.secret) return { ok: false, reason: 'NOT_CONFIGURED' };
    if (!this.enabled) return { ok: false, reason: 'DISABLED' };
    const given = (headers.get(SANDBOX_SIGNATURE_HEADER) ?? '').trim().toLowerCase();
    const want = await hmacHex(this.secret, rawBody);
    if (!given || !safeEqual(given, want)) return { ok: false, reason: 'BAD_SIGNATURE' };
    let b: Partial<SandboxEventBody>;
    try { b = JSON.parse(rawBody); } catch { return { ok: false, reason: 'BAD_PAYLOAD' }; }
    if (b.test !== true || typeof b.eventId !== 'string' || b.eventId.length < 4 || typeof b.reference !== 'string'
        || (b.type !== 'PAYMENT_SUCCEEDED' && b.type !== 'PAYMENT_FAILED') || !isPositiveTetri(b.amountTetri) || b.currency !== 'GEL') {
      return { ok: false, reason: 'BAD_PAYLOAD' };
    }
    const event: NormalisedPaymentEvent = {
      provider: 'SANDBOX', eventId: b.eventId, type: b.type, amountTetri: b.amountTetri, currency: 'GEL',
      reference: b.reference, subscriptionRef: null, summary: { test: true },
    };
    return { ok: true, event };
  }

  async lookupTransaction(): Promise<LookupResult> { return { ok: false, reason: 'UNSUPPORTED' }; }
  async refund(): Promise<RefundResult> { return { ok: false, reason: 'UNSUPPORTED' }; }
  async testConnectivity(): Promise<ConnectivityResult> {
    if (!this.secret) return { ok: false, reason: 'NOT_CONFIGURED', detail: 'SAAS_SANDBOX_SECRET' };
    return this.enabled ? { ok: true, detail: 'SANDBOX (test) signing key present; no network' }
      : { ok: false, reason: 'NOT_CONFIGURED', detail: 'saas_sandbox_payments_enabled is off' };
  }
}
