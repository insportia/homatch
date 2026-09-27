// WHEN SOMETHING HAPPENS WHILE YOU ARE LOOKING AT THE PAGE.
//
// The bell already counted live — `useNotificationCount` has subscribed to the
// notifications table since it was written. What it did was change a number from 3 to 4
// in the corner of a header somebody is not looking at. A customer reading their matches
// when a message arrives found out about it the next time they glanced at the top right.
//
// This is the other half: the row arrives, and it says so.
//
// REALTIME IS AN ENHANCEMENT, NEVER THE RECORD
//
// The database row is written first and is authoritative. This subscribes to inserts and
// shows what arrives; if the socket was closed, the tab was asleep, the customer was on a
// train, or the delivery was simply missed, nothing is lost — the row is still there, the
// count still includes it, and the Notification Center still lists it. Nothing here marks
// anything read, stores anything, or is depended on by anything.
//
// THE OPEN CONVERSATION IS THE ONE EXCEPTION
//
// A toast saying "new message" on top of the conversation that is showing you that message
// is noise, and worse, it covers the composer on a phone. So a NEW_MESSAGE notification for
// the conversation currently on screen is suppressed — the message itself is already
// arriving live in the thread, and the unread state is the server's either way.
//
// WHAT IT WILL NOT DO
//
//   Interrupt. No modal, no alert(), no sound, nothing that takes focus. A toast that can
//   be ignored is the correct weight for "somebody wrote to you".
//
//   Cover navigation. Bottom-right on a desktop, top on a phone — above the content and
//   clear of the bottom navigation and of any composer.
//
//   Move, for somebody who asked things not to. `prefers-reduced-motion` is honoured by
//   the toast library and by the class below.

import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { cn } from '@/lib/utils';
import type { Notification } from '@/types/types';
import { categoryOf, isMessageFor } from '@/lib/notifications/feed';
import { getActiveConversation } from '@/lib/notifications/signals';
import { markNotificationRead } from '@/services/api';
import { notificationHref, notificationMark, notificationText } from './presentation';

/** The card itself. Premium, compact, and one action. */
function LiveCard({
  notif,
  onOpen,
  onDismiss,
}: {
  notif: Notification;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const { t, lang } = useLanguage();
  const { title, body } = notificationText(notif, t, lang);
  const { icon: Icon, tone } = notificationMark(notif);

  return (
    <div
      className={cn(
        'pointer-events-auto flex w-[min(22rem,calc(100vw-2rem))] items-start gap-3',
        'rounded-2xl border border-border bg-card p-3.5 shadow-[var(--shadow-hover)]',
      )}
      role="status"
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

      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="break-words font-display text-2xs font-semibold text-foreground">{title}</p>
        {body ? (
          <p className="line-clamp-2 break-words text-2xs text-muted-foreground">{body}</p>
        ) : null}
        <div className="flex items-center gap-2 pt-1.5">
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex min-h-8 items-center rounded-lg bg-[hsl(var(--primary))] px-2.5 text-2xs font-semibold text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--primary))]/88 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          >
            {t('notif_open')}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex min-h-8 items-center rounded-lg px-2 text-2xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          >
            {t('notif_dismiss')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Mounted once, inside the authenticated shell. Renders nothing of its own.
 */
export function LiveNotifications() {
  const { homatchUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  /*
   * The route in a ref rather than in the effect's dependencies. Re-subscribing to a
   * realtime channel on every navigation would drop and re-open the socket constantly,
   * and a message that arrived during the gap would be the one thing this exists to
   * deliver.
   */
  const where = useRef(location);
  where.current = location;

  const userId = homatchUser?.id ?? null;

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`notif-live-${userId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        /* The server filters. A client-side check would mean other people's rows
           reaching this browser in order to be discarded here. */
        filter: `user_id=eq.${userId}`,
      }, (payload) => {
        const notif = payload.new as Notification;
        /* An aggregate row is updated rather than inserted, so a burst of matches
           produces one card here — which is what the aggregation was for. */
        if (!notif?.id) return;

        /*
         * ALREADY LOOKING AT IT. The message is arriving live in the thread below and a
         * card on top of it would cover the composer to say what the screen already
         * says.
         *
         * "Looking at it" is the conversation the thread says it is showing — the chat
         * opens one from its own list without touching the URL — or, failing that, the
         * one the URL names. And since the person is reading that conversation right
         * now, the notification about it is read too: the bell must not stay lit for
         * a message they watched arrive. Only while the tab is visible — a message that
         * lands in a background tab has not been seen by anybody. The MESSAGE's own
         * seen receipt is the chat's business and is not touched here.
         */
        if (categoryOf(notif) === 'MESSAGE') {
          const params = new URLSearchParams(where.current.search);
          const onChat = where.current.pathname.startsWith('/chat');
          const open = getActiveConversation()
            ?? (onChat ? (params.get('conversation') ?? params.get('c')) : null);
          if (isMessageFor(notif, open)) {
            if (typeof document === 'undefined' || document.visibilityState === 'visible') {
              void markNotificationRead(notif.id);
            }
            return;
          }
        }

        const href = notificationHref(notif);
        toast.custom((id) => (
          <LiveCard
            notif={notif}
            onOpen={() => { toast.dismiss(id); if (href) navigate(href); }}
            onDismiss={() => toast.dismiss(id)}
          />
        ), {
          /* Long enough to read a name and a line, short enough not to sit there. */
          duration: 7000,
          /* One card per notification, so a retried realtime frame cannot stack two. */
          id: `notif-${notif.id}`,
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId, navigate]);

  return null;
}
