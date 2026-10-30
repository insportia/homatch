// NOTIFICATION EMAIL — the email leg of the one notification pipeline.
//
//   business event -> notify() -> notifications row -> notification_deliveries row
//   -> Resend -> provider webhook (email-webhook) -> delivery status
//
// Uses the canonical HOMATCH email provider (Resend, from the verified
// auth.homatch.live sender) with the TRANSACTIONAL key only (RESEND_API_KEY).
// The Email Marketing key is never read here: a marketing outage, a marketing
// key rotation or a marketing reputation problem must not stop a payment notice.
//
// CLAIM BEFORE SEND. The delivery row is inserted as QUEUED first (unique on
// notification_id, channel); only the run whose insert wins sends. Every attempt
// for one delivery, in-request or from the sweeper, carries the same Resend
// Idempotency-Key (derived from the delivery id), so a request that reached
// Resend but whose answer was lost is not delivered twice.
//
// DURABLE RETRIES (20261207150000_notification_delivery_reliability.sql). The
// rendered message is kept on the row (payload: subject, html, text, headers;
// never the address, which is read at send time). A transient failure (no
// answer, 429, 5xx) moves the row to RETRYING with next_attempt_at; the
// jobs-worker tick calls retryDueDeliveries(), which claims due RETRYING rows
// and QUEUED rows whose sender died mid-send, and tries again with exponential
// backoff. FAILED is terminal: a permanent provider refusal (other 4xx) or the
// last allowed attempt. Retries stop before Resend forgets the idempotency key
// (24 h), so a retry can never become a second copy.
//
// Without a configured provider the first attempt is logged SKIPPED, never
// faked as sent.

import { emailHead, emailHeaderRow } from './emailBrand.ts';

// deno-lint-ignore no-explicit-any
type Sb = any;

export interface EmailContent { subject: string; html: string; text: string }

/** The transactional key. Deliberately NOT resolveResendKey('marketing'): see the header. */
export function transactionalResendKey(): string | null {
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  try { return deno?.env.get('RESEND_API_KEY') || null; } catch { return null; }
}

export const NOTIFICATION_SENDER = 'HOMATCH <no-reply@auth.homatch.live>';

/** The Resend Idempotency-Key for one delivery row (Resend accepts up to 256 characters). */
export function resendIdempotencyKey(deliveryId: string): string {
  return `homatch-notification-email/${String(deliveryId).slice(0, 200)}`;
}

/**
 * What a Resend answer means for the attempt.
 *   SENT       2xx
 *   RETRY      no answer (network, timeout), 429 rate limit, any 5xx
 *   PERMANENT  every other 4xx: the request itself is wrong, sending it again changes nothing
 */
export type SendOutcome = 'SENT' | 'RETRY' | 'PERMANENT';
export function classifyResendStatus(status: number | null | undefined): SendOutcome {
  if (status == null || !Number.isFinite(status) || status <= 0) return 'RETRY';
  if (status >= 200 && status < 300) return 'SENT';
  if (status === 429 || status >= 500) return 'RETRY';
  return 'PERMANENT';
}

/** In-request wait before quick retry n (0-based): 0.4 s, 1.2 s; a Retry-After from a 429 is honoured up to 5 s. */
export function retryDelayMs(attempt: number, retryAfterHeader?: string | null): number {
  const base = 400 * 3 ** attempt;
  const ra = Number(retryAfterHeader);
  return Number.isFinite(ra) && ra > 0 ? Math.min(5000, Math.max(base, ra * 1000)) : base;
}

/** Quick provider calls inside ONE attempt (a blip should not wait a minute). */
export const MAX_SEND_ATTEMPTS = 3;

/** Durable attempts per delivery before it is FAILED for good. */
export const MAX_DELIVERY_ATTEMPTS = 6;

/** No retry after this: Resend keeps an Idempotency-Key for 24 h. Mirrored in the claim RPC. */
export const RETRY_WINDOW_MS = 23 * 3600_000;

