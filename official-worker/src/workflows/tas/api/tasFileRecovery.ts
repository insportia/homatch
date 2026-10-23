// tasFileRecovery.ts — fetch ONLY the named TAS attachments and turn them into
// official visual records, for a report whose run skipped them.
//
// Why: before 2026-10-11 the older-case wall-clock budget accounted small
// native images (.jpg renders and photographs) as NOT_PROCESSED_BUDGET
// without opening them. research-agent's `recover_visuals` action lists
// those files from the job's own ledger and asks for them here, by
// attachedFileId only — no search, no detail calls, no case re-read.
//
// Same rules as the workflow, reused rather than forked:
//   - the polite TasApiClient (concurrency ≤ 2, minimum gap, timeouts,
//     bounded retries, hard deadline, per-reply byte bound);
//   - classifyPayload (magic bytes decide what a reply is);
//   - classifyVisualMeta → refineWithImage (EXIF) → identityHints, the
//     same classification chain makeVisual() applies in TasApiWorkflow;
//   - scanPdfPictures for a PDF (embedded rasters only, tiles and strips
//     left out; no page rendering on this path — Chromium stays with the full run);
//   - the bytes go into the SAME bounded visual cache (cacheTasVisual), so
//     GET /research/visual/:sha serves them to the existing copy path.
//
// Nothing is stored or charged here; the caller copies what it keeps.

import { createHash } from 'node:crypto';
import { TasApiClient, TasDeadline, TasPayloadTooLarge, attachmentUrl } from './TasApiClient.js';
import { bytesToBuffer, classifyPayload, fileNameFromDisposition } from './tasModel.js';
import { imageSize } from './visuals.js';
import { scanPdfPictures } from './pdfTiles.js';
import { classifyVisualMeta, identityHints, readExif, refineWithImage } from './visualClassify.js';
import { cacheTasVisual, type VisualRecord } from './TasApiWorkflow.js';

/** Files per request. */
export const TAS_FILE_RECOVERY_MAX = 40;
/** One native image may be at most this large (TAS renders are 2–5 MB). */
export const TAS_FILE_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
/** One PDF opened for embedded pictures (bounded harder than a full run). */
export const TAS_FILE_PDF_MAX_BYTES = 25 * 1024 * 1024;
/** Same bound makeVisual() applies to one asset. */
const ASSET_MAX_BYTES = 8 * 1024 * 1024;

export interface TasFileRequest {
  attachedFileId: string;
  documentId?: string | null;
  motionId?: string | null;
  fileName?: string | null;
  description?: string | null;
  /** Case title / type, bounded — classification context, as in the workflow. */
  context?: string | null;
  caseCadastralCodes?: string[];
}

export type TasFileOutcome =
  | 'RECOVERED'
  | 'NO_VISUAL'
  | 'PAPERWORK'
  | 'UNSUPPORTED_FORMAT'
  | 'EMPTY'
  | 'DOWNLOAD_FAILED'
  | 'PAYLOAD_TOO_LARGE'
  | 'DEADLINE'
  | 'BAD_ID';

export interface TasFileResult {
  attachedFileId: string;
  outcome: TasFileOutcome;
  visualIds: string[];
  bytes: number;
  format: string | null;
  reason: string | null;
}

export interface TasFileRecoveryOptions {
  fetcher?: typeof fetch;
  /** Wall-clock for the whole request (default 40 s: the caller waits for the answer). */
  budgetMs?: number;
  /** ≤ 2: a government server is not hammered. */
  concurrency?: number;
  minGapMs?: number;
  parcel?: string | null;
  signal?: AbortSignal;
  now?: () => number;
}

export interface TasFileRecoveryResult {
  visuals: Array<VisualRecord & { exifDate?: string | null; recovered: true }>;
  files: TasFileResult[];
  http: { requests: number; retries: number; bytes: number; failures: number };
  durationMs: number;
  deadlineReached: boolean;
}

const FILE_ID = /^\d{1,12}$/;
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);

