// FIND BUYERS — what the owner's screen shows for a campaign, derived ONLY
// from the server's lifecycle (find_buyers_campaign_status). The screen never
// invents a state: every label, control and animation mode below is a pure
// function of what the database reported.

export type LifecycleState =
  | 'PREPARING' | 'QUEUED' | 'SEARCHING' | 'PARTIAL_RESULTS' | 'PAUSING' | 'PAUSED'
  | 'COMPLETED_WITH_RESULTS' | 'COMPLETED_NO_RESULTS' | 'DEGRADED_COMPLETED' | 'FAILED' | 'UNAVAILABLE' | 'CANCELLED';

export type Motion = 'active' | 'slowing' | 'still';
export type Control = 'pause' | 'pausing' | 'resume' | 'none';

export interface ViewSource { source: string; state: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED'; results: number }
export interface ViewInput {
  state: LifecycleState;
  sources: ViewSource[];
  queue: { total: number; queued: number; running: number; done: number; failed: number };
  signalsAnalyzed: number;
  newResults: number;
  strong: number;
}

export interface CampaignView {
  /** i18n key of the status headline. */
  headlineKey: string;
  tone: 'live' | 'paused' | 'success' | 'neutral' | 'problem';
  motion: Motion;
  control: Control;
  /** Search still running server-side (poll it, show the live module). */
  live: boolean;
  /** Stop is offered only while there is something to stop. */
  canStop: boolean;
  metrics: { sourcesWorking: number; sourcesDone: number; signals: number; possible: number; strong: number };
  /** A real fraction only when the denominator is real (queued work), else null. */
  progress: number | null;
}

const HEADLINE: Record<LifecycleState, string> = {
  PREPARING: 'fbl_state_preparing',
  QUEUED: 'fbl_state_queued',
  SEARCHING: 'fbl_state_searching',
  PARTIAL_RESULTS: 'fbl_state_partial',
  PAUSING: 'fbl_state_pausing',
  PAUSED: 'fbl_state_paused',
  COMPLETED_WITH_RESULTS: 'fbl_state_done_results',
  COMPLETED_NO_RESULTS: 'fbl_state_done_zero',
  DEGRADED_COMPLETED: 'fbl_state_degraded',
  FAILED: 'fbl_state_failed',
  UNAVAILABLE: 'fbl_state_unavailable',
  CANCELLED: 'fbl_state_cancelled',
};

export function campaignView(v: ViewInput): CampaignView {
  const live = ['PREPARING', 'QUEUED', 'SEARCHING', 'PARTIAL_RESULTS', 'PAUSING', 'PAUSED'].includes(v.state);
  const motion: Motion = ['PREPARING', 'QUEUED', 'SEARCHING', 'PARTIAL_RESULTS'].includes(v.state) ? 'active'
    : v.state === 'PAUSING' ? 'slowing' : 'still';
  const control: Control = ['QUEUED', 'SEARCHING', 'PARTIAL_RESULTS'].includes(v.state) ? 'pause'
    : v.state === 'PAUSING' ? 'pausing' : v.state === 'PAUSED' ? 'resume' : 'none';
  const tone = ['PREPARING', 'QUEUED', 'SEARCHING', 'PARTIAL_RESULTS', 'PAUSING'].includes(v.state) ? 'live'
    : v.state === 'PAUSED' ? 'paused'
    : v.state === 'COMPLETED_WITH_RESULTS' ? 'success'
    : v.state === 'COMPLETED_NO_RESULTS' || v.state === 'CANCELLED' ? 'neutral' : 'problem';
  const finished = v.queue.done + v.queue.failed;
  const denominator = finished + v.queue.queued + v.queue.running;
  return {
    headlineKey: HEADLINE[v.state],
    tone,
    motion,
    control,
    live,
    canStop: ['QUEUED', 'SEARCHING', 'PARTIAL_RESULTS', 'PAUSED'].includes(v.state),
    metrics: {
      sourcesWorking: v.sources.filter((s) => s.state === 'RUNNING').length,
      sourcesDone: v.sources.filter((s) => s.state === 'DONE' || s.state === 'FAILED').length,
      signals: Math.max(0, v.signalsAnalyzed),
      possible: Math.max(0, v.newResults),
      strong: Math.max(0, v.strong),
    },
    /* Real only while work is planned and some of it finished; never invented. */
    progress: live && denominator > 0 && finished > 0 ? Math.min(0.99, finished / denominator) : null,
  };
}

/**
 * New results arrived while the owner reads a page: keep the current view
 * stable and offer a refresh, unless nothing is on screen yet (then show them).
 */
export function arrivalAction(onScreen: number, knownTotal: number, serverTotal: number): 'none' | 'auto' | 'offer' {
  if (serverTotal <= knownTotal) return 'none';
  return onScreen === 0 ? 'auto' : 'offer';
}

/** Page numbers with ellipses: 1 … 4 5 6 … 20 (current always visible). */
export function pageWindow(current: number, totalPages: number, span = 1): Array<number | 'gap'> {
  if (totalPages <= 1) return totalPages === 1 ? [1] : [];
  const pages = new Set<number>([1, totalPages]);
  for (let p = current - span; p <= current + span; p++) if (p >= 1 && p <= totalPages) pages.add(p);
  const sorted = [...pages].sort((a, b) => a - b);
  const out: Array<number | 'gap'> = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push('gap');
    out.push(p);
  });
  return out;
}

/** A page number read from the URL: an integer ≥ 1, clamped to what exists. */
export function parsePage(raw: string | null, totalPages: number): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return totalPages > 0 ? Math.min(n, totalPages) : n;
}
