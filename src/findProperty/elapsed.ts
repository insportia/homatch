/*
 * Find Property — how long a search has been running, from SERVER timestamps.
 *
 * Start is the search's own createdAt. While it runs, the clock is now − start;
 * once the server says it is terminal, the clock stops at completedAt. If the
 * server has not supplied a completion time for a finished search, there is no
 * honest duration to show, so the answer is null. A refresh shows the same
 * time because nothing here is kept in the browser.
 */

export interface ElapsedInput { createdAt: string; terminal: boolean; completedAt?: string | null }

export function elapsedMs(search: ElapsedInput, now: number): number | null {
  const start = Date.parse(search.createdAt);
  if (!Number.isFinite(start)) return null;
  if (search.terminal) {
    const end = search.completedAt ? Date.parse(search.completedAt) : NaN;
    return Number.isFinite(end) ? Math.max(0, end - start) : null;
  }
  return Math.max(0, now - start);
}

/** "0:07", "12:05", "1:02:09" — always Latin digits, read left to right. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}
