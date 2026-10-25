import type { NavigateFunction } from 'react-router-dom';
/**
 * BACK NAVIGATION, WITHOUT THE TRAP.
 *
 * Split out of SmartBack.tsx with no React and no JSX, so node:test can load
 * it directly — the same reason uploadValidation.ts is separate from the
 * service that uses it. The rules below are the part that can be wrong in a
 * way a customer notices, so they are the part that gets tested.
 *
 * WHY NOT navigate(-1)
 *
 * `navigate(-1)` walks the BROWSER's history, which is not the app's. Someone
 * who opened a verification case from an email, a shared link or a search
 * result has no Homatch screen behind them, so "Back" would throw them out of
 * the product entirely. That is worse than having no back button, because it
 * is a trap that springs only for the people who did not arrive through the
 * front door.
 *
 * So: count the route changes this tab has actually made. Above zero, there
 * is a real Homatch screen behind us and history is the honest answer — it
 * keeps scroll position and the customer's own path. At zero, fall back to
 * the screen that CONTAINS this one.
 */

/* Module-level rather than React context: the count is a property of the tab
   and every consumer wants the same number. A full reload resets it, which is
   correct — a reload really does leave nothing of ours behind. */
let inAppNavigations = 0;

/** Called from the router on each real route change. */
export function noteInAppNavigation(): void {
  inAppNavigations += 1;
}

export function canGoBackInApp(): boolean {
  return inAppNavigations > 0;
}

/** Test seam: exercising the counter should not require real navigation. */
export function __resetNavigationCountForTests(): void {
  inAppNavigations = 0;
  historyEntries.length = 0;
}

/*
 * WHICH SCREEN IS EACH HISTORY ENTRY.
 *
 * The counter above says "something of ours is behind us", which is not the
 * same as "the previous SCREEN is one step back". A screen can push entries
 * of its own — a results page number, a fragment link — and `navigate(-1)`
 * then lands on the same screen, the browser restores the old scroll, and
 * Back reads as "it scrolled down". So the router records, per history
 * index, which pathname that entry shows; Back walks to the nearest entry
 * with a DIFFERENT pathname.
 *
 * The index is the one React Router keeps in `window.history.state.idx`.
 * Entries below the current index never change while we sit above them
 * (a push or replace only rewrites the current slot and forward), so what
 * was recorded for them stays true. A reload empties this table: unknown is
 * answered with null and the caller falls back to the containing screen.
 */
const historyEntries: Array<string | undefined> = [];

/** Called from the router on every location change (push, replace or pop). */
export function noteHistoryEntry(idx: number | null | undefined, pathname: string): void {
  if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx > 10000) return;
  historyEntries[idx] = normalise(pathname);
}

/**
 * How many entries back the previous different screen is, and which one it
 * is — or null when that is not known (deep link, reload, an entry we never
 * saw). Never 0: a step of zero would be a reload, and "same screen" is
 * exactly what Back must not return to.
 */
export function previousScreen(idx: number | null | undefined, pathname: string): { steps: number; pathname: string } | null {
  if (typeof idx !== 'number' || !Number.isInteger(idx) || idx <= 0) return null;
  const here = normalise(pathname);
  for (let i = idx - 1; i >= 0; i -= 1) {
    const entry = historyEntries[i];
    if (entry === undefined) return null;
    if (entry !== here) return { steps: idx - i, pathname: entry };
  }
  return null;
}

export function stepsToPreviousScreen(idx: number | null | undefined, pathname: string): number | null {
  return previousScreen(idx, pathname)?.steps ?? null;
}

/**
 * Back to the previous DIFFERENT screen, else a deterministic fallback (replace, so it
 * never loops) — for a page's own back control. `navigate(-1)` alone can pop a
 * same-screen entry (a hash or a query change) and only restore its scroll.
 */
export function goToPreviousScreen(navigate: NavigateFunction, fallback: string): void {
  const prev = typeof window === 'undefined' ? null : previousScreen(currentHistoryIndex(), window.location.pathname);
  if (prev) navigate(-prev.steps);
  else navigate(fallback, { replace: true });
}

/** The router's index for the entry being shown now, when it set one. */
export function currentHistoryIndex(): number | null {
  if (typeof window === 'undefined') return null;
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' ? idx : null;
}

/**
 * A return path handed to a screen (router state `from`, or `?returnTo=`),
 * accepted only when it is a path inside this app that starts with one of
 * the allowed prefixes. No scheme, no protocol-relative `//host`, no
 * backslashes — anything else is ignored rather than followed.
 */
