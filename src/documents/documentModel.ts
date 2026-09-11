// HOMATCH — what a document IS, once, for everything that renders one.
//
// TWO PROBLEMS, ONE FILE
//
// 1. THE STATUS WAS A LIE BY OMISSION.
//
//    deal_room_documents.analysis_state has seven values, and the panel drew
//    two: a spinner for RUNNING and an analysis for DONE. Everything else —
//    UNSUPPORTED, REQUIRES_OCR, a document with a file and no analysis yet —
//    fell through into the spinner. A scanned contract we genuinely cannot
//    read showed "Reading document…" forever and so did one whose analysis
//    had finished and whose flag had been stranded by a closed tab.
//
//    So the state is derived here, from the row AND from whether an analysis
//    is actually present, and every value has a screen.
//
// 2. THE ANALYSIS WAS TRUSTED.
//
//    ContractAnalysisPanel did `analysis.clauses.filter(...)` on a jsonb blob
//    written by a model-backed pipeline that has changed shape before. It is
//    the same unguarded pattern that crashed the Verify result page, one
//    component over, and the only reason it had not fired yet is that no
//    stored analysis happens to be missing `clauses` today. Waiting for that
//    to change is not a plan.
//
// Pure and dependency-free so it can be tested directly.

import type { JobState } from '@/jobs/jobState';

/* ------------------------------------------------------------------ *
 * Status                                                              *
 * ------------------------------------------------------------------ */

/**
 * The document lifecycle, in the customer's terms rather than the column's.
 *
 * EXTRACTING and ANALYZING are deliberately distinct even though the database
 * has one RUNNING value for both: "reading the document" and "working out
 * what it says" are different waits, and a progress line that can tell them
 * apart is the difference between a truthful status and a spinner.
 */
export type DocumentStatus =
  | 'UPLOADED'      // a file, nothing asked of it yet
  | 'QUEUED'        // a durable job exists, no worker has claimed it
  | 'STARTING'
  | 'CANCELLABLE'   // inside the fifteen-second window
  | 'COMMITTED'
  | 'EXTRACTING'
  | 'ANALYZING'
  | 'READY'
  | 'FAILED'
  | 'CANCELLED'
  | 'ARCHIVED';

export const DOCUMENT_STATUSES: readonly DocumentStatus[] = [
  'UPLOADED', 'QUEUED', 'STARTING', 'CANCELLABLE', 'COMMITTED',
  'EXTRACTING', 'ANALYZING', 'READY', 'FAILED', 'CANCELLED', 'ARCHIVED',
] as const;

export const isDocumentBusy = (s: DocumentStatus): boolean =>
  s === 'QUEUED' || s === 'STARTING' || s === 'CANCELLABLE' ||
  s === 'COMMITTED' || s === 'EXTRACTING' || s === 'ANALYZING';

/** A translation key for each status. Never the raw column value. */
export const DOCUMENT_STATUS_KEY: Record<DocumentStatus, string> = {
  UPLOADED: 'doc_status_uploaded',
  QUEUED: 'doc_status_queued',
  STARTING: 'doc_status_starting',
  CANCELLABLE: 'doc_status_starting',
  COMMITTED: 'doc_status_working',
  EXTRACTING: 'doc_status_extracting',
  ANALYZING: 'doc_status_analyzing',
  READY: 'doc_status_ready',
  FAILED: 'doc_status_failed',
  CANCELLED: 'doc_status_cancelled',
  ARCHIVED: 'doc_status_archived',
};

/** Why an analysis did not produce anything, as a key rather than prose. */
export const DOCUMENT_FAILURE_KEY: Record<string, string> = {
  FAILED: 'doc_error_failed',
  UNSUPPORTED: 'doc_error_unsupported',
  REQUIRES_OCR: 'doc_error_requires_ocr',
};

export interface DocumentStatusInput {
  analysisState: string | null | undefined;
  /** Whether a usable analysis is actually stored, not whether the column is set. */
  hasAnalysis: boolean;
  archivedAt?: string | null;
  /** The live durable job for this document, when there is one. */
  jobState?: JobState | null;
  jobStage?: string | null;
}

