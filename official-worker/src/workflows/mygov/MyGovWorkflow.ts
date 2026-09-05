// MyGovWorkflow.ts — the source mandate Section 9 says needs "special
// attention because current production repeatedly enters the wrong
// context." WRONG_SEARCH_CONTEXT is reached whenever the field that was
// actually filled+submitted came only from a low-confidence candidate
// guess (assertCorrectSearchContext fails) — the source's own confirm/deny
// text is then explicitly untrusted, and CONFIRMED_ZERO_RESULTS/
// MYGOV_EXHAUSTED become structurally unreachable (canMarkMygovExhausted).
import type { Page } from 'playwright';
import { newMyGovFsm } from './MyGovState.js';
import { MyGovPage } from './MyGovPage.js';
import { canMarkMygovExhausted, assertCorrectSearchContext, assertPropertySearchContextConfirmed } from './assertions.js';
import { exhaustResultRows } from '../../browser/ResultRowExhauster.js';
import { BrowserTrace } from '../../browser/BrowserTrace.js';
import { challenge } from '../../browser/BrowserSession.js';
import { computeMygovTraversal } from '../../state/transitions.js';
import type { EntityQueue } from '../../entities/EntityQueue.js';
import type { LegacySourceResult, WorkflowResult } from '../WorkflowResult.js';

const SOURCE_META = { name: 'NAPR — საჯარო რეესტრის ეროვნული სააგენტო (MY.GOV.GE სერვისი 176 → naprweb.reestri.gov.ge)', class: 'OFFICIAL_GOVERNMENT', url: 'https://www.my.gov.ge/ka-ge/services/5/service/176' };

