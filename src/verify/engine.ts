// HOMATCH — which Verify engine a NEW job runs on (V1 original / V2 code-first).
//
// docs/claude/VERIFY_V2_PLAN.md §1. The admin setting
// `admin_settings.verify_engine = {active: 'V1'|'V2'}` is read ONCE, when a job
// is created, and stamped on the job (result_json._engine). Every later step
// reads the stamp, never the live setting, so a running job can never change
// engine: switching affects new jobs only (the verify_execution_mode guarantee).
//
// V2 is selectable only when the code-first engine is actually deployed
// (VERIFY_V2_AVAILABLE). Until then a stored 'V2' setting still creates V1
// jobs and says so, rather than stamping V2 on a job that would run V1 code.
// Missing, malformed or unknown values are V1. Pure: shared by research-agent
// and the Admin selector so the two can never disagree.

export type VerifyEngine = 'V1' | 'V2';

/** Flipped in the release that ships the first V2 stage, never before. */
export const VERIFY_V2_AVAILABLE = false;

export const VERIFY_ENGINE_SETTING_KEY = 'verify_engine';

export interface VerifyEngineSetting {
  active: VerifyEngine;
}

export interface VerifyEngineStamp {
  version: VerifyEngine;
  /** What the setting asked for, when it differs (V2 requested before it existed). */
  requested?: VerifyEngine;
  selectedAt: string;
}

/** The stored setting, normalised. Anything that is not exactly 'V2' is V1. */
export function parseEngineSetting(value: unknown): VerifyEngineSetting {
  const v = value && typeof value === 'object' ? (value as Record<string, unknown>).active : value;
  return { active: v === 'V2' ? 'V2' : 'V1' };
}

/** The engine a job created now runs on, with what was requested. */
export function engineForNewJob(setting: unknown, nowIso: string, v2Available = VERIFY_V2_AVAILABLE): VerifyEngineStamp {
  const requested = parseEngineSetting(setting).active;
  const version: VerifyEngine = requested === 'V2' && v2Available ? 'V2' : 'V1';
  return { version, ...(requested !== version ? { requested } : {}), selectedAt: nowIso };
}

/** The engine a job was created on. Jobs from before the selector are V1. */
export function engineOf(resultJson: unknown): VerifyEngine {
  const stamp = resultJson && typeof resultJson === 'object' ? (resultJson as Record<string, any>)._engine : null;
  return stamp?.version === 'V2' ? 'V2' : 'V1';
}
