/*
 * RESEND — a health probe that never sends an email.
 *
 * The old probe called GET /emails and reported "passed" for anything that was not a
 * 401. That was wrong twice over: a key created with "Sending access" (the right kind
 * for a sender) answers 401 restricted_api_key to every read and was reported as an
 * ERROR, while a 5xx outage was reported as PASSED. It also never looked at the two
 * other things a send needs: a verified sending domain and the webhook secret that lets
 * email-webhook accept delivery, bounce and complaint events.
 *
 * Now, with no email sent and no secret value ever returned:
 *
 *   1. GET /domains. 200 = a full-access key: the domain list is read and the sender's
 *      domain must be `verified`. 401 restricted_api_key = a valid sending-only key: it
 *      cannot read domains, so domain status is UNKNOWN (a successful real send is the
 *      proof). invalid_api_key / any other 401 or 403 = a bad key. Anything else = the
 *      provider could not be checked.
 *   2. RESEND_WEBHOOK_SECRET: absent, malformed (not `whsec_` + base64), or OK — and OK
 *      only after a synthetic payload signed with it passes the SAME verifier that
 *      email-webhook runs on every delivery.
 */

import { verifyInboundSignature } from './generated/inboundEmail.ts';

/** The sender every HOMATCH email uses (ResendEmailAdapter's default). */
export const RESEND_SENDER_DOMAIN = 'auth.homatch.live';

export type KeyState = 'VALID_FULL_ACCESS' | 'VALID_SENDING_ONLY' | 'INVALID' | 'UNREACHABLE';
export type DomainState = 'VERIFIED' | 'NOT_VERIFIED' | 'MISSING' | 'UNKNOWN';
export type WebhookSecretState = 'OK' | 'ABSENT' | 'MALFORMED';

export interface ResendProbeResult {
  key: KeyState;
  httpStatus: number | null;
  errorName: string | null;
  domain: DomainState;
  domainStatus: string | null;
  /** Names and statuses only — what a full-access key can see. */
  domains: Array<{ name: string; status: string }>;
  webhookSecret: WebhookSecretState;
  /** provider_health vocabulary. */
  status: 'REAL_TEST_PASSED' | 'CONFIGURED_UNVERIFIED' | 'ERROR';
  /** What an admin must fix, in the order it has to be fixed; null when nothing. */
  problem: string | null;
}

/** Classify GET /domains. Pure. */
export function classifyKey(httpStatus: number, body: unknown): { key: KeyState; errorName: string | null } {
  const name = typeof (body as { name?: unknown })?.name === 'string' ? String((body as { name: string }).name) : null;
  if (httpStatus === 200) return { key: 'VALID_FULL_ACCESS', errorName: null };
  if (httpStatus === 401 && name === 'restricted_api_key') return { key: 'VALID_SENDING_ONLY', errorName: name };
  if (httpStatus === 401 || httpStatus === 403) return { key: 'INVALID', errorName: name ?? `HTTP ${httpStatus}` };
  return { key: 'UNREACHABLE', errorName: name ?? `HTTP ${httpStatus}` };
}

/** The sender's domain in a /domains listing (exact name, or a parent domain). Pure. */
export function domainState(domains: Array<{ name: string; status: string }>, sender = RESEND_SENDER_DOMAIN): { domain: DomainState; status: string | null } {
  const host = sender.toLowerCase();
  const hit = domains
    .filter((d) => host === d.name.toLowerCase() || host.endsWith(`.${d.name.toLowerCase()}`))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (!hit) return { domain: 'MISSING', status: null };
  return { domain: hit.status === 'verified' ? 'VERIFIED' : 'NOT_VERIFIED', status: hit.status };
}

