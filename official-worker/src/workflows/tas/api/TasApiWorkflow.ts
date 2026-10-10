// TasApiWorkflow.ts — TAS "API_FIRST": the public DWR application, read as
// data, exhaustively. The browser workflow (TasWorkflow.ts) remains the
// LEGACY implementation and the automatic fallback.
//
//   cadastral → TAS base parcel (candidateSequence, never hardcoded)
//     → getDocsForPublicInfo, every page, reconciled against unique doc ids
//     → getUserDocumentLastMotion per case (full object graph)
//     → the TWO NEWEST cases of the parcel (priority 1 / 2, by application
//       date): FULL FIDELITY — every motion response, every attachment, every
//       page, full text, page renders + visual classification, the public
//       application form (best effort) — before any older-case budget
//     → older cases: every motion's official response; attachments within
//       the relevance budget (accounted, never hidden)
//     → selective official visuals (metadata ranking first)
//     → LegacySourceResult (unchanged wire shape) + `tasApi` structure
//
// No source binary is stored permanently: PDFs are parsed in memory and
// dropped; only text, hashes, classifications and a bounded set of chosen
// visuals (kept in a byte-bounded in-process cache until they are stored by
// content hash) remain.

import { bytesToBuffer } from './tasModel.js';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { candidateSequence, isCadastralCode } from '../cadastral.js';
import { TasApiClient, TasDeadline, TasPayloadTooLarge, TAS_PUBLIC, TAS_PAGE_SIZE, attachmentUrl, publicDocumentUrl, responseUrl } from './TasApiClient.js';
import {
  classifyPayload, classifyPdfText, fileNameFromDisposition, htmlToText, mergeSearchPages, normalizeCaseDetail, parseSearchPage, repairGeorgianMojibake,
  type PdfTextClass, type SearchReconciliation, type TasCaseDetail, type TasSearchPage, type TasSearchRow, type TasValue,
} from './tasModel.js';
import { toPlain } from './dwr.js';
import { extractDecision, type ExtractedDecision } from './decisions.js';
import { assetsPerFile, extractImagesFromPdf, imageSize, rankVisualCandidates, selectVisualShortlist, VISUAL_ASSET_MAX, VISUAL_FILE_MAX, type VisualKind, type VisualSlot } from './visuals.js';
import { classifyVisualMeta, DRAWING_KINDS, PICTURE_KINDS, identityHints, readExif, refineWithImage, type IdentityHints, type VisualCategory } from './visualClassify.js';
import type { PdfPageRenderer, PdfRendererFactory } from './pdfRender.js';
import { buildCompleteness, isUnsupportedExtension, MATERIAL_TEXT, selectPriorityCases, type PriorityCompleteness, type PriorityRank } from './priority.js';
import { captureCaseForm, formDiscoveryDiagnostics, newFormDiscoveryState, type FormCapture } from './formDiscovery.js';
import { redactPersonalData, sanitizeGraph } from './privacy.js';
import { extractTasTechnicalFacts, dedupeTasTechnicalFacts } from '../../../documents/TasTechnicalFacts.js';
import type { LegacySourceResult, WorkflowResult } from '../../WorkflowResult.js';

export const TAS_API_IMPLEMENTATION = 'API_FIRST';
export const TAS_API_VERSION = 'tas-api-2';

/** All OLDER-case TAS text sent on to research-agent, across cases. */
export const TAS_TOTAL_TEXT_BUDGET = 120_000;
/** Priority-case text carried INLINE, across both priority cases; the rest travels by content-addressed ref. */
// ≈ 900 KB of Georgian UTF-8: well inside the queue's byte bound together with
// the rest of the result. Text beyond it is never lost — it is stored in full
// (content-addressed) and referenced from the document record.
export const PRIORITY_INLINE_TEXT_MAX = 300_000;
/** Visual assets kept from the priority cases (separate from the ≤ VISUAL_ASSET_MAX gallery). */
export const PRIORITY_VISUAL_MAX = 48;

export type PdfParser = (bytes: Buffer) => Promise<{ text: string; numpages: number; info?: any; pages?: string[] }>;

/** pdf-parse with per-page text kept (same line joining as pdf-parse's own renderer). */
const defaultPdfParser: PdfParser = async (bytes) => {
  const pages: string[] = [];
  const pdfParse = createRequire(import.meta.url)('pdf-parse/lib/pdf-parse.js');
  const r = await pdfParse(bytes, {
    pagerender: async (pageData: any) => {
      const tc = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
      let lastY: any;
      let text = '';
      for (const item of tc.items) {
        text += lastY == item.transform[5] || !lastY ? item.str : `\n${item.str}`;
        lastY = item.transform[5];
      }
      const idx = typeof pageData.pageIndex === 'number' ? pageData.pageIndex : pages.length;
      pages[idx] = text;
      return text;
    },
  });
  const n = Number(r.numpages) || 0;
  return { text: r.text, numpages: n, info: r.info, pages: n > 0 ? Array.from({ length: n }, (_, i) => pages[i] ?? '') : undefined };
};

export interface TasApiOptions {
  fetcher?: typeof fetch;
  parsePdf?: PdfParser;
  budgetMs?: number;
  pageSize?: number;
  maxPages?: number;
  concurrency?: number;
  minGapMs?: number;
  /** Upper bound on OLDER-case attachment downloads per run; the rest are ACCOUNTED, not hidden. Priority cases are never bounded by it. */
  maxAttachmentDownloads?: number;
  /** Per-case text kept for downstream intelligence (chars) — OLDER cases only. */
  caseTextBudget?: number;
  /** Files opened for visuals (≤ VISUAL_FILE_MAX). */
  visualTarget?: number;
  /** Assets kept per run (≤ VISUAL_ASSET_MAX). */
  visualMax?: number;
  /** Total image bytes kept per run. */
  visualBytesMax?: number;
  /** Wall-clock spent on visual extraction/rendering per run (older-case shortlist). */
  visualBudgetMs?: number;
  /** Vector drawing page renderer (pdfRender.ts). Absent = no page rendering. */
  renderPdfPages?: PdfRendererFactory;
  /** Long edge of rendered drawing pages, px. */
  renderLongEdge?: number;
  /** How many newest cases get full fidelity (default 2, max 2). */
  priorityCount?: number;
  /** Attachment downloads in flight for priority cases (default min(3, concurrency)). */
  priorityConcurrency?: number;
  /** Byte bound for ONE priority attachment (default 150 MB); larger = DEFERRED with reason. */
  priorityMaxBytes?: number;
  /** Rendered pages across the priority cases (default 48) and per file (default 12). */
  priorityRenderPages?: number;
  priorityRenderPagesPerFile?: number;
  /** Priority visual assets kept (default PRIORITY_VISUAL_MAX) and their total bytes. */
  priorityVisualMax?: number;
  priorityVisualBytesMax?: number;
  /** Time kept back from the run deadline when starting a priority download (default 15 s). */
  priorityReserveMs?: number;
  /** Public application form discovery for priority cases (TAS_FORM_DISCOVERY, default on). */
  formDiscovery?: boolean;
  signal?: AbortSignal;
  now?: () => number;
}

export type AttachmentOutcome =
  | PdfTextClass
  | 'IMAGE'
  | 'UNSUPPORTED_FORMAT'
  | 'EMPTY'
  | 'DOWNLOAD_FAILED'
  | 'NOT_PROCESSED_BUDGET'
  /** Priority cases only: a hard runtime/byte bound was hit. Never silent: reason + completeness; a follow-up run continues. */
  | 'DEFERRED';

export interface AttachmentVisualSummary {
  kind: VisualKind;
  category: VisualCategory;
  confidence: number;
  basis: string;
  /** Visual assets produced from this file (embedded images, native image, rendered pages). */
  assets: number;
}

export interface AttachmentRecord {
  attachedFileId: string;
  documentId: string;
  motionId: string | null;
  fileName: string | null;
  date: string | null;
  format: string | null;
  outcome: AttachmentOutcome;
  pages: number | null;
  textChars: number;
  sha256: string | null;
  cached: boolean;
  /** Priority rank of the case this record belongs to. */
  priority?: PriorityRank;
  /** Official download URL — set for UNSUPPORTED_FORMAT / DEFERRED / DOWNLOAD_FAILED (nothing was read from it). */
  url?: string;
  sizeBytes?: number | null;
  /** Why the file was DEFERRED (RUN_DEADLINE, PAYLOAD_TOO_LARGE:<bytes>). */
  deferredReason?: string;
  /** 1-based pages without a usable text layer (< 50 chars). */
  scanPages?: number[];
  pagesRendered?: number;
  imagesProcessed?: number;
  scanPagesUnrendered?: number;
  renderFailed?: boolean;
  visual?: AttachmentVisualSummary | null;
  /** Same file already processed in this run under another case. */
  duplicateOf?: string;
}

export interface MotionRecord {
  documentId: string;
  motionId: string;
  date: string | null;
  name: string | null;
  status: string | null;
  decisionNumber: string | null;
  response: 'PDF' | 'HTML' | 'EMPTY' | 'OTHER' | 'FAILED' | 'NOT_FETCHED';
  textChars: number;
  sha256: string | null;
  /** The operative decision read from the response text, when there is one. */
  decision: ExtractedDecision | null;
}

/**
 * Discovery is complete; processing is selective. This says exactly how far
 * processing got and why anything was not processed, so a budget can never
 * masquerade as a finding.
 */
export interface ProcessingLedger {
  discovered: { documents: number; motions: number; attachments: number };
  processed: { details: number; responses: number; attachmentsRead: number; visualsOpened: number };
  deferred: { attachmentsBudget: number; attachmentsPriority: number };
  skipped: { emptyResponses: number; unsupportedFormats: number; duplicateReferences: number };
  failed: { details: number; responses: number; attachments: number };
  /** True when anything potentially material was not evaluated. */
  incomplete: boolean;
  incompleteReasons: string[];
}

/**
 * One official visual asset. Provenance travels with every asset; the
 * customer-facing scope (EXACT_UNIT / BUILDING / TYPICAL_FLOOR / PROJECT /
 * UNRELATED_SUSPECT) is decided downstream against the requested unit from
 * `identity` (src/verify/intelligence/visualAssets.ts), because a TAS result
 * is shared by every flat on the parcel.
 */
