// HOMATCH — reading the text out of a .docx.
//
// WHY THIS EXISTS
//
// The upload layer has always accepted Word documents: the mime type is in
// uploadValidation.ALLOWED_MIME and in the storage bucket's own allowlist. The
// ANALYSER accepted only application/pdf. So a customer could upload a
// contract as .docx, watch it upload successfully, and immediately be told it
// could not be analysed — two layers of the same feature disagreeing about
// what the product supports.
//
// A .docx is a ZIP whose word/document.xml holds the body. Pulling the text
// out of it is deterministic — no model, no OCR, no guessing — so it belongs
// here, beside the other pure document logic, where it can be unit tested
// without a Deno runtime or a storage bucket.
//
// The unzip itself needs a library and stays in the edge function; this module
// takes the already-decompressed document.xml and turns it into the same kind
// of plain text the PDF path produces.

/** A .docx, like every OOXML file, is a ZIP: it starts with "PK\x03\x04". */
export function sniffZip(bytes: Uint8Array | null | undefined): boolean {
  return (
    !!bytes &&
    bytes.length > 4 &&
    bytes[0] === 0x50 && // P
    bytes[1] === 0x4b && // K
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/** The legacy binary .doc is NOT this format and is not readable here. */
export const LEGACY_DOC_MIME = 'application/msword';

export type DocumentKind = 'PDF' | 'DOCX' | 'UNSUPPORTED';

/**
 * What we are actually holding, decided by BYTES first and the declared type
 * second.
 *
 * A browser will report whatever it likes for a renamed file, and the declared
 * type is the one thing an attacker controls for free. The magic number is the
 * fact; the mime type only gets a say when the bytes are inconclusive.
 */
export function documentKind(bytes: Uint8Array | null | undefined, mimeType?: string | null): DocumentKind {
  if (bytes && bytes.length > 4) {
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'PDF';
    // A ZIP is only a .docx if it says so — .xlsx and .pptx are ZIPs too.
    if (sniffZip(bytes)) return mimeType === DOCX_MIME ? 'DOCX' : 'UNSUPPORTED';
  }
  return 'UNSUPPORTED';
}

/*
 * WordprocessingML, reduced to the parts that carry text.
 *
 * <w:p>    a paragraph        -> a line break
 * <w:tab/> a tab              -> a tab
 * <w:br/>  an explicit break  -> a line break
 * <w:t>    a run of text      -> the text itself
 *
 * Everything else in the file is formatting, revision history, numbering and
 * style definitions. None of it is contract text, and a naive tag-strip that
 * keeps it produces pages of noise a reader would have to wade through — and
 * which the analysis prompt would then have to reason over.
 */

// Both spellings of a paragraph boundary: an empty paragraph arrives
// self-closing (<w:p/>) and is a real blank line in the document.
//
// The lookahead is load-bearing. Without it this also matches <w:pPr/> and
// <w:pStyle .../>, and every style tag in the file would insert a stray blank
// line into the contract text.
const PARAGRAPH_END = /<\/w:p>|<w:p(?=[\s/>])[^>]*\/>/g;
const LINE_BREAK = /<w:br\b[^>]*\/?>/g;
const TAB = /<w:tab\b[^>]*\/?>/g;
/** Deleted text: a tracked-changes deletion is not part of the agreement. */
const DELETED_RUN = /<w:del\b[\s\S]*?<\/w:del>/g;
const ANY_TAG = /<[^>]+>/g;

const XML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

/**
 * The readable text of a word/document.xml, as plain text.
 *
 * Returns '' for anything it cannot read rather than throwing: the caller
 * already has a state for "we could not get text out of this", and it is the
 * same state a scanned PDF lands in.
 */
export function extractDocxText(documentXml: string | null | undefined): string {
  if (typeof documentXml !== 'string' || !documentXml) return '';

  const withBreaks = documentXml
    .replace(DELETED_RUN, '')
    .replace(TAB, '\t')
    .replace(LINE_BREAK, '\n')
    .replace(PARAGRAPH_END, '\n');

  const text = decodeEntities(withBreaks.replace(ANY_TAG, ''));

  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