function isBase64(s: string): boolean {
  if (!s || s.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return false;
  try { atob(s); return true; } catch { return false; }
}

async function hmacBase64(secretBytes: Uint8Array, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
  let bin = '';
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * The webhook secret's state. OK means: it is `whsec_` + base64, and a payload signed
 * with it the way Svix signs passes verifyInboundSignature — email-webhook's own check.
 */
export async function webhookSecretState(secret: string | null | undefined, nowMs: number = Date.now()): Promise<WebhookSecretState> {
  const s = (secret ?? '').trim();
  if (!s) return 'ABSENT';
  const raw = s.startsWith('whsec_') ? s.slice('whsec_'.length) : '';
  if (!raw || !isBase64(raw)) return 'MALFORMED';
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  const id = 'msg_homatch_selftest';
  const timestamp = String(Math.floor(nowMs / 1000));
  const rawBody = JSON.stringify({ type: 'homatch.selftest', created_at: new Date(nowMs).toISOString() });
  const signature = `v1,${await hmacBase64(bytes, `${id}.${timestamp}.${rawBody}`)}`;
  const verdict = await verifyInboundSignature({ rawBody, id, timestamp, signature, secret: s, nowMs });
  return verdict.ok ? 'OK' : 'MALFORMED';
}

/** The provider_health row's status and the one problem to show. Pure. */
export function summarize(r: Omit<ResendProbeResult, 'status' | 'problem'>): Pick<ResendProbeResult, 'status' | 'problem'> {
  if (r.key === 'INVALID') return { status: 'ERROR', problem: `RESEND_API_KEY was rejected (${r.errorName ?? 'invalid'})` };
  if (r.key === 'UNREACHABLE') return { status: 'ERROR', problem: `Resend could not be checked (${r.errorName ?? 'no answer'})` };
  if (r.domain === 'NOT_VERIFIED') return { status: 'ERROR', problem: `Sending domain ${RESEND_SENDER_DOMAIN} is not verified in Resend (${r.domainStatus})` };
  if (r.domain === 'MISSING') return { status: 'ERROR', problem: `Sending domain ${RESEND_SENDER_DOMAIN} is not added in Resend` };
  if (r.webhookSecret === 'ABSENT') {
    return { status: 'CONFIGURED_UNVERIFIED', problem: 'RESEND_WEBHOOK_SECRET is unset: email-webhook refuses delivery, bounce and complaint events (503), so suppression cannot work' };
  }
  if (r.webhookSecret === 'MALFORMED') {
    return { status: 'CONFIGURED_UNVERIFIED', problem: 'RESEND_WEBHOOK_SECRET is not a Resend signing secret (expected whsec_…)' };
  }
  return { status: 'REAL_TEST_PASSED', problem: null };
}

/** The whole probe. One GET to Resend; nothing is sent; no secret value leaves this function. */
export async function probeResend(
  apiKey: string,
  webhookSecret: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<ResendProbeResult> {
  let httpStatus: number | null = null;
  let body: unknown = null;
  try {
    const res = await fetchImpl('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000),
    });
    httpStatus = res.status;
    body = await res.json().catch(() => null);
  } catch {
    httpStatus = null;
  }
  const { key, errorName } = httpStatus == null
    ? { key: 'UNREACHABLE' as KeyState, errorName: 'NETWORK' }
    : classifyKey(httpStatus, body);
  const list = key === 'VALID_FULL_ACCESS' && Array.isArray((body as { data?: unknown })?.data)
    ? ((body as { data: Array<{ name?: unknown; status?: unknown }> }).data)
      .map((d) => ({ name: String(d.name ?? ''), status: String(d.status ?? '') }))
      .filter((d) => d.name)
    : [];
  const dom = key === 'VALID_FULL_ACCESS' ? domainState(list) : { domain: 'UNKNOWN' as DomainState, status: null };
  const secretState = await webhookSecretState(webhookSecret);
  const base = { key, httpStatus, errorName, domain: dom.domain, domainStatus: dom.status, domains: list, webhookSecret: secretState };
  return { ...base, ...summarize(base) };
}
