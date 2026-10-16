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

/** Server refusal codes the screen explains in words. */
export const RETENTION_ERRORS = [
  'RETENTION_START_IN_PAST', 'RETENTION_START_EARLIER', 'RETENTION_NOT_STARTED',
  'RETENTION_GRACE_TOO_SHORT', 'RETENTION_GRACE_EARLIER', 'RETENTION_NOT_FOUND',
  'RETENTION_RECORD_LEVEL_RETIRED', 'RETENTION_UNKNOWN_CATEGORY', 'RETENTION_NOT_INSTALLED',
] as const;

export function retentionErrorCode(message: string | undefined): string {
  return RETENTION_ERRORS.find((c) => (message ?? '').includes(c)) ?? 'generic';
}

/** One plain sentence for the state of the whole system. */
export function retentionMode(s: { config: { effective_at: string | null; purge_enabled: boolean }; auto_run: boolean }): 'OFF' | 'DATING' | 'MANUAL' | 'ON' {
  if (!s.config.effective_at) return 'OFF';
  if (!s.config.purge_enabled) return 'DATING';
  return s.auto_run ? 'ON' : 'MANUAL';
}

/* ── Object-level retention (20261105090000) ── */

export interface ArtifactModeInput {
  settings: { paused: boolean };
  auto_run: boolean;
  categories: Array<{ kind: string; enabled: boolean }>;
}

/**
 * One plain state for the whole system. Self-test categories do not count as
 * "on": they only ever match files the self-test itself creates.
 * OFF: no real category is enabled. PAUSED: the kill switch is on.
 * MANUAL: enabled, runs only when an admin presses Run now. ON: automatic.
 */
export function artifactsMode(s: ArtifactModeInput): 'OFF' | 'PAUSED' | 'MANUAL' | 'ON' {
  if (s.settings.paused) return 'PAUSED';
  if (!s.categories.some((c) => c.enabled && c.kind !== 'SELFTEST')) return 'OFF';
  return s.auto_run ? 'ON' : 'MANUAL';
}

/** How long a category keeps a file, as {n, unit} for a translated sentence. */
export function ttlParts(seconds: number): { n: number; unit: 'days' | 'hours' | 'minutes' } {
  if (seconds >= 86_400 && seconds % 86_400 === 0) return { n: seconds / 86_400, unit: 'days' };
  if (seconds >= 3_600 && seconds % 3_600 === 0) return { n: seconds / 3_600, unit: 'hours' };
  return { n: Math.max(1, Math.round(seconds / 60)), unit: 'minutes' };
}
