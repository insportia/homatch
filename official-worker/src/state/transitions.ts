// transitions.ts — the hard, code-level completeness invariants (mandate
// Section 18: "Hard Synthesis Gate ... implemented in CODE, not asked of
// AI"), plus the legacy-shaped per-source `traversal` snapshot each
// *Workflow.ts still emits for API compatibility (mandate Section 27).
//
// The guard functions (canMarkXExhausted) are the literal, direct
// implementation of the mandate's own example:
//   function canMarkTasExhausted(state) {
//     return state.resultsVisited === state.resultsDiscovered
//         && state.unvisitedRelevantItems === 0;
//   }
// Every *Workflow.ts calls the matching guard BEFORE transitioning its FSM
// to the terminal *_EXHAUSTED state — the FSM's own graph-shape check
// (SourceStateMachine.transition) catches a structurally illegal jump;
// these guards catch the "structurally legal but evidentially unearned"
// case (e.g. calling transition() one state too early).
//
// The compute*Traversal() functions below are a direct port of the
// pre-refactor lib/traversal.js ladder calculators (already correct,
// already unit-tested — kept byte-for-byte equivalent in field names/
// semantics so nothing downstream breaks) — restructured only to delegate
// their SOURCE_EXHAUSTED branch to the corresponding canMarkXExhausted()
// guard, so there is exactly one place that decision is made.

export type OperationalInput = {
  captcha?: boolean;
  skippedHumanVerification?: boolean;
  blocked?: boolean;
  authRequired?: boolean;
  searchControlNotFound?: boolean;
  submitFailed?: boolean;
  wrongSearchContext?: boolean;
  failed?: boolean;
};

export function operationalStatus(input: OperationalInput = {}): string | null {
  const { failed, captcha, skippedHumanVerification, blocked, authRequired, searchControlNotFound, submitFailed, wrongSearchContext } = input;
  if (failed) return 'FAILED';
  if (captcha) return 'WAITING_HUMAN';
  if (skippedHumanVerification) return 'SKIPPED_HUMAN_VERIFICATION';
  if (blocked) return 'BLOCKED';
  if (authRequired) return 'AUTH_REQUIRED';
  if (searchControlNotFound) return 'SEARCH_CONTROL_NOT_FOUND';
  if (submitFailed) return 'SUBMIT_FAILED';
  if (wrongSearchContext) return 'WRONG_SEARCH_CONTEXT';
  return null;
}

// ── MSMAP ────────────────────────────────────────────────────────────────
export interface MsmapTraversalInput extends OperationalInput {
  queryEntered?: boolean;
  suggestionSelected?: boolean;
  layersEnabled?: boolean;
  identifyActivated?: boolean;
  parcelClicked?: boolean;
  infoPopupOpened?: boolean;
  naprOpened?: boolean;
  latestInformationOpened?: boolean;
  documentsRead?: boolean;
  noResultConfirmed?: boolean;
}

/** mandate Section 18 example, MSMAP form: exhaustion requires the FULL
 * popup->NAPR->latest-info->documents chain, OR a causally-proven confirmed
 * empty search (nothing was ever found to traverse). A suggestion click /
 * map redraw ALONE can never satisfy this. */
export function canMarkMsmapExhausted(s: MsmapTraversalInput): boolean {
  if (s.noResultConfirmed && !s.suggestionSelected) return true;
  return !!(s.suggestionSelected && s.infoPopupOpened && s.naprOpened && s.latestInformationOpened && s.documentsRead);
}

export function computeMsmapTraversal(input: MsmapTraversalInput = {}) {
  const {
    queryEntered = false,
    suggestionSelected = false,
    layersEnabled = false,
    identifyActivated = false,
    parcelClicked = false,
    infoPopupOpened = false,
    naprOpened = false,
    latestInformationOpened = false,
    documentsRead = false,
  } = input;
  const op = operationalStatus(input);
  const base = { layersEnabled, queryEntered, suggestionSelected, identifyActivated, parcelClicked, infoPopupOpened, naprOpened, latestInformationOpened, documentsRead };
  if (op) return { ...base, status: op };
  if (!queryEntered) return { ...base, status: 'NOT_STARTED' };
  if (canMarkMsmapExhausted(input)) return { ...base, status: 'SOURCE_EXHAUSTED' };
  if (!suggestionSelected) return { ...base, status: 'SEARCH_CONFIRMED' };
  if (!infoPopupOpened) return { ...base, status: 'RESULTS_DISCOVERED' };
  return { ...base, status: 'RESULTS_TRAVERSED' };
}

