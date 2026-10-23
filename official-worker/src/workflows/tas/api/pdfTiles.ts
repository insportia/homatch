// pdfTiles.ts — a PDF's own pictures, with pictures stored as TILES found.
//
// ROOT CAUSE (2026-10-22, job 61c1c38c, TAS document 1107725): some PDF
// writers store one photomontage as a stack of horizontal JPEG strips drawn
// edge to edge on the page. "მონტაჟი+ განთავსება+ კონსტრუქცია.pdf"
// (attachedFileId 5108620) draws page 3 as eight 5000×400 / 5000×200 JPEGs,
// each placed by its own `cm` exactly under the previous one. The raw-stream
// extractor (visuals.ts extractImagesFromPdf) saved every slice as a picture;
// all 24 gallery assets of that job were 13:1 strips that visualQuality.ts
// rightly rejected, so the customer saw an empty gallery.
//
// What this module does, with no new dependency (zlib + the PDF's own
// structure):
//   1. reads the object table (direct objects and FlateDecode object
//      streams), the page tree and each page's content stream, and records
//      where every image XObject is drawn (its CTM; Form XObjects followed
//      to a bounded depth);
//   2. finds TILE GROUPS: ≥ 2 strip-shaped images on one page, axis-aligned,
//      sharing the same column (or row), each starting where the previous
//      one ends;
//   3. returns the remaining embedded JPEGs exactly as before (same skip
//      rules as extractImagesFromPdf) plus each tile group with the pixel
//      layout to assemble it in page order. The caller assembles a group
//      (pdfRender.ts stitch, else a render of that page) or drops it.
//
// A lone strip (long side > STRIP_MAX_ASPECT × short side) is a banner or an
// unplaceable slice: rejected here, as visualQuality.ts would reject it.
// Pure apart from zlib/crypto: no network, no clock.

import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { bytesToBuffer } from './tasModel.js';
import { imageSize } from './visuals.js';

/** A tile is strip-shaped: long side ≥ this × short side (pixels and as drawn). */
export const TILE_MIN_ASPECT = 3;
/** Fewest tiles that make a group. */
export const TILE_MIN_COUNT = 2;
/** Edges of tiles in one column/row may differ by this fraction of the tile's long side. */
export const TILE_ALIGN_TOLERANCE = 0.01;
/** Largest gap / overlap between consecutive tiles, in PDF points (or 2 % of the tile's short side, if larger). */
export const TILE_GAP_TOLERANCE_PT = 1.5;
/** A single image beyond this aspect is a banner / slice (= visualQuality.ts STRIP verdict). */
export const STRIP_MAX_ASPECT = 6;
/** Bounds of an assembled picture (pixels). */
export const STITCH_MAX_EDGE = 6000;
export const STITCH_MAX_PIXELS = 36_000_000;
/** Tile groups assembled per file. */
export const TILE_GROUP_MAX = 4;

export interface PdfRect { x: number; y: number; w: number; h: number }

export interface PdfTile {
  /** PDF object number of the image XObject. */
  objNum: number;
  /** Raw JPEG stream for a plain RGB / grey DCT image; null otherwise. */
  bytes: Uint8Array | null;
  /** sha256 of the raw image stream — the id a slice would have had as an asset. */
  sha256: string;
  width: number;
  height: number;
  /** Where it is drawn on the page (PDF points, y up). */
  rect: PdfRect;
}

export interface TileGroup {
  /** 1-based page. */
  page: number;
  /** VERTICAL: horizontal strips stacked top to bottom; HORIZONTAL: slices left to right. */
  axis: 'VERTICAL' | 'HORIZONTAL';
  /** Reading order (top → bottom, left → right). */
  tiles: PdfTile[];
  /** The assembled canvas: each tile's box in output pixels, page geometry preserved. */
  layout: { width: number; height: number; boxes: PdfRect[] };
  /** Every tile is a plain JPEG, so the bytes can be stitched without the page renderer. */
  stitchable: boolean;
}

