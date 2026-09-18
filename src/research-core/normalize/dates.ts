/**
 * Date parsing and timestamp normalization.
 *
 * Dates decide freshness, and freshness is a scoring input, so an ambiguous
 * date has to stay ambiguous rather than become a confident wrong number.
 * `03/05/2024` is unresolvable without a locale, so the caller supplies one.
 */

export interface ParseDateOptions {
  /** Interpretation for `dd/mm` vs `mm/dd`. Default: 'day-first' (EU/GE). */
  order?: 'day-first' | 'month-first';
  /** Reference point for relative expressions like "3 days ago". */
  now?: number;
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
};

const RELATIVE_UNITS: Record<string, number> = {
  second: 1000,
  seconds: 1000,
  minute: 60_000,
  minutes: 60_000,
  hour: 3_600_000,
  hours: 3_600_000,
  day: 86_400_000,
  days: 86_400_000,
  week: 604_800_000,
  weeks: 604_800_000,
  month: 2_592_000_000, // 30d - approximate by construction, flagged as such
  months: 2_592_000_000,
  year: 31_536_000_000,
  years: 31_536_000_000,
};

/** Returns an ISO-8601 UTC string, or null when the input is not a date. */
export function parseDate(input: string | number | Date | null | undefined, options: ParseDateOptions = {}): string | null {
  if (input === null || input === undefined) return null;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input.toISOString();
  if (typeof input === 'number') {
    // Heuristic: 10-digit values are seconds, 13-digit are milliseconds.
    const ms = input < 1e11 ? input * 1000 : input;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const text = input.trim();
  if (!text) return null;

  // ISO-8601 first: unambiguous and by far the most common in structured data.
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(text)) {
    const parsed = Date.parse(text.includes('T') || text.includes(' ') ? text.replace(' ', 'T') : `${text}T00:00:00Z`);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }

  const relative = parseRelative(text, options.now ?? Date.now());
  if (relative) return relative;

  // "12 May 2024" / "May 12, 2024"
  const textual = text.match(/\b(\d{1,2})\s+([a-z]{3,9})\.?\s+(\d{4})\b/i);
  if (textual) {
    const month = MONTHS[(textual[2] as string).toLowerCase()];
    if (month !== undefined) return utc(Number(textual[3]), month, Number(textual[1]));
  }
  const textual2 = text.match(/\b([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/i);
  if (textual2) {
    const month = MONTHS[(textual2[1] as string).toLowerCase()];
    if (month !== undefined) return utc(Number(textual2[3]), month, Number(textual2[2]));
  }

  // Numeric with separators: 03/05/2024, 03.05.2024, 2024/05/03
  const numeric = text.match(/\b(\d{1,4})[./-](\d{1,2})[./-](\d{2,4})\b/);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const c = Number(numeric[3]);
    if (String(numeric[1]).length === 4) return utc(a, b - 1, c);

    const year = c < 100 ? 2000 + c : c;
    const dayFirst = (options.order ?? 'day-first') === 'day-first';
    // A value above 12 settles the ambiguity regardless of the configured order.
    if (a > 12) return utc(year, b - 1, a);
    if (b > 12) return utc(year, a - 1, b);
    return dayFirst ? utc(year, b - 1, a) : utc(year, a - 1, b);
  }

  return null;
}

function parseRelative(text: string, now: number): string | null {
  const lower = text.toLowerCase();
  if (/^(today|сегодня|დღეს)$/.test(lower)) return new Date(now).toISOString();
  if (/^(yesterday|вчера|გუშინ)$/.test(lower)) return new Date(now - 86_400_000).toISOString();

  const match = lower.match(/^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/);
  if (match) {
    const unit = RELATIVE_UNITS[`${match[2]}s`] ?? RELATIVE_UNITS[match[2] as string];
    if (unit) return new Date(now - Number(match[1]) * unit).toISOString();
  }
  return null;
}

function utc(year: number, monthIndex: number, day: number): string | null {
  if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (Number.isNaN(date.getTime())) return null;
  // Guard against rollover (31 February becoming 3 March).
  if (date.getUTCMonth() !== monthIndex || date.getUTCDate() !== day) return null;
  return date.toISOString();
}

/** Normalize anything date-shaped to ISO UTC, or null. */
export function normalizeTimestamp(input: unknown, options?: ParseDateOptions): string | null {
  if (typeof input === 'string' || typeof input === 'number' || input instanceof Date) {
    return parseDate(input, options);
  }
  return null;
}

export function ageInDays(iso: string, now = Date.now()): number | null {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return (now - parsed) / 86_400_000;
}

/**
 * Freshness score with exponential decay. `halfLifeDays` is configurable per
 * profile: registry records stay useful for years, listing prices do not.
 */
export function freshnessScore(iso: string | null, halfLifeDays: number, now = Date.now()): number {
  if (!iso) return 0.35; // unknown date: neither fresh nor discarded
  const age = ageInDays(iso, now);
  if (age === null) return 0.35;
  if (age <= 0) return 1;
  return Math.pow(0.5, age / halfLifeDays);
}
