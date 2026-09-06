// MyGovWorkflow.ts — mandate Section 9's source that "must receive special
// attention because current production repeatedly enters the wrong
// context." 2026-09-06 "final alignment pass": rewritten to match the
// live-recorded real flow (napr-recording.spec.ts, repo root) exactly —
// https://my.gov.ge/ka-ge/services/10 -> click the real property-search
// link (SAME page, no popup) -> the naprweb Angular app renders into
// `#main-routing-container iframe` -> every subsequent step is a
// `.contentFrame()` locator against that ONE iframe, on the SAME page/tab
// the CAPTCHA lifecycle already tracks. WRONG_SEARCH_CONTEXT stays an
// OPERATIONAL error state — the source's own confirm/deny text is untrusted
// whenever the field used was only a low-confidence fallback guess, and
// CONFIRMED_ZERO_RESULTS/MYGOV_EXHAUSTED remain structurally unreachable
// from there (canMarkMygovExhausted, state/transitions.ts).
import type { Page, Frame } from 'playwright';
import { newMyGovFsm } from './MyGovState.js';
import { MyGovPage } from './MyGovPage.js';
import { canMarkMygovExhausted, assertCorrectSearchContext, assertPropertySearchContextConfirmed } from './assertions.js';
import { classifyDocumentLink } from '../../documents/DocumentReader.js';
import { readPdfDocument } from '../../documents/PdfDocumentReader.js';
import { readOnlineDocument } from '../../documents/OnlineDocumentReader.js';
import { text as pageText } from '../../browser/BrowserSession.js';
import { BrowserTrace } from '../../browser/BrowserTrace.js';
import { challenge } from '../../browser/BrowserSession.js';
import { computeMygovTraversal } from '../../state/transitions.js';
import type { EntityQueue } from '../../entities/EntityQueue.js';
import type { LegacySourceResult, WorkflowResult } from '../WorkflowResult.js';
import { MAX_DOCUMENTS_PER_APPLICATION } from './selectors.js';

const SOURCE_META = { name: 'NAPR — საჯარო რეესტრის ეროვნული სააგენტო (MY.GOV.GE სერვისი 10 → naprweb.reestri.gov.ge)', class: 'OFFICIAL_GOVERNMENT', url: 'https://my.gov.ge/ka-ge/services/10' };
const MAX_TOTAL_DOCS = 60;

