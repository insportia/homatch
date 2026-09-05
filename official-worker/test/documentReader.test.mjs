// documentReader.test.mjs — the PURE decision logic in
// documents/DocumentReader.ts (classifyDocumentLink/detectPagination/
// sha256/extractDateFromText), ported from the pre-refactor
// lib/documentReader.js's test suite. Plus documents/DocumentTypes.ts's
// markComplete() — the direct enforcement of mandate Section 7's rule
// ("If pageCount = 14 then pagesRead must become 14 before complete=true").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDocumentLink, detectPagination, sha256, extractDateFromText } from '../.tstest-build/documents/DocumentReader.js';
import { newDocumentShell, markComplete, toLegacyDocument } from '../.tstest-build/documents/DocumentTypes.js';

test('classifyDocumentLink: a real PDF link is worth opening as a direct file', () => {
  const c = classifyDocumentLink({ url: 'https://tas.ge/files/extract.pdf', label: 'ამონაწერი' });
  assert.equal(c.worthOpening, true);
  assert.equal(c.looksLikeDirectFile, true);
});

test('classifyDocumentLink: TAS\'s own Adobe Reader installer link is rejected (the confirmed live false positive)', () => {
  const c = classifyDocumentLink({ url: 'https://get.adobe.com/reader/download/', label: 'Get Adobe Reader' });
  assert.equal(c.worthOpening, false);
  assert.equal(c.reason, 'JUNK_HOST');
});

test('classifyDocumentLink: TAS\'s own self-referencing search URL is rejected', () => {
  const c = classifyDocumentLink({ url: 'https://tas.ge/?p=searchdocument&menuItemId=7104', label: 'ძებნა' });
  assert.equal(c.worthOpening, false);
  assert.equal(c.reason, 'SELF_NAV_URL');
});

test('classifyDocumentLink: a same-domain page with no extension but a real document phrase is worth opening as an online viewer', () => {
  const c = classifyDocumentLink({ url: 'https://tas.ge/view?id=42', label: 'დოკუმენტის გადმოწერა' });
  assert.equal(c.worthOpening, true);
  assert.equal(c.looksLikeDirectFile, false);
});

test('detectPagination: recognizes an explicit "page N of M" caption', () => {
  const p = detectPagination('შედეგი — გვერდი 2 დან 5');
  assert.equal(p.currentPage, 2);
  assert.equal(p.totalPages, 5);
  assert.equal(p.hasMore, true);
});
test('detectPagination: falls back to a weaker "next control present" signal with no caption', () => {
  const p = detectPagination('some content ... შემდეგი გვერდი');
  assert.equal(p.totalPages, null);
  assert.equal(p.hasMore, true);
});
test('detectPagination: no pagination signal at all', () => {
  const p = detectPagination('the whole document fits on one page');
  assert.equal(p.hasMore, false);
});

test('sha256: deterministic and never fabricated on failure', () => {
  const h1 = sha256(Buffer.from('hello', 'utf8'));
  const h2 = sha256(Buffer.from('hello', 'utf8'));
  assert.equal(h1, h2);
  assert.equal(h1.length, 64);
});

test('extractDateFromText: recognizes DD.MM.YYYY and YYYY-MM-DD, never invents one when absent', () => {
  assert.equal(extractDateFromText('გაცემულია 05.09.2026 წელს'), '05.09.2026');
  assert.equal(extractDateFromText('issued 2026-09-05'), '2026-09-05');
  assert.equal(extractDateFromText('no date printed here at all'), null);
});

test('markComplete: a document with a known page count is NOT complete until every page was read (mandate\'s 14-page example)', () => {
  const doc = newDocumentShell('enreg', 'https://example/extract');
  doc.pageCount = 14;
  doc.pagesRead = 10;
  markComplete(doc);
  assert.equal(doc.complete, false);
  doc.pagesRead = 14;
  markComplete(doc);
  assert.equal(doc.complete, true);
});

test('markComplete: unknown page count falls back to "did we get non-trivial text"', () => {
  const doc = newDocumentShell('msmap', 'https://example/viewer');
  doc.pageCount = null;
  doc.rawText = 'short';
  markComplete(doc);
  assert.equal(doc.complete, false);
  doc.rawText = 'a'.repeat(50);
  markComplete(doc);
  assert.equal(doc.complete, true);
});

// toLegacyDocument: the wire-alias mapping onto what the DEPLOYED
// research-agent's officialDocuments()/bev() actually read (d.date, d.type,
// d.parsed, d.textExtractionAvailable, d.title||d.label) — confirmed live
// via mcp__Supabase__get_edge_function, v17. Additive: the mandate's own
// field names must survive alongside the legacy aliases.
test('toLegacyDocument: adds date/type/parsed/textExtractionAvailable/label aliases without dropping the mandate field names', () => {
  const doc = newDocumentShell('tas', 'https://tas.ge/doc/1');
  doc.title = 'TAS extract';
  doc.documentType = 'PDF_DOCUMENT';
  doc.documentDate = '05.09.2026';
  doc.rawText = 'a'.repeat(50);
  doc.pageCount = 3;
  doc.pagesRead = 3;
  markComplete(doc);

  const legacy = toLegacyDocument(doc);
  assert.equal(legacy.date, '05.09.2026');
  assert.equal(legacy.type, 'PDF_DOCUMENT');
  assert.equal(legacy.parsed, true);
  assert.equal(legacy.textExtractionAvailable, true);
  assert.equal(legacy.label, 'TAS extract');
  // mandate field names are still present, unchanged
  assert.equal(legacy.documentDate, '05.09.2026');
  assert.equal(legacy.documentType, 'PDF_DOCUMENT');
  assert.equal(legacy.complete, true);
});

test('toLegacyDocument: an incomplete/unread document maps to parsed:false, textExtractionAvailable:false', () => {
  const doc = newDocumentShell('tas', 'https://tas.ge/doc/2');
  doc.rawText = '';
  markComplete(doc);
  const legacy = toLegacyDocument(doc);
  assert.equal(legacy.parsed, false);
  assert.equal(legacy.textExtractionAvailable, false);
  assert.equal(legacy.date, null);
});