/**
 * The one place a document's state is decided.
 *
 * The DURABLE JOB wins while one is live, because it knows things the
 * document row cannot: that work is queued but unclaimed, that the customer
 * is still inside their cancellation window, that a worker died. The row is
 * the authority once the job is over, because that is where the result is.
 */
export function documentStatus(input: DocumentStatusInput): DocumentStatus {
  if (input.archivedAt) return 'ARCHIVED';

  const state = String(input.analysisState ?? 'NONE').toUpperCase();

  // A finished analysis is a finished analysis, whatever a stale job row says.
  if (state === 'DONE') return 'READY';
  if (state === 'FAILED' || state === 'UNSUPPORTED' || state === 'REQUIRES_OCR') return 'FAILED';

  const job = input.jobState;
  if (job && job !== 'COMPLETED' && job !== 'FAILED') {
    if (job === 'CANCELLED') return 'CANCELLED';
    if (job === 'QUEUED') return 'QUEUED';
    if (job === 'STARTING') return 'STARTING';
    if (job === 'CANCELLABLE') return 'CANCELLABLE';
    if (job === 'COMMITTED') return 'COMMITTED';
    // PROCESSING / PARTIAL: which half depends on what the worker last said.
    const stage = String(input.jobStage ?? '').toUpperCase();
    if (stage === 'ANALYZING') return 'ANALYZING';
    return 'EXTRACTING';
  }

  if (state === 'RUNNING') {
    /*
     * RUNNING WITH NOTHING BEHIND IT.
     *
     * No live job and no stored analysis. This is the stranded marker that
     * produced "Reading document…" forever: the request that set it was
     * abandoned and nothing ever moved it. jobs-worker repairs the row within
     * a few minutes; until it does, the honest reading is that the attempt
     * stopped — not that something is still happening.
     */
    return input.hasAnalysis ? 'READY' : 'FAILED';
  }
  if (state === 'QUEUED') return 'QUEUED';

  return 'UPLOADED';
}

/* ------------------------------------------------------------------ *
 * Categories (§13)                                                    *
 * ------------------------------------------------------------------ */

export type DocumentCategory =
  | 'OWNERSHIP' | 'CONTRACT' | 'REGISTRY_EXTRACT' | 'FLOOR_PLAN' | 'INVOICE' | 'OTHER';

export const DOCUMENT_CATEGORIES: readonly DocumentCategory[] = [
  'OWNERSHIP', 'CONTRACT', 'REGISTRY_EXTRACT', 'FLOOR_PLAN', 'INVOICE', 'OTHER',
] as const;

export const DOCUMENT_CATEGORY_KEY: Record<DocumentCategory, string> = {
  OWNERSHIP: 'doc_cat_ownership',
  CONTRACT: 'doc_cat_contract',
  REGISTRY_EXTRACT: 'doc_cat_registry',
  FLOOR_PLAN: 'doc_cat_floor_plan',
  INVOICE: 'doc_cat_invoice',
  OTHER: 'doc_cat_other',
};

/**
 * A guess from what the analyser already worked out, never from the filename
 * alone in a way that overrides the customer.
 *
 * `documentType` is a field the analysis pipeline produces; using it is
 * reading a classification that already exists rather than inventing a second
 * classifier. A customer's own choice always wins and is never overwritten
 * (§13: "if automatic classification exists, use it; otherwise allow manual").
 */
export function suggestCategory(input: {
  chosen?: string | null;
  documentType?: string | null;
  filename?: string | null;
}): DocumentCategory {
  const chosen = String(input.chosen ?? '').toUpperCase();
  if ((DOCUMENT_CATEGORIES as readonly string[]).includes(chosen)) return chosen as DocumentCategory;

  const hay = `${input.documentType ?? ''} ${input.filename ?? ''}`.toLowerCase();
  if (/sale|purchase|agreement|contract|ნასყიდობ|договор|sözleşme/.test(hay)) return 'CONTRACT';
  if (/extract|registry|cadast|ამონაწერ|реестр|tapu/.test(hay)) return 'REGISTRY_EXTRACT';
  if (/owner|title|საკუთრებ|собственност/.test(hay)) return 'OWNERSHIP';
  if (/floor ?plan|layout|გეგმ|планировк|kat ?plan/.test(hay)) return 'FLOOR_PLAN';
  if (/invoice|receipt|ანგარიშ-ფაქტურ|счёт|fatura/.test(hay)) return 'INVOICE';
  return 'OTHER';
}

