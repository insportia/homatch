// FIND BUYERS 3.0 — adaptive comment sampling for one comparable post.
//
// A post's comments are read in a small first sample (the configured probe). More are
// read only when that sample proved worth it, and only once per post:
//   STOP_EXHAUSTED  the sample already covered every comment the platform reported;
//   STOP_LOW_YIELD  too few interest signals per comment read — stop spending here;
//   STOP_DEPTH      the post was already expanded once;
//   STOP_UNKNOWN_TOTAL the platform reported no total: we cannot tell more exist;
//   EXPAND          read a larger sample (the provider returns newest first and has no
//                   verified offset, so the expansion re-reads the first sample; the
//                   pipeline dedupes it, and the size accounts for it).
// Every run is still reserved against the campaign budget; this only decides whether
// asking is justified. Pure and deterministic.

export type SamplingDecision = 'EXPAND' | 'STOP_EXHAUSTED' | 'STOP_LOW_YIELD' | 'STOP_DEPTH' | 'STOP_UNKNOWN_TOTAL';

export interface SamplingInput {
  /** Comments of the post read in the sample just processed. */
  analyzed: number;
  /** People in that sample with an interest or direct signal. */
  interested: number;
  /** Total comments the platform reported for the post (null = not reported). */
  total: number | null;
  /** 0 for the first sample, 1 after one expansion. */
  depth: number;
  /** The configured first-sample size. */
  probe: number;
  /** The Actor's maximum results per run. */
  maxResults: number;
}

export const MIN_INTEREST_RATE = 0.1;
export const EXPANSION_FACTOR = 3;
export const MAX_DEPTH = 1;

export function decideCommentSampling(i: SamplingInput): { decision: SamplingDecision; size: number | null } {
  if (i.depth >= MAX_DEPTH) return { decision: 'STOP_DEPTH', size: null };
  if (i.total == null) return { decision: 'STOP_UNKNOWN_TOTAL', size: null };
  if (i.analyzed <= 0 || i.analyzed >= i.total) return { decision: 'STOP_EXHAUSTED', size: null };
  if (i.interested / i.analyzed < MIN_INTEREST_RATE) return { decision: 'STOP_LOW_YIELD', size: null };
  const size = Math.min(i.maxResults, i.total, Math.max(i.probe, i.analyzed) * EXPANSION_FACTOR);
  return size > i.analyzed ? { decision: 'EXPAND', size } : { decision: 'STOP_EXHAUSTED', size: null };
}
