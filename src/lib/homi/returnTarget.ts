/*
 * THE WAY BACK FROM HOMI.
 *
 * Asking HOMI from a page (the investment calculator, a property, a contract
 * clause) opens the chat. The owner's rule: there must be a back control that
 * returns to EXACTLY the same page and place. A return target is that place:
 *
 *   path       pathname + search + hash, so any state a page already keeps in
 *              its URL (a tab, a filter, a selected item) comes back with it;
 *   y          the window scroll position when the person left;
 *   anchorId   the nearest element with an id around what they pressed, and
 *   anchorTop  where that element sat in the viewport, so the place survives
 *              a page whose content above it loaded a little differently.
 *
 * Pages that keep their own working state in storage (the investment
 * workspace does) restore it themselves; this restores the PLACE.
 *
 * Pure: the browser glue lives in components/homi/HomiReturnTracker.tsx.
 */

export interface HomiReturnTarget {
  path: string;
  y: number;
  anchorId?: string;
  anchorTop?: number;
}

/** Pages a "back" must never lead to: the chat itself and the auth screens. */
const NOT_A_RETURN = /^\/(ai|auth)(\/|$|\?|#)/;

/** An in-app path only: no scheme, no protocol-relative URL, no backslashes. */
export function isSafeReturnPath(path: unknown): path is string {
  return typeof path === 'string'
    && path.length > 0
    && path.length <= 2000
    && path.startsWith('/')
    && !path.startsWith('//')
    && !path.includes('\\')
    && ![...path].some((c) => c.charCodeAt(0) < 32)
    && !NOT_A_RETURN.test(path);
}

/* Stable, author-written ids only: generated ids (React's ":r1:", Radix,
   Headless UI) are re-minted on every mount and would point elsewhere. */
const ANCHOR_ID = /^(?!radix|headlessui|react)[A-Za-z][\w-]{0,80}$/;
export function isStableAnchorId(id: unknown): id is string {
  return typeof id === 'string' && ANCHOR_ID.test(id) && id !== 'root';
}

/** Anything (router state, storage) → a target that is safe to act on, or null. */
export function sanitizeReturnTarget(raw: unknown): HomiReturnTarget | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!isSafeReturnPath(o.path)) return null;
  const y = typeof o.y === 'number' && Number.isFinite(o.y) ? Math.max(0, Math.min(Math.round(o.y), 1_000_000)) : 0;
  const out: HomiReturnTarget = { path: o.path, y };
  if (isStableAnchorId(o.anchorId)) {
    out.anchorId = o.anchorId;
    if (typeof o.anchorTop === 'number' && Number.isFinite(o.anchorTop)) {
      out.anchorTop = Math.max(-100_000, Math.min(Math.round(o.anchorTop), 100_000));
    }
  }
  return out;
}

/**
 * Where to scroll, given the target and (when found) the anchor element's
 * current absolute top. The anchor wins: it is where the person actually was.
 */
export function restoreScrollY(target: HomiReturnTarget, anchorAbsoluteTop: number | null): number {
  if (anchorAbsoluteTop !== null && target.anchorId) {
    return Math.max(0, Math.round(anchorAbsoluteTop - (target.anchorTop ?? 0)));
  }
  return target.y;
}

/** Same page? Compares path + search, ignoring a trailing slash. */
export function samePage(a: string, b: string): boolean {
  const norm = (p: string) => {
    const noHash = p.split('#')[0];
    const [path, search = ''] = noHash.split('?');
    return `${path.replace(/\/+$/, '') || '/'}?${search}`;
  };
  return norm(a) === norm(b);
}
