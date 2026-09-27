// WHAT A NOTIFICATION SAYS, WHAT IT LOOKS LIKE, AND WHERE IT GOES.
//
// Three questions with one answer each, in one module, because there are now three places
// that ask them — the Notification Center, the live toast, and the bell's own preview —
// and three copies of "which icon does a message get" is three chances for the toast and
// the list to disagree about the same row.
//
// THE TEXT IS NEVER THE STORED TEXT, WHERE A KEY EXISTS.
//
// `notifications.title` and `.body` are written once, in English, by whichever edge
// function emitted the event, and they stay for the push payload and for any client that
// has not been updated. Rendering them would freeze every notification into whatever
// language the backend happened to be speaking — so the interface reads the stable `type`
// and `metadata.kind` and renders from translation keys instead, which fixes the rows
// written last year as well as the ones written today.
//
// A row that matches nothing here still shows its stored title. An English sentence is a
// smaller failure than a blank list item.
//
// THE DESTINATION IS A PATH, AND ONLY A PATH.
//
// The producer decided where a notification goes and said so in `deep_link`. An absolute
// URL cannot reach that column, but a restored row or a direct database write could carry
// one, and navigating to an off-site address out of a list of things the platform told you
// is an open redirect from the most trusted surface there is. So a destination is followed
// only when it begins with a single slash.

import {
  Bell, Building2, CalendarDays, CheckCircle2, CreditCard, Megaphone, MessageSquare,
  Phone, Search, Zap,
} from 'lucide-react';
import type React from 'react';
import type { Notification } from '@/types/types';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** The `metadata.kind` a producer wrote, or ''. */
function kindOf(notif: Notification): string {
  const meta = (notif.metadata ?? {}) as Record<string, unknown>;
  return typeof meta.kind === 'string' ? meta.kind : '';
}

function metaString(notif: Notification, key: string): string {
  const meta = (notif.metadata ?? {}) as Record<string, unknown>;
  const value = meta[key];
  return typeof value === 'string' ? value : '';
}

/* ────────────────────────────────────────────────────────────────────────
 * What it says
 * ──────────────────────────────────────────────────────────────────────── */

export function notificationText(
  notif: Notification,
  t: Translate,
): { title: string; body: string } {
  const kind = kindOf(notif);
  const status = metaString(notif, 'status');

  if (kind === 'NEW_PROPERTY_MATCH') {
    return { title: t('notif_new_property_match_title'), body: t('notif_new_property_match_body') };
  }
  if (kind === 'NEW_SIGNAL_MATCH') {
    return { title: t('notif_new_signal_match_title'), body: t('notif_new_signal_match_body') };
  }
  if (kind === 'NEW_MESSAGE') {
    return { title: t('notif_new_message_title'), body: t('notif_new_message_body') };
  }
  if (kind === 'VIEWING_REQUEST') {
    return { title: t('notif_viewing_request_title'), body: t('notif_viewing_request_body') };
  }
  if (kind === 'VIEWING_UPDATE') {
    const titleKey: Record<string, string> = {
      ACCEPTED: 'notif_viewing_accepted_title', DECLINED: 'notif_viewing_declined_title',
      RESCHEDULE_PROPOSED: 'notif_viewing_reschedule_title', CANCELLED: 'notif_viewing_cancelled_title',
      COMPLETED: 'notif_viewing_completed_title',
    };
    const wordKey: Record<string, string> = {
      ACCEPTED: 'view_status_accepted', DECLINED: 'view_status_declined',
      RESCHEDULE_PROPOSED: 'view_status_reschedule', CANCELLED: 'view_status_cancelled',
      COMPLETED: 'view_status_completed',
    };
    return {
      title: t(titleKey[status] ?? 'notif_viewing_update_title'),
      body: t('notif_viewing_status_body', { status: t(wordKey[status] ?? 'view_status_pending') }),
    };
  }
  /*
   * AN ANNOUNCEMENT IS THE ONE THING WITH NO KEY.
   *
   * Its text was written by a person at publish time — there is no translation key for
   * "we added mortgage pre-approval". The row carries the English, the announcement
   * itself carries every language the operator wrote, and the destination is the
   * announcement. So the stored text is shown and is the right thing to show.
   */
  if (notif.type === 'ANNOUNCEMENT') {
    return { title: notif.title, body: notif.body ?? '' };
  }

  /* Typed events with no kind of their own. Without these they fall through to stored
     English, which is the freezing-in-one-language problem this module exists to avoid. */
  if (notif.type === 'LOW_CREDITS') {
    return { title: t('notif_low_credits_title'), body: t('notif_low_credits_body') };
  }
  if (notif.type === 'RESEARCH_PRODUCT_PURCHASED') {
    return { title: t('notif_research_purchased_title'), body: t('notif_research_purchased_body') };
  }
  if (notif.type === 'PROPERTY_ACTION_REQUIRED') {
    return { title: t('notif_property_action_title'), body: t('notif_property_action_body') };
  }
  if (notif.type === 'SEARCH_COMPLETE') {
    return { title: t('notif_search_complete_title'), body: t('notif_search_complete_body') };
  }

  return { title: notif.title, body: notif.body ?? '' };
}

