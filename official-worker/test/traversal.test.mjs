import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMsmapTraversal, computeTasTraversal, computeMygovTraversal, computeEnregTraversal, isSourceExhausted } from '../src/lib/traversal.js';

// ── MSMAP ────────────────────────────────────────────────────────────────
test('msmap: nothing happened yet -> NOT_STARTED', () => {
  const t = computeMsmapTraversal({});
  assert.equal(t.status, 'NOT_STARTED');
});

test('msmap: query entered, no suggestion, confirmed empty -> SOURCE_EXHAUSTED (nothing to traverse)', () => {
  const t = computeMsmapTraversal({ queryEntered: true, suggestionSelected: false, noResultConfirmed: true });
  assert.equal(t.status, 'SOURCE_EXHAUSTED');
});

test('msmap: query entered, no suggestion, not confirmed empty -> SEARCH_CONFIRMED only', () => {
  const t = computeMsmapTraversal({ queryEntered: true, suggestionSelected: false });
  assert.equal(t.status, 'SEARCH_CONFIRMED');
});

test('msmap: suggestion selected but popup never opened -> RESULTS_DISCOVERED, not SEARCH_CONFIRMED alone', () => {
  const t = computeMsmapTraversal({ queryEntered: true, suggestionSelected: true, infoPopupOpened: false });
  assert.equal(t.status, 'RESULTS_DISCOVERED');
});

test('msmap: popup opened but NAPR link never opened -> RESULTS_TRAVERSED (still not exhausted)', () => {
  const t = computeMsmapTraversal({ queryEntered: true, suggestionSelected: true, infoPopupOpened: true, naprOpened: false });
  assert.equal(t.status, 'RESULTS_TRAVERSED');
});

test('msmap: NAPR opened but latest-info/documents not read -> RESULTS_TRAVERSED', () => {
  const t = computeMsmapTraversal({ queryEntered: true, suggestionSelected: true, infoPopupOpened: true, naprOpened: true, latestInformationOpened: true, documentsRead: false });
  assert.equal(t.status, 'RESULTS_TRAVERSED');
});

test('msmap: full 18-step chain complete -> SOURCE_EXHAUSTED', () => {
  const t = computeMsmapTraversal({ queryEntered: true, suggestionSelected: true, layersEnabled: true, identifyActivated: true, parcelClicked: true, infoPopupOpened: true, naprOpened: true, latestInformationOpened: true, documentsRead: true });
  assert.equal(t.status, 'SOURCE_EXHAUSTED');
  assert.ok(isSourceExhausted(t));
});

test('msmap: captcha wins over any ladder progress', () => {
  const t = computeMsmapTraversal({ queryEntered: true, suggestionSelected: true, infoPopupOpened: true, naprOpened: true, latestInformationOpened: true, documentsRead: true, captcha: true });
  assert.equal(t.status, 'WAITING_HUMAN');
});

// ── TAS ──────────────────────────────────────────────────────────────────
test('tas: search never submitted -> NOT_STARTED', () => {
  const t = computeTasTraversal({ searchSubmitted: false });
  assert.equal(t.status, 'NOT_STARTED');
});

test('tas: confirmed 0 results -> SOURCE_EXHAUSTED with unvisitedRelevantItems 0', () => {
  const t = computeTasTraversal({ searchSubmitted: true, resultsDiscovered: 0, noResultConfirmed: true });
  assert.equal(t.status, 'SOURCE_EXHAUSTED');
  assert.equal(t.unvisitedRelevantItems, 0);
});

test('tas: THE PRODUCTION BUG — 18 discovered, 0 visited must NOT be SOURCE_EXHAUSTED', () => {
  const t = computeTasTraversal({ searchSubmitted: true, resultsDiscovered: 18, resultsVisited: 0, documentsDiscovered: 0, documentsRead: 0 });
  assert.equal(t.status, 'RESULTS_DISCOVERED');
  assert.equal(t.unvisitedRelevantItems, 18);
  assert.notEqual(t.status, 'SOURCE_EXHAUSTED');
});

test('tas: 18 discovered, all 18 visited, documents fully read -> SOURCE_EXHAUSTED', () => {
  const t = computeTasTraversal({ searchSubmitted: true, resultsDiscovered: 18, resultsVisited: 18, documentsDiscovered: 5, documentsRead: 5 });
  assert.equal(t.status, 'SOURCE_EXHAUSTED');
  assert.equal(t.unvisitedRelevantItems, 0);
});

test('tas: all rows visited but some discovered documents unread -> RESULTS_TRAVERSED', () => {
  const t = computeTasTraversal({ searchSubmitted: true, resultsDiscovered: 3, resultsVisited: 3, documentsDiscovered: 4, documentsRead: 2 });
  assert.equal(t.status, 'RESULTS_TRAVERSED');
});

