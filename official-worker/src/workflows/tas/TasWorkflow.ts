// TasWorkflow.ts — deterministic TAS document workflow.
//
// TAS search still discovers the source's full result count, but the product
// traversal policy is intentionally bounded to the latest <=10 dated records.
// TasResultExhauster owns that live-verified selection: if <=10 exist it
// processes all; if more exist it walks backward from the last pagination
// page until it has enough candidates, then sorts by actual DD/MM/YYYY DESC.
// Completion therefore means every SELECTED latest record was processed — not
// that an unbounded historical archive was opened. The source's full count is
// retained in trace/resultContext for auditability.
import type { Page } from 'playwright';
import { newTasFsm } from './TasState.js';
import { TasPage } from './TasPage.js';
import { canMarkTasExhausted, assertSearchSubmitted } from './assertions.js';
import { candidateSequence, isCadastralCode, hasMeaningfulTasResults } from './cadastral.js';
import { BrowserTrace } from '../../browser/BrowserTrace.js';
import { challenge } from '../../browser/BrowserSession.js';
import { computeTasTraversal } from '../../state/transitions.js';
import type { EntityQueue } from '../../entities/EntityQueue.js';
import type { LegacySourceResult, WorkflowResult } from '../WorkflowResult.js';

const SOURCE_META = {
  name: 'TAS',
  class: 'OFFICIAL_GOVERNMENT',
  url: 'https://tas.ge/?p=searchdocument&menuItemId=7104',
};

