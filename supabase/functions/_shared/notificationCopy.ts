// TRANSACTIONAL NOTIFICATION COPY AND POLICY: which event earns an email, whether it is
// essential, which switch governs it, and what it says in each of the six languages.
//
// Pure and Deno/Node neutral, so the edge functions and the unit tests read one answer.
// The sentences come from notificationCopy.generated.ts, which scripts/saas-notify-copy.mjs
// generates from src/i18n/translations.ts (source strings: scripts/saas-notify-i18n-data.mjs).
//
// ESSENTIAL vs OPTIONAL. Essential mail (a failed payment, the subscription starting,
// renewing or ending) is about money or the state of the account: it is always sent and
// carries no unsubscribe link. Everything else is optional: it honours the email switch
// (notification_preferences.email_enabled), the per-category email switch
// (notification_preferences.email_categories) and a bounce/complaint suppression, and it
// carries a one-click unsubscribe link for its category.
//
// PRIVACY. Every sentence is generic: no finding, clause, address or other person is ever
// put in an email. The only specific thing is the link to the signed-in page.

import { NOTIFICATION_COPY, NOTIFICATION_COPY_LANGS, type NotificationCopyLang } from './notificationCopy.generated.ts';

export type Lang = NotificationCopyLang;
export const LANGS: readonly Lang[] = NOTIFICATION_COPY_LANGS;

export type EmailEvent =
  | 'VERIFY_DONE' | 'VERIFY_FAILED' | 'CONTRACT_DONE' | 'SEARCH_DONE'
  | 'PAYMENT_OK' | 'PAYMENT_FAILED' | 'SERVICE_FAILED'
  | 'SUBSCRIPTION_ACTIVATED' | 'SUBSCRIPTION_RENEWED' | 'SUBSCRIPTION_ENDED' | 'SUBSCRIPTION_PAYMENT_DUE' | 'TRIAL_USED';

export const EMAIL_EVENTS: readonly EmailEvent[] = [
  'VERIFY_DONE', 'VERIFY_FAILED', 'CONTRACT_DONE', 'SEARCH_DONE', 'PAYMENT_OK', 'PAYMENT_FAILED', 'SERVICE_FAILED',
  'SUBSCRIPTION_ACTIVATED', 'SUBSCRIPTION_RENEWED', 'SUBSCRIPTION_ENDED', 'SUBSCRIPTION_PAYMENT_DUE', 'TRIAL_USED',
];

/** The optional-mail switches a person can turn off (one-click unsubscribe works per category). */
export type EmailCategory = 'ai_results' | 'billing';
export const EMAIL_CATEGORIES: readonly EmailCategory[] = ['ai_results', 'billing'];

/** Money and account state: always sent, never suppressed by a switch, no unsubscribe link. */
export const ESSENTIAL_EVENTS: ReadonlySet<EmailEvent> = new Set<EmailEvent>([
  'PAYMENT_FAILED', 'SUBSCRIPTION_ACTIVATED', 'SUBSCRIPTION_RENEWED', 'SUBSCRIPTION_ENDED', 'SUBSCRIPTION_PAYMENT_DUE',
]);

/** Where account and billing events always open: the subscription page, whatever the producer passed. */
export const SUBSCRIPTION_PAGE = '/account/subscription';
const SUBSCRIPTION_PAGE_TYPES = new Set([
  'SUBSCRIPTION_ACTIVATED', 'SUBSCRIPTION_RENEWED', 'SUBSCRIPTION_ENDED', 'SUBSCRIPTION_PAYMENT_DUE', 'PAYMENT_FAILED', 'TRIAL_USED',
]);

/** The deep link a notification of this type must carry; the producer's own link otherwise. */
export function deepLinkFor(type: string, producerLink: string | null | undefined): string | null {
  return SUBSCRIPTION_PAGE_TYPES.has(type) ? SUBSCRIPTION_PAGE : (producerLink ?? null);
}

export function isEssential(event: EmailEvent): boolean {
  return ESSENTIAL_EVENTS.has(event);
}

/** The switch that governs an optional event; null for essential ones. */
export function categoryOfEvent(event: EmailEvent): EmailCategory | null {
  if (isEssential(event)) return null;
  if (event === 'PAYMENT_OK' || event === 'TRIAL_USED') return 'billing';
  return 'ai_results';
}

/** Results of something the person started vs. news about their account. */
function startedByPerson(event: EmailEvent): boolean {
  return categoryOfEvent(event) === 'ai_results';
}

/**
 * Which notifications earn an email. Everything else stays in-app and push.
 *
 * `kind` (metadata.kind) and `productType` (metadata.product_type) are read where one type
 * means several things: a Find Buyers / Find Tenants search the person ran is SEARCH_COMPLETE
 * with kind FIND_CLIENTS_DONE and earns an email, while a saved search noticing a listing is
 * SEARCH_COMPLETE too and does not (it is not an async job the person is waiting on). A failed
 * Verify job is SERVICE_FAILED with product_type VERIFY and gets the Verify wording.
 */
