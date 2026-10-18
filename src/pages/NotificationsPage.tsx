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
//   META ADS ROWS get one finer filter — Campaign, Leads, Billing, Guard, System — shown
//   only to somebody who has any, applied on the server so paging stays a keyset over
//   exactly what is shown. Their text is already localized by the notifier; the row adds
//   a severity badge in words (CRITICAL destructive, IMPORTANT gold, INFO quiet).
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
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { RouteGuard } from '@/components/common/RouteGuard';
import { AppLayout } from '@/components/layouts/AppLayout';
import { NotificationSettings } from '@/components/notifications/NotificationSettings';
import {
  CATEGORY_META, metaNotificationInfo, notificationAge, notificationCategory,
  notificationHref, notificationMark, notificationText,
} from '@/components/notifications/presentation';
import { intlLocaleFor } from '@/components/workspace/primitives';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { useNotificationCount } from '@/hooks/useNotificationCount';
import {
  cursorAfter, isAfterCursor, keysetOrFilter, metaCategoryFilter,
  metaCategoryOf, mergeFeed, type FeedCursor, type MetaCategory,
} from '@/lib/notifications/feed';
import { cn } from '@/lib/utils';
import {
  getNotifications, markAllNotificationsRead, markNotificationRead,
} from '@/services/api';
import type { Notification } from '@/types/types';

const PAGE = 25;

type Filter = 'UNREAD' | 'ALL';

/*
 * ONE PAGE OF THE FEED, OPTIONALLY NARROWED TO ONE META ADS CATEGORY.
 *
 * Without a category this is the canonical getNotifications. With one, the same keyset
 * query gains a server-side filter on the Meta type and metadata.category — filtering a
 * loaded page on the client would return pages that are empty while older matching rows
 * exist, and "load more" would look broken. Same order, same cursor, same table.
 */
