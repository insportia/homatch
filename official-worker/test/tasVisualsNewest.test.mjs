// tasVisualsNewest.test.mjs — the gallery prefers the NEWEST cases'
// pictures (2026-10-11, job eeefada9, Digomi, 17 TAS cases 2012–2026).
//
// What went wrong there: the shortlist was ranked on the attachment's own
// date (TAS sends none) with a recency bonus that stopped growing in 2015,
// so 2012 photo/montage PDFs took the 14 files-opened slots; the 2024–2025
// .jpg renders were downloaded (outcome IMAGE) and then dropped because
// budget-exempt images shared that 14-file bound; "fotomontaji" was a PHOTO.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rankVisualCandidates, selectVisualShortlist, OLD_CASE_FILE_MAX, OLD_CASE_YEARS, yearsBefore, VISUAL_FILE_MAX } from '../.tstest-build/workflows/tas/api/visuals.js';
import { classifyVisualMeta } from '../.tstest-build/workflows/tas/api/visualClassify.js';
import { isBudgetExemptVisualPdf, BUDGET_EXEMPT_PDF_MAX_BYTES, VISUAL_EXEMPT_FILE_MAX } from '../.tstest-build/workflows/tas/api/TasApiWorkflow.js';

const PARCEL = '01.72.14.040.030';
// The real visual-looking attachments of eeefada9 (file name, case, filing date).
const CASES = {
  95157: '2012-12-04', 144566: '2013-07-06', 137104: '2013-06-07', 79674: '2012-09-12', 81025: '2012-09-18',
  980594: '2023-07-26', 1014318: '2024-02-07', 1022993: '2024-03-12', 1051702: '2024-08-05', 1059939: '2024-09-30',
  1078892: '2025-02-20', 1087185: '2025-04-14', 1110027: '2025-09-23',
};
const FILES = [
  [95157, 'fotomontaji da aqsiometriuli xedebi.pdf'], [95157, 'foto.pdf'], [95157, 'f5uo5 copy.jpg'], [95157, 'f5uo6 copy.jpg'], [95157, 'f5uo7 copy.jpg'],
  [95157, 'fasadebi z.pdf'], [95157, 'gegmebi z.pdf'], [95157, 'jrilebi z.pdf'], [95157, 'gengegmaz.pdf'],
  [144566, 'Render.pdf'], [144566, 'R-001.jpg'], [144566, 'R-002.jpg'], [144566, 'House.jpg'], [144566, 'photo.pdf'],
  [137104, '10.jpg'], [137104, '11.jpg'], [137104, '12.jpg'], [79674, 'montaji pdf.pdf'], [81025, 'montajii.pdf'],
  [980594, 'ფოტო.pdf'], [1014318, '2.jpg'], [1014318, '3.jpg'], [1014318, '4.jpg'], [1014318, 'fotomontaji.pdf'], [1014318, 'არსებული ფოტოები.pdf'],
  [1022993, '2.jpg'], [1022993, '3.jpg'], [1022993, 'მონტაჟი2-1.jpg'], [1022993, 'ფოტოები.pdf'], [1022993, 'ფასადები 12.03.pdf'],
  [1051702, 'ფოტო 05-08.pdf'], [1059939, 'ფოტო 05-08.pdf'],
  [1078892, 'რენდ1.jpg'], [1078892, 'რენდ2.jpg'], [1078892, 'რენდ3.jpg'], [1078892, '1.jpg'], [1078892, '2.jpg'], [1078892, '3.jpg'],
  [1078892, 'ფოტომონტაჟი.pdf'], [1078892, 'ფასადები 20.02.pdf'], [1078892, 'ფასადები 14,03.pdf'],
  [1087185, 'ფოტო 14-04-2025.pdf'],
  [1110027, '1.jpg'], [1110027, '2.jpg'], [1110027, '3.jpg'], [1110027, 'ფოტომონტაჟი.pdf'], [1110027, 'ფასადები 27,12.pdf'],
];
const input = () => FILES.map(([doc, fileName], i) => ({
  attachedFileId: String(5_000_000 + i), motionId: null, fileName, description: null, date: null, sizeBytes: null,
  extension: /\.jpg$/i.test(fileName) ? 'jpg' : 'pdf', documentId: String(doc), caseCadastralCodes: [PARCEL], caseDate: `${CASES[doc]}T10:00:00.000Z`,
}));

test('photomontage, axonometric views and რენდ are renders, never photographs', () => {
  for (const n of ['fotomontaji da aqsiometriuli xedebi.pdf', 'ფოტომონტაჟი.pdf', 'fotomontaji.pdf', 'მონტაჟი2-1.jpg', 'რენდ1.jpg', 'montaji pdf.pdf', 'SeTanxmebuli monraJi.pdf']) {
    assert.equal(classifyVisualMeta({ fileName: n }).kind, 'RENDER', n);
  }
  // A demolition or an installation is not a montage; real photographs stay photographs.
  assert.notEqual(classifyVisualMeta({ fileName: 'დემონტაჟის პროექტის ექსპერტიზა.pdf' })?.kind, 'RENDER');
  assert.notEqual(classifyVisualMeta({ fileName: 'ლიფტის მონტაჟი.pdf' })?.kind, 'RENDER');
  for (const n of ['foto.pdf', 'ფოტო 14-04-2025.pdf', 'არსებული ფოტოები.pdf']) assert.equal(classifyVisualMeta({ fileName: n }).kind, 'PHOTO', n);
});

