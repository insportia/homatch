// BOUNDED DOCUMENT TEXT (_shared/boundedDocumentText.ts) — document parsing stays inside one
// Edge request without changing what the analysis reads:
//   - a PDF is read only until the normalised, capped text is settled; the result equals
//     reading every page (unpdf 0.12.1 extractText with mergePages, reproduced below);
//   - a .docx is refused only above the XML size whose parse cannot fit the memory limit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { pdfTextForAnalysis, assertDocxParsable, DocumentTooLarge, MAX_DOCX_XML_BYTES } = await import('../boundedDocumentText.ts');
const { normalizeDocumentText, MAX_DOCUMENT_CHARS } = await import('../../../../src/dealroom/domain/documentExtract.ts');

/* A PDF stand-in that counts the pages it was asked for. */
function fakePdf(pages) {
  const read = new Set();
  return {
    read,
    numPages: pages.length,
    getPage: async (n) => { read.add(n); return { getTextContent: async () => ({ items: pages[n - 1] }) }; },
  };
}
/* unpdf 0.12.1: extractText(pdf, { mergePages: true }).text */
async function unpdfMerged(pdf) {
  const texts = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const c = await (await pdf.getPage(n)).getTextContent();
    texts.push(c.items.filter((i) => i.str != null).map((i) => i.str + (i.hasEOL ? '\n' : '')).join(''));
  }
  return texts.join('\n').replace(/\s+/g, ' ');
}

let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const NOISE = [' ', '  ', '\n', '\t', ' ', '​', '\u0000', '﻿', ' ​ ', 'ა', 'ж', 'é'];
function noisyPage(chars) {
  const items = [];
  let n = 0;
  while (n < chars) {
    let s = '';
    const len = 5 + Math.floor(rnd() * 60);
    for (let i = 0; i < len; i++) s += rnd() < 0.15 ? NOISE[Math.floor(rnd() * NOISE.length)] : String.fromCharCode(97 + Math.floor(rnd() * 26));
    items.push({ str: s, hasEOL: rnd() < 0.3 });
    if (rnd() < 0.05) items.push({ str: undefined });
    n += len;
  }
  return items;
}

test('a long PDF: the analysed text is identical, and pages past it are never read', async () => {
  for (const [pages, perPage] of [[400, 3000], [80, 5000], [3, 200], [1, 130_000], [200, 0], [50, 2500]]) {
    const doc = Array.from({ length: pages }, () => noisyPage(perPage));
    const bounded = fakePdf(doc);
    const { raw, pagesRead } = await pdfTextForAnalysis(bounded);
    const full = await unpdfMerged(fakePdf(doc));
    assert.equal(normalizeDocumentText(raw), normalizeDocumentText(full), `${pages}×${perPage}: same analysed text`);
    assert.equal(bounded.read.size, pagesRead);
    if (normalizeDocumentText(full).length < MAX_DOCUMENT_CHARS) assert.equal(pagesRead, pages, 'a short document is read whole');
    if (pages === 400) assert.ok(pagesRead < 60, `read ${pagesRead} of 400 pages`);
  }
});

test('the cut never lands inside the analysed text, whatever the whitespace at the boundary', async () => {
  const limit = 500;
  for (let trial = 0; trial < 300; trial++) {
    const doc = Array.from({ length: 30 }, () => noisyPage(10 + Math.floor(rnd() * 120)));
    const { raw } = await pdfTextForAnalysis(fakePdf(doc), limit);
    const full = await unpdfMerged(fakePdf(doc));
    const norm = (s) => s.replace(/[\u0000​-‍﻿]/g, '').replace(/ {2,}/g, ' ').trim();
    assert.equal(norm(raw).slice(0, limit), norm(full).slice(0, limit), `trial ${trial}`);
  }
});

test('.docx: refused only above the size whose parse cannot fit the Edge memory limit', () => {
  assert.equal(MAX_DOCX_XML_BYTES, 40 * 1024 * 1024);
  assert.doesNotThrow(() => assertDocxParsable({ _data: { uncompressedSize: 20 * 1024 * 1024 } }), 'parses today in ~0.4 s, +100 MB');
  assert.doesNotThrow(() => assertDocxParsable({ _data: {} }), 'unknown size is not refused');
  assert.throws(() => assertDocxParsable({ _data: { uncompressedSize: MAX_DOCX_XML_BYTES + 1 } }), DocumentTooLarge);
});

for (const [fn, table] of [['developer-document-extract', 'dev_documents'], ['deal-room-document-analyze', 'deal_room_documents']]) {
  test(`${fn}: bounded reading, the real page count, and a named reason for a refused .docx`, () => {
    const src = readFileSync(new URL(`../../${fn}/index.ts`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /extractText\(/, 'no whole-document extraction');
    assert.match(src, /pages = pdf\.numPages \?\? 0;/);
    assert.match(src, /raw = \(await pdfTextForAnalysis\(pdf\)\)\.raw;/);
    const check = src.indexOf('assertDocxParsable(entry);');
    assert.ok(check > 0 && check < src.indexOf("raw = extractDocxText(await entry.async('string'))"), 'checked before inflating');
    assert.match(src, /instanceof DocumentTooLarge/);
    assert.match(src, new RegExp(`from\\('${table}'\\)`));
    assert.match(src, /'TOO_LARGE'/);
  });
}
