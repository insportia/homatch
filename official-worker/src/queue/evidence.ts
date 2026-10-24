// evidence.ts — complete evidence kept, compact results sent.
//
// A source result can carry megabytes of document text (TAS reads every
// attachment of every case). Sending it through the queue and every poll is
// what exhausted the edge CPU (2026-10-10). Here, before completion:
//   * every document's COMPLETE text is uploaded once, content-addressed, to
//     the private verify-evidence bucket (never truncated);
//   * the result keeps a bounded excerpt per document plus a fullTextRef
//     pointing at the stored original, with textTruncated set honestly;
//   * TAS's two newest ("priority") cases keep their complete text INLINE
//     (sized by the source, ≤ 400k chars across both) AND stored whole, with
//     textRef / textSha256 / textComplete;
//   * an oversized structured payload is stored whole and trimmed in place
//     (priority cases' structure is never trimmed; their inline text gives
//     way last, flagged textComplete:false, the stored ref intact).
// Nothing is discarded: every byte read is in storage and traceable.

import { createHash } from 'node:crypto';
import type { EvidenceRef } from './gateway.js';
import { decodeLegacyGeorgian } from '../documents/legacyGeorgian.js';

export const DOC_EXCERPT_CHARS = 8_000;
export const TOTAL_EXCERPT_CHARS = 120_000;
/*
 * The bound is in UTF-8 BYTES, not characters: verify-queue refuses a body
 * over 2.5 MB (MAX_BODY_BYTES) and Georgian text is 3 bytes per character,
 * so a 1.2M-character result could be a 3.6 MB request and fail with 413.
 * 2.0 MB leaves room for evidenceRefs and the request envelope.
 */
export const MAX_RESULT_BYTES = 2_000_000;
/*
 * AND A CHARACTER BOUND (prod eacaf5a0, 2026-10-24). verify-queue ALSO refuses
 * a result whose JSON is over 1,500,000 CHARACTERS (its MAX_RESULT_BYTES counts
 * string length). A mostly-ASCII result of 1.6-2.0 MB passed the byte bound
 * here and was refused there (413 RESULT_TOO_LARGE): the TAS map's whole
 * result was lost and the task waited out its lease. Both bounds now hold:
 * Georgian text (3 bytes a character) meets the byte bound first, Latin text
 * the character bound.
 */
export const QUEUE_MAX_RESULT_CHARS = 1_500_000;
export const MAX_RESULT_STRING_CHARS = 1_400_000;
/** How far a serialized result is over either bound (bytes or characters), 0 when within both. */
const overBy = (s: string) => Math.max(0, bytesOf(s) - MAX_RESULT_BYTES, s.length - MAX_RESULT_STRING_CHARS);
/** What handoffMinimum guarantees: a result the queue always accepts. */
export const HANDOFF_MIN_BYTES = 400_000;
/** @deprecated kept for callers that still import it; the bound is MAX_RESULT_BYTES. */
export const MAX_RESULT_CHARS = MAX_RESULT_BYTES;
const utf8 = new TextEncoder();
const bytesOf = (s: string) => utf8.encode(s).length;

export type Uploader = (sha256: string, contentType: EvidenceRef['contentType'], body: string) => Promise<string>;

export const sha256 = (s: string) => createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

export interface Compacted {
  result: any;
  evidenceRefs: EvidenceRef[];
  contentHash: string;
  stats: { documents: number; storedDocuments: number; storedChars: number; excerptChars: number; trimmedStructure: boolean };
}

