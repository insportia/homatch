// NOTIFICATION EMAIL — the email leg of the one notification pipeline.
//
// Uses the canonical HOMATCH email provider (Resend, from the verified
// auth.homatch.live sender). Every attempt is logged in
// notification_deliveries, unique on (notification_id, channel).
//
// CLAIM BEFORE SEND. The delivery row is inserted as QUEUED first; only the
// run whose insert wins the unique key sends, and it then moves the row to
// SENT or FAILED. A concurrent or retried run hits the unique key and sends
// nothing. Within one run every retry carries the same Resend
// Idempotency-Key (derived from the delivery id), so a request that reached
// Resend but whose answer was lost is not delivered twice either. A run that
// dies between claim and send leaves the row QUEUED: at most once, never twice.
//
// Without a configured provider the attempt is logged SKIPPED, never faked as
// sent.

// deno-lint-ignore no-explicit-any
type Sb = any;

export interface EmailContent { subject: string; html: string; text: string }

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

/** Wait before retry n (0-based): 0.4 s, 1.2 s; a Retry-After from a 429 is honoured up to 5 s. */
export function retryDelayMs(attempt: number, retryAfterHeader?: string | null): number {
  const base = 400 * 3 ** attempt;
  const ra = Number(retryAfterHeader);
  return Number.isFinite(ra) && ra > 0 ? Math.min(5000, Math.max(base, ra * 1000)) : base;
}

export const MAX_SEND_ATTEMPTS = 3;

interface FetchResponseLike { ok: boolean; status: number; headers?: { get(k: string): string | null }; json(): Promise<unknown> }
export type FetchLike = (url: string, init: RequestInit) => Promise<FetchResponseLike>;
interface Attempt { status: number | null; id?: string; error?: string; retryAfter: string | null }

/** One POST to Resend. Never throws: a network failure is status null. */
async function resendOnce(apiKey: string, idempotencyKey: string, payload: Record<string, unknown>, fetchImpl: FetchLike): Promise<Attempt> {
  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
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

export interface SendOptions { fetchImpl?: FetchLike; sleep?: (ms: number) => Promise<void> }

/**
 * Send with retries for transient failures only, every attempt under one idempotency key.
 * Exported for tests; `fetchImpl` and `sleep` are injectable.
 */
export async function deliverWithRetry(apiKey: string, idempotencyKey: string, payload: Record<string, unknown>, opts: SendOptions = {}): Promise<{
  outcome: SendOutcome; status: number | null; providerMessageId?: string; error?: string; attempts: number;
}> {
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: Attempt = { status: null, retryAfter: null };
  let outcome: SendOutcome = 'RETRY';
  let attempts = 0;
  for (let attempt = 0; attempt < MAX_SEND_ATTEMPTS; attempt++) {
    attempts = attempt + 1;
    last = await resendOnce(apiKey, idempotencyKey, payload, fetchImpl);
    outcome = classifyResendStatus(last.status);
    if (outcome !== 'RETRY') break;
    if (attempt < MAX_SEND_ATTEMPTS - 1) await sleep(retryDelayMs(attempt, last.retryAfter));
  }
  return { outcome, status: last.status, providerMessageId: last.id, error: last.error, attempts };
}

const isDuplicate = (error: unknown) => /duplicate|unique/i.test(String((error as { message?: string } | null)?.message ?? ''));

export async function sendNotificationEmail(sb: Sb, input: {
  userId: string; notificationId: string | null; eventKey?: string | null; source?: string; content: EmailContent;
}, opts: SendOptions = {}): Promise<{ status: 'SENT' | 'SKIPPED' | 'FAILED'; reason?: string }> {
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
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return skip('NO_EMAIL');
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  const key = deno?.env.get('RESEND_API_KEY');
  if (!key) return skip('NO_PROVIDER');

  /* THE CLAIM. Only the run whose insert wins (notification_id, channel) sends. */
  const deliveryId = crypto.randomUUID();
  const { error: claimError } = await sb.from('notification_deliveries')
    .insert({ id: deliveryId, ...base, status: 'QUEUED', provider: 'RESEND' });
  if (claimError) {
    if (isDuplicate(claimError)) return { status: 'SKIPPED', reason: 'ALREADY_ATTEMPTED' };
    /* No claim, no send: without the row a retry could not tell this one happened. */
    console.error('[notify-email] claim failed', String((claimError as { message?: string }).message ?? claimError));
    return { status: 'FAILED', reason: 'CLAIM_FAILED' };
  }

  const r = await deliverWithRetry(key, resendIdempotencyKey(deliveryId), {
    from: 'HOMATCH <no-reply@auth.homatch.live>', to: [to],
    subject: input.content.subject.slice(0, 200), html: input.content.html, text: input.content.text,
  }, opts);

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
}): EmailContent {
  const dir = o.rtl ? 'rtl' : 'ltr';
  const align = o.rtl ? 'right' : 'left';
  const section = (label: string, text: string | null) => (text ? `<h2 style="font-size:14px;margin:20px 0 6px;color:#0C1119">${esc(label)}</h2><p style="margin:0;font-size:14px;line-height:1.55;color:#333">${esc(text)}</p>` : '');
  const html = `<!doctype html><html lang="${esc(o.lang)}" dir="${dir}"><body style="margin:0;background:#f5f5f2;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;text-align:${align}" dir="${dir}">
<tr><td style="background:#0C1119;color:#E8B04B;padding:16px 24px;border-radius:12px 12px 0 0;font-weight:bold;letter-spacing:.08em"><img src="https://homatch.live/images/logo/homatch-icon.png" width="28" height="28" alt="" style="vertical-align:middle;border:0;margin-${o.rtl ? 'left' : 'right'}:10px">HOMATCH</td></tr>
<tr><td style="padding:24px">
<h1 style="font-size:20px;margin:0 0 10px;color:#0C1119">${esc(o.title)}</h1>
<p style="margin:0;font-size:15px;line-height:1.55;color:#222">${esc(o.body)}</p>
${section(o.whyLabel, o.why)}${section(o.analysisLabel, o.analysis)}${section(o.nextLabel, o.next)}
<p style="margin:24px 0 0"><a href="${esc(o.ctaUrl)}" style="display:inline-block;background:#E8B04B;color:#161309;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:8px">${esc(o.ctaLabel)}</a></p>
</td></tr><tr><td style="padding:0 24px 20px;font-size:12px;color:#777">${esc(o.footer)}</td></tr></table></td></tr></table></body></html>`;
  const text = [o.title, '', o.body, o.why ? `\n${o.whyLabel}: ${o.why}` : '', o.analysis ? `\n${o.analysisLabel}: ${o.analysis}` : '',
    o.next ? `\n${o.nextLabel}: ${o.next}` : '', `\n${o.ctaLabel}: ${o.ctaUrl}`, `\n\n${o.footer}`].join('\n');
  return { subject: o.title, html, text };
}
