// META ADS — THE ONE ADAPTER. Every Graph API byte goes through here.
//
// No React component, no page, no other function talks to Meta directly.
// This module owns: the pinned API version, MOCK vs REAL mode, retries
// with backoff on throttling, error capture into meta_api_errors, the
// error normalizer, OAuth state signing, token-at-rest protection and
// media upload.
//
// MODE — truthful by construction:
//   REAL  when META_APP_ID + META_APP_SECRET secrets are configured.
//   MOCK  otherwise: every "external" object is created locally with an
//         unmistakable `mock_` id and TEST-prefixed name, no insight
//         numbers are ever synthesized, no customer money moves, and Admin
//         displays the mode.
// Publishing to real Meta additionally requires the admin kill switch
// meta_ads_publishing_enabled.
//
// TOKENS NEVER TRAVEL IN A URL. A token in a query string ends up in fetch
// error messages ("error sending request for url (…?access_token=…)"), and
// from there in logs and error rows. GET calls carry it in the Authorization
// header; POST calls carry it in the form body. Every call made with a user
// token also carries appsecret_proof, so a leaked token alone cannot be
// replayed against the Graph API from outside this app.

import { normalizeMetaError, type NormalizedMetaError } from '../../../src/lib/metaAds/errors.ts';
import { META_API_VERSION } from '../../../src/lib/metaAds/strategy.ts';
import {
  buildOAuthDialogUrl, META_LOGIN_CONFIG_ID_DEFAULT, signState, verifyState, verifySignedRequest,
  type SignedRequestPayload,
} from '../../../src/lib/metaAds/oauth.ts';

export type MetaMode = 'REAL' | 'MOCK';

export function metaMode(): MetaMode {
  return (Deno.env.get('META_APP_ID') && Deno.env.get('META_APP_SECRET')) ? 'REAL' : 'MOCK';
}

export function metaAppId(): string { return Deno.env.get('META_APP_ID') ?? ''; }
export function metaAppSecret(): string { return Deno.env.get('META_APP_SECRET') ?? ''; }

/**
 * The OAuth redirect is the meta-oauth FUNCTION, not a page. The previous
 * default pointed at a frontend route that does not exist, so a REAL-mode
 * consent would have landed on a 404 and never exchanged its code.
 */
export function metaRedirectUri(): string {
  const configured = Deno.env.get('META_OAUTH_REDIRECT');
  if (configured) return configured;
  const base = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
  return `${base}/functions/v1/meta-oauth`;
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
  /** Fewer retries for interactive calls. */
  attempts?: number;
}

interface SupabaseLike { from: (t: string) => { insert: (v: unknown) => PromiseLike<unknown> } }

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** appsecret_proof = HMAC-SHA256(app_secret, access_token), hex. */
export async function appSecretProof(token: string): Promise<string | null> {
  const secret = metaAppSecret();
  return secret && token ? await hmacHex(secret, token) : null;
}

/** One Graph call: form-encoded POST (the Marketing API's lingua franca),
 *  bounded retries with exponential backoff on the throttle family only. */