export async function runMyGovWorkflow(page: Page, ctx: any, query: string, entities?: EntityQueue, opts: { skipGoto?: boolean } = {}): Promise<LegacySourceResult> {
  const fsm = newMyGovFsm();
  const trace = new BrowserTrace('mygov');
  const pageObj = new MyGovPage();

  try {
    if (!opts.skipGoto) await pageObj.goto(page);
    fsm.transition('SERVICE_176_OPENED');

    // Try the service page's own known-good field first — only when THAT
    // fails do we go looking for the naprweb registry iframe. Either way,
    // "SERVICE_APPLICATION_DISCOVERED" means we found SOMETHING worth
    // trying next, not that it was the right context yet (that assertion
    // comes later, at PROPERTY_SEARCH_CONTEXT_CONFIRMED).
    let searchRes = await pageObj.searchCadastral(page, query);
    let activePage: Page = page;
    let registryAppOpened = false;

    if (!searchRes.found) {
      fsm.transition('SERVICE_APPLICATION_DISCOVERED', 'no field on the top-level service page — polling for the naprweb iframe');
      const reg = await pageObj.openRegistryApplication(page, ctx);
      registryAppOpened = reg.registryAppOpened;
      if (!reg.registryAppOpened || !reg.activePage) {
        fsm.transition('SEARCH_CONTROL_NOT_FOUND');
        return buildResult('SEARCH_CONTROL_NOT_FOUND', false, false, null, trace, query, null, 'naprweb registry app not reached');
      }
      activePage = reg.activePage;
      fsm.transition('REGISTRY_APPLICATION_OPENED');
      searchRes = await pageObj.searchCadastral(activePage, query);
    } else {
      registryAppOpened = true;
      fsm.transition('SERVICE_APPLICATION_DISCOVERED');
      fsm.transition('REGISTRY_APPLICATION_OPENED', 'top-level service page itself carried the cadastral field');
    }

    if (!assertPropertySearchContextConfirmed(true, registryAppOpened)) {
      fsm.transition('EXPLICIT_ACCESS_FAILURE');
      return buildResult('EXPLICIT_ACCESS_FAILURE', true, registryAppOpened, null, trace, query, (activePage as any).url(), 'registry application never opened');
    }

    const correctContext = assertCorrectSearchContext(searchRes.contextConfidence || null);
    if (!searchRes.found) {
      fsm.transition('SEARCH_CONTROL_NOT_FOUND');
      return buildResult('SEARCH_CONTROL_NOT_FOUND', true, registryAppOpened, null, trace, query, (activePage as any).url(), 'no field found even inside the registry app');
    }
    // PROPERTY_SEARCH_CONTEXT_CONFIRMED is only reached with a trusted
    // field — the direct fix for "a generic candidate guess produced a
    // confident false NO_RESULT with no CAPTCHA ever appearing."
    if (correctContext) fsm.transition('PROPERTY_SEARCH_CONTEXT_CONFIRMED');
    fsm.transition(correctContext ? 'CADASTRAL_INPUT_FOUND' : 'SEARCH_SUBMITTED', correctContext ? undefined : 'weak search context — proceeding straight to the branch decision');
    if (correctContext) {
      fsm.transition('CADASTRAL_ENTERED');
      fsm.transition('SEARCH_SUBMITTED');
    }
    fsm.transition('POST_SEARCH_STATE');

    const cap = await challenge(activePage);
    if (cap) {
      fsm.transition('HUMAN_VERIFICATION_REQUIRED');
      fsm.transition('WAITING_HUMAN');
      return buildResult('WAITING_HUMAN', true, registryAppOpened, correctContext, trace, query, (activePage as any).url(), null, searchRes.contextConfidence || null);
    }

    if (!correctContext) {
      fsm.transition('EXPLICIT_ACCESS_FAILURE', 'WRONG_SEARCH_CONTEXT — contributes zero confirmed facts');
      return buildResult(
        'WRONG_SEARCH_CONTEXT',
        true,
        registryAppOpened,
        false,
        trace,
        query,
        (activePage as any).url(),
        `the field used was only located by a low-confidence fallback scan (contextConfidence=${searchRes.contextConfidence || 'unknown'})`,
        searchRes.contextConfidence || null
      );
    }

    if (!searchRes.resultChanged) {
      fsm.transition('EXPLICIT_ACCESS_FAILURE', 'no new result signal after submit');
      return buildResult('SUBMIT_FAILED', true, registryAppOpened, true, trace, query, (activePage as any).url(), 'search submitted but no new result signal appeared');
    }

    const noResultConfirmed = /ვერ\s*მოიძებნა|not\s*found|no\s*results?/i.test(searchRes.resultText || '');
    if (noResultConfirmed) {
      fsm.transition('CONFIRMED_ZERO_RESULTS');
      fsm.transition('MYGOV_EXHAUSTED');
      return buildResult('MYGOV_EXHAUSTED', true, registryAppOpened, true, trace, query, (activePage as any).url(), null, searchRes.contextConfidence || null, 0);
    }

    fsm.transition('RESULTS_RETURNED');
    const exhaustion = await exhaustResultRows(activePage, 'mygov');
    fsm.transition('RESULTS_ENUMERATED', `${exhaustion.rowsDiscoveredBySelector} row(s) found`);
    for (const d of exhaustion.rowDocuments) if (entities && d.rawText) entities.scanText(d.rawText, { source: 'mygov', sourceDocument: d.url, retrievedAt: new Date().toISOString() });
    const invariant = { service176Opened: true, registryAppOpened, correctSearchContext: true, queryEntered: true, searchSubmitted: true, resultsDiscovered: exhaustion.rowsDiscoveredBySelector, resultsVisited: exhaustion.rowsVisited, documentsRead: exhaustion.rowDocuments.length };
    fsm.transition('RESULTS_TRAVERSED');
    if (canMarkMygovExhausted(invariant)) fsm.transition('MYGOV_EXHAUSTED');

    return buildResult(fsm.state, true, registryAppOpened, true, trace, query, (activePage as any).url(), null, searchRes.contextConfidence || null, exhaustion.rowsDiscoveredBySelector, exhaustion.rowsVisited, exhaustion.rowDocuments);
  } catch (e) {
    return buildResult('FAILED', false, false, null, trace, query, null, String(e));
  }

  function buildResult(
    state: string,
    service176Opened: boolean,
    registryAppOpened: boolean,
    correctSearchContext: boolean | null,
    tr: BrowserTrace,
    q: string,
    finalUrl: string | null,
    error: string | null = null,
    contextConfidence: string | null = null,
    resultsDiscovered: number | null = null,
    resultsVisited = 0,
    documents: any[] = []
  ): LegacySourceResult {
    const traversal = computeMygovTraversal({
      service176Opened,
      registryAppOpened,
      correctSearchContext: !!correctSearchContext,
      queryEntered: service176Opened,
      searchSubmitted: state !== 'SEARCH_CONTROL_NOT_FOUND' && state !== 'EXPLICIT_ACCESS_FAILURE',
      resultsDiscovered,
      resultsVisited,
      documentsRead: documents.length,
      captcha: state === 'WAITING_HUMAN',
      searchControlNotFound: state === 'SEARCH_CONTROL_NOT_FOUND',
      wrongSearchContext: state === 'WRONG_SEARCH_CONTEXT',
      submitFailed: state === 'SUBMIT_FAILED',
      failed: state === 'FAILED',
    });
    const legacyStatus = traversal.status;
    const workflowResult: WorkflowResult = {
      source: 'mygov',
      state,
      completed: state === 'MYGOV_EXHAUSTED',
      skipped: state === 'SKIPPED_HUMAN_VERIFICATION',
      discoveredItems: resultsDiscovered,
      visitedItems: resultsVisited,
      discoveredDocuments: resultsDiscovered || 0,
      readDocuments: documents.length,
      unvisitedRelevantItems: resultsDiscovered != null ? Math.max(0, resultsDiscovered - resultsVisited) : null,
      evidenceIds: [],
      trace: tr.all,
    };
    return {
      source: 'mygov',
      sourceName: SOURCE_META.name,
      sourceClass: SOURCE_META.class,
      sourceUrl: SOURCE_META.url,
      startUrl: SOURCE_META.url,
      finalUrl,
      frameUrls: [],
      searchControlUsed: null,
      queryEntered: service176Opened ? q : null,
      submitAction: null,
      contextConfidence,
      wrongSearchContext: state === 'WRONG_SEARCH_CONTEXT',
      resultContext: error || `MyGov FSM reached ${state}`,
      resultConfirmed: legacyStatus === 'SEARCH_CONFIRMED' || (legacyStatus === 'SOURCE_EXHAUSTED' && (resultsDiscovered || 0) > 0),
      noResultConfirmed: state === 'MYGOV_EXHAUSTED' && (resultsDiscovered === 0 || resultsDiscovered === null),
      resultValidated: legacyStatus !== 'WRONG_SEARCH_CONTEXT',
      status: legacyStatus === 'SOURCE_EXHAUSTED' ? ((resultsDiscovered || 0) > 0 ? 'SEARCH_CONFIRMED' : 'NO_RESULT_CONFIRMED') : legacyStatus,
      traversal,
      retrievedAt: new Date().toISOString(),
      documents,
      discoveredEntities: [],
      error,
      workflowResult,
    };
  }
}
