// ResearchState.ts — shared vocabulary used by every per-source FSM.
//
// OperationalStatus: outcomes that can interrupt ANY source's linear
// progress at any point and always win over "how far did the happy path
// get" (a captcha, a block page, a login wall, a wrong search context...).
// These are the same statuses the pre-refactor architecture already
// exposed at the top level (SEARCH_CONFIRMED, NO_RESULT_CONFIRMED, etc.) —
// kept verbatim here per mandate Section 27's "preserve production API
// compatibility where practical."
export type OperationalStatus =
  | 'NOT_STARTED'
  | 'WAITING_HUMAN'
  | 'SKIPPED_HUMAN_VERIFICATION'
  | 'BLOCKED'
  | 'AUTH_REQUIRED'
  | 'SEARCH_CONTROL_NOT_FOUND'
  | 'SUBMIT_FAILED'
  | 'WRONG_SEARCH_CONTEXT'
  | 'NO_RESULT_CONFIRMED'
  | 'FAILED';

export const OPERATIONAL_STATUSES: OperationalStatus[] = [
  'NOT_STARTED',
  'WAITING_HUMAN',
  'SKIPPED_HUMAN_VERIFICATION',
  'BLOCKED',
  'AUTH_REQUIRED',
  'SEARCH_CONTROL_NOT_FOUND',
  'SUBMIT_FAILED',
  'WRONG_SEARCH_CONTEXT',
  'NO_RESULT_CONFIRMED',
  'FAILED',
];

/** The legacy, top-level per-source evidence-status enum the frontend and
 * research-agent already consume (mandate Section 27: preserve this
 * contract). Every *Workflow.ts still ultimately projects one of these,
 * computed FROM the new FSM's real state rather than from ad hoc page-text
 * heuristics. */
export type EvidenceStatus =
  | 'SEARCH_CONFIRMED'
  | 'NO_RESULT_CONFIRMED'
  | 'SUBMITTED_UNCONFIRMED'
  | 'SUBMIT_FAILED'
  | 'AUTH_REQUIRED'
  | 'SEARCH_CONTROL_NOT_FOUND'
  | 'BLOCKED'
  | 'WAITING_HUMAN'
  | 'SKIPPED_HUMAN_VERIFICATION'
  | 'WRONG_SEARCH_CONTEXT'
  | 'FAILED';

/**
 * Builds a strict linear transition graph: each state in `linear` may move
 * only to the next state in the array, OR to any of the `operational`
 * terminal states (a failure/interrupt can occur at any point along the
 * happy path). WAITING_HUMAN is deliberately permissive on its OWN outgoing
 * edges (see below) since a resumed session can legitimately continue from
 * wherever the pause actually occurred.
 *
 * This is the structural mechanism that makes the reported production bug
 * impossible: there is no edge from an early discovery state (e.g.
 * "CORRECT_SUGGESTION_SELECTED") directly to the terminal exhaustion state
 * — every intermediate state must be visited via a real transition() call,
 * which each *Workflow.ts only makes after its corresponding assertion
 * passed.
 */
export function buildLinearGraph<S extends string>(linear: S[], operational: string[]): Record<string, string[]> {
  const graph: Record<string, string[]> = {};
  for (let i = 0; i < linear.length; i++) {
    const isLast = i === linear.length - 1;
    graph[linear[i]] = isLast ? [] : [linear[i + 1], ...operational];
  }
  // WAITING_HUMAN may resume into any later IN-PROGRESS linear state (the
  // point at which a captcha appears varies per run) plus
  // SKIPPED_HUMAN_VERIFICATION — but never directly into the terminal
  // *_EXHAUSTED state itself. Resuming straight into "exhausted" would be
  // exactly the "arbitrary status assignment" the mandate forbids: the
  // terminal state may only be reached via its one real, evidenced edge.
  const resumable = linear.slice(0, -1);
  for (const op of operational) {
    graph[op] = op === 'WAITING_HUMAN' ? [...resumable, 'SKIPPED_HUMAN_VERIFICATION'] : [];
  }
  return graph;
}

/**
 * For a hand-written (non-strictly-linear) graph such as TAS's/MyGov's
 * branch-and-loop shape: adds every `operational` terminal as a legal
 * successor of every state in `states` except `terminal` (the FSM's own
 * true final state, which should stay genuinely terminal), and gives each
 * operational terminal its own outgoing edges (WAITING_HUMAN resumable into
 * any of `states`, the rest genuinely terminal).
 */
export function attachOperational(
  graph: Record<string, string[]>,
  states: string[],
  operational: string[],
  terminal: string,
  noEscalation: string[] = [],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const frozen = new Set([terminal, ...noEscalation]);
  for (const s of states) {
    out[s] = frozen.has(s) ? graph[s] || [] : [...(graph[s] || []), ...operational];
  }
  // WAITING_HUMAN may resume into any later IN-PROGRESS state, never
  // directly into the terminal state or one of the frozen dead-end/
  // already-resolved outcome states (e.g. MyGov's EXPLICIT_ACCESS_FAILURE,
  // USER_SKIPPED) — those may only be reached via their own real edges, not
  // as a side effect of a human-verification resume.
  const resumable = states.filter((s) => !frozen.has(s));
  for (const op of operational) {
    out[op] = op === 'WAITING_HUMAN' ? [...resumable, 'SKIPPED_HUMAN_VERIFICATION'] : [];
  }
  return out;
}