export function emailEventFor(type: string, kind?: string | null, productType?: string | null): EmailEvent | null {
  if (type === 'SEARCH_COMPLETE') return kind === 'FIND_CLIENTS_DONE' ? 'SEARCH_DONE' : null;
  if (type === 'SERVICE_FAILED') {
    /* An unreadable document is an expected outcome, shown in-app only. */
    if (kind === 'DOCUMENT_UNREADABLE') return null;
    return productType === 'VERIFY' ? 'VERIFY_FAILED' : 'SERVICE_FAILED';
  }
  switch (type) {
    case 'VERIFY_COMPLETE': return 'VERIFY_DONE';
    case 'DOCUMENT_ANALYZED': return 'CONTRACT_DONE';
    /* Credits are no longer sold; kept so a historic top-up event still renders. */
    case 'CREDITS_TOPPED_UP': return 'PAYMENT_OK';
    case 'PAYMENT_FAILED': return 'PAYMENT_FAILED';
    case 'SUBSCRIPTION_ACTIVATED': return 'SUBSCRIPTION_ACTIVATED';
    case 'SUBSCRIPTION_RENEWED': return 'SUBSCRIPTION_RENEWED';
    case 'SUBSCRIPTION_ENDED': return 'SUBSCRIPTION_ENDED';
    case 'SUBSCRIPTION_PAYMENT_DUE': return 'SUBSCRIPTION_PAYMENT_DUE';
    case 'TRIAL_USED': return 'TRIAL_USED';
    default: return null;
  }
}

/** Georgian when the person never chose (Georgian is the default language). */
export function pickLang(raw: string | null | undefined): Lang {
  const l = String(raw ?? '').toLowerCase().slice(0, 2) as Lang;
  return (LANGS as readonly string[]).includes(l) ? l : 'ka';
}

export function isRtl(lang: Lang): boolean {
  return lang === 'ar' || lang === 'he';
}

/** One string, Georgian when a language somehow lacks it (the generator refuses that). */
export function copy(lang: Lang, key: string): string {
  return NOTIFICATION_COPY[lang]?.[key] ?? NOTIFICATION_COPY.ka[key] ?? '';
}

const STEM: Record<EmailEvent, string> = {
  VERIFY_DONE: 'verify_done', VERIFY_FAILED: 'verify_failed', CONTRACT_DONE: 'contract_done', SEARCH_DONE: 'search_done',
  PAYMENT_OK: 'payment_ok', PAYMENT_FAILED: 'payment_failed', SERVICE_FAILED: 'service_failed',
  SUBSCRIPTION_ACTIVATED: 'subscription_activated', SUBSCRIPTION_RENEWED: 'subscription_renewed',
  SUBSCRIPTION_ENDED: 'subscription_ended', SUBSCRIPTION_PAYMENT_DUE: 'subscription_payment_due', TRIAL_USED: 'trial_used',
};

export interface EventCopy { title: string; body: string; cta: string; next: string }

export function eventCopy(event: EmailEvent, lang: Lang): EventCopy {
  const s = STEM[event];
  return { title: copy(lang, `ntf_${s}_title`), body: copy(lang, `ntf_${s}_body`), cta: copy(lang, `ntf_${s}_cta`), next: copy(lang, `ntf_${s}_next`) };
}

export interface FrameCopy { whyLabel: string; why: string; nextLabel: string; footer: string; unsubscribe: string }

export function frameCopy(event: EmailEvent, lang: Lang): FrameCopy {
  return {
    whyLabel: copy(lang, 'ntf_email_why_label'),
    why: copy(lang, startedByPerson(event) ? 'ntf_email_why_started' : 'ntf_email_why_account'),
    nextLabel: copy(lang, 'ntf_email_next_label'),
    footer: copy(lang, isEssential(event) ? 'ntf_email_footer_essential' : 'ntf_email_footer_optional'),
    unsubscribe: copy(lang, 'ntf_email_unsubscribe'),
  };
}

/**
 * The title and body stored on the notification row, in the recipient's language.
 *
 * The in-app Notification Center renders from translation keys and never shows the stored
 * text for these types; the stored text is what a push carries when the page is closed and
 * what any older client shows. Null means "keep what the producer wrote".
 */
export function storedCopyFor(type: string, kind: string | null, productType: string | null, lang: Lang): { title: string; body: string } | null {
  const event = emailEventFor(type, kind, productType);
  if (!event) return null;
  const c = eventCopy(event, lang);
  return { title: c.title, body: c.body };
}

/* ── Email preferences ─────────────────────────────────────────────── */

export interface EmailPrefs {
  email_enabled?: boolean | null;
  email_categories?: Record<string, unknown> | null;
  email_suppressed_at?: string | null;
}

export type EmailDecision = 'SEND' | 'OPTED_OUT' | 'CATEGORY_OFF' | 'SUPPRESSED';

/**
 * May this event be emailed to a person with these preferences?
 * Essential events always may. No preferences row means the defaults: everything on.
 */
export function emailDecision(event: EmailEvent, prefs: EmailPrefs | null | undefined): EmailDecision {
  if (isEssential(event)) return 'SEND';
  if (!prefs) return 'SEND';
  if (prefs.email_enabled === false) return 'OPTED_OUT';
  if (prefs.email_suppressed_at) return 'SUPPRESSED';
  const cat = categoryOfEvent(event);
  if (cat && prefs.email_categories && prefs.email_categories[cat] === false) return 'CATEGORY_OFF';
  return 'SEND';
}

/* ── Unsubscribe link ──────────────────────────────────────────────── */

/** The HMAC message an unsubscribe token signs: the account and the category, nothing else. */
export function unsubscribeMessage(userId: string, category: EmailCategory): string {
  return `notify-email:${userId}:${category}`;
}

export function isUnsubscribeCategory(v: unknown): v is EmailCategory {
  return (EMAIL_CATEGORIES as readonly unknown[]).includes(v);
}