export interface VisualRecord {
  id: string; // sha256 of the image bytes
  role: 'LATEST_RENDER' | 'EARLIEST_RENDER' | 'SUPPORTING';
  kind: VisualKind;
  category: VisualCategory;
  /** 0..1 classification confidence. */
  confidence: number;
  /** The evidence that decided `kind` (audit). */
  classificationBasis: string;
  documentId: string;
  attachedFileId: string;
  motionId: string | null;
  date: string | null;
  fileName: string | null;
  /** 1-based PDF page for rendered drawing pages; null otherwise. */
  page: number | null;
  mime: string;
  width: number | null;
  height: number | null;
  bytes: number;
  extraction: 'NATIVE_IMAGE' | 'PDF_EMBEDDED_IMAGE' | 'PDF_PAGE_RENDER';
  identity: IdentityHints;
  source: 'TAS';
  usage: 'OFFICIAL_RECORD_REFERENCE';
  /** Set on assets from the two newest cases. */
  priority?: PriorityRank;
  /** Queue path: set once the worker stored the bytes at storagePath. */
  stored?: boolean;
}

export interface CaseFormRecord {
  status: FormCapture['status'];
  fields: TasValue[];
  method: string | null;
  rawSha256?: string;
  reason: string | null;
}

export interface TasApiCase {
  detail: TasCaseDetail;
  searchRow: TasSearchRow;
  motions: MotionRecord[];
  attachments: AttachmentRecord[];
  /** Bounded, source-ordered text of the case (structured fields first). Priority cases: complete. */
  text: string;
  /** The complete case text (every response and attachment read). Facts are
   *  extracted from it in the worker; the queue path stores it as evidence.
   *  Never sent in the legacy polling payload. */
  fullText?: string;
  textTruncated: boolean;
  priority?: PriorityRank | null;
  form?: CaseFormRecord | null;
  completeness?: PriorityCompleteness | null;
  /** Sanitized raw detail reply (personal ids masked, phones/e-mails removed), content-addressed. Stored by the queue executor; never sent inline. */
  rawDetail?: { sha256: string; json: string } | null;
  /** Sanitized raw form reply, when a form call was made. */
  rawForm?: { sha256: string; json: string } | null;
}

export interface PrioritySummary {
  priority: PriorityRank;
  documentId: string;
  registrationNumber: string | null;
  date: string | null;
  parcelMatch: boolean | null;
  detailRead: boolean;
  formStatus: FormCapture['status'] | null;
  completeness: PriorityCompleteness;
}

export interface TasTimings {
  startedAt: string;
  finishedAt: string | null;
  totalMs: number;
  searchMs: number;
  detailMs: number;
  formDiscoveryMs: number;
  priorityCasesMs: number;
  olderCasesMs: number;
  /** Summed busy time across concurrent downloads (can exceed wall-clock). */
  attachmentDownloadsMs: number;
  pdfTextMs: number;
  pageRenderMs: number;
  visualClassifyMs: number;
  counts: {
    searchPages: number;
    details: number;
    priorityCases: number;
    priorityAttachments: number;
    olderAttachments: number;
    downloads: number;
    downloadBytes: number;
    pdfsParsed: number;
    pagesRendered: number;
    visualsClassified: number;
    formRequests: number;
    httpRequests: number;
  };
}

export interface TasApiResult {
  implementation: typeof TAS_API_IMPLEMENTATION;
  version: typeof TAS_API_VERSION;
  requestedCadastralCode: string;
  searchCadastralCode: string | null;
  attempts: Array<{ cadastralCodeTried: string; uniqueDocuments: number; sourceTotal: number | null }>;
  reconciliation: SearchReconciliation | null;
  cases: TasApiCase[];
  visuals: VisualRecord[];
  /** Every visual asset produced from the priority cases (bounded; the gallery `visuals` holds a subset). */
  priorityVisuals: VisualRecord[];
  priority: PrioritySummary[];
  priorityCoverage: 'COMPLETE' | 'PARTIAL';
  priorityCoverageReasons: string[];
  formDiscovery: ReturnType<typeof formDiscoveryDiagnostics> | null;
  timings: TasTimings;
  accounting: {
    documents: number;
    detailsRead: number;
    detailFailures: number;
    motions: number;
    responses: Record<MotionRecord['response'], number>;
    attachments: number;
    caseLevelAttachments: number;
    attachmentOutcomes: Record<AttachmentOutcome, number>;
    pdfAttachments: number;
    nonPdfAttachments: number;
    cacheHits: number;
    visualCandidates: number;
    visualsExtracted: number;
    /** Files opened for visuals. */
    visualFilesOpened?: number;
    /** Drawing pages rendered to images. */
    pagesRendered?: number;
    renderFailures?: number;
    /** Visual work left undone by the time/byte/asset bounds. */
    visualsSkippedBudget?: number;
    /** Priority assets not kept because the priority visual bound was reached (still classified on the attachment). */
    priorityVisualsCapped?: number;
  };
  http: { requests: number; retries: number; bytes: number; failures: number };
  ledger: ProcessingLedger | null;
  durationMs: number;
  deadlineReached: boolean;
  /** True only when every search candidate ran to a stop condition. A run cut short in search is never "no result". */
  searchComplete: boolean;
  error: string | null;
}

// ─────────────────────────── bounded in-process caches ───────────────────────────

interface PriorityCacheInfo {
  scanPages: number[];
  visuals: VisualRecord[];
  summary: AttachmentVisualSummary | null;
  pagesRendered: number;
  imagesProcessed: number;
  scanPagesUnrendered: number;
  renderFailed: boolean;
}
interface CachedText {
  sha256: string;
  text: string;
  pages: number | null;
  outcome: AttachmentOutcome;
  format: string | null;
  at: number;
  /** Priority processing done for this file: page info + visual metadata (bytes live in VISUAL_CACHE). */
  priority?: PriorityCacheInfo;
}
const TEXT_CACHE = new Map<string, CachedText>();
const TEXT_CACHE_MAX = 3000;
const TEXT_CACHE_TTL = 24 * 3600 * 1000;

function cacheGet(key: string, now: number): CachedText | null {
  const v = TEXT_CACHE.get(key);
  if (!v) return null;
  if (now - v.at > TEXT_CACHE_TTL) {
    TEXT_CACHE.delete(key);
    return null;
  }
  return v;
}
function cachePut(key: string, v: CachedText): void {
  TEXT_CACHE.set(key, v);
  while (TEXT_CACHE.size > TEXT_CACHE_MAX) TEXT_CACHE.delete(TEXT_CACHE.keys().next().value as string);
}

/** Chosen visuals, held until they are stored (by sha256). Bounded by count AND bytes. */
const VISUAL_CACHE = new Map<string, { bytes: Uint8Array; mime: string; at: number }>();
const VISUAL_CACHE_MAX = 160;
const VISUAL_CACHE_BYTES_MAX = 400 * 1024 * 1024;
let visualCacheBytes = 0;
export function getCachedVisual(sha: string): { bytes: Uint8Array; mime: string } | null {
  const v = VISUAL_CACHE.get(sha);
  return v ? { bytes: v.bytes, mime: v.mime } : null;
}
function putVisual(sha: string, bytes: Uint8Array, mime: string): void {
  const prev = VISUAL_CACHE.get(sha);
  if (prev) {
    visualCacheBytes -= prev.bytes.length;
    VISUAL_CACHE.delete(sha);
  }
  VISUAL_CACHE.set(sha, { bytes, mime, at: Date.now() });
  visualCacheBytes += bytes.length;
  while (VISUAL_CACHE.size > VISUAL_CACHE_MAX || (visualCacheBytes > VISUAL_CACHE_BYTES_MAX && VISUAL_CACHE.size > 1)) {
    const k = VISUAL_CACHE.keys().next().value as string;
    visualCacheBytes -= VISUAL_CACHE.get(k)?.bytes.length ?? 0;
    VISUAL_CACHE.delete(k);
  }
}
/** Test hook only. */
export function __resetTasApiCaches(): void {
  TEXT_CACHE.clear();
  VISUAL_CACHE.clear();
  visualCacheBytes = 0;
}

const sha256 = (b: Uint8Array): string => createHash("sha256").update(bytesToBuffer(b)).digest('hex');
const sha256Text = (s: string): string => createHash('sha256').update(s).digest('hex');

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

/** Per-page usable text below this many characters = a scanned / image-only page. */
const PAGE_TEXT_MIN = 50;
function scanPagesOf(pages: string[] | undefined, text: string, numpages: number | null): number[] {
  if (pages && pages.length) return pages.map((p, i) => (p.replace(/\s+/g, ' ').trim().length < PAGE_TEXT_MIN ? i + 1 : 0)).filter(Boolean);
  // No per-page split: only an (almost) text-free document is known to be scanned.
  if (text.replace(/\s+/g, ' ').trim().length < PAGE_TEXT_MIN && numpages) return Array.from({ length: numpages }, (_, i) => i + 1);
  return [];
}

// ─────────────────────────────── the workflow ───────────────────────────────

/**
 * WHICH CADASTRAL CODE DOES TAS ANSWER FOR? One search request per candidate
 * (flat first, then its parents), stopping at the first that has case files —
 * exactly the order acquireTasApi() uses. Lets the queue share one parcel
 * read across every flat in a building that has no case files of its own.
 */
export async function probeTasResolvedCode(query: string, options: TasApiOptions = {}): Promise<{ code: string | null; tried: string[] }> {
  const now = options.now ?? Date.now;
  const client = new TasApiClient({
    fetcher: options.fetcher,
    deadlineAt: now() + Math.min(options.budgetMs ?? 60_000, 60_000),
    concurrency: 1,
    minGapMs: options.minGapMs ?? 250,
    signal: options.signal,
  });
  const pageSize = options.pageSize ?? TAS_PAGE_SIZE;
  const tried: string[] = [];
  for (const code of isCadastralCode(query) ? candidateSequence(query) : [query]) {
    tried.push(code);
    const page = parseSearchPage((await client.search(code, 0, pageSize)).data);
    if (page.rows.length) return { code, tried };
  }
  return { code: null, tried };
}

interface TextPiece {
  kind: 1 | 2; // 1 = motion response, 2 = attachment
  date: string | null;
  id: string;
  text: string;
  /** Decision / conflict / registered-right content (survives the older-case budget first). */
  material: boolean;
}

