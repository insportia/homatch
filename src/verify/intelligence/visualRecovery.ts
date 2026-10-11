// visualRecovery.ts — bring back the official pictures a time budget skipped.
//
// The worker reads the two newest TAS cases in full and older cases within a
// wall-clock budget. Before 2026-10-11 that budget also skipped small native
// images (renders and photographs attached as .jpg), which were then only
// ACCOUNTED (outcome NOT_PROCESSED_BUDGET) with their official link. The
// newest cases' own pictures were stored in the private bucket but never
// reached the gallery, which held only the worker's 24-asset shortlist.
//
// This module is the pure half of the recovery (research-agent action
// `recover_visuals` is the impure half):
//   1. recoverableAttachments(): image attachments of the job's ledger whose
//      outcome was a budget / transient one — what the worker is asked for;
//   2. storedUnpersistedVisuals(): pictures the worker already stored but the
//      report never listed (no network needed);
//   3. applyVisualRecovery(): APPEND the recovered records (provenance kept),
//      mark the ledger entries RECOVERED (the original outcome kept in
//      previousOutcome), fix the accounting counts, write the idempotency
//      marker `_visualRecovery`. Writes nothing it was not given.
//
// Never fabricates: a record exists only for bytes that are in the bucket.
// Charges nothing. Pure: safe in Edge Functions, the browser and node --test.

import { VISUAL_ASSET_MAX } from './visualAssets.ts';
import { assessVisualQuality } from './visualQuality.ts';

export const VISUAL_RECOVERY_VERSION = 1;
export const VISUAL_RECOVERY_SOURCE = 'TAS_ATTACHMENT_RECOVERY';
export const VISUAL_RECOVERY_STORED_SOURCE = 'TAS_PRIORITY_STORED';
/** Attachments asked of the worker per call (the worker enforces the same bound). */
export const VISUAL_RECOVERY_MAX_FILES = 40;
/** A partial recovery (budget) is resumed at most this many times. */
export const VISUAL_RECOVERY_MAX_ATTEMPTS = 3;

/**
 * Ledger outcomes worth another, image-only attempt. IMAGE = downloaded but
 * never kept (the worker's gallery bound was full): its bytes left the cache.
 */
export const RECOVERABLE_OUTCOMES: ReadonlySet<string> = new Set(['NOT_PROCESSED_BUDGET', 'DEFERRED', 'DOWNLOAD_FAILED', 'IMAGE']);
const IMAGE_EXT = /^(jpe?g|png|webp)$/i;
const SHA = /^[a-f0-9]{64}$/;
const FILE_ID = /^\d{1,12}$/;
const TAS_ORIGIN = 'https://docs.tbilisi.gov.ge';

export const tasDownloadUrl = (attachedFileId: string): string =>
  `${TAS_ORIGIN}/DownloadServlet?downloadCase=2&attachedFileId=${encodeURIComponent(attachedFileId)}`;

type Rec = Record<string, any>;
const obj = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {});
const arr = <T = any>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

export interface VisualRecoveryMarker {
  at: string;
  version: number;
  complete: boolean;
  attempts: number;
  counts: {
    requested: number;
    recovered: number;
    appended: number;
    storedAppended: number;
    failed: number;
    skippedQuality: number;
  };
  error?: string | null;
}

export interface RecoveryCandidate {
  attachedFileId: string;
  documentId: string;
  motionId: string | null;
  fileName: string | null;
  outcome: string;
  /** Case title / type / description, bounded: the same context the worker classifies with. */
  context: string | null;
  caseCadastralCodes: string[];
  caseDate: string | null;
  sourceUrl: string;
}

/** The TAS API result inside a job's result_json (the first TAS result that carries one). */
export function tasApiOf(resultJson: unknown): Rec | null {
  for (const r of arr(obj(obj(resultJson).browserOfficial).results)) if (str(r?.source).toLowerCase() === 'tas' && r?.tasApi) return r.tasApi;
  return null;
}

const extOf = (a: Rec): string => (str(a.format) || str(a.extension) || (/\.([a-z0-9]{2,5})$/i.exec(str(a.fileName))?.[1] ?? '')).toLowerCase();

/**
 * Image attachments the worker never opened because of a budget (or a
 * transient failure), newest case first, never one already in the report.
 */
