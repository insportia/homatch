// visuals.ts — selective OFFICIAL visual evidence from TAS attachments.
//
// Two stages, cheapest first:
//   1. rankVisualCandidates(): metadata only (file name, description, type,
//      date, motion relationship). Nothing is downloaded to decide what is
//      worth looking at.
//   2. extractImagesFromPdf() / native images: only the shortlisted
//      candidates are opened, and only their embedded raster images are read
//      — no rasteriser, no DWG/PLA rendering on the critical path.
//
// STRICT SOURCE SEPARATION: everything here comes from TAS official
// attachments. Marketplace photos never enter this module.

import { bytesToBuffer } from './tasModel.js';
import type { TasAttachment } from './tasModel.js';

export type VisualKind =
  | 'RENDER'
  | 'FACADE'
  | 'SITE_PLAN'
  | 'FLOOR_PLAN'
  | 'STRUCTURAL'
  | 'CONSTRUCTION_PHOTO'
  | 'LANDSCAPE'
  | 'OTHER_DRAWING';

export interface VisualCandidate {
  attachedFileId: string;
  documentId: string;
  motionId: string | null;
  fileName: string | null;
  date: string | null;
  kind: VisualKind;
  score: number;
  native: boolean;
  reason: string;
}

const KIND_RULES: Array<{ kind: VisualKind; re: RegExp; weight: number }> = [
  { kind: 'RENDER', re: /(render|რენდერ|ვიზუალიზაც|визуализ|3d|perspective|პერსპექტივ|ხედ(ი|ებ)|aerial|bird)/i, weight: 100 },
  { kind: 'FACADE', re: /(facade|façade|ფასად|фасад|elevation|ჭრილ)/i, weight: 70 },
  { kind: 'SITE_PLAN', re: /(site.?plan|master.?plan|გენ\.?\s?გეგმ|გენგეგმ|სიტუაციურ|генплан|ситуацион|ტოპო|topo)/i, weight: 65 },
  { kind: 'STRUCTURAL', re: /(structur|კონსტრუქ|საძირკვ|ფუნდამენტ|foundation|фундамент|армир|არმატურ|კარკას|ხიმინჯ|pile|seismic|სეისმ)/i, weight: 55 },
  { kind: 'CONSTRUCTION_PHOTO', re: /(photo|ფოტო|фото|ფოტოფიქსაც|monitor|მონიტორინგ|progress)/i, weight: 50 },
  { kind: 'LANDSCAPE', re: /(landscape|ლანდშაფტ|გამწვანებ|озелен)/i, weight: 40 },
  { kind: 'FLOOR_PLAN', re: /(floor.?plan|სართულის გეგმ|გეგმ|plan|планировк|план)/i, weight: 35 },
];

/** Paperwork that is never a meaningful visual, whatever its format. */
const EXCLUDE = /(ხელშეკრულ|contract|договор|ამონაწერ|extract|выписк|ქვითარ|invoice|receipt|გადახდ|payment|მინდობილ|power.?of.?attorney|доверенн|პირადობ|passport|id.?card|განცხადებ|application|заявлен|ბრძანებ|decree|სერტიფიკ|certificate|ლიცენზ|license|ცნობ)/i;

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);

export function visualKindOf(text: string): { kind: VisualKind; weight: number } | null {
  if (!text || EXCLUDE.test(text)) return null;
  for (const r of KIND_RULES) if (r.re.test(text)) return { kind: r.kind, weight: r.weight };
  return null;
}

