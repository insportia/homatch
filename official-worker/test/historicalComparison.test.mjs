// historicalComparison.test.mjs — documents/HistoricalComparison.ts. Its
// output shape is contract-verified (not guessed) against the ACTUAL
// deployed research-agent Supabase function (fetched live via
// mcp__Supabase__get_edge_function, v17): it reads
// `browserOfficial.historicalComparison.available`,
// `.documentsConsidered`, and `.comparisons[].addedInNewer/
// removedFromOlder`, citing `.olderDocument`/`.newerDocument` (each
// {url,date,title}) — and passes the worker's historicalComparison object
// through to the final report UNCHANGED, where VerifyPage.tsx renders it
// against that exact same {available,reason?,documentsConsidered?,
// chronology?,comparisons?} type. This is why the shape here must match
// precisely, not just carry equivalent information.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHistoricalComparison } from '../.tstest-build/documents/HistoricalComparison.js';

function doc(overrides = {}) {
  return {
    id: overrides.id || `doc_${Math.random().toString(36).slice(2)}`,
    source: 'tas',
    parentItemId: null,
    title: null,
    documentType: 'ONLINE_DOCUMENT',
    documentDate: null,
    url: 'https://tas.ge/doc/1',
    pageCount: null,
    pagesRead: 1,
    complete: true,
    rawText: '',
    sha256: null,
    extractedEvidenceIds: [],
    discoveredEntityIds: [],
    ...overrides,
  };
}

test('buildHistoricalComparison: fewer than 2 dated complete documents is available:false with a reason, never a fabricated comparison', () => {
  const empty = buildHistoricalComparison([]);
  assert.equal(empty.available, false);
  assert.ok(empty.reason);
  assert.equal(empty.comparisons, undefined);

  const one = buildHistoricalComparison([doc({ documentDate: '01.01.2020', rawText: 'a'.repeat(30) })]);
  assert.equal(one.available, false);
});

test('buildHistoricalComparison: an incomplete document is never used even if dated', () => {
  const docs = [
    doc({ id: 'd1', documentDate: '01.01.2020', rawText: 'owner: A\nstatus: active\n'.repeat(3), complete: false }),
    doc({ id: 'd2', documentDate: '01.01.2021', rawText: 'owner: A\nstatus: active\n'.repeat(3) }),
  ];
  assert.equal(buildHistoricalComparison(docs).available, false);
});

test('buildHistoricalComparison: two dated documents produce one comparison entry with olderDocument/newerDocument refs and line-level diffs', () => {
  const older = doc({ id: 'd_old', source: 'tas', url: 'https://tas.ge/doc/old', title: 'TAS extract 2020', documentDate: '15.03.2020', rawText: 'cadastral code: 01.18.06\nencumbrance: none\n' });
  const newer = doc({ id: 'd_new', source: 'tas', url: 'https://tas.ge/doc/new', title: 'TAS extract 2025', documentDate: '20.06.2025', rawText: 'cadastral code: 01.18.06\nencumbrance: mortgage registered\n' });
  const result = buildHistoricalComparison([newer, older]); // order-independent — sorts internally

  assert.equal(result.available, true);
  assert.equal(result.documentsConsidered, 2);
  assert.equal(result.chronology.length, 2);
  assert.equal(result.chronology[0].url, 'https://tas.ge/doc/old');
  assert.equal(result.chronology[1].url, 'https://tas.ge/doc/new');

  assert.equal(result.comparisons.length, 1);
  const cmp = result.comparisons[0];
  assert.deepEqual(cmp.olderDocument, { url: 'https://tas.ge/doc/old', date: '15.03.2020', title: 'TAS extract 2020' });
  assert.deepEqual(cmp.newerDocument, { url: 'https://tas.ge/doc/new', date: '20.06.2025', title: 'TAS extract 2025' });
  assert.equal(cmp.changed, true);
  assert.deepEqual(cmp.addedInNewer, ['encumbrance: mortgage registered']);
  assert.deepEqual(cmp.removedFromOlder, ['encumbrance: none']);
  assert.ok(cmp.proof && cmp.proof.length > 0);
});

test('buildHistoricalComparison: 3+ dated documents produce one comparison per consecutive pair, across sources', () => {
  const d1 = doc({ id: 'd1', source: 'tas', url: 'https://tas.ge/1', documentDate: '01.01.2018', rawText: 'phase: construction\ncode: 01.18\n' });
  const d2 = doc({ id: 'd2', source: 'enreg', url: 'https://enreg.ge/2', documentDate: '01.01.2021', rawText: 'phase: registered\ncode: 01.18\n' });
  const d3 = doc({ id: 'd3', source: 'enreg', url: 'https://enreg.ge/3', documentDate: '01.01.2024', rawText: 'phase: sold\ncode: 01.18\n' });
  const result = buildHistoricalComparison([d2, d3, d1]);

  assert.equal(result.available, true);
  assert.equal(result.documentsConsidered, 3);
  assert.equal(result.comparisons.length, 2);
  assert.deepEqual(result.comparisons[0].addedInNewer, ['phase: registered']);
  assert.deepEqual(result.comparisons[0].removedFromOlder, ['phase: construction']);
  assert.deepEqual(result.comparisons[1].addedInNewer, ['phase: sold']);
  assert.deepEqual(result.comparisons[1].removedFromOlder, ['phase: registered']);
});

test('buildHistoricalComparison: two documents with the same extracted date produce no comparable span', () => {
  const docs = [
    doc({ id: 'd1', documentDate: '01.01.2020', rawText: 'status: active\nline two here\n' }),
    doc({ id: 'd2', documentDate: '01.01.2020', rawText: 'status: dissolved\nline two here\n' }),
  ];
  const result = buildHistoricalComparison(docs);
  assert.equal(result.available, false);
  assert.ok(result.reason);
});
