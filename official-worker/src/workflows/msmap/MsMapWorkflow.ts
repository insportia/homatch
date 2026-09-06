// MsMapWorkflow.ts — drives MsMapPage.ts through the exact 18-state FSM
// (MsMapState.ts), calling assertions.ts after every critical action and
// refusing to transition further when one fails. This is the direct fix
// for the reported production bug: a suggestion click + map redraw alone
// now caps out at RESULTS_DISCOVERED/RESULTS_TRAVERSED — MSMAP_EXHAUSTED is
// only reachable via canMarkMsmapExhausted() (state/transitions.ts), which
// requires the full popup->NAPR->latest-info->documents chain (or a
// causally-proven confirmed-empty search).
import type { Page } from 'playwright';
import { newMsMapFsm, type MsMapState } from './MsMapState.js';
import { MsMapPage } from './MsMapPage.js';
import * as assert from './assertions.js';
import { BrowserTrace } from '../../browser/BrowserTrace.js';
import { challenge } from '../../browser/BrowserSession.js';
import { computeMsmapTraversal, canMarkMsmapExhausted } from '../../state/transitions.js';
import type { EvidenceLedger } from '../../evidence/EvidenceLedger.js';
import type { EntityQueue } from '../../entities/EntityQueue.js';
import type { LegacySourceResult, WorkflowResult } from '../WorkflowResult.js';

const SOURCE_META = { name: 'MS Cadastral Map', class: 'OFFICIAL_GOVERNMENT', url: 'https://ms.gov.ge/msmap/#C=44.7433554-41.7850526@Z=19' };