export async function runMyGovWorkflow(page: Page, ctx: any, query: string, entities?: EntityQueue, opts: { skipGoto?: boolean } = {}): Promise<LegacySourceResult> {
  void ctx; // no longer opens a separate context/page — kept for call-site compatibility
  const fsm = newMyGovFsm();
  const trace = new BrowserTrace('mygov');
  const pageObj = new MyGovPage();

  try {
    if (!opts.skipGoto) await pageObj.goto(page);
    trace.record({ stateBefore: null, action: 'GOTO', target: SOURCE_META.url, actualOutcome: opts.skipGoto ? 'SKIPPED_RESUME' : 'NAVIGATED', stateAfter: null, url: (page as any).url() });
    fsm.transition('SERVICE_176_OPENED');
    trace.record({ stateBefore: 'START', action: 'STATE', actualOutcome: 'SERVICE_176_OPENED', stateAfter: fsm.state, url: (page as any).url() });

    if (!opts.skipGoto) {
      const linkRes = await pageObj.openPropertySearchLink(page);
      trace.record({ stateBefore: fsm.state, action: 'OPEN_PROPERTY_SEARCH_LINK', actualOutcome: linkRes.clicked ? 'CLICKED' : 'LINK_NOT_FOUND', stateAfter: fsm.state, url: (page as any).url() });
    }
    fsm.transition('SERVICE_APPLICATION_DISCOVERED');

    // The naprweb app renders into #main-routing-container iframe ON THE
    // SAME PAGE — never a separate page opened to the iframe's raw src
    // (the confirmed production mismatch this pass fixes).
    const frame: Frame | null = await pageObj.resolveRegistryFrame(page);
    const registryAppOpened = !!frame;
    trace.record({ stateBefore: fsm.state, action: 'RESOLVE_REGISTRY_FRAME', actualOutcome: registryAppOpened ? 'FRAME_RESOLVED' : 'FRAME_NOT_FOUND', stateAfter: fsm.state, url: (page as any).url() });
    if (!registryAppOpened || !frame) {
      fsm.transition('SEARCH_CONTROL_NOT_FOUND');
      return buildResult('SEARCH_CONTROL_NOT_FOUND', false, false, null, trace, query, (page as any).url(), 'naprweb registry app (#main-routing-container iframe) not reached');
    }
    fsm.transition('REGISTRY_APPLICATION_OPENED');

    if (!assertPropertySearchContextConfirmed(true, registryAppOpened)) {
      fsm.transition('SEARCH_CONTROL_NOT_FOUND');
      trace.record({ stateBefore: 'REGISTRY_APPLICATION_OPENED', action: 'ASSERT', target: 'assertPropertySearchContextConfirmed', actualOutcome: 'FAILED', stateAfter: fsm.state, url: (page as any).url() });
      return buildResult('SEARCH_CONTROL_NOT_FOUND', true, registryAppOpened, null, trace, query, (page as any).url(), 'registry application never opened');
    }

    // Inside the naprweb frame the whole document IS the registry's own
    // single-purpose search UI, so a broad candidate scan is safe if the
    // known-good hints (#input_5 / ng-model) don't match.
    const searchRes = await pageObj.searchCadastral(frame, query, { allowGenericFallback: true });
    const correctContext = assertCorrectSearchContext(searchRes.contextConfidence || null);
    trace.record({
      stateBefore: fsm.state,
      action: 'SEARCH_FIELD_USED',
      target: searchRes.found ? `contextConfidence=${searchRes.contextConfidence || 'unknown'}` : null,
      actualOutcome: searchRes.found ? (correctContext ? 'TRUSTED_FIELD' : 'LOW_CONFIDENCE_FIELD') : 'NO_FIELD_FOUND',
      stateAfter: fsm.state,
      url: (page as any).url(),
    });
    if (!searchRes.found) {
      fsm.transition('SEARCH_CONTROL_NOT_FOUND');
      return buildResult('SEARCH_CONTROL_NOT_FOUND', true, registryAppOpened, null, trace, query, (page as any).url(), 'no field found even inside the registry frame');
    }

    if (!correctContext) {
      const capBeforeSubmit = await challenge(page);
      if (capBeforeSubmit) {
        fsm.transition('WAITING_HUMAN', 'captcha detected while search context was still unconfirmed');
        return buildResult('WAITING_HUMAN', true, registryAppOpened, false, trace, query, (page as any).url(), null, searchRes.contextConfidence || null);
      }
      fsm.transition('WRONG_SEARCH_CONTEXT', `the field used was only located by a low-confidence fallback scan (contextConfidence=${searchRes.contextConfidence || 'unknown'})`);
      return buildResult(
        'WRONG_SEARCH_CONTEXT',
        true,
        registryAppOpened,
        false,
        trace,
        query,
        (page as any).url(),
        `the field used was only located by a low-confidence fallback scan (contextConfidence=${searchRes.contextConfidence || 'unknown'})`,
        searchRes.contextConfidence || null
      );
    }

    fsm.transition('PROPERTY_SEARCH_CONTEXT_CONFIRMED');
    fsm.transition('CADASTRAL_INPUT_FOUND');
    fsm.transition('CADASTRAL_ENTERED');
    // Belt-and-suspenders explicit click by the exact recorded label, in
    // case interact()'s own generic submit click did not already fire it.
    if (!searchRes.submitted) await pageObj.clickApplicationSearchButton(frame);
    fsm.transition('SEARCH_SUBMITTED', searchRes.submitAction ? `submitted via ${searchRes.submitAction}` : undefined);
    fsm.transition('POST_SEARCH_STATE');

    const cap = await challenge(page);
    trace.record({ stateBefore: 'POST_SEARCH_STATE', action: 'CAPTCHA_CHECK', actualOutcome: cap ? 'CAPTCHA_DETECTED' : 'NO_CAPTCHA', stateAfter: fsm.state, url: (page as any).url() });
    if (cap) {
      fsm.transition('HUMAN_VERIFICATION_REQUIRED');
      fsm.transition('WAITING_HUMAN');
      return buildResult('WAITING_HUMAN', true, registryAppOpened, correctContext, trace, query, (page as any).url(), null, searchRes.contextConfidence || null);
    }

    if (!searchRes.resultChanged) {
      fsm.transition('EXPLICIT_ACCESS_FAILURE', 'no new result signal after submit');
      return buildResult('SUBMIT_FAILED', true, registryAppOpened, true, trace, query, (page as any).url(), 'search submitted but no new result signal appeared');
    }

    const noResultConfirmed = /ვერ\s*მოიძებნა|not\s*found|no\s*results?/i.test(searchRes.resultText || '');
    if (noResultConfirmed) {
      fsm.transition('CONFIRMED_ZERO_RESULTS');
      fsm.transition('MYGOV_EXHAUSTED');
      return buildResult('MYGOV_EXHAUSTED', true, registryAppOpened, true, trace, query, (page as any).url(), null, searchRes.contextConfidence || null, 0);
    }

    fsm.transition('RESULTS_RETURNED');

    // Dynamic per-application, per-document traversal — never a fixed
    // application-number or document list (mandate: the recording's
    // "განცხადება 892024345197" / "მომზადებული დოკუმენტი: ..." labels are
    // per-search/per-run text, not stable identifiers).
    const applications = await pageObj.enumerateApplications(frame);
    trace.record({ stateBefore: 'RESULTS_RETURNED', action: 'ENUMERATE_APPLICATIONS', actualOutcome: `discovered=${applications.length}`, stateAfter: fsm.state, url: (page as any).url() });

    const documents: any[] = [];
    let applicationsVisited = 0;
    const skippedReasons: { label: string; reason: string }[] = [];
    for (const app of applications) {
      if (documents.length >= MAX_TOTAL_DOCS) {
        skippedReasons.push({ label: app.label, reason: 'MAX_TOTAL_DOCS_REACHED' });
        continue;
      }
      const opened = await pageObj.openApplication(frame, app.label);
      trace.record({ stateBefore: fsm.state, action: 'OPEN_APPLICATION', target: app.label, actualOutcome: opened ? 'OPENED' : 'CLICK_FAILED', stateAfter: fsm.state, url: (page as any).url() });
      if (!opened) {
        skippedReasons.push({ label: app.label, reason: 'OPEN_FAILED' });
        continue;
      }
      // The real Google reCAPTCHA gate most often appears here (recording:
      // right after the first application is opened) — left entirely to
      // the existing challenge()/WAITING_HUMAN lifecycle, never solved
      // here. Resuming re-enters this same loop on the same, now-verified
      // page/frame, so an already-cleared application is simply re-opened
      // (idempotent) and its documents enumerated normally.
      const capAtApp = await challenge(page);
      if (capAtApp) {
        fsm.transition('WAITING_HUMAN', `captcha detected opening application ${app.label}`);
        return buildResult(
          'WAITING_HUMAN',
          true,
          registryAppOpened,
          true,
          trace,
          query,
          (page as any).url(),
          null,
          searchRes.contextConfidence || null,
          applications.length,
          applicationsVisited,
          documents
        );
      }
      applicationsVisited++;
      const docButtons = await pageObj.enumeratePreparedDocuments(frame);
      let docsThisApp = 0;
      for (const docBtn of docButtons) {
        if (docsThisApp >= MAX_DOCUMENTS_PER_APPLICATION || documents.length >= MAX_TOTAL_DOCS) break;
        const popup = await pageObj.openPreparedDocument(page, frame, docBtn.label);
        if (!popup) {
          skippedReasons.push({ label: `${app.label} — ${docBtn.label}`, reason: 'DOCUMENT_POPUP_DID_NOT_OPEN' });
          continue;
        }
        const url = popup.url();
        const cls = classifyDocumentLink({ url, label: docBtn.label }, { pageUrl: url });
        const doc = cls.looksLikeDirectFile ? await readPdfDocument(popup, { url, label: docBtn.label }, 'mygov_prepared_document') : await readOnlineDocument(popup, { url, label: docBtn.label }, 'mygov_prepared_document');
        await popup.close().catch(() => {});
        if (doc?.rawText && doc.rawText.trim().length > 20) {
          documents.push({ url: doc.url, label: docBtn.label, rawText: doc.rawText.slice(0, 50000), source: 'mygov_prepared_document', complete: !!doc.complete, documentType: doc.documentType || (cls.looksLikeDirectFile ? 'PDF_DOCUMENT' : 'ONLINE_DOCUMENT'), pagesRead: doc.pagesRead || 0, pageCount: doc.pageCount || 0 });
          docsThisApp++;
        } else {
          skippedReasons.push({ label: `${app.label} — ${docBtn.label}`, reason: 'DOCUMENT_PRODUCED_NO_TEXT' });
        }
      }
      if (docButtons.length === 0) {
        // The application's own detail text is still real evidence even
        // when it exposes no separately-downloadable document.
        const detailText = await pageText(frame as any).catch(() => '');
        if (detailText && detailText.trim().length > 20) documents.push({ url: (page as any).url(), label: app.label, rawText: detailText.slice(0, 50000), source: 'mygov_application_detail', complete: true, documentType: 'ONLINE_DOCUMENT', pagesRead: 1, pageCount: 1 });
      }
    }

    for (const skip of skippedReasons) trace.record({ stateBefore: fsm.state, action: 'ROW_SKIPPED', target: skip.label, actualOutcome: skip.reason, stateAfter: fsm.state });
    for (const d of documents) if (entities && d.rawText) entities.scanText(d.rawText, { source: 'mygov', sourceDocument: d.url, retrievedAt: new Date().toISOString() });

    fsm.transition('RESULTS_ENUMERATED', `${applications.length} application(s) found`);
    const invariant = { service176Opened: true, registryAppOpened, correctSearchContext: true, queryEntered: true, searchSubmitted: true, resultsDiscovered: applications.length, resultsVisited: applicationsVisited, documentsRead: documents.length };
    fsm.transition('RESULTS_TRAVERSED');
    const exhausted = canMarkMygovExhausted(invariant);
    trace.record({ stateBefore: 'RESULTS_TRAVERSED', action: 'GATE', target: 'canMarkMygovExhausted', actualOutcome: exhausted ? 'MYGOV_EXHAUSTED' : 'BLOCKED_BY_canMarkMygovExhausted', expectedOutcome: 'MYGOV_EXHAUSTED', stateAfter: fsm.state });
    if (exhausted) fsm.transition('MYGOV_EXHAUSTED');

    return buildResult(fsm.state, true, registryAppOpened, true, trace, query, (page as any).url(), null, searchRes.contextConfidence || null, applications.length, applicationsVisited, documents);
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
