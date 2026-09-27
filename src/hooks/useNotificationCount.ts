// THE UNREAD COUNT: ONE NUMBER, ONE SUBSCRIPTION, AND IT RECOVERS.
//
// The bell sits in two headers and the Notification Center shows the same number in its
// own title. Each used to count for itself — the centre by counting the rows it happened
// to have loaded, which is not the unread count of anybody with more than one page — so
// the three could disagree about the same person at the same moment.
//
// Now there is one store per signed-in account, shared by every component that asks:
//
//   THE NUMBER comes from a head-only count query against the table, never from a page.
//
//   REALTIME is a hint to recount, not the record. Any INSERT or UPDATE on the caller's
//   rows triggers a recount; the frame's contents are not trusted to do arithmetic with.
//
//   RECOVERY. A socket that dropped while a laptop slept delivers nothing for the events
//   it missed. So the count is refetched whenever the channel (re)subscribes, the tab
//   becomes visible again, the browser comes back online, and whenever THIS tab marks
//   something read — the last because that is an act here, and waiting for its own echo
//   through realtime is how a bell stays lit after "mark all read".

import { useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import { onNotificationsChanged } from '@/lib/notifications/signals';
import { getUnreadNotificationCount } from '@/services/api';

interface Store {
  userId: string;
  count: number;
  refs: number;
  teardown: () => void;
}

let store: Store | null = null;
/* Module-level, not per store: a store torn down and reopened (a StrictMode remount, a
   sign-out and back in) must still reach the components already listening. */
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function open(userId: string): Store {
  if (store && store.userId === userId) return store;
  if (store) { store.teardown(); store = null; }

  const s: Store = { userId, count: 0, refs: 0, teardown: () => {} };
  let alive = true;
  let inflight = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  /* Coalesced: a burst of twelve realtime frames is one recount, not twelve. */
  const refetch = async () => {
    if (!alive) return;
    if (inflight) { again = true; return; }
    inflight = true;
    try {
      const n = await getUnreadNotificationCount(userId);
      if (alive && n !== null && n !== s.count) { s.count = n; emit(); }
    } finally {
      inflight = false;
      if (again && alive) { again = false; void refetch(); }
    }
  };
  const soon = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void refetch(); }, 150);
  };

  const channel = supabase
    .channel(`notif-count-${userId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${userId}`,
    }, soon)
    .subscribe((status) => {
      /* SUBSCRIBED fires again after every reconnect: whatever happened while the
         socket was down is counted now. */
      if (status === 'SUBSCRIBED') soon();
    });

  const onVisible = () => { if (document.visibilityState === 'visible') soon(); };
  window.addEventListener('online', soon);
  document.addEventListener('visibilitychange', onVisible);
  const offLocal = onNotificationsChanged(soon);

  s.teardown = () => {
    alive = false;
    if (s.count !== 0) { s.count = 0; }
    if (timer) clearTimeout(timer);
    window.removeEventListener('online', soon);
    document.removeEventListener('visibilitychange', onVisible);
    offLocal();
    void supabase.removeChannel(channel);
  };

  store = s;
  void refetch();
  return s;
}

function release(s: Store) {
  s.refs -= 1;
  if (s.refs <= 0 && store === s) {
    s.teardown();
    store = null;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useNotificationCount(): number {
  const { homatchUser } = useAuth();
  const userId = homatchUser?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    const s = open(userId);
    s.refs += 1;
    return () => release(s);
  }, [userId]);

  return useSyncExternalStore(
    subscribe,
    () => (userId && store && store.userId === userId ? store.count : 0),
    () => 0,
  );
}