type AttJob = { docId: string; a: TasCaseDetail['attachments'][number] };
type Out = { bytes: Uint8Array; width: number | null; height: number | null; extraction: VisualRecord['extraction']; page: number | null; pageText: string | null };

/** Deterministic id order: numeric-aware ascending. */
const idAsc = (x: string, y: string) => x.length - y.length || x.localeCompare(y);

export async function acquireTasApi(query: string, options: TasApiOptions = {}): Promise<TasApiResult> {
  const now = options.now ?? Date.now;
  const started = now();
  const perf0 = performance.now();
  const budget = options.budgetMs ?? 9 * 60 * 1000;
  const concurrency = options.concurrency ?? 3;
  const client = new TasApiClient({
    fetcher: options.fetcher,
    deadlineAt: started + budget,
    concurrency,
    minGapMs: options.minGapMs ?? 250,
    signal: options.signal,
  });
  const parsePdf = options.parsePdf ?? defaultPdfParser;
  const pageSize = options.pageSize ?? TAS_PAGE_SIZE;
  const maxPages = options.maxPages ?? 60;
  // Text sent to research-agent per OLDER case. The edge function has a 2 s CPU
  // budget: 40k per case × dozens of cases (Villion, 2026-10-10) made every
  // poll exceed it ("CPU Time exceeded", 546). Facts are still read from the
  // complete text here in the worker.
  const caseTextBudget = options.caseTextBudget ?? 8_000;
  const maxDownloads = options.maxAttachmentDownloads ?? 500;
  const priorityCount = Math.max(0, Math.min(options.priorityCount ?? 2, 2));
  const priorityConcurrency = Math.max(1, Math.min(options.priorityConcurrency ?? Math.min(3, concurrency), 3));
  const priorityMaxBytes = options.priorityMaxBytes ?? 150 * 1024 * 1024;
  const priorityReserveMs = options.priorityReserveMs ?? 15_000;
  const priorityRenderMax = options.priorityRenderPages ?? 48;
  const priorityRenderPerFile = options.priorityRenderPagesPerFile ?? 12;
  const priorityVisualMax = Math.min(options.priorityVisualMax ?? PRIORITY_VISUAL_MAX, PRIORITY_VISUAL_MAX);
  const priorityVisualBytesMax = options.priorityVisualBytesMax ?? 192 * 1024 * 1024;

  const outcomes = (): Record<AttachmentOutcome, number> => ({
    READ_TEXT: 0, LOW_TEXT: 0, SCAN_OR_IMAGE_ONLY: 0, FAILED: 0, IMAGE: 0, UNSUPPORTED_FORMAT: 0, EMPTY: 0, DOWNLOAD_FAILED: 0, NOT_PROCESSED_BUDGET: 0, DEFERRED: 0,
  });
  const timings: TasTimings = {
    startedAt: new Date().toISOString(), finishedAt: null, totalMs: 0, searchMs: 0, detailMs: 0, formDiscoveryMs: 0, priorityCasesMs: 0, olderCasesMs: 0,
    attachmentDownloadsMs: 0, pdfTextMs: 0, pageRenderMs: 0, visualClassifyMs: 0,
    counts: { searchPages: 0, details: 0, priorityCases: 0, priorityAttachments: 0, olderAttachments: 0, downloads: 0, downloadBytes: 0, pdfsParsed: 0, pagesRendered: 0, visualsClassified: 0, formRequests: 0, httpRequests: 0 },
  };
  const timed = async <T>(key: 'attachmentDownloadsMs' | 'pdfTextMs' | 'pageRenderMs' | 'visualClassifyMs', fn: () => Promise<T> | T): Promise<T> => {
    const t = performance.now();
    try {
      return await fn();
    } finally {
      timings[key] += performance.now() - t;
    }
  };
  const result: TasApiResult = {
    implementation: TAS_API_IMPLEMENTATION,
    version: TAS_API_VERSION,
    requestedCadastralCode: query,
    searchCadastralCode: null,
    attempts: [],
    reconciliation: null,
    cases: [],
    visuals: [],
    priorityVisuals: [],
    priority: [],
    priorityCoverage: 'COMPLETE',
    priorityCoverageReasons: [],
    formDiscovery: null,
    timings,
    accounting: {
      documents: 0, detailsRead: 0, detailFailures: 0, motions: 0,
      responses: { PDF: 0, HTML: 0, EMPTY: 0, OTHER: 0, FAILED: 0, NOT_FETCHED: 0 },
      attachments: 0, caseLevelAttachments: 0, attachmentOutcomes: outcomes(), pdfAttachments: 0, nonPdfAttachments: 0,
      cacheHits: 0, visualCandidates: 0, visualsExtracted: 0, visualFilesOpened: 0, pagesRendered: 0, renderFailures: 0, visualsSkippedBudget: 0, priorityVisualsCapped: 0,
    },
    http: client.stats,
    ledger: null,
    durationMs: 0,
    deadlineReached: false,
    searchComplete: false,
    error: null,
  };

  try {
    // ── 1. search, exhaustively, on the base parcel first ──
    let mark = performance.now();
    const candidates = isCadastralCode(query) ? candidateSequence(query) : [query];
    let rows: TasSearchRow[] = [];
    for (const code of candidates) {
      const pages: TasSearchPage[] = [];
      let stop: SearchReconciliation['stopReason'] = 'MAX_PAGES';
      let total: number | null = null;
      const fingerprints = new Set<string>();
      for (let p = 0; p < maxPages; p++) {
        const page = parseSearchPage((await client.search(code, p * pageSize, pageSize)).data);
        timings.counts.searchPages++;
        total = page.total ?? total;
        const fp = page.rows.map((r) => r.documentId).join(',');
        if (page.rows.length === 0) {
          stop = 'EMPTY_PAGE';
          break;
        }
        if (fingerprints.has(fp)) {
          stop = 'REPEATED_PAGE';
          break;
        }
        fingerprints.add(fp);
        pages.push(page);
        const unique = mergeSearchPages(pages).rows.length;
        if (total !== null && unique >= total) {
          stop = 'TOTAL_REACHED';
          break;
        }
        // A server that ignores paging returns everything on page one.
        if (page.rows.length < pageSize && total === null) {
          stop = 'SHORT_PAGE';
          break;
        }
      }
      const merged = mergeSearchPages(pages);
      result.attempts.push({ cadastralCodeTried: code, uniqueDocuments: merged.rows.length, sourceTotal: total });
      result.reconciliation = {
        pagesRequested: pages.length + (stop === 'EMPTY_PAGE' || stop === 'REPEATED_PAGE' ? 1 : 0),
        rowsSeen: pages.reduce((s, pg) => s + pg.rows.length, 0),
        uniqueDocumentIds: merged.rows.length,
        duplicateRows: merged.duplicates,
        sourceTotal: total,
        reconciled: total === null ? null : total === merged.rows.length,
        stopReason: stop,
      };
      result.searchCadastralCode = code;
      rows = merged.rows;
      if (rows.length) break;
    }
    result.searchComplete = true;
    result.accounting.documents = rows.length;
    timings.searchMs = performance.now() - mark;

    // ── 2. case detail graphs ──
    mark = performance.now();
    const details = new Map<string, TasCaseDetail>();
    const rawDetails = new Map<string, { sha256: string; json: string }>();
    const readDetail = async (row: TasSearchRow): Promise<boolean> => {
      try {
        const r = await client.detail(row.documentId);
        details.set(row.documentId, normalizeCaseDetail(row.documentId, r.data, r.objectCount));
        // The sanitized raw reply as content-addressed evidence: form fields
        // the normalisation does not map yet are never lost.
        const json = JSON.stringify(sanitizeGraph(toPlain(r.data)));
        if (json.length <= 2_000_000) rawDetails.set(row.documentId, { sha256: sha256Text(json), json });
        result.accounting.detailsRead++;
        timings.counts.details++;
        return true;
      } catch (e) {
        // A deadline leaves the remaining details unread (DETAILS_NOT_READ);
        // what was read is still assembled and accounted.
        if (e instanceof TasDeadline) result.deadlineReached = true;
        else result.accounting.detailFailures++;
        return false;
      }
    };
    await pool(rows, concurrency, async (row) => {
      await readDetail(row);
    });
    timings.detailMs = performance.now() - mark;

    // ── 3. the two newest cases of THIS parcel ──
    const picks = selectPriorityCases(
      rows.map((row) => {
        const d = details.get(row.documentId);
        return {
          documentId: row.documentId,
          registrationNumber: d?.registrationNumber ?? row.registrationNumber,
          date: d?.submittedAt ?? row.date ?? null,
          cadastralCodes: [...(d?.cadastralCodes ?? []), ...(row.cadastralCode ? [row.cadastralCode] : [])],
        };
      }),
      result.searchCadastralCode,
      priorityCount,
    );
    // One more attempt for a priority case whose detail failed (not past the deadline).
    for (const p of picks) {
      const row = rows.find((r) => r.documentId === p.documentId)!;
      if (!details.has(p.documentId) && !result.deadlineReached) {
        if (await readDetail(row)) result.accounting.detailFailures = Math.max(0, result.accounting.detailFailures - 1);
      }
    }
    const priorityOf = new Map<string, PriorityRank>(picks.map((p) => [p.documentId, p.priority]));
    timings.counts.priorityCases = picks.length;

    // ── shared state for motions / attachments ──
    const casePieces = new Map<string, TextPiece[]>();
    const pushPiece = (docId: string, p: TextPiece) => {
      const arr = casePieces.get(docId) ?? [];
      arr.push({ ...p, text: redactPersonalData(p.text) });
      casePieces.set(docId, arr);
    };
    const motionRecords = new Map<string, MotionRecord[]>();
    const attachmentRecords = new Map<string, AttachmentRecord[]>();
    const motionJobs: Array<{ docId: string; m: TasCaseDetail['motions'][number] }> = [];
    const attachmentJobs: AttJob[] = [];
    for (const row of rows) {
      const d = details.get(row.documentId);
      if (!d) continue;
      for (const m of d.motions) motionJobs.push({ docId: row.documentId, m });
      for (const a of d.attachments) attachmentJobs.push({ docId: row.documentId, a });
    }
    result.accounting.motions = motionJobs.length;
    result.accounting.attachments = attachmentJobs.length;
    result.accounting.caseLevelAttachments = attachmentJobs.filter((j) => j.a.motionId === null).length;

    const motionNames = new Map<string, string>();
    for (const { m } of motionJobs) if (m.name) motionNames.set(m.motionId, m.name);
    const caseContext = (docId: string, motionId: string | null): string => {
      const d = details.get(docId);
      return [d?.title, d?.docType, d?.description, motionId ? motionNames.get(motionId) : null].filter(Boolean).join(' · ').slice(0, 600);
    };

    const processMotion = async ({ docId, m }: { docId: string; m: TasCaseDetail['motions'][number] }) => {
      const rec: MotionRecord = { documentId: docId, motionId: m.motionId, date: m.date, name: m.name, status: m.status, decisionNumber: m.decisionNumber, response: 'NOT_FETCHED', textChars: 0, sha256: null, decision: null };
      const key = `resp:${docId}:${m.motionId}`;
      const cached = cacheGet(key, now());
      let text = '';
      try {
        if (cached) {
          result.accounting.cacheHits++;
          rec.response = cached.outcome === 'EMPTY' ? 'EMPTY' : cached.format === 'pdf' ? 'PDF' : cached.format === 'html' ? 'HTML' : 'OTHER';
          rec.sha256 = cached.sha256;
          text = cached.text;
        } else {
          const r = await client.request(responseUrl(docId, m.motionId));
          const cls = classifyPayload({ status: r.status, contentType: r.contentType, bytes: r.bytes });
          rec.sha256 = r.bytes.length ? sha256(r.bytes) : null;
          let pages: number | null = null;
          if (cls.kind === 'PDF') {
            rec.response = 'PDF';
            try {
              const parsed = await timed('pdfTextMs', () => parsePdf(bytesToBuffer(r.bytes)));
              timings.counts.pdfsParsed++;
              text = repairGeorgianMojibake(parsed.text ?? '');
              pages = parsed.numpages ?? null;
            } catch { /* response exists but has no readable text layer */ }
          } else if (cls.kind === 'HTML') {
            rec.response = 'HTML';
            text = htmlToText(bytesToBuffer(r.bytes).toString('utf8'));
          } else if (cls.kind === 'EMPTY') rec.response = 'EMPTY';
          else if (cls.kind === 'FAILED') rec.response = 'FAILED';
          else rec.response = 'OTHER';
          // An EMPTY answer is not cached: a decision uploaded later must be seen on the next run.
          if (rec.response !== 'FAILED' && rec.response !== 'EMPTY')
            cachePut(key, { sha256: rec.sha256 ?? '', text, pages, outcome: 'READ_TEXT', format: cls.format ?? cls.kind.toLowerCase(), at: now() });
        }
        rec.textChars = text.length;
        rec.decision = text ? extractDecision(text) : null;
        if (rec.decision && !rec.decisionNumber && rec.decision.number) rec.decisionNumber = rec.decision.number;
        if (text) {
          const dec = rec.decision;
          const decided = !!dec && dec.outcome !== 'UNDETERMINED' && dec.outcome !== 'INFORMATIONAL';
          const head = decided ? `DECISION ${dec!.outcome}${dec!.number ? ` N ${dec!.number}` : ''}${dec!.issueDate ? ` (${dec!.issueDate})` : ''}\n` : '';
          pushPiece(docId, {
            kind: 1, date: m.date, id: m.motionId, material: decided || MATERIAL_TEXT.test(text.slice(0, 20_000)),
            text: `[${m.date?.slice(0, 10) ?? 'undated'} · ${m.name ?? 'motion'} · response]\n${head}${text}`,
          });
        }
      } catch (e) {
        if (e instanceof TasDeadline) {
          result.deadlineReached = true;
          rec.response = 'NOT_FETCHED';
        } else rec.response = 'FAILED';
      }
      result.accounting.responses[rec.response]++;
      const list = motionRecords.get(docId) ?? [];
      list.push(rec);
      motionRecords.set(docId, list);
    };

    const recordAttachment = (docId: string, a: TasCaseDetail['attachments'][number], rec: AttachmentRecord) => {
      if ((rec.format ?? a.extension) === 'pdf') result.accounting.pdfAttachments++;
      else result.accounting.nonPdfAttachments++;
      result.accounting.attachmentOutcomes[rec.outcome]++;
      const list = attachmentRecords.get(docId) ?? [];
      list.push(rec);
      attachmentRecords.set(docId, list);
    };
    const attachmentPiece = (docId: string, a: TasCaseDetail['attachments'][number], text: string) =>
      pushPiece(docId, {
        kind: 2, date: a.date, id: a.attachedFileId, material: MATERIAL_TEXT.test(`${a.fileName ?? ''} ${a.description ?? ''}`),
        text: `[${a.date?.slice(0, 10) ?? 'undated'} · ${a.fileName ?? 'attachment'}]\n${text}`,
      });

    // Visual shortlist (gallery), ranked on metadata over ALL cases.
    const ranked = rankVisualCandidates(
      attachmentJobs.map((j) => ({ ...j.a, documentId: j.docId, context: caseContext(j.docId, j.a.motionId), caseCadastralCodes: details.get(j.docId)?.cadastralCodes ?? [] })),
      { parcel: result.searchCadastralCode },
    );
    result.accounting.visualCandidates = ranked.length;
    const shortlist = selectVisualShortlist(ranked, options.visualTarget ?? VISUAL_FILE_MAX, VISUAL_FILE_MAX);
    const shortlistIds = new Set(shortlist.map((s) => s.candidate.attachedFileId));
    const slotOf = new Map(shortlist.map((sl, i) => [sl.candidate.attachedFileId, { slot: sl, order: i }]));

    // ── gallery bounds (shared by both phases) ──
    const assetMax = Math.min(Math.max(1, options.visualMax ?? VISUAL_ASSET_MAX), VISUAL_ASSET_MAX);
    const bytesMax = options.visualBytesMax ?? 96 * 1024 * 1024;
    const visualDeadline = Math.min(started + budget - 5_000, started + budget);
    const visualBudgetMs = options.visualBudgetMs ?? 180_000;
    let visualFirstAt: number | null = null;
    let visualBytes = 0;
    let visualsClosed = false;
    let renderer: PdfPageRenderer | null = null;
    // One Chromium, one render at a time.
    let renderLock: Promise<unknown> = Promise.resolve();
    const renderPages = (bytes: Uint8Array, o: Parameters<PdfPageRenderer['render']>[1]) => {
      const run = renderLock.then(() => {
        renderer ??= options.renderPdfPages!();
        const rr = renderer;
        return timed('pageRenderMs', () => rr.render(bytes, o));
      });
      renderLock = run.catch(() => {});
      return run;
    };
    const visualOrder = new Map<string, number>();
    const galleryHas = (id: string) => result.visuals.some((v) => v.id === id);
    const addToGallery = (rec: VisualRecord, order: number): boolean => {
      if (visualsClosed || result.visuals.length >= assetMax || galleryHas(rec.id) || visualBytes + rec.bytes > bytesMax) return false;
      visualBytes += rec.bytes;
      visualOrder.set(rec.id, order);
      result.visuals.push(rec);
      return true;
    };

    /** One visual record from extracted bytes (classification refined by the image itself). */
    const makeVisual = (
      c: { kind: VisualKind; category: VisualCategory; confidence: number; basis: string; documentId: string; attachedFileId: string; motionId: string | null; date: string | null; fileName: string | null; description: string | null; caseCadastralCodes: string[] },
      o: Out, role: VisualRecord['role'], priority?: PriorityRank,
    ): VisualRecord | null => {
      if (!o.bytes.length || o.bytes.length > 8 * 1024 * 1024) return null;
      const size = imageSize(o.bytes);
      if (!size || size.width < 400 || size.height < 250) return null;
      const id = sha256(o.bytes);
      const context = caseContext(c.documentId, c.motionId);
      const cls = refineWithImage(
        { kind: c.kind, category: c.category, confidence: c.confidence, basis: c.basis },
        { exif: size.mime === 'image/jpeg' ? readExif(o.bytes) : null, extraction: o.extraction, pageText: o.pageText, context },
      );
      timings.counts.visualsClassified++;
      putVisual(id, o.bytes, size.mime);
      return {
        id,
        // Only a render carries LATEST/EARLIEST.
        role: role !== 'SUPPORTING' && cls.kind === 'RENDER' ? role : 'SUPPORTING',
        kind: cls.kind,
        category: cls.category,
        confidence: Math.round(cls.confidence * 100) / 100,
        classificationBasis: cls.basis,
        documentId: c.documentId,
        attachedFileId: c.attachedFileId,
        motionId: c.motionId,
        date: c.date,
        fileName: c.fileName,
        page: o.page,
        mime: size.mime,
        width: size.width ?? o.width,
        height: size.height ?? o.height,
        bytes: o.bytes.length,
        extraction: o.extraction,
        identity: identityHints({
          fileName: c.fileName, description: c.description, caseText: context, pageText: o.pageText,
          caseCadastralCodes: c.caseCadastralCodes, parcel: result.searchCadastralCode,
        }),
        source: 'TAS',
        usage: 'OFFICIAL_RECORD_REFERENCE',
        ...(priority ? { priority } : {}),
      };
    };

    // ── 4. PRIORITY PHASE: before any older-case budget is spent ──
    mark = performance.now();
    const priorityFormByDoc = new Map<string, FormCapture & { raw?: { sha256: string; json: string } }>();
    const formState = newFormDiscoveryState(options.formDiscovery !== false);
    const fmark = performance.now();
    for (const p of picks) {
      if (!details.has(p.documentId)) continue;
      priorityFormByDoc.set(p.documentId, await captureCaseForm(client, p.documentId, formState));
    }
    timings.formDiscoveryMs = performance.now() - fmark;
    timings.counts.formRequests = formState.requests;
    result.formDiscovery = picks.length ? formDiscoveryDiagnostics(formState) : null;

    await pool(motionJobs.filter((j) => priorityOf.has(j.docId)), concurrency, processMotion);

    // Deterministic order (priority 1 first, then by file id): a follow-up
    // run walks the same order and the per-file cache makes finished work free.
    const priorityJobs = attachmentJobs
      .filter((j) => priorityOf.has(j.docId))
      .sort((x, y) => priorityOf.get(x.docId)! - priorityOf.get(y.docId)! || idAsc(x.a.attachedFileId, y.a.attachedFileId));
    timings.counts.priorityAttachments = priorityJobs.length;
    let priorityRendered = 0;
    let priorityVisualBytes = 0;
    const inflight = new Map<string, Promise<AttachmentRecord>>();
    const parsedBySha = new Map<string, { text: string; pages: number | null; scan: number[]; outcome: AttachmentOutcome }>();

    /** Visual processing of one priority file: classify, extract embedded images, render pages. */
    const priorityVisual = async (job: AttJob, rank: PriorityRank, bytes: Uint8Array, isPdf: boolean, scan: number[]) => {
      const { docId, a } = job;
      const ctx = caseContext(docId, a.motionId);
      const meta = await timed('visualClassifyMs', () => classifyVisualMeta({ fileName: a.fileName, description: a.description, context: ctx, extension: a.extension }));
      const out = { records: [] as VisualRecord[], summary: null as AttachmentVisualSummary | null, pagesRendered: 0, imagesProcessed: 0, scanPagesUnrendered: 0, renderFailed: false };
      // Paperwork (contracts, extracts, IDs …) is never offered as a visual.
      const paperwork = meta === null;
      const base = {
        kind: (meta?.kind ?? 'OTHER') as VisualKind, category: (meta?.category ?? 'BUILDING') as VisualCategory, confidence: meta?.confidence ?? 0.3, basis: meta?.basis ?? 'paperwork',
        documentId: docId, attachedFileId: a.attachedFileId, motionId: a.motionId, date: a.date, fileName: a.fileName, description: a.description,
        caseCadastralCodes: details.get(docId)?.cadastralCodes ?? [],
      };
      const slot = slotOf.get(a.attachedFileId);
      const outs: Out[] = [];
      if (!isPdf) {
        if (!paperwork) outs.push({ bytes, width: null, height: null, extraction: 'NATIVE_IMAGE', page: null, pageText: null });
      } else if (!paperwork) {
        const embedded: Out[] = extractImagesFromPdf(bytes, { maxImages: 12 }).map((i) => ({ bytes: i.bytes, width: i.width, height: i.height, extraction: 'PDF_EMBEDDED_IMAGE' as const, page: null, pageText: null }));
        outs.push(...embedded);
        // Pages to render: scanned pages not already covered by embedded
        // rasters; otherwise the telling sheets of a drawing set, or the pages
        // of a picture PDF whose images are not plain JPEG streams.
        const scanToRender = embedded.length >= scan.length ? [] : scan;
        const wantAuto = DRAWING_KINDS.has(base.kind) ? Math.min(6, priorityRenderPerFile) : PICTURE_KINDS.has(base.kind) && !embedded.length ? Math.min(4, priorityRenderPerFile) : 0;
        const room = Math.max(0, Math.min(priorityRenderPerFile, priorityRenderMax - priorityRendered));
        const exact = scanToRender.slice(0, room);
        out.scanPagesUnrendered = scanToRender.length - exact.length;
        if (!options.renderPdfPages) out.scanPagesUnrendered += exact.length;
        else if (exact.length || (wantAuto && room)) {
          const left = started + budget - now();
          if (left < 8_000) out.scanPagesUnrendered += exact.length;
          else {
            const want = exact.length ? exact.length : Math.min(wantAuto, room);
            priorityRendered += want; // reserved before the (serialised) render
            try {
              const r = await renderPages(bytes, {
                maxPages: want,
                ...(exact.length ? { pages: exact } : {}),
                longEdge: options.renderLongEdge ?? 2200,
                maxBytes: 8 * 1024 * 1024,
                preferText: PREFER_PAGE_TEXT[base.kind] ?? null,
                timeoutMs: Math.max(5_000, Math.min(60_000, left - 3_000)),
              });
              priorityRendered -= want - r.pages.length;
              out.pagesRendered = r.pages.length;
              timings.counts.pagesRendered += r.pages.length;
              result.accounting.pagesRendered = (result.accounting.pagesRendered ?? 0) + r.pages.length;
              if (exact.length) out.scanPagesUnrendered += exact.filter((p) => !r.pages.some((x) => x.page === p)).length;
              outs.push(...r.pages.map((p) => ({ bytes: p.bytes, width: p.width, height: p.height, extraction: 'PDF_PAGE_RENDER' as const, page: p.page, pageText: p.text })));
            } catch {
              priorityRendered -= want;
              result.accounting.renderFailures = (result.accounting.renderFailures ?? 0) + 1;
              out.renderFailed = true;
              out.scanPagesUnrendered += exact.length;
            }
          }
        }
      }
      let first = true;
      for (const o of outs) {
        const rec = await timed('visualClassifyMs', () => makeVisual(base, o, first && slot ? slot.slot.role : 'SUPPORTING', rank));
        out.imagesProcessed++;
        if (!rec || out.records.some((x) => x.id === rec.id)) continue;
        first = false;
        out.records.push(rec);
      }
      const top = out.records[0];
      out.summary = paperwork ? null : {
        kind: top?.kind ?? base.kind, category: top?.category ?? base.category, confidence: top?.confidence ?? base.confidence,
        basis: top?.classificationBasis ?? base.basis, assets: out.records.length,
      };
      return out;
    };

    const keepPriorityVisuals = (records: VisualRecord[], attachedFileId: string) => {
      const slot = slotOf.get(attachedFileId);
      for (const v of records) {
        if (!result.priorityVisuals.some((x) => x.id === v.id)) {
          if (result.priorityVisuals.length >= priorityVisualMax || priorityVisualBytes + v.bytes > priorityVisualBytesMax) {
            result.accounting.priorityVisualsCapped = (result.accounting.priorityVisualsCapped ?? 0) + 1;
            continue;
          }
          priorityVisualBytes += v.bytes;
          result.priorityVisuals.push(v);
        }
        // A shortlisted priority file feeds the gallery in its slot's order.
        if (slot) addToGallery(v, slot.order * 100 + (v.page ?? 0));
      }
      if (slot) result.accounting.visualFilesOpened = (result.accounting.visualFilesOpened ?? 0) + 1;
    };

    const processPriorityAttachment = async (job: AttJob): Promise<AttachmentRecord> => {
      const { docId, a } = job;
      const rank = priorityOf.get(docId)!;
      const rec: AttachmentRecord = {
        attachedFileId: a.attachedFileId, documentId: docId, motionId: a.motionId, fileName: a.fileName, date: a.date,
        format: a.extension, outcome: 'DEFERRED', pages: null, textChars: 0, sha256: null, cached: false, priority: rank,
        sizeBytes: a.sizeBytes, visual: null,
      };
      // DWG / PLA / RAR …: accounted from metadata with the official link; never "read".
      if (isUnsupportedExtension(a.extension)) {
        rec.outcome = 'UNSUPPORTED_FORMAT';
        rec.url = attachmentUrl(a.attachedFileId);
        return rec;
      }
      const key = `att:${a.attachedFileId}`;
      const cached = cacheGet(key, now());
      // Continuation: finished work from an earlier run is reused (its visual bytes must still be held).
      if (cached?.priority && cached.priority.visuals.every((v) => getCachedVisual(v.id))) {
        result.accounting.cacheHits++;
        const pc = cached.priority;
        Object.assign(rec, {
          outcome: cached.outcome, pages: cached.pages, textChars: cached.text.length, sha256: cached.sha256, format: cached.format ?? rec.format, cached: true,
          scanPages: pc.scanPages, pagesRendered: pc.pagesRendered, imagesProcessed: pc.imagesProcessed,
          scanPagesUnrendered: pc.scanPagesUnrendered, renderFailed: pc.renderFailed, visual: pc.summary,
        });
        if (rec.outcome === 'UNSUPPORTED_FORMAT') rec.url = attachmentUrl(a.attachedFileId);
        if (cached.text) attachmentPiece(docId, a, cached.text);
        keepPriorityVisuals(pc.visuals.map((v) => ({ ...v, priority: rank })), a.attachedFileId);
        return rec;
      }
      if (client.remainingMs() < priorityReserveMs) {
        rec.outcome = 'DEFERRED';
        rec.deferredReason = 'RUN_DEADLINE';
        rec.url = attachmentUrl(a.attachedFileId);
        result.deadlineReached = true;
        return rec;
      }
      let bytes: Uint8Array;
      let declared: string | null = null;
      let cls: ReturnType<typeof classifyPayload>;
      try {
        const r = await timed('attachmentDownloadsMs', () => client.request(attachmentUrl(a.attachedFileId), {}, { maxBytes: priorityMaxBytes }));
        timings.counts.downloads++;
        timings.counts.downloadBytes += r.bytes.length;
        bytes = r.bytes;
        declared = fileNameFromDisposition(r.disposition);
        cls = classifyPayload({ status: r.status, contentType: r.contentType, bytes: r.bytes, fileName: declared ?? a.fileName });
      } catch (e) {
        rec.url = attachmentUrl(a.attachedFileId);
        if (e instanceof TasDeadline) {
          result.deadlineReached = true;
          rec.outcome = 'DEFERRED';
          rec.deferredReason = 'RUN_DEADLINE';
        } else if (e instanceof TasPayloadTooLarge) {
          rec.outcome = 'DEFERRED';
          rec.deferredReason = `PAYLOAD_TOO_LARGE:${String((e as Error).message).replace(/\D/g, '')}`;
        } else rec.outcome = 'DOWNLOAD_FAILED';
        return rec;
      }
      if (declared && !rec.fileName) rec.fileName = declared;
      rec.sha256 = bytes.length ? sha256(bytes) : null;
      rec.sizeBytes = bytes.length;
      rec.format = cls.format ?? rec.format;
      let text = '';
      let scan: number[] = [];
      if (cls.kind === 'FAILED') {
        rec.outcome = 'DOWNLOAD_FAILED';
        rec.url = attachmentUrl(a.attachedFileId);
      } else if (cls.kind === 'EMPTY') rec.outcome = 'EMPTY';
      else if (cls.kind === 'PDF') {
        const reuse = rec.sha256 ? parsedBySha.get(rec.sha256) : undefined;
        if (reuse) {
          text = reuse.text;
          scan = reuse.scan;
          rec.pages = reuse.pages;
          rec.outcome = reuse.outcome;
        } else {
          try {
            const parsed = await timed('pdfTextMs', () => parsePdf(bytesToBuffer(bytes)));
            timings.counts.pdfsParsed++;
            const pageTexts = parsed.pages?.map((p) => repairGeorgianMojibake(p ?? ''));
            // FULL text of every page — never sliced for a priority case.
            text = pageTexts && pageTexts.length ? pageTexts.join('\n\n').trim() : repairGeorgianMojibake(parsed.text ?? '');
            rec.pages = parsed.numpages ?? pageTexts?.length ?? null;
            rec.outcome = classifyPdfText(text, rec.pages);
            scan = scanPagesOf(pageTexts, text, rec.pages);
          } catch {
            rec.outcome = 'FAILED';
          }
          if (rec.sha256 && rec.outcome !== 'FAILED') parsedBySha.set(rec.sha256, { text, pages: rec.pages, scan, outcome: rec.outcome });
        }
        rec.scanPages = scan;
      } else if (cls.kind === 'IMAGE') rec.outcome = 'IMAGE';
      else if (cls.kind === 'HTML') {
        text = htmlToText(bytesToBuffer(bytes).toString('utf8'));
        rec.outcome = text.length > 40 ? 'READ_TEXT' : 'LOW_TEXT';
      } else {
        rec.outcome = 'UNSUPPORTED_FORMAT'; // office / archive / unknown binary: accounted, never "interpreted"
        rec.url = attachmentUrl(a.attachedFileId);
      }
      rec.textChars = text.length;
      let vis: Awaited<ReturnType<typeof priorityVisual>> | null = null;
      if ((cls.kind === 'PDF' && rec.outcome !== 'FAILED') || cls.kind === 'IMAGE') {
        vis = await priorityVisual(job, rank, bytes, cls.kind === 'PDF', scan);
        Object.assign(rec, { pagesRendered: vis.pagesRendered, imagesProcessed: vis.imagesProcessed, scanPagesUnrendered: vis.scanPagesUnrendered, renderFailed: vis.renderFailed, visual: vis.summary });
        keepPriorityVisuals(vis.records, a.attachedFileId);
      }
      if (rec.outcome !== 'DOWNLOAD_FAILED')
        cachePut(key, {
          sha256: rec.sha256 ?? '', text, pages: rec.pages, outcome: rec.outcome, format: rec.format, at: now(),
          priority: {
            scanPages: scan, visuals: vis?.records ?? [], summary: vis?.summary ?? null, pagesRendered: vis?.pagesRendered ?? 0,
            imagesProcessed: vis?.imagesProcessed ?? 0, scanPagesUnrendered: vis?.scanPagesUnrendered ?? 0, renderFailed: vis?.renderFailed ?? false,
          },
        });
      if (text) attachmentPiece(docId, a, text);
      return rec;
    };

    await pool(priorityJobs, priorityConcurrency, async (job) => {
      // The same file cited twice (or by both priority cases): processed once, never re-downloaded.
      const prior = inflight.get(job.a.attachedFileId);
      const p = prior ?? processPriorityAttachment(job);
      if (!prior) inflight.set(job.a.attachedFileId, p);
      const base = await p;
      let rec = base;
      if (prior) {
        rec = { ...base, documentId: job.docId, motionId: job.a.motionId, priority: priorityOf.get(job.docId)!, cached: true, duplicateOf: base.documentId };
        const t = base.textChars ? cacheGet(`att:${job.a.attachedFileId}`, now())?.text : null;
        if (t && job.docId !== base.documentId) attachmentPiece(job.docId, job.a, t);
      }
      recordAttachment(job.docId, job.a, rec);
    });
    timings.priorityCasesMs = performance.now() - mark;

    // ── 5. OLDER CASES: every response; attachments within the relevance budget ──
    mark = performance.now();
    await pool(motionJobs.filter((j) => !priorityOf.has(j.docId)), concurrency, processMotion);

    let downloads = 0;
    // Older-case visuals, processed AS THE SHORTLISTED FILES ARRIVE (they
    // download first), one at a time, concurrently with the remaining
    // downloads — bounded by assets, bytes and wall-clock, never past the
    // run deadline.
    const overBudget = () =>
      visualsClosed || result.visuals.length >= assetMax || visualBytes >= bytesMax || now() >= visualDeadline ||
      (visualFirstAt !== null && now() - visualFirstAt > visualBudgetMs);
    const processVisual = async (slot: VisualSlot, order: number, bytes: Uint8Array): Promise<void> => {
      if (overBudget()) {
        result.accounting.visualsSkippedBudget = (result.accounting.visualsSkippedBudget ?? 0) + 1;
        return;
      }
      visualFirstAt ??= now();
      result.accounting.visualFilesOpened = (result.accounting.visualFilesOpened ?? 0) + 1;
      const c = slot.candidate;
      const per = assetsPerFile(c);
      let outs: Out[] = [];
      const isPdf = bytesToBuffer(bytes.subarray(0, 4)).toString('latin1') === '%PDF';
      const embedded = (): Out[] =>
        extractImagesFromPdf(bytes, { maxImages: per.images }).map((i) => ({ bytes: i.bytes, width: i.width, height: i.height, extraction: 'PDF_EMBEDDED_IMAGE' as const, page: null, pageText: null }));
      const render = async (): Promise<Out[]> => {
        if (!options.renderPdfPages || per.pages < 1) return [];
        const left = visualDeadline - now();
        if (left < 8_000) return [];
        try {
          const r = await renderPages(bytes, {
            maxPages: Math.max(1, Math.min(per.pages, assetMax - result.visuals.length)),
            longEdge: options.renderLongEdge ?? 2200,
            maxBytes: 8 * 1024 * 1024,
            preferText: PREFER_PAGE_TEXT[c.kind] ?? null,
            timeoutMs: Math.min(45_000, left - 3_000),
          });
          result.accounting.pagesRendered = (result.accounting.pagesRendered ?? 0) + r.pages.length;
          timings.counts.pagesRendered += r.pages.length;
          return r.pages.map((p) => ({ bytes: p.bytes, width: p.width, height: p.height, extraction: 'PDF_PAGE_RENDER' as const, page: p.page, pageText: p.text }));
        } catch {
          result.accounting.renderFailures = (result.accounting.renderFailures ?? 0) + 1;
          return [];
        }
      };
      if (!isPdf) outs = [{ bytes, width: null, height: null, extraction: 'NATIVE_IMAGE', page: null, pageText: null }];
      else if (DRAWING_KINDS.has(c.kind)) {
        // A drawing is vector line work: render its pages; a scanned sheet
        // falls back to its embedded raster.
        outs = await render();
        if (!outs.length) outs = embedded();
      } else {
        // Photos and renders keep their original pixels when embedded.
        outs = embedded();
        if (!outs.length) outs = await render();
      }
      let firstOfSlot = true;
      for (const o of outs) {
        if (visualsClosed || result.visuals.length >= assetMax) break;
        if (visualBytes + o.bytes.length > bytesMax) continue;
        const rec = await timed('visualClassifyMs', () => makeVisual(c, o, firstOfSlot ? slot.role : 'SUPPORTING'));
        if (!rec || galleryHas(rec.id)) continue;
        // Only the slot's first render carries LATEST/EARLIEST.
        if (addToGallery(rec, order * 100 + (o.page ?? 0))) firstOfSlot = false;
      }
    };
    let visualChain: Promise<void> = Promise.resolve();
    const enqueueVisual = (attachedFileId: string, bytes: Uint8Array) => {
      const s0 = slotOf.get(attachedFileId);
      if (!s0) return;
      visualChain = visualChain.then(() => processVisual(s0.slot, s0.order, bytes)).catch(() => {});
    };

    // Attachment text: the shortlisted visual files first (a handful, and the
    // only way the report gets photos — at the end they lost to the time
    // budget), then PDFs (where the facts are), newest first.
    const handled = new Set(priorityJobs.map((j) => j.a.attachedFileId));
    const olderJobs = attachmentJobs.filter((j) => !priorityOf.has(j.docId));
    timings.counts.olderAttachments = olderJobs.length;
    const ordered = olderJobs.slice().sort((x, y) => {
      const vx = shortlistIds.has(x.a.attachedFileId) ? 0 : 1;
      const vy = shortlistIds.has(y.a.attachedFileId) ? 0 : 1;
      const px = x.a.extension === 'pdf' ? 0 : 1;
      const py = y.a.extension === 'pdf' ? 0 : 1;
      return vx - vy || px - py || (y.a.date ?? '').localeCompare(x.a.date ?? '') || idAsc(x.a.attachedFileId, y.a.attachedFileId);
    });

    await pool(ordered, concurrency, async ({ docId, a }) => {
      const rec: AttachmentRecord = {
        attachedFileId: a.attachedFileId, documentId: docId, motionId: a.motionId, fileName: a.fileName, date: a.date,
        format: a.extension, outcome: 'NOT_PROCESSED_BUDGET', pages: null, textChars: 0, sha256: null, cached: false,
      };
      const key = `att:${a.attachedFileId}`;
      const cached = cacheGet(key, now());
      // A file a priority case already downloaded in this run is never fetched twice.
      const wantsBytes = shortlistIds.has(a.attachedFileId) && !handled.has(a.attachedFileId);
      try {
        if (isUnsupportedExtension(a.extension)) {
          // DWG/PLA/RAR …: nothing here reads them; accounted with the official link, not downloaded.
          rec.outcome = 'UNSUPPORTED_FORMAT';
          rec.url = attachmentUrl(a.attachedFileId);
          rec.sizeBytes = a.sizeBytes;
        } else if (cached && !wantsBytes) {
          result.accounting.cacheHits++;
          Object.assign(rec, { outcome: cached.outcome, pages: cached.pages, textChars: cached.text.length, sha256: cached.sha256, format: cached.format ?? rec.format, cached: true });
          if (cached.text) attachmentPiece(docId, a, cached.text);
        } else if (downloads < maxDownloads || wantsBytes) {
          downloads++;
          const r = await timed('attachmentDownloadsMs', () => client.request(attachmentUrl(a.attachedFileId)));
          timings.counts.downloads++;
          timings.counts.downloadBytes += r.bytes.length;
          // The servlet's own Content-Disposition is the authoritative name
          // (and the only reliable type signal for PLA, which has no magic).
          const declared = fileNameFromDisposition(r.disposition);
          if (declared && !rec.fileName) rec.fileName = declared;
          const cls = classifyPayload({ status: r.status, contentType: r.contentType, bytes: r.bytes, fileName: declared ?? a.fileName });
          rec.sha256 = r.bytes.length ? sha256(r.bytes) : null;
          rec.format = cls.format ?? rec.format;
          let text = '';
          if (cls.kind === 'FAILED') rec.outcome = 'DOWNLOAD_FAILED';
          else if (cls.kind === 'EMPTY') rec.outcome = 'EMPTY';
          else if (cls.kind === 'PDF') {
            if (wantsBytes) enqueueVisual(a.attachedFileId, r.bytes);
            const reuse = rec.sha256 ? parsedBySha.get(rec.sha256) : undefined;
            if (reuse) {
              text = reuse.text;
              rec.pages = reuse.pages;
              rec.outcome = reuse.outcome;
            } else {
              try {
                const parsed = await timed('pdfTextMs', () => parsePdf(bytesToBuffer(r.bytes)));
                timings.counts.pdfsParsed++;
                text = repairGeorgianMojibake(parsed.text ?? '');
                rec.pages = parsed.numpages ?? null;
                rec.outcome = classifyPdfText(text, rec.pages);
                if (rec.sha256) parsedBySha.set(rec.sha256, { text, pages: rec.pages, scan: [], outcome: rec.outcome });
              } catch {
                rec.outcome = 'FAILED';
              }
            }
          } else if (cls.kind === 'IMAGE') {
            rec.outcome = 'IMAGE';
            if (wantsBytes) enqueueVisual(a.attachedFileId, r.bytes);
          } else if (cls.kind === 'HTML') {
            text = htmlToText(bytesToBuffer(r.bytes).toString('utf8'));
            rec.outcome = text.length > 40 ? 'READ_TEXT' : 'LOW_TEXT';
          } else rec.outcome = 'UNSUPPORTED_FORMAT'; // ZIP/office/unknown: accounted, never "interpreted"
          rec.textChars = text.length;
          if (rec.outcome !== 'DOWNLOAD_FAILED')
            cachePut(key, { sha256: rec.sha256 ?? '', text, pages: rec.pages, outcome: rec.outcome, format: rec.format, at: now() });
          if (text) attachmentPiece(docId, a, text);
        }
      } catch (e) {
        if (e instanceof TasDeadline) {
          result.deadlineReached = true;
          rec.outcome = 'NOT_PROCESSED_BUDGET';
        } else rec.outcome = 'DOWNLOAD_FAILED';
      }
      recordAttachment(docId, a, rec);
    });

    // ── 6. visuals: wait for the in-flight chain, never past the deadline ──
    const waitMs = Math.max(0, visualDeadline - now());
    let timer: ReturnType<typeof setTimeout> | null = null;
    await Promise.race([visualChain, new Promise<void>((res) => { timer = setTimeout(res, waitMs); (timer as any)?.unref?.(); })]);
    if (timer) clearTimeout(timer);
    timings.olderCasesMs = performance.now() - mark;
    // Room left in the gallery: the newest cases' classified pictures and drawings.
    let extra = 0;
    for (const v of result.priorityVisuals) {
      if (result.visuals.length >= assetMax) break;
      if (v.kind === 'OTHER' || galleryHas(v.id)) continue;
      addToGallery({ ...v, role: 'SUPPORTING' }, 1_000_000 + extra++);
    }
    visualsClosed = true;
    await renderLock.catch(() => {});
    if (renderer) await (renderer as PdfPageRenderer).close().catch(() => {});
    // Gallery order: the shortlist's order (latest render first), then page.
    result.visuals.sort((x, y) => (visualOrder.get(x.id) ?? 0) - (visualOrder.get(y.id) ?? 0));
    result.accounting.visualsExtracted = result.visuals.length;

    // ── 7. assemble cases (date order, never by document id) ──
    const byKindDateId = (x: TextPiece, y: TextPiece) => x.kind - y.kind || (x.date ?? '').localeCompare(y.date ?? '') || idAsc(x.id, y.id);
    for (const row of rows) {
      const detail = details.get(row.documentId);
      if (!detail) continue;
      const rank = priorityOf.get(row.documentId) ?? null;
      const form = rank ? priorityFormByDoc.get(row.documentId) ?? null : null;
      const header = redactPersonalData(caseHeader(detail, row, form?.fields ?? []));
      const pieces = (casePieces.get(row.documentId) ?? []).slice().sort(byKindDateId);
      const full = `${header}\n\n${pieces.map((p) => p.text).join('\n\n')}`.trim();
      let text: string;
      if (rank) text = full; // priority: complete, never sliced
      else {
        // Older case: decisions, conflicts and registered rights first (newest first), then the rest.
        const material = pieces.filter((p) => p.material).sort((x, y) => (y.date ?? '').localeCompare(x.date ?? '') || byKindDateId(x, y));
        const rest = pieces.filter((p) => !p.material);
        text = `${header}\n\n${[...material, ...rest].map((p) => p.text).join('\n\n')}`.trim().slice(0, caseTextBudget);
      }
      result.cases.push({
        detail,
        searchRow: row,
        motions: (motionRecords.get(row.documentId) ?? []).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || idAsc(a.motionId, b.motionId)),
        attachments: (attachmentRecords.get(row.documentId) ?? []).sort((a, b) => Number(a.attachedFileId) - Number(b.attachedFileId)),
        text,
        fullText: full,
        textTruncated: rank ? false : full.length > text.length,
        priority: rank,
        form: form ? { status: form.status, fields: form.fields, method: form.method, ...(form.rawSha256 ? { rawSha256: form.rawSha256 } : {}), reason: form.reason } : null,
        completeness: null,
        rawDetail: rawDetails.get(row.documentId) ?? null,
        rawForm: form?.raw ?? null,
      });
    }
    result.cases.sort((a, b) => (caseDate(a) ?? '').localeCompare(caseDate(b) ?? ''));

    // ── 8. completeness gate per priority case + job-level coverage ──
    const coverageReasons: string[] = [];
    for (const p of picks) {
      const c = result.cases.find((x) => x.detail.documentId === p.documentId) ?? null;
      const form = priorityFormByDoc.get(p.documentId) ?? null;
      const completeness = buildCompleteness({
        detailRead: !!c,
        fieldsDiscovered: (c?.detail.valuesDiscovered ?? 0) + (form?.fieldsDiscovered ?? 0),
        fieldsPersisted: (c?.detail.values.length ?? 0) + (form?.fields.length ?? 0),
        attachments: c?.attachments ?? [],
        motions: c?.motions ?? [],
        formStatus: form?.status ?? null,
        textInlineComplete: true,
        renderAvailable: !!options.renderPdfPages,
      });
      if (c) c.completeness = completeness;
      const row = rows.find((r) => r.documentId === p.documentId)!;
      result.priority.push({
        priority: p.priority,
        documentId: p.documentId,
        registrationNumber: c?.detail.registrationNumber ?? row.registrationNumber,
        date: p.dateMs === null ? null : new Date(p.dateMs).toISOString(),
        parcelMatch: p.parcelMatch,
        detailRead: !!c,
        formStatus: form?.status ?? null,
        completeness,
      });
      for (const r of completeness.reasons) coverageReasons.push(`P${p.priority}:${r}`);
    }
    result.priorityCoverage = coverageReasons.length ? 'PARTIAL' : 'COMPLETE';
    result.priorityCoverageReasons = coverageReasons;
    result.ledger = buildLedger(result, attachmentJobs.length - new Set(attachmentJobs.map((j) => j.a.attachedFileId)).size, pageSize);
  } catch (e) {
    if (e instanceof TasDeadline) result.deadlineReached = true;
    else result.error = String((e as Error)?.message ?? e).slice(0, 300);
    // A run cut short can never claim the newest cases were covered.
    result.priorityCoverage = 'PARTIAL';
    result.priorityCoverageReasons.push(result.error ? 'RUN_ERROR' : result.searchComplete ? 'RUN_DEADLINE' : 'SEARCH_INCOMPLETE');
  }
  result.durationMs = now() - started;
  timings.totalMs = performance.now() - perf0;
  timings.finishedAt = new Date().toISOString();
  timings.counts.httpRequests = client.stats.requests;
  for (const k of ['totalMs', 'searchMs', 'detailMs', 'formDiscoveryMs', 'priorityCasesMs', 'olderCasesMs', 'attachmentDownloadsMs', 'pdfTextMs', 'pageRenderMs', 'visualClassifyMs'] as const)
    timings[k] = Math.round(timings[k]);
  return result;
}

