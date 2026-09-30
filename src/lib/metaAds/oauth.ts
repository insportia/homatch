// META OAUTH — the pure parts, shared by the meta-oauth / meta-ads-api edge
// functions (Deno) and the unit tests (Node). No secret lives here: every
// function that needs the app secret takes it as an argument, and the edge
// adapter (_shared/metaAds.ts) is the only caller that reads it.
//
//   1. The authorization dialog URL. With a Facebook Login for Business
//      configuration (config_id) the configuration — not a scope list —
//      decides the permissions and the token type. The HOMATCH configuration
//      issues a business-integration SYSTEM-USER access token, which Meta
//      only grants through the authorization-code flow, so the request asks
//      for response_type=code and override_default_response_type=true, and
//      carries NO scope parameter.
//   2. The OAuth `state`: base64url(payload).hmac, bound to a user and a
//      one-time nonce, expiring after 15 minutes.
//   3. Meta's `signed_request` (Deauthorize and Data Deletion callbacks):
//      base64url(HMAC-SHA256(app_secret, payload)).base64url(payload), with
//      algorithm HMAC-SHA256 and a user_id. Anything else is refused.

/** The production Facebook Login for Business configuration (system-user
 *  access token). Not a credential — it is visible in every dialog URL. */
export const META_LOGIN_CONFIG_ID_DEFAULT = '970930962712211';

export interface DialogUrlInput {
  apiVersion: string;
  appId: string;
  redirectUri: string;
  state: string;
  /** Facebook Login for Business configuration. When present, `scopes` is ignored. */
  configId?: string | null;
  /** Legacy Facebook Login only (no configuration). */
  scopes?: string;
}

export function buildOAuthDialogUrl(input: DialogUrlInput): string {
  const q = new URLSearchParams({
    client_id: input.appId,
    redirect_uri: input.redirectUri,
    state: input.state,
    response_type: 'code',
  });
  const configId = String(input.configId ?? '').trim();
  if (configId) {
    q.set('config_id', configId);
    /* A system-user configuration must use the code grant; without the
       override Meta falls back to the configuration's default response type. */
    q.set('override_default_response_type', 'true');
  } else if (input.scopes) {
    q.set('scope', input.scopes);
  }
  return `https://www.facebook.com/${input.apiVersion}/dialog/oauth?${q}`;
}

// ── encoding and HMAC ────────────────────────────────────────────────────

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): string {
  const std = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = std + '='.repeat((4 - (std.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

const hex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('');

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── state ────────────────────────────────────────────────────────────────

export const STATE_TTL_MS = 15 * 60_000;

export async function signState(secret: string, payload: { uid: string; nonce: string }, now = Date.now()): Promise<string> {
  if (!secret) throw new Error('STATE_SECRET_MISSING');
  const body = b64url(enc.encode(JSON.stringify({ ...payload, exp: now + STATE_TTL_MS })));
  return `${body}.${hex(await hmac(secret, body))}`;
}

export async function verifyState(secret: string, state: string, now = Date.now()): Promise<{ uid: string; nonce: string } | null> {
  const [body, sig, extra] = String(state ?? '').split('.');
  if (!secret || !body || !sig || extra !== undefined) return null;
  if (!timingSafeEqual(hex(await hmac(secret, body)), sig)) return null;
  try {
    const parsed = JSON.parse(fromB64url(body));
    if (typeof parsed.exp !== 'number' || parsed.exp < now) return null;
    const uid = String(parsed.uid ?? '');
    const nonce = String(parsed.nonce ?? '');
    return uid && nonce ? { uid, nonce } : null;
  } catch {
    return null;
  }
}

// ── signed_request ───────────────────────────────────────────────────────

export interface SignedRequestPayload {
  user_id: string;
  algorithm: string;
  issued_at?: number;
  [key: string]: unknown;
}

/** Verify Meta's signed_request. Returns null for anything not signed with
 *  this app's secret, not HMAC-SHA256, or without a user_id. */
export async function verifySignedRequest(secret: string, signed: string): Promise<SignedRequestPayload | null> {
  const parts = String(signed ?? '').split('.');
  if (!secret || parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [sig, payload] = parts;
  if (!timingSafeEqual(b64url(await hmac(secret, payload)), sig.replace(/=+$/, ''))) return null;
  try {
    const parsed = JSON.parse(fromB64url(payload));
    if (String(parsed?.algorithm ?? '').toUpperCase() !== 'HMAC-SHA256') return null;
    const userId = parsed?.user_id;
    if ((typeof userId !== 'string' && typeof userId !== 'number') || String(userId).trim() === '') return null;
    return { ...parsed, user_id: String(userId) };
  } catch {
    return null;
  }
}

/** Build a signed_request exactly as Meta does — for tests and operators. */
export async function signSignedRequest(secret: string, payload: Record<string, unknown>): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${b64url(await hmac(secret, body))}.${body}`;
}

// ── data deletion ────────────────────────────────────────────────────────

/** An unguessable confirmation code (Meta shows it to the person). */
export function newConfirmationCode(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return hex(bytes).toUpperCase();
}

export const CONFIRMATION_CODE = /^[A-F0-9]{24}$/;

/** Meta's required response to a Data Deletion Request callback. */
export function deletionResponse(functionUrl: string, code: string): { url: string; confirmation_code: string } {
  return { url: `${functionUrl}?deletion_status=${encodeURIComponent(code)}`, confirmation_code: code };
}

/** One-way reference to the requester, so the audit row never keeps the id it deletes. */
export async function hashMetaUserId(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`meta-user:${userId}`));
  return hex(new Uint8Array(digest));
}

// ── identities ───────────────────────────────────────────────────────────
//
// With a Login for Business system-user token, /me answers for the business-
// integration SYSTEM USER, while Meta's Deauthorize / Data Deletion callbacks
// identify a Facebook user. A connection therefore records every Meta id it
// observed, and a callback matches on any of them.

export type IdentityKind = 'APP_SCOPED_USER' | 'SYSTEM_USER' | 'TOKEN_USER' | 'TOKEN_PROFILE';
export interface ConnectionIdentity { kind: IdentityKind; external_id: string }

const META_ID = /^[0-9]{1,32}$/;
const asId = (v: unknown): string | null => {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
  return META_ID.test(s) ? s : null;
};

/** The ids a new connection is known by: /me, and debug_token's user_id / profile_id. */
export function connectionIdentities(
  meId: unknown,
  debug: { user_id?: unknown; profile_id?: unknown } | null | undefined,
  usesBusinessConfig: boolean,
): ConnectionIdentity[] {
  const out: ConnectionIdentity[] = [];
  const add = (kind: IdentityKind, v: unknown) => {
    const id = asId(v);
    if (id && !out.some((x) => x.kind === kind && x.external_id === id)) out.push({ kind, external_id: id });
  };
  add(usesBusinessConfig ? 'SYSTEM_USER' : 'APP_SCOPED_USER', meId);
  add('TOKEN_USER', debug?.user_id);
  add('TOKEN_PROFILE', debug?.profile_id);
  return out;
}

/** The ids a verified signed_request names (user_id, and profile_id when present). */
export function signedRequestIdentities(payload: { user_id?: unknown; profile_id?: unknown }): string[] {
  return [...new Set([asId(payload.user_id), asId(payload.profile_id)].filter((x): x is string => !!x))];
}
