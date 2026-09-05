import assert from 'node:assert/strict';
import { classifyDocumentLink, isRealDocumentLink, detectPagination } from '../src/lib/documentReader.js';

let n = 0;
function t(name, fn) { n++; fn(); console.log(`ok - ${name}`); }

t('classifyDocumentLink: rejects the Adobe Reader installer (confirmed live false-positive host)', () => {
  const r = classifyDocumentLink({ url: 'https://get.adobe.com/reader/download/?x=1' });
  assert.equal(r.worthOpening, false);
  assert.equal(r.reason, 'JUNK_HOST');
});

t('classifyDocumentLink: rejects the page\'s own ?p=searchdocument self-URL', () => {
  const r = classifyDocumentLink({ url: 'https://tas.ge/?p=searchdocument&menuItemId=7104' });
  assert.equal(r.worthOpening, false);
  assert.equal(r.reason, 'SELF_NAV_URL');
});

t('classifyDocumentLink: accepts a direct .pdf link', () => {
  const r = classifyDocumentLink({ url: 'https://docs.tbilisi.gov.ge/file/12345.pdf' });
  assert.equal(r.worthOpening, true);
  assert.equal(r.looksLikeDirectFile, true);
  assert.equal(r.reason, 'FILE_EXTENSION');
});

t('classifyDocumentLink: accepts a no-extension link whose label says extract/download (online-viewer candidate)', () => {
  const r = classifyDocumentLink({ url: 'https://napr.gov.ge/view?id=9', label: 'ამონაწერის ნახვა' });
  assert.equal(r.worthOpening, true);
  assert.equal(r.looksLikeDirectFile, false);
  assert.equal(r.reason, 'DOCUMENT_PHRASE');
});

t('classifyDocumentLink: rejects an unrelated link with no document signal at all', () => {
  const r = classifyDocumentLink({ url: 'https://tas.ge/about-us', label: 'About us' });
  assert.equal(r.worthOpening, false);
  assert.equal(r.reason, 'NO_DOCUMENT_SIGNAL');
});

t('classifyDocumentLink: rejects an exact self-referencing link given page context', () => {
  const r = classifyDocumentLink({ url: 'https://tas.ge/current' }, { pageUrl: 'https://tas.ge/current' });
  assert.equal(r.worthOpening, false);
  assert.equal(r.reason, 'SELF_URL');
});

t('isRealDocumentLink: backward-compatible boolean wrapper', () => {
  assert.equal(isRealDocumentLink({ url: 'https://x.ge/f.pdf' }), true);
  assert.equal(isRealDocumentLink({ url: 'https://get.adobe.com/reader' }), false);
});

t('detectPagination: explicit "page N of M" caption, more pages remain', () => {
  const r = detectPagination('დოკუმენტი — გვერდი 3 დან 14');
  assert.equal(r.currentPage, 3);
  assert.equal(r.totalPages, 14);
  assert.equal(r.hasMore, true);
});

t('detectPagination: explicit "Page N of M" caption, last page', () => {
  const r = detectPagination('Page 14 of 14');
  assert.equal(r.hasMore, false);
});

t('detectPagination: no caption, but a next-page label is present (weaker evidence)', () => {
  const r = detectPagination('სრული ტექსტი ... შემდეგი გვერდი');
  assert.equal(r.currentPage, null);
  assert.equal(r.hasMore, true);
});

t('detectPagination: no caption, no next-label — single-page document', () => {
  const r = detectPagination('მხოლოდ ტექსტი, პაგინაციის გარეშე.');
  assert.equal(r.hasMore, false);
});

console.log(`\n${n} passed`);
