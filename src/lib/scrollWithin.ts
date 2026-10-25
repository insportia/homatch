// HOMATCH — follow the newest message without moving the page.
//
// `bottomRef.scrollIntoView()` is how every chat in this app kept its latest
// message in view, and scrollIntoView scrolls EVERY scrollable ancestor,
// including the window. So a conversation box sitting half way down a page
// pulled the whole page down to itself: on mount when it restored an old
// conversation, and again on every streamed token (owner, 2026-10-25: "it
// jumps here and there; we must kill these jumps").
//
// This scrolls only the box the messages live in. A chat with no box of its
// own (the page itself is the scroller) gets the gentlest possible move: only
// when the newest line is out of sight, and only as far as needed to show it.

/* A box that is MEANT to scroll, whether or not it overflows yet: a short
   conversation's own box is still the right one, and skipping it would hand
   the scroll to some layout container further up. */
function scrolls(el: HTMLElement): boolean {
  return /(auto|scroll|overlay)/.test(window.getComputedStyle(el).overflowY);
}

/** The nearest ancestor that scrolls on its own, never the document. */
export function scrollContainerOf(el: Element | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node && node !== document.body && node !== document.documentElement) {
    if (scrolls(node)) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * Bring `anchor` (an element at the end of a message list) into view inside
 * its own scrolling box. Never scrolls the window unless `allowPage` is set,
 * and even then only by the minimum.
 */
export function followLatest(
  anchor: Element | null,
  opts: { smooth?: boolean; allowPage?: boolean } = {},
): void {
  if (!anchor || typeof window === 'undefined') return;
  const reduce = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const behavior: ScrollBehavior = opts.smooth && !reduce ? 'smooth' : 'auto';
  const box = scrollContainerOf(anchor);
  if (box) {
    try { box.scrollTo({ top: box.scrollHeight, behavior }); } catch { box.scrollTop = box.scrollHeight; }
    return;
  }
  if (!opts.allowPage) return;
  const rect = anchor.getBoundingClientRect();
  if (rect.top >= 0 && rect.bottom <= window.innerHeight) return;
  anchor.scrollIntoView({ block: 'nearest', behavior });
}
