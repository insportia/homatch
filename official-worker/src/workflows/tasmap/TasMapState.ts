// TasMapState.ts — TAS_MAP FSM aligned to the live-verified 2026-09-07 flow.
// Search happens before layer selection; NAPR traversal happens only after
// the parcel info window is confirmed.
import { buildLinearGraph, OPERATIONAL_STATUSES } from '../../state/ResearchState.js';
import { SourceStateMachine } from '../../state/SourceState.js';

export const TAS_MAP_LINEAR = [
  'START',
  'MAP_OPENED',
  'SEARCH_CONTROL_READY',
  'CADASTRAL_ENTERED',
  'SUGGESTIONS_LOADED',
  'CORRECT_SUGGESTION_SELECTED',
  'PARCEL_FOCUSED',
  'CADASTRAL_SECTION_EXPANDED',
  'REQUIRED_LAYERS_ENABLED',
  'IDENTIFY_ACTIVATED',
  'PARCEL_CLICKED',
  'INFO_POPUP_OPENED',
  'NAPR_ACTION_FOUND',
  'NAPR_OPENED',
  'LATEST_INFORMATION_OPENED',
  'RELEVANT_CHILDREN_ENUMERATED',
  'RELEVANT_CHILDREN_TRAVERSED',
  'TAS_MAP_EXHAUSTED',
] as const;

export type TasMapLinearState = (typeof TAS_MAP_LINEAR)[number];
export type TasMapState = TasMapLinearState | (typeof OPERATIONAL_STATUSES)[number];

export const TAS_MAP_GRAPH = buildLinearGraph(TAS_MAP_LINEAR as unknown as string[], OPERATIONAL_STATUSES);

export function newTasMapFsm(): SourceStateMachine<TasMapState> {
  return new SourceStateMachine<TasMapState>('TAS_MAP', TAS_MAP_GRAPH as any, 'START');
}