export async function graph(path: string, opts: GraphOptions): Promise<Record<string, unknown>> {
  const url = `${GRAPH}${path}`;
  const attempts = opts.attempts ?? 3;
  const proof = await appSecretProof(opts.token);
  let lastErr: MetaApiError | null = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let res: Response;
    const method = opts.method ?? (opts.body ? 'POST' : 'GET');
    try {
      if (method !== 'GET') {
        const form = new URLSearchParams();
        for (const [k, v] of Object.entries(opts.body ?? {})) {
          if (v === undefined || v === null) continue;
          form.set(k, typeof v === 'string' ? v : JSON.stringify(v));
        }
        form.set('access_token', opts.token);
        if (proof) form.set('appsecret_proof', proof);
        res = await fetch(url, {
          method, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(),
        });
      } else {
        const sep = path.includes('?') ? '&' : '?';
        res = await fetch(proof ? `${url}${sep}appsecret_proof=${proof}` : url, {
          headers: { Authorization: `OAuth ${opts.token}` },
        });
      }
    } catch {
      // A network failure. Deliberately NOT forwarding the runtime's message:
      // it embeds the request URL.
      lastErr = new MetaApiError(0, { error: { message: 'NETWORK_ERROR', code: 2, is_transient: true } });
      if (attempt === attempts) throw lastErr;
      await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
      continue;
    }
    const body = await res.json().catch(() => ({}));
    if (res.ok) return body as Record<string, unknown>;
    lastErr = new MetaApiError(res.status, body);
    if (opts.audit) {
      try {
        await opts.audit.sb.from('meta_api_errors').insert({
          user_id: opts.audit.userId ?? null,
          campaign_id: opts.audit.campaignId ?? null,
          endpoint: path.split('?')[0],
          method,
          code: lastErr.normalized.code,
          subcode: lastErr.normalized.subcode,
          customer_message_key: lastErr.normalized.customerKey,
          message: scrubText(lastErr.normalized.rawMessage).slice(0, 500),
          raw: scrub(body),
        });
      } catch { /* logged best-effort */ }
    }
    /* 190 = the token itself is no longer valid (password change, revoked
       app, expired session). The connection must stop saying CONNECTED, so
       the next status call asks the owner to reconnect instead of failing
       every action one by one. */
    if (lastErr.normalized.code === 190 && opts.audit?.userId) {
      try {
        await (opts.audit.sb as unknown as { from: (t: string) => any }).from('meta_connections')
          .update({ status: 'EXPIRED', last_error: 'TOKEN_INVALIDATED' })
          .eq('user_id', opts.audit.userId).eq('status', 'CONNECTED');
      } catch { /* best effort; the next call re-detects it */ }
    }
    if (!lastErr.normalized.recoverable || attempt === attempts) throw lastErr;
    await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
  }
  throw lastErr!;
}

/** Every page of a list endpoint, bounded. Graph lists are paged by cursor. */
export async function graphAll(path: string, opts: GraphOptions, maxPages = 5): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let next: string | null = path;
  for (let page = 0; page < maxPages && next; page += 1) {
    const res = await graph(next, opts);
    out.push(...(((res.data as Record<string, unknown>[]) ?? [])));
    const after = (res.paging as { cursors?: { after?: string }; next?: string } | undefined);
    if (!after?.next || !after.cursors?.after) break;
    const sep = path.includes('?') ? '&' : '?';
    next = `${path}${sep}after=${encodeURIComponent(after.cursors.after)}`;
  }
  return out;
}