// ── TAS ──────────────────────────────────────────────────────────────────
export interface TasTraversalInput extends OperationalInput {
  originalCadastralCode?: string | null;
  resolvedSearchCadastralCode?: string | null;
  searchSubmitted?: boolean;
  resultsDiscovered?: number | null;
  resultsVisited?: number;
  documentsDiscovered?: number;
  documentsRead?: number;
  skippedReasonsCount?: number;
  noResultConfirmed?: boolean;
}

/** mandate Section 18's LITERAL example: "18 results discovered, 16
 * visited MUST make TAS_EXHAUSTED impossible." resultsVisited plus any
 * explicitly-accounted-for skip reasons must cover every discovered result,
 * AND every discovered document among those results must have been read. */
export function canMarkTasExhausted(s: TasTraversalInput): boolean {
  const { resultsDiscovered = null, resultsVisited = 0, skippedReasonsCount = 0, documentsDiscovered = 0, documentsRead = 0, noResultConfirmed = false } = s;
  if (noResultConfirmed || resultsDiscovered === 0) return true;
  if (resultsDiscovered == null) return false;
  const unvisited = Math.max(0, resultsDiscovered - resultsVisited - skippedReasonsCount);
  if (unvisited > 0) return false;
  if (documentsDiscovered > 0 && documentsRead < documentsDiscovered) return false;
  return true;
}

export function computeTasTraversal(input: TasTraversalInput = {}) {
  const {
    originalCadastralCode = null,
    resolvedSearchCadastralCode = null,
    searchSubmitted = false,
    resultsDiscovered = null,
    resultsVisited = 0,
    documentsDiscovered = 0,
    documentsRead = 0,
    skippedReasonsCount = 0,
  } = input;
  const op = operationalStatus(input);
  const base = { originalCadastralCode, resolvedSearchCadastralCode, searchSubmitted, resultsDiscovered, resultsVisited, documentsDiscovered, documentsRead };
  const unvisitedRelevantItems = resultsDiscovered == null ? null : Math.max(0, resultsDiscovered - resultsVisited - skippedReasonsCount);
  if (op) return { ...base, unvisitedRelevantItems, status: op };
  if (!searchSubmitted) return { ...base, unvisitedRelevantItems: null, status: 'NOT_STARTED' };
  if (canMarkTasExhausted(input)) return { ...base, resultsDiscovered: resultsDiscovered ?? 0, unvisitedRelevantItems: 0, status: 'SOURCE_EXHAUSTED' };
  if (resultsDiscovered == null) return { ...base, unvisitedRelevantItems: null, status: 'SEARCH_CONFIRMED' };
  if (resultsVisited === 0 || (unvisitedRelevantItems ?? 0) > 0) return { ...base, unvisitedRelevantItems, status: 'RESULTS_DISCOVERED' };
  return { ...base, unvisitedRelevantItems, status: 'RESULTS_TRAVERSED' };
}

// ── MYGOV ────────────────────────────────────────────────────────────────
export interface MygovTraversalInput extends OperationalInput {
  service176Opened?: boolean;
  registryAppOpened?: boolean;
  correctSearchContext?: boolean;
  queryEntered?: boolean;
  searchSubmitted?: boolean;
  captchaEncountered?: boolean;
  humanCompleted?: boolean;
  humanSkipped?: boolean;
  resultsDiscovered?: number | null;
  resultsVisited?: number;
  documentsRead?: number;
  noResultConfirmed?: boolean;
}

/** mandate Section 9's critical invariant, verbatim: CONFIRMED_ZERO_RESULTS
 * requires ALL of service176Opened, registryApplicationOpened,
 * propertySearchContextConfirmed, cadastralInputFound (folded here into
 * correctSearchContext+queryEntered), queryEntered===expectedQuery,
 * searchSubmitted, officialResultResponseObserved (folded into
 * noResultConfirmed/resultsDiscovered===0). "Generic body text can NEVER
 * bypass these conditions." */
export function canMarkMygovExhausted(s: MygovTraversalInput): boolean {
  if (!s.service176Opened || !s.registryAppOpened || !s.correctSearchContext) return false;
  if (!s.queryEntered || !s.searchSubmitted) return false;
  const { resultsDiscovered = null, resultsVisited = 0, documentsRead = 0, noResultConfirmed = false } = s;
  if (noResultConfirmed || resultsDiscovered === 0) return true;
  if (resultsDiscovered == null) return false;
  if (resultsVisited < resultsDiscovered) return false;
  if (documentsRead <= 0 && resultsDiscovered > 0) return false;
  return true;
}

