// sample-trace.mjs — machine-readable demonstration trace, requested before
// any further deploy: "show me a MACHINE-READABLE sample trace for the
// cadastral test demonstrating every required step... Only after I approve
// that trace should we push/deploy and run production again."
//
// HONESTY NOTE: this script does NOT drive a real browser against
// ms.gov.ge/tas.ge/my.gov.ge/enreg.reestri.gov.ge — this sandbox has never
// been able to reach any of those hosts (confirmed repeatedly across this
// project). What IS real here: every `traversal` object below is produced
// by ACTUALLY CALLING the real, unit-tested pure functions in
// src/lib/traversal.js (the exact code collect() calls in index.js) against
// input numbers taken directly from the production run the user reported
// (job for 01.18.06.019.055.03.01.603: TAS's own "სულ მოიძებნა: 18" counter,
// 0 documents actually read; MyGov's false "no matching record" with no
// CAPTCHA ever shown). This proves the STATE MACHINE'S OUTPUT for those
// exact numbers, not that the new browser-interaction code has been run
// live — that part remains NOT LIVE VERIFIED until a real production job is
// approved and executed on the deployed worker.
import { computeMsmapTraversal, computeTasTraversal, computeMygovTraversal, computeEnregTraversal } from '../src/lib/traversal.js';

const CADASTRAL_CODE = '01.18.06.019.055.03.01.501';

const trace = {
  testCadastralCode: CADASTRAL_CODE,
  generatedAt: new Date().toISOString(),
  note: 'Traversal objects below are the REAL output of src/lib/traversal.js (unit-tested, 26 passing tests) called with representative inputs. Browser-interaction fields (msmap suggestionSelected, tas resultsDiscovered/resultsVisited, mygov correctSearchContext, enreg step booleans) are NOT live-executed in this sandbox — see the top-of-file honesty note. The point of this trace is to prove the STATUS-DECISION LOGIC itself, which is what the user\'s critique said was structurally wrong.',
  sources: {}
};

// ── MSMAP — full 18-step chain reaching genuine SOURCE_EXHAUSTED ──────────
trace.sources.msmap_full_success_scenario = {
  scenario: 'searchText field found+verified, unified-search suggestion matched, map redraw network-confirmed, full NAPR deep-dive chain completed including reading a document off the "უახლესი ინფორმაცია" page',
  topLevelStatus: 'SEARCH_CONFIRMED',
  traversal: computeMsmapTraversal({
    queryEntered: true, suggestionSelected: true, layersEnabled: true,
    identifyActivated: true, parcelClicked: true, infoPopupOpened: true,
    naprOpened: true, latestInformationOpened: true, documentsRead: true,
  })
};
trace.sources.msmap_suggestion_only_scenario = {
  scenario: 'THE BUG BEING FIXED: a suggestion click + map redraw alone (the OLD sufficient condition for "done") — must now report an INCOMPLETE traversal, not SOURCE_EXHAUSTED',
  topLevelStatus: 'SEARCH_CONFIRMED',
  traversal: computeMsmapTraversal({ queryEntered: true, suggestionSelected: true, infoPopupOpened: false }),
  assertionThisProves: 'status !== SOURCE_EXHAUSTED even though the top-level evidence status is SEARCH_CONFIRMED'
};

// ── TAS — the exact production discrepancy the user reported ─────────────
trace.sources.tas_production_bug_reproduced = {
  scenario: "TAS's own grid counter said 'სულ მოიძებნა: 18' (18 municipal records) but the OLD anchor-only row selector matched 0 rows (ExtJS grids have no <a> tags) — reproducing the exact 'documentsRead: 0 with no historical comparison possible' symptom from the production run for 01.18.06.019.055.03.01.603",
  topLevelStatus: 'SEARCH_CONFIRMED',
  traversal: computeTasTraversal({
    originalCadastralCode: CADASTRAL_CODE, resolvedSearchCadastralCode: CADASTRAL_CODE,
    searchSubmitted: true, resultsDiscovered: 18, resultsVisited: 0,
    documentsDiscovered: 0, documentsRead: 0, skippedReasonsCount: 0,
  }),
  assertionThisProves: 'status is RESULTS_DISCOVERED with unvisitedRelevantItems=18, NEVER SOURCE_EXHAUSTED — the old code had no such field at all and let synthesis treat this as complete research'
};
trace.sources.tas_after_grid_dblclick_fix = {
  scenario: 'same 18 discovered rows, now opened via the new GRID_ROW_DBLCLICK fallback path (exhaustResultRows) — all 18 visited, each yielding one document',
  topLevelStatus: 'SEARCH_CONFIRMED',
  traversal: computeTasTraversal({
    originalCadastralCode: CADASTRAL_CODE, resolvedSearchCadastralCode: CADASTRAL_CODE,
    searchSubmitted: true, resultsDiscovered: 18, resultsVisited: 18,
    documentsDiscovered: 18, documentsRead: 18, skippedReasonsCount: 0,
  }),
  assertionThisProves: 'only NOW does status legitimately reach SOURCE_EXHAUSTED, with unvisitedRelevantItems=0'
};