export interface PdfSingleImage {
  bytes: Uint8Array;
  width: number | null;
  height: number | null;
  /** Ordinal of the image among the file's JPEG image streams (provenance). */
  index: number;
  objNum: number;
  /** 1-based page it is drawn on, when the page tree could be read. */
  page: number | null;
}

export interface PdfPictureScan {
  singles: PdfSingleImage[];
  groups: TileGroup[];
  /** Page count, or null when the page tree could not be read (geometry unknown). */
  pages: number | null;
  rejected: {
    /** Lone strips / banners (aspect > STRIP_MAX_ASPECT). */
    strips: number;
    /** JPEG streams that are not complete images (no SOI/EOI, unreadable header). */
    corrupt: number;
    /** Images merged into tile groups. */
    tiles: number;
  };
}

// ─────────────────────────── minimal PDF object reader ───────────────────────────

type Ref = { ref: number };
type Name = { name: string };
type PdfValue = number | boolean | null | string | Ref | Name | PdfValue[] | PdfDict;
type PdfDict = Map<string, PdfValue>;

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = '()<>[]{}/%';

const isRef = (v: unknown): v is Ref => !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as Ref).ref === 'number' && Object.keys(v as object).length === 1;
const isName = (v: unknown): v is Name => !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as Name).name === 'string' && Object.keys(v as object).length === 1;
const isDict = (v: unknown): v is PdfDict => v instanceof Map;
const numOf = (v: PdfValue | undefined): number | null => (typeof v === "number" ? v : null);
const nameOf = (v: PdfValue | undefined): string | null => (isName(v) ? v.name : null);

function skipWs(s: string, i: number): number {
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (WS.has(c)) i++;
    else if (s[i] === '%') { while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++; }
    else break;
  }
  return i;
}

function readToken(s: string, i: number): [string, number] {
  let j = i;
  while (j < s.length && !WS.has(s.charCodeAt(j)) && !DELIM.includes(s[j])) j++;
  return [s.slice(i, j), j];
}

/** One PDF value at `i` (strings are returned as their raw text; only structure matters here). */
function parseValue(s: string, i: number, depth = 0): [PdfValue | undefined, number] {
  i = skipWs(s, i);
  if (i >= s.length || depth > 64) return [undefined, i];
  const c = s[i];
  if (c === '<' && s[i + 1] === '<') {
    const d: PdfDict = new Map();
    i += 2;
    for (;;) {
      i = skipWs(s, i);
      if (i >= s.length) return [d, i];
      if (s[i] === '>' && s[i + 1] === '>') return [d, i + 2];
      if (s[i] !== '/') { i++; continue; }
      const [key, k] = readToken(s, i + 1);
      const [v, n] = parseValue(s, k, depth + 1);
      if (v !== undefined) d.set(key, v);
      if (n <= k) return [d, n];
      i = n;
    }
  }
  if (c === '<') {
    const end = s.indexOf('>', i);
    return [s.slice(i + 1, end < 0 ? s.length : end), end < 0 ? s.length : end + 1];
  }
  if (c === '[') {
    const a: PdfValue[] = [];
    i++;
    for (;;) {
      i = skipWs(s, i);
      if (i >= s.length) return [a, i];
      if (s[i] === ']') return [a, i + 1];
      const [v, n] = parseValue(s, i, depth + 1);
      if (v !== undefined) a.push(v);
      if (n <= i) return [a, i + 1];
      i = n;
    }
  }
  if (c === '(') {
    let level = 0;
    let j = i;
    for (; j < s.length; j++) {
      if (s[j] === '\\') { j++; continue; }
      if (s[j] === '(') level++;
      else if (s[j] === ')' && --level === 0) break;
    }
    return [s.slice(i + 1, j), j + 1];
  }
  if (c === '/') {
    const [n, j] = readToken(s, i + 1);
    return [{ name: n }, j];
  }
  const [tok, j] = readToken(s, i);
  if (!tok) return [undefined, i + 1];
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) {
    // `12 0 R` is a reference.
    const m = /^\s+(\d+)\s+R(?![^\s\]>/])/.exec(s.slice(j, j + 24));
    if (/^\d+$/.test(tok) && m) return [{ ref: Number(tok) }, j + m[0].length];
    return [Number(tok), j];
  }
  if (tok === 'true' || tok === 'false') return [tok === 'true', j];
  if (tok === 'null') return [null, j];
  return [{ name: `#kw:${tok}` }, j];
}

