// evidence.ts — complete evidence kept, compact results sent.
//
// A source result can carry megabytes of document text (TAS reads every
// attachment of every case). Sending it through the queue and every poll is
// what exhausted the edge CPU (2026-10-10). Here, before completion:
//   * every document's COMPLETE text is uploaded once, content-addressed, to
//     the private verify-evidence bucket (never truncated);
//   * the result keeps a bounded excerpt per document plus a fullTextRef
//     pointing at the stored original, with textTruncated set honestly;
//   * an oversized structured payload is stored whole and trimmed in place.
// Nothing is discarded: every byte read is in storage and traceable.

import { createHash } from 'node:crypto';
import type { EvidenceRef } from './gateway.js';

export const DOC_EXCERPT_CHARS = 8_000;
export const TOTAL_EXCERPT_CHARS = 120_000;
export const MAX_RESULT_CHARS = 1_200_000;

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
    const full = typeof d.fullText === 'string' && d.fullText.length ? d.fullText : typeof d.rawText === 'string' ? d.rawText : '';
    delete d.fullText;
    if (!full) continue;
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
  if (serialized.length > MAX_RESULT_CHARS) {
    // The complete structured result is preserved in storage first.
    const hash = sha256(serialized);
    const path = await upload(hash, 'application/json', serialized);
    refs.push({ sha256: hash, path, chars: serialized.length, contentType: 'application/json', title: 'complete source result' });
    result.fullResultRef = { sha256: hash, path, chars: serialized.length };
    trimStructure(result);
    stats.trimmedStructure = true;
    serialized = JSON.stringify(result);
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
      if (Array.isArray(c?.attachments)) c.attachments = c.attachments.slice(0, 80);
      if (Array.isArray(c?.motions)) c.motions = c.motions.slice(0, 120);
    }
  }
  if (Array.isArray(r.discoveredEntities)) r.discoveredEntities = r.discoveredEntities.slice(0, 200);
}