test('tas: partial visits accounted for by explicit skip reasons still count as exhausted', () => {
  const t = computeTasTraversal({ searchSubmitted: true, resultsDiscovered: 5, resultsVisited: 3, skippedReasonsCount: 2, documentsDiscovered: 0, documentsRead: 0 });
  assert.equal(t.unvisitedRelevantItems, 0);
  assert.equal(t.status, 'SOURCE_EXHAUSTED');
});

test('tas: resultsDiscovered unknown (selector/count both failed) never claims exhaustion', () => {
  const t = computeTasTraversal({ searchSubmitted: true, resultsDiscovered: null });
  assert.equal(t.status, 'SEARCH_CONFIRMED');
  assert.equal(t.unvisitedRelevantItems, null);
});

// ── MYGOV ────────────────────────────────────────────────────────────────
test('mygov: registry app never reached -> NOT_STARTED', () => {
  const t = computeMygovTraversal({ service176Opened: true, registryAppOpened: false });
  assert.equal(t.status, 'NOT_STARTED');
});

test('mygov: THE PRODUCTION BUG — generic candidate field found+submitted+negative text must NOT be NO_RESULT_CONFIRMED-equivalent', () => {
  const t = computeMygovTraversal({ service176Opened: true, registryAppOpened: true, queryEntered: true, searchSubmitted: true, correctSearchContext: false, noResultConfirmed: true });
  assert.equal(t.status, 'WRONG_SEARCH_CONTEXT');
});

test('mygov: correct hint-based context with confirmed empty -> SOURCE_EXHAUSTED', () => {
  const t = computeMygovTraversal({ service176Opened: true, registryAppOpened: true, queryEntered: true, searchSubmitted: true, correctSearchContext: true, resultsDiscovered: 0, noResultConfirmed: true });
  assert.equal(t.status, 'SOURCE_EXHAUSTED');
});

test('mygov: captcha encountered but not yet resolved/skipped -> WAITING_HUMAN even with correct context', () => {
  const t = computeMygovTraversal({ service176Opened: true, registryAppOpened: true, queryEntered: true, searchSubmitted: true, correctSearchContext: true, captcha: true });
  assert.equal(t.status, 'WAITING_HUMAN');
});

test('mygov: skipped human verification is reported distinctly, never as NO_RESULT', () => {
  const t = computeMygovTraversal({ service176Opened: true, registryAppOpened: true, queryEntered: true, searchSubmitted: true, correctSearchContext: true, skippedHumanVerification: true });
  assert.equal(t.status, 'SKIPPED_HUMAN_VERIFICATION');
});

test('mygov: results discovered but not all visited -> RESULTS_DISCOVERED', () => {
  const t = computeMygovTraversal({ service176Opened: true, registryAppOpened: true, queryEntered: true, searchSubmitted: true, correctSearchContext: true, resultsDiscovered: 4, resultsVisited: 1 });
  assert.equal(t.status, 'RESULTS_DISCOVERED');
});

// ── ENREG ────────────────────────────────────────────────────────────────
test('enreg: no search attempted -> NOT_STARTED', () => {
  const t = computeEnregTraversal({});
  assert.equal(t.status, 'NOT_STARTED');
});

test('enreg: searched but no exact entity match and nothing else happened -> SOURCE_EXHAUSTED (a real confirmed negative)', () => {
  const t = computeEnregTraversal({ searchMethod: 'ID_CODE', searchValue: '123', exactEntityMatched: false });
  assert.equal(t.status, 'SOURCE_EXHAUSTED');
});

test('enreg: entity matched but info icon not yet clicked -> RESULTS_DISCOVERED', () => {
  const t = computeEnregTraversal({ searchMethod: 'ID_CODE', searchValue: '123', exactEntityMatched: true, infoIconClicked: false });
  assert.equal(t.status, 'RESULTS_DISCOVERED');
});

test('enreg: full chain through historical records read -> SOURCE_EXHAUSTED', () => {
  const t = computeEnregTraversal({ searchMethod: 'ID_CODE', searchValue: '123', exactEntityMatched: true, infoIconClicked: true, entityPageOpened: true, latestApplicationOpened: true, preparedDocumentsOpened: true, latestRegistryExtractOpened: true, fullExtractRead: true, historicalRelevantRecordsRead: true });
  assert.equal(t.status, 'SOURCE_EXHAUSTED');
});

test('enreg: extract opened but not fully read -> DOCUMENTS_TRAVERSED', () => {
  const t = computeEnregTraversal({ searchMethod: 'ID_CODE', searchValue: '123', exactEntityMatched: true, infoIconClicked: true, entityPageOpened: true, latestApplicationOpened: true, preparedDocumentsOpened: true, latestRegistryExtractOpened: true, fullExtractRead: false });
  assert.equal(t.status, 'DOCUMENTS_TRAVERSED');
});
