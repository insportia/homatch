// The document workspace's rules, where they are decidable without a browser.
//
// The status machine is the important half. "Reading document…" forever was
// not a rendering bug — it was a status function that had two branches for
// seven database values and sent everything it did not recognise into the
// spinner. Every one of those seven now has a test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  documentStatus, normalizeDocumentAnalysis, headlineFor, findingCounts,
  suggestCategory, sortDocuments, filterDocuments, isDocumentBusy,
  DOCUMENT_STATUSES, DOCUMENT_STATUS_KEY, EMPTY_ANALYSIS,
} from '../documentModel.ts';

/* ------------------------------------------------------------------ *
 * Status (§11)                                                        *
 * ------------------------------------------------------------------ */

const st = (o) => documentStatus({ analysisState: 'NONE', hasAnalysis: false, ...o });

test('every database analysis_state maps to a status, none falls into the spinner', () => {
  assert.equal(st({ analysisState: 'NONE' }), 'UPLOADED');
  assert.equal(st({ analysisState: 'QUEUED' }), 'QUEUED');
  assert.equal(st({ analysisState: 'DONE', hasAnalysis: true }), 'READY');
  assert.equal(st({ analysisState: 'FAILED' }), 'FAILED');
  assert.equal(st({ analysisState: 'UNSUPPORTED' }), 'FAILED');
  assert.equal(st({ analysisState: 'REQUIRES_OCR' }), 'FAILED');
});

test('THE STUCK DOCUMENT: RUNNING with nothing behind it is a stopped attempt, not progress', () => {
  // The production row that read "Reading document…" from 13:52 on
  // 2026-09-11 onwards. No live job, no analysis: the request that set the
  // marker was abandoned and nothing was ever going to move it.
  assert.equal(st({ analysisState: 'RUNNING', hasAnalysis: false }), 'FAILED');
});

test('RUNNING with a complete analysis behind it is READY, not re-bought', () => {
  // The same production row's other half: the analysis DID finish, at
  // 13:24:46, with nine clauses. Only the flag was lost. Showing a spinner
  // over a finished analysis — or deleting it to run again — both charge the
  // customer for work they already have.
  assert.equal(st({ analysisState: 'RUNNING', hasAnalysis: true }), 'READY');
});

test('a live job outranks a stale row while it is running', () => {
  assert.equal(st({ analysisState: 'NONE', jobState: 'QUEUED' }), 'QUEUED');
  assert.equal(st({ analysisState: 'NONE', jobState: 'CANCELLABLE' }), 'CANCELLABLE');
  assert.equal(st({ analysisState: 'NONE', jobState: 'COMMITTED' }), 'COMMITTED');
  assert.equal(st({ analysisState: 'RUNNING', jobState: 'PROCESSING', jobStage: 'EXTRACTING' }), 'EXTRACTING');
  assert.equal(st({ analysisState: 'RUNNING', jobState: 'PROCESSING', jobStage: 'ANALYZING' }), 'ANALYZING');
  assert.equal(st({ analysisState: 'NONE', jobState: 'CANCELLED' }), 'CANCELLED');
});

test('a finished analysis outranks a stale job row', () => {
  // The job registry is mirrored on a tick, so it can lag by seconds. The
  // result is on the document, and the result is what the customer wants.
  assert.equal(st({ analysisState: 'DONE', hasAnalysis: true, jobState: 'PROCESSING' }), 'READY');
});

test('archived wins over everything, including work in progress', () => {
  assert.equal(st({ analysisState: 'RUNNING', hasAnalysis: true, archivedAt: '2026-09-12T00:00:00Z' }), 'ARCHIVED');
});

test('every status has a translation key and only busy ones read as busy', () => {
  for (const s of DOCUMENT_STATUSES) {
    assert.ok(DOCUMENT_STATUS_KEY[s], `${s} has no key`);
  }
  assert.equal(isDocumentBusy('EXTRACTING'), true);
  assert.equal(isDocumentBusy('ANALYZING'), true);
  assert.equal(isDocumentBusy('READY'), false);
  assert.equal(isDocumentBusy('FAILED'), false);
  assert.equal(isDocumentBusy('ARCHIVED'), false);
});