interface PdfObject { num: number; value: PdfValue | undefined; dataStart: number | null; dataEnd: number | null }

class PdfFile {
  readonly buf: Buffer;
  readonly text: string;
  readonly objs = new Map<number, PdfObject>();

  constructor(pdf: Uint8Array) {
    this.buf = bytesToBuffer(pdf);
    this.text = this.buf.toString('latin1');
    this.readObjects();
    this.readObjectStreams();
  }

  private readObjects(): void {
    const t = this.text;
    const re = /(?<![0-9])(\d+)\s+(\d+)\s+obj\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      const num = Number(m[1]);
      const [value, after] = parseValue(t, m.index + m[0].length);
      let dataStart: number | null = null;
      let dataEnd: number | null = null;
      const k = skipWs(t, after);
      if (isDict(value) && t.startsWith('stream', k)) {
        dataStart = k + 6;
        if (t[dataStart] === '\r') dataStart++;
        if (t[dataStart] === '\n') dataStart++;
        const len = numOf(value.get('Length'));
        if (len !== null && len >= 0 && t.slice(dataStart + len, dataStart + len + 12).includes('endstream')) dataEnd = dataStart + len;
        else {
          const e = t.indexOf('endstream', dataStart);
          if (e < 0) continue;
          dataEnd = e;
          while (dataEnd > dataStart && (t[dataEnd - 1] === '\n' || t[dataEnd - 1] === '\r')) dataEnd--;
        }
        re.lastIndex = dataEnd as number;
      }
      // Incremental updates: a later definition replaces an earlier one.
      this.objs.set(num, { num, value, dataStart, dataEnd });
    }
  }

  private readObjectStreams(): void {
    for (const o of [...this.objs.values()]) {
      const d = o.value;
      if (!isDict(d) || nameOf(d.get('Type')) !== 'ObjStm') continue;
      const data = this.streamData(o.num);
      if (!data) continue;
      const s = data.toString('latin1');
      const n = numOf(d.get('N')) ?? 0;
      const first = numOf(d.get('First')) ?? 0;
      const head = s.slice(0, first).trim().split(/\s+/).map(Number);
      for (let i = 0; i < n && 2 * i + 1 < head.length; i++) {
        const num = head[2 * i];
        if (this.objs.has(num)) continue;
        const [value] = parseValue(s, first + head[2 * i + 1]);
        this.objs.set(num, { num, value, dataStart: null, dataEnd: null });
      }
    }
  }

  get(v: PdfValue | undefined, depth = 0): PdfValue | undefined {
    if (isRef(v) && depth < 16) return this.get(this.objs.get(v.ref)?.value, depth + 1);
    return v;
  }

  raw(num: number): Buffer | null {
    const o = this.objs.get(num);
    if (!o || o.dataStart === null || o.dataEnd === null) return null;
    return this.buf.subarray(o.dataStart, o.dataEnd);
  }

  /** Decoded stream (no filter or FlateDecode); null for anything else. */
  streamData(num: number): Buffer | null {
    const o = this.objs.get(num);
    const raw = this.raw(num);
    if (!o || !raw || !isDict(o.value)) return null;
    const f = this.get(o.value.get('Filter'));
    const filters = (Array.isArray(f) ? f : f === undefined ? [] : [f]).map((x) => (isName(x) ? x.name : ''));
    if (!filters.length) return raw;
    if (filters.length !== 1 || (filters[0] !== 'FlateDecode' && filters[0] !== 'Fl')) return null;
    try {
      return inflateSync(new Uint8Array(raw), { finishFlush: 2 /* Z_SYNC_FLUSH: tolerate a truncated tail */ });
    } catch {
      return null;
    }
  }
}

