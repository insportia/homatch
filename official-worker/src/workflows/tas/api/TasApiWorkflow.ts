// TasApiWorkflow.ts — TAS "API_FIRST": the public DWR application, read as
// data, exhaustively. The browser workflow (TasWorkflow.ts) remains the
// LEGACY implementation and the automatic fallback.
//
//   cadastral → TAS base parcel (candidateSequence, never hardcoded)
//     → getDocsForPublicInfo, every page, reconciled against unique doc ids
//     → getUserDocumentLastMotion per case (full object graph)
//     → every motion's official response (PDF / HTML / EMPTY, detected)
//     → every attachment accounted for; supported PDFs read in memory
//     → selective official visuals (metadata ranking first)
//     → LegacySourceResult (unchanged wire shape) + `tasApi` structure
//
// No source binary is stored permanently: PDFs are parsed in memory and
// dropped; only text, hashes, classifications and a bounded set of chosen
// visuals (≤ VISUAL_ASSET_MAX, kept in a byte-bounded in-process cache until
// they are stored by content hash) remain.

import { bytesToBuffer } from './tasModel.js';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { candidateSequence, isCadastralCode } from '../cadastral.js';
import { TasApiClient, TasDeadline, TAS_PUBLIC, TAS_PAGE_SIZE, attachmentUrl, publicDocumentUrl, responseUrl } from './TasApiClient.js';
import {
  classifyPayload, classifyPdfText, fileNameFromDisposition, htmlToText, mergeSearchPages, normalizeCaseDetail, parseSearchPage, repairGeorgianMojibake,
  type PdfTextClass, type SearchReconciliation, type TasCaseDetail, type TasSearchPage, type TasSearchRow,
} from './tasModel.js';
import { extractDecision, type ExtractedDecision } from './decisions.js';
import { assetsPerFile, extractImagesFromPdf, imageSize, rankVisualCandidates, selectVisualShortlist, VISUAL_ASSET_MAX, VISUAL_FILE_MAX, type VisualKind, type VisualSlot } from './visuals.js';
import { DRAWING_KINDS, identityHints, readExif, refineWithImage, type IdentityHints, type VisualCategory } from './visualClassify.js';
import type { PdfPageRenderer, PdfRendererFactory } from './pdfRender.js';
import { extractTasTechnicalFacts, dedupeTasTechnicalFacts } from '../../../documents/TasTechnicalFacts.js';
import type { LegacySourceResult, WorkflowResult } from '../../WorkflowResult.js';

export const TAS_API_IMPLEMENTATION = 'API_FIRST';
export const TAS_API_VERSION = 'tas-api-1';

/** All TAS case text sent on to research-agent, across cases. */
export const TAS_TOTAL_TEXT_BUDGET = 120_000;

type PdfParser = (bytes: Buffer) => Promise<{ text: string; numpages: number; info?: any }>;
const defaultPdfParser: PdfParser = (bytes) => createRequire(import.meta.url)('pdf-parse/lib/pdf-parse.js')(bytes);

export interface TasApiOptions {
  fetcher?: typeof fetch;
  parsePdf?: PdfParser;
  budgetMs?: number;
  pageSize?: number;
  maxPages?: number;
  concurrency?: number;
  minGapMs?: number;
  /** Upper bound on attachment downloads per run; the rest are ACCOUNTED, not hidden. */
  maxAttachmentDownloads?: number;
  /** Per-case text kept for downstream intelligence (chars). */
  caseTextBudget?: number;
  /** Files opened for visuals (≤ VISUAL_FILE_MAX). */
  visualTarget?: number;
  /** Assets kept per run (≤ VISUAL_ASSET_MAX). */
  visualMax?: number;
  /** Total image bytes kept per run. */
  visualBytesMax?: number;
  /** Wall-clock spent on visual extraction/rendering per run. */
  visualBudgetMs?: number;
  /** Vector drawing page renderer (pdfRender.ts). Absent = no page rendering. */
  renderPdfPages?: PdfRendererFactory;
  /** Long edge of rendered drawing pages, px. */
  renderLongEdge?: number;
  signal?: AbortSignal;
  now?: () => number;
}

