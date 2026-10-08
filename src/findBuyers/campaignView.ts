// FIND BUYERS — what the owner's screen shows for a campaign, derived ONLY
// from the server's lifecycle (find_buyers_campaign_status). The screen never
// invents a state: every label, control and animation mode below is a pure
// function of what the database reported.

export type LifecycleState =
  | 'PREPARING' | 'QUEUED' | 'SEARCHING' | 'PARTIAL_RESULTS' | 'PAUSING' | 'PAUSED'
  | 'COMPLETED_WITH_RESULTS' | 'COMPLETED_NO_RESULTS' | 'DEGRADED_COMPLETED' | 'FAILED' | 'UNAVAILABLE' | 'CANCELLED';

export type Motion = 'active' | 'slowing' | 'still';
export type Control = 'pause' | 'pausing' | 'resume' | 'none';

export interface ViewSource {
  source: string; state: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED'; results: number;
  checked?: number; communities?: number; qualified?: number;
}
export interface ViewInput {
  state: LifecycleState;
  sources: ViewSource[];
  queue: { total: number; queued: number; running: number; done: number; failed: number };
  signalsAnalyzed: number;
  /** Content the run's sources read; preferred over signalsAnalyzed when larger. */
  signalsChecked?: number;
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
      signals: Math.max(0, v.signalsAnalyzed, v.signalsChecked ?? 0),
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

/* ── WHAT THE PANEL SAYS NOW ──────────────────────────────────────────────
 * The headline is the CURRENT state, never a past attempt. A search that is
 * running (or paused) is current. Otherwise the property is ready to search
 * or sources are switched off -- and the last search's outcome is history,
 * shown as its own line with its date. A failed attempt yesterday never
 * reads as "search unavailable" today when a search could start.
 */
export interface CurrentState {
  headlineKey: string;
  /** The last finished search, if any: its outcome key and when it ended. */
  last: { headlineKey: string; at: string | null; state: LifecycleState } | null;
}

const LIVE_STATES: LifecycleState[] = ['PREPARING', 'QUEUED', 'SEARCHING', 'PARTIAL_RESULTS', 'PAUSING', 'PAUSED'];

export function currentState(
  campaign: { state: LifecycleState; completedAt?: string | null } | null,
  readiness: { ready: boolean } | null,
): CurrentState {
  if (campaign && LIVE_STATES.includes(campaign.state)) return { headlineKey: HEADLINE[campaign.state], last: null };
  const last = campaign ? { headlineKey: HEADLINE[campaign.state], at: campaign.completedAt ?? null, state: campaign.state } : null;
  const headlineKey = readiness == null ? 'fbl_state_idle' : readiness.ready ? 'fbl_state_ready' : 'fbl_state_cannot_start';
  return { headlineKey, last };
}

/* ── THE DISCOVERY NETWORK ────────────────────────────────────────────────
 * Every registered source family, with what is TRUE of it: executed in this
 * search (its real job state and counts), available but not used, or
 * switched off. Only executing nodes may move; nothing is drawn as searched
 * that did not run. New families appear from the server data by themselves.
 */
export type NetworkState = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED' | 'AVAILABLE' | 'NOT_SELECTED' | 'DISABLED';
export interface NetworkNode { source: string; state: NetworkState; checked: number; communities: number; qualified: number; executed: boolean }

export function networkNodes(
  sources: ViewSource[] | null | undefined,
  network: Array<{ family: string; state: 'AVAILABLE' | 'DISABLED' }> | null | undefined,
): NetworkNode[] {
  const ran = new Map((sources ?? []).map((s) => [s.source.toUpperCase(), s]));
  const nodes: NetworkNode[] = [...ran.values()].map((s) => ({
    source: s.source.toUpperCase(), state: s.state, executed: true,
    checked: Math.max(0, s.checked ?? s.results ?? 0), communities: Math.max(0, s.communities ?? 0), qualified: Math.max(0, s.qualified ?? 0),
  }));
  const hadRun = ran.size > 0;
  for (const f of network ?? []) {
    const key = f.family.toUpperCase();
    if (ran.has(key)) continue;
    nodes.push({ source: key, executed: false, checked: 0, communities: 0, qualified: 0,
      state: f.state === 'DISABLED' ? 'DISABLED' : hadRun ? 'NOT_SELECTED' : 'AVAILABLE' });
  }
  const rank = (n: NetworkNode) => (n.executed ? 0 : n.state === 'DISABLED' ? 2 : 1);
  /* Executed sources keep the server's order; the rest are alphabetical. */
  return nodes.sort((a, b) => rank(a) - rank(b) || (a.executed ? 0 : a.source.localeCompare(b.source)));
}

/*
 * SOURCE EXECUTION TRUTH (owner, 2026-10-04): every source of a search is
 * shown in exactly one of six states, from what actually happened — never
 * implying a source ran when it did not.
 *   PLANNED   queued for this search, not started yet
 *   RUNNING   executing now
 *   COMPLETED finished and read content
 *   SKIPPED   usable, but not used by this search (or stopped before running)
 *   BLOCKED   could not run: switched off, or its planner failed / refused
 *   FAILED    started and failed
 * A source family that was never queued while the social planner FAILED or
 * was SKIPPED is BLOCKED (with that reason), not "available".
 */
export type ExecutionState = 'PLANNED' | 'RUNNING' | 'COMPLETED' | 'SKIPPED' | 'BLOCKED' | 'FAILED' | 'AVAILABLE';
export interface ScopePlan { outcome: 'QUEUED' | 'SKIPPED' | 'FAILED'; reason: string | null; queued: number }

/** Native HOMATCH sources (not planned by the memo23 social planner). */
const NATIVE_FAMILIES = new Set(['TELEGRAM', 'FORUM', 'PORTAL', 'WEB']);

export function executionState(node: NetworkNode, socialPlan?: ScopePlan | null): ExecutionState {
  switch (node.state) {
    case 'QUEUED': return 'PLANNED';
    case 'RUNNING': return 'RUNNING';
    case 'DONE': return 'COMPLETED';
    case 'FAILED': return 'FAILED';
    case 'CANCELLED': return 'SKIPPED';
    case 'DISABLED': return 'BLOCKED';
    case 'NOT_SELECTED':
      return !NATIVE_FAMILIES.has(node.source) && socialPlan && socialPlan.outcome !== 'QUEUED' ? 'BLOCKED' : 'SKIPPED';
    default: return 'AVAILABLE';
  }
}

export interface SearchScope {
  /** Sources that actually executed in this search (reached a run state). */
  executed: string[];
  /** Exactly one source executed (e.g. "only Telegram was searched"). */
  onlySource: string | null;
  /** The social planner did not queue anything for this search. */
  socialBlocked: boolean;
  socialReason: string | null;
}

export function searchScope(nodes: NetworkNode[], socialPlan?: ScopePlan | null): SearchScope {
  const executed = nodes.filter((n) => n.executed && n.state !== 'QUEUED' && n.state !== 'CANCELLED').map((n) => n.source);
  const socialBlocked = Boolean(socialPlan && socialPlan.outcome !== 'QUEUED');
  return {
    executed,
    onlySource: executed.length === 1 ? executed[0] : null,
    socialBlocked,
    socialReason: socialBlocked ? (socialPlan?.reason ?? null) : null,
  };
}
