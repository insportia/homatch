/*
 * THE BROWSER HALF OF "BACK TO EXACTLY WHERE I WAS" (see lib/homi/returnTarget.ts).
 *
 * CAPTURE. Every click or form submit outside the chat records where the
 * person was at that instant: the full path, the scroll position, and the
 * nearest author-written id around what they pressed. When the chat opens a
 * moment later, it takes that record as its return target. This is why no
 * page has to remember to pass anything: the investment calculator, a
 * property page, a contract clause, the topbar ask box and the bottom-nav
 * tab all get a way back for free.
 *
 * RESTORE. Pressing back in the chat queues the target in sessionStorage
 * and navigates. When the origin page mounts again, the place is restored:
 * the anchor element first, the raw scroll position otherwise, re-asserted
 * for a short while as late content (images, data) settles, and abandoned
 * the instant the person scrolls, taps or types themselves.
 *
 * Scoped on purpose: it only ever acts on a pending HOMI return, so it does
 * not compete with the app's general scroll behaviour.
 */

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  isStableAnchorId, restoreScrollY, samePage, sanitizeReturnTarget, type HomiReturnTarget,
} from '@/lib/homi/returnTarget';

const PENDING_KEY = 'homatch.homi.return.pending.v1';
const ORIGIN_MAX_AGE_MS = 15_000;
const PENDING_MAX_AGE_MS = 20_000;

let installed = false;
let lastOrigin: (HomiReturnTarget & { at: number }) | null = null;

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function nearestAnchor(target: EventTarget | null): { anchorId?: string; anchorTop?: number } {
  let el = target instanceof Element ? target : null;
  while (el && el !== document.body) {
    if (isStableAnchorId(el.id)) return { anchorId: el.id, anchorTop: el.getBoundingClientRect().top };
    el = el.parentElement;
  }
  return {};
}

function record(event: Event) {
  const path = currentPath();
  const target = sanitizeReturnTarget({ path, y: window.scrollY, ...nearestAnchor(event.target) });
  // A click inside the chat (or on an auth screen) is not a place to return to.
  lastOrigin = target ? { ...target, at: Date.now() } : null;
}

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('click', record, { capture: true, passive: true });
  window.addEventListener('submit', record, { capture: true });
}

/* Installed as soon as the shell's code loads, so the very first page a person
   opens (which may not mount AppLayout yet) is already a place to come back to. */
install();

/** The place the person was when they asked HOMI, if that was a moment ago. */
export function consumeHomiOrigin(): HomiReturnTarget | null {
  const o = lastOrigin;
  lastOrigin = null;
  if (!o || Date.now() - o.at > ORIGIN_MAX_AGE_MS) return null;
  return sanitizeReturnTarget({ path: o.path, y: o.y, anchorId: o.anchorId, anchorTop: o.anchorTop });
}

/** Called by the chat's back control just before it navigates. */
export function queueHomiRestore(target: HomiReturnTarget): void {
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ ...target, at: Date.now() })); } catch { /* storage unavailable: the page still opens */ }
}

function takePending(path: string): HomiReturnTarget | null {
  let raw: string | null = null;
  try { raw = sessionStorage.getItem(PENDING_KEY); } catch { return null; }
  if (!raw) return null;
  let parsed: (HomiReturnTarget & { at?: number }) | null = null;
  try { parsed = JSON.parse(raw); } catch { /* corrupt */ }
  const target = sanitizeReturnTarget(parsed);
  const fresh = typeof parsed?.at === 'number' && Date.now() - parsed.at < PENDING_MAX_AGE_MS;
  if (!target || !fresh) { try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ } return null; }
  if (!samePage(target.path, path)) return null; // not this page (yet)
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
  return target;
}

/** Mounted once per page by AppLayout: installs capture, performs a pending restore. */
export function useHomiReturn(): void {
  const location = useLocation();
  useEffect(() => { install(); }, []);

  useEffect(() => {
    const target = takePending(`${location.pathname}${location.search}`);
    if (!target) return;
    let frame = 0;
    let frames = 0;
    let settled = 0;
    let stopped = false;
    const stop = () => { stopped = true; cancelAnimationFrame(frame); };
    const opts = { passive: true, once: true } as const;
    window.addEventListener('wheel', stop, opts);
    window.addEventListener('touchstart', stop, opts);
    window.addEventListener('keydown', stop, { once: true });
    const tick = () => {
      if (stopped) return;
      const el = target.anchorId ? document.getElementById(target.anchorId) : null;
      const anchorTop = el ? el.getBoundingClientRect().top + window.scrollY : null;
      const y = restoreScrollY(target, anchorTop);
      const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const top = Math.min(y, max);
      if (Math.abs(window.scrollY - top) > 1) {
        try { window.scrollTo({ top, left: 0, behavior: 'instant' as ScrollBehavior }); } catch { window.scrollTo(0, top); }
      }
      // Done once the real target is reachable and has held still for a few frames.
      settled = top === y && Math.abs(window.scrollY - y) <= 1 ? settled + 1 : 0;
      frames += 1;
      if (settled < 8 && frames < 150) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      stop();
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchstart', stop);
      window.removeEventListener('keydown', stop);
    };
  }, [location.key, location.pathname, location.search]);
}