// ─────────────────────────── page geometry ───────────────────────────

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
/** m × n (PDF row-vector convention): apply m, then n. */
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];

interface Placement { objNum: number; page: number; ctm: Matrix }

function contentOf(pdf: PdfFile, contents: PdfValue | undefined): string | null {
  const list = Array.isArray(contents) ? contents : contents === undefined ? [] : [contents];
  const parts: string[] = [];
  for (const c of list) {
    if (!isRef(c)) return null;
    const d = pdf.streamData(c.ref);
    if (!d) return null;
    parts.push(d.toString('latin1'));
  }
  return parts.join('\n');
}

/** Image XObjects drawn by a content stream, with their CTM (Form XObjects followed, bounded). */
function walkContent(pdf: PdfFile, content: string, resources: PdfDict | null, base: Matrix, page: number, out: Placement[], depth: number): void {
  const xobjects = resources ? pdf.get(resources.get('XObject')) : undefined;
  const stack: Matrix[] = [];
  let ctm = base;
  const operands: PdfValue[] = [];
  let i = 0;
  const s = content;
  while (i < s.length) {
    i = skipWs(s, i);
    if (i >= s.length) break;
    const c = s[i];
    if (c === '/' || c === '[' || c === '(' || c === '<' || /[0-9.+-]/.test(c)) {
      const [v, n] = parseValue(s, i);
      if (v !== undefined) operands.push(v);
      i = n > i ? n : i + 1;
      continue;
    }
    if (DELIM.includes(c)) { i++; continue; }
    const [op, n] = readToken(s, i);
    i = n > i ? n : i + 1;
    if (op === 'q') stack.push(ctm);
    else if (op === 'Q') ctm = stack.pop() ?? base;
    else if (op === 'cm') {
      const m = operands.slice(-6);
      if (m.length === 6 && m.every((x) => typeof x === 'number')) ctm = mul(m as Matrix, ctm);
    } else if (op === 'Do') {
      const name = operands[operands.length - 1];
      const ref = isName(name) && isDict(xobjects) ? xobjects.get(name.name) : undefined;
      const x = isRef(ref) ? pdf.objs.get(ref.ref) : undefined;
      const d = x && isDict(x.value) ? x.value : null;
      const subtype = d ? nameOf(d.get('Subtype')) : null;
      if (x && subtype === 'Image') out.push({ objNum: x.num, page, ctm });
      else if (x && d && subtype === 'Form' && depth < 3) {
        const body = pdf.streamData(x.num);
        const fm = pdf.get(d.get('Matrix'));
        const formM: Matrix = Array.isArray(fm) && fm.length === 6 && fm.every((v) => typeof v === 'number') ? (fm as Matrix) : IDENTITY;
        const res = pdf.get(d.get('Resources'));
        if (body) walkContent(pdf, body.toString('latin1'), isDict(res) ? res : resources, mul(formM, ctm), page, out, depth + 1);
      }
    } else if (op === 'BI') {
      // Inline image: skip its binary data (ID … EI).
      const id = s.indexOf('ID', i);
      const ei = id < 0 ? -1 : s.slice(id + 2).search(/\sEI(?=[\s]|$)/);
      i = ei < 0 ? s.length : id + 2 + ei + 3;
    }
    operands.length = 0;
  }
}

