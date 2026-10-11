/*
 * OPENING A FINISHED REPORT — the READY fast path and its cache key.
 *
 * Measured in production (2026-10-09..11, job 8ba97da9): every READY open of
 * verify-synthesis loaded the job's whole result_json (1.8 MB of JSON, 1.6 MB
 * of it the TAS browserOfficial payload) and re-ran the read-time
 * derivations over it (withPropertyRegister: TAS intelligence, register,
 * unit identity, dossier), although a report built by the CURRENT code was
 * already persisted WITH exactly those derivations applied (buildReport runs
 * withPropertyRegister before persist()).
 *
 * So a persisted report carries `_readEnrichment` (this revision) and the
 * logic version it was enriched under. When both are current, the stored
 * payload IS the read result: verify-synthesis serves it from synthesis_json
 * alone and never touches result_json. Reports built before this, by older
 * logic, or by a failed upgrade keep the full read path unchanged.
 *
 * BUMP READ_ENRICHMENT_REVISION whenever a read-time derivation (anything
 * applied to a stored report on read in verify-synthesis) changes what a
 * customer sees, exactly as REPORT_LOGIC_VERSION is bumped for build logic.
 * The client cache (src/verify/reportCache.ts) keys on it too.
 *
 * Pure: imported by the edge function and by the browser.
 */

import { REPORT_LOGIC_VERSION, logicVersionOf } from './reportVersion.ts';

export const READ_ENRICHMENT_REVISION = 1;

/** Columns a READY open needs: everything except result_json. */
export const READY_FAST_COLUMNS = 'id,user_id,query,status,completed_at,synthesis_json,synthesis_state,synthesis_at';

const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});

/** Markers a freshly built (already enriched) payload carries. */
export function readEnrichmentMarkers(): { _readEnrichment: number; _readEnrichedLogic: number } {
  return { _readEnrichment: READ_ENRICHMENT_REVISION, _readEnrichedLogic: REPORT_LOGIC_VERSION };
}

/**
 * True when the stored report can be served as-is: READY, built by the
 * current logic version, and enriched at build time by the current
 * read-derivation revision. Never for an empty report (those are stored
 * un-enriched) and never for a forced rebuild.
 */
export function canServeStoredFast(job: { synthesis_state?: unknown; synthesis_json?: unknown } | null | undefined, opts: { force?: boolean } = {}): boolean {
  if (!job || opts.force) return false;
  if (job.synthesis_state !== 'READY') return false;
  const p = obj(job.synthesis_json);
  if (!Object.keys(p).length || p.empty === true) return false;
  if (logicVersionOf(p) !== REPORT_LOGIC_VERSION) return false;
  return p._readEnrichment === READ_ENRICHMENT_REVISION && p._readEnrichedLogic === REPORT_LOGIC_VERSION;
}

/**
 * The client cache key for one opened report. Any of these changing makes a
 * cached copy unusable: a rebuild or upgrade moves synthesis_at, a new build
 * logic or read derivation moves the versions.
 */
export function reportCacheKey(i: { jobId: string; synthesisAt: string | null | undefined }): string | null {
  if (!i.jobId || !i.synthesisAt) return null;
  return `v${REPORT_LOGIC_VERSION}.r${READ_ENRICHMENT_REVISION}|${i.jobId}|${i.synthesisAt}`;
}
