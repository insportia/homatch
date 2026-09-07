// TasMapWorker.ts — production TAS_MAP flow, live-verified 2026-09-07.
//
// Exact browser sequence:
// MS Map direct URL -> cadastral input + Enter -> suggestion -> highlighted
// parcel -> open only cadastral layers -> enable the two required layers ->
// Identify -> retry parcel click until info window opens -> NAPR -> snapshot
// unique registration numbers once -> open each registration once -> read all
// PDF pages -> stop with no second loop.

import type { Page } from 'playwright';
import { newTasMapFsm } from './TasMapState.js';
import { TasMapPage } from './TasMapPage.js';
import * as assert from './assertions.js';
import { BrowserTrace } from '../../browser/BrowserTrace.js';
import { challenge } from '../../browser/BrowserSession.js';
import { computeTasMapTraversal, canMarkTasMapExhausted, type TasMapTraversalInput } from '../../state/transitions.js';
import type { EvidenceLedger } from '../../evidence/EvidenceLedger.js';
import type { EntityQueue } from '../../entities/EntityQueue.js';
import type { LegacySourceResult, WorkflowResult } from '../WorkflowResult.js';
import { MS_MAP_URL, MAP_SEARCH_INPUT_SELECTOR } from './selectors.js';

const SOURCE_META = {
  name: 'TAS Cadastral Map',
  class: 'OFFICIAL_GOVERNMENT',
  url: MS_MAP_URL,
};

