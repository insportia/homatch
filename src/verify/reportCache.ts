/*
 * THE OPENED-REPORT CACHE — reopening a finished report from History renders
 * at once instead of waiting on verify-synthesis again.
 *
 * Per tab (sessionStorage), keyed by reportCacheKey(): job id + the row's
 * synthesis_at + REPORT_LOGIC_VERSION + READ_ENRICHMENT_REVISION
 * (src/verify/intelligence/reportReadPath.ts). A rebuild or upgrade moves
 * synthesis_at; a new build logic or read derivation moves the versions;
 * either makes a cached copy unusable. A payload whose own _logicVersion is
 * not the current one is never served from here, so a report that is due an
 * auto-upgrade always reaches the server.
 *
 * Signed image URLs inside a cached report live VISUAL_URL_TTL_SECONDS (one
 * hour). A copy older than FRESH_MS is still shown immediately, but marked
 * stale so the caller refreshes it in the background.
 *
 * Storage can be absent, full or blocked (private mode, previews): every
 * access is wrapped and a failure only means "not cached". The key is read
 * only after the server has confirmed the caller owns the job.
 *
 * Pure apart from the injected storage, so it is unit-tested directly.
 */

import { REPORT_LOGIC_VERSION } from './intelligence/reportVersion.ts';
import { reportCacheKey } from './intelligence/reportReadPath.ts';

export const REPORT_CACHE_PREFIX = 'homatch.verifyReport.';
export const REPORT_CACHE_MAX_ENTRIES = 4;
/** Signed visual URLs are valid for an hour; refresh well before. */
export const REPORT_CACHE_FRESH_MS = 40 * 60 * 1000;
/** Past this the signed URLs are certainly dead: not shown at all. */
export const REPORT_CACHE_MAX_AGE_MS = 55 * 60 * 1000;

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

export function sessionStore(): KeyValueStore | null {
  try {
    return typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

interface Entry { key: string; savedAt: number; payload: Record<string, unknown> }

const ownKeys = (store: KeyValueStore): string[] => {
  const out: string[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(REPORT_CACHE_PREFIX)) out.push(k);
    }
  } catch {
    /* unreadable storage: nothing of ours */
  }
  return out;
};
const slot = (jobId: string) => `${REPORT_CACHE_PREFIX}${jobId}`;

/** Only a complete, current report is worth keeping. */
export function cacheableReport(payload: unknown): payload is Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const p = payload as Record<string, unknown>;
  if (p.pending || p.error) return false;
  return Number(p._logicVersion) === REPORT_LOGIC_VERSION;
}

export function readCachedReport(
  store: KeyValueStore | null,
  i: { jobId: string; synthesisAt: string | null | undefined },
  now: number = Date.now(),
): { payload: Record<string, unknown>; stale: boolean } | null {
  const key = reportCacheKey(i);
  if (!store || !key) return null;
  try {
    const raw = store.getItem(slot(i.jobId));
    if (!raw) return null;
    const e = JSON.parse(raw) as Entry;
    const age = now - Number(e?.savedAt);
    if (e?.key !== key || !Number.isFinite(age) || age < 0 || age > REPORT_CACHE_MAX_AGE_MS || !cacheableReport(e.payload)) {
      store.removeItem(slot(i.jobId));
      return null;
    }
    return { payload: e.payload, stale: age > REPORT_CACHE_FRESH_MS };
  } catch {
    try { store.removeItem(slot(i.jobId)); } catch { /* ignore */ }
    return null;
  }
}

export function writeCachedReport(
  store: KeyValueStore | null,
  i: { jobId: string; synthesisAt: string | null | undefined },
  payload: unknown,
  now: number = Date.now(),
): boolean {
  const key = reportCacheKey(i);
  if (!store || !key || !cacheableReport(payload)) return false;
  const value = JSON.stringify({ key, savedAt: now, payload } satisfies Entry);
  // Oldest first out, keeping room for this one.
  const evict = (keep: number) => {
    const others = ownKeys(store).filter((k) => k !== slot(i.jobId)).map((k) => {
      try { return { k, at: Number((JSON.parse(store.getItem(k) ?? '{}') as Entry).savedAt) || 0 }; } catch { return { k, at: 0 }; }
    }).sort((a, b) => a.at - b.at);
    while (others.length > keep) {
      const victim = others.shift();
      try { if (victim) store.removeItem(victim.k); } catch { /* ignore */ }
    }
  };
  try {
    evict(REPORT_CACHE_MAX_ENTRIES - 1);
    store.setItem(slot(i.jobId), value);
    return true;
  } catch {
    // Quota: drop every other cached report and try once more.
    try {
      evict(0);
      store.setItem(slot(i.jobId), value);
      return true;
    } catch {
      return false;
    }
  }
}

export function forgetCachedReport(store: KeyValueStore | null, jobId: string): void {
  try { store?.removeItem(slot(jobId)); } catch { /* ignore */ }
}
