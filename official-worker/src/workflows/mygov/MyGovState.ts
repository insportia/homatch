// MyGovState.ts — mandate Section 9 (the source that "must receive special
// attention because current production repeatedly enters the wrong
// context") and Section 10 (human verification). WRONG_SEARCH_CONTEXT is
// modeled as an OPERATIONAL error state, never a success path — it is
// reachable from PROPERTY_SEARCH_CONTEXT_CONFIRMED-or-earlier attempts that
// turn out to have used the wrong field, and it can never be followed by
// CONFIRMED_ZERO_RESULTS (see canMarkMygovExhausted in state/transitions.ts,
// which requires correctSearchContext===true).
import { attachOperational, OPERATIONAL_STATUSES } from '../../state/ResearchState.js';
import { SourceStateMachine } from '../../state/SourceState.js';

export const MYGOV_STATES = [
  'START',
  'SERVICE_176_OPENED',
  'SERVICE_APPLICATION_DISCOVERED',
  'REGISTRY_APPLICATION_OPENED',
  'PROPERTY_SEARCH_CONTEXT_CONFIRMED',
  'CADASTRAL_INPUT_FOUND',
  'CADASTRAL_ENTERED',
  'SEARCH_SUBMITTED',
  'POST_SEARCH_STATE',
  // POST_SEARCH_STATE branches ONLY to these four (mandate Section 9,
  // verbatim): HUMAN_VERIFICATION_REQUIRED, RESULTS_RETURNED,
  // CONFIRMED_ZERO_RESULTS, or EXPLICIT_ACCESS_FAILURE.
  'HUMAN_VERIFICATION_REQUIRED',
  'RESULTS_RETURNED',
  'CONFIRMED_ZERO_RESULTS',
  'EXPLICIT_ACCESS_FAILURE',
  // Section 10: human-verification pause/resume.
  'USER_COMPLETED',
  'USER_SKIPPED',
  'MYGOV_SKIPPED_HUMAN_VERIFICATION',
  // Result traversal (same NavigationStack-driven row/document exhaustion
  // primitive TAS uses — mandate does not name separate states for this,
  // so it reuses the RESULTS_RETURNED -> ... -> MYGOV_EXHAUSTED shape).
  'RESULTS_ENUMERATED',
  'RESULTS_TRAVERSED',
  'MYGOV_EXHAUSTED',
] as const;
export type MyGovLinearState = (typeof MYGOV_STATES)[number];
export type MyGovState = MyGovLinearState | (typeof OPERATIONAL_STATUSES)[number];

const BASE_GRAPH: Record<string, string[]> = {
  START: ['SERVICE_176_OPENED'],
  SERVICE_176_OPENED: ['SERVICE_APPLICATION_DISCOVERED'],
  SERVICE_APPLICATION_DISCOVERED: ['REGISTRY_APPLICATION_OPENED'],
  REGISTRY_APPLICATION_OPENED: ['PROPERTY_SEARCH_CONTEXT_CONFIRMED'],
  PROPERTY_SEARCH_CONTEXT_CONFIRMED: ['CADASTRAL_INPUT_FOUND'],
  CADASTRAL_INPUT_FOUND: ['CADASTRAL_ENTERED'],
  CADASTRAL_ENTERED: ['SEARCH_SUBMITTED'],
  SEARCH_SUBMITTED: ['POST_SEARCH_STATE'],
  POST_SEARCH_STATE: ['HUMAN_VERIFICATION_REQUIRED', 'RESULTS_RETURNED', 'CONFIRMED_ZERO_RESULTS', 'EXPLICIT_ACCESS_FAILURE'],
  HUMAN_VERIFICATION_REQUIRED: ['USER_COMPLETED', 'USER_SKIPPED'],
  USER_COMPLETED: ['POST_SEARCH_STATE'], // resumes the same branch decision after verification clears
  USER_SKIPPED: ['MYGOV_SKIPPED_HUMAN_VERIFICATION'],
  MYGOV_SKIPPED_HUMAN_VERIFICATION: [],
  EXPLICIT_ACCESS_FAILURE: [],
  CONFIRMED_ZERO_RESULTS: ['MYGOV_EXHAUSTED'], // nothing to traverse — a real, evidenced completion
  RESULTS_RETURNED: ['RESULTS_ENUMERATED'],
  RESULTS_ENUMERATED: ['RESULTS_TRAVERSED'],
  RESULTS_TRAVERSED: ['MYGOV_EXHAUSTED'],
  MYGOV_EXHAUSTED: [],
};

// These states are already dead ends or fully-resolved outcomes in
// BASE_GRAPH — mandate Section 9: EXPLICIT_ACCESS_FAILURE ("WRONG_SEARCH_
// CONTEXT as an error state never leading to success") and USER_SKIPPED
// ("never back into the search branch") must keep exactly their hand-
// written edges, not gain extra operational-escalation shortcuts.
const NO_ESCALATION = ['EXPLICIT_ACCESS_FAILURE', 'USER_SKIPPED', 'MYGOV_SKIPPED_HUMAN_VERIFICATION', 'CONFIRMED_ZERO_RESULTS'];

export const MYGOV_GRAPH = attachOperational(BASE_GRAPH, MYGOV_STATES as unknown as string[], OPERATIONAL_STATUSES, 'MYGOV_EXHAUSTED', NO_ESCALATION);

export function newMyGovFsm(): SourceStateMachine<MyGovState> {
  return new SourceStateMachine<MyGovState>('mygov', MYGOV_GRAPH as any, 'START');
}

// Kept in sync with workflows/mygov/selectors.ts's MYGOV_URL (the one
// actually imported by MyGovPage.ts) — not currently imported elsewhere,
// but must never drift from the exact mandated entry point.
export const MYGOV_URL = 'https://www.my.gov.ge/ka-ge/services/10/service/176';
