// TasMapWorker.ts — drives TasMapPage.ts through the TAS_MAP FSM
// (TasMapState.ts), calling assertions.ts after every critical action and
// refusing to transition further when one fails. Renamed+rewritten from
// MsMapWorkflow.ts (2026-09-06 "final alignment pass" mandate): the real
// production entry point is tas.ge's own homepage -> a popup opens (the
// Angular Material map app) -> search -> layers -> identify -> parcel
// popup -> NAPR -> dynamic section/row/nested-popup traversal. This is one
// source, TAS_MAP — "do not count old msmap and TAS_MAP as two separate
// sources" — the old direct-ms.gov.ge workflow this replaces is deleted,
// not kept alongside this one.
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

const SOURCE_META = { name: 'TAS Cadastral Map', class: 'OFFICIAL_GOVERNMENT', url: 'https://tas.ge/' };

export async function runTasMapWorker(page: Page, query: string, ledger?: EvidenceLedger, entities?: EntityQueue, opts: { skipGoto?: boolean } = {}): Promise<LegacySourceResult> {
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
  // The map popup itself, once opened — distinct from `page` (the outer tab
  // the orchestrator handed us), since tas.ge's map genuinely opens as a
  // separate browser page/tab.
  let mapPage: Page | null = null;

  const stop = (reason: string) => trace.record({ stateBefore: fsm.state, action: 'STOP', actualOutcome: reason, stateAfter: fsm.state });

  try {
    if (!opts.skipGoto) {
      const opened = await pageObj.openMapFromTas(page);
      trace.record({ stateBefore: fsm.state, action: 'OPEN_MAP_FROM_TAS', target: opened.matchedSelector, actualOutcome: opened.opened ? 'MAP_OPENED' : 'LAUNCH_LINK_NOT_FOUND', stateAfter: fsm.state, url: (page as any).url() });
      if (!opened.opened || !opened.mapPage) {
        stop('MAP_OPENED assertion failed — tas.ge map launch link/popup not found');
        return buildResult('FAILED', signals, documents, trace, finalText, finalUrl, 'tas.ge map popup did not open', query);
      }
      mapPage = opened.mapPage;
    } else {
      // Resume-after-human-verification: the map popup is already open and
      // mid-verification — re-navigating/re-opening would discard that
      // state, so the caller is expected to have preserved it. Without a
      // preserved handle there is nothing safe to resume on.
      mapPage = page;
    }
    fsm.transition('MAP_OPENED');
    finalUrl = (mapPage as any).url();

    const cap = await challenge(mapPage);
    trace.record({ stateBefore: fsm.state, action: 'CAPTCHA_CHECK', actualOutcome: cap ? 'CAPTCHA_DETECTED' : 'NO_CAPTCHA', stateAfter: fsm.state });
    if (cap) {
      fsm.transition('WAITING_HUMAN', 'captcha detected before search');
      return buildResult(fsm.state, signals, documents, trace, finalText, finalUrl, null, query);
    }

    // The layers panel/tree is present as soon as the map popup loads — no
    // separate "expand cadastral section" step exists in the real recorded
    // flow (that concept belonged only to the old ms.gov.ge direct-nav UI).
    fsm.transition('CADASTRAL_SECTION_EXPANDED', 'tas.ge map popup exposes the layer tree directly, no separate panel toggle');

    const layerResults = await pageObj.enableRequiredLayers(mapPage);
    signals.layersEnabled = assert.assertAllRequiredLayersEnabled(layerResults);
    trace.record({ stateBefore: fsm.state, action: 'ENABLE_LAYERS', actualOutcome: JSON.stringify(layerResults), stateAfter: fsm.state });
    if (signals.layersEnabled) fsm.transition('REQUIRED_LAYERS_ENABLED');
    else stop(`assertAllRequiredLayersEnabled failed — missing: ${Object.keys(layerResults).filter((k) => !layerResults[k]).join(', ')}`);

    // Search-control readiness/cadastral entry proceed even if the layers
    // step stalled — the search box is independent UI, same reasoning the
    // pre-existing MSMAP adapter used — but layersEnabled stays honestly
    // false in the traversal snapshot either way.
    fsm.transition('SEARCH_CONTROL_READY', 'search box is independent of the layers panel');
    const entered = await pageObj.enterCadastralInMap(mapPage, query);
    signals.queryEntered = entered.found;
    trace.record({ stateBefore: fsm.state, action: 'ENTER_CADASTRAL', target: query, actualOutcome: entered.found ? 'FILLED' : 'NOT_FOUND', stateAfter: null });
    if (!entered.found) {
      fsm.transition('SEARCH_CONTROL_NOT_FOUND');
      return buildResult(fsm.state, signals, documents, trace, finalText, finalUrl, null, query);
    }
    fsm.transition('CADASTRAL_ENTERED');

    const sug = await pageObj.waitForSuggestion(mapPage, query);
    trace.record({ stateBefore: fsm.state, action: 'WAIT_FOR_SUGGESTION', actualOutcome: sug.found ? `MATCHED_PREFIX:${sug.prefix}` : 'NO_SUGGESTION', stateAfter: fsm.state });
    if (sug.found) fsm.transition('SUGGESTIONS_LOADED');
    else {
      fsm.transition('NO_RESULT_CONFIRMED', 'search box accepted the query but no suggestion matched');
      return buildResult(fsm.state, signals, documents, trace, finalText, finalUrl, null, query);
    }

    if (assert.assertSuggestionSelected(sug.found, true)) {
      const clickRes = await pageObj.clickSuggestionAndConfirmRedraw(mapPage, sug.el);
      fsm.transition('CORRECT_SUGGESTION_SELECTED', `matched at prefix ${sug.prefix}`);
      signals.suggestionSelected = true;
      signals.parcelClicked = clickRes.clicked;
      trace.record({ stateBefore: fsm.state, action: 'CLICK_SUGGESTION', actualOutcome: `clicked=${clickRes.clicked} mapRedrawRequests=${clickRes.requestCount} domConfirmed=${clickRes.domConfirmed}`, stateAfter: fsm.state });
      if (assert.assertParcelFocused(clickRes.clicked, clickRes.redrawConfirmed)) {
        fsm.transition('PARCEL_FOCUSED', `${clickRes.requestCount} map-redraw request(s) or DOM confirmation`);
      } else {
        stop('assertParcelFocused failed — click did not trigger a confirmed map redraw');
        return buildResult(fsm.state, signals, documents, trace, finalText, finalUrl, null, query);
      }
    }

    const identifyRes = await pageObj.activateIdentify(mapPage);
    signals.identifyActivated = assert.assertIdentifyModeActive(identifyRes.activated);
    trace.record({
      stateBefore: fsm.state,
      action: 'ACTIVATE_IDENTIFY',
      target: identifyRes.matchedSelector,
      actualOutcome: identifyRes.activated ? `ACTIVATED_VIA:${identifyRes.matchedSelector}` : 'NO_SELECTOR_MATCHED_OR_CLICK_FAILED',
      stateAfter: fsm.state,
    });
    if (signals.identifyActivated) fsm.transition('IDENTIFY_ACTIVATED');
    else {
      stop('assertIdentifyModeActive failed');
      return buildResult(fsm.state, signals, documents, trace, finalText, finalUrl, null, query);
    }

    const parcelClicked = await pageObj.clickParcelCenter(mapPage);
    signals.parcelClicked = parcelClicked;
    trace.record({ stateBefore: fsm.state, action: 'CLICK_PARCEL_CENTER', actualOutcome: parcelClicked ? 'CLICKED' : 'MAP_ELEMENT_NOT_FOUND', stateAfter: fsm.state });
    if (parcelClicked) fsm.transition('PARCEL_CLICKED');
    else {
      stop('PARCEL_CLICKED failed — map canvas/boundingBox not found');
      return buildResult(fsm.state, signals, documents, trace, finalText, finalUrl, null, query);
    }

    const infoRes = await pageObj.openParcelInfoWindow(mapPage);
    signals.infoPopupOpened = assert.assertParcelInfoWindowVisible(infoRes.opened);
    signals.parcelValidated = assert.assertParcelMatchesQuery(infoRes.windowText, query);
    trace.record({ stateBefore: fsm.state, action: 'OPEN_PARCEL_INFO_WINDOW', actualOutcome: `opened=${infoRes.opened} parcelValidated=${signals.parcelValidated}`, stateAfter: fsm.state });
    if (signals.infoPopupOpened) fsm.transition('INFO_POPUP_OPENED');
    else {
      stop('assertParcelInfoWindowVisible failed');
      return buildResult(fsm.state, signals, documents, trace, finalText, finalUrl, null, query);
    }

    const naprRes = await pageObj.openPublicRegistryLink(mapPage);
    if (!naprRes.found) {
      stop('no საჯარო რეესტრის ინფორმაცია action found in the parcel-info window');
      finalText = infoRes.windowText || '';
      if (entities && finalText) entities.scanText(finalText, { source: 'TAS_MAP', sourceDocument: finalUrl, retrievedAt: new Date().toISOString() });
      return buildResult(fsm.state, signals, documents, trace, finalText, finalUrl, null, query);
    }
    fsm.transition('NAPR_ACTION_FOUND');
    signals.naprOpened = assert.assertNaprNavigationOccurred(naprRes.opened);
    fsm.transition('NAPR_OPENED');
    if (naprRes.target) {
      finalUrl = (naprRes.target as any).url();
      finalText = await pageObj.readText(naprRes.target);
    }
    trace.record({ stateBefore: 'NAPR_ACTION_FOUND', action: 'NAPR_OPENED', actualOutcome: naprRes.opened ? 'NEW_PAGE' : 'CLICK_DID_NOT_OPEN_POPUP', stateAfter: fsm.state, url: finalUrl });

    // Real production flow: "საჯარო რეესტრის ინფორმაცია" IS the
    // "latest information" lead (the same row the mandate's
    // LATEST_INFORMATION_OPENED state names) — there is no further
    // sub-navigation step beyond the popup NAPR_OPENED already produced.
    signals.latestInformationOpened = signals.naprOpened;
    if (signals.latestInformationOpened) fsm.transition('LATEST_INFORMATION_OPENED');

    const traversal = await pageObj.traverseSections(mapPage);
    signals.sections = traversal.sections;
    documents = traversal.documents;
    signals.documentsRead = documents.some((d: any) => d.complete);
    const sectionsOpened = traversal.sections.filter((s) => s.discovered > 0 || s.visited > 0).length;
    trace.record({
      stateBefore: fsm.state,
      action: 'TRAVERSE_SECTIONS',
      actualOutcome: `sections=${JSON.stringify(traversal.sections)} documentsDiscovered=${documents.length} documentsRead=${documents.filter((d: any) => d.complete).length}`,
      stateAfter: fsm.state,
    });
    fsm.transition('RELEVANT_CHILDREN_ENUMERATED', `${documents.length} document(s) found across ${traversal.sections.length} section(s)`);

    if (assert.assertSectionsTraversed(sectionsOpened, traversal.sections.length) || signals.documentsRead || documents.length === 0) {
      fsm.transition('RELEVANT_CHILDREN_TRAVERSED');
    }

    const exhausted = canMarkTasMapExhausted(signals);
    trace.record({ stateBefore: fsm.state, action: 'GATE', target: 'canMarkTasMapExhausted', expectedOutcome: 'TAS_MAP_EXHAUSTED', actualOutcome: exhausted ? 'TAS_MAP_EXHAUSTED' : 'BLOCKED_BY_canMarkTasMapExhausted', stateAfter: fsm.state });
    if (exhausted && fsm.state === 'RELEVANT_CHILDREN_TRAVERSED') fsm.transition('TAS_MAP_EXHAUSTED');

    if (!finalText) finalText = infoRes.windowText || '';
    if (entities) {
      if (finalText) entities.scanText(finalText, { source: 'TAS_MAP', sourceDocument: finalUrl, retrievedAt: new Date().toISOString() });
      for (const d of documents) if (d.rawText) entities.scanText(d.rawText, { source: 'TAS_MAP', sourceDocument: d.url, retrievedAt: new Date().toISOString() });
    }
    if (ledger && signals.suggestionSelected) {
      ledger.add({
        type: 'PROPERTY_FACT',
        claim: `TAS.GE cadastral map located a parcel matching prefix ${sug.prefix} of the searched cadastral code`,
        source: SOURCE_META.name,
        sourceClass: 'OFFICIAL',
        sourceUrl: SOURCE_META.url,
        confidence: signals.parcelValidated ? 0.98 : signals.parcelClicked ? 0.85 : 0.6,
        verificationState: signals.parcelValidated ? 'VERIFIED' : 'UNVERIFIED',
        supportingText: signals.parcelValidated ? `parcel-info window confirmed cadastral prefix ${sug.prefix}` : `suggestion prefix ${sug.prefix}`,
      });
    }

    return buildResult(fsm.state, signals, documents, trace, finalText, finalUrl, null, query);
  } catch (e) {
    trace.record({ stateBefore: fsm.state, action: 'EXCEPTION', actualOutcome: String(e).slice(0, 300), stateAfter: 'FAILED' });
    return buildResult('FAILED', signals, documents, trace, finalText, finalUrl, String(e), query);
  }

  function buildResult(state: string, sig: TasMapTraversalInput & Record<string, any>, docs: any[], tr: BrowserTrace, text: string, url: string | null, error: string | null, q: string): LegacySourceResult {
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
    const sectionsUnvisited = (sig.sections || []).reduce((acc: number, s: any) => acc + Math.max(0, s.discovered - s.visited - s.skipped), 0);
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
      searchControlUsed: sig.queryEntered ? `role=textbox[name="ძიება"]` : null,
      queryEntered: sig.queryEntered ? q : null,
      submitAction: sig.queryEntered ? 'SUGGESTION_CLICK' : null,
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
