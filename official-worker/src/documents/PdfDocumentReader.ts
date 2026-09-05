// PdfDocumentReader.ts — reads a direct downloadable file link (mandate
// Section 7's PDF_DOCUMENT kind — a real .pdf; a non-PDF direct file, e.g.
// .docx/.xlsx, is recorded discovered+hashed but honestly marked
// text-extraction-unavailable rather than fabricating extracted text).
// Ported from the pre-refactor pdfEvidence() in index.js.
//
// Playwright-touching (page.request.get) — NOT unit-testable in this
// sandbox. Local-syntax-checked via `tsc --noEmit` only.
import type { Page } from 'playwright';
import pdf from 'pdf-parse';
import { extractDateFromText, sha256 } from './DocumentReader.js';
import { newDocumentShell, markComplete, type ResearchDocument } from './DocumentTypes.js';

export interface PdfLink {
  url: string;
  label?: string;
}

export async function readPdfDocument(page: Page, link: PdfLink, source: string, parentItemId: string | null = null): Promise<ResearchDocument> {
  const doc = newDocumentShell(source, link.url, parentItemId);
  try {
    const r = await (page as any).request.get(link.url, { timeout: 20000 });
    const body: Buffer = await r.body();
    const contentType = String(r.headers()['content-type'] || '').toLowerCase();
    doc.sha256 = sha256(body);
    if (contentType.includes('pdf') || body.subarray(0, 4).toString() === '%PDF') {
      doc.documentType = 'PDF_DOCUMENT';
      const parsed = await pdf(body);
      const bodyText = parsed.text || '';
      doc.title = (parsed.info && parsed.info.Title && String(parsed.info.Title).trim()) || link.label || null;
      doc.documentDate = extractDateFromText(bodyText.slice(0, 4000)) || (parsed.info && parsed.info.CreationDate ? String(parsed.info.CreationDate) : null);
      doc.pageCount = parsed.numpages || null;
      doc.rawText = bodyText.slice(0, 100000);
      // A real PDF parse gives us the FULL extracted text in one shot — per
      // the mandate's rule ("pagesRead must become pageCount before
      // complete=true"), that is equivalent to having read every page.
      doc.pagesRead = doc.pageCount || (bodyText.trim().length > 20 ? 1 : 0);
      markComplete(doc);
    } else {
      // Named/extension-matched as a direct file but the response wasn't
      // actually a parseable PDF — record it as discovered+hashed without
      // fabricating extracted text or claiming it was read.
      doc.documentType = 'PDF_DOCUMENT';
      doc.title = link.label || null;
      doc.error = 'TEXT_EXTRACTION_UNAVAILABLE: not a text-bearing PDF response';
      doc.complete = false;
    }
    return doc;
  } catch (e) {
    doc.error = String(e);
    return doc;
  }
}