const MINUTE = 60_000;
const BACKOFF_CAP_MS = 6 * 3600_000;

/**
 * The wait before the next durable attempt, after `attemptsSoFar` attempts:
 * 1 min, 5 min, 25 min, 125 min, then 6 h (cap). Five waits add up to about 8.6 h,
 * well inside RETRY_WINDOW_MS. A provider Retry-After is honoured when longer.
 */
export function deliveryBackoffMs(attemptsSoFar: number, retryAfterSeconds?: number | string | null): number {
  const n = Math.max(1, Math.floor(Number(attemptsSoFar) || 1));
  const base = Math.min(BACKOFF_CAP_MS, MINUTE * 5 ** (n - 1));
  const ra = Number(retryAfterSeconds);
  return Number.isFinite(ra) && ra > 0 ? Math.min(BACKOFF_CAP_MS, Math.max(base, ra * 1000)) : base;
}

export type DeliveryStatus = 'QUEUED' | 'RETRYING' | 'SENT' | 'DELIVERED' | 'BOUNCED' | 'COMPLAINED' | 'FAILED' | 'SKIPPED';

export interface DeliveryState {
  status: 'SENT' | 'RETRYING' | 'FAILED';
  next_attempt_at: string | null;
  last_error: string | null;
}

/**
 * Where a delivery goes after an attempt. Pure, so the policy is tested once:
 * SENT is SENT; PERMANENT is FAILED; RETRY is RETRYING with a backoff, unless this
 * was the last allowed attempt or the next one would fall outside the idempotency
 * window, in which case it is FAILED.
 */
export function nextDeliveryState(input: {
  outcome: SendOutcome; attempts: number; maxAttempts?: number | null; now?: Date; createdAt?: string | Date | null;
  error?: string | null; status?: number | null; retryAfter?: string | null;
}): DeliveryState {
  const now = input.now ?? new Date();
  const detail = `${input.status ? `HTTP ${input.status}: ` : ''}${input.error ?? 'SEND_FAILED'}`;
  if (input.outcome === 'SENT') return { status: 'SENT', next_attempt_at: null, last_error: null };
  if (input.outcome === 'PERMANENT') return { status: 'FAILED', next_attempt_at: null, last_error: `PERMANENT ${detail}`.slice(0, 500) };
  const max = Math.max(1, Number(input.maxAttempts) || MAX_DELIVERY_ATTEMPTS);
  if (input.attempts >= max) return { status: 'FAILED', next_attempt_at: null, last_error: `MAX_ATTEMPTS ${detail}`.slice(0, 500) };
  const next = new Date(now.getTime() + deliveryBackoffMs(input.attempts, input.retryAfter));
  const created = input.createdAt ? new Date(input.createdAt) : now;
  if (next.getTime() - created.getTime() > RETRY_WINDOW_MS) {
    return { status: 'FAILED', next_attempt_at: null, last_error: `RETRY_WINDOW_EXPIRED ${detail}`.slice(0, 500) };
  }
  return { status: 'RETRYING', next_attempt_at: next.toISOString(), last_error: `TRANSIENT ${detail}`.slice(0, 500) };
}

interface FetchResponseLike { ok: boolean; status: number; headers?: { get(k: string): string | null }; json(): Promise<unknown> }
export type FetchLike = (url: string, init: RequestInit) => Promise<FetchResponseLike>;
interface Attempt { status: number | null; id?: string; error?: string; retryAfter: string | null }

/** One POST to Resend. Never throws: a network failure is status null. */
async function resendOnce(apiKey: string, idempotencyKey: string, payload: Record<string, unknown>, fetchImpl: FetchLike, timeoutMs = 20000): Promise<Attempt> {
  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string } | null;
    return {
      status: res.status,
      id: body?.id,
      error: res.ok ? undefined : String(body?.message ?? `Resend HTTP ${res.status}`),
      retryAfter: res.headers?.get('retry-after') ?? null,
    };
  } catch (err) {
    return { status: null, error: err instanceof Error ? err.message : String(err), retryAfter: null };
  }
}