/** Title-block words that pick the most telling sheets of a drawing set. */
const PREFER_PAGE_TEXT: Partial<Record<VisualKind, RegExp>> = {
  FLOOR_PLAN: /(ტიპიურ|typical|სართულის\s*გეგმ|floor\s*plan|план\s*этаж)/i,
  UNIT_PLAN: /(ბინ|apartment|unit|квартир)/i,
  SITE_PLAN: /(გენ\.?\s?გეგმ|გენგეგმ|site\s*plan|სიტუაციურ|генплан)/i,
  SECTION: /(ჭრილ|section|разрез)/i,
  ELEVATION: /(ფასად|elevation|фасад)/i,
  FACADE: /(ფასად|elevation|facade|фасад)/i,
  STRUCTURAL: /(საძირკვ|foundation|კარკას|ფილ|slab|фундамент)/i,
};

function buildLedger(r: TasApiResult, duplicateReferences: number, pageSize: number): ProcessingLedger {
  const o = r.accounting.attachmentOutcomes;
  const rs = r.accounting.responses;
  const reasons: string[] = [];
  if (r.reconciliation && r.reconciliation.reconciled === false) reasons.push('SEARCH_TOTAL_MISMATCH');
  if (r.reconciliation && r.reconciliation.stopReason === 'MAX_PAGES') reasons.push('SEARCH_PAGE_LIMIT');
  // No server total and a full page that then repeated: rows past page one may exist unseen.
  const rec = r.reconciliation;
  if (rec && rec.reconciled === null && rec.stopReason === 'REPEATED_PAGE' && rec.uniqueDocumentIds > 0 && rec.uniqueDocumentIds % pageSize === 0)
    reasons.push('SEARCH_TOTAL_UNKNOWN');
  if (r.accounting.detailFailures) reasons.push('DETAIL_FAILURES');
  if (r.accounting.detailsRead + r.accounting.detailFailures < r.accounting.documents) reasons.push('DETAILS_NOT_READ');
  if (rs.FAILED || rs.NOT_FETCHED) reasons.push('RESPONSES_NOT_READ');
  if (o.NOT_PROCESSED_BUDGET) reasons.push('ATTACHMENTS_DEFERRED_BY_BUDGET');
  if (o.DEFERRED) reasons.push('PRIORITY_ATTACHMENTS_DEFERRED');
  if (o.DOWNLOAD_FAILED || o.FAILED) reasons.push('ATTACHMENTS_FAILED');
  if (r.deadlineReached) reasons.push('RUN_DEADLINE');
  return {
    discovered: { documents: r.accounting.documents, motions: r.accounting.motions, attachments: r.accounting.attachments },
    processed: { details: r.accounting.detailsRead, responses: rs.PDF + rs.HTML + rs.EMPTY + rs.OTHER, attachmentsRead: o.READ_TEXT + o.LOW_TEXT + o.SCAN_OR_IMAGE_ONLY + o.IMAGE, visualsOpened: r.visuals.length },
    deferred: { attachmentsBudget: o.NOT_PROCESSED_BUDGET, attachmentsPriority: o.DEFERRED },
    skipped: { emptyResponses: rs.EMPTY, unsupportedFormats: o.UNSUPPORTED_FORMAT, duplicateReferences },
    failed: { details: r.accounting.detailFailures, responses: rs.FAILED, attachments: o.DOWNLOAD_FAILED + o.FAILED },
    incomplete: reasons.length > 0,
    incompleteReasons: reasons,
  };
}

