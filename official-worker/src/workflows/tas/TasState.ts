// TasState.ts — mandate Section 6, the exact TAS state sequence including
// its two documented branches: (1) full-code results vs. a parent-code
// fallback (see cadastral.ts), and (2) the per-result/per-child iteration
// loop ("NEXT_CHILD" / "NEXT_RESULT") that must keep going until every
// discovered row AND every discovered document within it has been visited
// — this is the structural fix for "18 results discovered via TAS's own
// counter, 0 rows/documents actually opened."
import { attachOperational, OPERATIONAL_STATUSES } from '../../state/ResearchState.js';
import { SourceStateMachine } from '../../state/SourceState.js';

export const TAS_STATES = [
  'START',
  'TAS_OPENED',
  'CADASTRAL_FORM_FOUND',
  'FULL_CODE_ENTERED',
  'FULL_SEARCH_SUBMITTED',
  'FULL_RESULTS_INSPECTED',
  'PARENT_CODE_RESOLUTION',
  'PARENT_CODE_ENTERED',
  'PARENT_SEARCH_SUBMITTED',
  'RESULT_SET_CAPTURED',
  'RESULT_QUEUE_CREATED',
  'RESULT_OPENED',
  'CHILDREN_ENUMERATED',
  'CHILD_DOCUMENT_OPENED',
  'DOCUMENT_READ',
  'RETURN_TO_RESULT',
  'NEXT_CHILD',
  'RESULT_EXHAUSTED',
  'RETURN_TO_RESULT_LIST',
  'NEXT_RESULT',
  'ALL_RESULTS_EXHAUSTED',
  'TAS_EXHAUSTED',
] as const;
export type TasLinearState = (typeof TAS_STATES)[number];
export type TasState = TasLinearState | (typeof OPERATIONAL_STATUSES)[number];

const BASE_GRAPH: Record<string, string[]> = {
  START: ['TAS_OPENED'],
  TAS_OPENED: ['CADASTRAL_FORM_FOUND'],
  CADASTRAL_FORM_FOUND: ['FULL_CODE_ENTERED'],
  FULL_CODE_ENTERED: ['FULL_SEARCH_SUBMITTED'],
  FULL_SEARCH_SUBMITTED: ['FULL_RESULTS_INSPECTED'],
  // Branch: the full code's own results are usable directly, OR (only when
  // the full code came back a CONFIRMED empty, never merely "the form
  // failed") escalate to the parent/base-parcel candidate sequence.
  FULL_RESULTS_INSPECTED: ['RESULT_SET_CAPTURED', 'PARENT_CODE_RESOLUTION'],
  PARENT_CODE_RESOLUTION: ['PARENT_CODE_ENTERED'],
  PARENT_CODE_ENTERED: ['PARENT_SEARCH_SUBMITTED'],
  PARENT_SEARCH_SUBMITTED: ['RESULT_SET_CAPTURED'],
  RESULT_SET_CAPTURED: ['RESULT_QUEUE_CREATED'],
  RESULT_QUEUE_CREATED: ['RESULT_OPENED'],
  RESULT_OPENED: ['CHILDREN_ENUMERATED'],
  // A result with zero relevant children goes straight to RESULT_EXHAUSTED
  // (nothing to open) rather than fabricating a CHILD_DOCUMENT_OPENED step.
  CHILDREN_ENUMERATED: ['CHILD_DOCUMENT_OPENED', 'RESULT_EXHAUSTED'],
  CHILD_DOCUMENT_OPENED: ['DOCUMENT_READ'],
  DOCUMENT_READ: ['RETURN_TO_RESULT'],
  RETURN_TO_RESULT: ['NEXT_CHILD'],
  // Loop: more unread children in this same result -> back to
  // CHILD_DOCUMENT_OPENED; none left -> RESULT_EXHAUSTED. This loop-back
  // edge is exactly what makes "16 of 18 children visited" a legal,
  // representable IN-PROGRESS state rather than forcing a premature jump
  // to RESULT_EXHAUSTED.
  NEXT_CHILD: ['CHILD_DOCUMENT_OPENED', 'RESULT_EXHAUSTED'],
  RESULT_EXHAUSTED: ['RETURN_TO_RESULT_LIST'],
  RETURN_TO_RESULT_LIST: ['NEXT_RESULT'],
  // Loop: more unvisited results in the list -> back to RESULT_OPENED;
  // none left -> ALL_RESULTS_EXHAUSTED.
  NEXT_RESULT: ['RESULT_OPENED', 'ALL_RESULTS_EXHAUSTED'],
  ALL_RESULTS_EXHAUSTED: ['TAS_EXHAUSTED'],
  TAS_EXHAUSTED: [],
};

export const TAS_GRAPH = attachOperational(BASE_GRAPH, TAS_STATES as unknown as string[], OPERATIONAL_STATUSES, 'TAS_EXHAUSTED');

export function newTasFsm(): SourceStateMachine<TasState> {
  return new SourceStateMachine<TasState>('tas', TAS_GRAPH as any, 'START');
}

export const TAS_URL = 'https://tas.ge/?p=searchdocument&menuItemId=7104';