export function computeMygovTraversal(input: MygovTraversalInput = {}) {
  const {
    service176Opened = false,
    registryAppOpened = false,
    correctSearchContext = false,
    queryEntered = false,
    searchSubmitted = false,
    captchaEncountered = false,
    humanCompleted = false,
    humanSkipped = false,
    resultsDiscovered = null,
    resultsVisited = 0,
    documentsRead = 0,
  } = input;
  const op = operationalStatus(input);
  const base = { service176Opened, registryAppOpened, correctSearchContext, queryEntered, searchSubmitted, captchaEncountered, humanCompleted, humanSkipped, resultsDiscovered, resultsVisited, documentsRead };
  if (op) return { ...base, status: op };
  if (!service176Opened || !registryAppOpened) return { ...base, status: 'NOT_STARTED' };
  if (!queryEntered || !searchSubmitted) return { ...base, status: 'SEARCH_CONTROL_NOT_FOUND' };
  if (!correctSearchContext) return { ...base, status: 'WRONG_SEARCH_CONTEXT' };
  if (canMarkMygovExhausted(input)) return { ...base, resultsDiscovered: resultsDiscovered ?? 0, status: 'SOURCE_EXHAUSTED' };
  if (resultsDiscovered == null) return { ...base, status: 'SEARCH_CONFIRMED' };
  if (resultsVisited < resultsDiscovered) return { ...base, status: 'RESULTS_DISCOVERED' };
  return { ...base, status: 'RESULTS_TRAVERSED' };
}

// ── ENREG ────────────────────────────────────────────────────────────────
export interface EnregTraversalInput extends OperationalInput {
  entitiesQueued?: number;
  searchMethod?: string | null;
  searchValue?: string | null;
  exactEntityMatched?: boolean;
  infoIconClicked?: boolean;
  verificationStepCompleted?: boolean;
  entityPageOpened?: boolean;
  latestApplicationDate?: string | null;
  latestApplicationOpened?: boolean;
  preparedDocumentsOpened?: boolean;
  latestRegistryExtractOpened?: boolean;
  fullExtractRead?: boolean;
  historicalRelevantRecordsRead?: boolean;
  noResultConfirmed?: boolean;
}

export function canMarkEnregExhausted(s: EnregTraversalInput): boolean {
  if (!s.exactEntityMatched) return !s.infoIconClicked && !s.entityPageOpened; // a real, confirmed negative with nothing to traverse
  return !!(s.latestApplicationOpened && s.preparedDocumentsOpened && s.latestRegistryExtractOpened && s.fullExtractRead && s.historicalRelevantRecordsRead);
}

export function computeEnregTraversal(input: EnregTraversalInput = {}) {
  const {
    entitiesQueued = 0,
    searchMethod = null,
    searchValue = null,
    exactEntityMatched = false,
    infoIconClicked = false,
    verificationStepCompleted = true,
    entityPageOpened = false,
    latestApplicationDate = null,
    latestApplicationOpened = false,
    preparedDocumentsOpened = false,
    latestRegistryExtractOpened = false,
    fullExtractRead = false,
    historicalRelevantRecordsRead = false,
  } = input;
  const op = operationalStatus(input);
  const base = {
    entitiesQueued,
    searchMethod,
    searchValue,
    exactEntityMatched,
    infoIconClicked,
    verificationStepCompleted,
    entityPageOpened,
    latestApplicationDate,
    latestApplicationOpened,
    preparedDocumentsOpened,
    latestRegistryExtractOpened,
    fullExtractRead,
    historicalRelevantRecordsRead,
  };
  if (op) return { ...base, status: op };
  if (!searchMethod || !searchValue) return { ...base, status: 'NOT_STARTED' };
  if (!exactEntityMatched) return { ...base, status: canMarkEnregExhausted(input) ? 'SOURCE_EXHAUSTED' : 'SEARCH_CONFIRMED' };
  if (!verificationStepCompleted) return { ...base, status: 'WAITING_HUMAN' };
  if (!infoIconClicked || !entityPageOpened) return { ...base, status: 'RESULTS_DISCOVERED' };
  if (canMarkEnregExhausted(input)) return { ...base, status: 'SOURCE_EXHAUSTED' };
  if (!latestApplicationOpened || !preparedDocumentsOpened || !latestRegistryExtractOpened) return { ...base, status: 'RESULTS_TRAVERSED' };
  return { ...base, status: 'DOCUMENTS_TRAVERSED' };
}

export function isSourceExhausted(traversal: { status?: string } | null | undefined): boolean {
  return traversal?.status === 'SOURCE_EXHAUSTED';
}
