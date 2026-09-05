// DocumentTypes.ts — mandate Section 7 ("Document Reader"). The exact
// ResearchDocument shape the mandate specifies, plus the two concrete
// document kinds (ONLINE_DOCUMENT / PDF_DOCUMENT) a DocumentReader can
// produce. Hard rule (restated because it is the whole point of this
// module): "If pageCount = 14 then pagesRead must become 14 before
// complete=true. AI may extract facts from document content. AI may NOT
// mark the document completely read." — enforced by markComplete() below,
// never by a caller setting `complete` directly.

export type DocumentKind = 'ONLINE_DOCUMENT' | 'PDF_DOCUMENT';

export interface ResearchDocument {
  id: string;
  source: string;
  parentItemId: string | null;
  title: string | null;
  documentType: DocumentKind | null;
  documentDate: string | null;
  url: string;
  pageCount: number | null;
  pagesRead: number;
  complete: boolean;
  rawText: string;
  sha256: string | null;
  extractedEvidenceIds: string[];
  discoveredEntityIds: string[];
  error?: string | null;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `doc_${Date.now().toString(36)}_${counter}`;
}

export function newDocumentShell(source: string, url: string, parentItemId: string | null = null): ResearchDocument {
  return {
    id: nextId(),
    source,
    parentItemId,
    title: null,
    documentType: null,
    documentDate: null,
    url,
    pageCount: null,
    pagesRead: 0,
    complete: false,
    rawText: '',
    sha256: null,
    extractedEvidenceIds: [],
    discoveredEntityIds: [],
  };
}

/**
 * The ONLY place `complete` may be set true. If pageCount is known, every
 * page must actually have been read (pagesRead === pageCount) — a partial
 * read (mandate's "14-page document, 10 read") can never be marked
 * complete, however confident an AI summary of the first few pages sounds.
 * If pageCount is unknown (could not be determined from the source/viewer),
 * completeness falls back to "did we get non-trivial text at all," which is
 * the best a deterministic reader can honestly claim in that case.
 */
export function markComplete(doc: ResearchDocument): ResearchDocument {
  if (doc.pageCount !== null) {
    doc.complete = doc.pagesRead >= doc.pageCount && doc.pageCount > 0;
  } else {
    doc.complete = doc.rawText.trim().length > 20;
  }
  return doc;
}

/** LEGACY WIRE ALIAS (mandate Section 27: preserve production API
 * compatibility). This module's own field names (`documentDate`,
 * `documentType`, `complete`) are the mandate's own Section 7 spec, verbatim
 * — but the DEPLOYED research-agent Supabase function (confirmed live via
 * mcp__Supabase__get_edge_function, v17) reads a document's date/kind/
 * read-status under different names: its `officialDocuments()` and `bev()`
 * do `d.date`, `d.type`, `d.parsed`, `d.textExtractionAvailable`, and
 * `d.title||d.label`. Without this mapping every document this architecture
 * retrieves — however rigorously read — would appear to research-agent (and
 * therefore in the customer-facing officialDocumentsRetrieved list) as
 * `date: null, type: null, parsed: false`, silently regressing the report
 * even though the worker did the work correctly.
 *
 * This is a pure ADDITIVE translation (the original field names stay on the
 * object too), applied once by ResearchOrchestrator right before a result's
 * `documents` array crosses the HTTP boundary — never inside a *Workflow.ts,
 * which should only ever produce the mandate's own ResearchDocument shape. */
export function toLegacyDocument(doc: ResearchDocument): ResearchDocument & {
  date: string | null;
  type: DocumentKind | null;
  parsed: boolean;
  textExtractionAvailable: boolean;
  label: string | null;
} {
  return {
    ...doc,
    date: doc.documentDate,
    type: doc.documentType,
    parsed: doc.complete,
    textExtractionAvailable: !!doc.rawText && doc.rawText.trim().length > 0,
    label: doc.title,
  };
}
