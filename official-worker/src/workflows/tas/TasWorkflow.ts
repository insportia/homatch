// TasWorkflow.ts — drives TasPage.ts through TasState.ts's FSM, including
// the parent-cadastral-code fallback (cadastral.ts) and the full
// discover-then-traverse-every-row chain. TAS_EXHAUSTED is only reachable
// when canMarkTasExhausted() genuinely holds — the direct fix for "18
// discovered via TAS's own counter, 0 rows/documents opened."
import type { Page } from 'playwright';
import { newTasFsm } from './TasState.js';
import { TasPage } from './TasPage.js';
import { canMarkTasExhausted, assertSearchSubmitted } from './assertions.js';
import { candidateSequence, isCadastralCode } from './cadastral.js';
import { BrowserTrace } from '../../browser/BrowserTrace.js';
import { challenge } from '../../browser/BrowserSession.js';
import { computeTasTraversal } from '../../state/transitions.js';
import type { EntityQueue } from '../../entities/EntityQueue.js';
import type { LegacySourceResult, WorkflowResult } from '../WorkflowResult.js';

const SOURCE_META = { name: 'TAS', class: 'OFFICIAL_GOVERNMENT', url: 'https://tas.ge/?p=searchdocument&menuItemId=7104' };

export async function runTasWorkflow(page: Page, query: string, mode: 'cadastral' | 'property', entities?: EntityQueue, opts: { skipGoto?: boolean } = {}): Promise<LegacySourceResult> {
  const fsm = newTasFsm();
  const trace = new BrowserTrace('tas');
  const pageObj = new TasPage();

  try {
    if (!opts.skipGoto) {
      const gotoRes = await pageObj.goto(page);
      trace.record({ stateBefore: null, action: 'GOTO', target: SOURCE_META.url, actualOutcome: `TAS_OPENED searchMenuClicked=${gotoRes.searchMenuClicked}`, stateAfter: 'TAS_OPENED' });
    }
    fsm.transition('TAS_OPENED');

    const cap = await challenge(page);
    if (cap) {
      fsm.transition('WAITING_HUMAN', 'captcha before search');
      return buildResult('WAITING_HUMAN', null, null, 0, 0, 0, 0, [], trace, query, query, null);
    }

    fsm.transition('CADASTRAL_FORM_FOUND', 'proceeding to search — a missing control is reported at FULL_CODE_ENTERED');
    const candidates = mode === 'cadastral' ? candidateSequence(query) : [query];
    const original = query;
    let resolved = candidates[0];
    let searchRes = await pageObj.searchCadastral(page, resolved);
    trace.record({ stateBefore: 'CADASTRAL_FORM_FOUND', action: 'SEARCH', target: resolved, actualOutcome: searchRes.found ? 'SUBMITTED' : 'CONTROL_NOT_FOUND', stateAfter: null });

    if (!searchRes.found) {
      fsm.transition('SEARCH_CONTROL_NOT_FOUND');
      return buildResult('SEARCH_CONTROL_NOT_FOUND', original, resolved, null, 0, 0, 0, [], trace, query, original, null, 'search control not found');
    }
    fsm.transition('FULL_CODE_ENTERED');
    if (!assertSearchSubmitted(searchRes.submitted, searchRes.networkConfirmed)) {
      fsm.transition('SUBMIT_FAILED');
      return buildResult('SUBMIT_FAILED', original, resolved, null, 0, 0, 0, [], trace, query, original, null, 'submit failed');
    }
    fsm.transition('FULL_SEARCH_SUBMITTED');
    fsm.transition('FULL_RESULTS_INSPECTED');

    // Escalate to the parent/base-parcel candidate sequence ONLY when the
    // full code came back a CONFIRMED empty — never merely because the form
    // failed to operate (that is a control problem, not a granularity one).
    let attempts = [{ cadastralCodeTried: resolved, resultsDiscovered: searchRes.resultsDiscovered, noResultConfirmed: !!searchRes.noResultConfirmed }];
    if (searchRes.noResultConfirmed && candidates.length > 1) {
      fsm.transition('PARENT_CODE_RESOLUTION', 'full code confirmed empty — trying parent parcel candidates');
      for (const candidate of candidates.slice(1)) {
        fsm.transition('PARENT_CODE_ENTERED', candidate);
        const retry = await pageObj.searchCadastral(page, candidate);
        attempts.push({ cadastralCodeTried: candidate, resultsDiscovered: retry.resultsDiscovered, noResultConfirmed: !!retry.noResultConfirmed });
        if (!retry.found || !assertSearchSubmitted(retry.submitted, retry.networkConfirmed)) continue;
        fsm.transition('PARENT_SEARCH_SUBMITTED');
        if (!retry.noResultConfirmed) {
          searchRes = retry;
          resolved = candidate;
          break;
        }
      }
    }

    fsm.transition('RESULT_SET_CAPTURED');
    const resultsDiscovered = searchRes.resultsDiscovered;
    if (searchRes.noResultConfirmed || resultsDiscovered === 0) {
      fsm.transition('RESULT_QUEUE_CREATED', 'zero relevant items — nothing to traverse');
      fsm.transition('RESULT_OPENED');
      fsm.transition('CHILDREN_ENUMERATED');
      fsm.transition('RESULT_EXHAUSTED');
      fsm.transition('RETURN_TO_RESULT_LIST');
      fsm.transition('NEXT_RESULT');
      fsm.transition('ALL_RESULTS_EXHAUSTED');
      fsm.transition('TAS_EXHAUSTED');
      return buildResult('TAS_EXHAUSTED', original, resolved, 0, 0, 0, 0, [], trace, query, original, null, null, attempts);
    }

    // A result set with an unknown discovered count (selector/count both
    // failed) or one that IS known: either way we still attempt to open
    // every row we can find — the traversal snapshot honestly reports
    // whatever `resultsDiscovered` this run could actually establish.
    fsm.transition('RESULT_QUEUE_CREATED');
    fsm.transition('RESULT_OPENED');
    // The real production bug this fixes: searchCadastral() already resolves
    // and returns the actual Frame the results render in (docs.tbilisi.gov.ge's
    // embedded ExtJS iframe, not necessarily the outer tas.ge page) — passing
    // the outer `page` here instead discards that and silently searches the
    // wrong document (Page.locator() never sees into iframe content).
    const resultScope = searchRes.frame || page;
    let exhaustion = await pageObj.exhaustResultRows(resultScope, resultsDiscovered);
    fsm.transition('CHILDREN_ENUMERATED', `${exhaustion.rowsDiscoveredBySelector} row(s) found by ${exhaustion.rowStrategy}`);

    let finalDiscovered = resultsDiscovered != null ? resultsDiscovered : exhaustion.rowsDiscoveredBySelector;
    let invariantInput = {
      resultsDiscovered: finalDiscovered,
      resultsVisited: exhaustion.rowsVisited,
      skippedReasonsCount: exhaustion.skippedReasons.length,
      documentsDiscovered: exhaustion.rowsVisited,
      documentsRead: exhaustion.rowDocuments.length,
    };

    // Never accept "gate blocked, so just report the incomplete state" as
    // final (mandate: "if resultsDiscovered=24 and resultsVisited=16 then
    // TAS_EXHAUSTED must be programmatically impossible" — AND the workflow
    // must actually keep working toward completeness, not merely report the
    // honest shortfall). One bounded re-pass over a fresh DOM query recovers
    // from transient render/timing gaps; it is not a substitute for a real
    // root-cause fix, so both the original attempt's strategy and this
    // retry's are recorded in the trace either way.
    if (!canMarkTasExhausted(invariantInput) && exhaustion.rowsVisited < finalDiscovered) {
      trace.record({
        stateBefore: fsm.state,
        action: 'RETRY_EXHAUSTION',
        actualOutcome: `visited=${exhaustion.rowsVisited} of discovered=${finalDiscovered} (strategy=${exhaustion.rowStrategy}) — retrying row traversal`,
        stateAfter: fsm.state,
      });
      const retry = await pageObj.exhaustResultRows(resultScope, finalDiscovered);
      const seenUrls = new Set(exhaustion.rowDocuments.map((d: any) => d.url));
      const mergedDocs = exhaustion.rowDocuments.slice();
      for (const d of retry.rowDocuments) if (!seenUrls.has(d.url)) { mergedDocs.push(d); seenUrls.add(d.url); }
      exhaustion = {
        rowDocuments: mergedDocs,
        trace: [...exhaustion.trace, ...retry.trace],
        rowsVisited: Math.max(exhaustion.rowsVisited, retry.rowsVisited),
        rowsDiscoveredBySelector: Math.max(exhaustion.rowsDiscoveredBySelector, retry.rowsDiscoveredBySelector),
        skippedReasons: [...exhaustion.skippedReasons, ...retry.skippedReasons],
        rowStrategy: `${exhaustion.rowStrategy}+RETRY:${retry.rowStrategy}`,
      };
      finalDiscovered = resultsDiscovered != null ? resultsDiscovered : exhaustion.rowsDiscoveredBySelector;
      invariantInput = {
        resultsDiscovered: finalDiscovered,
        resultsVisited: exhaustion.rowsVisited,
        skippedReasonsCount: exhaustion.skippedReasons.length,
        documentsDiscovered: exhaustion.rowsVisited,
        documentsRead: exhaustion.rowDocuments.length,
      };
    }

    for (const d of exhaustion.rowDocuments) if (entities && d.rawText) entities.scanText(d.rawText, { source: 'tas', sourceDocument: d.url, retrievedAt: new Date().toISOString() });
    if (exhaustion.rowDocuments.length > 0) fsm.transition('CHILD_DOCUMENT_OPENED');
    if (exhaustion.rowDocuments.length > 0) fsm.transition('DOCUMENT_READ');
    if (exhaustion.rowDocuments.length > 0) fsm.transition('RETURN_TO_RESULT');
    if (exhaustion.rowDocuments.length > 0) fsm.transition('NEXT_CHILD');
    fsm.transition('RESULT_EXHAUSTED');
    fsm.transition('RETURN_TO_RESULT_LIST');
    fsm.transition('NEXT_RESULT');
    fsm.transition('ALL_RESULTS_EXHAUSTED');
    if (canMarkTasExhausted(invariantInput)) {
      fsm.transition('TAS_EXHAUSTED');
    } else {
      // Structurally CANNOT reach TAS_EXHAUSTED — this is the exact
      // mandate invariant ("18 discovered, 16 visited MUST make
      // TAS_EXHAUSTED impossible") enforced here, not merely tested.
      trace.record({ stateBefore: 'ALL_RESULTS_EXHAUSTED', action: 'GATE', expectedOutcome: 'TAS_EXHAUSTED', actualOutcome: 'BLOCKED_BY_canMarkTasExhausted', stateAfter: 'ALL_RESULTS_EXHAUSTED' });
    }

    return buildResult(fsm.state, original, resolved, finalDiscovered, exhaustion.rowsVisited, exhaustion.rowsVisited, exhaustion.rowDocuments.length, exhaustion.rowDocuments, trace, query, original, null, null, attempts, exhaustion.skippedReasons.length);
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
    skippedReasonsCount = 0
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
    const legacyStatus = traversal.status === 'SOURCE_EXHAUSTED' ? (resultsDiscovered === 0 ? 'NO_RESULT_CONFIRMED' : 'SEARCH_CONFIRMED') : traversal.status === 'RESULTS_DISCOVERED' || traversal.status === 'RESULTS_TRAVERSED' ? 'SEARCH_CONFIRMED' : traversal.status;
    const workflowResult: WorkflowResult = {
      source: 'tas',
      state,
      completed: state === 'TAS_EXHAUSTED',
      skipped: state === 'SKIPPED_HUMAN_VERIFICATION',
      discoveredItems: resultsDiscovered,
      visitedItems: resultsVisited,
      discoveredDocuments: documentsDiscovered,
      readDocuments: documentsRead,
      unvisitedRelevantItems: traversal.unvisitedRelevantItems,
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
      resultContext: `TAS FSM reached ${state}`,
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
