// MsMapState.ts — mandate Section 5, the exact 18-state MSMAP sequence,
// verbatim and in order. This is the structural fix for the reported
// production bug: "CORRECT_SUGGESTION_SELECTED or PARCEL_FOCUSED DOES NOT
// mean MS Map research is complete ... The current behavior that
// effectively treats map recenter/render as successful research must be
// removed." There is now no graph edge from CORRECT_SUGGESTION_SELECTED (or
// any state before MSMAP_EXHAUSTED) straight to MSMAP_EXHAUSTED — every
// intermediate state must be reached via a real, asserted transition.
import { buildLinearGraph, OPERATIONAL_STATUSES } from '../../state/ResearchState.js';
import { SourceStateMachine } from '../../state/SourceState.js';

export const MSMAP_LINEAR = [
  'START',
  'MAP_OPENED',
  'CADASTRAL_SECTION_EXPANDED',
  'REQUIRED_LAYERS_ENABLED',
  'SEARCH_CONTROL_READY',
  'CADASTRAL_ENTERED',
  'SUGGESTIONS_LOADED',
  'CORRECT_SUGGESTION_SELECTED',
  'PARCEL_FOCUSED',
  'IDENTIFY_ACTIVATED',
  'PARCEL_CLICKED',
  'INFO_POPUP_OPENED',
  'NAPR_ACTION_FOUND',
  'NAPR_OPENED',
  'LATEST_INFORMATION_OPENED',
  'RELEVANT_CHILDREN_ENUMERATED',
  'RELEVANT_CHILDREN_TRAVERSED',
  'MSMAP_EXHAUSTED',
] as const;
export type MsMapLinearState = (typeof MSMAP_LINEAR)[number];
export type MsMapState = MsMapLinearState | (typeof OPERATIONAL_STATUSES)[number];

export const MSMAP_GRAPH = buildLinearGraph(MSMAP_LINEAR as unknown as string[], OPERATIONAL_STATUSES);

export function newMsMapFsm(): SourceStateMachine<MsMapState> {
  return new SourceStateMachine<MsMapState>('msmap', MSMAP_GRAPH as any, 'START');
}

/** The two named layers the mandate requires — verbatim Georgian strings,
 * both must be enabled before REQUIRED_LAYERS_ENABLED is legitimate. */
export const MSMAP_REQUIRED_LAYERS = ['რეგისტრირებული მიწის ნაკვეთები', 'სისტემური რეგისტრაცია — საველე სამუშაოების მონაცემები'] as const;

export const MSMAP_URL = 'https://ms.gov.ge/msmap/';