export async function runTasWorkflow(
  page: Page,
  query: string,
  mode: 'cadastral' | 'property',
  entities?: EntityQueue,
  opts: { skipGoto?: boolean } = {},
): Promise<LegacySourceResult> {
  const fsm = newTasFsm();
  const trace = new BrowserTrace('tas');
  const pageObj = new TasPage();

  try {
    if (!opts.skipGoto) {
      const gotoRes = await pageObj.goto(page);
      trace.record({
        stateBefore: null,
        action: 'GOTO',
        target: SOURCE_META.url,
        actualOutcome: `TAS_OPENED searchMenuClicked=${gotoRes.searchMenuClicked}`,
        stateAfter: 'TAS_OPENED',
      });
    }
    fsm.transition('TAS_OPENED');

    const cap = await challenge(page);
    if (cap) {
      fsm.transition('WAITING_HUMAN', 'captcha before search');
      return buildResult('WAITING_HUMAN', null, null, 0, 0, 0, 0, [], trace, query, query, null);
    }

    fsm.transition('CADASTRAL_FORM_FOUND', 'proceeding to search — a missing control is reported at FULL_CODE_ENTERED');

    // TAS searches the base/parent parcel first. The exact apartment/unit code
    // remains the untouched original identifier for downstream provenance.
    const candidates = mode === 'cadastral' ? candidateSequence(query) : [query];
    const original = query;
    let resolved = candidates[0];
    let searchRes = await pageObj.searchCadastral(page, resolved);

    trace.record({
      stateBefore: 'CADASTRAL_FORM_FOUND',
      action: 'SEARCH',
      target: resolved,
      actualOutcome: searchRes.found ? 'SUBMITTED' : 'CONTROL_NOT_FOUND',
      stateAfter: null,
    });

    if (!searchRes.found) {
      fsm.transition('SEARCH_CONTROL_NOT_FOUND');
      return buildResult(
        'SEARCH_CONTROL_NOT_FOUND',
        original,
        resolved,
        null,
        0,
        0,
        0,
        [],
        trace,
        query,
        original,
        null,
        'search control not found',
      );
    }

    fsm.transition('FULL_CODE_ENTERED');
    if (!assertSearchSubmitted(searchRes.submitted, searchRes.networkConfirmed)) {
      fsm.transition('SUBMIT_FAILED');
      return buildResult('SUBMIT_FAILED', original, resolved, null, 0, 0, 0, [], trace, query, original, null, 'submit failed');
    }

    fsm.transition('FULL_SEARCH_SUBMITTED');
    fsm.transition('FULL_RESULTS_INSPECTED');

    let attempts = [
      {
        cadastralCodeTried: resolved,
        resultsDiscovered: searchRes.resultsDiscovered,
        noResultConfirmed: !!searchRes.noResultConfirmed,
      },
    ];

    if (!hasMeaningfulTasResults(searchRes) && candidates.length > 1) {
      fsm.transition('PARENT_CODE_RESOLUTION', 'base/parent parcel had no meaningful results — trying broader fallback candidates');
      for (const candidate of candidates.slice(1)) {
        fsm.transition('PARENT_CODE_ENTERED', candidate);
        const retry = await pageObj.searchCadastral(page, candidate);
        attempts.push({
          cadastralCodeTried: candidate,
          resultsDiscovered: retry.resultsDiscovered,
          noResultConfirmed: !!retry.noResultConfirmed,
        });
        if (!retry.found || !assertSearchSubmitted(retry.submitted, retry.networkConfirmed)) continue;
        fsm.transition('PARENT_SEARCH_SUBMITTED');
        searchRes = retry;
        resolved = candidate;
        if (hasMeaningfulTasResults(retry)) break;
      }
    }

    fsm.transition('RESULT_SET_CAPTURED');
    const sourceResultsDiscovered = searchRes.resultsDiscovered;

    if (!hasMeaningfulTasResults(searchRes)) {
      fsm.transition('RESULT_QUEUE_CREATED', 'zero relevant items — nothing to traverse');
      fsm.transition('RESULT_OPENED');
      fsm.transition('CHILDREN_ENUMERATED');
      fsm.transition('RESULT_EXHAUSTED');
      fsm.transition('RETURN_TO_RESULT_LIST');
      fsm.transition('NEXT_RESULT');
      fsm.transition('ALL_RESULTS_EXHAUSTED');
      fsm.transition('TAS_EXHAUSTED');
      return buildResult('TAS_EXHAUSTED', original, resolved, 0, 0, 0, 0, [], trace, query, original, null, null, attempts, 0, 0);
    }

    fsm.transition('RESULT_QUEUE_CREATED');
    fsm.transition('RESULT_OPENED');

    // searchCadastral() returns the real ExtJS Frame whenever the grid lives
    // inside docs.tbilisi.gov.ge. Page.locator() cannot pierce that iframe.
    const resultScope = searchRes.frame || page;
    let exhaustion = await pageObj.exhaustResultRows(resultScope, sourceResultsDiscovered);

    fsm.transition(
      'CHILDREN_ENUMERATED',
      `${exhaustion.rowsDiscoveredBySelector} latest row(s) selected by ${exhaustion.rowStrategy}`,
    );

    const sourceTotal = exhaustion.sourceTotalResults ?? sourceResultsDiscovered;
    let selectedTarget = exhaustion.selectionTarget ?? exhaustion.rowsDiscoveredBySelector;
    let completeDocuments = exhaustion.rowDocuments.filter((d: any) => !!d.complete).length;

    trace.record({
      stateBefore: fsm.state,
      action: 'LATEST_SELECTION_POLICY',
      actualOutcome: `sourceTotal=${sourceTotal ?? 'unknown'} selectedTarget=${selectedTarget} pages=${(exhaustion.selectionPagesVisited || []).join(',') || 'n/a'}`,
      stateAfter: fsm.state,
    });

    // IMPORTANT: the completeness gate is evaluated against the intentional
    // latest-record target, not the entire historical source count. Failed
    // selected rows are NOT converted into harmless skips: skippedReasonsCount
    // stays zero in the invariant so an unread selected row blocks exhaustion.
    let invariantInput = {
      resultsDiscovered: selectedTarget,
      resultsVisited: exhaustion.rowsVisited,
      skippedReasonsCount: 0,
      documentsDiscovered: exhaustion.rowDocuments.length,
      documentsRead: completeDocuments,
    };

    // One bounded retry only when the live-verified target was not fully read.
    // Healthy runs do not pay this cost.
    if (!canMarkTasExhausted(invariantInput)) {
      trace.record({
        stateBefore: fsm.state,
        action: 'RETRY_LATEST_SELECTION',
        actualOutcome: `visited=${exhaustion.rowsVisited}/${selectedTarget} documents=${completeDocuments}/${exhaustion.rowDocuments.length}`,
        stateAfter: fsm.state,
      });

      const retry = await pageObj.exhaustResultRows(resultScope, sourceResultsDiscovered);
      const mergedDocs = exhaustion.rowDocuments.slice();
      const seen = new Set(
        mergedDocs.map((d: any) => `${String(d.url || '').replace(/[?#].*$/, '')}|${d.documentType}|${d.pageCount}|${String(d.rawText || '').length}|${String(d.rawText || '').slice(0, 160)}`),
      );
      for (const d of retry.rowDocuments) {
        const key = `${String(d.url || '').replace(/[?#].*$/, '')}|${d.documentType}|${d.pageCount}|${String(d.rawText || '').length}|${String(d.rawText || '').slice(0, 160)}`;
        if (!seen.has(key)) {
          seen.add(key);
          mergedDocs.push(d);
        }
      }

      exhaustion = {
        ...exhaustion,
        rowDocuments: mergedDocs,
        trace: [...exhaustion.trace, ...retry.trace],
        rowsVisited: Math.max(exhaustion.rowsVisited, retry.rowsVisited),
        rowsDiscoveredBySelector: Math.max(exhaustion.rowsDiscoveredBySelector, retry.rowsDiscoveredBySelector),
        skippedReasons: [...exhaustion.skippedReasons, ...retry.skippedReasons],
        rowStrategy: `${exhaustion.rowStrategy}+RETRY:${retry.rowStrategy}`,
        sourceTotalResults: retry.sourceTotalResults ?? exhaustion.sourceTotalResults,
        selectionTarget: Math.max(exhaustion.selectionTarget || 0, retry.selectionTarget || 0),
        selectionPagesVisited: [...new Set([...(exhaustion.selectionPagesVisited || []), ...(retry.selectionPagesVisited || [])])],
      };

      selectedTarget = exhaustion.selectionTarget ?? exhaustion.rowsDiscoveredBySelector;
      completeDocuments = exhaustion.rowDocuments.filter((d: any) => !!d.complete).length;
      invariantInput = {
        resultsDiscovered: selectedTarget,
        resultsVisited: exhaustion.rowsVisited,
        skippedReasonsCount: 0,
        documentsDiscovered: exhaustion.rowDocuments.length,
        documentsRead: completeDocuments,
      };
    }

    for (const d of exhaustion.rowDocuments) {
      if (entities && d.rawText) {
        entities.scanText(d.rawText, {
          source: 'tas',
          sourceDocument: d.url,
          retrievedAt: new Date().toISOString(),
        });
      }
    }

    if (exhaustion.rowDocuments.length > 0) fsm.transition('CHILD_DOCUMENT_OPENED');
    if (completeDocuments > 0) fsm.transition('DOCUMENT_READ');
    if (exhaustion.rowDocuments.length > 0) fsm.transition('RETURN_TO_RESULT');
    if (exhaustion.rowDocuments.length > 0) fsm.transition('NEXT_CHILD');
    fsm.transition('RESULT_EXHAUSTED');
    fsm.transition('RETURN_TO_RESULT_LIST');
    fsm.transition('NEXT_RESULT');
    fsm.transition('ALL_RESULTS_EXHAUSTED');

    if (canMarkTasExhausted(invariantInput)) {
      fsm.transition('TAS_EXHAUSTED');
    } else {
      trace.record({
        stateBefore: 'ALL_RESULTS_EXHAUSTED',
        action: 'GATE',
        expectedOutcome: 'TAS_EXHAUSTED',
        actualOutcome: 'BLOCKED_BY_latest_selection_completeness',
        stateAfter: 'ALL_RESULTS_EXHAUSTED',
      });
    }

    return buildResult(
      fsm.state,
      original,
      resolved,
      selectedTarget,
      exhaustion.rowsVisited,
      exhaustion.rowDocuments.length,
      completeDocuments,
      exhaustion.rowDocuments,
      trace,
      query,
      original,
      null,
      null,
      attempts,
      exhaustion.skippedReasons.length,
      sourceTotal,
    );
  } catch (e) {
    return buildResult('FAILED', isCadastralCode(query) ? query : null, null, null, 0, 0, 0, [], trace, query, query, String(e));
  }

  function buildResult(
    state: string,
    original: string | null,
    resolved: string | null,
    resultsDiscovered: number | null,
    resultsVisited: number,
    documentsDiscovered: number,
    documentsRead: number,
    documents: any[],
    tr: BrowserTrace,
    q: string,
    _origQ: string,
    error: string | null = null,
    _msg?: string | null,
    cadastralFallbackAttempts?: any[],
    skippedReasonsCount = 0,
    sourceTotalResults: number | null = null,
  ): LegacySourceResult {
    const traversal = computeTasTraversal({
      originalCadastralCode: original,
      resolvedSearchCadastralCode: resolved,
      searchSubmitted: state !== 'SEARCH_CONTROL_NOT_FOUND' && state !== 'WAITING_HUMAN',
      resultsDiscovered,
      resultsVisited,
      documentsDiscovered,
      documentsRead,
      skippedReasonsCount,
      captcha: state === 'WAITING_HUMAN',
      searchControlNotFound: state === 'SEARCH_CONTROL_NOT_FOUND',
      submitFailed: state === 'SUBMIT_FAILED',
      failed: state === 'FAILED',
    });

    const legacyStatus =
      traversal.status === 'SOURCE_EXHAUSTED'
        ? resultsDiscovered === 0
          ? 'NO_RESULT_CONFIRMED'
          : 'SEARCH_CONFIRMED'
        : traversal.status === 'RESULTS_DISCOVERED' || traversal.status === 'RESULTS_TRAVERSED'
          ? 'SEARCH_CONFIRMED'
          : traversal.status;

    const workflowResult: WorkflowResult = {
      source: 'tas',
      state,
      completed: state === 'TAS_EXHAUSTED',
      skipped: state === 'SKIPPED_HUMAN_VERIFICATION',
      discoveredItems: resultsDiscovered,
      visitedItems: resultsVisited,
      discoveredDocuments: documentsDiscovered,
      readDocuments: documentsRead,
      unvisitedRelevantItems: traversal.unvisitedRelevantItems as number | null,
      evidenceIds: [],
      trace: tr.all,
    };

    return {
      source: 'tas',
      sourceName: SOURCE_META.name,
      sourceClass: SOURCE_META.class,
      sourceUrl: SOURCE_META.url,
      startUrl: SOURCE_META.url,
      finalUrl: SOURCE_META.url,
      frameUrls: [],
      searchControlUsed: state === 'SEARCH_CONTROL_NOT_FOUND' ? null : 'input[name*="cad" i]',
      queryEntered: state === 'SEARCH_CONTROL_NOT_FOUND' ? null : q,
      submitAction: state === 'SEARCH_CONTROL_NOT_FOUND' ? null : 'ENTER_KEY',
      resultContext: `TAS FSM reached ${state}; latest-policy selected=${resultsDiscovered ?? 'unknown'}; source-total=${sourceTotalResults ?? 'unknown'}; newest evidence is authoritative for current state, older records remain historical context`,
      resultConfirmed: legacyStatus === 'SEARCH_CONFIRMED',
      noResultConfirmed: legacyStatus === 'NO_RESULT_CONFIRMED',
      resultValidated: legacyStatus === 'SEARCH_CONFIRMED',
      status: legacyStatus,
      traversal,
      retrievedAt: new Date().toISOString(),
      documents,
      discoveredEntities: [],
      originalCadastralCode: original,
      resolvedSearchCadastralCode: resolved,
      cadastralFallbackAttempts: cadastralFallbackAttempts || null,
      error,
      workflowResult,
    };
  }
}
