// workflowAssertions.test.mjs — the pure assertion predicates in each
// workflow's assertions.ts (mandate's named-assertion-function requirement,
// Sections 5/6/9/12-15). These are small but they are exactly the
// functions each *Workflow.ts calls before deciding whether to advance the
// FSM, so a regression here is a regression in the actual gating logic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as msmap from '../.tstest-build/workflows/msmap/assertions.js';
import * as tas from '../.tstest-build/workflows/tas/assertions.js';
import * as mygov from '../.tstest-build/workflows/mygov/assertions.js';
import * as enreg from '../.tstest-build/workflows/enreg/assertions.js';

// ── MSMAP ────────────────────────────────────────────────────────────────
test('msmap.assertRequiredLayersEnabled: both named layers must be on', () => {
  assert.equal(msmap.assertRequiredLayersEnabled(true, true), true);
  assert.equal(msmap.assertRequiredLayersEnabled(true, false), false);
  assert.equal(msmap.assertRequiredLayersEnabled(false, false), false);
});
test('msmap.assertParcelFocused: a click with no confirmed map redraw does NOT count (the exact reported bug)', () => {
  assert.equal(msmap.assertParcelFocused(true, false), false);
  assert.equal(msmap.assertParcelFocused(true, true), true);
});

// ── TAS ──────────────────────────────────────────────────────────────────
test('tas.assertSearchSubmitted: network confirmation counts even if the text-submit flag is false', () => {
  assert.equal(tas.assertSearchSubmitted(false, true), true);
  assert.equal(tas.assertSearchSubmitted(false, false), false);
});
test('tas.assertAllChildrenVisited: visited+skipped must cover every discovered child', () => {
  assert.equal(tas.assertAllChildrenVisited(18, 16, 0), false);
  assert.equal(tas.assertAllChildrenVisited(18, 16, 2), true);
});

// ── MYGOV ────────────────────────────────────────────────────────────────
test('mygov.assertCorrectSearchContext: only HINT_MATCH/CADASTRAL_FIELD_MATCH are trusted', () => {
  assert.equal(mygov.assertCorrectSearchContext('HINT_MATCH'), true);
  assert.equal(mygov.assertCorrectSearchContext('CADASTRAL_FIELD_MATCH'), true);
  assert.equal(mygov.assertCorrectSearchContext('SEARCH_FIELD_MATCH'), false);
  assert.equal(mygov.assertCorrectSearchContext('GENERIC_KEYWORD_MATCH'), false);
  assert.equal(mygov.assertCorrectSearchContext(null), false);
});
test('mygov.assertPropertySearchContextConfirmed: needs BOTH service176 and the registry app', () => {
  assert.equal(mygov.assertPropertySearchContextConfirmed(true, false), false);
  assert.equal(mygov.assertPropertySearchContextConfirmed(true, true), true);
});

// ── ENREG ────────────────────────────────────────────────────────────────
test('enreg.assertIdentifierPriorityRespected: an id-code MUST NOT be preferred-away in favor of a name search', () => {
  assert.equal(enreg.assertIdentifierPriorityRespected(true, 'NAME'), false);
  assert.equal(enreg.assertIdentifierPriorityRespected(true, 'ID_CODE'), true);
  assert.equal(enreg.assertIdentifierPriorityRespected(false, 'NAME'), true);
});
test('enreg.assertExactEntityMatch: an id-code match requires the exact code, not a partial/substring one', () => {
  assert.equal(enreg.assertExactEntityMatch('entity 405123456 found', 'ID_CODE', '405123456'), true);
  assert.equal(enreg.assertExactEntityMatch('entity 4051234 found', 'ID_CODE', '405123456'), false);
});
test('enreg.selectLatestApplicationDate: max(date), never the first row (mandate\'s explicit rule)', () => {
  assert.equal(enreg.selectLatestApplicationDate(['01.01.2020', '15.03.2025', '30.06.2022']), '15.03.2025');
});