export function caseDate(c: TasApiCase): string | null {
  return c.detail.submittedAt ?? c.searchRow.date ?? c.detail.lastMotionAt ?? null;
}

function caseHeader(d: TasCaseDetail, row: TasSearchRow, formFields: TasValue[] = []): string {
  const lines: string[] = [];
  lines.push(`TAS case ${d.registrationNumber ?? row.registrationNumber ?? ''}`.trim());
  if (d.title || row.title) lines.push(`Title: ${d.title ?? row.title}`);
  if (d.docType) lines.push(`Type: ${d.docType}`);
  if (d.status || row.status) lines.push(`Status: ${d.status ?? row.status}`);
  if (d.submittedAt ?? row.date) lines.push(`Registered: ${(d.submittedAt ?? row.date)!.slice(0, 10)}`);
  if (d.address ?? row.address) lines.push(`Address: ${d.address ?? row.address}`);
  if (d.description) lines.push(`Description: ${d.description}`);
  if (d.responseText) lines.push(`Response: ${d.responseText}`);
  for (const p of d.parties) lines.push(`${p.role}: ${p.name}${p.organizationId ? ` (${p.organizationId})` : ''}`);
  for (const v of d.values) lines.push(`${v.label ?? v.key}: ${v.value}`);
  if (formFields.length) {
    lines.push('Application form:');
    for (const v of formFields) lines.push(`${v.label ?? v.key}: ${v.value}`);
  }
  return lines.join('\n');
}

