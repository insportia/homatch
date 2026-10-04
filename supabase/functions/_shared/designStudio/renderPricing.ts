// HOMATCH DESIGN STUDIO — what a paid Design Studio operation is quoted at, and the signed quote a start must present.
//
// SERVER-AUTHORITATIVE VARIABLE PRICING (owner-approved 2026-10-04):
//
//   REAL COST → LANDED COST (× 1 + billing_cogs_tax_bps) → 55 % TARGET GROSS MARGIN → CREDITS (0.1 precision)
//   CUSTOMER PRICE = LANDED COGS / (1 − 0.55)                       1 credit = $0.10
//
// No price lives in this file. The quote reads each product's reference
// landed COGS {min, est, max} (billable_products.config.reference, measured
// from production telemetry; a mode such as VARIANT may carry its own) and
// prices each one through the canonical billing_price_quote — the same
// function that prices the settlement — so the quote and the charge can
// never disagree about the formula.
//
//   ESTIMATE  the quote shows MINIMUM / ESTIMATE / MAXIMUM; the customer
//             confirms the maximum (`credits`, signed).
//   RESERVE   the maximum is reserved (wallet_reserve, idempotent per row).
//   EXECUTE   the provider work runs.
//   SETTLE    the MEASURED landed COGS is priced again by billing_price_quote
//             and charged, clamped by wallet_settle to the reserved maximum.
//   RELEASE   the rest goes back; a failed run releases everything.
//
// Design Studio charging is a separate switch (design_studio_billing_enabled);
// while it is off a quote is shown with charged = false and nothing is
// reserved. Unknown COGS is never zero: a provider/model with no price in the
// price book records its cost as null and UNPRICED (imageProviders.ts).

import type { RenderProduct } from '../../../../src/lib/designStudio/renders/contract.ts';

/** The paid Design Studio operations a quote can be for: the renders, and the 3D walkthrough. */
export type PricedProduct = RenderProduct | 'DS_WALKTHROUGH';

export const RENDER_PRICING = Object.freeze({
  /** How many views one quote may cover (a runaway client, not a price). */
  maxViews: Object.freeze({ DS_MASTER_RENDER: 4, DS_ROOM_RENDER: 12, DS_RENDER_EDIT: 1, DS_WALKTHROUGH: 1 }) as Readonly<Record<PricedProduct, number>>,
  /** The credit precision every Design Studio price is shown and charged at. */
  creditDp: 1,
});

export const RENDER_PRODUCTS: readonly RenderProduct[] = ['DS_MASTER_RENDER', 'DS_ROOM_RENDER', 'DS_RENDER_EDIT'];
export const QUOTE_TTL_MS = 10 * 60_000;

export const isRenderProduct = (v: unknown): v is RenderProduct => typeof v === 'string' && (RENDER_PRODUCTS as readonly string[]).includes(v);

export const PRICED_PRODUCTS: readonly PricedProduct[] = [...RENDER_PRODUCTS, 'DS_WALKTHROUGH'];
export const isPricedProduct = (v: unknown): v is PricedProduct => typeof v === 'string' && (PRICED_PRODUCTS as readonly string[]).includes(v);

/** A view count the product allows in one quote. */
export const validViews = (product: PricedProduct, views: number) => Number.isInteger(views) && views >= 1 && views <= RENDER_PRICING.maxViews[product];

/** Landed COGS (cents) per unit: the minimum, the estimate and the reservation maximum. */
export interface LandedRange { min: number; est: number; max: number }
/** Credits: what the customer sees (min, est) and confirms (max = the reserved ceiling). */
export interface CreditRange { min: number; est: number; max: number }

const positive = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/**
 * The reference landed range of a product (and of one of its modes, when the product carries one for it), from
 * billable_products.config. Null when the product has no usable reference: it cannot be quoted.
 */
export function referenceOf(config: unknown, mode: string | null = null): LandedRange | null {
  const c = (config ?? {}) as { reference?: unknown; modes?: Record<string, unknown> };
  const pick = (r: unknown): LandedRange | null => {
    const o = (r ?? {}) as Record<string, unknown>;
    const min = positive(o.min); const est = positive(o.est); const max = positive(o.max);
    return min != null && est != null && max != null && min <= est && est <= max && max > 0 ? { min, est, max } : null;
  };
  return (mode && c.modes && typeof c.modes === 'object' ? pick(c.modes[mode]) : null) ?? pick(c.reference);
}

/** Credits for `units` units at the product's precision (credits per unit are already at that precision). */
export const scaleCredits = (perUnit: number, units: number) => Math.round(perUnit * units * 10 ** RENDER_PRICING.creditDp) / 10 ** RENDER_PRICING.creditDp;

// deno-lint-ignore no-explicit-any
type Admin = any;

/**
 * MINIMUM / ESTIMATE / MAXIMUM credits for `views` units of `product` (in `mode`), each priced by the canonical
 * billing_price_quote from the product's reference landed COGS — never a number held here.
 */