test('ranking is newest-case first, measured from the newest case (not from 2005, not from a missing file date)', () => {
  const ranked = rankVisualCandidates(input(), { parcel: PARCEL });
  const score = (doc, name) => ranked.find((c) => c.documentId === String(doc) && c.fileName === name).score;
  assert.ok(score(1078892, 'რენდ1.jpg') > score(144566, 'Render.pdf'), 'a 2013 render outranks the 2025 renders');
  assert.ok(score(1087185, 'ფოტო 14-04-2025.pdf') > score(95157, 'foto.pdf'), 'a 2012 photo outranks the 2025 dated photos');
  assert.ok(score(1110027, '1.jpg') > score(95157, 'f5uo5 copy.jpg'));
  assert.equal(yearsBefore('2012-12-04', '2025-09-23') > OLD_CASE_YEARS, true);
});

test('the shortlist opens the newest pictures and at most a few files of cases five years older', () => {
  const slots = selectVisualShortlist(rankVisualCandidates(input(), { parcel: PARCEL }));
  assert.ok(slots.length <= VISUAL_FILE_MAX);
  const old = slots.filter((s) => Number(s.candidate.caseDate.slice(0, 4)) < 2020);
  assert.ok(old.length <= OLD_CASE_FILE_MAX, `${old.length} files of 2012–2013 cases opened`);
  const latest = slots.find((s) => s.role === 'LATEST_RENDER');
  assert.equal(latest.candidate.documentId, '1110027', 'the latest render is not from the newest case');
  const earliest = slots.find((s) => s.role === 'EARLIEST_RENDER');
  assert.ok(earliest && earliest.candidate.caseDate.startsWith('2012'), 'the original 2012 design is no longer shown at all');
  // "1.jpg" of two different cases are different files.
  const ones = slots.filter((s) => s.candidate.fileName === '1.jpg').map((s) => s.candidate.documentId);
  assert.ok(ones.length <= 2 && new Set(ones).size === ones.length);
  for (const n of ['რენდ1.jpg', 'ფოტო 14-04-2025.pdf']) assert.ok(slots.some((s) => s.candidate.fileName === n), `${n} not opened`);
});

test('visual-named PDFs are budget-exempt within a byte bound; paperwork and demolition are not', () => {
  assert.equal(isBudgetExemptVisualPdf('ფოტომონტაჟი.pdf', 'pdf', null), true);
  assert.equal(isBudgetExemptVisualPdf('ფოტო 14-04-2025.pdf', 'pdf', 4_000_000), true);
  assert.equal(isBudgetExemptVisualPdf('ფასადები 27,12.pdf', 'pdf', null), true);
  assert.equal(isBudgetExemptVisualPdf('ფოტომონტაჟი.pdf', 'pdf', BUDGET_EXEMPT_PDF_MAX_BYTES + 1), false, 'unbounded');
  assert.equal(isBudgetExemptVisualPdf('მინდობილობა.pdf', 'pdf', 1000), false);
  assert.equal(isBudgetExemptVisualPdf('დემონტაჟის პროექტი.pdf', 'pdf', 1000), false);
  assert.equal(isBudgetExemptVisualPdf('ფოტო.jpg', 'jpg', 1000), false, 'images have their own exemption');
});

test('budget-exempt pictures no longer share the shortlist bound; the gallery replaces old-case assets with newer ones', () => {
  const src = readFileSync(new URL('../src/workflows/tas/api/TasApiWorkflow.ts', import.meta.url), 'utf8');
  assert.ok(VISUAL_EXEMPT_FILE_MAX >= 12);
  assert.match(src, /if \(exemptOpened >= VISUAL_EXEMPT_FILE_MAX\) return undefined;/);
  assert.ok(!/visualFilesOpened \?\? 0\) < VISUAL_FILE_MAX \? processVisual/.test(src), 'exempt images are still dropped once the shortlist opened 14 files');
  assert.match(src, /evictOlder\(rec, recDate\)/);
  assert.match(src, /else if \(visualPdf\) enqueueExemptImage\(a\.attachedFileId, r\.bytes, true\)/);
  assert.match(src, /caseDate: fileDateOf\(j\.docId, j\.a\)/);
});

test('recovery opens a visual-named PDF for its embedded pictures and calls a photomontage a render', async () => {
  const { recoverTasFiles } = await import('../.tstest-build/workflows/tas/api/tasFileRecovery.js');
  const { pdfWithJpegs } = await import('./fixtures/tas/priorityFixture.mjs');
  const fetcher = async (url) => {
    const id = new URL(String(url)).searchParams.get('attachedFileId');
    return new Response(pdfWithJpegs(`m${id}`, 2, Number(id) % 97), { status: 200, headers: { 'content-type': 'application/pdf' } });
  };
  const out = await recoverTasFiles([
    { attachedFileId: '5035666', documentId: '1110027', fileName: 'ფოტომონტაჟი.pdf' },
    { attachedFileId: '4867063', documentId: '1087185', fileName: 'ფოტო 14-04-2025.pdf' },
  ], { fetcher, minGapMs: 0, parcel: PARCEL });
  assert.deepEqual(out.files.map((f) => f.outcome), ['RECOVERED', 'RECOVERED']);
  const kinds = (id) => out.visuals.filter((v) => v.attachedFileId === id).map((v) => v.kind);
  assert.ok(kinds('5035666').length >= 1 && kinds('5035666').every((k) => k === 'RENDER'), 'a photomontage was called a photograph');
  assert.ok(kinds('4867063').every((k) => k === 'PHOTO'));
  for (const v of out.visuals) assert.equal(v.extraction, 'PDF_EMBEDDED_IMAGE');
});