/* ────────────────────────────────────────────────────────────────────────
 * What it looks like
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The mark beside a notification.
 *
 * An ICON AND A ROLE, not a colour per type. Six accent colours in one list is the badge
 * soup this design language keeps removing; what a reader needs is to tell a message from
 * a payment at a glance, which the shape does. `accent` is reserved for the two roles that
 * genuinely change what somebody should do: something needs you (gold), or something
 * failed (destructive).
 */
export interface NotificationMark {
  icon: React.ComponentType<{ className?: string }>;
  tone: 'accent' | 'alert' | 'plain';
}

export function notificationMark(notif: Notification): NotificationMark {
  const kind = kindOf(notif);
  if (kind === 'NEW_MESSAGE') return { icon: MessageSquare, tone: 'accent' };
  if (kind.startsWith('VIEWING_')) return { icon: CalendarDays, tone: 'plain' };
  if (kind === 'ANNOUNCEMENT' || notif.type === 'ANNOUNCEMENT') {
    return { icon: Megaphone, tone: 'plain' };
  }

  switch (notif.type) {
    case 'MATCH_FOUND':
    case 'MATCH_AVAILABLE':
      return { icon: Zap, tone: 'accent' };
    case 'PROPERTY_ACTION_REQUIRED':
      return { icon: Phone, tone: 'accent' };
    case 'SEARCH_COMPLETE':
      return { icon: Search, tone: 'plain' };
    case 'IMPORT_COMPLETED':
      return { icon: CheckCircle2, tone: 'plain' };
    case 'IMPORT_FAILED':
      return { icon: Building2, tone: 'alert' };
    case 'LOW_CREDITS':
      return { icon: CreditCard, tone: 'accent' };
    case 'CREDITS_TOPPED_UP':
    case 'RESEARCH_PRODUCT_PURCHASED':
      return { icon: CreditCard, tone: 'plain' };
    case 'VERIFY_COMPLETE':
    case 'DOCUMENT_ANALYZED':
      return { icon: CheckCircle2, tone: 'plain' };
    default:
      return { icon: Bell, tone: 'plain' };
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Where it goes
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The path a notification opens, or null when there is nowhere honest to send somebody.
 *
 * `deep_link` first, because the producer already decided. The fallbacks below exist for
 * rows written before that column did — `notify_emit` does not write `property_id`, so a
 * match routed by property_id quietly stopped finding one for every event that went
 * through the canonical path, and the notification arrived, was clickable, and did
 * nothing. They can go when those rows have aged out; guessing which day that is costs
 * somebody a dead tap.
 */
export function notificationHref(notif: Notification): string | null {
  const link = typeof notif.deep_link === 'string' ? notif.deep_link : '';
  /* A single leading slash. "//evil.example" is a protocol-relative URL, not a path. */
  if (link.startsWith('/') && !link.startsWith('//')) return link;

  const kind = kindOf(notif);
  if (kind === 'NEW_MESSAGE') {
    const id = metaString(notif, 'conversation_id');
    return id ? `/chat?conversation=${encodeURIComponent(id)}` : '/chat';
  }
  if (kind === 'VIEWING_REQUEST' || kind === 'VIEWING_UPDATE') {
    const id = metaString(notif, 'viewing_request_id');
    return id ? `/viewings?request=${encodeURIComponent(id)}` : '/viewings';
  }
  if (notif.type === 'MATCH_AVAILABLE' || notif.type === 'MATCH_FOUND') {
    const propertyId = notif.property_id ?? metaString(notif, 'property_id');
    return propertyId ? `/property/${propertyId}/matches` : null;
  }
  if (
    notif.type === 'CREDITS_TOPPED_UP'
    || notif.type === 'LOW_CREDITS'
    || notif.type === 'RESEARCH_PRODUCT_PURCHASED'
  ) {
    return '/credits';
  }
  if (notif.property_id) return `/property/${notif.property_id}`;
  return null;
}

/* ────────────────────────────────────────────────────────────────────────
 * When it happened
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * How long ago, in the reader's language.
 *
 * A relative age rather than a timestamp: "3 hours ago" is what somebody is asking when
 * they look at a notification list, and a date is arithmetic homework. Anything older than
 * a week is a date, because "23 days ago" is the same homework in the other direction.
 */
export function notificationAge(iso: string, t: Translate, locale: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return t('time_just_now');
  if (minutes < 60) return t('time_minutes_ago', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('time_hours_ago', { n: hours });
  const days = Math.floor(hours / 24);
  if (days <= 7) return t('time_days_ago', { n: days });
  try {
    return new Date(then).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  } catch {
    return new Date(then).toISOString().slice(0, 10);
  }
}