export async function runTasMapWorker(
  page: Page,
  query: string,
  ledger?: EvidenceLedger,
  entities?: EntityQueue,
  opts: { skipGoto?: boolean } = {},
): Promise<LegacySourceResult> {
  const fsm = newTasMapFsm();
  const trace = new BrowserTrace('TAS_MAP');
  const pageObj = new TasMapPage();
  const signals: TasMapTraversalInput & Record<string, any> = {
    queryEntered: false,
    suggestionSelected: false,
    layersEnabled: false,
    identifyActivated: false,
    parcelClicked: false,
    infoPopupOpened: false,
    parcelValidated: false,
    naprOpened: false,
    latestInformationOpened: false,
    documentsRead: false,
    sections: [] as { label: string; discovered: number; visited: number; skipped: number }[],
  };

  let documents: any[] = [];
  let finalText = '';
  let finalUrl: string | null = null;
  let mapPage: Page | null = null;

  const stop = (reason: string) =>
    trace.record({
      stateBefore: fsm.state,
      action: 'STOP',
      actualOutcome: reason,
      stateAfter: fsm.state,
    });

  try {
    if (!opts.skipGoto) {
      const opened = await pageObj.openDirectMap(page);
      trace.record({
        stateBefore: fsm.state,
        action: 'OPEN_DIRECT_MS_MAP',
        target: opened.matchedSelector,
        actualOutcome: opened.opened ? 'MAP_OPENED' : 'MAP_NOT_READY',
        stateAfter: fsm.state,
        url: (page as any).url(),
      });
      if (!opened.opened || !opened.mapPage) {
        stop('MS Map did not become ready');
        return buildResult('FAILED', signals, documents, trace, finalText, finalUrl, 'MS Map did not open', query);
      }
      mapPage = opened.mapPage;
    } else {
      // Resume uses the exact preserved page/context handed back by the
      // orchestrator. Never create a fresh page on the resume path.
      mapPage = page;
    }

    fsm.transition('MAP_OPENED');
    finalUrl = (mapPage as any).url();

    const cap = await challenge(mapPage);
    trace.record({
      stateBefore: fsm.state,
      action: 'CAPTCHA_CHECK',
      actualOutcome: cap ? 'CAPTCHA_DETECTED' : 'NO_CAPTCHA',
      stateAfter: fsm.state,
    });
    if (cap) {
      fsm.transition('WAITING_HUMAN', 'captcha detected before cadastral search');
      return buildResult(fsm.state, signals, documents, trace, finalText, finalUrl, null, query);
    }

    // Live order: search FIRST. The actual input is name=searchText and Enter
    // is mandatory to trigger suggestions.
    fsm.transition('SEARCH_CONTROL_READY', 'live MS Map cadastral input is ready');
    const entered = await pageObj.enterCadastralInMap(mapPage, query);
    signals.queryEntered = entered.found && entered.submitted;
    trace.record({
      stateBefore: fsm.state,
      action: 'ENTER_CADASTRAL_AND_PRESS_ENTER',
      target: query,
      actualOutcome: `found=${entered.found} submitted=${entered.submitted}`,
      stateAfter: fsm.state,
    });
    if (!signals.queryEntered) {
      fsm.transition('SEARCH_CONTROL_NOT_FOUND');
      return buildResult(fsm.state, signals, documents, trace, finalText, finalUrl, null, query);
    }
    fsm.transition('CADASTRAL_ENTERED');

    const sug = await pageObj.waitForSuggestion(mapPage, query, { timeoutMs: 15000, pollMs: 400 });
    trace.record({
      stateBefore: fsm.state,
      action: 'WAIT_FOR_SUGGESTION',
      actualOutcome: sug.found ? `MATCHED_PREFIX:${sug.prefix}` : 'NO_SUGGESTION',
      stateAfter: fsm.state,
    });
    if (!sug.found) {
      fsm.transition('NO_RESULT_CONFIRMED', 'query submitted but no cadastral suggestion matched');
      return buildResult(fsm.state, signals, documents, trace, finalText, finalUrl, null, query);
    }
    fsm.transition('SUGGESTIONS_LOADED');

    const clickRes = await pageObj.clickSuggestionAndConfirmRedraw(mapPage, sug.el);
    if (!assert.assertSuggestionSelected(sug.found, clickRes.clicked)) {
      stop('cadastral suggestion click failed');
      return buildResult('FAILED', signals, documents, trace, finalText, finalUrl, 'cadastral suggestion click failed', query);
    }
    signals.suggestionSelected = true;
    fsm.transition('CORRECT_SUGGESTION_SELECTED', `matched prefix ${sug.prefix}`);
    trace.record({
      stateBefore: fsm.state,
      action: 'CLICK_SUGGESTION',
      actualOutcome: `clicked=${clickRes.clicked} redraw=${clickRes.redrawConfirmed} requests=${clickRes.requestCount} dom=${clickRes.domConfirmed}`,
      stateAfter: fsm.state,
    });
    if (!assert.assertParcelFocused(clickRes.clicked, clickRes.redrawConfirmed)) {
      stop('parcel focus/redraw not confirmed');
      return buildResult('FAILED', signals, documents, trace, finalText, finalUrl, 'parcel focus/redraw not confirmed', query);
    }
    fsm.transition('PARCEL_FOCUSED');

    // Only now open "საკადასტრო მონაცემები" and enable the two layers.
    fsm.transition('CADASTRAL_SECTION_EXPANDED', 'open only the cadastral data layer category');
    const { results: layerResults, diagnostics: layerDiagnostics } = await pageObj.enableRequiredLayers(mapPage);
    signals.layersEnabled = assert.assertAllRequiredLayersEnabled(layerResults);
    trace.record({
      stateBefore: fsm.state,
      action: 'ENABLE_TWO_CADASTRAL_LAYERS',
      actualOutcome: JSON.stringify({ layerResults, layerDiagnostics }),
      stateAfter: fsm.state,
    });
    if (!signals.layersEnabled) {
      const missing = Object.keys(layerResults).filter((k) => !layerResults[k]);
      const reason = `missing required layers: ${missing.join(', ')}`;
      stop(reason);
      fsm.transition('FAILED', reason);
      return buildResult('FAILED', signals, documents, trace, finalText, finalUrl, reason, query);
    }
    fsm.transition('REQUIRED_LAYERS_ENABLED');

    const identifyRes = await pageObj.activateIdentify(mapPage);
    signals.identifyActivated = assert.assertIdentifyModeActive(identifyRes.activated);
    trace.record({
      stateBefore: fsm.state,
      action: 'ACTIVATE_IDENTIFY',
      target: identifyRes.matchedSelector,
      actualOutcome: identifyRes.activated ? 'ACTIVATED' : 'NOT_ACTIVATED',
      stateAfter: fsm.state,
    });
    if (!signals.identifyActivated) {
      stop('Identify tool could not be activated');
      return buildResult('FAILED', signals, documents, trace, finalText, finalUrl, 'Identify tool could not be activated', query);
    }
    fsm.transition('IDENTIFY_ACTIVATED');

    // The info popup is the flaky point live. Never abort after one missed
    // click: re-arm Identify and retry safely up to 60 attempts.
    const infoRes = await pageObj.openParcelInfoWithRetry(mapPage, 60);
    signals.parcelClicked = infoRes.parcelClicked;
    trace.record({
      stateBefore: fsm.state,
      action: 'CLICK_PARCEL_WITH_PERSISTENT_RETRY',
      actualOutcome: `opened=${infoRes.opened} attempts=${infoRes.attempts} parcelClicked=${infoRes.parcelClicked}`,
      stateAfter: fsm.state,
    });
    if (!signals.parcelClicked) {
      stop('parcel could not be clicked after persistent retry');
      return buildResult('FAILED', signals, documents, trace, finalText, finalUrl, 'parcel could not be clicked', query);
    }
    fsm.transition('PARCEL_CLICKED');

    signals.infoPopupOpened = assert.assertParcelInfoWindowVisible(infoRes.opened);
    signals.parcelValidated = assert.assertParcelMatchesQuery(infoRes.windowText, query);
    if (!signals.infoPopupOpened) {
      stop('parcel info window did not open after persistent retry');
      return buildResult('FAILED', signals, documents, trace, finalText, finalUrl, 'parcel info window did not open after retries', query);
    }
    fsm.transition('INFO_POPUP_OPENED');
    finalText = infoRes.windowText || '';

    const naprRes = await pageObj.openPublicRegistryLink(mapPage);
    if (!naprRes.found) {
      stop('NAPR link not found in parcel info window');
      return buildResult(fsm.state, signals, documents, trace, finalText, finalUrl, 'NAPR link not found', query);
    }
    fsm.transition('NAPR_ACTION_FOUND');

    signals.naprOpened = assert.assertNaprNavigationOccurred(naprRes.opened && !!naprRes.target);
    trace.record({
      stateBefore: fsm.state,
      action: 'OPEN_NAPR',
      actualOutcome: signals.naprOpened ? 'NAPR_PAGE_CAPTURED' : 'NAPR_PAGE_NOT_CAPTURED',
      stateAfter: fsm.state,
      url: naprRes.target ? naprRes.target.url() : null,
    });
    if (!signals.naprOpened || !naprRes.target) {
      stop('NAPR page did not open/capture');
      return buildResult('FAILED', signals, documents, trace, finalText, finalUrl, 'NAPR page did not open/capture', query);
    }
    fsm.transition('NAPR_OPENED');
    finalUrl = naprRes.target.url();

    signals.latestInformationOpened = true;
    fsm.transition('LATEST_INFORMATION_OPENED', 'NAPR registry list opened');

    const traversal = await pageObj.traverseNaprRegistrationDocuments(naprRes.target);
    documents = traversal.documents;
    const completeDocuments = documents.filter((d: any) => d.complete && d.rawText && d.rawText.trim().length > 0).length;
    signals.documentsRead =
      traversal.discovered > 0 &&
      traversal.failed === 0 &&
      completeDocuments === traversal.discovered;
    signals.sections = [
      {
        label: 'NAPR registry documents',
        discovered: traversal.discovered,
        visited: completeDocuments,
        skipped: traversal.duplicateUrls,
      },
    ];

    trace.record({
      stateBefore: fsm.state,
      action: 'TRAVERSE_NAPR_UNIQUE_REGISTRATIONS_ONCE',
      actualOutcome: JSON.stringify({
        discovered: traversal.discovered,
        registrations: traversal.registrations,
        completeDocuments,
        failed: traversal.failed,
        duplicateUrls: traversal.duplicateUrls,
      }),
      stateAfter: fsm.state,
    });
    fsm.transition('RELEVANT_CHILDREN_ENUMERATED', `${traversal.discovered} unique NAPR registration(s)`);

    if (traversal.failed === 0 && completeDocuments === traversal.discovered) {
      fsm.transition('RELEVANT_CHILDREN_TRAVERSED', 'every unique NAPR registration document read completely');
    }

    const exhausted = canMarkTasMapExhausted(signals);
    trace.record({
      stateBefore: fsm.state,
      action: 'GATE',
      target: 'canMarkTasMapExhausted',
      expectedOutcome: 'TAS_MAP_EXHAUSTED',
      actualOutcome: exhausted ? 'TAS_MAP_EXHAUSTED' : 'BLOCKED_BY_COMPLETENESS_GATE',
      stateAfter: fsm.state,
    });
    if (exhausted && fsm.state === 'RELEVANT_CHILDREN_TRAVERSED') {
      fsm.transition('TAS_MAP_EXHAUSTED');
    }

    if (entities) {
      if (finalText) {
        entities.scanText(finalText, {
          source: 'TAS_MAP',
          sourceDocument: finalUrl,
          retrievedAt: new Date().toISOString(),
        });
      }
      for (const d of documents) {
        if (d.rawText) {
          entities.scanText(d.rawText, {
            source: 'TAS_MAP',
            sourceDocument: d.url,
            retrievedAt: new Date().toISOString(),
          });
        }
      }
    }

    if (ledger && signals.suggestionSelected) {
      ledger.add({
        type: 'PROPERTY_FACT',
        claim: `Official cadastral map located the searched parcel at prefix ${sug.prefix}`,
        source: SOURCE_META.name,
        sourceClass: 'OFFICIAL',
        sourceUrl: SOURCE_META.url,
        confidence: signals.parcelValidated ? 0.98 : 0.85,
        verificationState: signals.parcelValidated ? 'VERIFIED' : 'UNVERIFIED',
        supportingText: signals.parcelValidated
          ? `parcel info confirmed cadastral prefix ${sug.prefix}`
          : `map suggestion/focus matched prefix ${sug.prefix}`,
      });
    }

    return buildResult(fsm.state, signals, documents, trace, finalText, finalUrl, null, query);
  } catch (e) {
    trace.record({
      stateBefore: fsm.state,
      action: 'EXCEPTION',
      actualOutcome: String(e).slice(0, 300),
      stateAfter: 'FAILED',
    });
    return buildResult('FAILED', signals, documents, trace, finalText, finalUrl, String(e), query);
  }

  function buildResult(
    state: string,
    sig: TasMapTraversalInput & Record<string, any>,
    docs: any[],
    tr: BrowserTrace,
    text: string,
    url: string | null,
    error: string | null,
    q: string,
  ): LegacySourceResult {
    const isOperational = ['WAITING_HUMAN', 'SEARCH_CONTROL_NOT_FOUND', 'NO_RESULT_CONFIRMED', 'FAILED'].includes(state);
    const traversal = computeTasMapTraversal({
      ...sig,
      captcha: state === 'WAITING_HUMAN',
      searchControlNotFound: state === 'SEARCH_CONTROL_NOT_FOUND',
      noResultConfirmed: state === 'NO_RESULT_CONFIRMED',
      failed: state === 'FAILED',
    });
    const legacyStatus =
      state === 'TAS_MAP_EXHAUSTED' || traversal.status === 'SOURCE_EXHAUSTED'
        ? sig.suggestionSelected
          ? 'SEARCH_CONFIRMED'
          : 'NO_RESULT_CONFIRMED'
        : traversal.status === 'NOT_STARTED'
          ? 'SEARCH_CONTROL_NOT_FOUND'
          : sig.queryEntered
            ? sig.suggestionSelected
              ? 'SEARCH_CONFIRMED'
              : 'NO_RESULT_CONFIRMED'
            : traversal.status;
    const exhaustedNow = canMarkTasMapExhausted(sig);
    const sectionsUnvisited = (sig.sections || []).reduce(
      (acc: number, s: any) => acc + Math.max(0, s.discovered - s.visited - s.skipped),
      0,
    );
    const workflowResult: WorkflowResult = {
      source: 'TAS_MAP',
      state,
      completed: exhaustedNow,
      skipped: state === 'SKIPPED_HUMAN_VERIFICATION',
      discoveredItems: sig.suggestionSelected ? 1 : 0,
      visitedItems: sig.infoPopupOpened ? 1 : 0,
      discoveredDocuments: docs.length,
      readDocuments: docs.filter((d: any) => d.complete).length,
      unvisitedRelevantItems: sig.suggestionSelected && !exhaustedNow ? Math.max(1, sectionsUnvisited) : 0,
      evidenceIds: [],
      trace: tr.all,
    };
    return {
      source: 'TAS_MAP',
      sourceName: SOURCE_META.name,
      sourceClass: SOURCE_META.class,
      sourceUrl: SOURCE_META.url,
      startUrl: SOURCE_META.url,
      finalUrl: url,
      frameUrls: [],
      searchControlUsed: sig.queryEntered ? MAP_SEARCH_INPUT_SELECTOR : null,
      queryEntered: sig.queryEntered ? q : null,
      submitAction: sig.queryEntered ? 'ENTER_KEY_THEN_SUGGESTION_CLICK' : null,
      resultContext: isOperational ? error : `TAS_MAP FSM reached ${state}`,
      resultConfirmed: legacyStatus === 'SEARCH_CONFIRMED',
      noResultConfirmed: legacyStatus === 'NO_RESULT_CONFIRMED',
      resultValidated: legacyStatus === 'SEARCH_CONFIRMED',
      status: legacyStatus,
      traversal,
      retrievedAt: new Date().toISOString(),
      documents: docs,
      discoveredEntities: [],
      error,
      workflowResult,
    };
  }
}