export interface SendOptions {
  fetchImpl?: FetchLike; sleep?: (ms: number) => Promise<void>; now?: () => Date;
  /** Provider calls inside one attempt (default MAX_SEND_ATTEMPTS). The sweeper uses 1: its backoff IS the retry. */
  quickAttempts?: number;
  /** Per provider call (default 20 s). */
  timeoutMs?: number;
}

/**
 * Send with quick retries for transient failures only, every call under one idempotency key.
 * Exported for tests; `fetchImpl` and `sleep` are injectable.
 */
export async function deliverWithRetry(apiKey: string, idempotencyKey: string, payload: Record<string, unknown>, opts: SendOptions = {}): Promise<{
  outcome: SendOutcome; status: number | null; providerMessageId?: string; error?: string; attempts: number; retryAfter: string | null;
}> {
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: Attempt = { status: null, retryAfter: null };
  let outcome: SendOutcome = 'RETRY';
  let attempts = 0;
  const quick = Math.max(1, Math.min(MAX_SEND_ATTEMPTS, Math.floor(opts.quickAttempts ?? MAX_SEND_ATTEMPTS)));
  for (let attempt = 0; attempt < quick; attempt++) {
    attempts = attempt + 1;
    last = await resendOnce(apiKey, idempotencyKey, payload, fetchImpl, opts.timeoutMs);
    outcome = classifyResendStatus(last.status);
    if (outcome !== 'RETRY') break;
    if (attempt < quick - 1) await sleep(retryDelayMs(attempt, last.retryAfter));
  }
  return { outcome, status: last.status, providerMessageId: last.id, error: last.error, attempts, retryAfter: last.retryAfter };
}

const isDuplicate = (error: unknown) => /duplicate|unique/i.test(String((error as { message?: string } | null)?.message ?? ''));
/** The reliability columns are not there yet (function deployed before the migration). */
const isMissingColumn = (error: unknown) => /column|schema cache/i.test(String((error as { message?: string } | null)?.message ?? ''));
const validEmail = (v: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v ?? '').trim());

/** What is kept on the row so a later attempt sends exactly the same message. Never the address. */
export interface DeliveryPayload { from: string; subject: string; html: string; text: string; headers?: Record<string, string> }

export type SendResult = { status: 'SENT' | 'SKIPPED' | 'FAILED' | 'RETRYING'; reason?: string };

export interface DeliveryRow {
  id: string; user_id: string; attempts: number; max_attempts?: number | null; payload: DeliveryPayload | null;
  essential?: boolean | null; created_at?: string | null;
}

/**
 * One durable attempt for a row this run has claimed (status QUEUED, attempts already
 * counted). Writes the outcome guarded on (status QUEUED, attempts), so a slower run that
 * lost its lease cannot overwrite a newer answer. Never throws.
 */