/** Every page's image placements; null when the page tree cannot be read. */
function readPlacements(pdf: PdfFile): { pages: number; placements: Placement[] } | null {
  let catalog: PdfDict | null = null;
  for (const o of pdf.objs.values()) if (isDict(o.value) && nameOf(o.value.get('Type')) === 'Catalog') catalog = o.value;
  if (!catalog) return null;
  const placements: Placement[] = [];
  let pages = 0;
  const seen = new Set<number>();
  const visit = (v: PdfValue | undefined, inherited: PdfDict | null, depth: number): void => {
    if (!isRef(v) || seen.has(v.ref) || depth > 32 || pages >= 2000) return;
    seen.add(v.ref);
    const node = pdf.get(v);
    if (!isDict(node)) return;
    const res0 = pdf.get(node.get('Resources'));
    const res = isDict(res0) ? res0 : inherited;
    const type = nameOf(node.get('Type'));
    const kids = pdf.get(node.get('Kids'));
    if (type === 'Pages' || (type === null && Array.isArray(kids))) {
      for (const k of Array.isArray(kids) ? kids : []) visit(k, res, depth + 1);
      return;
    }
    pages++;
    // /Contents is a stream, an array of streams, or a reference to such an array.
    const target = pdf.get(node.get('Contents'));
    const content = contentOf(pdf, Array.isArray(target) ? target : node.get('Contents'));
    if (content !== null) walkContent(pdf, content, res, IDENTITY, pages, placements, 0);
  };
  visit(catalog.get('Pages'), null, 0);
  return pages ? { pages, placements } : null;
}

// ─────────────────────────── image streams ───────────────────────────

interface ImageInfo { objNum: number; width: number; height: number; dct: boolean; plainJpeg: boolean; raw: Uint8Array }

function imageInfo(pdf: PdfFile, num: number): ImageInfo | null {
  const o = pdf.objs.get(num);
  const raw = pdf.raw(num);
  if (!o || !raw || !isDict(o.value)) return null;
  const d = o.value;
  const width = pdf.get(d.get('Width'));
  const height = pdf.get(d.get('Height'));
  if (typeof width !== 'number' || typeof height !== 'number' || width < 1 || height < 1) return null;
  const f = pdf.get(d.get('Filter'));
  const filters = (Array.isArray(f) ? f : f === undefined ? [] : [f]).map((x) => (isName(x) ? x.name : ''));
  const dct = filters.length === 1 && (filters[0] === 'DCTDecode' || filters[0] === 'DCT');
  const cs = pdf.get(d.get('ColorSpace'));
  const csName = isName(cs) ? cs.name : Array.isArray(cs) ? (isName(cs[0]) ? cs[0].name : '') : '';
  const decode = pdf.get(d.get('Decode'));
  // Same rule as extractImagesFromPdf: CMYK / inverted JPEGs display wrongly as a bare .jpg.
  const inverted = Array.isArray(decode) && decode[0] === 1 && decode[1] === 0;
  const plainJpeg = dct && csName !== 'DeviceCMYK' && !inverted && raw[0] === 0xff && raw[1] === 0xd8;
  return { objNum: num, width, height, dct, plainJpeg, raw: new Uint8Array(raw.buffer, raw.byteOffset, raw.length) };
}

/** A complete JPEG: SOI, a readable frame header, and EOI at the end of the stream. */
export function isCompleteJpeg(b: Uint8Array): boolean {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return false;
  if (!imageSize(b)) return false;
  for (let i = b.length - 2; i >= Math.max(2, b.length - 16); i--) if (b[i] === 0xff && b[i + 1] === 0xd9) return true;
  return false;
}

const sha = (b: Uint8Array): string => createHash('sha256').update(bytesToBuffer(b)).digest('hex');
const aspect = (w: number, h: number): number => Math.max(w, h) / Math.max(1e-9, Math.min(w, h));

// ─────────────────────────── tile groups ───────────────────────────

interface Placed { info: ImageInfo; page: number; rect: PdfRect }

function rectOf(m: Matrix): PdfRect | null {
  // Axis-aligned, unrotated, not mirrored: anything else is never stitched.
  if (Math.abs(m[1]) > 1e-6 || Math.abs(m[2]) > 1e-6 || m[0] <= 0 || m[3] <= 0) return null;
  return { x: m[4], y: m[5], w: m[0], h: m[3] };
}