/** A request body → validated, de-duplicated, bounded file list. */
export function parseTasFileRequest(body: unknown): { files: TasFileRequest[]; parcel: string | null } | null {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, any>;
  const raw: any[] = Array.isArray(b.files) ? b.files : Array.isArray(b.attachedFileIds) ? b.attachedFileIds.map((id: unknown) => ({ attachedFileId: id })) : [];
  const seen = new Set<string>();
  const files: TasFileRequest[] = [];
  const s = (v: unknown, n = 400) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : typeof v === 'number' ? String(v) : null);
  for (const f of raw) {
    const id = s(f?.attachedFileId, 20);
    if (!id || !FILE_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    files.push({
      attachedFileId: id,
      documentId: s(f?.documentId, 20),
      motionId: s(f?.motionId, 20),
      fileName: s(f?.fileName, 300),
      description: s(f?.description, 300),
      context: s(f?.context, 400),
      caseCadastralCodes: Array.isArray(f?.caseCadastralCodes) ? f.caseCadastralCodes.map((c: unknown) => s(c, 40)).filter(Boolean).slice(0, 20) as string[] : [],
    });
    if (files.length >= TAS_FILE_RECOVERY_MAX) break;
  }
  if (!files.length) return null;
  const parcel = s(b.parcel, 40);
  return { files, parcel };
}

const sha256 = (b: Uint8Array): string => createHash('sha256').update(bytesToBuffer(b)).digest('hex');
const extOf = (name: string | null | undefined): string => (/\.([a-z0-9]{2,5})$/i.exec(String(name ?? ''))?.[1] ?? '').toLowerCase();

/** Download the named attachments and build their visual records. Never throws for one file. */
export async function recoverTasFiles(files: TasFileRequest[], options: TasFileRecoveryOptions = {}): Promise<TasFileRecoveryResult> {
  const now = options.now ?? Date.now;
  const started = now();
  const client = new TasApiClient({
    fetcher: options.fetcher,
    deadlineAt: started + Math.min(options.budgetMs ?? 40_000, 55_000),
    concurrency: Math.max(1, Math.min(options.concurrency ?? 2, 2)),
    minGapMs: Math.max(options.minGapMs ?? 400, 0),
    timeoutMs: 25_000,
    retries: 1,
    signal: options.signal,
  });
  const out: TasFileRecoveryResult = { visuals: [], files: [], http: client.stats, durationMs: 0, deadlineReached: false };
  const list = files.slice(0, TAS_FILE_RECOVERY_MAX);

  const one = async (f: TasFileRequest): Promise<void> => {
    const res: TasFileResult = { attachedFileId: f.attachedFileId, outcome: 'DOWNLOAD_FAILED', visualIds: [], bytes: 0, format: null, reason: null };
    out.files.push(res);
    if (!FILE_ID.test(f.attachedFileId)) {
      res.outcome = 'BAD_ID';
      return;
    }
    const declaredExt = extOf(f.fileName);
    const meta0 = classifyVisualMeta({ fileName: f.fileName, description: f.description ?? null, context: f.context ?? null, extension: declaredExt || null });
    if (meta0 === null) {
      // Paperwork (contracts, extracts, IDs …) is never fetched as a picture.
      res.outcome = 'PAPERWORK';
      return;
    }
    try {
      const max = IMAGE_EXT.has(declaredExt) ? TAS_FILE_IMAGE_MAX_BYTES : TAS_FILE_PDF_MAX_BYTES;
      const r = await client.request(attachmentUrl(f.attachedFileId), {}, { maxBytes: max, retries: 1 });
      res.bytes = r.bytes.length;
      const declared = fileNameFromDisposition(r.disposition);
      const fileName = f.fileName ?? declared;
      const cls = classifyPayload({ status: r.status, contentType: r.contentType, bytes: r.bytes, fileName });
      res.format = cls.format;
      if (cls.kind === 'FAILED') {
        res.outcome = 'DOWNLOAD_FAILED';
        res.reason = cls.format;
        return;
      }
      if (cls.kind === 'EMPTY') {
        res.outcome = 'EMPTY';
        return;
      }
      const outs: Array<{ bytes: Uint8Array; extraction: VisualRecord['extraction'] }> = [];
      if (cls.kind === 'IMAGE' && (cls.format === 'jpeg' || cls.format === 'png')) outs.push({ bytes: r.bytes, extraction: 'NATIVE_IMAGE' });
      // Tiles of a picture (pdfTiles.ts) and lone strips are never recovered as
      // slices; with no page renderer on this path they are left out.
      else if (cls.kind === 'PDF') for (const i of scanPdfPictures(r.bytes, { maxImages: 4 }).singles) outs.push({ bytes: i.bytes, extraction: 'PDF_EMBEDDED_IMAGE' });
      else {
        // webp / gif / tiff / archives: nothing here can show them safely.
        res.outcome = 'UNSUPPORTED_FORMAT';
        return;
      }
      const meta = classifyVisualMeta({ fileName, description: f.description ?? null, context: f.context ?? null, extension: cls.kind === 'PDF' ? 'pdf' : declaredExt || cls.format });
      const base = meta ?? meta0;
      for (const o of outs) {
        const rec = buildRecoveredVisual(f, fileName ?? null, base, o.bytes, o.extraction, options.parcel ?? null);
        if (!rec || out.visuals.some((v) => v.id === rec.id)) continue;
        out.visuals.push(rec);
        res.visualIds.push(rec.id);
      }
      res.outcome = res.visualIds.length ? 'RECOVERED' : 'NO_VISUAL';
    } catch (e) {
      if (e instanceof TasDeadline) {
        out.deadlineReached = true;
        res.outcome = 'DEADLINE';
      } else if (e instanceof TasPayloadTooLarge) {
        res.outcome = 'PAYLOAD_TOO_LARGE';
        res.reason = (e as Error).message;
      } else {
        res.outcome = 'DOWNLOAD_FAILED';
        res.reason = String((e as Error)?.message ?? e).slice(0, 120);
      }
    }
  };

  // Polite pool: never more than `concurrency` in flight (the client enforces it too).
  let next = 0;
  const workers = Array.from({ length: Math.min(2, list.length) }, async () => {
    while (next < list.length) await one(list[next++]);
  });
  await Promise.all(workers);
  out.files.sort((a, b) => list.findIndex((f) => f.attachedFileId === a.attachedFileId) - list.findIndex((f) => f.attachedFileId === b.attachedFileId));
  out.durationMs = now() - started;
  return out;
}

