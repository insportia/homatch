// TRANSACTIONAL EMAIL — the email leg for the events a person needs to hear about.
//
// Emailed: a verification or contract analysis they started has finished (or a
// verification could not finish), a Find Buyers / Tenants search they ran is done,
// a service they ran could not complete, their subscription started, renewed or
// ended, a payment failed, their free first use was delivered. Nothing here is
// marketing and nothing is sent in bulk: one notification, at most one email
// (notification_deliveries is unique on notification and channel).
//
// Which events, essential or optional, and every sentence: notificationCopy.ts
// (generated from the i18n bundle). The language is the one the person uses
// (users.preferred_language, kept current by the client), Georgian when unknown.
//
// Essential mail (payment failed, subscription state) is always sent. Optional
// mail honours the email switch, the per-category email switch and a
// bounce/complaint suppression, and carries a signed one-click unsubscribe link
// (List-Unsubscribe + List-Unsubscribe-Post, RFC 8058) served by email-webhook.
//
// Privacy: no report content, no document text, nobody else's data. Only a link
// to the signed-in page.

import { renderNotificationEmail, sendNotificationEmail, type EmailContent } from './notifyEmail.ts';
import {
  categoryOfEvent, deepLinkFor, emailDecision, emailEventFor, eventCopy, frameCopy, isEssential, isRtl, pickLang,
  unsubscribeMessage, type EmailCategory, type EmailEvent, type EmailPrefs,
} from './notificationCopy.ts';
import { signUnsubscribeToken } from './suppression.ts';

export { emailEventFor, pickLang };
export type { EmailEvent };

const SITE = 'https://homatch.live';
/** Only an app path may become a link; anything else falls back to the home page. */
export function safeLink(deepLink: string | null | undefined): string {
  const p = String(deepLink ?? '');
  return /^\/(?!\/)[\w\-./?=&%:]*$/.test(p) ? SITE + p : SITE + '/';
}

function env(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  try { return deno?.env.get(name); } catch { return undefined; }
}

/**
 * The signed one-click unsubscribe URL for one person and one category, or null
 * when it cannot be signed (no service key or project URL in this runtime).
 * HMAC-SHA256 over "notify-email:<user id>:<category>", keyed with the service role
 * key: the same scheme as the Email Studio link, verified in email-webhook.
 */
export async function unsubscribeUrl(userId: string, category: EmailCategory): Promise<string | null> {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const base = env('SUPABASE_URL');
  if (!key || !base || !/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const token = await signUnsubscribeToken(unsubscribeMessage(userId, category), key);
  return `${base.replace(/\/+$/, '')}/functions/v1/email-webhook?nu=${encodeURIComponent(userId)}&c=${category}&t=${token}`;
}

export function buildTransactionalEmail(
  event: EmailEvent, langRaw: string | null | undefined, deepLink: string | null | undefined, unsubscribe: string | null = null,
): EmailContent {
  const lang = pickLang(langRaw);
  const c = eventCopy(event, lang);
  const f = frameCopy(event, lang);
  const optional = !isEssential(event);
  return renderNotificationEmail({
    rtl: isRtl(lang), lang, title: c.title, body: c.body,
    whyLabel: f.whyLabel, why: f.why, analysisLabel: '', analysis: null, nextLabel: f.nextLabel, next: c.next,
    ctaLabel: c.cta, ctaUrl: safeLink(deepLink), footer: f.footer,
    unsubscribeLabel: optional && unsubscribe ? f.unsubscribe : null,
    unsubscribeUrl: optional ? unsubscribe : null,
  });
}

// deno-lint-ignore no-explicit-any
type Sb = any;

/** Preferences, tolerating a database the reliability migration has not reached yet. */
async function readPrefs(sb: Sb, userId: string): Promise<EmailPrefs | null> {
  const full = await sb.from('notification_preferences')
    .select('email_enabled, email_categories, email_suppressed_at').eq('user_id', userId).maybeSingle();
  if (!full?.error) return (full?.data ?? null) as EmailPrefs | null;
  const legacy = await sb.from('notification_preferences').select('email_enabled').eq('user_id', userId).maybeSingle();
  return (legacy?.data ?? null) as EmailPrefs | null;
}

/** After a notification row exists: email it if the event earns one and the person allows it. Never throws. */
export async function maybeEmailNotification(sb: Sb, input: {
  notificationId: string; userId: string; type: string; kind?: string | null; productType?: string | null; deepLink?: string | null;
}): Promise<string> {
  try {
    const event = emailEventFor(input.type, input.kind, input.productType);
    if (!event || typeof sb?.from !== 'function') return 'NOT_EMAILED';
    const [{ data: user }, prefs] = await Promise.all([
      sb.from('users').select('preferred_language').eq('id', input.userId).maybeSingle(),
      readPrefs(sb, input.userId),
    ]);
    const decision = emailDecision(event, prefs);
    if (decision !== 'SEND') return decision;
    const category = categoryOfEvent(event);
    const unsub = category ? await unsubscribeUrl(input.userId, category).catch(() => null) : null;
    const content = buildTransactionalEmail(event, user?.preferred_language, deepLinkFor(input.type, input.deepLink), unsub);
    const r = await sendNotificationEmail(sb, {
      userId: input.userId, notificationId: input.notificationId, source: 'transactional', eventKey: event, content,
      essential: isEssential(event), category,
      ...(unsub ? { headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } : {}),
    });
    return r.status;
  } catch (e) {
    console.error('[transactional-email] failed', e instanceof Error ? e.message : String(e));
    return 'ERROR';
  }
}
