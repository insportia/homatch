// META ADS — THE ONE ADAPTER. Every Graph API byte goes through here.
//
// No React component, no page, no other function talks to Meta directly.
// This module owns: the pinned API version, MOCK vs REAL mode, retries
// with backoff on throttling, error capture into meta_api_errors, and the
// error normalizer. Raw Meta calls scattered through the app are how a
// version bump becomes an outage; one funnel is how it becomes a diff.
//
// MODE — truthful by construction:
//   REAL  when META_APP_ID + META_APP_SECRET secrets are configured.
//   MOCK  otherwise: every "external" object is created locally with an
//         unmistakable `mock_` id and TEST-prefixed name, no insight
//         numbers are ever synthesized (no fake spend, reach or CTR —
//         results stay empty in MOCK), and Admin displays the mode.
// Publishing to real Meta additionally requires the admin kill switch
// meta_ads_publishing_enabled.

import { normalizeMetaError, type NormalizedMetaError } from '../../../src/lib/metaAds/errors.ts';
import { META_API_VERSION } from '../../../src/lib/metaAds/strategy.ts';

export type MetaMode = 'REAL' | 'MOCK';

export function metaMode(): MetaMode {
  return (Deno.env.get('META_APP_ID') && Deno.env.get('META_APP_SECRET')) ? 'REAL' : 'MOCK';
}

export function metaAppId(): string { return Deno.env.get('META_APP_ID') ?? ''; }
export function metaAppSecret(): string { return Deno.env.get('META_APP_SECRET') ?? ''; }
export function metaRedirectUri(): string {
  return Deno.env.get('META_OAUTH_REDIRECT') ?? 'https://www.homatch.live/outreach/meta/connected';
}

const GRAPH = `https://graph.facebook.com/${META_API_VERSION}`;

export class MetaApiError extends Error {
  normalized: NormalizedMetaError;
  status: number;
  constructor(status: number, body: unknown) {
    const err = (body as { error?: Record<string, unknown> })?.error ?? {};
    const normalized = normalizeMetaError(err as never);
    super(normalized.rawMessage || `Meta API ${status}`);
    this.normalized = normalized;
    this.status = status;
  }
}

export interface GraphOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  token: string;
  body?: Record<string, unknown>;
  /** For the audit trail in meta_api_errors. */
  audit?: { sb: SupabaseLike; userId?: string | null; campaignId?: string | null };
}

interface SupabaseLike { from: (t: string) => { insert: (v: unknown) => PromiseLike<unknown> } }

/** One Graph call: form-encoded POST (the Marketing API's lingua franca),
 *  bounded retries with exponential backoff on the throttle family only. */
export async function graph(path: string, opts: GraphOptions): Promise<Record<string, unknown>> {
  const url = `${GRAPH}${path}`;
  const attempts = 3;
  let lastErr: MetaApiError | null = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let res: Response;
    const init: RequestInit = { method: opts.method ?? 'GET' };
    if (opts.body || (opts.method ?? 'GET') !== 'GET') {
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.body ?? {})) {
        form.set(k, typeof v === 'string' ? v : JSON.stringify(v));
      }
      form.set('access_token', opts.token);
      init.method = opts.method ?? 'POST';
      init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      init.body = form.toString();
      res = await fetch(url, init);
    } else {
      const sep = path.includes('?') ? '&' : '?';
      res = await fetch(`${url}${sep}access_token=${encodeURIComponent(opts.token)}`);
    }
    const body = await res.json().catch(() => ({}));
    if (res.ok) return body as Record<string, unknown>;
    lastErr = new MetaApiError(res.status, body);
    if (opts.audit) {
      // Fire-and-forget; a logging failure must never mask the real error.
      try {
        await opts.audit.sb.from('meta_api_errors').insert({
          user_id: opts.audit.userId ?? null,
          campaign_id: opts.audit.campaignId ?? null,
          endpoint: path.split('?')[0],
          method: init.method ?? 'GET',
          code: lastErr.normalized.code,
          subcode: lastErr.normalized.subcode,
          customer_message_key: lastErr.normalized.customerKey,
          message: lastErr.normalized.rawMessage.slice(0, 500),
          raw: scrub(body),
        });
      } catch { /* logged best-effort */ }
    }
    if (!lastErr.normalized.recoverable || attempt === attempts) throw lastErr;
    await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
  }
  throw lastErr!;
}

/** Strips anything token-shaped before a raw body is persisted. */
function scrub(v: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(v).replace(/"access_token":"[^"]*"/g, '"access_token":"[scrubbed]"'));
  } catch { return null; }
}

/* ── OAUTH ──────────────────────────────────────────────────────────── */

/** Least privilege: exactly what campaign management, lead retrieval and
 *  audience work need — nothing speculative. */
