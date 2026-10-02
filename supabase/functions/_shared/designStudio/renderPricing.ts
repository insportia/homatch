// HOMATCH DESIGN STUDIO — what a render is quoted at, and the signed quote a start must present.
//
// ┌──────────────────────────────────────────────────────────────────────┐
// │ PROPOSED PRICES — AN OWNER PRODUCT DECISION, NOT YET MADE.           │
// │ The billable products (DS_MASTER_RENDER, DS_ROOM_RENDER,             │
// │ DS_RENDER_EDIT) are registered with pricing_active = false. Nothing   │
// │ is charged until the owner approves prices AND switches              │
// │ design_studio_billing_enabled on; the database price book            │
// │ (billing_price_quote) then decides what is settled, clamped to what  │
// │ this quote authorised. These figures are what the quote SHOWS.       │
// └──────────────────────────────────────────────────────────────────────┘
//
// COGS basis (USD, per view; 10 credits = $1):
//   GPU   Blender/Cycles on RTX A5000 at ~$0.0002/s (RUNPOD_DS_USD_PER_SECOND):
//         a room view ~60–120 s ≈ $0.012–0.024; a whole-home dollhouse
//         ~120–300 s ≈ $0.024–0.06.
//   FINISH gpt-image-2 (default) edits endpoint, quality high, ~1536×1024:
//         image output $30/1M tokens (~5.5k tokens ≈ $0.165) + image input
//         $8/1M (base picture, ~1–3k tokens ≈ $0.01–0.03) + text $5/1M
//         (~300 tokens ≈ $0.002) ≈ $0.18–0.20. Gemini 3 Pro Image at 2K:
//         $0.134/image + input ≈ $0.14.
//   EDIT  one provider edit (image + mask) ≈ $0.19–0.22, no GPU.
//   Landed (tax/fees) is added by billing_landed_cogs_cents at settle.
//
//   product           COGS/view (high)   proposed     gross margin at high COGS
//   DS_MASTER_RENDER  ≈ $0.26            6 cr ($0.60)  ≈ 57%
//   DS_ROOM_RENDER    ≈ $0.22            5 cr ($0.50)  ≈ 56%
//   DS_RENDER_EDIT    ≈ $0.22            4 cr ($0.40)  ≈ 45%
//   (each above the products' 30% min_gross_margin_bps floor)
//
// Unknown COGS is never zero: a provider/model with no price in the image
// price table records its cost as null and UNPRICED (imageProviders.ts).

import type { RenderProduct } from '../../../../src/lib/designStudio/renders/contract.ts';

export const RENDER_PRICING = Object.freeze({
  status: 'PROPOSED' as const,
  creditsPerView: Object.freeze({ DS_MASTER_RENDER: 6, DS_ROOM_RENDER: 5, DS_RENDER_EDIT: 4 }) as Readonly<Record<RenderProduct, number>>,
  /** How many views one quote may cover (a runaway client, not a price). */
  maxViews: Object.freeze({ DS_MASTER_RENDER: 4, DS_ROOM_RENDER: 12, DS_RENDER_EDIT: 1 }) as Readonly<Record<RenderProduct, number>>,
});

export const RENDER_PRODUCTS: readonly RenderProduct[] = ['DS_MASTER_RENDER', 'DS_ROOM_RENDER', 'DS_RENDER_EDIT'];
export const QUOTE_TTL_MS = 10 * 60_000;

export const isRenderProduct = (v: unknown): v is RenderProduct => typeof v === 'string' && (RENDER_PRODUCTS as readonly string[]).includes(v);

/** Credits for `views` views of `product`, or null when the request is out of bounds. */
export function quoteCredits(product: RenderProduct, views: number): number | null {
  if (!Number.isInteger(views) || views < 1 || views > RENDER_PRICING.maxViews[product]) return null;
  return RENDER_PRICING.creditsPerView[product] * views;
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
  product: RenderProduct;
  views: number;
  credits: number;
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
  if (!c || c.v !== 1 || !isRenderProduct(c.product) || !Number.isInteger(c.views) || typeof c.credits !== 'number' || typeof c.exp !== 'number' || typeof c.charged !== 'boolean') {
    return { ok: false, reason: 'QUOTE_MALFORMED' };
  }
  if (now > c.exp) return { ok: false, reason: 'QUOTE_EXPIRED' };
  return { ok: true, claims: c };
}

/** A quote is for this caller, this project and version, this product and this many views. */
export function quoteMatches(c: QuoteClaims, want: { userId: string; projectId: string; versionId: string; product: RenderProduct; views: number }): boolean {
  return c.u === want.userId && c.p === want.projectId && c.ver === want.versionId && c.product === want.product && c.views === want.views
    && c.credits === quoteCredits(c.product, c.views);
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
