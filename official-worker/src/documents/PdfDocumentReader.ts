// PdfDocumentReader.ts — reads a direct downloadable PDF and preserves the
// complete extracted text. A successful pdf-parse pass covers every page.
import type { Page } from 'playwright';
import pdf from 'pdf-parse';
import { extractDateFromText, sha256 } from './DocumentReader.js';
import { newDocumentShell, markComplete, type ResearchDocument } from './DocumentTypes.js';

export interface PdfLink {
  url: string;
  label?: string;
}

export async function readPdfDocument(
  page: Page,
  link: PdfLink,
  source: string,
  parentItemId: string | null = null,
): Promise<ResearchDocument> {
  const doc = newDocumentShell(source, link.url, parentItemId);
  try {
    const r = await (page as any).request.get(link.url, { timeout: 60000 });
    const body: Buffer = await r.body();
    const contentType = String(r.headers()['content-type'] || '').toLowerCase();
    doc.sha256 = sha256(body);

    if (contentType.includes('pdf') || body.subarray(0, 4).toString() === '%PDF') {
      doc.documentType = 'PDF_DOCUMENT';
      const parsed = await pdf(body);
      const bodyText = parsed.text || '';
      doc.title =
        (parsed.info && parsed.info.Title && String(parsed.info.Title).trim()) ||
        link.label ||
        null;
      doc.documentDate =
        extractDateFromText(bodyText.slice(0, 4000)) ||
        (parsed.info && parsed.info.CreationDate ? String(parsed.info.CreationDate) : null);
      doc.pageCount = parsed.numpages || null;

      // Do not truncate official evidence. The caller asked for every page and
      // every extracted text character from the PDF to remain available to
      // downstream evidence/research synthesis.
      doc.rawText = bodyText;
      doc.pagesRead = doc.pageCount || (bodyText.trim().length > 20 ? 1 : 0);
      markComplete(doc);
    } else {
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