export type AttachmentOutcome =
  | PdfTextClass
  | 'IMAGE'
  | 'UNSUPPORTED_FORMAT'
  | 'EMPTY'
  | 'DOWNLOAD_FAILED'
  | 'NOT_PROCESSED_BUDGET';

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
  deferred: { attachmentsBudget: number };
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
  /** Queue path: set once the worker stored the bytes at storagePath. */
  stored?: boolean;
}

export interface TasApiCase {
  detail: TasCaseDetail;
  searchRow: TasSearchRow;
  motions: MotionRecord[];
  attachments: AttachmentRecord[];
  /** Bounded, source-ordered text of the case (structured fields first). */
  text: string;
  /** The complete case text (every response and attachment read). Facts are
   *  extracted from it in the worker; the queue path stores it as evidence.
   *  Never sent in the legacy polling payload. */
  fullText?: string;
  textTruncated: boolean;
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

interface CachedText { sha256: string; text: string; pages: number | null; outcome: AttachmentOutcome; format: string | null; at: number }
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
const VISUAL_CACHE_MAX = 120;
const VISUAL_CACHE_BYTES_MAX = 320 * 1024 * 1024;
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

export async function acquireTasApi(query: string, options: TasApiOptions = {}): Promise<TasApiResult> {
  const now = options.now ?? Date.now;
  const started = now();
  const budget = options.budgetMs ?? 9 * 60 * 1000;
  const client = new TasApiClient({
    fetcher: options.fetcher,
    deadlineAt: started + budget,
    concurrency: options.concurrency ?? 3,
    minGapMs: options.minGapMs ?? 250,
    signal: options.signal,
  });
  const parsePdf = options.parsePdf ?? defaultPdfParser;
  const pageSize = options.pageSize ?? TAS_PAGE_SIZE;
  const maxPages = options.maxPages ?? 60;
  // Text sent to research-agent per case. The edge function has a 2 s CPU
  // budget: 40k per case × dozens of cases (Villion, 2026-10-10) made every
  // poll exceed it ("CPU Time exceeded", 546). Facts are still read from up
  // to FACT_TEXT_BUDGET here in the worker.
  const caseTextBudget = options.caseTextBudget ?? 8_000;
  const maxDownloads = options.maxAttachmentDownloads ?? 500;

  const outcomes = (): Record<AttachmentOutcome, number> => ({
    READ_TEXT: 0, LOW_TEXT: 0, SCAN_OR_IMAGE_ONLY: 0, FAILED: 0, IMAGE: 0, UNSUPPORTED_FORMAT: 0, EMPTY: 0, DOWNLOAD_FAILED: 0, NOT_PROCESSED_BUDGET: 0,
  });
  const result: TasApiResult = {
    implementation: TAS_API_IMPLEMENTATION,
    version: TAS_API_VERSION,
    requestedCadastralCode: query,
    searchCadastralCode: null,
    attempts: [],
    reconciliation: null,
    cases: [],
    visuals: [],
    accounting: {
      documents: 0, detailsRead: 0, detailFailures: 0, motions: 0,
      responses: { PDF: 0, HTML: 0, EMPTY: 0, OTHER: 0, FAILED: 0, NOT_FETCHED: 0 },
      attachments: 0, caseLevelAttachments: 0, attachmentOutcomes: outcomes(), pdfAttachments: 0, nonPdfAttachments: 0,
      cacheHits: 0, visualCandidates: 0, visualsExtracted: 0, visualFilesOpened: 0, pagesRendered: 0, renderFailures: 0, visualsSkippedBudget: 0,
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
    const candidates = isCadastralCode(query) ? candidateSequence(query) : [query];
    let rows: TasSearchRow[] = [];
    for (const code of candidates) {
      const pages: TasSearchPage[] = [];
      let stop: SearchReconciliation['stopReason'] = 'MAX_PAGES';
      let total: number | null = null;
      const fingerprints = new Set<string>();
      for (let p = 0; p < maxPages; p++) {
        const page = parseSearchPage((await client.search(code, p * pageSize, pageSize)).data);
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

    // ── 2. case detail graphs ──
    const details = new Map<string, TasCaseDetail>();
    await pool(rows, options.concurrency ?? 3, async (row) => {
      try {
        const r = await client.detail(row.documentId);
        details.set(row.documentId, normalizeCaseDetail(row.documentId, r.data, r.objectCount));
        result.accounting.detailsRead++;
      } catch (e) {
        // A deadline leaves the remaining details unread (DETAILS_NOT_READ);
        // what was read is still assembled and accounted.
        if (e instanceof TasDeadline) result.deadlineReached = true;
        else result.accounting.detailFailures++;
      }
    });

    // ── 3. motions → official responses; attachments → accounting + text ──
    const caseText = new Map<string, string[]>();
    const pushText = (docId: string, s: string) => {
      const arr = caseText.get(docId) ?? [];
      arr.push(s);
      caseText.set(docId, arr);
    };
    const motionRecords = new Map<string, MotionRecord[]>();
    const attachmentRecords = new Map<string, AttachmentRecord[]>();

    const motionJobs: Array<{ docId: string; m: TasCaseDetail['motions'][number] }> = [];
    const attachmentJobs: Array<{ docId: string; a: TasCaseDetail['attachments'][number] }> = [];
    for (const row of rows) {
      const d = details.get(row.documentId);
      if (!d) continue;
      for (const m of d.motions) motionJobs.push({ docId: row.documentId, m });
      for (const a of d.attachments) attachmentJobs.push({ docId: row.documentId, a });
    }
    result.accounting.motions = motionJobs.length;
    result.accounting.attachments = attachmentJobs.length;
    result.accounting.caseLevelAttachments = attachmentJobs.filter((j) => j.a.motionId === null).length;

    await pool(motionJobs, options.concurrency ?? 3, async ({ docId, m }) => {
      const rec: MotionRecord = { documentId: docId, motionId: m.motionId, date: m.date, name: m.name, status: m.status, decisionNumber: m.decisionNumber, response: 'NOT_FETCHED', textChars: 0, sha256: null, decision: null };
      const key = `resp:${docId}:${m.motionId}`;
      const cached = cacheGet(key, now());
      try {
        if (cached) {
          result.accounting.cacheHits++;
          rec.response = cached.outcome === 'EMPTY' ? 'EMPTY' : cached.format === 'pdf' ? 'PDF' : cached.format === 'html' ? 'HTML' : 'OTHER';
          rec.sha256 = cached.sha256;
          rec.textChars = cached.text.length;
          rec.decision = cached.text ? extractDecision(cached.text) : null;
          if (rec.decision && !rec.decisionNumber && rec.decision.number) rec.decisionNumber = rec.decision.number;
          if (cached.text) pushText(docId, `[${m.date?.slice(0, 10) ?? 'undated'} · ${m.name ?? 'motion'} · response]\n${cached.text}`);
        } else {
          const r = await client.request(responseUrl(docId, m.motionId));
          const cls = classifyPayload({ status: r.status, contentType: r.contentType, bytes: r.bytes });
          rec.sha256 = r.bytes.length ? sha256(r.bytes) : null;
          let text = '';
          let pages: number | null = null;
          if (cls.kind === 'PDF') {
            rec.response = 'PDF';
            try {
              const parsed = await parsePdf(bytesToBuffer(r.bytes));
              text = repairGeorgianMojibake(parsed.text ?? '');
              pages = parsed.numpages ?? null;
            } catch { /* response exists but has no readable text layer */ }
          } else if (cls.kind === 'HTML') {
            rec.response = 'HTML';
            text = htmlToText(bytesToBuffer(r.bytes).toString('utf8'));
          } else if (cls.kind === 'EMPTY') rec.response = 'EMPTY';
          else if (cls.kind === 'FAILED') rec.response = 'FAILED';
          else rec.response = 'OTHER';
          rec.textChars = text.length;
          rec.decision = text ? extractDecision(text) : null;
          if (rec.decision && !rec.decisionNumber && rec.decision.number) rec.decisionNumber = rec.decision.number;
          // An EMPTY answer is not cached: a decision uploaded later must be seen on the next run.
          if (rec.response !== 'FAILED' && rec.response !== 'EMPTY')
            cachePut(key, { sha256: rec.sha256 ?? '', text, pages, outcome: 'READ_TEXT', format: cls.format ?? cls.kind.toLowerCase(), at: now() });
          if (text) pushText(docId, `[${m.date?.slice(0, 10) ?? 'undated'} · ${m.name ?? 'motion'} · response]\n${text}`);
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
    });

    let downloads = 0;
    // Case context for visual classification and identity (title, type,
    // description, the motion an attachment belongs to). Bounded.
    const motionNames = new Map<string, string>();
    for (const { m } of motionJobs) if (m.name) motionNames.set(m.motionId, m.name);
    const caseContext = (docId: string, motionId: string | null): string => {
      const d = details.get(docId);
      return [d?.title, d?.docType, d?.description, motionId ? motionNames.get(motionId) : null].filter(Boolean).join(' · ').slice(0, 600);
    };
    const ranked = rankVisualCandidates(
      attachmentJobs.map((j) => ({ ...j.a, documentId: j.docId, context: caseContext(j.docId, j.a.motionId), caseCadastralCodes: details.get(j.docId)?.cadastralCodes ?? [] })),
      { parcel: result.searchCadastralCode },
    );
    result.accounting.visualCandidates = ranked.length;
    const shortlist = selectVisualShortlist(ranked, options.visualTarget ?? VISUAL_FILE_MAX, VISUAL_FILE_MAX);
    const shortlistIds = new Set(shortlist.map((s) => s.candidate.attachedFileId));
    const slotOf = new Map(shortlist.map((sl, i) => [sl.candidate.attachedFileId, { slot: sl, order: i }]));

    // ── visuals, processed AS THE SHORTLISTED FILES ARRIVE (they download
    // first), one at a time, concurrently with the remaining downloads — so
    // page rendering never waits for, or starves, the text budget. Bounded
    // by assets, bytes and wall-clock, and never past the run deadline. ──
    const assetMax = Math.min(Math.max(1, options.visualMax ?? VISUAL_ASSET_MAX), VISUAL_ASSET_MAX);
    const bytesMax = options.visualBytesMax ?? 96 * 1024 * 1024;
    const visualDeadline = Math.min(started + budget - 5_000, started + budget);
    const visualBudgetMs = options.visualBudgetMs ?? 180_000;
    let visualFirstAt: number | null = null;
    let visualBytes = 0;
    let visualsClosed = false;
    let renderer: PdfPageRenderer | null = null;
    const visualOrder = new Map<string, number>();
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
      type Out = { bytes: Uint8Array; width: number | null; height: number | null; extraction: VisualRecord['extraction']; page: number | null; pageText: string | null };
      let outs: Out[] = [];
      const isPdf = bytesToBuffer(bytes.subarray(0, 4)).toString('latin1') === '%PDF';
      const embedded = (): Out[] =>
        extractImagesFromPdf(bytes, { maxImages: per.images }).map((i) => ({ bytes: i.bytes, width: i.width, height: i.height, extraction: 'PDF_EMBEDDED_IMAGE' as const, page: null, pageText: null }));
      const render = async (): Promise<Out[]> => {
        if (!options.renderPdfPages || per.pages < 1) return [];
        const left = visualDeadline - now();
        if (left < 8_000) return [];
        try {
          renderer ??= options.renderPdfPages();
          const r = await renderer.render(bytes, {
            maxPages: Math.min(per.pages, assetMax - result.visuals.length),
            longEdge: options.renderLongEdge ?? 2200,
            maxBytes: 8 * 1024 * 1024,
            preferText: PREFER_PAGE_TEXT[c.kind] ?? null,
            timeoutMs: Math.min(45_000, left - 3_000),
          });
          result.accounting.pagesRendered = (result.accounting.pagesRendered ?? 0) + r.pages.length;
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
      const context = caseContext(c.documentId, c.motionId);
      let firstOfSlot = true;
      for (const o of outs) {
        if (visualsClosed || result.visuals.length >= assetMax) break;
        if (!o.bytes.length || o.bytes.length > 8 * 1024 * 1024 || visualBytes + o.bytes.length > bytesMax) continue;
        const size = imageSize(o.bytes);
        if (!size) continue;
        if (size.width < 400 || size.height < 250) continue;
        const id = sha256(o.bytes);
        if (result.visuals.some((v) => v.id === id)) continue;
        const cls = refineWithImage(
          { kind: c.kind, category: c.category, confidence: c.confidence, basis: c.basis },
          { exif: size.mime === 'image/jpeg' ? readExif(o.bytes) : null, extraction: o.extraction, pageText: o.pageText, context },
        );
        putVisual(id, o.bytes, size.mime);
        visualBytes += o.bytes.length;
        visualOrder.set(id, order * 100 + (o.page ?? 0));
        result.visuals.push({
          id,
          // Only the slot's first render carries LATEST/EARLIEST.
          role: firstOfSlot && cls.kind === 'RENDER' ? slot.role : 'SUPPORTING',
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
        });
        firstOfSlot = false;
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
    const ordered = attachmentJobs.slice().sort((x, y) => {
      const vx = shortlistIds.has(x.a.attachedFileId) ? 0 : 1;
      const vy = shortlistIds.has(y.a.attachedFileId) ? 0 : 1;
      const px = x.a.extension === 'pdf' ? 0 : 1;
      const py = y.a.extension === 'pdf' ? 0 : 1;
      return vx - vy || px - py || (y.a.date ?? '').localeCompare(x.a.date ?? '');
    });

    await pool(ordered, options.concurrency ?? 3, async ({ docId, a }) => {
      const rec: AttachmentRecord = {
        attachedFileId: a.attachedFileId, documentId: docId, motionId: a.motionId, fileName: a.fileName, date: a.date,
        format: a.extension, outcome: 'NOT_PROCESSED_BUDGET', pages: null, textChars: 0, sha256: null, cached: false,
      };
      const key = `att:${a.attachedFileId}`;
      const cached = cacheGet(key, now());
      const wantsBytes = shortlistIds.has(a.attachedFileId);
      try {
        if (cached && !wantsBytes) {
          result.accounting.cacheHits++;
          Object.assign(rec, { outcome: cached.outcome, pages: cached.pages, textChars: cached.text.length, sha256: cached.sha256, format: cached.format ?? rec.format, cached: true });
          if (cached.text) pushText(docId, `[${a.date?.slice(0, 10) ?? 'undated'} · ${a.fileName ?? 'attachment'}]\n${cached.text}`);
        } else if (downloads < maxDownloads || wantsBytes) {
          downloads++;
          const r = await client.request(attachmentUrl(a.attachedFileId));
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
            try {
              const parsed = await parsePdf(bytesToBuffer(r.bytes));
              text = repairGeorgianMojibake(parsed.text ?? '');
              rec.pages = parsed.numpages ?? null;
              rec.outcome = classifyPdfText(text, rec.pages);
            } catch {
              rec.outcome = 'FAILED';
            }
          } else if (cls.kind === 'IMAGE') {
            rec.outcome = 'IMAGE';
            if (wantsBytes) enqueueVisual(a.attachedFileId, r.bytes);
          } else if (cls.kind === 'HTML') {
            text = htmlToText(bytesToBuffer(r.bytes).toString('utf8'));
            rec.outcome = text.length > 40 ? 'READ_TEXT' : 'LOW_TEXT';
          } else rec.outcome = 'UNSUPPORTED_FORMAT'; // DWG/PLA/RAR/ZIP/office: accounted, never "interpreted"
          rec.textChars = text.length;
          if (rec.outcome !== 'DOWNLOAD_FAILED')
            cachePut(key, { sha256: rec.sha256 ?? '', text, pages: rec.pages, outcome: rec.outcome, format: rec.format, at: now() });
          if (text) pushText(docId, `[${a.date?.slice(0, 10) ?? 'undated'} · ${a.fileName ?? 'attachment'}]\n${text}`);
        }
      } catch (e) {
        if (e instanceof TasDeadline) {
          result.deadlineReached = true;
          rec.outcome = 'NOT_PROCESSED_BUDGET';
        } else rec.outcome = 'DOWNLOAD_FAILED';
      }
      if ((rec.format ?? a.extension) === 'pdf') result.accounting.pdfAttachments++;
      else result.accounting.nonPdfAttachments++;
      result.accounting.attachmentOutcomes[rec.outcome]++;
      const list = attachmentRecords.get(docId) ?? [];
      list.push(rec);
      attachmentRecords.set(docId, list);
    });

    // ── 4. visuals: wait for the in-flight chain, never past the deadline ──
    const waitMs = Math.max(0, visualDeadline - now());
    let timer: ReturnType<typeof setTimeout> | null = null;
    await Promise.race([visualChain, new Promise<void>((res) => { timer = setTimeout(res, waitMs); (timer as any)?.unref?.(); })]);
    if (timer) clearTimeout(timer);
    visualsClosed = true;
    if (renderer) await (renderer as PdfPageRenderer).close().catch(() => {});
    // Gallery order: the shortlist's order (latest render first), then page.
    result.visuals.sort((x, y) => (visualOrder.get(x.id) ?? 0) - (visualOrder.get(y.id) ?? 0));
    result.accounting.visualsExtracted = result.visuals.length;

    // ── 5. assemble cases (date order, never by document id) ──
    for (const row of rows) {
      const detail = details.get(row.documentId);
      if (!detail) continue;
      const header = caseHeader(detail, row);
      const body = (caseText.get(row.documentId) ?? []).join('\n\n');
      const full = `${header}\n\n${body}`.trim();
      result.cases.push({
        detail,
        searchRow: row,
        motions: (motionRecords.get(row.documentId) ?? []).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')),
        attachments: (attachmentRecords.get(row.documentId) ?? []).sort((a, b) => Number(a.attachedFileId) - Number(b.attachedFileId)),
        text: full.slice(0, caseTextBudget),
        fullText: full,
        textTruncated: full.length > caseTextBudget,
      });
    }
    result.cases.sort((a, b) => (caseDate(a) ?? '').localeCompare(caseDate(b) ?? ''));
    result.ledger = buildLedger(result, attachmentJobs.length - new Set(attachmentJobs.map((j) => j.a.attachedFileId)).size, pageSize);
  } catch (e) {
    if (e instanceof TasDeadline) result.deadlineReached = true;
    else result.error = String((e as Error)?.message ?? e).slice(0, 300);
  }
  result.durationMs = now() - started;
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
  if (o.DOWNLOAD_FAILED || o.FAILED) reasons.push('ATTACHMENTS_FAILED');
  if (r.deadlineReached) reasons.push('RUN_DEADLINE');
  return {
    discovered: { documents: r.accounting.documents, motions: r.accounting.motions, attachments: r.accounting.attachments },
    processed: { details: r.accounting.detailsRead, responses: rs.PDF + rs.HTML + rs.EMPTY + rs.OTHER, attachmentsRead: o.READ_TEXT + o.LOW_TEXT + o.SCAN_OR_IMAGE_ONLY + o.IMAGE, visualsOpened: r.visuals.length },
    deferred: { attachmentsBudget: o.NOT_PROCESSED_BUDGET },
    skipped: { emptyResponses: rs.EMPTY, unsupportedFormats: o.UNSUPPORTED_FORMAT, duplicateReferences },
    failed: { details: r.accounting.detailFailures, responses: rs.FAILED, attachments: o.DOWNLOAD_FAILED + o.FAILED },
    incomplete: reasons.length > 0,
    incompleteReasons: reasons,
  };
}

export function caseDate(c: TasApiCase): string | null {
  return c.detail.submittedAt ?? c.searchRow.date ?? c.detail.lastMotionAt ?? null;
}

function caseHeader(d: TasCaseDetail, row: TasSearchRow): string {
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
  return lines.join('\n');
}

// ───────────────────────── LegacySourceResult adapter ─────────────────────────

/**
 * The SAME wire shape research-agent already consumes for `source: 'tas'`,
 * plus `tasApi` (structured, text-free) for the intelligence layer. One
 * document per case keeps result_json bounded; per-case text is ordered and
 * capped, never silently empty.
 */
export function toLegacyTasResult(r: TasApiResult, opts: { includeFullText?: boolean } = {}): LegacySourceResult & { tasApi: Omit<TasApiResult, 'cases'> & { cases: any[] } } {
  // Newest cases keep their text first; the total stays bounded.
  let remaining = TAS_TOTAL_TEXT_BUDGET;
  const sendText = new Map<any, string>();
  for (const c of [...r.cases].sort((a, b) => (caseDate(b) ?? '').localeCompare(caseDate(a) ?? ''))) {
    const t = c.text.slice(0, Math.max(0, remaining));
    remaining -= t.length;
    sendText.set(c, t);
  }
  const docs = r.cases.map((c) => {
    const date = caseDate(c);
    const text = sendText.get(c) ?? '';
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
    resultContext: `TAS API_FIRST: ${found} case(s), ${r.accounting.motions} motion(s), ${r.accounting.attachments} attachment(s) accounted; newest evidence is authoritative for current state, older records remain historical context`,
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