export function recoverableAttachments(resultJson: unknown, opts: { max?: number; exclude?: Iterable<string> } = {}): RecoveryCandidate[] {
  const api = tasApiOf(resultJson);
  if (!api) return [];
  const known = new Set([...arr(obj(resultJson).officialVisuals).map((v) => str(v?.attachedFileId)).filter(Boolean), ...(opts.exclude ?? [])]);
  const out: RecoveryCandidate[] = [];
  const seen = new Set<string>();
  for (const c of arr(api.cases)) {
    const documentId = str(c?.documentId);
    const context = [str(c?.title), str(c?.docType), str(c?.description)].filter(Boolean).join(' · ').slice(0, 400) || null;
    for (const a of arr(c?.attachments)) {
      const id = str(a?.attachedFileId);
      if (!FILE_ID.test(id) || seen.has(id) || known.has(id)) continue;
      if (!RECOVERABLE_OUTCOMES.has(str(a?.outcome)) || !IMAGE_EXT.test(extOf(a))) continue;
      seen.add(id);
      out.push({
        attachedFileId: id,
        documentId: str(a?.documentId) || documentId,
        motionId: str(a?.motionId) || null,
        fileName: str(a?.fileName) || null,
        outcome: str(a?.outcome),
        context,
        caseCadastralCodes: arr(c?.cadastralCodes).map(str).filter(Boolean),
        caseDate: /^\d{4}-\d{2}-\d{2}/.test(str(c?.date)) ? str(c.date).slice(0, 10) : null,
        sourceUrl: tasDownloadUrl(id),
      });
    }
  }
  out.sort((x, y) => (y.caseDate ?? '').localeCompare(x.caseDate ?? '') || x.attachedFileId.length - y.attachedFileId.length || x.attachedFileId.localeCompare(y.attachedFileId));
  return out.slice(0, Math.max(0, Math.min(opts.max ?? VISUAL_RECOVERY_MAX_FILES, VISUAL_RECOVERY_MAX_FILES)));
}

/** The bucket record the report keeps for one worker visual (same shape research-agent's copy writes). */
export function storedVisualRecord(v: Rec, provenance: Rec): Rec | null {
  const id = str(v?.id);
  if (!SHA.test(id)) return null;
  const mime = v.mime === 'image/png' ? 'image/png' : 'image/jpeg';
  const attachedFileId = str(v.attachedFileId) || null;
  return {
    id, role: v.role === 'LATEST_RENDER' || v.role === 'EARLIEST_RENDER' ? v.role : 'SUPPORTING', kind: str(v.kind) || 'OTHER', category: str(v.category) || null,
    confidence: Number.isFinite(Number(v.confidence)) ? Number(v.confidence) : null, classificationBasis: str(v.classificationBasis) || null,
    date: str(v.date) || null, width: Number(v.width) > 0 ? Number(v.width) : null, height: Number(v.height) > 0 ? Number(v.height) : null,
    bytes: Number(v.bytes) > 0 ? Number(v.bytes) : null,
    mime, extraction: str(v.extraction) || null, page: Number(v.page) > 0 ? Number(v.page) : null,
    storagePath: `tas/${id}.${mime === 'image/png' ? 'png' : 'jpg'}`,
    documentId: str(v.documentId) || null, attachedFileId, motionId: str(v.motionId) || null, fileName: str(v.fileName) || null,
    identity: v.identity ?? null, source: 'TAS', usage: 'OFFICIAL_RECORD_REFERENCE',
    ...(v.priority ? { priority: v.priority } : {}),
    provenance: { ...provenance, documentId: str(v.documentId) || null, attachedFileId, sourceUrl: attachedFileId ? tasDownloadUrl(attachedFileId) : null },
  };
}

/** May this asset join the gallery? Pictures always; unlabelled PDF rasters (paperwork scans) never. */
export function recoverableKind(v: Rec): boolean {
  const kind = str(v?.kind).toUpperCase() || 'OTHER';
  if (kind !== 'OTHER') return true;
  return str(v?.extraction) === 'NATIVE_IMAGE';
}

/**
 * Pictures the worker STORED (the newest cases' priorityVisuals, stored:true)
 * that the report never listed: appended without any network call. Paperwork
 * rasters (unclassified PDF images: consent letters, expert reports) and
 * blank layers are left out.
 */
export function storedUnpersistedVisuals(resultJson: unknown, at: string): { records: Rec[]; skippedQuality: number } {
  const api = tasApiOf(resultJson);
  if (!api) return { records: [], skippedQuality: 0 };
  const known = new Set(arr(obj(resultJson).officialVisuals).map((v) => str(v?.id)));
  const records: Rec[] = [];
  let skippedQuality = 0;
  for (const v of [...arr(api.priorityVisuals), ...arr(api.visuals)]) {
    const id = str(v?.id);
    if (!SHA.test(id) || known.has(id) || v?.stored !== true || !recoverableKind(v)) continue;
    known.add(id);
    if (!assessVisualQuality(v).usable) {
      skippedQuality++;
      continue;
    }
    const r = storedVisualRecord(v, { recoveredAt: at, recoveredFrom: VISUAL_RECOVERY_STORED_SOURCE });
    if (r) records.push(r);
  }
  // Native pictures first (renders, photographs), then the rest.
  records.sort((x, y) => Number(y.extraction === 'NATIVE_IMAGE') - Number(x.extraction === 'NATIVE_IMAGE'));
  return { records, skippedQuality };
}