/**
 * One visual record from recovered bytes — the same checks and the same
 * classification chain as the workflow's makeVisual(): ≤ 8 MB, ≥ 400×250,
 * metadata kind refined by EXIF, identity hints from the file and case.
 */
export function buildRecoveredVisual(
  f: TasFileRequest,
  fileName: string | null,
  meta: { kind: VisualRecord['kind']; category: VisualRecord['category']; confidence: number; basis: string },
  bytes: Uint8Array,
  extraction: VisualRecord['extraction'],
  parcel: string | null,
): (VisualRecord & { exifDate?: string | null; recovered: true }) | null {
  if (!bytes.length || bytes.length > ASSET_MAX_BYTES) return null;
  const size = imageSize(bytes);
  if (!size || size.width < 400 || size.height < 250) return null;
  const exif = size.mime === 'image/jpeg' ? readExif(bytes) : null;
  const cls = refineWithImage(meta, { exif, extraction, pageText: null, context: f.context ?? null });
  const id = sha256(bytes);
  cacheTasVisual(id, bytes, size.mime);
  const codes = f.caseCadastralCodes ?? [];
  // A camera's own EXIF date is the only date taken from the file itself.
  const exifDate = exif?.make && exif.dateTime && /^\d{4}:\d{2}:\d{2}/.test(exif.dateTime) ? exif.dateTime.slice(0, 10).replace(/:/g, '-') : null;
  return {
    id,
    role: 'SUPPORTING',
    kind: cls.kind,
    category: cls.category,
    confidence: Math.round(cls.confidence * 100) / 100,
    classificationBasis: cls.basis,
    documentId: f.documentId ?? '',
    attachedFileId: f.attachedFileId,
    motionId: f.motionId ?? null,
    date: null,
    fileName,
    page: null,
    mime: size.mime,
    width: size.width,
    height: size.height,
    bytes: bytes.length,
    extraction,
    identity: identityHints({ fileName, description: f.description ?? null, caseText: f.context ?? null, pageText: null, caseCadastralCodes: codes, parcel }),
    source: 'TAS',
    usage: 'OFFICIAL_RECORD_REFERENCE',
    exifDate,
    recovered: true,
  } as VisualRecord & { exifDate?: string | null; recovered: true };
}