export function safeReturnPath(value: unknown, prefixes: readonly string[] = ['/property/']): string | null {
  if (typeof value !== 'string') return null;
  const v = value;
  if (!v || v.length > 512) return null;
  if (!v.startsWith('/') || v.startsWith('//') || v.includes('\\') || /[\u0000-\u001f]/.test(v)) return null;
  if (/^\/[^/?#]*:/.test(v)) return null;
  /* A prefix "/property/" also admits the list itself ("/property", "/property?view=…"). */
  const ok = prefixes.some((p) => v.startsWith(p)
    || (p.endsWith('/') && (v === p.slice(0, -1) || v.startsWith(`${p.slice(0, -1)}?`))));
  return ok ? v : null;
}

/**
 * Router state an opener passes so the screen it opens can return to it:
 * `<Link to=".../edit" state={returnState()}>`. Read at render, from the
 * address bar, so it needs no hook and no React here.
 */
export function returnState(): { from: string } | undefined {
  if (typeof window === 'undefined') return undefined;
  return { from: window.location.pathname + window.location.search };
}

function normalise(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

/**
 * Where a screen sits in the product, for when history cannot help.
 *
 * Ordered: the first match wins, so `/property/:id/matches` is listed above
 * `/property/:id` and does not fall through to the dashboard.
 */
const PARENTS: ReadonlyArray<readonly [RegExp, string | ((m: RegExpMatchArray) => string)]> = [
  [/^\/verify\/[^/]+$/, '/verify'],
  [/^\/contracts\/[^/]+$/, '/contracts'],
  [/^\/property\/([^/]+)\/matches\/demo\/[^/]+$/, (m) => `/property/${m[1]}/buyer/demo`],
  /* Find Buyers 3.0: the dashboard (/matches) opens two result pages; a buyer profile and
     HOMATCH Leads belong to the internal one, a post opportunity to the external one. */
  [/^\/property\/([^/]+)\/buyers\/opportunity\/[^/]+$/, (m) => `/property/${m[1]}/buyers/external`],
  /* One potentially interested person (lead detail) belongs to the live results page. */
  [/^\/property\/([^/]+)\/buyers\/lead\/[^/]+$/, (m) => `/property/${m[1]}/buyers/external`],
  [/^\/property\/([^/]+)\/buyers\/(external|internal)$/, (m) => `/property/${m[1]}/matches`],
  [/^\/property\/([^/]+)\/buyer\/[^/]+$/, (m) => `/property/${m[1]}/buyers/internal`],
  [/^\/property\/([^/]+)\/leads$/, (m) => `/property/${m[1]}/buyers/internal`],
  [/^\/property\/([^/]+)\/matches$/, (m) => `/property/${m[1]}`],
  /* Editing a property returns to that property, never to the whole portfolio. */
  [/^\/property\/([^/]+)\/edit$/, (m) => `/property/${m[1]}`],
  [/^\/property\/(?:add|import|create)$/, '/property'],
  /* A property belongs to the owner workspace, not the dashboard — the page's
     own back control already said so and the shell used to disagree. */
  [/^\/property\/[^/]+$/, '/property'],
  [/^\/deal-rooms\/[^/]+$/, '/deal-rooms'],
  /* Two-level communications screens go to their own list, not the hub. */
  [/^\/outreach\/campaigns\/new$/, '/outreach/campaigns'],
  [/^\/outreach\/contacts\/import$/, '/outreach/contacts'],
  [/^\/outreach\/(agents|contacts)\/[^/]+$/, (m) => `/outreach/${m[1]}`],
  [/^\/outreach\/(calls|whatsapp|email)\/(?:campaigns\/new|contacts\/import)$/, (m) => `/outreach/${m[1]}`],
  [/^\/outreach\/(calls|whatsapp|email)\/[^/]+$/, (m) => `/outreach/${m[1]}`],
  [/^\/outreach\/[^/]+$/, '/outreach'],
  [/^\/developer\/[^/]+$/, '/dashboard'],
  /* A guide topic belongs to the guide tab of My Georgia, which For Expats opens (2026-10-25). */
  [/^\/for-expats\/georgia\/[^/]+$/, '/my-georgia?tab=guide'],
  [/^\/for-expats\/plan$/, '/my-georgia'],
  [/^\/my-georgia\/start$/, '/my-georgia'],
  /* A design project, a version inside it and its walkthrough all return to
     the Design Studio launcher; the launcher itself belongs to the dashboard. */
  [/^\/design-studio\/[^/]+(?:\/.*)?$/, '/design-studio'],
  [/^\/design-studio$/, '/dashboard'],
  /* A single-level product screen belongs to the dashboard. Listed after the
     nested patterns so /outreach/email is not caught by /outreach. */
  [/^\/(?:ai|chat|live-chat|activity|notifications|credits|profile|viewings|active-search|outreach|deal-rooms|mortgage|investment|brokers)$/, '/dashboard'],
];

/**
 * The containing screen for a path, or null when there is no obvious one.
 *
 * Null is deliberate rather than a guessed default: the component decides
 * once, in one place, that "nowhere obvious" means home. Inventing a parent
 * per route here would scatter that judgement across a table.
 */
export function parentRouteFor(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  for (const [pattern, target] of PARENTS) {
    const match = path.match(pattern);
    if (match) return typeof target === 'function' ? target(match) : target;
  }
  return null;
}
