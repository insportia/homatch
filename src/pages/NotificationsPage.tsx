// THE NOTIFICATION CENTRE.
//
// It lives in the light premium customer shell (`hm-customer`), because notifications are
// part of the application chrome rather than a product page, and the Dashboard beside it
// wears the same block.
//
// THE DECISIONS
//
//   THE LIST IS FILTERED, NOT TABBED BY CATEGORY. Unread and All. Each row carries its
//   category — Messages, Matches, Property, Discovery, Services, Billing, Account &
//   security, News — as a mark and a small label, which is how a reader tells a message
//   from a payment at a glance without a rail of eight tabs over a list of twelve rows.
//
//   READ IS AN ACT, NOT AN ARRIVAL. Opening this page does not mark anything read. A row
//   becomes read when it is opened, when its own "mark as read" is pressed, when its
//   conversation is opened in the chat, or when somebody asks for all of them at once.
//
//   ONE NUMBER. The unread count in the header is the database's count, shared with the
//   bell (useNotificationCount) — not the number of unread rows that happen to be loaded,
//   which is what it used to be and which is wrong for anybody with a second page.
//
//   ONE ACCENT, TWO ROLES. Gold marks the things that want something from you; the
//   destructive tone marks what failed. Everything else is quiet. See presentation.tsx.
//
// HOW THE LIST STAYS TRUE
//
//   PAGED BY KEYSET on (created_at, id), newest first — an offset shifts under anything
//   arriving while somebody reads, and created_at alone skipped and repeated rows.
//
//   LIVE. New notifications are merged in as they are written, and an aggregate that was
//   updated (its count and time bumped) moves back to the top instead of appearing twice.
//
//   RECOVERED. A socket that dropped while the laptop slept delivers nothing for what it
//   missed, so the first page is refetched and merged when the channel resubscribes, the
//   tab becomes visible, or the browser comes back online.
//
//   HONEST ABOUT FAILURE. "Could not load" is a different screen from "nothing here", with
//   a way to try again.
//
// WHAT IT DOES NOT DO
//
//   Trust a stored URL. Destinations come from notificationHref(), which follows a path on
//   this site and never an absolute address.

import { Bell, Check, CheckCheck, Loader2, RefreshCw } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { RouteGuard } from '@/components/common/RouteGuard';
import { AppLayout } from '@/components/layouts/AppLayout';
import { NotificationSettings } from '@/components/notifications/NotificationSettings';
import {
  CATEGORY_META, notificationAge, notificationCategory, notificationHref, notificationMark,
  notificationText,
} from '@/components/notifications/presentation';
import { intlLocaleFor } from '@/components/workspace/primitives';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { useNotificationCount } from '@/hooks/useNotificationCount';
import { cursorAfter, isAfterCursor, mergeFeed, type FeedCursor } from '@/lib/notifications/feed';
import { cn } from '@/lib/utils';
import {
  getNotifications, markAllNotificationsRead, markNotificationRead,
} from '@/services/api';
import type { Notification } from '@/types/types';

const PAGE = 25;

type Filter = 'UNREAD' | 'ALL';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-1 focus-visible:ring-offset-[hsl(var(--background))]';

