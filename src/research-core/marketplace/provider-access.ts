// PROVIDER ACCESS STATE — source protection without a customer-facing shutdown.
//
// A source that answers 401/403/challenge is put in a BOUNDED cooldown, never a
// permanent ban. After the cooldown exactly one ordinary search is allowed
// through as a probe (a short lease, so a crashed probe frees itself). A probe
// that reads a page reopens the source; a probe that is refused again doubles
// the cooldown up to a ceiling. Nothing here retries a challenge, rotates an
// identity or interacts with it: waiting, then one ordinary request, is all.
//
// Only real access refusals change this state. Ingress errors, network
// timeouts and upstream 5xx are transient and are handled by the run's own
// retry budget; they never cool a source down.
//
// Customer searches are always accepted. While a source is cooling down its
// runs serve previously collected listings, labelled with their own last
// observation time, and are never reported as a fresh refresh.

export type ProviderAccessState = 'AVAILABLE' | 'COOLDOWN';
export type ProviderMode = 'LIVE' | 'PROBE' | 'CACHE_ONLY';

export interface ProviderAccess {
  state: ProviderAccessState;
  /** Consecutive refusals; selects the cooldown step. 0 when AVAILABLE. */
  level: number;
  cooldownUntil: string | null;
  probeLeaseUntil: string | null;
  restrictedAt: string | null;
  recoveredAt: string | null;
  evidence: string | null;
  /** Compare-and-set token: every write increments it. */
  version: number;
}

/** 15 min, 30 min, 1 h, 2 h, 4 h, then 6 h at most. */
export const COOLDOWN_STEPS_MS = [15, 30, 60, 120, 240, 360].map((m) => m * 60_000);
/** A probe that never reports back frees the lease after this long. */
export const PROBE_LEASE_MS = 5 * 60_000;
/** A refusal after a full day of access starts again at the first step. */
export const LEVEL_RESET_AFTER_MS = 24 * 3_600_000;

const iso = (ms: number) => new Date(ms).toISOString();
const ms = (v: unknown) => { const n = Date.parse(String(v ?? '')); return Number.isFinite(n) ? n : null; };

/** Read the stored state, upgrading the earlier permanent-circuit fields once.
 * A legacy `accessRestricted: true` becomes a first-step cooldown counted from
 * when it was recorded, so it expires on its own instead of needing a manual
 * database clearance. */
export function readProviderAccess(health: unknown): ProviderAccess {
  const h = (health && typeof health === 'object' ? health : {}) as Record<string, unknown>;
  const a = h.access as Partial<ProviderAccess> | undefined;
  if (a && (a.state === 'AVAILABLE' || a.state === 'COOLDOWN')) {
    return {
      state: a.state, level: Math.max(0, Math.trunc(Number(a.level) || 0)),
      cooldownUntil: a.cooldownUntil ?? null, probeLeaseUntil: a.probeLeaseUntil ?? null,
      restrictedAt: a.restrictedAt ?? null, recoveredAt: a.recoveredAt ?? null,
      evidence: a.evidence ?? null, version: Math.max(0, Math.trunc(Number(a.version) || 0)),
    };
  }
  if (h.accessRestricted === true) {
    const at = ms(h.checkedAt) ?? 0;
    return { state: 'COOLDOWN', level: 1, cooldownUntil: iso(at + COOLDOWN_STEPS_MS[0]), probeLeaseUntil: null,
      restrictedAt: at ? iso(at) : null, recoveredAt: null, evidence: 'legacy access restriction', version: 0 };
  }
  return { state: 'AVAILABLE', level: 0, cooldownUntil: null, probeLeaseUntil: null, restrictedAt: null, recoveredAt: null, evidence: null, version: 0 };
}

export interface ProviderDecision {
  mode: ProviderMode;
  /** The state to store when the decision grants a probe lease; null when nothing changes. */
  next: ProviderAccess | null;
  /** When fresh acquisition may next be attempted (null when it may now). */
  retryAt: string | null;
}

/** What one run may do now. `allowProbe` is false for checks that must not
 * spend the single post-cooldown request (the worker's startup check). */
export function decideProviderAccess(a: ProviderAccess, now: Date, allowProbe = true): ProviderDecision {
  if (a.state === 'AVAILABLE') return { mode: 'LIVE', next: null, retryAt: null };
  const t = now.getTime();
  const until = ms(a.cooldownUntil) ?? 0;
  if (t < until) return { mode: 'CACHE_ONLY', next: null, retryAt: iso(until) };
  const lease = ms(a.probeLeaseUntil);
  if (lease !== null && t < lease) return { mode: 'CACHE_ONLY', next: null, retryAt: iso(lease) };
  if (!allowProbe) return { mode: 'CACHE_ONLY', next: null, retryAt: null };
  return { mode: 'PROBE', retryAt: null, next: { ...a, probeLeaseUntil: iso(t + PROBE_LEASE_MS), version: a.version + 1 } };
}

/** A real refusal (401/403/challenge) from the source. */
export function recordRestriction(a: ProviderAccess, now: Date, evidence: string): ProviderAccess {
  const t = now.getTime();
  const longAvailable = a.state === 'AVAILABLE' && (ms(a.recoveredAt) ?? 0) + LEVEL_RESET_AFTER_MS < t;
  const level = Math.min((longAvailable ? 0 : a.level) + 1, COOLDOWN_STEPS_MS.length);
  return { ...a, state: 'COOLDOWN', level, cooldownUntil: iso(t + COOLDOWN_STEPS_MS[level - 1]), probeLeaseUntil: null,
    restrictedAt: iso(t), evidence: evidence.slice(0, 300), version: a.version + 1 };
}

/** A page was read normally: the source is open again. */
export function recordRecovery(a: ProviderAccess, now: Date): ProviderAccess {
  if (a.state === 'AVAILABLE' && !a.probeLeaseUntil) return a;
  return { ...a, state: 'AVAILABLE', level: 0, cooldownUntil: null, probeLeaseUntil: null, recoveredAt: now.toISOString(), version: a.version + 1 };
}

/** The customer-facing state of one source in one search. */
export type SourceFreshness = 'REFRESHING' | 'FRESH' | 'PARTIAL' | 'CACHED' | 'UNAVAILABLE';
export function sourceFreshness(run: { status: string; freshCount: number; cachedCount: number }): SourceFreshness {
  const terminal = ['COMPLETE', 'PARTIAL', 'FAILED', 'TIMED_OUT', 'BLOCKED'].includes(run.status);
  if (!terminal) return 'REFRESHING';
  if (run.status === 'COMPLETE') return 'FRESH';
  if (run.freshCount > 0) return 'PARTIAL';
  return run.cachedCount > 0 ? 'CACHED' : 'UNAVAILABLE';
}