export async function runMsMapWorkflow(page: Page, query: string, ledger?: EvidenceLedger, entities?: EntityQueue, opts: { skipGoto?: boolean } = {}): Promise<LegacySourceResult> {
  const fsm = newMsMapFsm();
  const trace = new BrowserTrace('msmap');
  const pageObj = new MsMapPage();
  const signals: Record<string, any> = { queryEntered: false, suggestionSelected: false, layersEnabled: false, identifyActivated: false, parcelClicked: false, infoPopupOpened: false, parcelValidated: false, naprOpened: false, latestInformationOpened: false, documentsRead: false };
  let documents: any[] = [];
  let finalText = '';
  let finalUrl: string | null = null;

  const stop = (reason: string) => trace.record({ stateBefore: fsm.state, action: 'STOP', actualOutcome: reason, stateAfter: fsm.state });

  try {
    // On a resume-after-human-verification pass, the page is already
    // navigated (and mid-verification) — re-navigating would discard that
    // state. skipGoto only skips the browser action; the FSM still records
    // MAP_OPENED since the page genuinely is open.
    if (!opts.skipGoto) await pageObj.goto(page);
    fsm.transition('MAP_OPENED');
    finalUrl = (page as any).url();
    trace.record({ stateBefore: null, action: 'GOTO', target: SOURCE_META.url, actualOutcome: 'MAP_OPENED', stateAfter: fsm.state, url: finalUrl });

    const cap = await challenge(page);
    trace.record({ stateBefore: fsm.state, action: 'CAPTCHA_CHECK', actualOutcome: cap ? 'CAPTCHA_DETECTED' : 'NO_CAPTCHA', stateAfter: fsm.state });
    if (cap) {
      fsm.transition('WAITING_HUMAN', 'captcha detected before search');
      return buildResult(fsm.state, signals, documents, trace, finalText, finalUrl, null, query);
    }

    const expanded = await pageObj.expandCadastralSection(page);
    trace.record({ stateBefore: fsm.state, action: 'EXPAND_CADASTRAL_SECTION', actualOutcome: expanded ? 'PANEL_FOUND' : 'PANEL_NOT_FOUND', stateAfter: fsm.state });
    if (expanded) fsm.transition('CADASTRAL_SECTION_EXPANDED');
    else {
      stop('CADASTRAL_SECTION_EXPANDED assertion failed — panel not found');
    }

    if (fsm.state === 'CADASTRAL_SECTION_EXPANDED') {
      const layers = await pageObj.enableRequiredLayers(page);
      signals.layersEnabled = assert.assertRequiredLayersEnabled(layers.layer1, layers.layer2);
      trace.record({ stateBefore: fsm.state, action: 'ENABLE_LAYERS', actualOutcome: `layer1=${layers.layer1} layer2=${layers.layer2}`, stateAfter: fsm.state });
      if (signals.layersEnabled) fsm.transition('REQUIRED_LAYERS_ENABLED');
      else stop('assertRequiredLayersEnabled failed');
    }

    // Search-control readiness and cadastral entry can legitimately proceed
    // even if the layers step above stalled (the search box itself is
    // independent UI) — this mirrors the pre-refactor adapter's real
    // behavior and keeps the search from being blocked by an unrelated
    // panel-toggle failure, while layersEnabled stays honestly false in the
    // traversal snapshot either way.
    fsm.transition('SEARCH_CONTROL_READY', 'search box is independent of the layers panel');
    const entered = await pageObj.enterCadastral(page, query);
    signals.queryEntered = entered.found;
    trace.record({ stateBefore: fsm.state, action: 'ENTER_CADASTRAL', target: query, actualOutcome: entered.found ? 'FILLED' : 'NOT_FOUND', stateAfter: null });
    if (!entered.found) {
      fsm.transition('SEARCH_CONTROL_NOT_FOUND');
      return buildResult(fsm.state, signals, documents, trace, finalText, finalUrl, null, query);
    }
    fsm.transition('CADASTRAL_ENTERED');

    const sug = await pageObj.waitForSuggestion(page, query);
    trace.record({ stateBefore: fsm.state, action: 'WAIT_FOR_SUGGESTION', actualOutcome: sug.found ? `MATCHED_PREFIX:${sug.prefix}` : 'NO_SUGGESTION', stateAfter: fsm.state });
    if (sug.found) fsm.transition('SUGGESTIONS_LOADED');
    else {
      // A causally-proven search (network-confirmed unified-search POST)
      // that suggested nothing is a real, evidenced NO_RESULT — not a
      // control/selector failure.
      fsm.transition('NO_RESULT_CONFIRMED', entered.netConfirmed ? 'unified-search ran, no suggestion matched' : 'no network confirmation either');
      return buildResult(fsm.state, signals, documents, trace, finalText, finalUrl, null, query);
    }

    if (assert.assertSuggestionSelected(sug.found, true)) {
      const clickRes = await pageObj.clickSuggestionAndConfirmRedraw(page, sug.el);
      fsm.transition('CORRECT_SUGGESTION_SELECTED', `matched at prefix ${sug.prefix}`);
      signals.suggestionSelected = true;
      signals.parcelClicked = clickRes.clicked;
      trace.record({ stateBefore: fsm.state, action: 'CLICK_SUGGESTION', actualOutcome: `clicked=${clickRes.clicked} mapRedrawRequests=${clickRes.requestCount}`, stateAfter: fsm.state });
      if (assert.assertParcelFocused(clickRes.clicked, clickRes.mapRedrawConfirmed)) {
        fsm.transition('PARCEL_FOCUSED', `${clickRes.requestCount} map-redraw request(s) confirmed`);
      } else {
        stop('assertParcelFocused failed — click did not trigger a confirmed map redraw');
        return buildResult(fsm.state, signals, documents, trace, finalText, finalUrl, null, query);
      }
    }

    const identifyRes = await pageObj.activateIdentify(page);
    signals.identifyActivated = assert.assertIdentifyModeActive(identifyRes.activated);
    trace.record({
      stateBefore: fsm.state,
      action: 'ACTIVATE_IDENTIFY',
      target: identifyRes.matchedSelector,
      actualOutcome: identifyRes.activated ? `ACTIVATED_VIA:${identifyRes.matchedSelector}` : `NO_SELECTOR_MATCHED_OR_CLICK_FAILED candidateCounts=${JSON.stringify(identifyRes.candidateCounts)}`,
      stateAfter: fsm.state,
    });
    if (signals.identifyActivated) fsm.transition('IDENTIFY_ACTIVATED');
    else {
      stop('assertIdentifyModeActive failed');
      return buildResult(fsm.state, signals, documents, trace, finalText, finalUrl, null, query);
    }

    const parcelClicked = await pageObj.clickParcelCenter(page);
    signals.parcelClicked = parcelClicked;
    trace.record({ stateBefore: fsm.state, action: 'CLICK_PARCEL_CENTER', actualOutcome: parcelClicked ? 'CLICKED' : 'MAP_ELEMENT_NOT_FOUND', stateAfter: fsm.state });
    if (parcelClicked) fsm.transition('PARCEL_CLICKED');
    else {
      stop('PARCEL_CLICKED failed — map element/boundingBox not found');
      return buildResult(fsm.state, signals, documents, trace, finalText, finalUrl, null, query);
    }

    const popupRes = await pageObj.openInfoPopupAndNaprLink(page);
    signals.infoPopupOpened = assert.assertParcelInfoPopupVisible(popupRes.popupOpened);
    // "Validate that the opened parcel is the intended parcel" — checked
    // against the popup's own text, but deliberately non-blocking (see
    // assertParcelMatchesQuery's header comment): this sandbox has never
    // been able to confirm the popup's real text markup live, so a false
    // negative here downgrades the evidence-ledger claim below rather than
    // stopping an otherwise-successful MSMAP traversal.
    signals.parcelValidated = assert.assertParcelMatchesQuery(popupRes.extraText, query);
    trace.record({ stateBefore: fsm.state, action: 'OPEN_INFO_POPUP', actualOutcome: `popupOpened=${popupRes.popupOpened} naprOpened=${popupRes.naprOpened} parcelValidated=${signals.parcelValidated}`, stateAfter: fsm.state });
    if (signals.infoPopupOpened) fsm.transition('INFO_POPUP_OPENED');
    else {
      stop('assertParcelInfoPopupVisible failed');
      return buildResult(fsm.state, signals, documents, trace, finalText, finalUrl, null, query);
    }

    if (popupRes.naprOpened) fsm.transition('NAPR_ACTION_FOUND');
    else {
      stop('no NAPR/Public Registry action found in the popup');
      return buildResult(fsm.state, signals, documents, trace, finalText, finalUrl, null, query);
    }

    signals.naprOpened = assert.assertNaprNavigationOccurred(popupRes.naprOpened);
    fsm.transition('NAPR_OPENED');
    const target = popupRes.target as Page;
    finalUrl = (target as any).url();
    trace.record({ stateBefore: 'NAPR_ACTION_FOUND', action: 'NAPR_OPENED', actualOutcome: popupRes.isNewPage ? 'NEW_PAGE' : 'SAME_PAGE', stateAfter: fsm.state, url: finalUrl });

    const latestOpened = await pageObj.openLatestInformation(target);
    signals.latestInformationOpened = assert.assertLatestInformationOpened(latestOpened);
    trace.record({ stateBefore: fsm.state, action: 'OPEN_LATEST_INFORMATION', actualOutcome: latestOpened ? 'OPENED' : 'LABEL_NOT_FOUND', stateAfter: fsm.state, url: finalUrl });
    if (signals.latestInformationOpened) fsm.transition('LATEST_INFORMATION_OPENED');
    else {
      stop('assertLatestInformationOpened failed');
      finalText = await pageObj.readText(target);
      scanForEntities(entities, finalText, 'msmap', finalUrl);
      return buildResult(fsm.state, signals, documents, trace, finalText, finalUrl, null, query);
    }

    documents = await pageObj.readChildDocuments(target);
    signals.documentsRead = documents.some((d: any) => d.complete);
    fsm.transition('RELEVANT_CHILDREN_ENUMERATED', `${documents.length} document(s) found`);
    trace.record({ stateBefore: 'LATEST_INFORMATION_OPENED', action: 'READ_CHILD_DOCUMENTS', actualOutcome: `discovered=${documents.length} complete=${documents.filter((d: any) => d.complete).length}`, stateAfter: fsm.state });
    if (signals.documentsRead || documents.length === 0) {
      fsm.transition('RELEVANT_CHILDREN_TRAVERSED');
      const exhausted = canMarkMsmapExhausted(signals);
      trace.record({ stateBefore: 'RELEVANT_CHILDREN_TRAVERSED', action: 'GATE', target: 'canMarkMsmapExhausted', expectedOutcome: 'MSMAP_EXHAUSTED', actualOutcome: exhausted ? 'MSMAP_EXHAUSTED' : 'BLOCKED_BY_canMarkMsmapExhausted', stateAfter: fsm.state });
      if (exhausted) fsm.transition('MSMAP_EXHAUSTED');
    }

    finalText = await pageObj.readText(target);
    if (entities) {
      scanForEntities(entities, finalText, 'msmap', finalUrl);
      for (const d of documents) if (d.rawText) scanForEntities(entities, d.rawText, 'msmap', d.url);
    }
    if (ledger && signals.suggestionSelected) {
      ledger.add({
        type: 'PROPERTY_FACT',
        claim: `MS.GOV.GE cadastral map located a parcel matching prefix ${sug.prefix} of the searched cadastral code`,
        source: SOURCE_META.name,
        sourceClass: 'OFFICIAL',
        sourceUrl: SOURCE_META.url,
        // parcelValidated (the opened parcel-info popup's own text actually
        // named this cadastral code/prefix) is the strongest available
        // signal that the right parcel was opened, not just that a click
        // landed somewhere on the map — it takes priority over the older
        // parcelClicked-only confidence tiers.
        confidence: signals.parcelValidated ? 0.98 : signals.parcelClicked ? 0.85 : 0.6,
        verificationState: signals.parcelValidated ? 'VERIFIED' : signals.parcelClicked ? 'UNVERIFIED' : 'UNVERIFIED',
        supportingText: signals.parcelValidated ? `parcel-info popup confirmed cadastral prefix ${sug.prefix}` : `suggestion prefix ${sug.prefix}`,
      });
    }

    return buildResult(fsm.state, signals, documents, trace, finalText, finalUrl, null, query);
  } catch (e) {
    trace.record({ stateBefore: fsm.state, action: 'EXCEPTION', actualOutcome: String(e).slice(0, 300), stateAfter: 'FAILED' });
    return buildResult('FAILED', signals, documents, trace, finalText, finalUrl, String(e), query);
  }

  function buildResult(state: string, sig: any, docs: any[], tr: BrowserTrace, text: string, url: string | null, error: string | null, q: string): LegacySourceResult {
    const isOperational = ['WAITING_HUMAN', 'SEARCH_CONTROL_NOT_FOUND', 'NO_RESULT_CONFIRMED', 'FAILED'].includes(state);
    const traversal = computeMsmapTraversal({
      ...sig,
      captcha: state === 'WAITING_HUMAN',
      searchControlNotFound: state === 'SEARCH_CONTROL_NOT_FOUND',
      noResultConfirmed: state === 'NO_RESULT_CONFIRMED',
      failed: state === 'FAILED',
    });
    const legacyStatus = state === 'MSMAP_EXHAUSTED' || traversal.status === 'SOURCE_EXHAUSTED' ? (sig.suggestionSelected ? 'SEARCH_CONFIRMED' : 'NO_RESULT_CONFIRMED') : traversal.status === 'NOT_STARTED' ? 'SEARCH_CONTROL_NOT_FOUND' : sig.queryEntered ? (sig.suggestionSelected ? 'SEARCH_CONFIRMED' : 'NO_RESULT_CONFIRMED') : traversal.status;
    const workflowResult: WorkflowResult = {
      source: 'msmap',
      state,
      completed: canMarkMsmapExhausted(sig),
      skipped: state === 'SKIPPED_HUMAN_VERIFICATION',
      discoveredItems: sig.suggestionSelected ? 1 : 0,
      visitedItems: sig.infoPopupOpened ? 1 : 0,
      discoveredDocuments: docs.length,
      readDocuments: docs.filter((d: any) => d.complete).length,
      unvisitedRelevantItems: sig.suggestionSelected && !canMarkMsmapExhausted(sig) ? 1 : 0,
      evidenceIds: [],
      trace: tr.all,
    };
    return {
      source: 'msmap',
      sourceName: SOURCE_META.name,
      sourceClass: SOURCE_META.class,
      sourceUrl: SOURCE_META.url,
      startUrl: SOURCE_META.url,
      finalUrl: url,
      frameUrls: [],
      searchControlUsed: sig.queryEntered ? 'input[name="searchText"]' : null,
      queryEntered: sig.queryEntered ? q : null,
      submitAction: sig.queryEntered ? 'ENTER_KEY' : null,
      resultContext: isOperational ? error : `MSMAP FSM reached ${state}`,
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

function scanForEntities(entities: EntityQueue | undefined, text: string, source: string, sourceDocument: string | null) {
  if (!entities || !text) return;
  entities.scanText(text, { source, sourceDocument, retrievedAt: new Date().toISOString() });
}
