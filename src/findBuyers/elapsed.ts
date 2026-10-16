// FIND BUYERS — how long the search has been running, from the SERVER's clock
// marks only (find_buyers_campaign_status → CampaignLifecycle). The screen's
// one-second tick re-renders; it never counts. A refresh, a second tab or a
// remount computes the same number from the same timestamps.
//
//   start   startedAt, else createdAt (a search that has not started its
//           first source yet has still been running since it was created)
//   end     completedAt once the search is no longer live;
//           pausedAt while PAUSED (the clock is frozen, not running);
//           otherwise now
//
// Pure: no imports, so node:test loads it directly.

export interface ElapsedInput {
  state: string;
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  pausedAt: string | null;
}

const LIVE = new Set(['PREPARING', 'QUEUED', 'SEARCHING', 'PARTIAL_RESULTS', 'PAUSING', 'PAUSED']);

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** Milliseconds the search has run, or null when the server gave no start. */
export function elapsedMs(c: ElapsedInput | null | undefined, now: number): number | null {
  if (!c) return null;
  const start = ms(c.startedAt) ?? ms(c.createdAt);
  if (start == null) return null;
  let end: number;
  if (!LIVE.has(c.state)) end = ms(c.completedAt) ?? ms(c.pausedAt) ?? now;
  else if (c.state === 'PAUSED') end = ms(c.pausedAt) ?? now;
  else end = now;
  return Math.max(0, end - start);
}

/** Whether the clock moves right now (live and not paused). */
export function elapsedTicks(c: ElapsedInput | null | undefined): boolean {
  return Boolean(c && LIVE.has(c.state) && c.state !== 'PAUSED');
}

/** mm:ss under an hour, h:mm:ss from an hour; digits only (render with dir="ltr"). */
export function formatElapsed(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const total = Math.floor(Math.max(0, value) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}
