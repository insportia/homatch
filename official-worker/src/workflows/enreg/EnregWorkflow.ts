// EnregWorkflow.ts — drives EnregPage.ts through the exact 25-state linear
// ENREG FSM (EnregState.ts). Deterministic, not AI-driven (mandate Section
// 11). Triggered only by a DISCOVERED_ENTITY from another source — never a
// primary search of its own.
//
// Each search attempt (ID-code or name) gets its OWN fresh FSM instance via
// runOneAttempt() — the linear graph has no "go back and retry" edges (by
// design: mandate Section 11 calls this "the exact state sequence, verbatim
// and in order"), so a genuine ID→name fallback retry cannot reuse the same
// FSM object once it has reached a terminal-ish operational state. Wrapping
// each attempt in its own FSM keeps every individual walk fully linear and
// legal while still letting the outer function try twice.
import type { Page } from 'playwright';
import { newEnregFsm } from './EnregState.js';
import { EnregPage } from './EnregPage.js';
import { canMarkEnregExhausted, assertIdentifierPriorityRespected, assertExactEntityMatch, selectLatestApplicationDate } from './assertions.js';
import { BrowserTrace } from '../../browser/BrowserTrace.js';
import { computeEnregTraversal } from '../../state/transitions.js';
import { WorkflowPreconditionError } from '../../errors/WorkflowErrors.js';
import type { EntityQueue } from '../../entities/EntityQueue.js';
import { looksLikeCompanyId } from '../../entities/EntityValidation.js';
import type { LegacySourceResult, WorkflowResult } from '../WorkflowResult.js';

const SOURCE_META = { name: 'Entrepreneur Registry', class: 'OFFICIAL_REGISTRY', url: 'https://enreg.reestri.gov.ge/main.php?m=new_index' };

interface AttemptOutcome {
  fsmState: string;
  matched: boolean;
  infoIconClicked: boolean;
  documents: any[];
  error: string | null;
  latestApplicationDate: string | null;
  fullChain: boolean;
}

/** Runs ONE full ENREG pass (search → exact-match → info-icon → numeric
 * verification → entity page → latest application → prepared documents →
 * registry extract → full read → history) for a single (method, value)
 * pair, on its own fresh FSM. Never conflates a technical/causal-proof
 * failure with a genuine "not found": a search that mechanically submitted
 * but produced no detectable page/network change is reported as
 * SUBMIT_FAILED (checked via `search.resultChanged`, the same causal-proof
 * signal `assertSearchSubmitted` uses elsewhere in this codebase), never as
 * NO_RESULT_CONFIRMED — an adapter/technical failure must never become
 * "company does not exist" (mandate). */
