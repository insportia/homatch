// HOMATCH VERIFY — the research network, as STATE.
//
// The waiting screen draws a network of research nodes around the property.
// This module decides what each node is allowed to say, and nothing else: no
// React, no geometry, no clock. Everything is derived from server facts that
// arrive on every status poll —
//
//   - research_jobs.status / stage (the pipeline's own position),
//   - the server-computed section maturities (verify/sections.ts),
//   - the live counters the status response carries (null = unknown),
//   - whether synthesis is running and whether a report really exists.
//
// THE RULES IT KEEPS
//
//   - A node is DONE only when the pipeline has demonstrably passed it.
//     Elapsed time never advances a node.
//   - A section that finished UNAVAILABLE or PARTIAL is shown as exactly
//     that. It is never drawn as done.
//   - A stopped run (FAILED / CANCELLED) marks nothing newly done; the step it
//     stopped on reads as unavailable and the failure is exposed.
//   - No percentage. The network replaces the estimated bar; there is no
//     number here that pretends to measure how much is left.
//   - Same input, same output. Remounting, a second tab or reopening the case
//     redraws the same picture instead of starting from zero.

export type NetworkNodeState = 'IDLE' | 'ACTIVE' | 'DONE' | 'PARTIAL' | 'UNAVAILABLE';

export type NetworkNodeKey =
  | 'started'
  | 'identity'
  | 'location'
  | 'official'
  | 'documents'
  | 'registry'
  | 'context'
  | 'market'
  | 'crosscheck'
  | 'synthesis'
  | 'complete';

export type NetworkTerminal = 'RUNNING' | 'WAITING' | 'COMPLETE' | 'FAILED' | 'CANCELLED';

export interface NetworkSection {
  id: string;
  maturity: string;
}

export interface LiveCounters {
  sourcesCompleted?: number | string | null;
  sourcesTotal?: number | string | null;
  documentsReviewed?: number | string | null;
  officialDecisions?: number | string | null;
  officialCases?: number | string | null;
  marketComparables?: number | string | null;
  marketState?: number | string | null;
  synthesisState?: number | string | null;
}

export interface NetworkInput {
  stage?: string | null;
  status?: string | null;
  sections?: readonly NetworkSection[] | null;
  liveCounters?: LiveCounters | null;
  synthesizing?: boolean;
  reportReady?: boolean;
}

export interface NetworkNode {
  key: NetworkNodeKey;
  state: NetworkNodeState;
  /** i18n key of the node's customer-facing name. */
  labelKey: string;
  /** i18n key of the node's state, for the accessible list. */
  stateKey: string;
}

export interface NetworkCounter {
  key: 'documents' | 'decisions' | 'comparables';
  value: number;
  /** i18n key; the string carries a {{count}} placeholder. */
  labelKey: string;
}

export interface NetworkState {
  /** Ring nodes in pipeline order, then the `complete` core last. */
  nodes: NetworkNode[];
  /** The node the pipeline is on right now, or null when none is. */
  activeKey: NetworkNodeKey | null;
  terminal: NetworkTerminal;
  /** True once nothing is moving any more (report ready, or stopped). */
  settled: boolean;
  counters: NetworkCounter[];
}

/** The research ring, in the order the pipeline walks it. */
export const RING_KEYS: readonly NetworkNodeKey[] = [
  'started',
  'identity',
  'location',
  'official',
  'documents',
  'registry',
  'context',
  'market',
  'crosscheck',
  'synthesis',
];

const RANK: Record<NetworkNodeKey, number> = {
  started: 0,
  identity: 1,
  location: 2,
  official: 3,
  documents: 4,
  registry: 5,
  context: 6,
  market: 7,
  crosscheck: 8,
  synthesis: 9,
  complete: 10,
};

