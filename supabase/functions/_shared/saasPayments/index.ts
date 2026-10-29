/*
 * Adapter registry + the ONE normalised webhook path for subscription payments.
 */
import { BankOfGeorgiaAdapter, TbcAdapter, type FetchLike } from './banks.ts';
import { SandboxAdapter } from './sandbox.ts';
import type { NormalisedPaymentEvent, PaymentProviderAdapter, ProviderId } from './types.ts';
import { env } from './types.ts';

export * from './types.ts';
export { SandboxAdapter, signSandboxEvent, SANDBOX_SIGNATURE_HEADER } from './sandbox.ts';
export { BankOfGeorgiaAdapter, TbcAdapter, BOG_SECRET_NAMES, TBC_SECRET_NAMES, toGel, toTetri } from './banks.ts';

export const PROVIDERS: readonly ProviderId[] = ['SANDBOX', 'BOG', 'TBC'];

export function isProviderId(v: unknown): v is ProviderId {
  return typeof v === 'string' && (PROVIDERS as readonly string[]).includes(v);
}

export interface AdapterContext {
  /** admin_settings.saas_sandbox_payments_enabled */
  sandboxEnabled: boolean;
  appUrl: string;
}

/** The callback a provider calls: https://<project>.supabase.co/functions/v1/saas-payments-webhook?provider=X */
export function callbackUrlFor(id: ProviderId): string {
  const base = (env('SUPABASE_URL') ?? 'https://ptxajsjhobhvsfhmutjn.supabase.co').replace(/[/]+$/, '');
  return `${base}/functions/v1/saas-payments-webhook?provider=${id}`;
}

const realFetch: FetchLike = (url, init) => fetch(url, init);

export function adapterFor(id: ProviderId, ctx: AdapterContext): PaymentProviderAdapter {
  if (id === 'SANDBOX') return new SandboxAdapter(env('SAAS_SANDBOX_SECRET'), ctx.sandboxEnabled, ctx.appUrl);
  if (id === 'BOG') return new BankOfGeorgiaAdapter(env, realFetch, callbackUrlFor('BOG'));
  return new TbcAdapter(env, realFetch, callbackUrlFor('TBC'));
}

interface Rpc {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

/** Apply a VERIFIED, normalised event. Idempotent on (provider, eventId) in SQL. */
export async function applyPaymentEvent(sb: Rpc, e: NormalisedPaymentEvent): Promise<{ ok: boolean; result: unknown; error?: string }> {
  const { data, error } = await sb.rpc('saas_payment_event_apply', {
    p_provider: e.provider, p_event_id: e.eventId, p_type: e.type, p_amount_tetri: e.amountTetri,
    p_currency: e.currency, p_reference: e.reference, p_subscription_ref: e.subscriptionRef, p_summary: e.summary ?? {},
  });
  if (error) return { ok: false, result: null, error: (error as { message?: string }).message ?? 'apply failed' };
  return { ok: true, result: data };
}

/**
 * Verify then apply. The only function that turns a provider request into access. A request that
 * fails verification changes nothing and is answered 401 (or 503 when the provider is not set up).
 */
export async function processWebhook(
  sb: Rpc, adapter: PaymentProviderAdapter, rawBody: string, headers: Headers,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const v = await adapter.verifyWebhook(rawBody, headers);
  if (!v.ok) {
    const status = v.reason === 'BAD_SIGNATURE' ? 401 : v.reason === 'BAD_PAYLOAD' ? 400 : 503;
    return { status, body: { error: v.reason } };
  }
  const applied = await applyPaymentEvent(sb, v.event);
  if (!applied.ok) return { status: 500, body: { error: 'APPLY_FAILED' } };
  return { status: 200, body: { received: true, result: applied.result } };
}
