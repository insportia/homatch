// A LONG CATALOGUE, DRAWN A PAGE AT A TIME.
//
// A search can match thousands of pieces; the panel draws the first page and
// adds the next one when the end of the list scrolls into view (or "Show
// more" is pressed). The ranking is never changed — only how much of it is
// on screen.

/** Rows drawn before the reader scrolls. */
export const LIST_PAGE = 40;

/** How many rows to draw: never more than exist, never fewer than one page (when there are that many). */
export function shownCount(total: number, requested: number, page = LIST_PAGE): number {
  const t = Math.max(0, Math.floor(total));
  const r = Math.max(page, Math.floor(requested));
  return Math.min(t, r);
}

/** The next request after the end of the list came into view. */
export function nextShown(current: number, total: number, page = LIST_PAGE): number {
  return Math.min(Math.max(0, Math.floor(total)), Math.max(page, Math.floor(current)) + page);
}
