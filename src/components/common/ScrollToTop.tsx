// HOMATCH — a new page starts at the beginning of itself.
//
// React Router does not scroll on navigation and never has: it swaps the
// elements and leaves the viewport where it was. So reading to the bottom of
// the home page and then opening Investment put the customer at the bottom of
// Investment, looking at whatever happened to be there, with no indication
// that they had arrived anywhere. The page had loaded correctly and looked
// broken.
//
// THE RULES (src/lib/scrollMemory.ts decides them, and is unit tested)
//
//   new page (PUSH or REPLACE to another path)  → the top, before paint
//   back / forward (POP)                        → where the person was
//   a location with a #hash                     → that element
//   only the query changed                      → nothing
//
// WHY BACK IS RESTORED HERE AND NOT BY THE BROWSER
//
// The browser restores the offset the moment the history entry changes. In
// this app that is before the lazy route has loaded and before its data has
// arrived, so the page is short, the offset is clamped, and back landed near
// the top of a list the person was half way down (owner, 2026-10-25: "it
// jumps here and there"). The app now remembers the offset per history entry
// and puts it back once the page is tall enough to hold it, and stops trying
// the instant the person scrolls, taps or types themselves.
//
// The QUERY is left alone. This keys on pathname only, so a tab, a filter, a
// page of results or a drawer that writes to the search string does not
// yank the viewport back to the top while somebody is reading — the exact
// failure this kind of fix usually introduces.

import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { decideScroll, entryName, recallPosition, rememberPosition } from '@/lib/scrollMemory';

/** Long enough for a lazy chunk and its first query; short enough not to fight anyone. */
const SETTLE_MS = 2500;
const USER_INPUT = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

function jumpTo(top: number): void {
  /* `instant` rather than smooth — a page ARRIVING should already be where it
     belongs, not animate there while the reader watches. */
  try {
    window.scrollTo({ top, left: 0, behavior: 'instant' as ScrollBehavior });
  } catch {
    window.scrollTo(0, top);
  }
}

/**
 * Keep trying `attempt` on every frame until it reports done, the page settles,
 * or the person takes over. Returns the cancel.
 */
function untilSettled(attempt: () => boolean): () => void {
  let frame = 0;
  let stopped = false;
  const started = Date.now();
  const stop = () => {
    stopped = true;
    if (frame) cancelAnimationFrame(frame);
    for (const e of USER_INPUT) window.removeEventListener(e, stop, true);
  };
  for (const e of USER_INPUT) window.addEventListener(e, stop, { capture: true, passive: true });
  const tick = () => {
    if (stopped) return;
    if (attempt() || Date.now() - started > SETTLE_MS) { stop(); return; }
    frame = requestAnimationFrame(tick);
  };
  tick();
  return stop;
}

export const ScrollToTop: React.FC = () => {
  const { pathname, hash, key } = useLocation();
  const navigationType = useNavigationType();
  /*
   * Only a CHANGED pathname scrolls. navigationType is read, not keyed on: the first PUSH
   * after a REPLACE (a results tab writing ?view=… after the page recorded its revision)
   * changed it on the same path and threw the reader to the header (owner, 2026-10-18).
   */
  const shown = useRef<string | null>(null);
  const shownHash = useRef<string>('');
  /* The history entry scroll positions are being recorded against. */
  const entry = useRef<string>(entryName(key, pathname));
  const pending = useRef<(() => void) | null>(null);

  /*
   * Layout effect, not effect: this runs before the browser paints, so the
   * new page is never briefly visible at the old scroll position.
   */
  useLayoutEffect(() => {
    const previous = shown.current;
    const previousHash = shownHash.current;
    shown.current = pathname;
    shownHash.current = hash;
    entry.current = entryName(key, pathname);
    const decision = decideScroll({ previousPath: previous, previousHash, pathname, hash, navigationType });
    if (decision === 'NONE') return;
    pending.current?.();
    pending.current = null;
    if (navigationType === 'POP') {
      /* A tab's first page on a fresh document has no position worth restoring. */
      if (previous === null && key === 'default') return;
      const target = recallPosition(entry.current);
      if (target === null) return;
      pending.current = untilSettled(() => {
        const room = document.documentElement.scrollHeight - window.innerHeight;
        jumpTo(Math.min(target, Math.max(0, room)));
        return room >= target;
      });
      return;
    }
    /* The anchor effect below owns a location that names an element. */
    if (hash) return;
    jumpTo(0);
  }, [pathname, hash, navigationType, key]);

  /* A #hash names an element that may not exist yet: the route is lazy and its
     sections arrive with their data. Wait for it rather than giving up. */
  useEffect(() => {
    if (!hash || navigationType === 'POP') return undefined;
    let id = hash.slice(1);
    try { id = decodeURIComponent(id); } catch { /* keep it raw */ }
    if (!id) return undefined;
    return untilSettled(() => {
      const el = document.getElementById(id);
      if (!el) return false;
      el.scrollIntoView({ block: 'start', behavior: 'instant' as ScrollBehavior });
      return true;
    });
  }, [pathname, hash, navigationType]);

  /* The app restores positions itself (above), so the browser must not also try,
     and remembers where the person is on the current entry so back can return. */
  useEffect(() => {
    try {
      if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    } catch { /* read-only in some embedded browsers: the browser keeps its own */ }
    let frame = 0;
    const save = () => {
      if (frame) return;
      /* Read the entry when the frame runs, not when the listener was made: a
         navigation in between must not write the new page's 0 over the old one. */
      frame = requestAnimationFrame(() => { frame = 0; rememberPosition(entry.current, window.scrollY); });
    };
    window.addEventListener('scroll', save, { passive: true });
    return () => {
      window.removeEventListener('scroll', save);
      if (frame) cancelAnimationFrame(frame);
      pending.current?.();
    };
  }, []);

  return null;
};

export default ScrollToTop;
