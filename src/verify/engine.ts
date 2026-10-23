// HOMATCH — which Verify engine a NEW job runs on (V1 original / V2 code-first).
//
// docs/claude/VERIFY_V2_PLAN.md §1. The admin setting
// `admin_settings.verify_engine = {active: 'V1'|'V2', adminPreview?: 'V1'|'V2'}`
// is read ONCE, when a job is created, and stamped on the job
// (result_json._engine). Every later step reads the stamp, never the live
// setting, so a running job can never change engine: switching affects new
// jobs only (the verify_execution_mode guarantee).
//
// Two audiences:
// - `active` is what CUSTOMER jobs run on. V2 is honoured only once it is
//   approved for customers (VERIFY_V2_AVAILABLE). Until then a stored 'V2'
//   still creates V1 jobs and says so.
// - `adminPreview` is what jobs started by an ADMIN account run on, so the
//   owner can test V2 live on the website while every customer stays on V1.
//   It needs no customer approval: it reaches nobody else.
// Missing, malformed or unknown values are V1. Pure: shared by research-agent
// and the Admin selector so the two can never disagree.

export type VerifyEngine = 'V1' | 'V2';

/** V2 approved for CUSTOMER jobs. Flipped only on the owner's explicit approval. */
export const VERIFY_V2_AVAILABLE = false;

export const VERIFY_ENGINE_SETTING_KEY = 'verify_engine';

export interface VerifyEngineSetting {
  active: VerifyEngine;
  adminPreview: VerifyEngine;
}

export interface VerifyEngineStamp {
  version: VerifyEngine;
  /** What the setting asked for, when it differs (V2 requested before it was approved). */
  requested?: VerifyEngine;
  /** Set when the job ran on the admin preview engine rather than `active`. */
  audience?: 'admin_preview';
  selectedAt: string;
}

const engine = (v: unknown): VerifyEngine => (v === 'V2' ? 'V2' : 'V1');

/** The stored setting, normalised. Anything that is not exactly 'V2' is V1. */
export function parseEngineSetting(value: unknown): VerifyEngineSetting {
  const o = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  return { active: engine(o ? o.active : value), adminPreview: engine(o?.adminPreview) };
}

/** The engine a job created now runs on, with what was requested. */
export function engineForNewJob(
  setting: unknown,
  nowIso: string,
  v2Available = VERIFY_V2_AVAILABLE,
  opts: { isAdmin?: boolean } = {},
): VerifyEngineStamp {
  const s = parseEngineSetting(setting);
  if (opts.isAdmin && s.adminPreview === 'V2') return { version: 'V2', audience: 'admin_preview', selectedAt: nowIso };
  const requested = s.active;
  const version: VerifyEngine = requested === 'V2' && v2Available ? 'V2' : 'V1';
  return { version, ...(requested !== version ? { requested } : {}), selectedAt: nowIso };
}

/** The engine a job was created on. Jobs from before the selector are V1. */
export function engineOf(resultJson: unknown): VerifyEngine {
  const stamp = resultJson && typeof resultJson === 'object' ? (resultJson as Record<string, any>)._engine : null;
  return stamp?.version === 'V2' ? 'V2' : 'V1';
}