/*
 * research-agent stage -> the ring position it represents. CAPTCHA_REQUIRED is
 * the official browser waiting on a person; it is still the official step.
 * COMPLETE means research finished — the report may still be being built, so
 * it sits on `complete`'s rank but `complete` itself only goes DONE when a
 * report actually exists (reportReady).
 */
const STAGE_RANK: Record<string, number> = {
  QUEUED: 0,
  CREATED: 0,
  IDENTITY_WAITING: 1,
  BROWSER_READY: 2,
  BROWSER_WAITING: 3,
  CAPTCHA_REQUIRED: 3,
  OFFICIAL_READY: 4,
  OFFICIAL_COLLECTION_WAITING: 4,
  ENREG_CHECK_PENDING: 5,
  FINANCIAL_ENTITY_WAITING: 5,
  PUBLIC_RESEARCH_READY: 6,
  PUBLIC_RESEARCH_WAITING: 6,
  PUBLIC_RESEARCH_CHECK_PENDING: 6,
  MARKET_READY: 7,
  MARKET_WAITING: 7,
  RECONCILIATION_CHECK_PENDING: 8,
  SYNTHESIS_READY: 9,
  SYNTHESIS_WAITING: 9,
  COMPLETE: 10,
};

/** Which server sections speak for which node. */
const NODE_SECTIONS: Partial<Record<NetworkNodeKey, readonly string[]>> = {
  identity: ['PROPERTY'],
  location: ['LOCATION'],
  official: ['OFFICIAL'],
  documents: ['OFFICIAL'],
  registry: ['DEVELOPER', 'PARTICIPANTS'],
  context: ['PUBLIC_CONTEXT'],
  market: ['MARKET'],
};

/** Market-lane states that mean the lane ended without comparables. */
const MARKET_LANE_LOST = new Set(['DISABLED', 'NO_LOCATION', 'LOST', 'TIMED_OUT']);

function marketLaneLost(state: unknown): boolean {
  if (typeof state !== 'string') return false;
  return MARKET_LANE_LOST.has(state) || state.startsWith('START_');
}

/** The rank the pipeline's stage represents, or null when it is unknown. */
export function stageRank(stage: string | null | undefined): number | null {
  const key = String(stage || '').toUpperCase();
  return key in STAGE_RANK ? STAGE_RANK[key] : null;
}

function sectionVerdict(
  key: NetworkNodeKey,
  sections: readonly NetworkSection[] | null | undefined,
): 'PARTIAL' | 'UNAVAILABLE' | null {
  const ids = NODE_SECTIONS[key];
  if (!ids || !Array.isArray(sections)) return null;
  const found = ids
    .map((id) => sections.find((s) => s && s.id === id))
    .filter((s): s is NetworkSection => Boolean(s));
  if (found.length === 0) return null;
  const unavailable = found.filter((s) => s.maturity === 'UNAVAILABLE').length;
  const partial = found.filter((s) => s.maturity === 'PARTIAL').length;
  if (unavailable === found.length) return 'UNAVAILABLE';
  if (unavailable > 0 || partial > 0) return 'PARTIAL';
  return null;
}

function sectionMaturity(sections: readonly NetworkSection[] | null | undefined, id: string): string | null {
  if (!Array.isArray(sections)) return null;
  return sections.find((s) => s && s.id === id)?.maturity ?? null;
}

/** A finite, non-negative integer, or null. Strings and NaN are unknown. */
function count(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
}

