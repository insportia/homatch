/*
 * REPORT LOGIC VERSION — when a stored report is too old to keep serving.
 *
 * A persisted report is served as a read. That is right for cost, and wrong
 * when the code that wrote it was wrong: job 220ed087's report still says the
 * building was "accepted into operation" on 11 March 2026 from a cited
 * government resolution, which the current legal engine refuses.
 *
 * So the synthesis carries `_logicVersion`. A READY report older than
 * REPORT_LOGIC_VERSION, for a job completed in the last
 * AUTO_UPGRADE_WINDOW_DAYS, is rebuilt ONCE through the normal build path
 * (`_autoUpgradedFrom` records it; a failed attempt is marked so it is not
 * retried on every open). Older jobs, and everything else, behave exactly as
 * before. Production at introduction: ~35 recent reports from 2 accounts —
 * a bounded, one-time model cost.
 */

/** Bump when report-building logic changes what a customer must be told. */
export const REPORT_LOGIC_VERSION = 4;
export const AUTO_UPGRADE_WINDOW_DAYS = 21;

const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});

/** A stored payload's version; reports written before versioning are 0. */
export function logicVersionOf(payload: unknown): number {
  const v = Number(obj(payload)._logicVersion);
  return Number.isInteger(v) && v > 0 ? v : 0;
}

export interface UpgradeInput {
  synthesisState: unknown;
  synthesisJson: unknown;
  completedAt: unknown;
  /** Wall-clock now (ms). */
  now: number;
}

export function shouldAutoUpgrade(i: UpgradeInput): boolean {
  if (i.synthesisState !== 'READY') return false;
  const p = obj(i.synthesisJson);
  if (!Object.keys(p).length) return false;
  if (logicVersionOf(p) >= REPORT_LOGIC_VERSION) return false;
  // Already attempted for this version (succeeded payloads carry the new version anyway).
  if (Number(p._autoUpgradeAttempted) >= REPORT_LOGIC_VERSION) return false;
  const done = Date.parse(String(i.completedAt ?? ''));
  if (!Number.isFinite(done)) return false;
  const age = i.now - done;
  return age >= 0 && age <= AUTO_UPGRADE_WINDOW_DAYS * 864e5;
}

/** The markers a rebuilt payload carries. */
export function versionMarkers(previous: unknown, autoUpgrade: boolean): Record<string, number> {
  return autoUpgrade
    ? { _logicVersion: REPORT_LOGIC_VERSION, _autoUpgradedFrom: logicVersionOf(previous) }
    : { _logicVersion: REPORT_LOGIC_VERSION };
}

/** The old payload, marked so a failed upgrade is not retried on every open. */
export function markUpgradeAttempted<T extends Record<string, any>>(previous: T): T & { _autoUpgradeAttempted: number } {
  return { ...previous, _autoUpgradeAttempted: REPORT_LOGIC_VERSION };
}
