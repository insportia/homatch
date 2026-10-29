// TRANSACTIONAL EMAIL — the one-click unsubscribe for OPTIONAL notification mail.
//
// Served from email-webhook (verify_jwt = false, already deployed) for the same reason
// as the Email Studio link: a person clicking in a mail client has no session, and
// production is at the edge-function cap. It does not weaken the webhook: provider
// events still need the Svix signature; this needs OUR signature, HMAC-SHA256 over
// "notify-email:<user id>:<category>" keyed with the service role key
// (transactionalEmail.ts unsubscribeUrl). A forged or altered link does nothing.
//
// It turns ONE optional category off (notification_email_unsubscribe). Essential mail
// (payment failed, subscription state) cannot be unsubscribed from and is not touched.
// GET applies it and shows the confirmation (one click); POST is the RFC 8058 form
// mail clients send from the List-Unsubscribe-Post header.

import { verifyUnsubscribeToken } from './suppression.ts';
import { copy, isRtl, isUnsubscribeCategory, pickLang, unsubscribeMessage, type Lang } from './notificationCopy.ts';

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> };

type PageKind = 'done_ai_results' | 'done_billing' | 'invalid' | 'error';

const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));

export function unsubscribePage(lang: Lang, kind: PageKind, status = 200): Response {
  const dir = isRtl(lang) ? 'rtl' : 'ltr';
  const title = copy(lang, 'ntf_unsub_title');
  const message = copy(lang, `ntf_unsub_${kind}`);
  const settings = copy(lang, 'ntf_unsub_settings');
  const html = `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#0C1119;color:#f5f1e6;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px;box-sizing:border-box}
.card{max-width:440px;width:100%;background:#141B26;border:1px solid rgba(232,176,75,.25);border-radius:16px;padding:28px;text-align:center;box-sizing:border-box}
.mark{font-weight:800;letter-spacing:.18em;color:#E8B04B;font-size:13px;margin:0 0 16px}h1{font-size:18px;margin:0 0 12px}p{font-size:15px;line-height:1.6;color:#d6d0c2;margin:0;overflow-wrap:anywhere}a{display:inline-block;margin-top:20px;color:#E8B04B}</style></head>
<body><main class="card"><p class="mark">HOMATCH</p><h1>${esc(title)}</h1><p>${esc(message)}</p>${kind.startsWith('done') ? `<a href="https://homatch.live/notifications">${esc(settings)}</a>` : ''}</main></body></html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}

/** True when this request is a notification unsubscribe link (the webhook routes it here). */
export function isNotificationUnsubscribe(url: URL): boolean {
  return url.searchParams.has('nu');
}

export async function handleNotificationUnsubscribe(url: URL, sb: Rpc, serviceKey: string | undefined): Promise<Response> {
  const userId = url.searchParams.get('nu') ?? '';
  const category = url.searchParams.get('c') ?? '';
  const token = url.searchParams.get('t') ?? '';
  const fallback: Lang = 'ka';
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !isUnsubscribeCategory(category) || !/^[0-9a-f]{64}$/.test(token)) {
    return unsubscribePage(fallback, 'invalid', 400);
  }
  if (!serviceKey) return unsubscribePage(fallback, 'error', 503);
  if (!(await verifyUnsubscribeToken(unsubscribeMessage(userId, category), token, serviceKey))) {
    return unsubscribePage(fallback, 'invalid', 400);
  }
  try {
    const { data, error } = await sb.rpc('notification_email_unsubscribe', { p_user_id: userId, p_category: category });
    if (error) throw new Error(error.message);
    const r = (data ?? {}) as { ok?: boolean; language?: string | null };
    if (!r.ok) return unsubscribePage(fallback, 'invalid', 404);
    return unsubscribePage(pickLang(r.language), category === 'billing' ? 'done_billing' : 'done_ai_results');
  } catch (e) {
    console.error('[notification-unsubscribe] failed:', (e as Error)?.message);
    return unsubscribePage(fallback, 'error', 500);
  }
}
