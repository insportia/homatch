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
import type { Notification } from '@/types/types';
import { categoryOf, isMessageFor } from '@/lib/notifications/feed';
import { getActiveConversation } from '@/lib/notifications/signals';
import { claimAnnouncement, notificationAnnouncementKeys } from '@/lib/notifications/announced';
import { resyncPushSubscription } from '@/lib/push';
import { markNotificationRead } from '@/services/api';
import { notificationActionKey, notificationHref, notificationMark, notificationText } from './presentation';
import { ToastCard } from './ToastCard';

/** The card itself: the shared premium popup (ToastCard), one action. */
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
  const { icon, tone } = notificationMark(notif);
  const subject = (notif.metadata as Record<string, unknown> | null)?.subject_label;

  return (
    <ToastCard
      icon={icon}
      tone={tone}
      title={title}
      body={body}
      subject={typeof subject === 'string' ? subject : null}
      actionLabel={t(notificationActionKey(notif))}
      onOpen={onOpen}
      onDismiss={onDismiss}
      dismissLabel={t('notif_dismiss')}
    />
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

  /* A browser that already said yes keeps receiving: if the server retired this
     device (a 410 once, ten failures in a row), re-register the subscription the
     browser still holds. Never asks for permission. */
  useEffect(() => {
    if (userId) void resyncPushSubscription();
  }, [userId]);

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

        /*
         * Already on this verification's own screen: the page itself shows
         * the report the moment it exists. A "ready" toast here fired before
         * the report was built and read as a pop-up standing in front of it
         * (owner, 2026-10-09). Other pages still get the toast.
         */
        if (notif.type === 'VERIFY_COMPLETE') {
          const jobId = (notif.metadata as Record<string, unknown> | null)?.job_id;
          const here = new URLSearchParams(where.current.search).get('job');
          if (where.current.pathname.startsWith('/verify') && jobId && here === String(jobId)) return;
        }

        /* The job centre may already have shown this finished task (or this
           arrives second for a verification announced by both): one card only. */
        const keys = notificationAnnouncementKeys(notif);
        if (!claimAnnouncement(keys)) return;

        const href = notificationHref(notif);
        /* A finished task whose own page is the one on screen: the page already
           shows the result, the same rule the job centre keeps (presentedHere).
           The row still waits in the bell. */
        if (keys.length > 1 && href) {
          const query = new URLSearchParams(href.includes('?') ? href.slice(href.indexOf('?')) : '');
          const now = new URLSearchParams(where.current.search);
          const samePage = href.split('?')[0] === where.current.pathname
            && [...query.entries()].every(([k, v]) => now.get(k) === v);
          if (samePage) return;
        }
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