export function networkState(input: NetworkInput): NetworkState {
  const status = String(input.status || '').toUpperCase();
  const reportReady = input.reportReady === true;
  const stopped = !reportReady && (status === 'FAILED' || status === 'CANCELLED');
  const counters = input.liveCounters ?? null;
  const sections = input.sections ?? null;

  /*
   * Where the pipeline is. Before the first poll there is no stage and no
   * status: that is the beginning, not the middle. An unrecognised stage is
   * honest about being unrecognised — only `started` is known to be behind it.
   */
  const heard = Boolean(input.stage) || Boolean(status);
  let rank: number | null = heard ? stageRank(input.stage) : 0;
  if (rank === null && status === 'COMPLETE' && !stopped) rank = RANK.complete;
  if (input.synthesizing && !stopped) rank = Math.max(rank ?? 0, RANK.synthesis);
  if (reportReady) rank = RANK.complete + 1;
  const unknownStage = rank === null;

  const terminal: NetworkTerminal = reportReady
    ? 'COMPLETE'
    : status === 'FAILED'
      ? 'FAILED'
      : status === 'CANCELLED'
        ? 'CANCELLED'
        : status === 'WAITING_HUMAN'
          ? 'WAITING'
          : 'RUNNING';

  const synthesisFailed = counters?.synthesisState === 'FAILED';

  const nodes: NetworkNode[] = [...RING_KEYS, 'complete' as const].map((key) => {
    const r = RANK[key];
    let state: NetworkNodeState;

    if (unknownStage) {
      // Research has begun; nothing else can be claimed from the stage.
      state = key === 'started' ? 'DONE' : 'IDLE';
    } else if (r < (rank as number)) {
      state = 'DONE';
    } else if (r === rank) {
      // The step the pipeline is on. A stopped run did not finish it.
      state = stopped ? 'UNAVAILABLE' : 'ACTIVE';
    } else {
      state = 'IDLE';
    }

    // `complete` is the report. Research finishing (stage COMPLETE) puts the
    // pipeline on it, but only a persisted report makes it DONE.
    if (key === 'complete') {
      if (reportReady) state = 'DONE';
      else if (stopped) state = 'UNAVAILABLE';
      else if (state === 'DONE') state = 'ACTIVE';
    }
    // With research complete and no report yet, synthesis is what is running.
    if (key === 'synthesis' && !reportReady && !stopped && (rank ?? 0) >= RANK.complete) {
      state = 'ACTIVE';
    }
    if (key === 'synthesis' && synthesisFailed && !reportReady) state = 'UNAVAILABLE';

    // The market lane runs beside the main pipeline from early on. While it
    // is genuinely running, say so; never call it done before the pipeline
    // has passed the market step.
    if (key === 'market' && !stopped && state === 'IDLE' && counters?.marketState === 'RUNNING') {
      state = 'ACTIVE';
    }
    if (
      key === 'market' &&
      state === 'DONE' &&
      marketLaneLost(counters?.marketState) &&
      !['PRELIMINARY', 'ENRICHING', 'VERIFIED', 'PARTIAL'].includes(sectionMaturity(sections, 'MARKET') ?? '')
    ) {
      state = 'UNAVAILABLE';
    }

    // An honest finding beats a stage position: a section the server says
    // came back UNAVAILABLE or PARTIAL is shown as exactly that.
    const verdict = sectionVerdict(key, sections);
    if (verdict && state !== 'UNAVAILABLE') state = verdict;

    return {
      key,
      state,
      labelKey: `verify_net_node_${key}`,
      stateKey: `verify_net_state_${state.toLowerCase()}`,
    };
  });

  const active = nodes.find((n) => n.state === 'ACTIVE' && n.key !== 'market') ?? nodes.find((n) => n.state === 'ACTIVE');

  /*
   * Counters: only numbers the pipeline has actually established. null means
   * unknown and renders nothing; zero says nothing yet worth showing and is
   * left out too, rather than reading as a finding.
   */
  const out: NetworkCounter[] = [];
  const push = (key: NetworkCounter['key'], raw: unknown) => {
    const value = count(raw);
    if (value !== null && value > 0) out.push({ key, value, labelKey: `verify_net_count_${key}` });
  };
  push('documents', counters?.documentsReviewed);
  push('decisions', counters?.officialDecisions);
  push('comparables', counters?.marketComparables);

  return {
    nodes,
    activeKey: active ? active.key : null,
    terminal,
    settled: reportReady || stopped,
    counters: out,
  };
}
