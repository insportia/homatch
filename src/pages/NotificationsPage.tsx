// THE NOTIFICATION CENTRE.
//
// WHAT IT REPLACES was a working list that had never been designed. Three hundred
// characters of JSX on one line, a `NOTIF_CONFIG` map assigning `text-green-400`,
// `text-yellow-400` and `text-destructive` per type — six accent colours in one list, which
// is the badge soup this design language keeps removing — a 2px unread dot, and every item
// rendered at whatever the root palette happened to be. It told the truth and looked like
// a debug view.
//
// WHAT IT IS NOW is the light premium shell it belongs to, and three decisions:
//
//   THE LIST IS FILTERED, NOT CATEGORISED. Unread and All. A category rail over eight
//   notification types would be filter complexity in a list most people have twelve rows
//   in; the type is legible from the mark and the sentence.
//
//   READ IS AN ACT, NOT AN ARRIVAL. Opening this page does not mark anything read —
//   walking past your post is not opening it. A row becomes read when it is tapped, or
//   when somebody asks for all of them at once. That keeps the bell and this list
//   agreeing, which is the one contradiction a notification centre must not have.
//
//   ONE ACCENT, TWO ROLES. Gold marks the things that want something from you — a
//   message, a match, a property that cannot proceed. Everything else is quiet. See
//   presentation.tsx, where that decision lives once for this page and the live card
//   both.
//
// WHAT IT DOES NOT DO
//
//   Load everything. A recent page, then more on request, by created_at cursor — an
//   offset shifts under anything arriving while somebody reads.
//
//   Trust a stored URL. Destinations come from notificationHref(), which follows a path
//   and never an absolute address. A list of things the platform told you is the most
//   trusted surface there is and the worst place for an open redirect.

import { Bell, CheckCheck, Loader2 } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { RouteGuard } from '@/components/common/RouteGuard';
import { AppLayout } from '@/components/layouts/AppLayout';
import { NotificationSettings } from '@/components/notifications/NotificationSettings';
import {
  notificationAge, notificationHref, notificationMark, notificationText,
} from '@/components/notifications/presentation';
import { intlLocaleFor } from '@/components/workspace/primitives';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  getNotifications, markAllNotificationsRead, markNotificationRead,
} from '@/services/api';
import type { Notification } from '@/types/types';

const PAGE = 25;

type Filter = 'UNREAD' | 'ALL';