/* ------------------------------------------------------------------ *
 * The analysis, canonicalised                                         *
 * ------------------------------------------------------------------ */

const asArray = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const asString = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const asPage = (v: unknown): number | null => asNumber(v);

export type Attention = 'NORMAL' | 'ONE_SIDED' | 'UNUSUAL' | 'AMBIGUOUS' | 'MISSING_PROTECTION';
const ATTENTIONS: Attention[] = ['NORMAL', 'ONE_SIDED', 'UNUSUAL', 'AMBIGUOUS', 'MISSING_PROTECTION'];

export interface NormalClause {
  label: string; plain: string; quote: string; page: number | null; attention: Attention;
}
export interface NormalObligation {
  party: string; label: string; plain: string; quote: string; page: number | null;
}
export interface NormalNamedValue {
  label: string; value: string | null; quote: string; page: number | null;
}

export interface NormalDocumentAnalysis {
  documentType: string | null;
  summary: string[];
  clauses: NormalClause[];
  obligations: NormalObligation[];
  deadlines: NormalNamedValue[];
  financial: NormalNamedValue[];
  missingProtections: { label: string; plain: string }[];
  questions: string[];
  pages: number;
  containsInstructionLikeText: boolean;
  analysedAt: string | null;
}

export const EMPTY_ANALYSIS: NormalDocumentAnalysis = {
  documentType: null,
  summary: [],
  clauses: [],
  obligations: [],
  deadlines: [],
  financial: [],
  missingProtections: [],
  questions: [],
  pages: 0,
  containsInstructionLikeText: false,
  analysedAt: null,
};

const normalizeNamedValue = (v: unknown): NormalNamedValue => {
  const o = asObject(v);
  return {
    label: asString(o.label),
    value: asString(o.value) || null,
    quote: asString(o.quote),
    page: asPage(o.page),
  };
};

/**
 * Any stored analysis, made safe to render.
 *
 * Returns null only when there is genuinely nothing — which the caller must
 * be able to tell apart from "an analysis that found little", because one of
 * those means "we have not read this" and the other means "we read it and
 * this is what is there".
 */
export function normalizeDocumentAnalysis(raw: unknown): NormalDocumentAnalysis | null {
  const o = asObject(raw);
  if (!Object.keys(o).length) return null;

  const analysis: NormalDocumentAnalysis = {
    documentType: asString(o.documentType) || null,
    summary: asArray(o.summary).map(asString).filter(Boolean),
    clauses: asArray(o.clauses).map((c) => {
      const x = asObject(c);
      const attention = asString(x.attention).toUpperCase() as Attention;
      return {
        label: asString(x.label),
        plain: asString(x.plain),
        quote: asString(x.quote),
        page: asPage(x.page),
        attention: ATTENTIONS.includes(attention) ? attention : 'NORMAL',
      };
    }).filter((c) => c.label || c.plain || c.quote),
    obligations: asArray(o.obligations).map((ob) => {
      const x = asObject(ob);
      return {
        party: asString(x.party).toUpperCase() || 'UNCLEAR',
        label: asString(x.label),
        plain: asString(x.plain),
        quote: asString(x.quote),
        page: asPage(x.page),
      };
    }).filter((ob) => ob.label || ob.plain),
    deadlines: asArray(o.deadlines).map(normalizeNamedValue).filter((d) => d.label || d.value),
    financial: asArray(o.financial).map(normalizeNamedValue).filter((f) => f.label || f.value),
    missingProtections: asArray(o.missingProtections).map((m) => {
      const x = asObject(m);
      return { label: asString(x.label), plain: asString(x.plain) };
    }).filter((m) => m.label || m.plain),
    questions: asArray(o.questions).map(asString).filter(Boolean),
    pages: asNumber(o.pages) ?? 0,
    containsInstructionLikeText: o.containsInstructionLikeText === true,
    analysedAt: asString(o.analysedAt) || null,
  };

  // An object with none of the fields we know is not an analysis in a shape
  // we can show; treating it as one would render an empty panel that claims
  // the document was read.
  const anything =
    analysis.summary.length || analysis.clauses.length || analysis.obligations.length ||
    analysis.deadlines.length || analysis.financial.length ||
    analysis.missingProtections.length || analysis.questions.length ||
    !!analysis.documentType;
  return anything ? analysis : null;
}

