// RESEND — the one HTTP client every email path uses.
//
// KEYS. Marketing and CRM traffic use the dedicated Email Marketing key; the
// legacy RESEND_API_KEY stays the transactional/notification key. The dedicated
// key's env NAME is not hard-coded: admin_settings.email_marketing_resend_key_env
// may name it (a name, never a value), else the conventional names below are
// tried, else the legacy key is used and the result says so (keyFallback=true) so
// an operator can see marketing is not on its own key yet. Supabase Auth SMTP is
// configured in the dashboard and never touched from here.
//
// RELIABILITY. POSTs that create something carry an Idempotency-Key (Resend keeps
// it 24 h), 429/5xx are retried with backoff honouring Retry-After, 4xx are not.
// Nothing here logs a key, a body, or a recipient address.

export type ResendPurpose = 'marketing' | 'transactional';

const MARKETING_KEY_CANDIDATES = [
  'RESEND_MARKETING_API_KEY',
  'RESEND_EMAIL_MARKETING_API_KEY',
  'RESEND_MARKETING_KEY',
  'RESEND_API_KEY_MARKETING',
];

export interface ResolvedKey { key: string | null; envName: string | null; keyFallback: boolean }

/** NAMES (never values) of the configured environment variables that mention Resend, for diagnostics. */
export function resendKeyNames(): string[] {
  try {
    return Object.keys(Deno.env.toObject()).filter((n) => /RESEND/i.test(n)).sort().slice(0, 20);
  } catch {
    return [];
  }
}

/** Which key to use. `configuredEnvName` comes from admin_settings (a name, never a secret). */
export function resolveResendKey(purpose: ResendPurpose, configuredEnvName?: string | null): ResolvedKey {
  if (purpose === 'marketing') {
    const names = [configuredEnvName, ...MARKETING_KEY_CANDIDATES].filter((n): n is string => typeof n === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(n));
    for (const name of names) {
      const v = Deno.env.get(name);
      if (v) return { key: v, envName: name, keyFallback: false };
    }
    /* A dedicated marketing key stored under another name (…RESEND…MARKET…) is still found. */
    for (const name of resendKeyNames().filter((n) => /MARKET/i.test(n) && !/WEBHOOK|SECRET|SIGNING/i.test(n))) {
      const v = Deno.env.get(name);
      if (v) return { key: v, envName: name, keyFallback: false };
    }
  }
  const legacy = Deno.env.get('RESEND_API_KEY') ?? null;
  return { key: legacy, envName: legacy ? 'RESEND_API_KEY' : null, keyFallback: purpose === 'marketing' };
}

export interface ResendResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  json: T | null;
  /** Provider error name/message, safe to store (never contains the key). */
  error: string | null;
  attempts: number;
  retryable: boolean;
}

const BASE = 'https://api.resend.com';

export async function resendFetch<T = Record<string, unknown>>(
  key: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  opts: { idempotencyKey?: string; retries?: number; timeoutMs?: number } = {},
): Promise<ResendResult<T>> {
  const retries = Math.max(0, Math.min(opts.retries ?? 3, 5));
  let attempt = 0;
  let last: ResendResult<T> = { ok: false, status: 0, json: null, error: 'NOT_ATTEMPTED', attempts: 0, retryable: true };
  while (attempt <= retries) {
    attempt += 1;
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${key}`, 'User-Agent': 'homatch-email/1' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey.slice(0, 256);
      const res = await fetch(`${BASE}${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      });
      const json = await res.json().catch(() => null) as T | null;
      const retryable = res.status === 429 || res.status >= 500;
      const message = (json as { message?: unknown; name?: unknown } | null);
      last = {
        ok: res.ok, status: res.status, json, attempts: attempt, retryable,
        error: res.ok ? null : String(message?.name ?? message?.message ?? `HTTP_${res.status}`).slice(0, 300),
      };
      if (res.ok || !retryable || attempt > retries) return last;
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10_000) : backoff(attempt));
    } catch (e) {
      last = { ok: false, status: 0, json: null, error: (e as Error)?.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR', attempts: attempt, retryable: true };
      if (attempt > retries) return last;
      await sleep(backoff(attempt));
    }
  }
  return last;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoff = (attempt: number) => Math.min(250 * 2 ** (attempt - 1), 4000) + Math.floor(Math.random() * 150);

