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
// dropped; only text, hashes, classifications and ≤ 6 chosen visuals (kept
// in a bounded in-process cache until research-agent collects them) remain.

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
import { extractImagesFromPdf, imageSize, rankVisualCandidates, selectVisualShortlist, type VisualKind } from './visuals.js';
import { extractTasTechnicalFacts, dedupeTasTechnicalFacts } from '../../../documents/TasTechnicalFacts.js';
import type { LegacySourceResult, WorkflowResult } from '../../WorkflowResult.js';

export const TAS_API_IMPLEMENTATION = 'API_FIRST';
export const TAS_API_VERSION = 'tas-api-1';

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
  visualTarget?: number;
  visualMax?: number;
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

export interface VisualRecord {
  id: string; // sha256 of the image bytes
  role: 'LATEST_RENDER' | 'EARLIEST_RENDER' | 'SUPPORTING';
  kind: VisualKind;
  documentId: string;
  attachedFileId: string;
  motionId: string | null;
  date: string | null;
  fileName: string | null;
  mime: string;
  width: number | null;
  height: number | null;
  bytes: number;
  extraction: 'NATIVE_IMAGE' | 'PDF_EMBEDDED_IMAGE';
}

export interface TasApiCase {
  detail: TasCaseDetail;
  searchRow: TasSearchRow;
  motions: MotionRecord[];
  attachments: AttachmentRecord[];
  /** Bounded, source-ordered text of the case (structured fields first). */
  text: string;
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

/** Chosen visuals, held until research-agent collects them (by sha256). */
const VISUAL_CACHE = new Map<string, { bytes: Uint8Array; mime: string; at: number }>();
const VISUAL_CACHE_MAX = 120;
export function getCachedVisual(sha: string): { bytes: Uint8Array; mime: string } | null {
  const v = VISUAL_CACHE.get(sha);
  return v ? { bytes: v.bytes, mime: v.mime } : null;
}
function putVisual(sha: string, bytes: Uint8Array, mime: string): void {
  VISUAL_CACHE.set(sha, { bytes, mime, at: Date.now() });
  while (VISUAL_CACHE.size > VISUAL_CACHE_MAX) VISUAL_CACHE.delete(VISUAL_CACHE.keys().next().value as string);
}
/** Test hook only. */
export function __resetTasApiCaches(): void {
  TEXT_CACHE.clear();
  VISUAL_CACHE.clear();
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
  const caseTextBudget = options.caseTextBudget ?? 40_000;
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
      cacheHits: 0, visualCandidates: 0, visualsExtracted: 0,
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

    // Attachment text: PDFs first (where the facts are), newest first.
    const ordered = attachmentJobs.slice().sort((x, y) => {
      const px = x.a.extension === 'pdf' ? 0 : 1;
      const py = y.a.extension === 'pdf' ? 0 : 1;
      return px - py || (y.a.date ?? '').localeCompare(x.a.date ?? '');
    });
    let downloads = 0;
    const pdfBytesForVisuals = new Map<string, Uint8Array>();
    const ranked = rankVisualCandidates(attachmentJobs.map((j) => ({ ...j.a, documentId: j.docId })));
    result.accounting.visualCandidates = ranked.length;
    const shortlist = selectVisualShortlist(ranked, options.visualTarget ?? 4, options.visualMax ?? 6);
    const shortlistIds = new Set(shortlist.map((s) => s.candidate.attachedFileId));

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
            if (wantsBytes) pdfBytesForVisuals.set(a.attachedFileId, r.bytes);
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
            if (wantsBytes) pdfBytesForVisuals.set(a.attachedFileId, r.bytes);
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

    // ── 4. visuals: only the shortlist is opened ──
    for (const slot of shortlist) {
      const bytes = pdfBytesForVisuals.get(slot.candidate.attachedFileId);
      if (!bytes) continue;
      let image: Uint8Array | null = null;
      let extraction: VisualRecord['extraction'] = 'NATIVE_IMAGE';
      let width: number | null = null;
      let height: number | null = null;
      if (bytesToBuffer(bytes.subarray(0, 4)).toString('latin1') === '%PDF') {
        const imgs = extractImagesFromPdf(bytes, { maxImages: 6 });
        if (imgs.length) {
          image = imgs[0].bytes;
          width = imgs[0].width;
          height = imgs[0].height;
          extraction = 'PDF_EMBEDDED_IMAGE';
        }
      } else image = bytes;
      if (!image || image.length > 8 * 1024 * 1024) continue;
      const size = imageSize(image);
      if (!size) continue;
      if (size.width < 400 || size.height < 250) continue;
      const id = sha256(image);
      if (result.visuals.some((v) => v.id === id)) continue;
      putVisual(id, image, size.mime);
      result.visuals.push({
        id, role: slot.role, kind: slot.candidate.kind, documentId: slot.candidate.documentId,
        attachedFileId: slot.candidate.attachedFileId, motionId: slot.candidate.motionId, date: slot.candidate.date,
        fileName: slot.candidate.fileName, mime: size.mime, width: width ?? size.width, height: height ?? size.height,
        bytes: image.length, extraction,
      });
    }
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
export function toLegacyTasResult(r: TasApiResult): LegacySourceResult & { tasApi: Omit<TasApiResult, 'cases'> & { cases: any[] } } {
  const docs = r.cases.map((c) => {
    const date = caseDate(c);
    const text = c.text;
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
      textTruncated: c.textTruncated,
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
    technicalFacts: dedupeTasTechnicalFacts(extractTasTechnicalFacts(c.text)),
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
