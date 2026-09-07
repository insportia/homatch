import { buildLinearGraph, OPERATIONAL_STATUSES } from '../../state/ResearchState.js';
import { SourceStateMachine } from '../../state/SourceState.js';

// Compatibility state-machine retained for the existing `enreg` source key.
// The production browser workflow now starts from MyGov Service 179 and no
// longer navigates directly to the legacy registry website.
export const ENREG_LINEAR = [
  'START',
  'ENREG_OPENED',
  'SEARCH_METHOD_SELECTED',
  'SEARCH_FIELD_FOUND',
  'SEARCH_VALUE_ENTERED',
  'SEARCH_SUBMITTED',
  'RESULTS_RETURNED',
  'CORRECT_ENTITY_MATCHED',
  'INFO_ICON_CLICKED',
  'VERIFICATION_VALUE_READ',
  'VERIFICATION_VALUE_ENTERED',
  'VERIFICATION_SUBMITTED',
  'ENTITY_PAGE_OPENED',
  'ENTITY_PAGE_READ',
  'APPLICATIONS_SECTION_FOUND',
  'APPLICATIONS_ENUMERATED',
  'LATEST_APPLICATION_SELECTED_BY_DATE',
  'LATEST_APPLICATION_DOCUMENT_OPENED',
  'APPLICATION_PAGE_READ',
  'PREPARED_DOCUMENTS_FOUND',
  'REGISTRY_EXTRACT_FOUND',
  'REGISTRY_EXTRACT_OPENED',
  'FULL_EXTRACT_READ',
  'RELEVANT_HISTORY_ENUMERATED',
  'RELEVANT_HISTORY_TRAVERSED',
  'ENREG_EXHAUSTED',
] as const;
export type EnregLinearState = (typeof ENREG_LINEAR)[number];
export type EnregState = EnregLinearState | (typeof OPERATIONAL_STATUSES)[number];

export const ENREG_GRAPH = buildLinearGraph(ENREG_LINEAR as unknown as string[], OPERATIONAL_STATUSES);

export function newEnregFsm(): SourceStateMachine<EnregState> {
  return new SourceStateMachine<EnregState>('enreg', ENREG_GRAPH as any, 'START');
}

export const ENREG_URL = 'https://my.gov.ge/ka-ge/services/10/service/179';
export const ENREG_ID_FIELD_LABEL = 'საიდენტიფიკაციო კოდი ან პირადი ნომერი :';
export const ENREG_NAME_FIELD_LABEL = 'ორგ. დასახელება';
export const ENREG_SEARCH_BUTTON_LABEL = 'ძებნა';
export const ENREG_VERIFY_BUTTON_LABEL = 'შემოწმება';
export const ENREG_APPLICATIONS_LABEL = 'განცხადებები';
export const ENREG_PREPARED_DOCS_LABEL = 'მომზადებული დოკუმენტები';
export const ENREG_EXTRACT_LABEL = 'ამონაწერი';