export async function compactResult(raw: any, upload: Uploader): Promise<Compacted> {
  const result = raw && typeof raw === 'object' ? raw : { value: raw };
  const docs: any[] = Array.isArray(result.documents) ? result.documents : [];
  const refs: EvidenceRef[] = [];
  const stats = { documents: docs.length, storedDocuments: 0, storedChars: 0, excerptChars: 0, trimmedStructure: false };

  // Newest documents keep their excerpt first, as the receiving side expects.
  const order = [...docs].sort((a, b) => String(b?.documentDate ?? '').localeCompare(String(a?.documentDate ?? '')));
  let remaining = TOTAL_EXCERPT_CHARS;
  for (const d of order) {
    if (!d || typeof d !== 'object') continue;
    // Legacy-font Georgian (older NAPR extracts) is decoded before it is stored or read (legacyGeorgian.ts).
    if (typeof d.rawText === 'string') d.rawText = decodeLegacyGeorgian(d.rawText);
    if (typeof d.fullText === 'string') d.fullText = decodeLegacyGeorgian(d.fullText);
    const full = typeof d.fullText === 'string' && d.fullText.length ? d.fullText : typeof d.rawText === 'string' ? d.rawText : '';
    delete d.fullText;
    if (!full) continue;
    if (d.priority) {
      // TAS "two newest cases": the complete text stays INLINE (already sized
      // by the source, ≤ PRIORITY_INLINE_TEXT_MAX across both) and is ALSO
      // stored whole, so a later size trim can never lose it.
      const inline = typeof d.rawText === 'string' ? d.rawText : full;
      const hash = sha256(full);
      const path = await upload(hash, 'text/plain', full);
      refs.push({ sha256: hash, path, chars: full.length, contentType: 'text/plain', documentId: d.id ?? null, title: d.title ?? null });
      d.fullTextRef = { sha256: hash, path, chars: full.length };
      d.textRef = d.fullTextRef;
      d.textSha256 = hash;
      d.rawText = inline;
      d.textComplete = inline.length >= full.length;
      d.textTruncated = !d.textComplete;
      stats.storedDocuments++;
      stats.storedChars += full.length;
      stats.excerptChars += inline.length;
      continue;
    }
    const keep = Math.max(0, Math.min(DOC_EXCERPT_CHARS, remaining));
    const excerpt = full.slice(0, keep);
    if (excerpt.length < full.length || full.length > DOC_EXCERPT_CHARS) {
      const hash = sha256(full);
      const path = await upload(hash, 'text/plain', full);
      const ref: EvidenceRef = { sha256: hash, path, chars: full.length, contentType: 'text/plain', documentId: d.id ?? null, title: d.title ?? null };
      refs.push(ref);
      d.fullTextRef = { sha256: hash, path, chars: full.length };
      stats.storedDocuments++;
      stats.storedChars += full.length;
    }
    d.rawText = excerpt;
    d.textTruncated = excerpt.length < full.length || d.textTruncated === true;
    remaining -= excerpt.length;
    stats.excerptChars += excerpt.length;
  }

  let serialized = JSON.stringify(result);
  if (overBy(serialized) > 0) {
    // The complete structured result is preserved in storage first.
    const hash = sha256(serialized);
    const path = await upload(hash, 'application/json', serialized);
    refs.push({ sha256: hash, path, chars: serialized.length, contentType: 'application/json', title: 'complete source result' });
    result.fullResultRef = { sha256: hash, path, chars: serialized.length };
    trimStructure(result);
    stats.trimmedStructure = true;
    serialized = JSON.stringify(result);
    // Still too large: the priority texts give way (largest first); each
    // keeps its stored ref and says it is no longer complete inline.
    let over = overBy(serialized);
    if (over > 0) {
      for (const d of docs.filter((x) => x?.priority && typeof x.rawText === 'string').sort((a, b) => b.rawText.length - a.rawText.length)) {
        if (over <= 0) break;
        // `over` is bytes; a Georgian character is up to 3 bytes, so cutting
        // `over` characters always frees at least `over` bytes.
        const cut = Math.min(d.rawText.length, over + 1024);
        d.rawText = d.rawText.slice(0, d.rawText.length - cut);
        d.textComplete = false;
        d.textTruncated = true;
        d.inlineTrimmedForSize = true;
        over -= cut;
      }
      serialized = JSON.stringify(result);
    }
  }
  return { result, evidenceRefs: refs, contentHash: sha256(serialized), stats };
}

/** In-place trim of the bulky structured parts (originals are in storage). */
function trimStructure(r: any): void {
  if (Array.isArray(r.traversal?.records)) r.traversal.records = r.traversal.records.slice(0, 60);
  for (const k of ['documentReferences', 'requests', 'continuations']) if (Array.isArray(r.traversal?.[k])) r.traversal[k] = r.traversal[k].slice(0, 50);
  const cases = r.tasApi?.cases;
  if (Array.isArray(cases)) {
    for (const c of cases) {
      if (c?.priority) continue; // the two newest cases keep their complete structure
      if (Array.isArray(c?.attachments)) c.attachments = c.attachments.slice(0, 80);
      if (Array.isArray(c?.motions)) c.motions = c.motions.slice(0, 120);
    }
  }
  if (Array.isArray(r.discoveredEntities)) r.discoveredEntities = r.discoveredEntities.slice(0, 200);
}

