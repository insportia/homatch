/*
 * HOW LONG THIS IS TAKING, WITHOUT LYING ABOUT IT.
 *
 * The analyser reports STATES (QUEUED, RUNNING, DONE), not a percentage.
 * Nothing server-side knows what fraction of a contract has been read, so any
 * number shown to a waiting customer is necessarily a projection — and the
 * honest thing is to build one that cannot claim more than it knows:
 *
 *   1. The ELAPSED TIME is real. It is measured from the moment the upload
 *      completed, and it is the number a waiting person actually wants.
 *
 *   2. The BAR is an estimate and is labelled as one on screen. It approaches
 *      its ceiling asymptotically against a measured typical duration, so it
 *      decelerates rather than stalling at a round number, and it NEVER
 *      reaches 100% on a guess.
 *
 *   3. 100% is reserved for DONE. A progress bar sitting at 100% while the
 *      work continues is the most common dishonesty in this pattern, and it
 *      devalues every other number on the screen. Here the only thing that
 *      can fill the bar is the analysis actually finishing.
 *
 * The baseline is not invented: a real production contract (a parking-space
 * purchase agreement, 25,576 bytes) went from uploaded to DONE in 27.9
 * seconds. Larger documents take longer, so the curve stays plausible well
 * past that without ever completing on its own.
 *
 * Kept apart from the component so the arithmetic can be tested directly:
 * the test runner strips TypeScript, not JSX.
 */
import type { AnalysisState } from '@/services/dealRoomDocuments';

/** Measured against a real contract analysis end to end. */
const TYPICAL_MS = 28_000;
/** The estimate's ceiling. Only DONE is allowed past it. */
const CEILING = 92;

/**
 * An asymptotic curve: fast at first, then progressively slower, never
 * arriving. `1 - e^(-t/T)` scaled to the ceiling gives roughly 58% at the
 * typical duration and still climbs — visibly — long after it.
 */
export function estimatedPercent(elapsedMs: number, state: AnalysisState): number {
  if (state === 'DONE') return 100;
  if (state === 'FAILED' || state === 'UNSUPPORTED' || state === 'REQUIRES_OCR') return 0;
  if (elapsedMs <= 0) return 0;
  const share = 1 - Math.exp(-elapsedMs / TYPICAL_MS);
  return Math.min(CEILING, Math.round(share * CEILING));
}

/** m:ss, because a contract analysis is measured in seconds and minutes. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
