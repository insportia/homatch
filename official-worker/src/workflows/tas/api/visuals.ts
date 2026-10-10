// visuals.ts — selective OFFICIAL visual evidence from TAS attachments.
//
// Two stages, cheapest first:
//   1. rankVisualCandidates(): metadata only (file name, description, type,
//      date, motion relationship). Nothing is downloaded to decide what is
//      worth looking at.
//   2. extractImagesFromPdf() / native images / pdfRender.ts: only the
//      shortlisted candidates are opened; photo/render PDFs yield their
//      embedded raster images, vector drawings are rendered page-by-page
//      (bounded). DWG/PLA/RAR are never opened.
//
// STRICT SOURCE SEPARATION: everything here comes from TAS official
// attachments. Marketplace photos never enter this module.

import { bytesToBuffer } from './tasModel.js';
import type { TasAttachment } from './tasModel.js';
import { classifyVisualMeta, DRAWING_KINDS, type VisualAssetKind, type VisualCategory } from './visualClassify.js';

/** The classification vocabulary (visualClassify.ts). Kept under the old name for callers. */
export type VisualKind = VisualAssetKind;

export interface VisualCandidate {
  attachedFileId: string;
  documentId: string;
  motionId: string | null;
  fileName: string | null;
  date: string | null;
  kind: VisualKind;
  category: VisualCategory;
  confidence: number;
  basis: string;
  score: number;
  native: boolean;
  /** Case context used for classification (title / type / motion), bounded. */
  context: string | null;
  /** The TAS case's cadastral codes (identity provenance). */
  caseCadastralCodes: string[];
  /** false when the case's own codes name a different parcel. */
  parcelMatch: boolean | null;
  description: string | null;
  sizeBytes: number | null;
  reason: string;
}

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);

/** Back-compat: the metadata kind of a free text (null = paperwork / nothing visual). */
export function visualKindOf(text: string): { kind: VisualKind; weight: number } | null {
  const c = classifyVisualMeta({ fileName: text });
  return c && c.matched ? { kind: c.kind, weight: c.weight } : null;
}

export type RankInput = TasAttachment & { documentId: string; context?: string | null; caseCadastralCodes?: string[] };

function parcelMatches(codes: string[], parcel: string | null | undefined): boolean | null {
  if (!parcel || !codes.length) return null;
  return codes.some((c) => c === parcel || c.startsWith(`${parcel}.`) || parcel.startsWith(`${c}.`));
}

export function rankVisualCandidates(attachments: RankInput[], opts: { parcel?: string | null } = {}): VisualCandidate[] {
  const out: VisualCandidate[] = [];
  for (const a of attachments) {
    const ext = a.extension ?? '';
    const native = IMAGE_EXT.has(ext);
    if (!native && ext !== 'pdf') continue; // DWG/PLA/RAR never on the critical path
    const c = classifyVisualMeta({ fileName: a.fileName, description: a.description, context: a.context ?? null, extension: ext });
    if (!c) continue; // paperwork
    // An unlabelled native image is still a plausible project picture; an
    // unlabelled PDF is far more often paperwork.
    if (!c.matched && !native) continue;
    const codes = (a.caseCadastralCodes ?? []).map(String);
    const parcelMatch = parcelMatches(codes, opts.parcel);
    const recency = a.date ? Math.min(10, Math.max(0, (Date.parse(a.date) - Date.parse('2005-01-01')) / (365 * 864e5))) : 0;
    const size = a.sizeBytes ?? 0;
    const sizeHint = size > 0 && size < 25_000 ? -30 : 0; // icons and stamps
    out.push({
      attachedFileId: a.attachedFileId,
      documentId: a.documentId,
      motionId: a.motionId,
      fileName: a.fileName,
      date: a.date,
      kind: c.kind,
      category: c.category,
      confidence: c.confidence,
      basis: c.basis,
      score: c.weight + (native ? 15 : 0) + recency + sizeHint + (parcelMatch === false ? -60 : 0),
      native,
      context: a.context ? String(a.context).slice(0, 400) : null,
      caseCadastralCodes: codes,
      parcelMatch,
      description: a.description ?? null,
      sizeBytes: a.sizeBytes ?? null,
      reason: c.matched ? `${c.basis} → ${c.kind}` : 'unlabelled native image',
    });
  }
  return out.sort((x, y) => y.score - x.score || (y.date ?? '').localeCompare(x.date ?? ''));
}