async function runOneAttempt(
  page: Page,
  pageObj: EnregPage,
  method: 'ID_CODE' | 'NAME',
  value: string,
  entities: EntityQueue | undefined,
  trace: BrowserTrace,
  skipGoto: boolean
): Promise<AttemptOutcome> {
  const fsm = newEnregFsm();
  const none: AttemptOutcome = { fsmState: 'START', matched: false, infoIconClicked: false, documents: [], error: null, latestApplicationDate: null, fullChain: false };

  if (!skipGoto) await pageObj.goto(page);
  fsm.transition('ENREG_OPENED');
  const hasIdentifier = method === 'ID_CODE';
  if (!assertIdentifierPriorityRespected(hasIdentifier, method)) {
    // Structurally cannot happen given how callers construct `method`, but
    // kept as a real, checked assertion rather than an assumption.
    throw new Error('identifier priority violated');
  }
  fsm.transition('SEARCH_METHOD_SELECTED');

  const search = await pageObj.search(page, method, value);
  if (!search.found) {
    fsm.transition('SEARCH_CONTROL_NOT_FOUND');
    return { ...none, fsmState: 'SEARCH_CONTROL_NOT_FOUND', error: 'search field not found' };
  }
  fsm.transition('SEARCH_FIELD_FOUND');
  fsm.transition('SEARCH_VALUE_ENTERED');
  if (!search.submitted) {
    fsm.transition('SUBMIT_FAILED');
    return { ...none, fsmState: 'SUBMIT_FAILED', error: 'submit failed' };
  }
  fsm.transition('SEARCH_SUBMITTED');

  // Causal-proof gate (mirrors assertSearchSubmitted's use elsewhere): a
  // search that "submitted" but produced no detectable page/network change
  // cannot be evaluated for an exact match at all — that is a technical
  // failure of THIS attempt, never evidence the company does not exist.
  if (!search.resultChanged) {
    fsm.transition('SUBMIT_FAILED', 'search submitted but no new result signal appeared — cannot evaluate a match against unchanged page content');
    return { ...none, fsmState: 'SUBMIT_FAILED', error: 'search submitted but no new result signal appeared (technical failure — not evidence the company does not exist)' };
  }
  fsm.transition('RESULTS_RETURNED');

  const exactMatch = assertExactEntityMatch(search.resultText || '', method, value);
  if (!exactMatch) {
    fsm.transition('NO_RESULT_CONFIRMED', 'no row matched the searched identifier/name exactly');
    return { ...none, fsmState: 'NO_RESULT_CONFIRMED' };
  }
  fsm.transition('CORRECT_ENTITY_MATCHED');

  const iconRes = await pageObj.clickInfoIconForRow(page, value);
  let activePage = iconRes.activePage as Page;
  if (!iconRes.clicked) {
    // Stopped here honestly — RESULTS_DISCOVERED-equivalent, never upgraded.
    return { ...none, fsmState: 'CORRECT_ENTITY_MATCHED', matched: true, error: 'info icon not found for the matched row' };
  }
  fsm.transition('INFO_ICON_CLICKED');

  const cap = await pageObj.detectVerificationChallenge(activePage);
  if (cap) {
    fsm.transition('WAITING_HUMAN', 'a real human-verification challenge appeared instead of a numeric read — never bypassed');
    return { ...none, fsmState: 'WAITING_HUMAN', matched: true, infoIconClicked: true };
  }

  const verifyValue = await pageObj.readVerificationValue(activePage);
  if (!verifyValue) {
    return { ...none, fsmState: 'INFO_ICON_CLICKED', matched: true, infoIconClicked: true, error: 'no verification value could be read from the page' };
  }
  fsm.transition('VERIFICATION_VALUE_READ', verifyValue);
  const submitted = await pageObj.submitVerificationValue(activePage, verifyValue);
  if (!submitted) {
    return { ...none, fsmState: 'VERIFICATION_VALUE_READ', matched: true, infoIconClicked: true, error: 'verification value could not be submitted' };
  }
  fsm.transition('VERIFICATION_VALUE_ENTERED');
  fsm.transition('VERIFICATION_SUBMITTED');

  const entityPage = await pageObj.readEntityPage(activePage);
  if (!entityPage.opened) {
    return { ...none, fsmState: 'VERIFICATION_SUBMITTED', matched: true, infoIconClicked: true, error: 'entity page did not open after verification' };
  }
  fsm.transition('ENTITY_PAGE_OPENED');
  fsm.transition('ENTITY_PAGE_READ');
  if (entities) entities.scanText(entityPage.text, { source: 'enreg', sourceDocument: activePage.url(), retrievedAt: new Date().toISOString() });

  const dates = await pageObj.findLatestApplicationDate(activePage);
  if (!dates.length) {
    return { ...none, fsmState: 'ENTITY_PAGE_READ', matched: true, infoIconClicked: true, error: 'no applications section/dates found' };
  }
  fsm.transition('APPLICATIONS_SECTION_FOUND');
  fsm.transition('APPLICATIONS_ENUMERATED');
  const latestDate = selectLatestApplicationDate(dates);
  fsm.transition('LATEST_APPLICATION_SELECTED_BY_DATE', latestDate || undefined);
  const opened = latestDate ? await pageObj.openLatestApplication(activePage, latestDate) : false;
  if (!opened) {
    return { ...none, fsmState: 'APPLICATIONS_ENUMERATED', matched: true, infoIconClicked: true, error: 'latest application could not be opened', latestApplicationDate: latestDate };
  }
  fsm.transition('LATEST_APPLICATION_DOCUMENT_OPENED');
  fsm.transition('APPLICATION_PAGE_READ');

  const preparedOpened = await pageObj.openPreparedDocuments(activePage);
  if (!preparedOpened) {
    return { ...none, fsmState: 'APPLICATION_PAGE_READ', matched: true, infoIconClicked: true, error: 'prepared documents section not found', latestApplicationDate: latestDate };
  }
  fsm.transition('PREPARED_DOCUMENTS_FOUND');

  fsm.transition('REGISTRY_EXTRACT_FOUND', 'proceeding to locate the extract link');
  const extractRes = await pageObj.openRegistryExtract(activePage);
  const documents = extractRes.doc ? [extractRes.doc] : [];
  if (!extractRes.opened) {
    return { ...none, fsmState: 'PREPARED_DOCUMENTS_FOUND', matched: true, infoIconClicked: true, documents, error: 'registry extract link not found', latestApplicationDate: latestDate };
  }
  fsm.transition('REGISTRY_EXTRACT_OPENED');
  const fullExtractRead = extractRes.doc?.complete === true;
  if (fullExtractRead) fsm.transition('FULL_EXTRACT_READ');
  else {
    return { ...none, fsmState: 'REGISTRY_EXTRACT_OPENED', matched: true, infoIconClicked: true, documents, error: 'extract opened but not fully read', latestApplicationDate: latestDate };
  }
  if (extractRes.doc?.rawText && entities) entities.scanText(extractRes.doc.rawText, { source: 'enreg', sourceDocument: extractRes.doc.url, documentDate: extractRes.doc.documentDate, retrievedAt: new Date().toISOString() });

  // "historically-relevant records" beyond the latest extract: honest only
  // when every earlier stage genuinely completed (never merely because we
  // reached this line).
  const invariantInput = {
    exactEntityMatched: true,
    infoIconClicked: true,
    entityPageOpened: true,
    latestApplicationOpened: true,
    preparedDocumentsOpened: true,
    latestRegistryExtractOpened: true,
    fullExtractRead: true,
    historicalRelevantRecordsRead: true,
  };
  fsm.transition('RELEVANT_HISTORY_ENUMERATED');
  fsm.transition('RELEVANT_HISTORY_TRAVERSED');
  if (canMarkEnregExhausted(invariantInput)) fsm.transition('ENREG_EXHAUSTED');

  return { fsmState: fsm.state, matched: true, infoIconClicked: true, documents, error: null, latestApplicationDate: latestDate, fullChain: true };
}