/* ------------------------------------------------------------------ *
 * The analysis, normalised                                            *
 * ------------------------------------------------------------------ */

const FULL = {
  documentType: 'SALE_AGREEMENT',
  summary: ['Sale agreement dated 2026-09-10, purchase price $160,000.'],
  clauses: [
    { label: 'Price', plain: 'USD 160,000', quote: 'the price is...', page: 2, attention: 'NORMAL' },
    { label: 'Penalty', plain: 'Buyer only', quote: 'the buyer shall...', page: 3, attention: 'ONE_SIDED' },
  ],
  obligations: [{ party: 'BUYER', label: 'Pay deposit', plain: '10% on signing', quote: 'q', page: 1 }],
  deadlines: [{ label: 'Completion', value: '2026-12-01', quote: 'q', page: 4 }],
  financial: [{ label: 'Price', value: '$160,000', quote: 'q', page: 2 }],
  missingProtections: [{ label: 'No penalty on the seller', plain: 'Only the buyer is penalised.' }],
  questions: ['What happens if completion slips?'],
  pages: 6,
  containsInstructionLikeText: false,
  analysedAt: '2026-09-11T13:24:46.701Z',
};

test('THE OTHER UNGUARDED filter: an analysis with no clauses does not crash a renderer', () => {
  // ContractAnalysisPanel did `analysis.clauses.filter(...)` straight off a
  // jsonb blob — the same shape of bug that crashed the Verify result page.
  const noClauses = { ...FULL, clauses: undefined };
  assert.throws(() => noClauses.clauses.filter(Boolean), TypeError);
  const n = normalizeDocumentAnalysis(noClauses);
  assert.deepEqual(n.clauses, []);
  assert.equal(n.clauses.filter((c) => c.attention !== 'NORMAL').length, 0);
});

test('every array on a normalised analysis is present whatever arrives', () => {
  for (const raw of [FULL, { documentType: 'X' }, { summary: ['only this'] }]) {
    const n = normalizeDocumentAnalysis(raw);
    for (const k of ['summary', 'clauses', 'obligations', 'deadlines', 'financial', 'missingProtections', 'questions']) {
      assert.ok(Array.isArray(n[k]), `${k} is not an array`);
    }
  }
});

test('nothing at all normalises to null, so "not read" stays distinguishable from "read and empty"', () => {
  for (const raw of [null, undefined, {}, '', 0, []]) {
    assert.equal(normalizeDocumentAnalysis(raw), null);
  }
  // An object shaped like an analysis but carrying nothing is also nothing.
  assert.equal(normalizeDocumentAnalysis({ summary: [], clauses: [], questions: [] }), null);
});

test('an unknown attention value degrades to standard rather than colouring a clause', () => {
  const n = normalizeDocumentAnalysis({ clauses: [{ label: 'X', attention: 'CATASTROPHIC' }] });
  assert.equal(n.clauses[0].attention, 'NORMAL');
});

test('the empty analysis constant is genuinely empty', () => {
  assert.deepEqual(findingCounts(EMPTY_ANALYSIS), { total: 0, attention: 0 });
  assert.deepEqual(findingCounts(null), { total: 0, attention: 0 });
});

test('counts separate "how much did we find" from "how much needs a look"', () => {
  const n = normalizeDocumentAnalysis(FULL);
  assert.equal(findingCounts(n).total, 2 + 1 + 1 + 1 + 1);
  // one ONE_SIDED clause plus one missing protection
  assert.equal(findingCounts(n).attention, 2);
});

/* ------------------------------------------------------------------ *
 * The collapsed summary (§14)                                         *
 * ------------------------------------------------------------------ */