async function fetchPage(
  userId: string,
  options: { unreadOnly: boolean; cursor?: FeedCursor | null; metaCategory: MetaCategory | null },
): Promise<Notification[]> {
  if (!options.metaCategory) {
    return getNotifications(userId, PAGE, { unreadOnly: options.unreadOnly, cursor: options.cursor });
  }
  const f = metaCategoryFilter(options.metaCategory);
  let query = supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .in('type', f.types as string[])
    .eq('metadata->>category', f.category)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PAGE);
  if (options.unreadOnly) query = query.eq('read', false);
  if (options.cursor) query = query.or(keysetOrFilter(options.cursor));
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = Array.isArray(data) ? (data as Notification[]) : [];
  /* The server filtered; the client's own rule is the last word on what is shown. */
  return rows.filter((n) => metaCategoryOf(n) === options.metaCategory);
}

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
  const meta = metaNotificationInfo(notif);
  const age = notificationAge(notif.created_at, t, intlLocaleFor(lang));
  const unread = !notif.read;

  return (
    <li
      className={cn(
        'group relative flex items-stretch border-b border-[hsl(40_30%_90%)] last:border-0',
        'transition-colors motion-reduce:transition-none',
        /* Unread is a ground AND a rule at the leading edge. A tint alone is a colour
           cue, and colour alone is not an accessible state. */
        unread ? 'bg-[hsl(42_100%_97%)]' : 'bg-white',
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
          'flex min-w-0 flex-1 items-start gap-3.5 py-4 ps-4 pe-2 text-start',
          'hover:bg-[hsl(42_100%_98%)] motion-reduce:transition-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))]',
        )}
      >
        <span
          className={cn(
            /* The HOMATCH mark's grammar (owner, 2026-10-17: premium, not grey): a navy tile
               with a gold glyph; a failure keeps its destructive tone. */
            'mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1 ring-inset',
            tone === 'alert'
              ? 'bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))] ring-[hsl(var(--destructive))]/25'
              : tone === 'accent'
                ? 'bg-[linear-gradient(135deg,hsl(218_52%_11%),hsl(218_48%_19%))] text-[hsl(40_94%_64%)] ring-[hsl(40_80%_55%/0.45)] shadow-[0_8px_18px_-12px_hsl(218_60%_15%/0.7)]'
                : 'bg-[hsl(218_52%_11%)] text-[hsl(40_94%_64%)] ring-transparent shadow-[0_8px_18px_-12px_hsl(218_60%_15%/0.7)]',
          )}
          aria-hidden="true"
        >
          <Icon className="h-4 w-4" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-2xs leading-5 text-[hsl(218_28%_40%)]">
            <span className="min-w-0 truncate font-semibold uppercase tracking-[0.04em] text-[hsl(34_90%_34%)]">
              {t((meta ? meta.categoryKey : CATEGORY_META[category].labelKey) as Parameters<typeof t>[0])}
            </span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0 tabular-nums">{age}</span>
            {meta && (
              /* Severity in words as well as colour: colour alone is not an accessible state. */
              <span
                className={cn(
                  'ms-1 inline-flex shrink-0 items-center rounded-full border px-1.5 text-2xs leading-4',
                  meta.severity === 'CRITICAL'
                    ? 'border-[hsl(var(--destructive))]/30 bg-[hsl(var(--destructive))]/10 font-semibold text-[hsl(var(--destructive))]'
                    : meta.severity === 'IMPORTANT'
                      ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] font-semibold text-[hsl(var(--gold-ink))]'
                      : 'border-border bg-[hsl(var(--secondary))] font-medium text-muted-foreground',
                )}
              >
                <span aria-hidden="true">{t(meta.severityKey as Parameters<typeof t>[0])}</span>
                <span className="sr-only">
                  {t('mm_n_severity_sr', { level: t(meta.severityKey as Parameters<typeof t>[0]) })}
                </span>
              </span>
            )}
            {unread && <span className="sr-only">, {t('notif_unread_label')}</span>}
          </span>
          <span
            className={cn(
              'mt-1 block text-pretty font-display text-[15px] leading-snug text-[hsl(218_45%_14%)] [overflow-wrap:anywhere]',
              unread ? 'font-semibold' : 'font-medium',
            )}
          >
            {title}
          </span>
          {body ? (
            <span className="mt-1 line-clamp-3 block text-pretty text-xs leading-relaxed text-[hsl(218_28%_34%)] [overflow-wrap:anywhere]">
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
  /* A finer filter for Meta Ads rows, offered only to somebody who has any. */
  /* No category filter on this page any more (owner, 2026-10-18); kept as a constant so the
     keyset query, live merge and refresh paths stay one code path. */
  const metaCategory = null as MetaCategory | null;

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
  const metaCategoryRef = useRef(metaCategory);
  metaCategoryRef.current = metaCategory;
  const generation = useRef(0);

  const load = useCallback(async (which: Filter, category: MetaCategory | null) => {
    if (!userId) return;
    const gen = ++generation.current;
    setLoading(true);
    setFailed(false);
    try {
      const page = await fetchPage(userId, { unreadOnly: which === 'UNREAD', metaCategory: category });
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

  useEffect(() => { void load(filter, metaCategory); }, [load, filter, metaCategory]);

  /* The first page again, merged rather than replaced — so whatever older pages somebody
     already loaded stay where they are. Silent: recovery is not a loading screen. */
  const refreshHead = useCallback(async () => {
    if (!userId) return;
    const gen = generation.current;
    try {
      const page = await fetchPage(userId, {
        unreadOnly: filterRef.current === 'UNREAD', metaCategory: metaCategoryRef.current,
      });
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
          /* A Meta category view: only rows of that category belong in it. */
          if (metaCategoryRef.current && metaCategoryOf(incoming) !== metaCategoryRef.current) return prev;
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
      }, (payload) => {
        const n = payload.new as Notification;
        if (!n?.id) return;
        accept(n, true);
      })
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
      const page = await fetchPage(userId, { unreadOnly: filter === 'UNREAD', cursor, metaCategory });
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
            <div className="flex min-w-0 flex-1 basis-56 items-start gap-3.5">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(135deg,hsl(218_52%_11%),hsl(218_48%_19%))] text-[hsl(40_94%_64%)] shadow-[0_12px_26px_-16px_hsl(218_60%_15%/0.8)] ring-1 ring-inset ring-[hsl(40_80%_55%/0.45)]" aria-hidden="true">
                <Bell className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
              <h1 className="flex flex-wrap items-center gap-2 text-pretty font-display text-2xl font-semibold tracking-[-0.015em] text-[hsl(218_45%_14%)]">
                {t('notif_title')}
                {unreadTotal > 0 && (
                  <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] px-2 text-2xs font-semibold tabular-nums text-[hsl(var(--gold-ink))]">
                    <span aria-hidden="true">{unreadTotal > 99 ? '99+' : unreadTotal}</span>
                    <span className="sr-only">{t('notif_unread_count', { n: unreadTotal })}</span>
                  </span>
                )}
              </h1>
              <p className="max-w-prose text-pretty text-xs leading-relaxed text-[hsl(218_28%_36%)]">
                {t('notif_page_sub')}
              </p>
              <span className="mt-2 block h-[3px] w-12 rounded-full bg-[hsl(38_92%_56%)]" aria-hidden="true" />
              </div>
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

          <div role="group" aria-label={t('notif_filter_label')} className="inline-flex rounded-full bg-white p-1 shadow-[0_6px_16px_-12px_hsl(218_60%_15%/0.5)] ring-1 ring-inset ring-[hsl(40_60%_82%)]">
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
                    ? 'bg-[hsl(218_52%_11%)] text-[hsl(40_94%_70%)]'
                    : 'text-[hsl(218_28%_38%)] hover:text-[hsl(218_45%_14%)]',
                )}
              >
                {t(value === 'ALL' ? 'notif_filter_all' : 'notif_filter_unread')}
              </button>
            ))}
          </div>

          {/* Only All / Unread (owner, 2026-10-18): no per-category chip rail. */}
          <p className="sr-only" aria-live="polite">
            {metaCategory && !loading && !failed ? t('mm_n_filter_count', { n: rows.length }) : ''}
          </p>

          <section
            aria-label={t('notif_list_label')}
            aria-busy={loading}
            className="overflow-hidden rounded-2xl bg-white shadow-[0_14px_34px_-22px_hsl(218_60%_15%/0.55)] ring-1 ring-inset ring-[hsl(40_60%_84%)]"
          >
            {loading ? (
              <SkeletonRows />
            ) : failed ? (
              <div className="flex flex-col items-start gap-2 px-5 py-8" role="alert">
                <p className="break-words font-display text-sm font-semibold text-foreground">{t('notif_load_error')}</p>
                <p className="max-w-prose break-words text-2xs leading-relaxed text-muted-foreground">{t('notif_load_error_body')}</p>
                <button
                  type="button"
                  onClick={() => { void load(filter, metaCategory); }}
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
                  className="grid h-11 w-11 place-items-center rounded-xl bg-[hsl(218_52%_11%)] text-[hsl(40_94%_64%)] shadow-[0_8px_18px_-12px_hsl(218_60%_15%/0.7)]"
                  aria-hidden="true"
                >
                  <Bell className="h-4 w-4" />
                </span>
                <p className="break-words font-display text-sm font-semibold text-foreground">
                  {metaCategory
                    ? t('mm_n_filter_empty')
                    : t(filter === 'UNREAD' ? 'notif_empty_unread' : 'empty_no_notifications_title')}
                </p>
                {!metaCategory && (
                  <p className="max-w-prose break-words text-2xs leading-relaxed text-muted-foreground">
                    {t(filter === 'UNREAD' ? 'empty_no_notifications_desc' : 'notif_empty_all_desc')}
                  </p>
                )}
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