/** One notification, as a row somebody reads rather than a record somebody parses. */
function NotifRow({
  notif,
  onOpen,
}: {
  notif: Notification;
  onOpen: (notif: Notification) => void;
}) {
  const { t, lang } = useLanguage();
  const { title, body } = notificationText(notif, t);
  const { icon: Icon, tone } = notificationMark(notif);
  const age = notificationAge(notif.created_at, t, intlLocaleFor(lang));

  return (
    <button
      type="button"
      onClick={() => onOpen(notif)}
      className={cn(
        'flex w-full items-start gap-3 border-b border-border/70 px-4 py-3.5 text-start',
        'transition-colors last:border-0 hover:bg-[hsl(var(--secondary))]/50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))]',
        /* Unread is a ground, not a dot. A 2px circle at the end of a row is a legend
           nobody was given; a tinted row is read without being explained. */
        !notif.read && 'bg-[hsl(var(--gold-soft))]/45',
      )}
    >
      <span
        className={cn(
          'grid h-8 w-8 shrink-0 place-items-center rounded-full ring-1 ring-inset',
          tone === 'accent'
            ? 'bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))] ring-[hsl(var(--gold-border))]'
            : tone === 'alert'
              ? 'bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))] ring-[hsl(var(--destructive))]/25'
              : 'bg-[hsl(var(--secondary))] text-muted-foreground ring-border',
        )}
        aria-hidden="true"
      >
        <Icon className="h-4 w-4" />
      </span>

      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span
            className={cn(
              'min-w-0 break-words font-display text-2xs',
              notif.read ? 'font-medium text-foreground/80' : 'font-semibold text-foreground',
            )}
          >
            {title}
          </span>
          {/* The age, on the title's own line rather than as a third paragraph. */}
          <span className="shrink-0 text-2xs text-muted-foreground/80">{age}</span>
        </span>
        {body ? (
          <span className="line-clamp-2 block break-words text-2xs text-muted-foreground">
            {body}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function NotificationsContent() {
  const { homatchUser } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  const userId = homatchUser?.id ?? null;

  const load = useCallback(async (which: Filter) => {
    if (!userId) return;
    setLoading(true);
    try {
      const rows = await getNotifications(userId, PAGE, { unreadOnly: which === 'UNREAD' });
      setNotifications(rows);
      setExhausted(rows.length < PAGE);
    } catch {
      toast.error(t('notif_load_error'));
    } finally {
      setLoading(false);
    }
  }, [userId, t]);

  useEffect(() => { void load(filter); }, [load, filter]);

  const more = async () => {
    if (!userId || loadingMore || exhausted) return;
    const oldest = notifications[notifications.length - 1]?.created_at;
    if (!oldest) return;
    setLoadingMore(true);
    try {
      const rows = await getNotifications(userId, PAGE, {
        unreadOnly: filter === 'UNREAD',
        before: oldest,
      });
      setNotifications((prev) => [...prev, ...rows]);
      setExhausted(rows.length < PAGE);
    } finally {
      setLoadingMore(false);
    }
  };

  /*
   * TAPPING A ROW IS WHAT READS IT.
   *
   * Not arriving on the page, and not scrolling past. The optimistic update keeps the row
   * where it is rather than making it vanish out from under the tap in the Unread filter
   * — the list is refiltered the next time it loads, which is the less startling moment.
   */
  const open = (notif: Notification) => {
    if (!notif.read) {
      setNotifications((prev) => prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n)));
      void markNotificationRead(notif.id);
    }
    const href = notificationHref(notif);
    if (href) navigate(href);
  };

  const readAll = async () => {
    if (!userId) return;
    await markAllNotificationsRead(userId);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const unread = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  return (
    <AppLayout>
      {/*
        THE LIGHT PREMIUM SHELL, which is where notifications belong: they are part of
        the application chrome rather than a product page, and the Dashboard beside them
        wears the same block. See src/index.css for the token note.
      */}
      <div className="hm-customer -mx-4 -my-6 min-h-[calc(100dvh-4rem)] px-4 py-6 md:-mx-6 md:-my-8 md:px-6 md:py-8">
        <div className="mx-auto w-full max-w-2xl space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h1 className="break-words font-display text-xl font-semibold tracking-[-0.015em] text-foreground">
                {t('notif_title')}
              </h1>
              {unread > 0 && (
                <p className="break-words text-2xs text-muted-foreground">
                  {t('notif_unread_count', { n: unread })}
                </p>
              )}
            </div>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => { void readAll(); }}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-2xs font-semibold text-foreground transition-colors hover:border-[hsl(var(--ring))]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              >
                <CheckCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="break-words text-start">{t('notif_mark_all_read')}</span>
              </button>
            )}
          </div>

          {/* Two filters, not eight categories. */}
          <div className="flex items-center gap-1.5">
            {(['ALL', 'UNREAD'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
                className={cn(
                  'inline-flex min-h-8 items-center rounded-full border px-3 text-2xs font-semibold transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                  filter === value
                    ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground',
                )}
              >
                {t(value === 'ALL' ? 'notif_filter_all' : 'notif_filter_unread')}
              </button>
            ))}
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            {loading ? (
              <div className="space-y-3 p-4">
                {[0, 1, 2, 3].map((row) => (
                  <div key={row} className="flex items-start gap-3">
                    <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-[hsl(var(--secondary))]" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-2/3 animate-pulse rounded bg-[hsl(var(--secondary))]" />
                      <div className="h-3 w-1/3 animate-pulse rounded bg-[hsl(var(--secondary))]" />
                    </div>
                  </div>
                ))}
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-start gap-2 px-5 py-8">
                <span
                  className="grid h-9 w-9 place-items-center rounded-full bg-[hsl(var(--secondary))] text-muted-foreground ring-1 ring-inset ring-border"
                  aria-hidden="true"
                >
                  <Bell className="h-4 w-4" />
                </span>
                <p className="break-words font-display text-sm font-semibold text-foreground">
                  {t(filter === 'UNREAD' ? 'notif_empty_unread' : 'empty_no_notifications_title')}
                </p>
                <p className="max-w-prose break-words text-2xs leading-relaxed text-muted-foreground">
                  {t('empty_no_notifications_desc')}
                </p>
              </div>
            ) : (
              notifications.map((notif) => (
                <NotifRow key={notif.id} notif={notif} onOpen={open} />
              ))
            )}
          </div>

          {!loading && notifications.length > 0 && !exhausted && (
            <button
              type="button"
              onClick={() => { void more(); }}
              disabled={loadingMore}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-2xs font-semibold text-foreground transition-colors hover:border-[hsl(var(--ring))]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-60"
            >
              {loadingMore && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />}
              <span className="break-words text-start">{t('notif_load_more')}</span>
            </button>
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