/** One notification: the row opens it; the check beside an unread one only reads it. */
function NotifRow({
  notif,
  onOpen,
  onMarkRead,
}: {
  notif: Notification;
  onOpen: (notif: Notification) => void;
  onMarkRead: (notif: Notification) => void;
}) {
  const { t, lang } = useLanguage();
  const { title, body } = notificationText(notif, t, lang);
  const { icon: Icon, tone } = notificationMark(notif);
  const category = notificationCategory(notif);
  const age = notificationAge(notif.created_at, t, intlLocaleFor(lang));
  const unread = !notif.read;

  return (
    <li
      className={cn(
        'group relative flex items-stretch border-b border-border/70 last:border-0',
        'transition-colors motion-reduce:transition-none',
        /* Unread is a ground AND a rule at the leading edge. A tint alone is a colour
           cue, and colour alone is not an accessible state. */
        unread ? 'bg-[hsl(var(--gold-soft))]/40' : 'bg-card',
      )}
    >
      {unread && (
        <span
          className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-[hsl(var(--gold))]"
          aria-hidden="true"
        />
      )}
      <button
        type="button"
        onClick={() => onOpen(notif)}
        className={cn(
          'flex min-w-0 flex-1 items-start gap-3 py-3.5 ps-4 pe-2 text-start',
          'hover:bg-[hsl(var(--secondary))]/50 motion-reduce:transition-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))]',
        )}
      >
        <span
          className={cn(
            'mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ring-1 ring-inset',
            tone === 'accent'
              ? 'bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))] ring-[hsl(var(--gold-border))]'
              : tone === 'alert'
                ? 'bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))] ring-[hsl(var(--destructive))]/25'
                : 'bg-[hsl(var(--secondary))] text-foreground/70 ring-border',
          )}
          aria-hidden="true"
        >
          <Icon className="h-4 w-4" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5 text-2xs leading-5 text-muted-foreground">
            <span className="min-w-0 truncate font-medium">
              {t(CATEGORY_META[category].labelKey as Parameters<typeof t>[0])}
            </span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0 tabular-nums">{age}</span>
            {unread && <span className="sr-only">, {t('notif_unread_label')}</span>}
          </span>
          <span
            className={cn(
              'mt-0.5 block break-words font-display text-sm leading-snug',
              unread ? 'font-semibold text-foreground' : 'font-medium text-foreground/85',
            )}
          >
            {title}
          </span>
          {body ? (
            <span className="mt-0.5 line-clamp-2 block break-words text-2xs leading-relaxed text-muted-foreground">
              {body}
            </span>
          ) : null}
        </span>
      </button>

      {/* Reading without opening. Outside the row's button: a control inside a control is
          not operable by keyboard or assistive technology. */}
      <div className="flex shrink-0 items-start pe-2 pt-3">
        {unread ? (
          <button
            type="button"
            onClick={() => onMarkRead(notif)}
            aria-label={t('notif_mark_read')}
            title={t('notif_mark_read')}
            className={cn(
              'grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors',
              'hover:bg-[hsl(var(--secondary))] hover:text-foreground motion-reduce:transition-none',
              FOCUS,
            )}
          >
            <Check className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <span className="h-9 w-9" aria-hidden="true" />
        )}
      </div>
    </li>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-4 p-4" aria-hidden="true">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex items-start gap-3">
          <div className="h-9 w-9 shrink-0 rounded-full bg-[hsl(var(--secondary))] motion-safe:animate-pulse" />
          <div className="flex-1 space-y-2 pt-0.5">
            <div className="h-2.5 w-24 rounded bg-[hsl(var(--secondary))] motion-safe:animate-pulse" />
            <div className="h-3 w-2/3 rounded bg-[hsl(var(--secondary))] motion-safe:animate-pulse" />
            <div className="h-3 w-1/2 rounded bg-[hsl(var(--secondary))] motion-safe:animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

function NotificationsContent() {
  const { homatchUser } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const unreadTotal = useNotificationCount();

  const [rows, setRows] = useState<Notification[]>([]);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [cursor, setCursor] = useState<FeedCursor | null>(null);

  const userId = homatchUser?.id ?? null;
  /* The live handlers read these through refs: re-subscribing to realtime on every
     filter change or page load would drop the socket in exactly the gap a new row
     arrives in. */
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const exhaustedRef = useRef(exhausted);
  exhaustedRef.current = exhausted;
  const generation = useRef(0);

  const load = useCallback(async (which: Filter) => {
    if (!userId) return;
    const gen = ++generation.current;
    setLoading(true);
    setFailed(false);
    try {
      const page = await getNotifications(userId, PAGE, { unreadOnly: which === 'UNREAD' });
      if (gen !== generation.current) return;
      setRows(page);
      setCursor(cursorAfter(page));
      setExhausted(page.length < PAGE);
    } catch {
      if (gen !== generation.current) return;
      setFailed(true);
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void load(filter); }, [load, filter]);

  /* The first page again, merged rather than replaced — so whatever older pages somebody
     already loaded stay where they are. Silent: recovery is not a loading screen. */
  const refreshHead = useCallback(async () => {
    if (!userId) return;
    const gen = generation.current;
    try {
      const page = await getNotifications(userId, PAGE, { unreadOnly: filterRef.current === 'UNREAD' });
      if (gen !== generation.current) return;
      setRows((prev) => mergeFeed(prev, page));
      setFailed(false);
    } catch { /* the next trigger tries again; the list on screen is still true */ }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const accept = (incoming: Notification, isInsert: boolean) => {
      setRows((prev) => {
        const present = prev.some((n) => n.id === incoming.id);
        if (!present) {
          /* Unread view: a row that arrives already read does not belong in it. */
          if (filterRef.current === 'UNREAD' && incoming.read) return prev;
          /* Beyond the loaded range: it will arrive with its page. An aggregate whose
             time was bumped is newer than the cursor and so is taken now. */
          if (!exhaustedRef.current && isAfterCursor(incoming, cursorRef.current) && !isInsert) return prev;
        }
        return mergeFeed(prev, [incoming]);
      });
    };

    const channel = supabase
      .channel(`notif-center-${userId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}`,
      }, (payload) => { const n = payload.new as Notification; if (n?.id) accept(n, true); })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}`,
      }, (payload) => { const n = payload.new as Notification; if (n?.id) accept(n, false); })
      .subscribe((status) => { if (status === 'SUBSCRIBED') void refreshHead(); });

    const onVisible = () => { if (document.visibilityState === 'visible') void refreshHead(); };
    const onOnline = () => { void refreshHead(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      void supabase.removeChannel(channel);
    };
  }, [userId, refreshHead]);

  const more = async () => {
    if (!userId || loadingMore || exhausted || !cursor) return;
    const gen = generation.current;
    setLoadingMore(true);
    try {
      const page = await getNotifications(userId, PAGE, { unreadOnly: filter === 'UNREAD', cursor });
      if (gen !== generation.current) return;
      setRows((prev) => mergeFeed(prev, page));
      if (page.length) setCursor(cursorAfter(page));
      setExhausted(page.length < PAGE);
    } catch {
      toast.error(t('notif_load_error'));
    } finally {
      setLoadingMore(false);
    }
  };

  /*
   * Opening a row reads it and goes where the producer said. The optimistic update keeps
   * the row where it is rather than making it vanish from under the tap in the Unread
   * view — the list is refiltered the next time it loads, which is the calmer moment.
   */
  const markOne = (notif: Notification) => {
    if (notif.read) return;
    setRows((prev) => prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n)));
    void markNotificationRead(notif.id).then((ok) => {
      if (!ok) setRows((prev) => prev.map((n) => (n.id === notif.id ? { ...n, read: false } : n)));
    });
  };

  const open = (notif: Notification) => {
    markOne(notif);
    const href = notificationHref(notif);
    if (href) navigate(href);
  };

  const readAll = async () => {
    if (!userId || markingAll) return;
    setMarkingAll(true);
    const before = rows;
    setRows((prev) => prev.map((n) => ({ ...n, read: true })));
    const ok = await markAllNotificationsRead(userId);
    if (!ok) {
      setRows(before);
      toast.error(t('notif_mark_all_failed'));
    }
    setMarkingAll(false);
  };

  const hasUnread = unreadTotal > 0 || rows.some((n) => !n.read);

  return (
    <AppLayout>
      <div className="hm-customer -mx-4 -my-6 min-h-[calc(100dvh-4rem)] bg-background px-4 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:-mx-6 md:-my-8 md:px-6 md:py-8">
        <div className="mx-auto w-full max-w-2xl space-y-5">
          <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
            <div className="min-w-0 flex-1 basis-56 space-y-1">
              <h1 className="flex flex-wrap items-center gap-2 break-words font-display text-2xl font-semibold tracking-[-0.015em] text-foreground">
                {t('notif_title')}
                {unreadTotal > 0 && (
                  <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] px-2 text-2xs font-semibold tabular-nums text-[hsl(var(--gold-ink))]">
                    <span aria-hidden="true">{unreadTotal > 99 ? '99+' : unreadTotal}</span>
                    <span className="sr-only">{t('notif_unread_count', { n: unreadTotal })}</span>
                  </span>
                )}
              </h1>
              <p className="max-w-prose break-words text-2xs leading-relaxed text-muted-foreground">
                {t('notif_page_sub')}
              </p>
            </div>
            {hasUnread && (
              <button
                type="button"
                onClick={() => { void readAll(); }}
                disabled={markingAll}
                className={cn(
                  'inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-4 text-2xs font-semibold text-foreground',
                  'transition-colors hover:border-[hsl(var(--gold-border))] hover:bg-[hsl(var(--gold-soft))]/60 disabled:opacity-60 motion-reduce:transition-none',
                  FOCUS,
                )}
              >
                {markingAll
                  ? <Loader2 className="h-4 w-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
                  : <CheckCheck className="h-4 w-4 shrink-0" aria-hidden="true" />}
                <span className="min-w-0 break-words text-start">{t('notif_mark_all_read')}</span>
              </button>
            )}
          </header>

          <div role="group" aria-label={t('notif_filter_label')} className="inline-flex rounded-full border border-border bg-card p-1">
            {(['ALL', 'UNREAD'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
                className={cn(
                  'inline-flex min-h-9 items-center rounded-full px-4 text-2xs font-semibold transition-colors motion-reduce:transition-none',
                  FOCUS,
                  filter === value
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t(value === 'ALL' ? 'notif_filter_all' : 'notif_filter_unread')}
              </button>
            ))}
          </div>

          <section
            aria-label={t('notif_list_label')}
            aria-busy={loading}
            className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_1px_2px_hsl(var(--foreground)/0.04)]"
          >
            {loading ? (
              <SkeletonRows />
            ) : failed ? (
              <div className="flex flex-col items-start gap-2 px-5 py-8" role="alert">
                <p className="break-words font-display text-sm font-semibold text-foreground">{t('notif_load_error')}</p>
                <p className="max-w-prose break-words text-2xs leading-relaxed text-muted-foreground">{t('notif_load_error_body')}</p>
                <button
                  type="button"
                  onClick={() => { void load(filter); }}
                  className={cn(
                    'mt-1 inline-flex min-h-10 items-center gap-1.5 rounded-full border border-border bg-card px-4 text-2xs font-semibold text-foreground hover:bg-[hsl(var(--secondary))]',
                    FOCUS,
                  )}
                >
                  <RefreshCw className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {t('notif_retry')}
                </button>
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-start gap-2 px-5 py-9">
                <span
                  className="grid h-10 w-10 place-items-center rounded-full bg-[hsl(var(--secondary))] text-foreground/70 ring-1 ring-inset ring-border"
                  aria-hidden="true"
                >
                  <Bell className="h-4 w-4" />
                </span>
                <p className="break-words font-display text-sm font-semibold text-foreground">
                  {t(filter === 'UNREAD' ? 'notif_empty_unread' : 'empty_no_notifications_title')}
                </p>
                <p className="max-w-prose break-words text-2xs leading-relaxed text-muted-foreground">
                  {t(filter === 'UNREAD' ? 'empty_no_notifications_desc' : 'notif_empty_all_desc')}
                </p>
              </div>
            ) : (
              <ul>
                {rows.map((notif) => (
                  <NotifRow key={notif.id} notif={notif} onOpen={open} onMarkRead={markOne} />
                ))}
              </ul>
            )}
          </section>

          {!loading && !failed && rows.length > 0 && (
            exhausted ? (
              <p className="px-1 text-2xs text-muted-foreground">{t('notif_all_loaded')}</p>
            ) : (
              <button
                type="button"
                onClick={() => { void more(); }}
                disabled={loadingMore}
                className={cn(
                  'inline-flex min-h-10 items-center gap-1.5 rounded-full border border-border bg-card px-4 text-2xs font-semibold text-foreground',
                  'transition-colors hover:bg-[hsl(var(--secondary))] disabled:opacity-60 motion-reduce:transition-none',
                  FOCUS,
                )}
              >
                {loadingMore && <Loader2 className="h-4 w-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" />}
                <span className="break-words text-start">{t('notif_load_more')}</span>
              </button>
            )
          )}

          <NotificationSettings />
        </div>
      </div>
    </AppLayout>
  );
}

export default function NotificationsPage() {
  return (
    <RouteGuard>
      <NotificationsContent />
    </RouteGuard>
  );
}