export async function attemptDelivery(sb: Sb, row: DeliveryRow, opts: SendOptions = {}): Promise<SendResult> {
  const now = opts.now?.() ?? new Date();
  const write = (patch: Record<string, unknown>) =>
    sb.from('notification_deliveries')
      .update({ ...patch, updated_at: now.toISOString(), status_changed_at: now.toISOString() })
      .eq('id', row.id).eq('status', 'QUEUED').eq('attempts', row.attempts);
  try {
    if (!row.payload || !row.payload.subject) {
      await write({ status: 'FAILED', last_error: 'NO_PAYLOAD_TO_RETRY', next_attempt_at: null });
      return { status: 'FAILED', reason: 'NO_PAYLOAD_TO_RETRY' };
    }
    const { data: user } = await sb.from('users').select('email').eq('id', row.user_id).maybeSingle();
    if (!validEmail(user?.email)) {
      await write({ status: 'FAILED', last_error: 'NO_EMAIL', next_attempt_at: null });
      return { status: 'FAILED', reason: 'NO_EMAIL' };
    }
    const key = transactionalResendKey();
    const r = key
      ? await deliverWithRetry(key, resendIdempotencyKey(row.id), {
        from: row.payload.from || NOTIFICATION_SENDER, to: [String(user.email).trim()],
        subject: row.payload.subject.slice(0, 200), html: row.payload.html, text: row.payload.text,
        ...(row.payload.headers ? { headers: row.payload.headers } : {}),
      }, opts)
      : { outcome: 'RETRY' as SendOutcome, status: null, error: 'NO_PROVIDER', retryAfter: null, providerMessageId: undefined };
    const next = nextDeliveryState({
      outcome: r.outcome, attempts: row.attempts, maxAttempts: row.max_attempts, now, createdAt: row.created_at ?? now,
      error: r.error ?? null, status: r.status, retryAfter: r.retryAfter,
    });
    await write({
      status: next.status, next_attempt_at: next.next_attempt_at, last_error: next.last_error,
      ...(next.status === 'SENT' ? { provider_message_id: r.providerMessageId ?? null, reason: null } : { reason: next.last_error }),
    });
    return next.status === 'SENT' ? { status: 'SENT' } : { status: next.status, reason: next.last_error ?? undefined };
  } catch (e) {
    /* The row stays QUEUED; the sweeper reclaims it once its lease is stale. */
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[notify-email] attempt failed', msg);
    return { status: 'FAILED', reason: `ERROR: ${msg}`.slice(0, 300) };
  }
}