/* ── transactional /emails ───────────────────────────────────────────────── */

export interface OutboundEmail {
  from: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string | string[];
  headers?: Record<string, string>;
  tags?: Array<{ name: string; value: string }>;
  idempotencyKey: string;
}

/** One message. Acceptance by the API is NOT delivery; delivery comes from the webhook. */
export async function sendEmail(key: string, m: OutboundEmail): Promise<ResendResult<{ id?: string }>> {
  const tags = (m.tags ?? [])
    .map((t) => ({ name: t.name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256), value: t.value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256) }))
    .filter((t) => t.name && t.value);
  return await resendFetch<{ id?: string }>(key, 'POST', '/emails', {
    from: m.from, to: [m.to], subject: m.subject, html: m.html, text: m.text,
    reply_to: m.replyTo, headers: m.headers && Object.keys(m.headers).length ? m.headers : undefined,
    tags: tags.length ? tags : undefined,
  }, { idempotencyKey: m.idempotencyKey });
}

/** RFC 8058 one-click unsubscribe headers for a marketing message. */
export function listUnsubscribeHeaders(url: string, mailto?: string | null): Record<string, string> {
  const parts = [`<${url}>`];
  if (mailto) parts.push(`<mailto:${mailto}>`);
  return { 'List-Unsubscribe': parts.join(', '), 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
}

/* ── domains ─────────────────────────────────────────────────────────────── */

export interface ResendDomain {
  id: string;
  name: string;
  status: string;
  region?: string;
  records?: Array<{ record: string; name: string; type: string; ttl?: string; status?: string; value: string; priority?: number }>;
}

export const createDomain = (key: string, name: string, region: string, idempotencyKey: string) =>
  resendFetch<ResendDomain>(key, 'POST', '/domains', { name, region }, { idempotencyKey });
export const getDomain = (key: string, id: string) => resendFetch<ResendDomain>(key, 'GET', `/domains/${encodeURIComponent(id)}`);
export const verifyDomain = (key: string, id: string) => resendFetch(key, 'POST', `/domains/${encodeURIComponent(id)}/verify`, {});
export const deleteDomain = (key: string, id: string) => resendFetch(key, 'DELETE', `/domains/${encodeURIComponent(id)}`);
export const listDomains = (key: string) => resendFetch<{ data?: ResendDomain[] }>(key, 'GET', '/domains');

/** Resend's domain status, in HOMATCH's vocabulary. Only Resend's "verified" is VERIFIED. */
export function mapDomainStatus(providerStatus: string | null | undefined): string {
  switch (String(providerStatus ?? '').toLowerCase()) {
    case 'verified': return 'VERIFIED';
    case 'pending': return 'VERIFICATION_PENDING';
    case 'not_started': return 'DNS_PENDING';
    case 'failed': return 'FAILED';
    case 'temporary_failure': return 'VERIFICATION_PENDING';
    case 'partially_verified': return 'VERIFICATION_PENDING';
    case 'partially_failed': return 'FAILED';
    default: return 'DNS_PENDING';
  }
}

/* ── receiving ───────────────────────────────────────────────────────────── */

export interface ReceivedEmail {
  id: string;
  from?: string;
  to?: string[];
  cc?: string[];
  reply_to?: string[];
  received_for?: string[];
  subject?: string;
  html?: string | null;
  text?: string | null;
  headers?: Record<string, unknown>;
  message_id?: string;
  created_at?: string;
  authentication?: { spf?: string; dkim?: string; dmarc?: string } | null;
  attachments?: Array<{ id: string; filename?: string; content_type?: string; content_disposition?: string | null; content_id?: string | null; size?: number }>;
}

export const getReceivedEmail = (key: string, id: string) =>
  resendFetch<ReceivedEmail>(key, 'GET', `/emails/receiving/${encodeURIComponent(id)}`, undefined, { retries: 2 });

/* ── account usage (full-access key) ─────────────────────────────────────── */

export const getUsage = (key: string) => resendFetch(key, 'GET', '/usage', undefined, { retries: 1 });

/* ── broadcasts (consented bulk marketing; contact-priced on Resend Marketing) ── */

export const createSegment = (key: string, name: string, idempotencyKey: string) =>
  resendFetch<{ id?: string }>(key, 'POST', '/segments', { name }, { idempotencyKey });
export const createContact = (key: string, c: { email: string; firstName?: string | null; segmentId: string }, idempotencyKey: string) =>
  resendFetch<{ id?: string }>(key, 'POST', '/contacts', {
    email: c.email, first_name: c.firstName ?? undefined, unsubscribed: false, segments: [{ id: c.segmentId }],
  }, { idempotencyKey });
export const createBroadcast = (key: string, b: { segmentId: string; from: string; subject: string; html: string; text?: string; replyTo?: string; name: string }, idempotencyKey: string) =>
  resendFetch<{ id?: string }>(key, 'POST', '/broadcasts', {
    segment_id: b.segmentId, from: b.from, subject: b.subject, html: b.html, text: b.text, reply_to: b.replyTo, name: b.name, send: false,
  }, { idempotencyKey });
export const sendBroadcast = (key: string, id: string, idempotencyKey: string) =>
  resendFetch(key, 'POST', `/broadcasts/${encodeURIComponent(id)}/send`, {}, { idempotencyKey });

/* ── addresses ───────────────────────────────────────────────────────────── */

const ROUTE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** 26 base32 characters = 130 bits from the platform CSPRNG. */
export function newRouteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(26));
  let out = '';
  for (const b of bytes) out += ROUTE_ALPHABET[b & 31];
  return out;
}

