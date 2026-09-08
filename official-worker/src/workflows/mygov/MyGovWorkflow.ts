// MyGovWorkflow.ts — deterministic Service 176 / NAPR workflow.
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
import { MAX_DOCUMENTS_PER_APPLICATION, MYGOV_DIRECT_SERVICE_URL } from './selectors.js';

const SOURCE_META = {
  name: 'Official Government Sources',
  class: 'OFFICIAL_GOVERNMENT',
  url: 'https://my.gov.ge/ka-ge/services/10/service/176',
};
const MAX_TOTAL_DOCS = 60;

export async function runMyGovWorkflow(
  page: Page,
  ctx: any,
  query: string,
  entities?: EntityQueue,
  opts: { skipGoto?: boolean } = {}
): Promise<LegacySourceResult> {
  void ctx;
  const fsm = newMyGovFsm();
  const trace = new BrowserTrace('mygov');
  const pageObj = new MyGovPage();

  try {
    let frame: Frame | null = null;

    if (!opts.skipGoto) {
      await pageObj.gotoDirectService176(page);
      trace.record({
        stateBefore: null,
        action: 'GOTO',
        target: MYGOV_DIRECT_SERVICE_URL,
        actualOutcome: 'NAVIGATED_DIRECT',
        stateAfter: null,
        url: (page as any).url(),
      });

      /*
       * Use resolveRegistryFrame's OWN documented default (30s), not a
       * shorter override.
       *
       * Live inspection of service 176 (2026-09-09) shows the page loads an
       * INVISIBLE reCAPTCHA (sitekey 6LevnRsrAAAA…, size=invisible) and the
       * registry application is an iframe at
       * naprweb.reestri.gov.ge/_dea/#/search that only becomes usable once
       * that challenge has executed. Google's declared readiness window for
       * it is up to 20-30s — which is exactly why the default is 30s.
       *
       * The previous 10000ms override was BELOW that window, so a slow (or
       * datacenter-throttled) reCAPTCHA made the frame look absent and the
       * source reported SEARCH_CONTROL_NOT_FOUND with zero documents — the
       * outcome recorded in production job
       * 3aa36828-471a-4cd0-8a46-4e3f2b4c4c92 ("registry application not
       * reached", finalUrl == sourceUrl, searchControlUsed null).
       *
       * NOTE: the service URL's category segment is NOT the issue. Live
       * comparison of /services/5/service/176 and /services/10/service/176
       * produced byte-identical pages, the same iframes and the same
       * api.my.gov.ge/api/service/getServiceDetails?serviceId=176 call — the
       * SPA resolves the service by id, not by the path segment.
       */
      frame = await pageObj.resolveRegistryFrame(page);
      trace.record({
        stateBefore: null,
        action: 'RESOLVE_REGISTRY_FRAME',
        target: 'direct-link attempt',
        actualOutcome: frame ? 'FRAME_RESOLVED' : 'FRAME_NOT_FOUND',
        stateAfter: null,
        url: (page as any).url(),
      });

      if (!frame) {
        await pageObj.goto(page);
        trace.record({
          stateBefore: null,
          action: 'GOTO',
          target: SOURCE_META.url,
          actualOutcome: 'NAVIGATED_FALLBACK_GROUP_PAGE',
          stateAfter: null,
          url: (page as any).url(),
        });
        const linkRes = await pageObj.openPropertySearchLink(page);
        trace.record({
          stateBefore: null,
          action: 'OPEN_PROPERTY_SEARCH_LINK',
          actualOutcome: linkRes.clicked ? 'CLICKED' : 'LINK_NOT_FOUND',
          stateAfter: null,
          url: (page as any).url(),
        });
      }
    }

    fsm.transition('SERVICE_176_OPENED');
    trace.record({
      stateBefore: 'START',
      action: 'STATE',
      actualOutcome: 'SERVICE_176_OPENED',
      stateAfter: fsm.state,
      url: (page as any).url(),
    });
    fsm.transition('SERVICE_APPLICATION_DISCOVERED');

    if (!frame) frame = await pageObj.resolveRegistryFrame(page);
    const registryAppOpened = !!frame;

    trace.record({
      stateBefore: fsm.state,
      action: 'RESOLVE_REGISTRY_FRAME',
      actualOutcome: registryAppOpened ? 'FRAME_RESOLVED' : 'FRAME_NOT_FOUND',
      stateAfter: fsm.state,
      url: (page as any).url(),
    });

    if (!registryAppOpened || !frame) {
      fsm.transition('SEARCH_CONTROL_NOT_FOUND');
      return buildResult(
        'SEARCH_CONTROL_NOT_FOUND',
        false,
        false,
        null,
        trace,
        query,
        (page as any).url(),
        'registry application not reached'
      );
    }

    fsm.transition('REGISTRY_APPLICATION_OPENED');

    if (!assertPropertySearchContextConfirmed(true, registryAppOpened)) {
      fsm.transition('SEARCH_CONTROL_NOT_FOUND');
      return buildResult(
        'SEARCH_CONTROL_NOT_FOUND',
        true,
        registryAppOpened,
        null,
        trace,
        query,
        (page as any).url(),
        'registry application never opened'
      );
    }

    /*
     * LIVE-PROVEN CAPTCHA RESUME FIX (2026-09-07)
     *
     * After the human solves reCAPTCHA, Google may leave the CAPTCHA widget
     * mounted. The registry, however, has already advanced and exposes the
     * exact prepared-document control:
     *   button[ng-click="navigateTo(edoc.BLOB_URI)"]
     *   aria-label="მომზადებული დოკუმენტი: ამონაწერი საჯარო რეესტრიდან"
     *
     * On resume we therefore do NOT restart the cadastral search and do NOT
     * wait for the old CAPTCHA iframe to disappear. If the prepared extract
     * is visible, continue from the current application detail in the SAME
     * browser/context/session and read its documents immediately.
     */
    if (opts.skipGoto && (await pageObj.preparedExtractReady(frame))) {
      trace.record({
        stateBefore: fsm.state,
        action: 'HUMAN_RESUME_SIGNAL',
        target: 'prepared public-registry extract',
        actualOutcome: 'DOCUMENT_CONTROL_VISIBLE',
        stateAfter: fsm.state,
        url: (page as any).url(),
      });

      const documents = await readCurrentPreparedDocuments(page, frame, pageObj, entities, trace);
      return buildResult(
        'MYGOV_EXHAUSTED',
        true,
        true,
        true,
        trace,
        query,
        (page as any).url(),
        null,
        'EXACT_RECORDED_CONTROL',
        1,
        1,
        documents
      );
    }

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
      return buildResult(
        'SEARCH_CONTROL_NOT_FOUND',
        true,
        registryAppOpened,
        null,
        trace,
        query,
        (page as any).url(),
        'no cadastral field found inside registry application'
      );
    }

    if (!correctContext) {
      const capBeforeSubmit = await challenge(page);
      if (capBeforeSubmit) {
        fsm.transition('WAITING_HUMAN', 'captcha detected while search context was still unconfirmed');
        return buildResult(
          'WAITING_HUMAN',
          true,
          registryAppOpened,
          false,
          trace,
          query,
          (page as any).url(),
          null,
          searchRes.contextConfidence || null
        );
      }

      fsm.transition(
        'WRONG_SEARCH_CONTEXT',
        `the field used was only located by a low-confidence fallback scan (contextConfidence=${searchRes.contextConfidence || 'unknown'})`
      );
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

    if (!searchRes.submitted) await pageObj.clickApplicationSearchButton(frame);

    fsm.transition('SEARCH_SUBMITTED', searchRes.submitAction ? `submitted via ${searchRes.submitAction}` : undefined);
    fsm.transition('POST_SEARCH_STATE');

    const cap = await challenge(page);
    trace.record({
      stateBefore: 'POST_SEARCH_STATE',
      action: 'CAPTCHA_CHECK',
      actualOutcome: cap ? 'CAPTCHA_DETECTED' : 'NO_CAPTCHA',
      stateAfter: fsm.state,
      url: (page as any).url(),
    });

    if (cap) {
      fsm.transition('HUMAN_VERIFICATION_REQUIRED');
      fsm.transition('WAITING_HUMAN');
      return buildResult(
        'WAITING_HUMAN',
        true,
        registryAppOpened,
        correctContext,
        trace,
        query,
        (page as any).url(),
        null,
        searchRes.contextConfidence || null
      );
    }

    if (!searchRes.resultChanged) {
      fsm.transition('EXPLICIT_ACCESS_FAILURE', 'no new result signal after submit');
      return buildResult(
        'SUBMIT_FAILED',
        true,
        registryAppOpened,
        true,
        trace,
        query,
        (page as any).url(),
        'search submitted but no new result signal appeared'
      );
    }

    const noResultConfirmed = /ვერ\s*მოიძებნა|not\s*found|no\s*results?/i.test(searchRes.resultText || '');
    if (noResultConfirmed) {
      fsm.transition('CONFIRMED_ZERO_RESULTS');
      fsm.transition('MYGOV_EXHAUSTED');
      return buildResult(
        'MYGOV_EXHAUSTED',
        true,
        registryAppOpened,
        true,
        trace,
        query,
        (page as any).url(),
        null,
        searchRes.contextConfidence || null,
        0
      );
    }

    fsm.transition('RESULTS_RETURNED');

    const applications = await pageObj.enumerateApplications(frame);
    trace.record({
      stateBefore: 'RESULTS_RETURNED',
      action: 'ENUMERATE_APPLICATIONS',
      actualOutcome: `discovered=${applications.length}`,
      stateAfter: fsm.state,
      url: (page as any).url(),
    });

    const documents: any[] = [];
    let applicationsVisited = 0;
    const skippedReasons: { label: string; reason: string }[] = [];

    for (const app of applications) {
      if (documents.length >= MAX_TOTAL_DOCS) {
        skippedReasons.push({ label: app.label, reason: 'MAX_TOTAL_DOCS_REACHED' });
        continue;
      }

      const opened = await pageObj.openApplication(frame, app.label);
      trace.record({
        stateBefore: fsm.state,
        action: 'OPEN_APPLICATION',
        target: app.label,
        actualOutcome: opened ? 'OPENED' : 'CLICK_FAILED',
        stateAfter: fsm.state,
        url: (page as any).url(),
      });

      if (!opened) {
        skippedReasons.push({ label: app.label, reason: 'OPEN_FAILED' });
        continue;
      }

      const preparedReady = await pageObj.preparedExtractReady(frame);
      const capAtApp = preparedReady ? false : await challenge(page);

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

        const doc = await openAndReadPreparedDocument(page, frame, pageObj, docBtn.label);
        if (!doc) {
          skippedReasons.push({
            label: `${app.label} — ${docBtn.label}`,
            reason: 'DOCUMENT_DID_NOT_OPEN_OR_PRODUCED_NO_TEXT',
          });
          continue;
        }

        documents.push(doc);
        docsThisApp++;
      }

      if (docButtons.length === 0) {
        const detailText = await pageText(frame as any).catch(() => '');
        if (detailText && detailText.trim().length > 20) {
          documents.push({
            url: (page as any).url(),
            label: app.label,
            rawText: detailText.slice(0, 50000),
            source: 'mygov_application_detail',
            complete: true,
            documentType: 'ONLINE_DOCUMENT',
            pagesRead: 1,
            pageCount: 1,
          });
        }
      }
    }

    for (const skip of skippedReasons) {
      trace.record({
        stateBefore: fsm.state,
        action: 'ROW_SKIPPED',
        target: skip.label,
        actualOutcome: skip.reason,
        stateAfter: fsm.state,
      });
    }

    for (const d of documents) {
      if (entities && d.rawText) {
        entities.scanText(d.rawText, {
          source: 'mygov',
          sourceDocument: d.url,
          retrievedAt: new Date().toISOString(),
        });
      }
    }

    fsm.transition('RESULTS_ENUMERATED', `${applications.length} application(s) found`);
    const invariant = {
      service176Opened: true,
      registryAppOpened,
      correctSearchContext: true,
      queryEntered: true,
      searchSubmitted: true,
      resultsDiscovered: applications.length,
      resultsVisited: applicationsVisited,
      documentsRead: documents.length,
    };

    fsm.transition('RESULTS_TRAVERSED');
    const exhausted = canMarkMygovExhausted(invariant);
    trace.record({
      stateBefore: 'RESULTS_TRAVERSED',
      action: 'GATE',
      target: 'canMarkMygovExhausted',
      actualOutcome: exhausted ? 'MYGOV_EXHAUSTED' : 'BLOCKED_BY_canMarkMygovExhausted',
      expectedOutcome: 'MYGOV_EXHAUSTED',
      stateAfter: fsm.state,
    });
    if (exhausted) fsm.transition('MYGOV_EXHAUSTED');

    return buildResult(
      fsm.state,
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
  } catch (e) {
    trace.record({
      stateBefore: fsm.state,
      action: 'EXCEPTION',
      actualOutcome: String(e).slice(0, 300),
      stateAfter: 'FAILED',
    });
    return buildResult('FAILED', false, false, null, trace, query, null, String(e));
  }

  async function readCurrentPreparedDocuments(
    currentPage: Page,
    currentFrame: Frame,
    myGovPage: MyGovPage,
    entityQueue: EntityQueue | undefined,
    tr: BrowserTrace
  ): Promise<any[]> {
    const buttons = await myGovPage.enumeratePreparedDocuments(currentFrame);
    const docs: any[] = [];

    for (const button of buttons.slice(0, MAX_DOCUMENTS_PER_APPLICATION)) {
      const doc = await openAndReadPreparedDocument(currentPage, currentFrame, myGovPage, button.label);
      if (!doc) {
        tr.record({
          stateBefore: 'REGISTRY_APPLICATION_OPENED',
          action: 'DOCUMENT_SKIPPED',
          target: button.label,
          actualOutcome: 'DID_NOT_OPEN_OR_NO_TEXT',
          stateAfter: 'REGISTRY_APPLICATION_OPENED',
        });
        continue;
      }

      docs.push(doc);
      if (entityQueue && doc.rawText) {
        entityQueue.scanText(doc.rawText, {
          source: 'mygov',
          sourceDocument: doc.url,
          retrievedAt: new Date().toISOString(),
        });
      }
    }

    return docs;
  }

  async function openAndReadPreparedDocument(
    currentPage: Page,
    currentFrame: Frame,
    myGovPage: MyGovPage,
    label: string
  ): Promise<any | null> {
    const opened = await myGovPage.openPreparedDocument(currentPage, currentFrame, label);
    if (!opened) return null;

    const url = opened.url();
    const cls = classifyDocumentLink({ url, label }, { pageUrl: url });
    const doc = cls.looksLikeDirectFile
      ? await readPdfDocument(opened, { url, label }, 'mygov_prepared_document')
      : await readOnlineDocument(opened, { url, label }, 'mygov_prepared_document');

    if (opened !== currentPage) await opened.close().catch(() => {});

    if (!doc?.rawText || doc.rawText.trim().length <= 20) return null;

    return {
      url: doc.url,
      label,
      rawText: doc.rawText.slice(0, 50000),
      source: 'mygov_prepared_document',
      complete: !!doc.complete,
      documentType: doc.documentType || (cls.looksLikeDirectFile ? 'PDF_DOCUMENT' : 'ONLINE_DOCUMENT'),
      pagesRead: doc.pagesRead || 0,
      pageCount: doc.pageCount || 0,
    };
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
      unvisitedRelevantItems:
        resultsDiscovered != null ? Math.max(0, resultsDiscovered - resultsVisited) : null,
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
      resultConfirmed:
        legacyStatus === 'SEARCH_CONFIRMED' ||
        (legacyStatus === 'SOURCE_EXHAUSTED' && (resultsDiscovered || 0) > 0),
      noResultConfirmed:
        state === 'MYGOV_EXHAUSTED' &&
        (resultsDiscovered === 0 || resultsDiscovered === null),
      resultValidated: legacyStatus !== 'WRONG_SEARCH_CONTEXT',
      status:
        legacyStatus === 'SOURCE_EXHAUSTED'
          ? (resultsDiscovered || 0) > 0
            ? 'SEARCH_CONFIRMED'
            : 'NO_RESULT_CONFIRMED'
          : legacyStatus,
      traversal,
      retrievedAt: new Date().toISOString(),
      documents,
      discoveredEntities: [],
      error,
      workflowResult,
    };
  }
}