export function rankVisualCandidates(
  attachments: Array<TasAttachment & { documentId: string }>,
): VisualCandidate[] {
  const out: VisualCandidate[] = [];
  for (const a of attachments) {
    const ext = a.extension ?? '';
    const native = IMAGE_EXT.has(ext);
    if (!native && ext !== 'pdf') continue; // DWG/PLA/RAR never on the critical path
    const text = `${a.fileName ?? ''} ${a.description ?? ''}`;
    const k = visualKindOf(text);
    // An unlabelled native image is still a plausible project picture; an
    // unlabelled PDF is far more often paperwork.
    const hit = k ?? (native ? { kind: 'OTHER_DRAWING' as VisualKind, weight: 20 } : null);
    if (!hit) continue;
    const recency = a.date ? Math.min(10, Math.max(0, (Date.parse(a.date) - Date.parse('2005-01-01')) / (365 * 864e5))) : 0;
    const size = a.sizeBytes ?? 0;
    const sizeHint = size > 0 && size < 25_000 ? -30 : 0; // icons and stamps
    out.push({
      attachedFileId: a.attachedFileId,
      documentId: a.documentId,
      motionId: a.motionId,
      fileName: a.fileName,
      date: a.date,
      kind: hit.kind,
      score: hit.weight + (native ? 15 : 0) + recency + sizeHint,
      native,
      reason: k ? `name/description matches ${hit.kind}` : 'unlabelled native image',
    });
  }
  return out.sort((x, y) => y.score - x.score || (y.date ?? '').localeCompare(x.date ?? ''));
}

export interface VisualSlot {
  role: 'LATEST_RENDER' | 'EARLIEST_RENDER' | 'SUPPORTING';
  candidate: VisualCandidate;
}

/** What each visual explains to a buyer. One of each, in this order. */
const ARCHITECTURE_KINDS: VisualKind[] = ['FACADE', 'SITE_PLAN', 'LANDSCAPE', 'FLOOR_PLAN'];
const STRUCTURE_KINDS: VisualKind[] = ['STRUCTURAL', 'CONSTRUCTION_PHOTO'];

/** Owner, 2026-10-10: three or four pictures in total are enough. */
export const VISUAL_HARD_CAP = 4;

/**
 * Pick the shortlist to actually open — never more than four (owner,
 * 2026-10-10: "3-4 photos are enough for a buyer to see the project and its
 * structure"). The set explains different things, in this order:
 *   1. the latest render (what the project looks like);
 *   2. one architectural drawing (facade, site plan, landscape, floor plan);
 *   3. one structural picture (structure drawing or construction photo);
 *   4. the earliest render, when it is materially older (≥ 90 days) and a
 *      different file — an "Original → Latest" comparison — else any other
 *      kind not yet shown.
 */
export function selectVisualShortlist(ranked: VisualCandidate[], target = 4, max = VISUAL_HARD_CAP): VisualSlot[] {
  const cap = Math.min(Math.max(1, target), max, VISUAL_HARD_CAP);
  const renders = ranked.filter((c) => c.kind === 'RENDER');
  const dated = renders.filter((c) => c.date).sort((a, b) => a.date!.localeCompare(b.date!));
  const slots: VisualSlot[] = [];
  const used = new Set<string>();
  const kindsTaken = new Set<VisualKind>();
  const take = (role: VisualSlot['role'], c: VisualCandidate | undefined) => {
    if (!c || slots.length >= cap || used.has(c.attachedFileId)) return false;
    slots.push({ role, candidate: c });
    used.add(c.attachedFileId);
    kindsTaken.add(c.kind);
    return true;
  };
  const latest = dated.length ? dated[dated.length - 1] : renders[0] ?? ranked.find((c) => c.kind === 'FACADE');
  take(latest?.kind === 'RENDER' ? 'LATEST_RENDER' : 'SUPPORTING', latest);
  for (const group of [ARCHITECTURE_KINDS, STRUCTURE_KINDS]) {
    const best = ranked.find((c) => group.includes(c.kind) && !used.has(c.attachedFileId) && !kindsTaken.has(c.kind));
    take('SUPPORTING', best);
  }
  const earliest = dated[0];
  if (
    earliest && latest && earliest.attachedFileId !== latest.attachedFileId && latest.date &&
    Date.parse(latest.date) - Date.parse(earliest.date!) >= 90 * 864e5
  ) take('EARLIEST_RENDER', earliest);
  for (const c of ranked) {
    if (slots.length >= cap) break;
    if (!kindsTaken.has(c.kind)) take('SUPPORTING', c);
  }
  return slots;
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
