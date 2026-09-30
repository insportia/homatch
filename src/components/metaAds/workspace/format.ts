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