export interface VisualSlot {
  role: 'LATEST_RENDER' | 'EARLIEST_RENDER' | 'SUPPORTING';
  candidate: VisualCandidate;
}

/**
 * VISUAL PROPERTY INTELLIGENCE BOUNDS (2026-10-10, superseding the earlier
 * "three or four pictures" cap): the report now has a gallery with tabs
 * (building / apartment / architecture / structure / construction / site),
 * so the worker opens a diverse, bounded set of files and yields at most
 * VISUAL_ASSET_MAX assets per job (a drawing PDF can yield several pages).
 */
export const VISUAL_ASSET_MAX = 24;
/** Files opened for visuals per job. */
export const VISUAL_FILE_MAX = 14;
/** @deprecated name kept for callers; equals VISUAL_FILE_MAX. */
export const VISUAL_HARD_CAP = VISUAL_FILE_MAX;

/** Round-robin order of kinds: one of each before a second of any. */
const KIND_ORDER: VisualKind[] = [
  'RENDER', 'PHOTO', 'CONSTRUCTION_PHOTO', 'SITE_PLAN', 'FLOOR_PLAN', 'UNIT_PLAN', 'ELEVATION', 'FACADE', 'SECTION',
  'MASTER_PLAN', 'STRUCTURAL', 'LOCATION_DIAGRAM', 'OTHER', 'ENGINEERING',
];

/** Same file attached to several cases: one slot is enough. */
const dupKey = (c: VisualCandidate) => `${(c.fileName ?? '').toLowerCase()}|${c.sizeBytes ?? ''}`;

/**
 * Pick the files to open, bounded (≤ VISUAL_FILE_MAX):
 *   1. the latest render (what the project looks like), and the earliest
 *      render when materially older (≥ 90 days) — "original → latest";
 *   2. then round-robin over kinds, best score first, so the gallery covers
 *      photos, site, floors, elevations, sections and structure before a
 *      second file of any kind;
 *   3. files whose case names a different parcel are never opened (they
 *      could only ever be UNRELATED_SUSPECT, hidden from the customer).
 */
export function selectVisualShortlist(ranked: VisualCandidate[], target = VISUAL_FILE_MAX, max = VISUAL_FILE_MAX): VisualSlot[] {
  const cap = Math.min(Math.max(1, target), max, VISUAL_FILE_MAX);
  const pool = ranked.filter((c) => c.parcelMatch !== false);
  const renders = pool.filter((c) => c.kind === 'RENDER');
  const dated = renders.filter((c) => c.date).sort((a, b) => a.date!.localeCompare(b.date!));
  const slots: VisualSlot[] = [];
  const used = new Set<string>();
  const dups = new Set<string>();
  const take = (role: VisualSlot['role'], c: VisualCandidate | undefined) => {
    if (!c || slots.length >= cap || used.has(c.attachedFileId) || dups.has(dupKey(c))) return false;
    slots.push({ role, candidate: c });
    used.add(c.attachedFileId);
    if (c.fileName) dups.add(dupKey(c));
    return true;
  };
  const latest = dated.length ? dated[dated.length - 1] : renders[0];
  if (latest) take('LATEST_RENDER', latest);
  const earliest = dated[0];
  if (
    earliest && latest && earliest.attachedFileId !== latest.attachedFileId && latest.date &&
    Date.parse(latest.date) - Date.parse(earliest.date!) >= 90 * 864e5
  ) take('EARLIEST_RENDER', earliest);
  const buckets = new Map<VisualKind, VisualCandidate[]>();
  for (const c of pool) buckets.set(c.kind, [...(buckets.get(c.kind) ?? []), c]);
  let progressed = true;
  while (slots.length < cap && progressed) {
    progressed = false;
    for (const k of KIND_ORDER) {
      if (slots.length >= cap) break;
      const list = buckets.get(k) ?? [];
      while (list.length) {
        const c = list.shift()!;
        if (take('SUPPORTING', c)) {
          progressed = true;
          break;
        }
      }
    }
  }
  return slots;
}

