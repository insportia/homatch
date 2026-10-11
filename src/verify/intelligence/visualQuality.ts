// visualQuality.ts — a deterministic gate for blank / unusable official images.
//
// Some TAS PDFs carry raster layers that are not the picture: a grey soft
// mask behind a vector facade, a 600 px placeholder, a scanner's empty page.
// Shown to a buyer, they read as "the gallery is broken". Nothing here looks
// at pixels; the gate uses what every stored record already has (pixel size,
// byte size, kind, extraction), because a JPEG of a near-uniform image is
// tiny for its pixel count while a real photograph or render is not.
//
// Calibrated on the real Krtsanisi St 6 set (job 8ba97da9, 2026-10-11):
//   renders (native)         ~0.6–0.8 bytes/px
//   photographs (embedded)   ~0.14–0.65 bytes/px
//   structural / engineering  0.05–0.13 bytes/px (scanned sheets, legible)
//   grey facade layer        0.034 bytes/px at 4856×4857   → BLANK
//   elevation placeholder    0.030 bytes/px at 600×600, 10.6 KB → BLANK
//   newest-case native 12000×6750 images 0.037–0.055 bytes/px: very large
//   pictures compress far better per pixel, so the picture threshold falls
//   with the megapixel count and these are KEPT.
//
// A blank asset is kept internally with its reason (never silently deleted);
// only the customer gallery omits it. Unknown byte size = no verdict (kept).
// Pure: safe in Edge Functions, the browser and node --test.

export type VisualQualityVerdict = 'OK' | 'BLANK' | 'TOO_SMALL' | 'STRIP' | 'UNKNOWN';

export interface VisualQuality {
  verdict: VisualQualityVerdict;
  usable: boolean;
  /** Bytes per pixel, rounded to 4 places (null when bytes or size are unknown). */
  bytesPerPixel: number | null;
  reason: string | null;
}

/** Kinds that are line work: their raster layers are judged more strictly. */
export const DRAWING_KINDS: ReadonlySet<string> = new Set([
  'SITE_PLAN', 'MASTER_PLAN', 'FLOOR_PLAN', 'UNIT_PLAN', 'SECTION', 'ELEVATION', 'FACADE', 'STRUCTURAL', 'ENGINEERING', 'LOCATION_DIAGRAM',
]);

export interface QualityInput {
  kind?: unknown;
  extraction?: unknown;
  width?: unknown;
  height?: unknown;
  /** Byte size of the stored image (record.bytes, or the storage object's size). */
  bytes?: unknown;
}

const pos = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
};

/** Lowest bytes/pixel a real picture (photo, render, unlabelled native image) has at this size. */
export function pictureFloor(megapixels: number): number {
  if (megapixels > 20) return 0.015;
  if (megapixels > 8) return 0.03;
  return 0.06;
}

/** Lowest bytes/pixel an embedded drawing raster has before it is a blank layer. */
export const DRAWING_FLOOR = 0.045;

export function assessVisualQuality(v: QualityInput): VisualQuality {
  const w = pos(v.width);
  const h = pos(v.height);
  const bytes = pos(v.bytes);
  const kind = typeof v.kind === 'string' ? v.kind.toUpperCase() : 'OTHER';
  const extraction = typeof v.extraction === 'string' ? v.extraction : null;
  const drawing = DRAWING_KINDS.has(kind);
  if (w && h) {
    const long = Math.max(w, h);
    const short = Math.min(w, h);
    if (long / short > 6) return { verdict: 'STRIP', usable: false, bytesPerPixel: bytes ? round(bytes / (w * h)) : null, reason: `aspect ${Math.round(long / short)}:1` };
    // A drawing below ~800 px on its long side cannot be read; a picture below 600 / 300 is a thumbnail.
    if (drawing ? long < 800 : long < 600 || short < 300) {
      return { verdict: 'TOO_SMALL', usable: false, bytesPerPixel: bytes ? round(bytes / (w * h)) : null, reason: `${w}×${h} px` };
    }
  }
  if (!w || !h || !bytes) return { verdict: 'UNKNOWN', usable: true, bytesPerPixel: null, reason: null };
  const px = w * h;
  const bpp = bytes / px;
  if (bytes < 12_000 && px > 250_000) return { verdict: 'BLANK', usable: false, bytesPerPixel: round(bpp), reason: `${bytes} bytes for ${w}×${h} px` };
  // Line work embedded as a raster: a near-uniform layer compresses to almost nothing.
  if (drawing && extraction !== 'PDF_PAGE_RENDER' && bpp < DRAWING_FLOOR) {
    return { verdict: 'BLANK', usable: false, bytesPerPixel: round(bpp), reason: `${round(bpp)} bytes/px < ${DRAWING_FLOOR} (drawing layer)` };
  }
  if (!drawing) {
    const floor = pictureFloor(px / 1e6);
    if (bpp < floor) return { verdict: 'BLANK', usable: false, bytesPerPixel: round(bpp), reason: `${round(bpp)} bytes/px < ${floor} (picture)` };
  }
  return { verdict: 'OK', usable: true, bytesPerPixel: round(bpp), reason: null };
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * id → byte size, from what the worker reported (tasApi.visuals and
 * tasApi.priorityVisuals carry `bytes`) and from earlier-annotated records.
 * Reads the report once; no network.
 */
export function visualByteSizes(resultJson: unknown): Map<string, number> {
  const out = new Map<string, number>();
  const r = (resultJson && typeof resultJson === 'object' ? resultJson : {}) as Record<string, any>;
  const add = (list: unknown) => {
    for (const v of Array.isArray(list) ? list : []) {
      const id = typeof v?.id === 'string' ? v.id : '';
      const b = pos(v?.bytes);
      if (/^[a-f0-9]{64}$/.test(id) && b && !out.has(id)) out.set(id, b);
    }
  };
  add(r.officialVisuals);
  for (const res of Array.isArray(r.browserOfficial?.results) ? r.browserOfficial.results : []) {
    if (!res?.tasApi) continue;
    add(res.tasApi.visuals);
    add(res.tasApi.priorityVisuals);
  }
  return out;
}

/**
 * Persisted records with their quality verdict attached (`bytes`, `quality`).
 * A record whose size is unknown is left exactly as it was.
 */
export function annotateVisualQuality<T extends Record<string, unknown>>(records: T[], sizes: Map<string, number>): Array<T & { bytes?: number; quality?: VisualQuality }> {
  return records.map((r) => {
    const bytes = pos(r.bytes) ?? sizes.get(String(r.id)) ?? null;
    if (!bytes) return r;
    const quality = assessVisualQuality({ kind: r.kind, extraction: r.extraction, width: r.width, height: r.height, bytes });
    return { ...r, bytes, quality };
  });
}

/** True when the record must not reach the customer gallery. */
export function isUnusableVisual(r: unknown): boolean {
  const q = (r && typeof r === 'object' ? (r as Record<string, any>).quality : null) as VisualQuality | null;
  if (q && q.usable === false) return true;
  // Records persisted before annotation: judge them when the size travelled with them.
  const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
  return pos(o.bytes) ? !assessVisualQuality(o).usable : false;
}