export const OAUTH_SCOPES = [
  'ads_management', 'ads_read', 'business_management',
  'pages_show_list', 'pages_read_engagement', 'leads_retrieval',
  'pages_manage_ads', 'instagram_basic',
].join(',');

export function oauthStartUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: metaAppId(),
    redirect_uri: metaRedirectUri(),
    state,
    scope: OAUTH_SCOPES,
    response_type: 'code',
  });
  return `https://www.facebook.com/${META_API_VERSION}/dialog/oauth?${q}`;
}

export async function exchangeCodeForToken(code: string): Promise<{ token: string; expiresIn: number | null }> {
  const q = new URLSearchParams({
    client_id: metaAppId(), client_secret: metaAppSecret(),
    redirect_uri: metaRedirectUri(), code,
  });
  const res = await fetch(`${GRAPH}/oauth/access_token?${q}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new MetaApiError(res.status, body);
  // Upgrade to a long-lived token immediately.
  const q2 = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: metaAppId(), client_secret: metaAppSecret(),
    fb_exchange_token: String(body.access_token),
  });
  const res2 = await fetch(`${GRAPH}/oauth/access_token?${q2}`);
  const body2 = await res2.json().catch(() => ({}));
  if (!res2.ok) throw new MetaApiError(res2.status, body2);
  return {
    token: String(body2.access_token),
    expiresIn: typeof body2.expires_in === 'number' ? body2.expires_in : null,
  };
}

/* ── WEBHOOK SIGNATURE ─────────────────────────────────────────────── */

export async function verifyWebhookSignature(rawBody: string, header: string | null): Promise<boolean> {
  if (!header?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(metaAppSecret()),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const given = header.slice(7);
  // Constant-time-ish comparison.
  if (hex.length !== given.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i += 1) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

/* ── CAPABILITIES ──────────────────────────────────────────────────────
 * Truth for Admin and for gating. VERIFIED means "verified against the
 * v26.0 changelog / long-stable documented surface"; NOT_VERIFIED actions
 * stay gated until a REAL-mode probe or Meta approval clears them.
 */
export interface CapabilityRow {
  key: string;
  status: 'VERIFIED_SUPPORTED' | 'VERIFIED_WITH_REQUIREMENTS' | 'NOT_VERIFIED' | 'UNSUPPORTED';
  requirement?: string;
}

export function capabilityMatrix(mode: MetaMode): CapabilityRow[] {
  return [
    { key: 'oauth_business_login', status: 'VERIFIED_WITH_REQUIREMENTS', requirement: 'Meta app in Live mode; Business Verification; Advanced Access for ads_management, leads_retrieval, business_management (App Review).' },
    { key: 'asset_discovery', status: 'VERIFIED_SUPPORTED' },
    { key: 'campaign_publish', status: 'VERIFIED_WITH_REQUIREMENTS', requirement: 'ads_management Advanced Access; ad account with a funding source; v26 requires is_adset_budget_sharing_enabled on create and explicit targeting_automation.advantage_audience for Special Ad Category ad sets.' },
    { key: 'lead_webhooks', status: 'VERIFIED_WITH_REQUIREMENTS', requirement: 'leadgen webhook subscription on the app + page subscribed_apps; leads_retrieval permission.' },
    { key: 'custom_audiences', status: 'VERIFIED_WITH_REQUIREMENTS', requirement: 'Custom Audience ToS accepted for the ad account; hashed EMAIL/PHONE schema.' },
    { key: 'retargeting', status: 'VERIFIED_WITH_REQUIREMENTS', requirement: 'READY custom audience; HOUSING campaigns keep restricted targeting.' },
    { key: 'lookalike', status: 'NOT_VERIFIED', requirement: 'Blocked for Special Ad Categories by policy; unverified for this app’s access level otherwise — stays gated off.' },
    { key: 'ad_account_auto_create', status: 'NOT_VERIFIED', requirement: 'Programmatic ad-account creation requires partner-level Business setup; the product uses SELECT_EXISTING / GUIDED_CREATE_AND_RECHECK.' },
    { key: 'messaging_stats', status: 'NOT_VERIFIED', requirement: 'Conversation metrics need additional permissions/review; MESSAGES goal stays disabled in settings.' },
    { key: 'pixel_capi', status: 'NOT_VERIFIED', requirement: 'Dataset/CAPI wiring pending a REAL-mode probe; website tracking is shown as “not verified” until then.' },
    { key: 'integration_mode', status: mode === 'REAL' ? 'VERIFIED_SUPPORTED' : 'NOT_VERIFIED', requirement: mode === 'REAL' ? undefined : 'META_APP_ID / META_APP_SECRET secrets are not configured — adapter runs in MOCK.' },
  ];
}

/* ── MOCK ID FACTORY ───────────────────────────────────────────────── */

export function mockExternalId(prefix: string): string {
  return `mock_${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}