/** How many assets one opened file may yield. */
export function assetsPerFile(c: VisualCandidate): { pages: number; images: number } {
  if (c.native) return { pages: 0, images: 1 };
  if (c.kind === 'FLOOR_PLAN' || c.kind === 'UNIT_PLAN') return { pages: 4, images: 2 };
  if (DRAWING_KINDS.has(c.kind)) return { pages: 3, images: 2 };
  if (c.kind === 'PHOTO' || c.kind === 'CONSTRUCTION_PHOTO') return { pages: 2, images: 4 };
  if (c.kind === 'RENDER') return { pages: 2, images: 3 };
  return { pages: 1, images: 2 };
}

export interface EmbeddedImage {
  bytes: Uint8Array;
  width: number | null;
  height: number | null;
  /** Ordinal of the image stream within the file, for provenance. */
  index: number;
}

/**
 * Embedded JPEG (DCTDecode) image streams inside a PDF, read straight from
 * the file bytes. Renders and photographs are almost always stored this way;
 * vector drawings are not, and are honestly left alone.
 */
export function extractImagesFromPdf(pdf: Uint8Array, opts: { minWidth?: number; minHeight?: number; maxImages?: number } = {}): EmbeddedImage[] {
  const buf = bytesToBuffer(pdf);
  const text = buf.toString('latin1');
  const out: EmbeddedImage[] = [];
  const minW = opts.minWidth ?? 500;
  const minH = opts.minHeight ?? 350;
  let index = 0;
  const re = /\/Filter\s*(?:\[\s*)?\/DCTDecode/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    index++;
    const dictStart = text.lastIndexOf('<<', m.index);
    const streamKw = text.indexOf('stream', m.index);
    if (dictStart < 0 || streamKw < 0 || streamKw - m.index > 4000) continue;
    const dict = text.slice(dictStart, streamKw);
    if (!/\/Subtype\s*\/Image/.test(dict)) continue;
    // CMYK JPEGs (often Adobe-inverted) display wrongly as a bare .jpg; the
    // page renderer handles them, so they are not extracted raw.
    if (/\/DeviceCMYK|\/Decode\s*\[\s*1\s+0/.test(dict)) continue;
    const width = Number(/\/Width\s+(\d+)/.exec(dict)?.[1] ?? NaN);
    const height = Number(/\/Height\s+(\d+)/.exec(dict)?.[1] ?? NaN);
    let dataStart = streamKw + 'stream'.length;
    if (text[dataStart] === '\r') dataStart++;
    if (text[dataStart] === '\n') dataStart++;
    const lenMatch = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    let dataEnd = lenMatch ? dataStart + Number(lenMatch[1]) : -1;
    if (dataEnd <= dataStart || text.slice(dataEnd, dataEnd + 12).indexOf('endstream') < 0) {
      dataEnd = text.indexOf('endstream', dataStart);
      if (dataEnd < 0) continue;
      while (dataEnd > dataStart && (text[dataEnd - 1] === '\n' || text[dataEnd - 1] === '\r')) dataEnd--;
    }
    const bytes = new Uint8Array(buf.subarray(dataStart, dataEnd));
    if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) continue;
    if (Number.isFinite(width) && Number.isFinite(height) && (width < minW || height < minH)) continue;
    out.push({ bytes, width: Number.isFinite(width) ? width : null, height: Number.isFinite(height) ? height : null, index });
    re.lastIndex = dataEnd;
    if (out.length >= (opts.maxImages ?? 12)) break;
  }
  return out.sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0));
}

/** Pixel size of a JPEG or PNG from its header, without decoding it. */
export function imageSize(bytes: Uint8Array): { width: number; height: number; mime: string } | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const u32 = (o: number) => ((bytes[o] << 24) >>> 0) + (bytes[o + 1] << 16) + (bytes[o + 2] << 8) + bytes[o + 3];
    return { width: u32(16), height: u32(20), mime: 'image/png' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      const len = (bytes[i + 2] << 8) + bytes[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (bytes[i + 5] << 8) + bytes[i + 6], width: (bytes[i + 7] << 8) + bytes[i + 8], mime: 'image/jpeg' };
      }
      i += 2 + len;
    }
    return null;
  }
  return null;
}
