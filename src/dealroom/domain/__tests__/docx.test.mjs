// Reading a .docx contract.
//
// The reported failure was not a parser bug — it was two layers of the same
// feature disagreeing. uploadValidation.ALLOWED_MIME and the storage bucket
// both accepted Word documents; the analyser accepted only application/pdf.
// A customer uploaded a contract as .docx, watched it upload cleanly, and was
// told it could not be analysed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { documentKind, extractDocxText, sniffZip, DOCX_MIME, LEGACY_DOC_MIME } from '../docx.ts';
import { ALLOWED_MIME } from '../../../services/uploadValidation.ts';

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const bytesOf = (...b) => new Uint8Array([...b, 0, 0, 0, 0]);
const PDF = bytesOf(0x25, 0x50, 0x44, 0x46, 0x2d); // %PDF-
const ZIP = bytesOf(0x50, 0x4b, 0x03, 0x04); // PK..

/* ── the mismatch that caused the bug ────────────────────────────────── */

test('every type the uploader accepts is either analysable or knowingly refused', () => {
  // This is the assertion that would have caught the original defect: the two
  // layers must agree about what the product supports.
  const analysable = ['application/pdf', DOCX_MIME];
  const knownUnanalysable = [LEGACY_DOC_MIME, 'image/jpeg', 'image/png', 'image/webp'];
  for (const mime of ALLOWED_MIME) {
    assert.ok(
      analysable.includes(mime) || knownUnanalysable.includes(mime),
      `${mime} can be uploaded but nothing decides whether it can be analysed`
    );
  }
});

test('the analyser accepts the Word mime the uploader accepts', () => {
  const fn = read('supabase/functions/deal-room-document-analyze/index.ts');
  assert.ok(/ANALYSABLE_MIME = \['application\/pdf', DOCX_MIME\]/.test(fn),
    'the analyser gate no longer admits Word documents');
  assert.ok(!/doc\.mime_type !== 'application\/pdf'/.test(fn),
    'the PDF-only gate is back');
});

/* ── what we are actually holding ────────────────────────────────────── */

test('the format is decided by bytes, not by what the browser claims', () => {
  assert.equal(documentKind(PDF, 'application/pdf'), 'PDF');
  // A renamed file: the declared type says PDF, the bytes say ZIP.
  assert.equal(documentKind(ZIP, 'application/pdf'), 'UNSUPPORTED');
  // And a PDF declared as Word is still a PDF, and still readable.
  assert.equal(documentKind(PDF, DOCX_MIME), 'PDF');
});

test('a ZIP is only a Word document if it says it is', () => {
  // .xlsx and .pptx are ZIPs too, and neither is a contract we can read.
  assert.equal(documentKind(ZIP, DOCX_MIME), 'DOCX');
  assert.equal(documentKind(ZIP, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'UNSUPPORTED');
  assert.equal(sniffZip(ZIP), true);
  assert.equal(sniffZip(PDF), false);
});

test('the legacy binary .doc is refused rather than mis-parsed', () => {
  // It is not a ZIP and nothing here can read it.
  const doc = bytesOf(0xd0, 0xcf, 0x11, 0xe0);
  assert.equal(documentKind(doc, LEGACY_DOC_MIME), 'UNSUPPORTED');
});

test('empty or malformed bytes are unsupported, never a crash', () => {
  for (const b of [null, undefined, new Uint8Array(), new Uint8Array([1, 2])]) {
    assert.equal(documentKind(b, DOCX_MIME), 'UNSUPPORTED');
    assert.equal(sniffZip(b), false);
  }
});

/* ── the text itself ─────────────────────────────────────────────────── */

const xml = (body) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`;

test('paragraphs become lines and runs are joined', () => {
  const out = extractDocxText(
    xml(
      '<w:p><w:r><w:t>ნასყიდობის ხელშეკრულება</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>მყიდველი: </w:t></w:r><w:r><w:t>ლევან ჩაჩუა</w:t></w:r></w:p>'
    )
  );
  assert.equal(out, 'ნასყიდობის ხელშეკრულება\nმყიდველი: ლევან ჩაჩუა');
});

test('tabs and explicit breaks survive as whitespace', () => {
  const out = extractDocxText(xml('<w:p><w:r><w:t>ფასი</w:t><w:tab/><w:t>100</w:t><w:br/><w:t>ლარი</w:t></w:r></w:p>'));
  assert.equal(out, 'ფასი 100\nლარი');
});

test('formatting, styles and numbering do not become contract text', () => {
  const out = extractDocxText(
    xml('<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>მუხლი 1</w:t></w:r></w:p>')
  );
  assert.equal(out, 'მუხლი 1');
});

test('deleted text is not part of the agreement', () => {
  // A tracked-changes deletion is what the parties agreed to REMOVE. Reading
  // it back as a clause would report a term that is not in the contract.
  const out = extractDocxText(
    xml(
      '<w:p><w:r><w:t>ფასი: </w:t></w:r><w:del><w:r><w:delText>50000</w:delText></w:r></w:del><w:r><w:t>75000</w:t></w:r></w:p>'
    )
  );
  assert.equal(out, 'ფასი: 75000');
  assert.ok(!out.includes('50000'), 'deleted text was read back as contract text');
});

test('xml entities are decoded', () => {
  const out = extractDocxText(xml('<w:p><w:r><w:t>A &amp; B &lt;test&gt; &quot;x&quot; &#65;</w:t></w:r></w:p>'));
  assert.equal(out, 'A & B <test> "x" A');
});

test('blank paragraphs collapse rather than padding the document', () => {
  const out = extractDocxText(xml('<w:p><w:r><w:t>A</w:t></w:r></w:p><w:p/><w:p/><w:p/><w:p><w:r><w:t>B</w:t></w:r></w:p>'));
  assert.equal(out, 'A\n\nB');
});

test('an unreadable document yields empty text rather than throwing', () => {
  // The caller already has a state for "no text came out", and it is the same
  // state a scanned PDF lands in.
  for (const v of [null, undefined, '', '<w:document/>', 42, {}]) {
    assert.equal(extractDocxText(v), '');
  }
});

test('a document of only images yields nothing to analyse', () => {
  const out = extractDocxText(xml('<w:p><w:r><w:drawing><wp:inline/></w:drawing></w:r></w:p>'));
  assert.equal(out, '');
});