// ── MYGOV — the exact false-negative bug the user reported ───────────────
trace.sources.mygov_production_bug_reproduced = {
  scenario: "the naprweb Angular app's known-good hint selectors failed, so the OLD code fell back to candidateRankedRetry() and filled/submitted WHATEVER input field ranked best (a generic or search-labelled field, not a confirmed cadastral field) — the page then showed negative text with NO CAPTCHA ever appearing, and the OLD collect() read that as a confident NO_RESULT_CONFIRMED",
  topLevelStatus_OLD_BEHAVIOR: 'NO_RESULT_CONFIRMED (WRONG — this is the exact bug reported)',
  topLevelStatus_NEW_BEHAVIOR: 'WRONG_SEARCH_CONTEXT (contributes ZERO confirmed facts)',
  traversal: computeMygovTraversal({
    service176Opened: true, registryAppOpened: true, correctSearchContext: false,
    queryEntered: true, searchSubmitted: true, captchaEncountered: false,
    noResultConfirmed: true, wrongSearchContext: true,
  }),
  assertionThisProves: 'status is WRONG_SEARCH_CONTEXT, never SOURCE_EXHAUSTED/NO_RESULT-equivalent, whenever the field was only a low-confidence fallback guess'
};
trace.sources.mygov_correct_context_confirmed_empty = {
  scenario: 'the known-good HINT selector (or a CADASTRAL_FIELD_MATCH candidate) was actually used, and the source genuinely returned zero — this IS trustworthy evidence',
  topLevelStatus: 'NO_RESULT_CONFIRMED',
  traversal: computeMygovTraversal({
    service176Opened: true, registryAppOpened: true, correctSearchContext: true,
    queryEntered: true, searchSubmitted: true, resultsDiscovered: 0, noResultConfirmed: true,
  }),
  assertionThisProves: 'SOURCE_EXHAUSTED is reachable ONLY through a trusted search context'
};
trace.sources.mygov_captcha_then_skip = {
  scenario: 'a CAPTCHA genuinely appeared (the case the user says MUST occur before any NO_RESULT is possible on a properly-gated search) and the user chose to skip it',
  topLevelStatus: 'SKIPPED_HUMAN_VERIFICATION',
  traversal: computeMygovTraversal({
    service176Opened: true, registryAppOpened: true, correctSearchContext: true,
    queryEntered: true, searchSubmitted: true, captchaEncountered: true, skippedHumanVerification: true,
  }),
};

// ── ENREG — full workflow, now actually implemented (was: generic fallback only) ──
trace.sources.enreg_full_chain = {
  scenario: 'a company (name+id-code) discovered on TAS/MSMAP/MyGov triggers this ENREG step: searched by ID_CODE, exact match confirmed, info icon opened the entity page, latest application found and opened, prepared documents opened, latest registry extract opened and fully read, remaining historical records read',
  topLevelStatus: 'SEARCH_CONFIRMED',
  traversal: computeEnregTraversal({
    entitiesQueued: 1, searchMethod: 'ID_CODE', searchValue: '405123456',
    exactEntityMatched: true, infoIconClicked: true, verificationStepCompleted: true,
    entityPageOpened: true, latestApplicationDate: '12.03.2025', latestApplicationOpened: true,
    preparedDocumentsOpened: true, latestRegistryExtractOpened: true, fullExtractRead: true,
    historicalRelevantRecordsRead: true,
  })
};
trace.sources.enreg_no_exact_match = {
  scenario: 'ID_CODE searched but no exact match found in the results — a real, confirmed negative with nothing left to traverse',
  topLevelStatus: 'NO_RESULT_CONFIRMED',
  traversal: computeEnregTraversal({ searchMethod: 'ID_CODE', searchValue: '405123456', exactEntityMatched: false, noResultConfirmed: true }),
};

console.log(JSON.stringify(trace, null, 2));