/** Runs of contiguous strips along one axis (VERTICAL: same column, top → bottom). */
function runs(items: Placed[], axis: 'VERTICAL' | 'HORIZONTAL'): Placed[][] {
  const V = axis === 'VERTICAL';
  // along = the stacking axis; across = the shared column / row.
  const along0 = (r: PdfRect) => (V ? -(r.y + r.h) : r.x); // top edge (descending y) / left edge
  const along1 = (r: PdfRect) => (V ? -r.y : r.x + r.w);
  const cross0 = (r: PdfRect) => (V ? r.x : r.y);
  const crossLen = (r: PdfRect) => (V ? r.w : r.h);
  const sorted = [...items].sort((a, b) => cross0(a.rect) - cross0(b.rect) || along0(a.rect) - along0(b.rect));
  const out: Placed[][] = [];
  const used = new Set<Placed>();
  for (const first of sorted) {
    if (used.has(first)) continue;
    const run = [first];
    let last = first;
    for (;;) {
      const tolX = TILE_ALIGN_TOLERANCE * crossLen(last.rect);
      const tolGap = Math.max(TILE_GAP_TOLERANCE_PT, 0.02 * Math.min(last.rect.w, last.rect.h));
      const next = sorted.find((p) =>
        !used.has(p) && !run.includes(p) &&
        Math.abs(cross0(p.rect) - cross0(last.rect)) <= tolX &&
        Math.abs(crossLen(p.rect) - crossLen(last.rect)) <= tolX &&
        Math.abs(along0(p.rect) - along1(last.rect)) <= tolGap);
      if (!next) break;
      run.push(next);
      last = next;
    }
    if (run.length >= TILE_MIN_COUNT) {
      for (const p of run) used.add(p);
      out.push(run);
    }
  }
  return out;
}

/** Output pixel layout: page geometry, at the resolution of the sharpest tile, bounded. */
function layoutOf(run: Placed[], axis: 'VERTICAL' | 'HORIZONTAL'): TileGroup['layout'] {
  const V = axis === 'VERTICAL';
  // Pixels per point along the shared side, from the tile that has the most.
  const ppp = Math.max(...run.map((p) => (V ? p.info.width / p.rect.w : p.info.height / p.rect.h)));
  const x0 = Math.min(...run.map((p) => p.rect.x));
  const top = Math.max(...run.map((p) => p.rect.y + p.rect.h));
  const x1 = Math.max(...run.map((p) => p.rect.x + p.rect.w));
  const bottom = Math.min(...run.map((p) => p.rect.y));
  let scale = ppp;
  const wPt = x1 - x0;
  const hPt = top - bottom;
  scale = Math.min(scale, STITCH_MAX_EDGE / Math.max(wPt, hPt), Math.sqrt(STITCH_MAX_PIXELS / (wPt * hPt)));
  const width = Math.max(1, Math.round(wPt * scale));
  const height = Math.max(1, Math.round(hPt * scale));
  const boxes = run.map((p) => {
    const x = Math.round((p.rect.x - x0) * scale);
    const y = Math.round((top - (p.rect.y + p.rect.h)) * scale);
    const x2 = Math.round((p.rect.x + p.rect.w - x0) * scale);
    const y2 = Math.round((top - p.rect.y) * scale);
    return { x, y, w: Math.max(1, x2 - x), h: Math.max(1, y2 - y) };
  });
  return { width, height, boxes };
}

/**
 * The pictures of a PDF: plain embedded JPEGs (same selection as
 * extractImagesFromPdf: file order, size floor, first `maxImages`, largest
 * first) MINUS tiles and lone strips, plus the tile groups to assemble.
 */