test('the card summary is a sentence about the document, never raw extracted text', () => {
  const n = normalizeDocumentAnalysis(FULL);
  assert.equal(headlineFor({ analysis: n }), 'Sale agreement dated 2026-09-10, purchase price $160,000.');
  assert.equal(headlineFor({ storedHeadline: 'Ownership extract with 2 owners', analysis: n }), 'Ownership extract with 2 owners');
  // No analysis means no invented sentence — the caller shows the status.
  assert.equal(headlineFor({ analysis: null }), null);
  assert.equal(headlineFor({ analysis: normalizeDocumentAnalysis({ documentType: 'X' }) }), null);
});

/* ------------------------------------------------------------------ *
 * Categories (§13)                                                    *
 * ------------------------------------------------------------------ */

test('the customer\'s own category always wins over a guess', () => {
  assert.equal(suggestCategory({ chosen: 'INVOICE', documentType: 'SALE_AGREEMENT', filename: 'contract.pdf' }), 'INVOICE');
});

test('classification uses what the analyser found, and reads Georgian filenames', () => {
  assert.equal(suggestCategory({ documentType: 'SALE_AGREEMENT' }), 'CONTRACT');
  assert.equal(suggestCategory({ filename: 'ნასყიდობა-2026.pdf' }), 'CONTRACT');
  assert.equal(suggestCategory({ filename: 'ამონაწერი.pdf' }), 'REGISTRY_EXTRACT');
  assert.equal(suggestCategory({ filename: 'floor plan 97sqm.pdf' }), 'FLOOR_PLAN');
  assert.equal(suggestCategory({ filename: 'invoice-88.pdf' }), 'INVOICE');
  // Unknown is OTHER, not a confident wrong guess.
  assert.equal(suggestCategory({ filename: 'scan_0012.pdf' }), 'OTHER');
  assert.equal(suggestCategory({}), 'OTHER');
});

/* ------------------------------------------------------------------ *
 * Sorting and searching (§12)                                         *
 * ------------------------------------------------------------------ */

const DOCS = [
  { id: 'a', name: 'Zebra contract.pdf', createdAt: '2026-09-01T00:00:00Z', status: 'READY' },
  { id: 'b', name: 'Alpha extract.pdf', createdAt: '2026-09-10T00:00:00Z', status: 'FAILED' },
  { id: 'c', name: 'Middle plan.pdf', createdAt: '2026-09-05T00:00:00Z', status: 'ANALYZING' },
];

test('sorting: newest, oldest and name each do what they say', () => {
  assert.deepEqual(sortDocuments(DOCS, 'NEWEST').map((d) => d.id), ['b', 'c', 'a']);
  assert.deepEqual(sortDocuments(DOCS, 'OLDEST').map((d) => d.id), ['a', 'c', 'b']);
  assert.deepEqual(sortDocuments(DOCS, 'NAME').map((d) => d.id), ['b', 'c', 'a']);
});

test('sorting by status puts what needs the customer first, not alphabetically', () => {
  // FAILED before ANALYZING before READY: the one that needs a decision leads.
  assert.deepEqual(sortDocuments(DOCS, 'STATUS').map((d) => d.id), ['b', 'c', 'a']);
});

test('sorting never mutates the list it was given', () => {
  const before = DOCS.map((d) => d.id);
  sortDocuments(DOCS, 'NAME');
  assert.deepEqual(DOCS.map((d) => d.id), before);
});

test('search covers the name, the summary line and the category', () => {
  const items = [
    { name: 'scan_0012.pdf', headline: 'Sale agreement, price $160,000', category: 'CONTRACT' },
    { name: 'extract.pdf', headline: 'Two registered owners', category: 'REGISTRY_EXTRACT' },
  ];
  assert.equal(filterDocuments(items, 'sale').length, 1);
  assert.equal(filterDocuments(items, 'owners').length, 1);
  assert.equal(filterDocuments(items, 'registry').length, 1);
  assert.equal(filterDocuments(items, '').length, 2);
  assert.equal(filterDocuments(items, '   ').length, 2);
  assert.equal(filterDocuments(items, 'nothing here').length, 0);
});
