// TasMapState.ts — the TAS_MAP FSM (renamed from MsMapState.ts/MSMAP,
// 2026-09-06 "final alignment pass" mandate: this source's real production
// identity is the map popup opened FROM tas.ge, not a direct ms.gov.ge
// navigation — "do not count old msmap and TAS_MAP as two separate
// sources," so the old MSMAP identity is retired here, not duplicated).
// This is the structural fix for the original reported production bug:
// "CORRECT_SUGGESTION_SELECTED or PARCEL_FOCUSED DOES NOT mean map research
// is complete" — every intermediate state must be reached via a real,
// asserted transition; there is no edge from an early discovery state
// straight to TAS_MAP_EXHAUSTED.
import { buildLinearGraph, OPERATIONAL_STATUSES } from '../../state/ResearchState.js';
import { SourceStateMachine } from '../../state/SourceState.js';

export const TAS_MAP_LINEAR = [
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
  'TAS_MAP_EXHAUSTED',
] as const;
export type TasMapLinearState = (typeof TAS_MAP_LINEAR)[number];
export type TasMapState = TasMapLinearState | (typeof OPERATIONAL_STATUSES)[number];

export const TAS_MAP_GRAPH = buildLinearGraph(TAS_MAP_LINEAR as unknown as string[], OPERATIONAL_STATUSES);

export function newTasMapFsm(): SourceStateMachine<TasMapState> {
  return new SourceStateMachine<TasMapState>('TAS_MAP', TAS_MAP_GRAPH as any, 'START');
}