export function replyAddress(token: string, domain: string): string {
  return `r-${token}@${domain}`;
}

/** The route token in any of the addresses, if one is addressed to the reply domain. */
export function routeTokenFrom(addresses: string[], domain: string): string | null {
  const d = domain.toLowerCase();
  for (const raw of addresses) {
    const m = /<?([^<>\s@]+)@([^<>\s]+)>?$/.exec(String(raw).trim().toLowerCase());
    if (!m || m[2] !== d) continue;
    const t = /^r-([a-z2-7]{26})$/.exec(m[1]);
    if (t) return t[1];
  }
  return null;
}

/** "Name <a@b>" for a sender; the name is stripped of anything that could break the header. */
export function formatFrom(name: string | null | undefined, address: string): string {
  const clean = String(name ?? '').replace(/[<>"\r\n]/g, '').trim().slice(0, 80);
  return clean ? `"${clean}" <${address}>` : address;
}

/** Which provider limits are at or above the alert threshold (percent of limit). */
export function usageAlerts(u: Record<string, unknown> | null, pct: number): string[] {
  if (!u) return [];
  const out: string[] = [];
  const check = (name: string, v: unknown) => {
    const o = v as { used?: number; limit?: number | null } | undefined;
    if (o && typeof o.used === 'number' && typeof o.limit === 'number' && o.limit > 0 && o.used / o.limit * 100 >= pct) out.push(name);
  };
  const emails = (u.emails ?? {}) as Record<string, unknown>;
  check('emails_daily', emails.daily); check('emails_monthly', emails.monthly);
  check('contacts', u.contacts); check('domains', u.domains); check('broadcasts', u.broadcasts);
  return out;
}

/**
 * The provider's verdict on whether a received email really comes from its From domain.
 * PASS: DMARC passed. FAIL: DMARC failed, or SPF and DKIM both failed. UNKNOWN: anything
 * else (no verdicts, or a domain without DMARC). Verdicts arrive as "pass" or {result:"pass"}.
 */
export function senderAuthentication(auth: unknown): 'PASS' | 'FAIL' | 'UNKNOWN' {
  if (!auth || typeof auth !== 'object') return 'UNKNOWN';
  const a = auth as Record<string, unknown>;
  const verdict = (v: unknown): string => {
    const raw = v && typeof v === 'object' ? (v as Record<string, unknown>).result ?? (v as Record<string, unknown>).status : v;
    return String(raw ?? '').trim().toLowerCase();
  };
  const dmarc = verdict(a.dmarc), spf = verdict(a.spf), dkim = verdict(a.dkim);
  if (dmarc === 'pass') return 'PASS';
  if (dmarc === 'fail' || (spf === 'fail' && dkim === 'fail')) return 'FAIL';
  return 'UNKNOWN';
}