// ───────────────────────── LegacySourceResult adapter ─────────────────────────

/**
 * The SAME wire shape research-agent already consumes for `source: 'tas'`,
 * plus `tasApi` (structured, text-free) for the intelligence layer. One
 * document per case keeps result_json bounded. The two priority cases carry
 * their complete text inline (≤ PRIORITY_INLINE_TEXT_MAX across both; beyond
 * that the queue path keeps a content-addressed ref); older cases are
 * ordered and capped, never silently empty.
 */
export function toLegacyTasResult(r: TasApiResult, opts: { includeFullText?: boolean } = {}): LegacySourceResult & { tasApi: Omit<TasApiResult, 'cases'> & { cases: any[] } } {
  const sendText = new Map<TasApiCase, string>();
  let priorityLeft = PRIORITY_INLINE_TEXT_MAX;
  for (const c of r.cases.filter((x) => x.priority).sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9))) {
    const t = c.text.slice(0, Math.max(0, priorityLeft));
    priorityLeft -= t.length;
    sendText.set(c, t);
  }
  // Older cases: newest keep their text first; the total stays bounded.
  let remaining = TAS_TOTAL_TEXT_BUDGET;
  for (const c of r.cases.filter((x) => !x.priority).sort((a, b) => (caseDate(b) ?? '').localeCompare(caseDate(a) ?? ''))) {
    const t = c.text.slice(0, Math.max(0, remaining));
    remaining -= t.length;
    sendText.set(c, t);
  }
  const docs = r.cases.map((c) => {
    const date = caseDate(c);
    const text = sendText.get(c) ?? '';
    const full = c.fullText ?? c.text;
    return {
      id: `tas_${c.detail.documentId}`,
      source: 'tas',
      parentItemId: null,
      title: c.detail.title ?? c.searchRow.title ?? `TAS ${c.detail.registrationNumber ?? c.detail.documentId}`,
      documentType: 'ONLINE_DOCUMENT',
      documentDate: date,
      url: publicDocumentUrl(c.detail.documentId),
      pageCount: null,
      pagesRead: 0,
      complete: text.trim().length > 20,
      rawText: text,
      sha256: createHash('sha256').update(text).digest('hex'),
      extractedEvidenceIds: [],
      discoveredEntityIds: [],
      tasDocumentId: c.detail.documentId,
      textTruncated: c.textTruncated || text.length < c.text.length,
      ...(c.priority
        ? {
            priority: c.priority,
            // Inline text IS the complete case text unless the inline cap cut it (then the queue path keeps a ref).
            textComplete: text.length >= full.length,
            textSha256: sha256Text(full),
            textChars: full.length,
          }
        : {}),
      // Queue path only: the complete text, stored as evidence by the worker
      // and stripped before anything is sent on.
      ...(opts.includeFullText && c.fullText ? { fullText: c.fullText } : {}),
    };
  });
  const found = r.accounting.documents;
  // Search cut short, or cases found but none could be assembled → FAILED, so
  // the LEGACY fallback runs; never a false "no TAS history".
  const ok = !r.error && !!r.searchCadastralCode && r.searchComplete && !(found > 0 && r.cases.length === 0);
  const status = !ok ? 'FAILED' : found === 0 ? 'NO_RESULT_CONFIRMED' : 'SEARCH_CONFIRMED';
  const exhausted = ok && !r.deadlineReached && r.accounting.detailFailures === 0;
  const workflowResult: WorkflowResult = {
    source: 'tas',
    state: !ok ? 'FAILED' : exhausted ? 'TAS_EXHAUSTED' : 'TAS_PARTIAL',
    completed: exhausted,
    skipped: false,
    discoveredItems: found,
    visitedItems: r.accounting.detailsRead,
    discoveredDocuments: docs.length,
    readDocuments: docs.filter((d) => d.complete).length,
    unvisitedRelevantItems: found - r.accounting.detailsRead,
    evidenceIds: [],
    trace: [],
  };
  // Structured block without raw text — text already travels in documents.
  const structuredCases = r.cases.map((c) => ({
    documentId: c.detail.documentId,
    registrationNumber: c.detail.registrationNumber ?? c.searchRow.registrationNumber,
    title: c.detail.title ?? c.searchRow.title,
    docType: c.detail.docType,
    status: c.detail.status ?? c.searchRow.status,
    statusId: c.searchRow.statusId,
    date: caseDate(c),
    lastMotionAt: c.detail.lastMotionAt,
    address: c.detail.address ?? c.searchRow.address,
    cadastralCodes: c.detail.cadastralCodes,
    description: c.detail.description,
    parties: c.detail.parties,
    values: c.detail.values,
    // Source fields not yet mapped: names only (contract discovery), never their values — they may carry personal data.
    unmappedKeys: Object.keys(c.detail.unmapped ?? {}).slice(0, 80),
    motions: c.motions,
    attachments: c.attachments,
    technicalFacts: dedupeTasTechnicalFacts(extractTasTechnicalFacts(c.fullText ?? c.text)),
    textTruncated: c.textTruncated,
    priority: c.priority ?? null,
    form: c.form ?? null,
    completeness: c.completeness ?? null,
    rawDetailSha256: c.rawDetail?.sha256 ?? null,
  }));
  const { cases: _cases, ...rest } = r;
  return {
    source: 'tas',
    sourceName: 'TAS',
    sourceClass: 'OFFICIAL_GOVERNMENT',
    sourceUrl: TAS_PUBLIC.shellUrl,
    startUrl: TAS_PUBLIC.shellUrl,
    finalUrl: TAS_PUBLIC.shellUrl,
    frameUrls: [],
    adapter: 'tas-public-dwr',
    retrievalMethod: 'PUBLIC_API',
    searchControlUsed: 'naprCadCode',
    queryEntered: r.searchCadastralCode,
    submitAction: 'DWR getDocsForPublicInfo',
    searched: ok,
    resultContext: `TAS API_FIRST: ${found} case(s), ${r.accounting.motions} motion(s), ${r.accounting.attachments} attachment(s) accounted; the ${r.priority.length} newest case(s) read in full (coverage ${r.priorityCoverage}); newest evidence is authoritative for current state, older records remain historical context`,
    resultConfirmed: status === 'SEARCH_CONFIRMED',
    noResultConfirmed: status === 'NO_RESULT_CONFIRMED',
    resultValidated: status !== 'FAILED',
    status,
    traversal: { implementation: TAS_API_IMPLEMENTATION, reconciliation: r.reconciliation, accounting: r.accounting },
    retrievedAt: new Date().toISOString(),
    documents: docs,
    discoveredEntities: [],
    originalCadastralCode: isCadastralCode(r.requestedCadastralCode) ? r.requestedCadastralCode : null,
    resolvedSearchCadastralCode: r.searchCadastralCode,
    cadastralFallbackAttempts: r.attempts,
    error: r.error,
    workflowResult,
    tasApi: { ...rest, cases: structuredCases },
  };
}

/** Sanitized raw replies of a run, for content-addressed evidence storage (queue path). */
export function tasEvidenceObjects(r: TasApiResult): Array<{ sha256: string; json: string; documentId: string; kind: 'detail' | 'form' }> {
  const out: Array<{ sha256: string; json: string; documentId: string; kind: 'detail' | 'form' }> = [];
  for (const c of r.cases) {
    if (c.rawDetail) out.push({ ...c.rawDetail, documentId: c.detail.documentId, kind: 'detail' });
    if (c.rawForm) out.push({ ...c.rawForm, documentId: c.detail.documentId, kind: 'form' });
  }
  return out;
}