/** Strips anything token- or secret-shaped before text is persisted or logged. */
export function scrubText(text: string): string {
  return String(text ?? '')
    .replace(/(access_token|client_secret|appsecret_proof|fb_exchange_token|input_token)=[^&\s"]+/gi, '$1=[scrubbed]')
    .replace(/EA[A-Za-z0-9]{40,}/g, '[scrubbed-token]');
}

function scrub(v: unknown): unknown {
  try {
    return JSON.parse(scrubText(JSON.stringify(v)).replace(/"access_token":"[^"]*"/g, '"access_token":"[scrubbed]"'));
  } catch { return null; }
}

/* ── TOKEN AT REST ─────────────────────────────────────────────────────
 * meta_tokens is service-role-only by RLS. When META_TOKEN_ENCRYPTION_KEY
 * (32+ random bytes, base64) is configured, tokens are additionally sealed
 * with AES-256-GCM, so a database export alone does not carry usable
 * Facebook credentials. Stored as `enc:v1:<iv>:<ciphertext>`; plaintext rows
 * written before the key existed are still read, and resealed on next write.
 */
async function tokenKey(): Promise<CryptoKey | null> {
  const raw = Deno.env.get('META_TOKEN_ENCRYPTION_KEY');
  if (!raw) return null;
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (bytes.length < 32) return null;
  return await crypto.subtle.importKey('raw', bytes.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** A live Meta credential is never stored in the clear: in REAL mode a
 *  missing META_TOKEN_ENCRYPTION_KEY refuses the connection with a named
 *  configuration error instead of silently writing plaintext. MOCK tokens
 *  are not credentials and may stay readable for tests. */
export class TokenEncryptionMissingError extends Error {
  constructor() { super('TOKEN_ENCRYPTION_NOT_CONFIGURED'); }
}

export async function sealToken(token: string): Promise<string> {
  const key = await tokenKey();
  if (!key) {
    if (metaMode() === 'REAL') throw new TokenEncryptionMissingError();
    return token;
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token)));
  return `enc:v1:${b64(iv)}:${b64(ct)}`;
}

export async function openToken(stored: string | null | undefined): Promise<string | null> {
  if (!stored) return null;
  if (!stored.startsWith('enc:v1:')) return stored;
  const key = await tokenKey();
  if (!key) return null;
  const [, , iv, ct] = stored.split(':');
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

/* ── OAUTH ──────────────────────────────────────────────────────────── */

/**
 * LEAST PRIVILEGE. Every permission below is tied to a Graph call HOMATCH
 * actually makes; nothing is requested "because it may be useful".
 *
 * BASE (every goal) — the Facebook Login for Business configuration:
 *   ads_management         POST act_/campaigns, /adsets, /adcreatives, /ads,
 *                          /adimages, /advideos, /customaudiences; status
 *                          changes; GET act_/instagram_accounts (Instagram
 *                          placements without instagram_basic)
 *   ads_read               GET campaign status + /insights (maintenance sync),
 *                          GET act_ account_status / funding (preflight)
 *   business_management    GET /me/businesses; business-owned assets
 *   pages_show_list        GET /me/accounts (the Page picker)
 *   pages_read_engagement  GET /{page}?fields=access_token (page token for
 *                          page-backed creatives)
 *
 * INSTANT FORMS ONLY (goal LEADS_ON_META) — not in the base configuration;
 * the goal is unavailable until they are granted:
 *   pages_manage_ads       POST /{page}/leadgen_forms, GET /{page}/leadgen_forms
 *   pages_manage_metadata  POST /{page}/subscribed_apps (leadgen webhook)
 *   leads_retrieval        GET /{leadgen_id}?fields=field_data (_shared/metaLeads.ts)
 *
 * instagram_basic is NOT used: Instagram accounts come from the ad account.
 */
export const BASE_SCOPES = ['ads_management', 'ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement'];
export const INSTANT_FORM_SCOPES = ['leads_retrieval', 'pages_manage_ads', 'pages_manage_metadata'];

/** Legacy (non-configuration) dialog only: the base set. */
export const OAUTH_SCOPES = BASE_SCOPES.join(',');

export const REQUIRED_SCOPES_BY_GOAL: Record<string, string[]> = {
  LEADS_ON_META: [...BASE_SCOPES, ...INSTANT_FORM_SCOPES],
  LEADS_ON_WEBSITE: BASE_SCOPES,
  SITE_REGISTRATIONS: BASE_SCOPES,
  PROMOTE: BASE_SCOPES,
  ENGAGEMENT: BASE_SCOPES,
  MESSAGES: BASE_SCOPES,
};

export const hasScopes = (granted: string[] | null | undefined, needed: string[]) =>
  needed.every((s) => (granted ?? []).includes(s));

/** The Facebook Login for Business configuration the dialog uses. The
 *  production configuration issues a system-user access token; the secret
 *  META_LOGIN_CONFIG_ID can point at another one without a code change. */
export function metaLoginConfigId(): string {
  return (Deno.env.get('META_LOGIN_CONFIG_ID') ?? META_LOGIN_CONFIG_ID_DEFAULT).trim();
}

/** state = base64url(payload).hmac — bound to the user and the nonce, expiring. */
export function signOAuthState(payload: { uid: string; nonce: string }): Promise<string> {
  return signState(metaAppSecret(), payload);
}

export function verifyOAuthState(state: string): Promise<{ uid: string; nonce: string } | null> {
  return verifyState(metaAppSecret(), state);
}

export function oauthStartUrl(state: string): string {
  return buildOAuthDialogUrl({
    apiVersion: META_API_VERSION,
    appId: metaAppId(),
    redirectUri: metaRedirectUri(),
    state,
    configId: metaLoginConfigId(),
    scopes: OAUTH_SCOPES,
  });
}

async function tokenCall(params: Record<string, string>): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${GRAPH}/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
  } catch {
    throw new MetaApiError(0, { error: { message: 'NETWORK_ERROR', code: 2 } });
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new MetaApiError(res.status, body);
  return body as Record<string, unknown>;
}

export async function exchangeCodeForToken(code: string): Promise<{ token: string; expiresIn: number | null }> {
  const first = await tokenCall({
    client_id: metaAppId(), client_secret: metaAppSecret(), redirect_uri: metaRedirectUri(), code,
  });
  /* A Login for Business configuration returns a business-integration
     system-user token: it is already long-lived (no expires_in unless the
     configuration sets one) and is never passed through fb_exchange_token,
     which applies to short-lived USER tokens only. */
  if (metaLoginConfigId()) {
    return {
      token: String(first.access_token),
      expiresIn: typeof first.expires_in === 'number' && first.expires_in > 0 ? first.expires_in : null,
    };
  }
  // Legacy Facebook Login: upgrade to a long-lived (~60 day) user token.
  const long = await tokenCall({
    grant_type: 'fb_exchange_token', client_id: metaAppId(), client_secret: metaAppSecret(),
    fb_exchange_token: String(first.access_token),
  });
  return {
    token: String(long.access_token),
    expiresIn: typeof long.expires_in === 'number' ? long.expires_in : null,
  };
}

/* ── SIGNED REQUESTS (deauthorize / data deletion callbacks) ────────── */

/** Meta's signed_request, verified against the app secret (HMAC-SHA256,
 *  algorithm checked, user_id required). Null for anything else. */
export function parseSignedRequest(signed: string): Promise<SignedRequestPayload | null> {
  return verifySignedRequest(metaAppSecret(), signed);
}

/* ── WEBHOOK SIGNATURE ─────────────────────────────────────────────── */

export async function verifyWebhookSignature(rawBody: string, header: string | null): Promise<boolean> {
  // No secret, no verification. An empty HMAC key is a key anyone can use.
  if (!metaAppSecret()) return false;
  if (!header?.startsWith('sha256=')) return false;
  return timingSafeEqual(await hmacHex(metaAppSecret(), rawBody), header.slice(7));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ── MEDIA ─────────────────────────────────────────────────────────────
 * Meta never sees a HOMATCH storage path. Images are uploaded as bytes to
 * /act_x/adimages and referenced by image_hash; videos are handed to
 * /act_x/advideos by a short-lived signed URL and referenced by video_id,
 * with Meta's own generated thumbnail once processing finishes.
 */
export async function uploadImage(accountId: string, bytes: Uint8Array, filename: string, opts: GraphOptions): Promise<string> {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  const res = await graph(`/${accountId}/adimages`, { ...opts, method: 'POST', body: { bytes: btoa(binary), name: filename } });
  const images = (res.images ?? {}) as Record<string, { hash?: string }>;
  const hash = Object.values(images)[0]?.hash;
  if (!hash) throw new MetaApiError(500, { error: { message: 'IMAGE_UPLOAD_NO_HASH', code: 1 } });
  return hash;
}

export async function uploadVideo(
  accountId: string,
  fileUrl: string,
  opts: GraphOptions,
  waitMs = 45_000,
): Promise<{ videoId: string; thumbnailUrl: string | null; ready: boolean }> {
  const res = await graph(`/${accountId}/advideos`, { ...opts, method: 'POST', body: { file_url: fileUrl } });
  const videoId = String(res.id ?? '');
  if (!videoId) throw new MetaApiError(500, { error: { message: 'VIDEO_UPLOAD_NO_ID', code: 1 } });
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const info = await graph(`/${videoId}?fields=status,picture`, { ...opts, method: 'GET', body: undefined, attempts: 1 });
    const status = (info.status as { video_status?: string } | undefined)?.video_status;
    if (status === 'ready') return { videoId, thumbnailUrl: (info.picture as string) ?? null, ready: true };
    if (status === 'error') throw new MetaApiError(400, { error: { message: 'VIDEO_PROCESSING_FAILED', code: 1 } });
    await new Promise((r) => setTimeout(r, 3000));
  }
  return { videoId, thumbnailUrl: null, ready: false };
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
    { key: 'oauth_business_login', status: 'VERIFIED_WITH_REQUIREMENTS', requirement: 'Meta app in Live mode; Business Verification; Advanced Access for ads_management, leads_retrieval, business_management, pages_manage_ads, pages_manage_metadata (App Review).' },
    { key: 'asset_discovery', status: 'VERIFIED_SUPPORTED', requirement: 'Businesses, Pages, Instagram accounts, ad accounts, pixels and lead forms, paginated.' },
    { key: 'campaign_publish', status: 'VERIFIED_WITH_REQUIREMENTS', requirement: 'ads_management Advanced Access; ad account with a funding source; goal-specific payloads (lead form, pixel event, messaging app) built by payload.ts.' },
    { key: 'media_upload', status: 'VERIFIED_SUPPORTED', requirement: 'Images via /adimages (image_hash); videos via /advideos (video_id + generated thumbnail).' },
    { key: 'lead_forms', status: 'VERIFIED_WITH_REQUIREMENTS', requirement: 'pages_manage_ads; forms listed and created with the Page token; privacy-policy URL required.' },
    { key: 'lead_webhooks', status: 'VERIFIED_WITH_REQUIREMENTS', requirement: 'leadgen webhook subscription on the app + page subscribed_apps (done automatically when a Page is selected); leads_retrieval.' },
    { key: 'custom_audiences', status: 'VERIFIED_WITH_REQUIREMENTS', requirement: 'Custom Audience ToS accepted for the ad account; hashed EMAIL/PHONE schema.' },
    { key: 'retargeting', status: 'VERIFIED_WITH_REQUIREMENTS', requirement: 'READY custom audience; HOUSING campaigns keep restricted targeting.' },
    { key: 'lookalike', status: 'NOT_VERIFIED', requirement: 'Blocked for Special Ad Categories by policy; stays gated off.' },
    { key: 'ad_account_auto_create', status: 'NOT_VERIFIED', requirement: 'The product uses SELECT_EXISTING / GUIDED_CREATE_AND_RECHECK.' },
    { key: 'messaging_messenger', status: 'VERIFIED_WITH_REQUIREMENTS', requirement: 'CONVERSATIONS optimisation to Messenger for the selected Page; enable MESSAGES in meta_ads_goals_enabled after a REAL-mode probe.' },
    { key: 'messaging_instagram_direct', status: 'NOT_VERIFIED', requirement: 'Requires a connected Instagram account; offered only when one is selected.' },
    { key: 'messaging_whatsapp', status: 'NOT_VERIFIED', requirement: 'Requires a WhatsApp Business number linked to the Page; hidden unless meta_ads_whatsapp_enabled.' },
    { key: 'messaging_stats', status: 'NOT_VERIFIED', requirement: 'Only the conversation counts Meta reports in insights actions are shown.' },
    { key: 'pixel_conversion', status: 'VERIFIED_WITH_REQUIREMENTS', requirement: 'A pixel/dataset on the ad account receiving the LEAD / COMPLETE_REGISTRATION event from the destination site.' },
    { key: 'integration_mode', status: mode === 'REAL' ? 'VERIFIED_SUPPORTED' : 'NOT_VERIFIED', requirement: mode === 'REAL' ? undefined : 'META_APP_ID / META_APP_SECRET secrets are not configured — adapter runs in MOCK.' },
  ];
}

/* ── MOCK ID FACTORY ───────────────────────────────────────────────── */

export function mockExternalId(prefix: string): string {
  return `mock_${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}