export async function sendNotificationEmail(sb: Sb, input: {
  userId: string; notificationId: string | null; eventKey?: string | null; source?: string; content: EmailContent;
  /** true: money or account state, always sent. false: optional, a bounce/complaint suppression stops it. Absent: the caller's own policy (legacy callers). */
  essential?: boolean;
  /** The optional-mail switch it belongs to (notificationCopy.ts EmailCategory), for the log. */
  category?: string | null;
  /** Extra provider headers, e.g. List-Unsubscribe for optional mail. */
  headers?: Record<string, string>;
}, opts: SendOptions = {}): Promise<SendResult> {
  const now = opts.now?.() ?? new Date();
  const base = {
    notification_id: input.notificationId, user_id: input.userId, channel: 'EMAIL',
    source: input.source ?? 'meta_ads', event_key: input.eventKey ?? null,
  };
  /* A terminal SKIPPED row is its own claim: written once, never re-attempted. */
  const skip = async (reason: string): Promise<{ status: 'SKIPPED'; reason: string }> => {
    const { error } = await sb.from('notification_deliveries').insert({ ...base, status: 'SKIPPED', reason });
    if (error && isDuplicate(error)) return { status: 'SKIPPED', reason: 'ALREADY_ATTEMPTED' };
    return { status: 'SKIPPED', reason };
  };
  /* A cheap early exit; the claim below is what actually decides. */
  if (input.notificationId) {
    const { data: prior } = await sb.from('notification_deliveries').select('status')
      .eq('notification_id', input.notificationId).eq('channel', 'EMAIL').maybeSingle();
    if (prior) return { status: 'SKIPPED', reason: 'ALREADY_ATTEMPTED' };
  }
  const { data: user } = await sb.from('users').select('email').eq('id', input.userId).maybeSingle();
  const to = String(user?.email ?? '').trim();
  if (!validEmail(to)) return skip('NO_EMAIL');
  const key = transactionalResendKey();
  if (!key) return skip('NO_PROVIDER');

  const payload: DeliveryPayload = {
    from: NOTIFICATION_SENDER, subject: input.content.subject.slice(0, 200), html: input.content.html, text: input.content.text,
    ...(input.headers ? { headers: input.headers } : {}),
  };

  /* THE CLAIM. Only the run whose insert wins (notification_id, channel) sends. */
  const deliveryId = crypto.randomUUID();
  let legacy = false;
  let { error: claimError } = await sb.from('notification_deliveries').insert({
    id: deliveryId, ...base, status: 'QUEUED', provider: 'RESEND',
    attempts: 1, max_attempts: MAX_DELIVERY_ATTEMPTS, last_attempt_at: now.toISOString(), payload,
    essential: input.essential ?? null, category: input.category ?? null,
  });
  if (claimError && !isDuplicate(claimError) && isMissingColumn(claimError)) {
    /* Deployed ahead of the migration: claim the old way, send once, no durable retry. */
    legacy = true;
    ({ error: claimError } = await sb.from('notification_deliveries').insert({ id: deliveryId, ...base, status: 'QUEUED', provider: 'RESEND' }));
  }
  if (claimError) {
    if (isDuplicate(claimError)) return { status: 'SKIPPED', reason: 'ALREADY_ATTEMPTED' };
    /* No claim, no send: without the row a retry could not tell this one happened. */
    console.error('[notify-email] claim failed', String((claimError as { message?: string }).message ?? claimError));
    return { status: 'FAILED', reason: 'CLAIM_FAILED' };
  }

  if (!legacy) {
    return attemptDelivery(sb, {
      id: deliveryId, user_id: input.userId, attempts: 1, max_attempts: MAX_DELIVERY_ATTEMPTS, payload,
      essential: input.essential ?? null, created_at: now.toISOString(),
    }, opts);
  }

  const r = await deliverWithRetry(key, resendIdempotencyKey(deliveryId), { ...payload, to: [to] }, opts);
  const finish = (patch: Record<string, unknown>) =>
    sb.from('notification_deliveries').update(patch).eq('id', deliveryId).eq('status', 'QUEUED');
  if (r.outcome === 'SENT') {
    await finish({ status: 'SENT', provider_message_id: r.providerMessageId ?? null });
    return { status: 'SENT' };
  }
  const kind = r.outcome === 'PERMANENT' ? 'PERMANENT' : 'TRANSIENT';
  const reason = `${kind}${r.status ? ` HTTP ${r.status}` : ''}: ${r.error ?? 'SEND_FAILED'}`.slice(0, 300);
  await finish({ status: 'FAILED', reason });
  return { status: 'FAILED', reason };
}

/* ── The retry sweeper (called from the jobs-worker tick) ─────────────── */

/** May an optional delivery still go out? A suppression or the email switch turned off since then stops it. */
async function stillWanted(sb: Sb, row: DeliveryRow): Promise<string | null> {
  if (row.essential !== false) return null;
  const { data: prefs } = await sb.from('notification_preferences')
    .select('email_enabled, email_suppressed_at').eq('user_id', row.user_id).maybeSingle();
  if (prefs?.email_enabled === false) return 'OPTED_OUT';
  if (prefs?.email_suppressed_at) return 'SUPPRESSED';
  return null;
}

/**
 * Claim due deliveries (RETRYING whose time has come, QUEUED whose sender died) and try
 * each once more. Never throws: a tick must carry on.
 */
