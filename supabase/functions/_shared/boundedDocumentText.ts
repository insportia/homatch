// BOUNDED DOCUMENT TEXT — read a document only as far as the analysis can use it.
//
// Parsing runs inside one Edge request (2 s of CPU, 256 MB). The analysis reads at
// most MAX_DOCUMENT_CHARS of normalised text, so pages past that point cost CPU and
// change nothing. A PDF is read page by page and reading stops once the text the
// analysis will see is settled: the normalised result is identical to reading every
// page (the margin covers the trim at the cut). The page count stays the real one.
//
// A .docx is a ZIP whose body can inflate far past its size on disk. Its XML is
// refused only above the size whose parse cannot fit the Edge memory limit
// (measured 2026-10-18: parsing grows memory by ~100 MB at 20 MB of XML, ~233 MB at
// 40 MB, ~361 MB at 64 MB), so every document that completes today still does.

import { MAX_DOCUMENT_CHARS } from '../../../src/dealroom/domain/documentExtract.ts';

export const MAX_DOCX_XML_BYTES = 40 * 1024 * 1024;
const CUT_MARGIN_CHARS = 1_000;

export class DocumentTooLarge extends Error {}

interface PdfLike {
  numPages: number;
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }> }>;
}

/* One page's text exactly as unpdf's extractText builds it. */
async function pageText(pdf: PdfLike, n: number): Promise<string> {
  const content = await (await pdf.getPage(n)).getTextContent();
  return content.items.filter((item) => item.str != null).map((item) => item.str + (item.hasEOL ? '\n' : '')).join('');
}

/* unpdf's mergePages join. */
const merge = (texts: string[]) => texts.join('\n').replace(/\s+/g, ' ');

/* Length of normalizeDocumentText(merged) before its cap: merged text holds no line breaks
   and single spaces only, so normalising drops NUL and zero-width characters, re-collapses
   spaces and trims. */
const settledLength = (merged: string) =>
  merged.replace(/[\u0000​-‍﻿]/g, '').replace(/ {2,}/g, ' ').trim().length;

/** The merged text of a PDF, read until the analysed prefix cannot change. */
export async function pdfTextForAnalysis(pdf: PdfLike, limit = MAX_DOCUMENT_CHARS): Promise<{ raw: string; pagesRead: number }> {
  const texts: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    texts.push(await pageText(pdf, n));
    const merged = merge(texts);
    if (settledLength(merged) >= limit + CUT_MARGIN_CHARS) return { raw: merged, pagesRead: n };
  }
  return { raw: merge(texts), pagesRead: pdf.numPages };
}

/** Refuse a .docx body whose parse cannot fit the Edge memory limit. */
export function assertDocxParsable(entry: unknown): void {
  const size = Number((entry as { _data?: { uncompressedSize?: number } })?._data?.uncompressedSize ?? 0);
  if (size > MAX_DOCX_XML_BYTES) throw new DocumentTooLarge('DOCX');
}
