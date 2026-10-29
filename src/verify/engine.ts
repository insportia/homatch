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

/*
 * V3 (owner, 2026-10-29): the V2 pipeline with the cost round on top (Luna
 * report with a cheap repair and Terra only on a gate failure, code-owned
 * fields, capped searches from its own setting verify_v3_research, public
 * research reuse, no Developer Advertising). Every V3 difference is keyed on
 * the job's stamp (isV3); a V2 job runs exactly as before. V3 reaches new
 * jobs only while `v3Enabled` is true, so switching back to V2 is one write.
 */
export type VerifyEngine = 'V1' | 'V2' | 'V3';

/** V2 approved for CUSTOMER jobs. Flipped only on the owner's explicit approval. */
export const VERIFY_V2_AVAILABLE = false;

export const VERIFY_ENGINE_SETTING_KEY = 'verify_engine';

export interface VerifyEngineSetting {
  active: VerifyEngine;
  adminPreview: VerifyEngine;
  /** V3 may be stamped on new jobs at all (off: a V3 choice falls back to V2 for admins, V1 for customers). */
  v3Enabled: boolean;
}
export const VERIFY_V3_RESEARCH_SETTING_KEY = 'verify_v3_research';

export interface VerifyEngineStamp {
  version: VerifyEngine;
  /** What the setting asked for, when it differs (V2 requested before it was approved). */
  requested?: VerifyEngine;
  /** Set when the job ran on the admin preview engine rather than `active`. */
  audience?: 'admin_preview';
  selectedAt: string;
}

const engine = (v: unknown): VerifyEngine => (v === 'V2' || v === 'V3' ? v : 'V1');

/** The stored setting, normalised. Anything that is not exactly 'V2' is V1. */
export function parseEngineSetting(value: unknown): VerifyEngineSetting {
  const o = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  return { active: engine(o ? o.active : value), adminPreview: engine(o?.adminPreview), v3Enabled: o?.v3Enabled === true };
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
  // V3 only while enabled; otherwise an admin preview falls back to V2 (the engine V3 extends).
  if (opts.isAdmin && s.adminPreview === 'V3') {
    return s.v3Enabled
      ? { version: 'V3', audience: 'admin_preview', selectedAt: nowIso }
      : { version: 'V2', requested: 'V3', audience: 'admin_preview', selectedAt: nowIso };
  }
  const requested = s.active;
  const version: VerifyEngine = requested === 'V3' && s.v3Enabled ? 'V3' : requested === 'V2' && v2Available ? 'V2' : 'V1';
  return { version, ...(requested !== version ? { requested } : {}), selectedAt: nowIso };
}

/**
 * The research PIPELINE a job runs: 'V1', or 'V2' for V2 and V3 jobs alike
 * (V3 is the V2 pipeline plus its own isV3 branches). Jobs from before the
 * selector are V1. For the exact stamped version use engineVersionOf.
 */
export function engineOf(resultJson: unknown): 'V1' | 'V2' {
  const v = engineVersionOf(resultJson);
  return v === 'V1' ? 'V1' : 'V2';
}

/** The exact engine a job was stamped with at creation (never the live setting). */
export function engineVersionOf(resultJson: unknown): VerifyEngine {
  const stamp = resultJson && typeof resultJson === 'object' ? (resultJson as Record<string, any>)._engine : null;
  return stamp?.version === 'V2' || stamp?.version === 'V3' ? stamp.version : 'V1';
}

/** A V3 job: the only jobs the cost-round branches apply to. */
export function isV3(resultJson: unknown): boolean {
  return engineVersionOf(resultJson) === 'V3';
}