export async function retryDueDeliveries(sb: Sb, opts: SendOptions & { limit?: number } = {}): Promise<{
  claimed: number; sent: number; retrying: number; failed: number; skipped: number;
}> {
  const out = { claimed: 0, sent: 0, retrying: 0, failed: 0, skipped: 0 };
  try {
    const { data, error } = await sb.rpc('notification_delivery_claim_due', { p_limit: opts.limit ?? 10 });
    if (error) { console.error('[notify-email] retry claim failed', error.message ?? error); return out; }
    const rows = (Array.isArray(data) ? data : []) as DeliveryRow[];
    out.claimed = rows.length;
    for (const row of rows) {
      const unwanted = await stillWanted(sb, row).catch(() => null);
      if (unwanted) {
        const at = (opts.now?.() ?? new Date()).toISOString();
        await sb.from('notification_deliveries').update({ status: 'SKIPPED', reason: unwanted, last_error: unwanted, next_attempt_at: null, updated_at: at, status_changed_at: at })
          .eq('id', row.id).eq('status', 'QUEUED').eq('attempts', row.attempts);
        out.skipped++;
        continue;
      }
      /* One provider call per row, 10 s at most: a tick has a wall-clock budget, and the backoff is the retry. */
      const r = await attemptDelivery(sb, row, { quickAttempts: 1, timeoutMs: 10_000, ...opts });
      if (r.status === 'SENT') out.sent++;
      else if (r.status === 'RETRYING') out.retrying++;
      else out.failed++;
    }
  } catch (e) {
    console.error('[notify-email] retry tick failed', e instanceof Error ? e.message : String(e));
  }
  return out;
}

/* ── Provider delivery events (called from email-webhook) ─────────────── */

export type SuppressionReason = 'BOUNCED' | 'COMPLAINED' | 'PROVIDER_SUPPRESSED';

/**
 * What a Resend delivery event does to a notification delivery. Pure.
 *
 * Statuses only move forward: a late `delivered` never undoes a bounce or a complaint,
 * and `sent`, `opened`, `clicked` and `delivery_delayed` change nothing (a delay is not
 * an outcome). A complaint, a permanent (or undetermined) bounce and a provider
 * suppression suppress the person's OPTIONAL mail; essential mail still goes.
 */
export function providerEventEffect(current: string, eventType: string, bounceType?: string | null): {
  status: DeliveryStatus | null; suppress: SuppressionReason | null;
} {
  const inFlight = current === 'QUEUED' || current === 'RETRYING' || current === 'SENT';
  switch (eventType) {
    case 'email.delivered':
      return { status: inFlight ? 'DELIVERED' : null, suppress: null };
    case 'email.bounced': {
      const transient = /transient|temporary|soft/i.test(String(bounceType ?? ''));
      return {
        status: current === 'BOUNCED' || current === 'COMPLAINED' ? null : 'BOUNCED',
        suppress: transient ? null : 'BOUNCED',
      };
    }
    case 'email.complained':
      return { status: current === 'COMPLAINED' ? null : 'COMPLAINED', suppress: 'COMPLAINED' };
    case 'email.failed':
      return { status: inFlight ? 'FAILED' : null, suppress: null };
    case 'email.suppressed':
      return { status: current === 'BOUNCED' || current === 'COMPLAINED' || current === 'FAILED' ? null : 'FAILED', suppress: 'PROVIDER_SUPPRESSED' };
    default:
      return { status: null, suppress: null };
  }
}

/**
 * Apply a provider event to the notification delivery with this provider message id.
 * Returns false when no notification delivery carries that id (the event is someone
 * else's: a campaign, a studio email, a CRM reply), so the caller carries on.
 */
export async function applyProviderEvent(sb: Sb, providerMessageId: string | null, eventType: string, bounceType?: string | null, now = new Date()): Promise<boolean> {
  if (!providerMessageId) return false;
  const { data: row } = await sb.from('notification_deliveries')
    .select('id, user_id, status').eq('provider_message_id', providerMessageId).eq('channel', 'EMAIL').maybeSingle();
  if (!row) return false;
  const effect = providerEventEffect(String(row.status), eventType, bounceType);
  const at = now.toISOString();
  if (effect.status) {
    await sb.from('notification_deliveries').update({
      status: effect.status, updated_at: at, status_changed_at: at,
      ...(effect.status === 'DELIVERED' ? { delivered_at: at } : {}),
      ...(effect.status === 'FAILED' || effect.status === 'BOUNCED' || effect.status === 'COMPLAINED'
        ? { last_error: `${eventType}${bounceType ? ` (${String(bounceType).slice(0, 40)})` : ''}`, next_attempt_at: null } : {}),
    }).eq('id', row.id).eq('status', row.status);
  }
  if (effect.suppress) {
    await sb.from('notification_preferences').upsert(
      { user_id: row.user_id, email_suppressed_at: at, email_suppressed_reason: effect.suppress },
      { onConflict: 'user_id' },
    );
  }
  return true;
}

