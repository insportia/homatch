// HOMATCH — what the viewport should do when the location changes.
//
// One pure decision, used by ScrollToTop and by the tests, so "where does a
// page start" has a single answer that can be checked without a browser:
//
//   a NEW page (PUSH or REPLACE to a different path)   → its top
//   back or forward (POP)                              → where the person was
//   a location carrying a #hash                        → that anchor
//   the same path with only the query changed          → nothing at all
//
// The last line is what keeps tabs, filters and pagination that write to the
// query string from throwing a reader back to the header.

export type NavigationKind = 'PUSH' | 'REPLACE' | 'POP';
export type ScrollDecision = 'TOP' | 'RESTORE' | 'ANCHOR' | 'NONE';

export interface ScrollInput {
  /** The pathname shown before this change, or null on the very first render. */
  previousPath: string | null;
  previousHash?: string | null;
  pathname: string;
  hash: string;
  navigationType: NavigationKind;
}

export function decideScroll(input: ScrollInput): ScrollDecision {
  const { previousPath, previousHash = '', pathname, hash, navigationType } = input;
  const pathChanged = previousPath !== pathname;
  const hashChanged = (previousHash ?? '') !== hash;

  /* Back and forward, and the first load (React Router reports it as POP): the
     position the person left this entry at. A reload is the same entry. */
  if (navigationType === 'POP') return pathChanged || previousPath === null ? 'RESTORE' : 'NONE';

  /* An anchor asked for an element, not the top. */
  if (hash && (pathChanged || hashChanged)) return 'ANCHOR';

  if (!pathChanged) return 'NONE';
  return 'TOP';
}

/* ── Remembered positions ───────────────────────────────────────────────────
 *
 * The browser's own restoration runs when the history entry changes, which in
 * a single page app is BEFORE the lazy route has loaded and before its data has
 * arrived. The page is short at that moment, the remembered offset is clamped
 * to its height, and the person lands near the top of the list they were half
 * way down. So the app remembers the offset itself, per history entry, and
 * restores it once the page is tall enough to hold it. */

const STORE = 'hm:scroll-positions:v1';
const MAX_ENTRIES = 60;

type Positions = Record<string, number>;

function read(): Positions {
  try {
    const raw = window.sessionStorage.getItem(STORE);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Positions) : {};
  } catch {
    return {};
  }
}

/*
 * React Router calls an entry it did not create 'default' (the first page of a
 * tab: a typed address, a link from outside). Every such entry shares that one
 * name, so it is told apart by its path. ScrollToTop never restores a 'default'
 * entry on the first render of a document, which is what keeps a position from
 * an earlier visit in this tab off a freshly typed address.
 */
export function entryName(key: string, pathname: string): string {
  return key === 'default' ? `default:${pathname}` : key;
}

const usable = (key: string) => Boolean(key) && key !== 'default';

export function rememberPosition(key: string, y: number): void {
  if (!usable(key) || !Number.isFinite(y)) return;
  try {
    const all = read();
    delete all[key];
    all[key] = Math.max(0, Math.round(y));
    const keys = Object.keys(all);
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete all[old];
    window.sessionStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    /* Storage off or full: back simply starts at the top. */
  }
}

export function recallPosition(key: string): number | null {
  if (!usable(key)) return null;
  const y = read()[key];
  return typeof y === 'number' && Number.isFinite(y) ? y : null;
}
