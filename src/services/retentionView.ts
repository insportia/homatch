/*
 * Pure presentation helpers for retention dates (no imports, node-testable).
 * The expiry itself is never computed here: it comes from the server.
 */
export type RetentionProduct = 'VERIFY_REPORT' | 'CONTRACT_DOCUMENT';

export interface RetentionRow {
  source_id: string;
  product: RetentionProduct;
  available_at: string;
  expires_at: string | null;
  state: 'ACTIVE' | 'EXPIRED' | 'PURGED';
  expired: boolean;
  label: string | null;
}

export interface RetentionView {
  /** Records with an expiry date, still available. */
  active: Array<RetentionRow & { daysLeft: number }>;
  /** Available for at most 7 more days. */
  expiringSoon: Array<RetentionRow & { daysLeft: number }>;
  /** Tombstones: expired, payload removed or about to be. */
  expired: RetentionRow[];
}

const DAY_MS = 86_400_000;

/** Whole days left, rounded up: 0.2 days is "less than a day", not "0 days". */
export function daysLeft(expiresAt: string, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / DAY_MS));
}

export function retentionView(rows: RetentionRow[], now: number = Date.now()): RetentionView {
  const active: RetentionView['active'] = [];
  const expired: RetentionRow[] = [];
  for (const r of rows) {
    if (!r.expires_at) continue;
    if (r.expired || Date.parse(r.expires_at) <= now) expired.push(r);
    else active.push({ ...r, daysLeft: daysLeft(r.expires_at, now) });
  }
  active.sort((a, b) => Date.parse(a.expires_at!) - Date.parse(b.expires_at!));
  expired.sort((a, b) => Date.parse(b.expires_at!) - Date.parse(a.expires_at!));
  return { active, expiringSoon: active.filter((r) => r.daysLeft <= 7), expired };
}

/** The customer's local date for a UTC instant. */
export function localDate(iso: string, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      .format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}
