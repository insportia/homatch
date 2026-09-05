// transitions.test.mjs — the hard, code-level completeness invariants
// (mandate Section 18) plus the legacy-shaped traversal snapshots. Imports
// the COMPILED output of src/state/transitions.ts (built via
// `tsc -p tsconfig.test.json` into .tstest-build/ — see package.json's
// pretest script). This is real, executable verification of the new FSM
// architecture's decision logic, not merely a syntax check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMsmapTraversal,
  computeTasTraversal,
  computeMygovTraversal,
  computeEnregTraversal,
  canMarkMsmapExhausted,
  canMarkTasExhausted,
  canMarkMygovExhausted,
  canMarkEnregExhausted,
  isSourceExhausted,
} from '../.tstest-build/state/transitions.js';

// ── MSMAP ────────────────────────────────────────────────────────────────
test('msmap: nothing happened yet -> NOT_STARTED', () => {
  assert.equal(computeMsmapTraversal({}).status, 'NOT_STARTED');
});

test('msmap: THE PRODUCTION BUG — suggestion selected + map redraw alone must NOT be exhausted', () => {
  assert.equal(canMarkMsmapExhausted({ queryEntered: true, suggestionSelected: true, infoPopupOpened: false }), false);
  const t = computeMsmapTraversal({ queryEntered: true, suggestionSelected: true, infoPopupOpened: false });
  assert.notEqual(t.status, 'SOURCE_EXHAUSTED');
  assert.equal(t.status, 'RESULTS_DISCOVERED');
});

test('msmap: popup opened but NAPR link never opened -> RESULTS_TRAVERSED, still not exhausted', () => {
  const t = computeMsmapTraversal({ queryEntered: true, suggestionSelected: true, infoPopupOpened: true, naprOpened: false });
  assert.equal(t.status, 'RESULTS_TRAVERSED');
});

test('msmap: full chain complete -> SOURCE_EXHAUSTED', () => {
  const input = { queryEntered: true, suggestionSelected: true, layersEnabled: true, identifyActivated: true, parcelClicked: true, infoPopupOpened: true, naprOpened: true, latestInformationOpened: true, documentsRead: true };
  assert.equal(canMarkMsmapExhausted(input), true);
  const t = computeMsmapTraversal(input);
  assert.equal(t.status, 'SOURCE_EXHAUSTED');
  assert.ok(isSourceExhausted(t));
});

test('msmap: confirmed-empty search with nothing to traverse -> SOURCE_EXHAUSTED', () => {
  const t = computeMsmapTraversal({ queryEntered: true, suggestionSelected: false, noResultConfirmed: true });
  assert.equal(t.status, 'SOURCE_EXHAUSTED');
});

test('msmap: captcha wins over any ladder progress', () => {
  const t = computeMsmapTraversal({ queryEntered: true, suggestionSelected: true, infoPopupOpened: true, naprOpened: true, latestInformationOpened: true, documentsRead: true, captcha: true });
  assert.equal(t.status, 'WAITING_HUMAN');
});

// ── TAS ──────────────────────────────────────────────────────────────────
test('tas: search never submitted -> NOT_STARTED', () => {
  assert.equal(computeTasTraversal({ searchSubmitted: false }).status, 'NOT_STARTED');
});

test('tas: THE MANDATE\'S LITERAL EXAMPLE — 18 discovered, 16 visited MUST make TAS_EXHAUSTED impossible', () => {
  const state = { resultsDiscovered: 18, resultsVisited: 16, documentsDiscovered: 16, documentsRead: 16 };
  assert.equal(canMarkTasExhausted(state), false);
  const t = computeTasTraversal({ searchSubmitted: true, ...state });
  assert.notEqual(t.status, 'SOURCE_EXHAUSTED');
  assert.equal(t.unvisitedRelevantItems, 2);
});

test('tas: 18 discovered, 0 visited (the exact reproduced production bug) -> RESULTS_DISCOVERED, never exhausted', () => {
  const t = computeTasTraversal({ searchSubmitted: true, resultsDiscovered: 18, resultsVisited: 0, documentsDiscovered: 0, documentsRead: 0 });
  assert.equal(t.status, 'RESULTS_DISCOVERED');
  assert.equal(t.unvisitedRelevantItems, 18);
});

test('tas: 18 discovered, all 18 visited, all documents read -> SOURCE_EXHAUSTED', () => {
  const state = { resultsDiscovered: 18, resultsVisited: 18, documentsDiscovered: 18, documentsRead: 18 };
  assert.equal(canMarkTasExhausted(state), true);
  const t = computeTasTraversal({ searchSubmitted: true, ...state });
  assert.equal(t.status, 'SOURCE_EXHAUSTED');
  assert.equal(t.unvisitedRelevantItems, 0);
});

test('tas: all rows visited but a discovered document is still unread -> RESULTS_TRAVERSED', () => {
  const t = computeTasTraversal({ searchSubmitted: true, resultsDiscovered: 3, resultsVisited: 3, documentsDiscovered: 4, documentsRead: 2 });
  assert.equal(t.status, 'RESULTS_TRAVERSED');
});

test('tas: skip reasons legitimately account for the remainder -> SOURCE_EXHAUSTED', () => {
  const t = computeTasTraversal({ searchSubmitted: true, resultsDiscovered: 5, resultsVisited: 3, skippedReasonsCount: 2, documentsDiscovered: 0, documentsRead: 0 });
  assert.equal(t.unvisitedRelevantItems, 0);
  assert.equal(t.status, 'SOURCE_EXHAUSTED');
});