/**
 * Keep work running after the response has been sent. Returns true when the
 * edge runtime took it (EdgeRuntime.waitUntil); false means the caller has to
 * await it itself (tests, local runs), which is the documented fallback.
 */
export function runAfterResponse(work: Promise<unknown>): boolean {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt && typeof rt.waitUntil === 'function') {
    try { rt.waitUntil(work.catch(() => undefined)); return true; } catch { /* fall back to awaiting */ }
  }
  return false;
}

const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));

/** A plain, accessible, RTL-aware transactional email. */
export function renderNotificationEmail(o: {
  rtl: boolean; lang: string; title: string; body: string; whyLabel: string; why: string;
  analysisLabel: string; analysis: string | null; nextLabel: string; next: string | null;
  ctaLabel: string; ctaUrl: string; footer: string;
  /** Optional mail only: a one-click unsubscribe link under the footer. */
  unsubscribeLabel?: string | null; unsubscribeUrl?: string | null;
}): EmailContent {
  const dir = o.rtl ? 'rtl' : 'ltr';
  const align = o.rtl ? 'right' : 'left';
  const section = (label: string, text: string | null) => (text ? `<h2 style="font-size:14px;margin:20px 0 6px;color:#0C1119">${esc(label)}</h2><p style="margin:0;font-size:14px;line-height:1.55;color:#333">${esc(text)}</p>` : '');
  const unsub = o.unsubscribeUrl && o.unsubscribeLabel
    ? `<br><a href="${esc(o.unsubscribeUrl)}" style="color:#777;text-decoration:underline">${esc(o.unsubscribeLabel)}</a>` : '';
  // The header (official logo, wordmark, dark band) is emailBrand.ts: the same in every email.
  const html = `<!doctype html><html lang="${esc(o.lang)}" dir="${dir}"><head>${emailHead(esc(o.title))}</head><body style="margin:0;background:#f5f5f2;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f5f5f2"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="max-width:560px;background:#ffffff;border-radius:12px;text-align:${align}" dir="${dir}">
${emailHeaderRow({ rtl: o.rtl })}
<tr><td style="padding:24px">
<h1 style="font-size:20px;margin:0 0 10px;color:#0C1119">${esc(o.title)}</h1>
<p style="margin:0;font-size:15px;line-height:1.55;color:#222">${esc(o.body)}</p>
${section(o.whyLabel, o.why)}${section(o.analysisLabel, o.analysis)}${section(o.nextLabel, o.next)}
<p style="margin:24px 0 0"><a href="${esc(o.ctaUrl)}" style="display:inline-block;background:#E8B04B;color:#161309;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:8px">${esc(o.ctaLabel)}</a></p>
</td></tr><tr><td style="padding:0 24px 20px;font-size:12px;color:#777">${esc(o.footer)}${unsub}</td></tr></table></td></tr></table></body></html>`;
  const text = [o.title, '', o.body, o.why ? `\n${o.whyLabel}: ${o.why}` : '', o.analysis ? `\n${o.analysisLabel}: ${o.analysis}` : '',
    o.next ? `\n${o.nextLabel}: ${o.next}` : '', `\n${o.ctaLabel}: ${o.ctaUrl}`, `\n\n${o.footer}`,
    o.unsubscribeUrl && o.unsubscribeLabel ? `\n${o.unsubscribeLabel}: ${o.unsubscribeUrl}` : ''].join('\n');
  return { subject: o.title, html, text };
}