/* ------------------------------------------------------------------ *
 * The one-line summary (§14)                                          *
 * ------------------------------------------------------------------ */

/**
 * What the collapsed card says.
 *
 * Explicitly NOT the first line of the extracted text. Raw OCR output as a
 * card title is how a document list becomes unreadable — the first line of a
 * Georgian sale agreement is a letterhead, and six cards showing six
 * letterheads distinguish nothing.
 *
 * Order of preference:
 *   1. a stored headline the analyser wrote
 *   2. the analysis's own first summary sentence
 *   3. the document type plus what was counted in it
 *   4. nothing, and the caller shows the status instead
 *
 * Never composes a sentence out of facts it has not been given.
 */
export function headlineFor(input: {
  storedHeadline?: string | null;
  analysis: NormalDocumentAnalysis | null;
}): string | null {
  const stored = asString(input.storedHeadline);
  if (stored) return stored;

  const a = input.analysis;
  if (!a) return null;
  if (a.summary.length) return a.summary[0];
  return null;
}

/** What the card can count without claiming to have understood it. */
export function findingCounts(a: NormalDocumentAnalysis | null): {
  total: number; attention: number;
} {
  if (!a) return { total: 0, attention: 0 };
  const total =
    a.clauses.length + a.obligations.length + a.deadlines.length +
    a.financial.length + a.missingProtections.length;
  const attention =
    a.clauses.filter((c) => c.attention !== 'NORMAL').length + a.missingProtections.length;
  return { total, attention };
}

/* ------------------------------------------------------------------ *
 * Sorting and filtering (§12)                                         *
 * ------------------------------------------------------------------ */

export type DocumentSort = 'NEWEST' | 'OLDEST' | 'NAME' | 'STATUS';

/** The order statuses are worth the customer's attention in. */
const STATUS_RANK: Record<DocumentStatus, number> = {
  FAILED: 0, ANALYZING: 1, EXTRACTING: 2, COMMITTED: 3, CANCELLABLE: 4,
  STARTING: 5, QUEUED: 6, UPLOADED: 7, READY: 8, CANCELLED: 9, ARCHIVED: 10,
};

export interface SortableDocument {
  id: string;
  name: string;
  createdAt: string;
  status: DocumentStatus;
  sortIndex?: number | null;
}

export function sortDocuments<T extends SortableDocument>(docs: T[], sort: DocumentSort): T[] {
  const out = [...docs];
  // A customer who has dragged their documents into an order meant it, so
  // that order survives every sort mode except an explicitly chosen one.
  const byManual = (a: T, b: T) => (a.sortIndex ?? Number.MAX_SAFE_INTEGER) - (b.sortIndex ?? Number.MAX_SAFE_INTEGER);
  const time = (d: T) => Date.parse(d.createdAt) || 0;

  switch (sort) {
    case 'OLDEST': out.sort((a, b) => time(a) - time(b) || byManual(a, b)); break;
    case 'NAME': out.sort((a, b) => a.name.localeCompare(b.name) || byManual(a, b)); break;
    case 'STATUS': out.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || time(b) - time(a)); break;
    default: out.sort((a, b) => time(b) - time(a) || byManual(a, b));
  }
  return out;
}

export function filterDocuments<T extends { name: string; headline?: string | null; category?: string | null }>(
  docs: T[],
  query: string
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return docs;
  return docs.filter((d) =>
    [d.name, d.headline ?? '', d.category ?? ''].join(' ').toLowerCase().includes(needle)
  );
}