export function scanPdfPictures(pdf: Uint8Array, opts: { minWidth?: number; minHeight?: number; maxImages?: number } = {}): PdfPictureScan {
  const minW = opts.minWidth ?? 500;
  const minH = opts.minHeight ?? 350;
  const maxImages = opts.maxImages ?? 12;
  const rejected = { strips: 0, corrupt: 0, tiles: 0 };
  let file: PdfFile;
  try {
    file = new PdfFile(pdf);
  } catch {
    return { singles: [], groups: [], pages: null, rejected };
  }
  let geo: ReturnType<typeof readPlacements> = null;
  try {
    geo = readPlacements(file);
  } catch {
    geo = null;
  }
  const infoCache = new Map<number, ImageInfo | null>();
  const info = (n: number) => {
    if (!infoCache.has(n)) infoCache.set(n, imageInfo(file, n));
    return infoCache.get(n)!;
  };

  // Tile groups, page by page.
  const groups: TileGroup[] = [];
  const tileObjs = new Set<number>();
  const pageOf = new Map<number, number>();
  if (geo) {
    const byPage = new Map<number, Placed[]>();
    for (const p of geo.placements) {
      if (!pageOf.has(p.objNum)) pageOf.set(p.objNum, p.page);
      const i = info(p.objNum);
      const rect = rectOf(p.ctm);
      if (!i || !rect) continue;
      if (aspect(i.width, i.height) < TILE_MIN_ASPECT || aspect(rect.w, rect.h) < TILE_MIN_ASPECT) continue;
      const list = byPage.get(p.page) ?? [];
      list.push({ info: i, page: p.page, rect });
      byPage.set(p.page, list);
    }
    for (const [page, list] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
      const horizontalStrips = list.filter((p) => p.rect.w > p.rect.h && p.info.width > p.info.height);
      const verticalSlices = list.filter((p) => p.rect.h > p.rect.w && p.info.height > p.info.width);
      for (const [axis, items] of [['VERTICAL', horizontalStrips], ['HORIZONTAL', verticalSlices]] as const) {
        for (const run of runs(items, axis)) {
          // The same image drawn twice in one run is a pattern, not a picture.
          if (new Set(run.map((p) => p.info.objNum)).size !== run.length) continue;
          groups.push({
            page,
            axis,
            tiles: run.map((p) => ({
              objNum: p.info.objNum, bytes: p.info.plainJpeg ? new Uint8Array(p.info.raw) : null, sha256: sha(p.info.raw),
              width: p.info.width, height: p.info.height, rect: p.rect,
            })),
            layout: layoutOf(run, axis),
            stitchable: run.every((p) => p.info.plainJpeg && isCompleteJpeg(p.info.raw)),
          });
          for (const p of run) tileObjs.add(p.info.objNum);
        }
      }
    }
  }

  // Plain embedded JPEGs in file order (as extractImagesFromPdf reads them).
  const singles: PdfSingleImage[] = [];
  let index = 0;
  const ordered = [...file.objs.values()].filter((o) => o.dataStart !== null).sort((a, b) => a.dataStart! - b.dataStart!);
  for (const o of ordered) {
    const d = o.value;
    if (!isDict(d) || nameOf(d.get('Subtype')) !== 'Image') continue;
    const i = info(o.num);
    if (!i || !i.dct) continue;
    index++;
    if (!i.plainJpeg) continue;
    if (tileObjs.has(o.num)) {
      rejected.tiles++;
      continue;
    }
    if (i.width < minW || i.height < minH) continue;
    if (aspect(i.width, i.height) > STRIP_MAX_ASPECT) {
      rejected.strips++;
      continue;
    }
    if (!isCompleteJpeg(i.raw)) {
      rejected.corrupt++;
      continue;
    }
    if (singles.length < maxImages) singles.push({ bytes: new Uint8Array(i.raw), width: i.width, height: i.height, index, objNum: o.num, page: pageOf.get(o.num) ?? null });
  }
  singles.sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0));
  return { singles, groups, pages: geo?.pages ?? null, rejected };
}
