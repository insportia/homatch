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
    trace.record({ stateBefore: null, action: 'GOTO', target: SOURCE_META.url, actualOutcome: opts.skipGoto ? 'SKIPPED_RESUME' : 'NAVIGATED', stateAfter: null, url: (page as any).url() });
    fsm.transition('SERVICE_176_OPENED');
    trace.record({ stateBefore: 'START', action: 'STATE', actualOutcome: 'SERVICE_176_OPENED', stateAfter: fsm.state, url: (page as any).url() });

    // Try the service page's own known-good field first — only when THAT
    // fails do we go looking for the naprweb registry iframe. Either way,
    // "SERVICE_APPLICATION_DISCOVERED" means we found SOMETHING worth
    // trying next, not that it was the right context yet (that assertion
    // comes later, at PROPERTY_SEARCH_CONTEXT_CONFIRMED).
    // v22 fix: no generic fallback scan on the outer service page — a weak
    // match there (e.g. my.gov.ge's own site-wide header search box) must
    // never short-circuit registry-iframe discovery. See MyGovPage.
    // searchCadastral's comment for the full root-cause trail.
    let searchRes = await pageObj.searchCadastral(page, query, { allowGenericFallback: false });
    let activePage: Page = page;
    let registryAppOpened = false;
    let usedIframe = false;

    if (!searchRes.found) {
      fsm.transition('SERVICE_APPLICATION_DISCOVERED', 'no field on the top-level service page — polling for the naprweb iframe');
      trace.record({ stateBefore: 'SERVICE_176_OPENED', action: 'SEARCH_FIELD_PROBE', actualOutcome: 'NOT_FOUND_ON_SERVICE_PAGE', stateAfter: fsm.state, url: (page as any).url() });
      const reg = await pageObj.openRegistryApplication(page, ctx);
      registryAppOpened = reg.registryAppOpened;
      usedIframe = true;
      trace.record({
        stateBefore: fsm.state,
        action: 'REGISTRY_IFRAME_DISCOVERY',
        actualOutcome: reg.registryAppOpened ? 'IFRAME_FOUND_AND_OPENED' : 'IFRAME_NOT_FOUND',
        stateAfter: fsm.state,
        url: reg.activePage ? (reg.activePage as any).url() : null,
      });
      if (!reg.registryAppOpened || !reg.activePage) {
        fsm.transition('SEARCH_CONTROL_NOT_FOUND');
        trace.record({ stateBefore: 'SERVICE_APPLICATION_DISCOVERED', action: 'STATE', actualOutcome: 'SEARCH_CONTROL_NOT_FOUND', stateAfter: fsm.state, url: (page as any).url() });
        return buildResult('SEARCH_CONTROL_NOT_FOUND', false, false, null, trace, query, null, 'naprweb registry app not reached');
      }
      activePage = reg.activePage;
      fsm.transition('REGISTRY_APPLICATION_OPENED');
      // Now genuinely inside the naprweb registry app — a broad candidate
      // scan here is safe (single-purpose page), so the generic fallback is
      // allowed on this second attempt only.
      searchRes = await pageObj.searchCadastral(activePage, query, { allowGenericFallback: true });
    } else {
      registryAppOpened = true;
      fsm.transition('SERVICE_APPLICATION_DISCOVERED');
      fsm.transition('REGISTRY_APPLICATION_OPENED', 'top-level service page itself carried the cadastral field');
    }
    trace.record({
      stateBefore: 'SERVICE_APPLICATION_DISCOVERED',
      action: 'STATE',
      actualOutcome: 'REGISTRY_APPLICATION_OPENED',
      stateAfter: fsm.state,
      url: (activePage as any).url(),
      target: usedIframe ? 'naprweb.reestri.gov.ge (via Service 176 iframe)' : 'my.gov.ge service 176 page itself',
    });

    if (!assertPropertySearchContextConfirmed(true, registryAppOpened)) {
      // Not reachable today (both branches above already guarantee
      // registryAppOpened===true by the time we get here, or return early)
      // — kept as a real, LEGAL transition rather than a latent crash so a
      // future change to assertPropertySearchContextConfirmed can't silently
      // reintroduce the IllegalTransitionError this file used to throw here.
      fsm.transition('SEARCH_CONTROL_NOT_FOUND');
      trace.record({ stateBefore: 'REGISTRY_APPLICATION_OPENED', action: 'ASSERT', target: 'assertPropertySearchContextConfirmed', actualOutcome: 'FAILED', stateAfter: fsm.state, url: (activePage as any).url() });
      return buildResult('SEARCH_CONTROL_NOT_FOUND', true, registryAppOpened, null, trace, query, (activePage as any).url(), 'registry application never opened');
    }

    const correctContext = assertCorrectSearchContext(searchRes.contextConfidence || null);
    trace.record({
      stateBefore: fsm.state,
      action: 'SEARCH_FIELD_USED',
      target: searchRes.found ? `contextConfidence=${searchRes.contextConfidence || 'unknown'}` : null,
      actualOutcome: searchRes.found ? (correctContext ? 'TRUSTED_FIELD' : 'LOW_CONFIDENCE_FIELD') : 'NO_FIELD_FOUND',
      stateAfter: fsm.state,
      url: (activePage as any).url(),
    });
    if (!searchRes.found) {
      fsm.transition('SEARCH_CONTROL_NOT_FOUND');
      return buildResult('SEARCH_CONTROL_NOT_FOUND', true, registryAppOpened, null, trace, query, (activePage as any).url(), 'no field found even inside the registry app');
    }

    // A weak/generic candidate-scan field (correctContext===false) must NOT
    // be walked through the trusted happy-path states
    // (PROPERTY_SEARCH_CONTEXT_CONFIRMED -> CADASTRAL_INPUT_FOUND ->
    // CADASTRAL_ENTERED -> SEARCH_SUBMITTED -> POST_SEARCH_STATE) at all —
    // those states assert a context we do not actually trust. It goes
    // straight to the generic WRONG_SEARCH_CONTEXT operational status
    // instead (legal from REGISTRY_APPLICATION_OPENED — see
    // MyGovState.ts's attachOperational). This replaces the old code path
    // that tried `fsm.transition('SEARCH_SUBMITTED', ...)` directly from
    // REGISTRY_APPLICATION_OPENED, which is not a declared edge and threw
    // IllegalTransitionError on every low-confidence-context run (the
    // confirmed cause of this source's production FAILED/trace:[] result).
    if (!correctContext) {
      const capBeforeSubmit = await challenge(activePage);
      if (capBeforeSubmit) {
        fsm.transition('WAITING_HUMAN', 'captcha detected while search context was still unconfirmed');
        trace.record({ stateBefore: 'REGISTRY_APPLICATION_OPENED', action: 'CAPTCHA_CHECK', actualOutcome: 'CAPTCHA_DETECTED', stateAfter: fsm.state, url: (activePage as any).url() });
        return buildResult('WAITING_HUMAN', true, registryAppOpened, false, trace, query, (activePage as any).url(), null, searchRes.contextConfidence || null);
      }
      fsm.transition('WRONG_SEARCH_CONTEXT', `the field used was only located by a low-confidence fallback scan (contextConfidence=${searchRes.contextConfidence || 'unknown'})`);
      trace.record({
        stateBefore: 'REGISTRY_APPLICATION_OPENED',
        action: 'STATE',
        actualOutcome: 'WRONG_SEARCH_CONTEXT',
        stateAfter: fsm.state,
        url: (activePage as any).url(),
        target: `contextConfidence=${searchRes.contextConfidence || 'unknown'}`,
      });
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

    // PROPERTY_SEARCH_CONTEXT_CONFIRMED is only reached with a trusted
    // field — the direct fix for "a generic candidate guess produced a
    // confident false NO_RESULT with no CAPTCHA ever appearing."
    fsm.transition('PROPERTY_SEARCH_CONTEXT_CONFIRMED');
    fsm.transition('CADASTRAL_INPUT_FOUND');
    fsm.transition('CADASTRAL_ENTERED');
    trace.record({ stateBefore: 'REGISTRY_APPLICATION_OPENED', action: 'CADASTRAL_ENTERED', target: query, actualOutcome: 'FILLED', stateAfter: fsm.state, url: (activePage as any).url() });
    fsm.transition('SEARCH_SUBMITTED', searchRes.submitAction ? `submitted via ${searchRes.submitAction}` : undefined);
    trace.record({ stateBefore: 'CADASTRAL_ENTERED', action: 'SEARCH_SUBMITTED', actualOutcome: searchRes.submitted ? 'SUBMITTED' : 'SUBMIT_UNCONFIRMED', stateAfter: fsm.state, url: (activePage as any).url() });
    fsm.transition('POST_SEARCH_STATE');

    const cap = await challenge(activePage);
    trace.record({ stateBefore: 'POST_SEARCH_STATE', action: 'CAPTCHA_CHECK', actualOutcome: cap ? 'CAPTCHA_DETECTED' : 'NO_CAPTCHA', stateAfter: fsm.state, url: (activePage as any).url() });
    if (cap) {
      fsm.transition('HUMAN_VERIFICATION_REQUIRED');
      fsm.transition('WAITING_HUMAN');
      return buildResult('WAITING_HUMAN', true, registryAppOpened, correctContext, trace, query, (activePage as any).url(), null, searchRes.contextConfidence || null);
    }

    if (!searchRes.resultChanged) {
      fsm.transition('EXPLICIT_ACCESS_FAILURE', 'no new result signal after submit');
      trace.record({ stateBefore: 'POST_SEARCH_STATE', action: 'RESULT_SIGNAL', actualOutcome: 'NO_CHANGE_AFTER_SUBMIT', stateAfter: fsm.state, url: (activePage as any).url() });
      return buildResult('SUBMIT_FAILED', true, registryAppOpened, true, trace, query, (activePage as any).url(), 'search submitted but no new result signal appeared');
    }

    const noResultConfirmed = /ვერ\s*მოიძებნა|not\s*found|no\s*results?/i.test(searchRes.resultText || '');
    trace.record({ stateBefore: 'POST_SEARCH_STATE', action: 'RESULT_SIGNAL', actualOutcome: noResultConfirmed ? 'CONFIRMED_ZERO_RESULTS' : 'RESULTS_RETURNED', stateAfter: fsm.state, url: (activePage as any).url() });
    if (noResultConfirmed) {
      fsm.transition('CONFIRMED_ZERO_RESULTS');
      fsm.transition('MYGOV_EXHAUSTED');
      return buildResult('MYGOV_EXHAUSTED', true, registryAppOpened, true, trace, query, (activePage as any).url(), null, searchRes.contextConfidence || null, 0);
    }

    fsm.transition('RESULTS_RETURNED');
    const exhaustion = await exhaustResultRows(activePage, 'mygov');
    fsm.transition('RESULTS_ENUMERATED', `${exhaustion.rowsDiscoveredBySelector} row(s) found`);
    trace.record({
      stateBefore: 'RESULTS_RETURNED',
      action: 'RESULTS_ENUMERATED',
      actualOutcome: `strategy=${exhaustion.rowStrategy} discovered=${exhaustion.rowsDiscoveredBySelector} visited=${exhaustion.rowsVisited} documents=${exhaustion.rowDocuments.length}`,
      stateAfter: fsm.state,
      url: (activePage as any).url(),
    });
    for (const skip of exhaustion.skippedReasons) trace.record({ stateBefore: fsm.state, action: 'ROW_SKIPPED', target: skip.label, actualOutcome: skip.reason, stateAfter: fsm.state });
    for (const d of exhaustion.rowDocuments) if (entities && d.rawText) entities.scanText(d.rawText, { source: 'mygov', sourceDocument: d.url, retrievedAt: new Date().toISOString() });
    const invariant = { service176Opened: true, registryAppOpened, correctSearchContext: true, queryEntered: true, searchSubmitted: true, resultsDiscovered: exhaustion.rowsDiscoveredBySelector, resultsVisited: exhaustion.rowsVisited, documentsRead: exhaustion.rowDocuments.length };
    fsm.transition('RESULTS_TRAVERSED');
    const exhausted = canMarkMygovExhausted(invariant);
    trace.record({ stateBefore: 'RESULTS_TRAVERSED', action: 'GATE', target: 'canMarkMygovExhausted', actualOutcome: exhausted ? 'MYGOV_EXHAUSTED' : 'BLOCKED_BY_canMarkMygovExhausted', expectedOutcome: 'MYGOV_EXHAUSTED', stateAfter: fsm.state });
    if (exhausted) fsm.transition('MYGOV_EXHAUSTED');

    return buildResult(fsm.state, true, registryAppOpened, true, trace, query, (activePage as any).url(), null, searchRes.contextConfidence || null, exhaustion.rowsDiscoveredBySelector, exhaustion.rowsVisited, exhaustion.rowDocuments);
  } catch (e) {
    trace.record({ stateBefore: fsm.state, action: 'EXCEPTION', actualOutcome: String(e).slice(0, 300), stateAfter: 'FAILED' });
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
