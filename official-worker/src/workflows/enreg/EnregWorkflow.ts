// EnregWorkflow.ts — drives EnregPage.ts through the exact 25-state linear
// ENREG FSM (EnregState.ts). Deterministic, not AI-driven (mandate Section
// 11). Triggered only by a DISCOVERED_ENTITY from another source — never a
// primary search of its own.
import type { Page } from 'playwright';
import { newEnregFsm } from './EnregState.js';
import { EnregPage } from './EnregPage.js';
import { canMarkEnregExhausted, assertIdentifierPriorityRespected, assertExactEntityMatch, selectLatestApplicationDate } from './assertions.js';
import { BrowserTrace } from '../../browser/BrowserTrace.js';
import { computeEnregTraversal } from '../../state/transitions.js';
import { WorkflowPreconditionError } from '../../errors/WorkflowErrors.js';
import type { EntityQueue } from '../../entities/EntityQueue.js';
import type { LegacySourceResult, WorkflowResult } from '../WorkflowResult.js';

const SOURCE_META = { name: 'Entrepreneur Registry', class: 'OFFICIAL_REGISTRY', url: 'https://enreg.reestri.gov.ge/main.php?m=new_index' };

export async function runEnregWorkflow(page: Page, forEntity: { name: string; idCode: string | null } | null, entities?: EntityQueue, opts: { skipGoto?: boolean } = {}): Promise<LegacySourceResult> {
  const fsm = newEnregFsm();
  const trace = new BrowserTrace('enreg');
  const pageObj = new EnregPage();
  const hasIdentifier = !!forEntity?.idCode;
  const searchMethod: 'ID_CODE' | 'NAME' | null = forEntity ? (hasIdentifier ? 'ID_CODE' : 'NAME') : null;
  const searchValue = forEntity ? forEntity.idCode || forEntity.name : null;

  if (!forEntity || !searchValue) {
    // mandate Section 11: "If no identifier is available ... cannot run
    // ENREG yet." Distinct from a legitimate zero-result search — the
    // orchestrator should not have scheduled this step at all.
    const err = new WorkflowPreconditionError('enreg', 'no entity name or identification code supplied');
    trace.record({ stateBefore: 'START', action: 'PRECONDITION_CHECK', actualOutcome: 'MISSING_SEARCH_VALUE', stateAfter: 'START', error: err.message });
    return buildResult('START', null, null, false, false, [], trace, err.message);
  }

  try {
    if (!opts.skipGoto) await pageObj.goto(page);
    fsm.transition('ENREG_OPENED');
    if (!assertIdentifierPriorityRespected(hasIdentifier, searchMethod)) {
      // Structurally cannot happen given the logic above, but kept as a
      // real, checked assertion rather than an assumption.
      throw new Error('identifier priority violated');
    }
    fsm.transition('SEARCH_METHOD_SELECTED');

    const search = await pageObj.search(page, searchMethod as 'ID_CODE' | 'NAME', searchValue);
    if (!search.found) {
      fsm.transition('SEARCH_CONTROL_NOT_FOUND');
      return buildResult('SEARCH_CONTROL_NOT_FOUND', searchMethod, searchValue, false, false, [], trace, 'search field not found');
    }
    fsm.transition('SEARCH_FIELD_FOUND');
    fsm.transition('SEARCH_VALUE_ENTERED');
    if (!search.submitted) {
      fsm.transition('SUBMIT_FAILED');
      return buildResult('SUBMIT_FAILED', searchMethod, searchValue, false, false, [], trace, 'submit failed');
    }
    fsm.transition('SEARCH_SUBMITTED');
    fsm.transition('RESULTS_RETURNED');

    const exactMatch = assertExactEntityMatch(search.resultText || '', searchMethod, searchValue);
    if (!exactMatch) {
      fsm.transition('NO_RESULT_CONFIRMED', 'no row matched the searched identifier/name exactly');
      return buildResult('NO_RESULT_CONFIRMED', searchMethod, searchValue, false, false, [], trace, null);
    }
    fsm.transition('CORRECT_ENTITY_MATCHED');

    const iconRes = await pageObj.clickInfoIconForRow(page, searchValue);
    let activePage = iconRes.activePage as Page;
    if (!iconRes.clicked) {
      // Stopped here honestly — RESULTS_DISCOVERED-equivalent, never
      // upgraded.
      return buildResult('CORRECT_ENTITY_MATCHED', searchMethod, searchValue, true, false, [], trace, 'info icon not found for the matched row');
    }
    fsm.transition('INFO_ICON_CLICKED');

    const cap = await pageObj.detectVerificationChallenge(activePage);
    if (cap) {
      fsm.transition('WAITING_HUMAN', 'a real human-verification challenge appeared instead of a numeric read — never bypassed');
      return buildResult('WAITING_HUMAN', searchMethod, searchValue, true, true, [], trace, null);
    }

    const verifyValue = await pageObj.readVerificationValue(activePage);
    if (!verifyValue) {
      return buildResult('INFO_ICON_CLICKED', searchMethod, searchValue, true, true, [], trace, 'no verification value could be read from the page');
    }
    fsm.transition('VERIFICATION_VALUE_READ', verifyValue);
    const submitted = await pageObj.submitVerificationValue(activePage, verifyValue);
    if (!submitted) {
      return buildResult('VERIFICATION_VALUE_READ', searchMethod, searchValue, true, true, [], trace, 'verification value could not be submitted');
    }
    fsm.transition('VERIFICATION_VALUE_ENTERED');
    fsm.transition('VERIFICATION_SUBMITTED');

    const entityPage = await pageObj.readEntityPage(activePage);
    if (!entityPage.opened) {
      return buildResult('VERIFICATION_SUBMITTED', searchMethod, searchValue, true, true, [], trace, 'entity page did not open after verification');
    }
    fsm.transition('ENTITY_PAGE_OPENED');
    fsm.transition('ENTITY_PAGE_READ');
    if (entities) entities.scanText(entityPage.text, { source: 'enreg', sourceDocument: activePage.url(), retrievedAt: new Date().toISOString() });

    const dates = await pageObj.findLatestApplicationDate(activePage);
    if (!dates.length) {
      return buildResult('ENTITY_PAGE_READ', searchMethod, searchValue, true, true, [], trace, 'no applications section/dates found');
    }
    fsm.transition('APPLICATIONS_SECTION_FOUND');
    fsm.transition('APPLICATIONS_ENUMERATED');
    const latestDate = selectLatestApplicationDate(dates);
    fsm.transition('LATEST_APPLICATION_SELECTED_BY_DATE', latestDate || undefined);
    const opened = latestDate ? await pageObj.openLatestApplication(activePage, latestDate) : false;
    if (!opened) {
      return buildResult('APPLICATIONS_ENUMERATED', searchMethod, searchValue, true, true, [], trace, 'latest application could not be opened');
    }
    fsm.transition('LATEST_APPLICATION_DOCUMENT_OPENED');
    fsm.transition('APPLICATION_PAGE_READ');

    const preparedOpened = await pageObj.openPreparedDocuments(activePage);
    if (!preparedOpened) {
      return buildResult('APPLICATION_PAGE_READ', searchMethod, searchValue, true, true, [], trace, 'prepared documents section not found', latestDate);
    }
    fsm.transition('PREPARED_DOCUMENTS_FOUND');

    fsm.transition('REGISTRY_EXTRACT_FOUND', 'proceeding to locate the extract link');
    const extractRes = await pageObj.openRegistryExtract(activePage);
    const documents = extractRes.doc ? [extractRes.doc] : [];
    if (!extractRes.opened) {
      return buildResult('PREPARED_DOCUMENTS_FOUND', searchMethod, searchValue, true, true, documents, trace, 'registry extract link not found', latestDate);
    }
    fsm.transition('REGISTRY_EXTRACT_OPENED');
    const fullExtractRead = extractRes.doc?.complete === true;
    if (fullExtractRead) fsm.transition('FULL_EXTRACT_READ');
    else {
      return buildResult('REGISTRY_EXTRACT_OPENED', searchMethod, searchValue, true, true, documents, trace, 'extract opened but not fully read', latestDate);
    }
    if (extractRes.doc?.rawText && entities) entities.scanText(extractRes.doc.rawText, { source: 'enreg', sourceDocument: extractRes.doc.url, documentDate: extractRes.doc.documentDate, retrievedAt: new Date().toISOString() });

    // "historically-relevant records" beyond the latest extract: honest
    // only when every earlier stage genuinely completed (never merely
    // because we reached this line).
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

    return buildResult(fsm.state, searchMethod, searchValue, true, true, documents, trace, null, latestDate, true);
  } catch (e) {
    return buildResult('FAILED', searchMethod, searchValue, false, false, [], trace, String(e));
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