/*
 * THE HAND-OFF NEVER LOSES A FINISHED SOURCE (prod a7177a89, eacaf5a0).
 *
 * When the queue refuses a result (413) or does not answer in time, the work
 * behind it (CAPTCHA solves, PDFs, TAS pages) is already paid for and its
 * texts are already in storage (compactResult). This is the same result cut
 * to what the report needs: every status field, every document with a short
 * excerpt and its stored-text ref, the first entities, the stored full-result
 * ref. It is always under HANDOFF_MIN_BYTES, so the second hand-off succeeds.
 *
 * AND THE PLACE THE SOURCE SAW (prod 9f49e7e3, 2026-10-24). The cadastral map
 * records the parcel's own zoomed views in `frameUrls` (ms.gov.ge/msmap/#C=…);
 * they are the only official coordinates a TAS_MAP result carries, and the
 * report's market search, neighbourhood and photo lookup all read the parcel
 * centre from them. This cut kept scalars only, so a TAS_MAP result refused as
 * 413 arrived with nothing but the map's default start view and every
 * downstream stage said "location unknown". The views are a few short strings:
 * they are kept (map views first, bounded).
 */
const MAX_HANDOFF_FRAME_URLS = 12;
const MAX_HANDOFF_URL_CHARS = 600;
const MAP_VIEW = /ms\.gov\.ge\/msmap\/#C=/;
function handoffFrameUrls(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const urls = v.filter((u): u is string => typeof u === 'string' && u.length > 0 && u.length <= MAX_HANDOFF_URL_CHARS);
  const ordered = [...urls.filter((u) => MAP_VIEW.test(u)), ...urls.filter((u) => !MAP_VIEW.test(u))];
  return [...new Set(ordered)].slice(0, MAX_HANDOFF_FRAME_URLS);
}

export function handoffMinimum(result: any, maxBytes = HANDOFF_MIN_BYTES): any {
  const r = result && typeof result === 'object' ? result : { value: result };
  const out: any = {};
  for (const [k, v] of Object.entries(r)) {
    if (v == null || typeof v !== 'object') out[k] = v;
  }
  for (const k of ['fullResultRef', 'workflowResult', 'captchaResolution', 'rsVerification', 'sourceOutcome', 'outcomeReason', '_exec']) {
    if (r[k] !== undefined) out[k] = r[k];
  }
  const frames = handoffFrameUrls(r.frameUrls);
  if (frames) out.frameUrls = frames;
  const docs: any[] = Array.isArray(r.documents) ? r.documents : [];
  const docOf = (d: any, chars: number) => {
    const keep: any = {};
    for (const [k, v] of Object.entries(d ?? {})) if (v == null || typeof v !== 'object') keep[k] = v;
    for (const k of ['fullTextRef', 'textRef', 'contentMetadata']) if (d?.[k] !== undefined) keep[k] = d[k];
    if (typeof d?.rawText === 'string') {
      keep.rawText = d.rawText.slice(0, chars);
      if (keep.rawText.length < d.rawText.length) { keep.textTruncated = true; keep.textComplete = false; }
    }
    return keep;
  };
  if (Array.isArray(r.queueEntities)) out.queueEntities = r.queueEntities.slice(0, 50);
  if (Array.isArray(r.discoveredEntities)) out.discoveredEntities = r.discoveredEntities.slice(0, 50);
  out.handoffMinimum = true;
  // Newest first (owner 2026-10-24: "priority to the latest information"): the newest documents keep the most text.
  const newestFirst = [...docs].sort((a, b) => String(b?.documentDate ?? b?.date ?? '').localeCompare(String(a?.documentDate ?? a?.date ?? ''))).slice(0, 120);
  for (const [top, rest] of [[8000, 3000], [4000, 1000], [2000, 300], [1000, 0], [0, 0]] as const) {
    out.documents = newestFirst.map((d, i) => docOf(d, i < 5 ? top : rest));
    if (bytesOf(JSON.stringify(out)) <= maxBytes) return out;
  }
  out.documents = out.documents.slice(0, 20);
  delete out.queueEntities;
  delete out.discoveredEntities;
  return out;
}