test('tas: confirmed 0 results -> SOURCE_EXHAUSTED with unvisitedRelevantItems 0', () => {
  const t = computeTasTraversal({ searchSubmitted: true, resultsDiscovered: 0, noResultConfirmed: true });
  assert.equal(t.status, 'SOURCE_EXHAUSTED');
  assert.equal(t.unvisitedRelevantItems, 0);
});

test('tas: resultsDiscovered unknown never claims exhaustion', () => {
  const t = computeTasTraversal({ searchSubmitted: true, resultsDiscovered: null });
  assert.equal(t.status, 'SEARCH_CONFIRMED');
  assert.equal(t.unvisitedRelevantItems, null);
});

// ── MYGOV ────────────────────────────────────────────────────────────────
test('mygov: registry app never reached -> NOT_STARTED', () => {
  assert.equal(computeMygovTraversal({ service176Opened: true, registryAppOpened: false }).status, 'NOT_STARTED');
});

test('mygov: THE PRODUCTION BUG — a weak/generic field guess must NEVER reach SOURCE_EXHAUSTED, whatever the page text says', () => {
  const weak = { service176Opened: true, registryAppOpened: true, correctSearchContext: false, queryEntered: true, searchSubmitted: true, noResultConfirmed: true, resultsDiscovered: 0 };
  assert.equal(canMarkMygovExhausted(weak), false);
  const t = computeMygovTraversal(weak);
  assert.equal(t.status, 'WRONG_SEARCH_CONTEXT');
  assert.notEqual(t.status, 'SOURCE_EXHAUSTED');
});

test('mygov: a trusted HINT/CADASTRAL_FIELD_MATCH context with a confirmed empty result -> SOURCE_EXHAUSTED', () => {
  const trusted = { service176Opened: true, registryAppOpened: true, correctSearchContext: true, queryEntered: true, searchSubmitted: true, resultsDiscovered: 0, noResultConfirmed: true };
  assert.equal(canMarkMygovExhausted(trusted), true);
  assert.equal(computeMygovTraversal(trusted).status, 'SOURCE_EXHAUSTED');
});

test('mygov: captcha caps the ladder at WAITING_HUMAN even with correct context', () => {
  const t = computeMygovTraversal({ service176Opened: true, registryAppOpened: true, queryEntered: true, searchSubmitted: true, correctSearchContext: true, captcha: true });
  assert.equal(t.status, 'WAITING_HUMAN');
});

test('mygov: skip is reported distinctly, never as a confirmed result', () => {
  const t = computeMygovTraversal({ service176Opened: true, registryAppOpened: true, queryEntered: true, searchSubmitted: true, correctSearchContext: true, skippedHumanVerification: true });
  assert.equal(t.status, 'SKIPPED_HUMAN_VERIFICATION');
});

test('mygov: results discovered but not all visited -> RESULTS_DISCOVERED', () => {
  const t = computeMygovTraversal({ service176Opened: true, registryAppOpened: true, queryEntered: true, searchSubmitted: true, correctSearchContext: true, resultsDiscovered: 4, resultsVisited: 1, documentsRead: 0 });
  assert.equal(t.status, 'RESULTS_DISCOVERED');
});

// ── ENREG ────────────────────────────────────────────────────────────────
test('enreg: no search attempted -> NOT_STARTED', () => {
  assert.equal(computeEnregTraversal({}).status, 'NOT_STARTED');
});

test('enreg: searched, no exact match, nothing else happened -> SOURCE_EXHAUSTED (a real confirmed negative)', () => {
  const input = { searchMethod: 'ID_CODE', searchValue: '123', exactEntityMatched: false };
  assert.equal(canMarkEnregExhausted(input), true);
  assert.equal(computeEnregTraversal(input).status, 'SOURCE_EXHAUSTED');
});

test('enreg: entity matched but info icon not clicked -> RESULTS_DISCOVERED, not exhausted', () => {
  const input = { searchMethod: 'ID_CODE', searchValue: '123', exactEntityMatched: true, infoIconClicked: false };
  assert.equal(canMarkEnregExhausted(input), false);
  assert.equal(computeEnregTraversal(input).status, 'RESULTS_DISCOVERED');
});

test('enreg: full chain through historical records read -> SOURCE_EXHAUSTED', () => {
  const input = {
    searchMethod: 'ID_CODE',
    searchValue: '123',
    exactEntityMatched: true,
    infoIconClicked: true,
    entityPageOpened: true,
    latestApplicationOpened: true,
    preparedDocumentsOpened: true,
    latestRegistryExtractOpened: true,
    fullExtractRead: true,
    historicalRelevantRecordsRead: true,
  };
  assert.equal(canMarkEnregExhausted(input), true);
  assert.equal(computeEnregTraversal(input).status, 'SOURCE_EXHAUSTED');
});

test('enreg: extract opened but NOT fully read -> DOCUMENTS_TRAVERSED, never exhausted (mandate Section 7\'s pageCount rule)', () => {
  const input = {
    searchMethod: 'ID_CODE',
    searchValue: '123',
    exactEntityMatched: true,
    infoIconClicked: true,
    entityPageOpened: true,
    latestApplicationOpened: true,
    preparedDocumentsOpened: true,
    latestRegistryExtractOpened: true,
    fullExtractRead: false,
  };
  assert.equal(canMarkEnregExhausted(input), false);
  assert.equal(computeEnregTraversal(input).status, 'DOCUMENTS_TRAVERSED');
});
