// Small, pure formatting helpers for the Meta Ads workspace. Money is always
// formatted with moneyIn(minor, currency, locale) from the service layer —
// one currency at a time; nothing here ever adds amounts together.

export const pct = (ratio: number | null | undefined, locale: string) =>
  ratio == null || !Number.isFinite(ratio)
    ? '—'
    : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(ratio);

export const count = (n: number | null | undefined, locale: string) =>
  n == null || !Number.isFinite(n) ? '—' : new Intl.NumberFormat(locale).format(n);

export const dateTime = (iso: string | null | undefined, locale: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
};

/** The newest timestamp among the given ISO strings, or null. */
export const newest = (values: Array<string | null | undefined>) => {
  let best: string | null = null;
  for (const v of values) if (v && (!best || v > best)) best = v;
  return best;
};

export const SELECT_CLASS =
  'h-10 w-full min-w-0 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]';

/**
 * How long ago, from a real timestamp, as { key, n } for the mm_w_ago_* copy:
 * the viewer's language comes from the translation bundle, not from the
 * browser's Intl data (which lacks Georgian relative time in some builds).
 */
export const ago = (iso: string | null | undefined, nowMs = Date.now()): { key: string; n: number } | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 60) return { key: 'mm_w_ago_now', n: 0 };
  if (s < 3600) return { key: 'mm_w_ago_min', n: Math.round(s / 60) };
  if (s < 86400) return { key: 'mm_w_ago_hour', n: Math.round(s / 3600) };
  return { key: 'mm_w_ago_day', n: Math.round(s / 86400) };
};
