// TWO SMALL PIECES OF IN-TAB STATE THE NOTIFICATION SURFACES SHARE.
//
// WHICH CONVERSATION IS ON SCREEN
//
// The live toast suppresses "New message" for the conversation somebody is already
// reading, and it used to decide that from the URL. But the chat opens a conversation
// from its own list without touching the URL, so the one case the rule existed for —
// reading a thread when the next message arrives — still produced a card over the
// composer. The thread now says which conversation it is showing, here, for as long as
// it is mounted.
//
// SOMETHING WAS MARKED READ
//
// Realtime delivers the UPDATE to the bell eventually, and never if the socket is down.
// Marking read is an act in THIS tab, so this tab's bell hears about it directly and
// refetches its count at once instead of waiting on a frame that may not come.

let activeConversationId: string | null = null;

export function setActiveConversation(id: string | null): void {
  activeConversationId = id || null;
}

export function getActiveConversation(): string | null {
  return activeConversationId;
}

const CHANGED = 'hm:notifications-changed';

/** Say that this tab changed notification state (read flags). */
export function signalNotificationsChanged(): void {
  if (typeof window === 'undefined') return;
  try { window.dispatchEvent(new Event(CHANGED)); } catch { /* no window events: nothing listens */ }
}

/** Listen for this tab's own notification changes. Returns the unsubscribe. */
export function onNotificationsChanged(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(CHANGED, listener);
  return () => window.removeEventListener(CHANGED, listener);
}