export function recoveryMarker(resultJson: unknown): VisualRecoveryMarker | null {
  const m = obj(obj(resultJson)._visualRecovery);
  return m.at ? (m as VisualRecoveryMarker) : null;
}

/** Does this job still owe a visual recovery? (No marker, or a partial one with attempts left.) */
export function needsVisualRecovery(resultJson: unknown): boolean {
  const m = recoveryMarker(resultJson);
  if (m && (m.complete || (m.attempts ?? 1) >= VISUAL_RECOVERY_MAX_ATTEMPTS)) return false;
  if (!tasApiOf(resultJson)) return false;
  const stored = storedUnpersistedVisuals(resultJson, '').records;
  return stored.length > 0 || recoverableAttachments(resultJson, { max: 1, exclude: stored.map((r) => str(r.attachedFileId)) }).length > 0;
}

/** The worker's answer for one requested file. */
export interface WorkerFileOutcome {
  attachedFileId: string;
  outcome: string;
  visualIds?: string[];
  reason?: string | null;
}

export interface RecoveryInput {
  at: string;
  /** Records whose bytes ARE in the bucket (copied or confirmed), in the order to append. */
  records: Rec[];
  /** Per requested file, as the worker (and the copy step) reported it. */
  outcomes: WorkerFileOutcome[];
  requested: number;
  storedAppended: number;
  skippedQuality: number;
  complete: boolean;
  error?: string | null;
  max?: number;
}

/**
 * Apply a recovery to a result_json, IN PLACE (the caller holds the only copy
 * it will write, once). Returns the marker. Idempotent per id: a record
 * already in the report is never appended twice.
 */
export function applyVisualRecovery(resultJson: Rec, input: RecoveryInput): VisualRecoveryMarker {
  const max = input.max ?? VISUAL_ASSET_MAX;
  const list: Rec[] = arr(resultJson.officialVisuals).slice();
  const have = new Set(list.map((v) => str(v?.id)));
  const usableCount = () => list.filter((v) => assessVisualQuality(v).usable).length;
  let appended = 0;
  for (const r of input.records) {
    const id = str(r?.id);
    if (!SHA.test(id) || have.has(id) || usableCount() >= max) continue;
    have.add(id);
    list.push(r);
    appended++;
  }
  if (appended) resultJson.officialVisuals = list;
  // Ledger: RECOVERED only when a picture of that file is now in the report.
  const inReport = new Set(list.map((v) => str(v?.attachedFileId)).filter(Boolean));
  const byFile = new Map(input.outcomes.map((o) => [o.attachedFileId, o]));
  const api = tasApiOf(resultJson);
  let recovered = 0;
  let failed = 0;
  const acc = obj(api?.accounting);
  const counts = obj(acc.attachmentOutcomes);
  for (const c of arr(api?.cases)) {
    for (const a of arr(c?.attachments)) {
      const o = byFile.get(str(a?.attachedFileId));
      if (!o) continue;
      if (o.outcome === 'RECOVERED' && inReport.has(str(a.attachedFileId)) && a.outcome !== 'RECOVERED') {
        const prev = str(a.outcome) || null;
        a.previousOutcome = prev;
        a.outcome = 'RECOVERED';
        a.recoveredAt = input.at;
        a.recoveredFrom = VISUAL_RECOVERY_SOURCE;
        a.url = a.url ?? tasDownloadUrl(str(a.attachedFileId));
        if (prev && Number(counts[prev]) > 0) counts[prev] = Number(counts[prev]) - 1;
        counts.RECOVERED = Number(counts.RECOVERED || 0) + 1;
        if (prev === 'NOT_PROCESSED_BUDGET' && api?.ledger?.deferred && Number(api.ledger.deferred.attachmentsBudget) > 0) api.ledger.deferred.attachmentsBudget--;
        recovered++;
      } else if (o.outcome !== 'RECOVERED') {
        a.recoveryAttempt = { at: input.at, outcome: o.outcome, reason: o.reason ?? null };
        failed++;
      }
    }
  }
  if (api && Object.keys(counts).length) {
    api.accounting = { ...acc, attachmentOutcomes: counts };
  }
  const prev = recoveryMarker(resultJson);
  const marker: VisualRecoveryMarker = {
    at: input.at,
    version: VISUAL_RECOVERY_VERSION,
    complete: input.complete,
    attempts: (prev?.attempts ?? 0) + 1,
    counts: {
      requested: input.requested,
      recovered,
      appended,
      storedAppended: input.storedAppended,
      failed,
      skippedQuality: input.skippedQuality,
    },
    ...(input.error ? { error: String(input.error).slice(0, 200) } : {}),
  };
  resultJson._visualRecovery = marker;
  return marker;
}