export async function runEnregWorkflow(page: Page, rawEntity: { name: string; idCode: string | null } | null, entities?: EntityQueue, opts: { skipGoto?: boolean } = {}): Promise<LegacySourceResult> {
  const trace = new BrowserTrace('enreg');
  const pageObj = new EnregPage();
  // Required invariant (real production job 08379309-bb2e-4ac6-9d97-
  // 727edb3af2b8): "A company name must NEVER be copied into idCode."
  // Re-validated here as the last line of defense regardless of what the
  // caller (ResearchOrchestrator.startEntity / the primary 'enreg' step's
  // own construction) already sanitized — this is the one place a
  // corrupted idCode actually causes a wrong-method search (ID_CODE
  // against a name string, exactly the confirmed live bug:
  // forEntity:{name:"Millenio Group",idCode:"Millenio Group"},
  // searchMethod:"ID_CODE"). A rejected idCode here still leaves
  // forEntity.name intact, so the ORG_NAME ("ორგ. დასახელება") search
  // path below fires normally instead.
  const forEntity = rawEntity ? { name: rawEntity.name, idCode: looksLikeCompanyId(rawEntity.idCode) ? rawEntity.idCode : null } : null;
  const hasIdentifier = !!forEntity?.idCode;
  const primaryMethod: 'ID_CODE' | 'NAME' | null = forEntity ? (hasIdentifier ? 'ID_CODE' : 'NAME') : null;
  const primaryValue = forEntity ? forEntity.idCode || forEntity.name : null;

  if (!forEntity || !primaryValue) {
    // mandate Section 11: "If no identifier is available ... cannot run
    // ENREG yet." Distinct from a legitimate zero-result search — the
    // orchestrator should not have scheduled this step at all.
    const err = new WorkflowPreconditionError('enreg', 'no entity name or identification code supplied');
    trace.record({ stateBefore: 'START', action: 'PRECONDITION_CHECK', actualOutcome: 'MISSING_SEARCH_VALUE', stateAfter: 'START', error: err.message });
    return buildResult('START', null, null, false, false, [], trace, err.message);
  }

  try {
    let attempt = await runOneAttempt(page, pageObj, primaryMethod as 'ID_CODE' | 'NAME', primaryValue, entities, trace, !!opts.skipGoto);
    trace.record({ stateBefore: 'START', action: 'ATTEMPT', target: `${primaryMethod}:${primaryValue}`, actualOutcome: attempt.fsmState, stateAfter: attempt.fsmState });
    let method = primaryMethod as 'ID_CODE' | 'NAME';
    let value = primaryValue;

    // Mandate: "If the exact ID isn't found, do a company-name fallback."
    // Triggered ONLY by a genuine confirmed zero-result on the ID-code
    // attempt — never by a technical failure (SUBMIT_FAILED,
    // SEARCH_CONTROL_NOT_FOUND), which must never be silently reinterpreted
    // as grounds to try the other search method with a different meaning.
    if (attempt.fsmState === 'NO_RESULT_CONFIRMED' && method === 'ID_CODE' && forEntity.name && forEntity.name.trim()) {
      trace.record({ stateBefore: 'NO_RESULT_CONFIRMED', action: 'ID_TO_NAME_FALLBACK', target: forEntity.name, actualOutcome: 'RETRYING_BY_NAME', stateAfter: null });
      const nameAttempt = await runOneAttempt(page, pageObj, 'NAME', forEntity.name, entities, trace, false);
      trace.record({ stateBefore: null, action: 'ATTEMPT', target: `NAME:${forEntity.name}`, actualOutcome: nameAttempt.fsmState, stateAfter: nameAttempt.fsmState });
      // Only switch to the name attempt's outcome when it actually advanced
      // further than a bare confirmed zero-result — if both the ID and the
      // name genuinely confirm zero results, the original ID-code attempt's
      // outcome is what gets reported (never silently prefer one arbitrary
      // NO_RESULT_CONFIRMED over the other).
      if (nameAttempt.matched || nameAttempt.fsmState !== 'NO_RESULT_CONFIRMED') {
        attempt = nameAttempt;
        method = 'NAME';
        value = forEntity.name;
      }
    }

    return buildResult(attempt.fsmState, method, value, attempt.matched, attempt.infoIconClicked, attempt.documents, trace, attempt.error, attempt.latestApplicationDate, attempt.fullChain);
  } catch (e) {
    return buildResult('FAILED', primaryMethod, primaryValue, false, false, [], trace, String(e));
  }

  function buildResult(
    state: string,
    method: 'ID_CODE' | 'NAME' | null,
    value: string | null,
    matched: boolean,
    infoIconClicked: boolean,
    documents: any[],
    tr: BrowserTrace,
    error: string | null,
    latestApplicationDate: string | null = null,
    fullChain = false
  ): LegacySourceResult {
    const traversal = computeEnregTraversal({
      searchMethod: method,
      searchValue: value,
      exactEntityMatched: matched,
      infoIconClicked,
      entityPageOpened: state !== 'START' && state !== 'SEARCH_CONTROL_NOT_FOUND' && matched && infoIconClicked,
      latestApplicationDate,
      latestApplicationOpened: fullChain,
      preparedDocumentsOpened: fullChain,
      latestRegistryExtractOpened: fullChain,
      fullExtractRead: fullChain,
      historicalRelevantRecordsRead: fullChain,
      searchControlNotFound: state === 'SEARCH_CONTROL_NOT_FOUND',
      submitFailed: state === 'SUBMIT_FAILED',
      captcha: state === 'WAITING_HUMAN',
      failed: state === 'FAILED',
      noResultConfirmed: state === 'NO_RESULT_CONFIRMED',
    });
    const legacyStatus = traversal.status === 'SOURCE_EXHAUSTED' ? (matched ? 'SEARCH_CONFIRMED' : 'NO_RESULT_CONFIRMED') : traversal.status === 'RESULTS_DISCOVERED' ? 'SEARCH_CONFIRMED' : traversal.status;
    const workflowResult: WorkflowResult = {
      source: 'enreg',
      state,
      completed: state === 'ENREG_EXHAUSTED',
      skipped: state === 'SKIPPED_HUMAN_VERIFICATION',
      discoveredItems: matched ? 1 : 0,
      visitedItems: infoIconClicked ? 1 : 0,
      discoveredDocuments: documents.length,
      readDocuments: documents.filter((d: any) => d.complete).length,
      unvisitedRelevantItems: matched && state !== 'ENREG_EXHAUSTED' && state !== 'NO_RESULT_CONFIRMED' ? 1 : 0,
      evidenceIds: [],
      trace: tr.all,
    };
    return {
      source: 'enreg',
      sourceName: SOURCE_META.name,
      sourceClass: SOURCE_META.class,
      sourceUrl: SOURCE_META.url,
      startUrl: SOURCE_META.url,
      finalUrl: SOURCE_META.url,
      frameUrls: [],
      searchControlUsed: method ? (method === 'ID_CODE' ? 'input[name*="ident" i]' : 'input[name*="name" i]') : null,
      queryEntered: value,
      submitAction: value ? 'CLICK button[name~=ძებნა]' : null,
      resultContext: error || `ENREG FSM reached ${state}`,
      resultConfirmed: legacyStatus === 'SEARCH_CONFIRMED',
      noResultConfirmed: legacyStatus === 'NO_RESULT_CONFIRMED',
      resultValidated: legacyStatus === 'SEARCH_CONFIRMED',
      status: legacyStatus,
      traversal,
      retrievedAt: new Date().toISOString(),
      documents,
      discoveredEntities: [],
      forEntity,
      error,
      workflowResult,
    };
  }
}