export async function priceRange(admin: Admin, input: { product: PricedProduct; mode?: string | null; planCode: string; views: number }): Promise<{ range: CreditRange; perUnit: CreditRange; landed: LandedRange } | { error: string }> {
  if (!validViews(input.product, input.views)) return { error: 'BAD_VIEWS' };
  const { data: product } = await admin.from('billable_products').select('code, pricing_active, config').eq('code', input.product).maybeSingle();
  if (!product?.pricing_active) return { error: 'PRICING_INACTIVE' };
  const landed = referenceOf(product.config, input.mode ?? null);
  if (!landed) return { error: 'PRICING_UNAVAILABLE' };
  const credit = async (cents: number) => {
    const { data, error } = await admin.rpc('billing_price_quote', { p_product_code: input.product, p_plan_code: input.planCode, p_landed_cogs_cents: cents });
    const v = Number(data?.[0]?.credits);
    return error || !Number.isFinite(v) ? null : v;
  };
  const [min, est, max] = await Promise.all([credit(landed.min), credit(landed.est), credit(landed.max)]);
  if (min == null || est == null || max == null || max <= 0) return { error: 'PRICING_UNAVAILABLE' };
  const perUnit = { min, est, max };
  return { perUnit, landed, range: { min: scaleCredits(min, input.views), est: scaleCredits(est, input.views), max: scaleCredits(max, input.views) } };
}

/** The product a view kind is billed as. */
export const productForView = (kind: 'MASTER' | 'ROOM'): RenderProduct => (kind === 'MASTER' ? 'DS_MASTER_RENDER' : 'DS_ROOM_RENDER');

// ── The signed quote ───────────────────────────────────────────────────────

export interface QuoteClaims {
  v: 1;
  /** users.id of the caller it was quoted for. */
  u: string;
  /** Project and design version. */
  p: string;
  ver: string;
  product: PricedProduct;
  views: number;
  /** The MAXIMUM: what the customer confirms and what is reserved (the ceiling a settlement can never pass). */
  credits: number;
  /** What the customer is shown beside it: the minimum and the estimate. */
  min: number;
  est: number;
  /** The mode the range was priced for (a variant has its own), when the product has one. */
  mode?: string | null;
  charged: boolean;
  /** Expiry, epoch ms. */
  exp: number;
  /** Random, so two quotes for the same thing are different tokens. */
  n: string;
}

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = (s: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch { return null; }
};

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/**
 * The quote secret: DS_RENDER_QUOTE_SECRET when set, else a purpose-bound
 * derivation of the service-role key (HMAC of a fixed label), so the raw key
 * itself never signs anything and is never returned. Null = not configured.
 */
export async function quoteSecret(env: (k: string) => string | undefined): Promise<string | null> {
  const own = env('DS_RENDER_QUOTE_SECRET');
  if (own && own.length >= 32) return own;
  const root = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!root) return null;
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(root), enc.encode('homatch:design-studio:render-quote:v1'));
  return b64url(new Uint8Array(mac));
}

export async function signQuote(claims: QuoteClaims, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(claims)));
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body));
  return `${body}.${b64url(new Uint8Array(mac))}`;
}

export type QuoteCheck = { ok: true; claims: QuoteClaims } | { ok: false; reason: 'QUOTE_MALFORMED' | 'QUOTE_INVALID' | 'QUOTE_EXPIRED' };

/** Signature first (constant-time, by WebCrypto), then shape, then expiry. */
export async function verifyQuote(token: unknown, secret: string, now = Date.now()): Promise<QuoteCheck> {
  if (typeof token !== 'string' || token.length > 2048) return { ok: false, reason: 'QUOTE_MALFORMED' };
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return { ok: false, reason: 'QUOTE_MALFORMED' };
  const mac = unb64url(sig); const raw = unb64url(body);
  if (!mac || !raw) return { ok: false, reason: 'QUOTE_MALFORMED' };
  const good = await crypto.subtle.verify('HMAC', await hmacKey(secret), mac, enc.encode(body));
  if (!good) return { ok: false, reason: 'QUOTE_INVALID' };
  let c: QuoteClaims;
  try { c = JSON.parse(new TextDecoder().decode(raw)); } catch { return { ok: false, reason: 'QUOTE_MALFORMED' }; }
  if (!c || c.v !== 1 || !isPricedProduct(c.product) || !Number.isInteger(c.views) || typeof c.credits !== 'number' || typeof c.exp !== 'number' || typeof c.charged !== 'boolean'
    || typeof c.min !== 'number' || typeof c.est !== 'number' || !(c.min >= 0 && c.min <= c.est && c.est <= c.credits && c.credits > 0)) {
    return { ok: false, reason: 'QUOTE_MALFORMED' };
  }
  if (now > c.exp) return { ok: false, reason: 'QUOTE_EXPIRED' };
  return { ok: true, claims: c };
}

/**
 * A quote is for this caller, this project and version, this product and this many views. Its figures are the
 * server's own (the signature proves it): the start reserves exactly the maximum it carries.
 */
export function quoteMatches(c: QuoteClaims, want: { userId: string; projectId: string; versionId: string; product: PricedProduct; views: number }): boolean {
  return c.u === want.userId && c.p === want.projectId && c.ver === want.versionId && c.product === want.product && c.views === want.views
    && validViews(c.product, c.views) && Number.isFinite(c.credits) && c.credits > 0;
}

// ── Idempotency ────────────────────────────────────────────────────────────

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A client idempotency key: 8–128 characters of a safe alphabet. */
export const validIdempotencyKey = (k: unknown): k is string => typeof k === 'string' && /^[A-Za-z0-9_.:-]{8,128}$/.test(k);

/**
 * One row key per (caller, request key, view): the same request is the same
 * rows (a retry never creates or charges a second render), and two views of
 * one request never collide. `scope` separates starts from edits.
 */
export function renderRowKey(userId: string, idempotencyKey: string, scope: 'START' | 'EDIT', viewId: string): Promise<string> {
  return sha256Hex(`ds-render-1|${scope}|${userId}|${idempotencyKey}|${viewId}`);
}

/** The wallet reservation's own idempotency key for one render row. */
export const reservationKey = (rowKey: string) => `ds-render:${rowKey}`;
