// HOMATCH DESIGN STUDIO — WHAT IS IN AN AI-MADE PICTURE, AS AN EDIT MAP.
//
// A Blender render brings its own object-id picture. A picture OpenAI made has
// none, so OpenAI is asked what it made: every clearly visible editable object
// and surface (sofa, table, bed, cabinet, rug, curtain, light…, wall, floor,
// ceiling), each with its OUTLINE traced along the visible edge and a few points
// inside it. HOMATCH then refines each outline against the picture's own pixels
// — growing from the inside points through similar colour, stopping at edges,
// never past the traced outline's neighbourhood — so a mask follows the object,
// not a rectangle around it.
//
// The result is the SAME contract the stable edit pipeline (PR #65) already
// reads: an id picture (one flat colour per target) and a legend
// { width, height, entries: [{ color, kind, id, roomId, coverage, box }] }.
// The id picture may be smaller than the picture (the edit pipeline resizes the
// mask), so the analysis runs at a working size and stays inside one edge
// invocation's budget.
//
// What is not shipped: an outline that is only a bounding rectangle and that
// the pixels do not confirm is dropped (that target is simply not editable),
// never turned into a rectangular edit.
//
// Pure (no I/O). Deno + Node.

import { dilate, type RgbPixels } from './renderCheck.ts';

export const SCENE_LABELS = [
  'SOFA', 'ARMCHAIR', 'CHAIR', 'STOOL', 'DINING_TABLE', 'COFFEE_TABLE', 'SIDE_TABLE', 'DESK', 'BED', 'NIGHTSTAND', 'WARDROBE', 'CABINET',
  'SHELF', 'TV_UNIT', 'KITCHEN_CABINETS', 'KITCHEN_ISLAND', 'COUNTERTOP', 'RUG', 'CURTAIN', 'LAMP', 'PENDANT_LIGHT', 'CEILING_LIGHT',
  'PLANT', 'ARTWORK', 'MIRROR', 'BATHTUB', 'SHOWER', 'VANITY', 'TOILET', 'OUTDOOR_FURNITURE', 'WALL', 'FLOOR', 'CEILING', 'OTHER',
] as const;
export type SceneLabel = typeof SCENE_LABELS[number];
export const SCENE_KINDS = ['OBJECT', 'WALL', 'FLOOR', 'CEILING'] as const;
export type SceneKind = typeof SCENE_KINDS[number];

const point = { type: 'array', items: { type: 'number' } } as const;
export const SCENE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['elements'],
  properties: {
    elements: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['label', 'kind', 'room', 'outline', 'inside'],
        properties: {
          label: { type: 'string', enum: [...SCENE_LABELS] },
          kind: { type: 'string', enum: [...SCENE_KINDS] },
          room: { type: 'string' },
          outline: { type: 'array', items: point },
          inside: { type: 'array', items: point },
        },
      },
    },
  },
} as const;

export const SCENE_SYSTEM = `You look at a photorealistic interior design picture and list what a homeowner could change in it.

For every clearly visible piece of furniture, fitting or textile (and every visible wall plane, each room's visible floor and any visible ceiling):
- label and kind (OBJECT, WALL, FLOOR or CEILING);
- room: the room id it is in, from the list given, or "" if unsure;
- outline: its visible silhouette traced along its actual edge, 8 to 40 points, clockwise, in normalised picture coordinates [x, y] with x from 0 (left) to 1 (right) and y from 0 (top) to 1 (bottom). Follow the real contour (a sofa's arms and back, a lamp's shade and stem, a rug's perspective shape). Never give a bounding rectangle unless the thing itself looks rectangular in the picture;
- inside: 1 to 4 points clearly inside it, on the thing itself, not on anything in front of it.
Skip anything smaller than about 1% of the picture's width, anything mostly hidden, and people or text (there should be none). At most 48 elements, the largest and most important first.`;

/** The Responses API body: the picture and the home's rooms. */
export function sceneRequest(model: string, imageDataUrl: string, rooms: Array<{ id: string; name: string }>) {
  return {
    model,
    input: [
      { role: 'system', content: SCENE_SYSTEM },
      {
        role: 'user', content: [
          { type: 'input_text', text: `Rooms of this home: ${rooms.map((r) => `${r.id} = ${r.name}`).join('; ') || 'not known'}.` },
          { type: 'input_image', image_url: imageDataUrl },
        ],
      },
    ],
    text: { format: { type: 'json_schema', name: 'ds_scene_map', strict: true, schema: SCENE_SCHEMA } },
    reasoning: { effort: 'medium' },
  };
}

export interface SceneElement { label: SceneLabel; kind: SceneKind; room: string; outline: Array<[number, number]>; inside: Array<[number, number]> }

const unit = (p: unknown): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= -0.01 && n <= 1.01);
const clampPt = (p: [number, number]): [number, number] => [Math.min(1, Math.max(0, p[0])), Math.min(1, Math.max(0, p[1]))];

/** The answer, bounded: at most 48 elements; an outline needs 3–64 points inside the picture. */
export function validateScene(raw: unknown): SceneElement[] {
  const els = (raw as { elements?: unknown })?.elements;
  if (!Array.isArray(els)) return [];
  return els.slice(0, 48).flatMap((e: any) => {
    if (!SCENE_LABELS.includes(e?.label) || !SCENE_KINDS.includes(e?.kind) || !Array.isArray(e?.outline)) return [];
    const outline = e.outline.filter(unit).slice(0, 64).map(clampPt);
    if (outline.length < 3) return [];
    const inside = Array.isArray(e.inside) ? e.inside.filter(unit).slice(0, 4).map(clampPt) : [];
    return [{ label: e.label, kind: e.kind, room: typeof e.room === 'string' ? e.room.slice(0, 40) : '', outline, inside }];
  });
}

// ── Raster work ──────────────────────────────────────────────────────────────

export const MAP_MAX_SIDE = 768;
const MIN_PIXELS = 30;

interface Work { w: number; h: number; rgb: Float32Array; grad: Float32Array }

/** The picture at the working size (box-averaged), with its gradient magnitude. */
export function workingImage(img: RgbPixels, maxSide = MAP_MAX_SIDE): Work {
  const s = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * s)); const h = Math.max(1, Math.round(img.height * s));
  const rgb = new Float32Array(w * h * 3); const c = img.channels;
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.floor(y / s); const y1 = Math.max(y0 + 1, Math.min(img.height, Math.floor((y + 1) / s)));
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.floor(x / s); const x1 = Math.max(x0 + 1, Math.min(img.width, Math.floor((x + 1) / s)));
      let r = 0; let g = 0; let b = 0; let n = 0;
      for (let yy = y0; yy < y1; yy += 1) for (let xx = x0; xx < x1; xx += 1) {
        const j = (yy * img.width + xx) * c; r += img.data[j]; g += img.data[j + 1]; b += img.data[j + 2]; n += 1;
      }
      const i = (y * w + x) * 3; rgb[i] = r / n; rgb[i + 1] = g / n; rgb[i + 2] = b / n;
    }
  }
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) gray[i] = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
  const grad = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y += 1) for (let x = 1; x < w - 1; x += 1) {
    const p = (yy: number, xx: number) => gray[yy * w + xx];
    const gx = p(y - 1, x + 1) + 2 * p(y, x + 1) + p(y + 1, x + 1) - p(y - 1, x - 1) - 2 * p(y, x - 1) - p(y + 1, x - 1);
    const gy = p(y + 1, x - 1) + 2 * p(y + 1, x) + p(y + 1, x + 1) - p(y - 1, x - 1) - 2 * p(y - 1, x) - p(y - 1, x + 1);
    grad[y * w + x] = Math.abs(gx) + Math.abs(gy);
  }
  return { w, h, rgb, grad };
}

/** Fill a polygon (pixel centres, even-odd). */
export function rasterPolygon(pts: Array<[number, number]>, w: number, h: number): Uint8Array {
  const m = new Uint8Array(w * h);
  const P = pts.map(([x, y]) => [x * w, y * h]);
  for (let y = 0; y < h; y += 1) {
    const cy = y + 0.5; const xs: number[] = [];
    for (let i = 0, j = P.length - 1; i < P.length; j = i, i += 1) {
      const [xi, yi] = P[i]; const [xj, yj] = P[j];
      if ((yi > cy) !== (yj > cy)) xs.push(xi + ((cy - yi) / (yj - yi)) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil(xs[k] - 0.5)); const b = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = a; x <= b; x += 1) m[y * w + x] = 1;
    }
  }
  return m;
}

const count = (m: Uint8Array) => { let n = 0; for (let i = 0; i < m.length; i += 1) n += m[i]; return n; };
function erode(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return m.slice();
  const inv = new Uint8Array(m.length); for (let i = 0; i < m.length; i += 1) inv[i] = m[i] ? 0 : 1;
  const d = dilate(inv, w, h, r); const out = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i += 1) out[i] = d[i] ? 0 : 1;
  return out;
}
/** Holes the outside cannot reach become part of the mask. */
function fillHoles(m: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(m.length); const seen = new Uint8Array(m.length); const q: number[] = [];
  const push = (i: number) => { if (!m[i] && !seen[i]) { seen[i] = 1; q.push(i); } };
  for (let x = 0; x < w; x += 1) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y += 1) { push(y * w); push(y * w + w - 1); }
  while (q.length) {
    const i = q.pop()!; const x = i % w; const y = (i - x) / w;
    if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (y > 0) push(i - w); if (y < h - 1) push(i + w);
  }
  for (let i = 0; i < m.length; i += 1) out[i] = m[i] || !seen[i] ? 1 : 0;
  return out;
}

/** An outline that is exactly an axis-aligned rectangle (the shape of a bounding box). */
export function isBoxOutline(pts: Array<[number, number]>): boolean {
  if (pts.length !== 4 && pts.length !== 5) return false;
  const xs = new Set(pts.map((p) => Math.round(p[0] * 1000))); const ys = new Set(pts.map((p) => Math.round(p[1] * 1000)));
  return xs.size === 2 && ys.size === 2;
}

export interface Refined { mask: Uint8Array; method: 'REFINED' | 'OUTLINE'; iou: number }

/**
 * One element's mask from its outline and the picture: grow from the inside
 * (the inside points and the outline's core) through pixels close to the core's
 * colour, never across a strong edge, never further than a band around the
 * outline. Accepted when it agrees with the outline (IoU ≥ 0.55); otherwise the
 * outline itself is the mask.
 */
export function refineElement(work: Work, el: SceneElement): Refined | null {
  const { w, h, rgb, grad } = work;
  const P = rasterPolygon(el.outline, w, h);
  const area = count(P);
  if (area < MIN_PIXELS) return null;
  const side = Math.sqrt(area);
  let core = erode(P, w, h, Math.max(1, Math.round(0.12 * side)));
  if (count(core) < 4) core = P;
  const seeds = el.inside.map(([x, y]) => Math.min(h - 1, Math.floor(y * h)) * w + Math.min(w - 1, Math.floor(x * w))).filter((i) => P[i]);
  // The colour of the thing: its seeds (with their neighbours) or its core.
  const sample: number[] = [];
  if (seeds.length) for (const s of seeds) { const sx = s % w; const sy = (s - sx) / w; for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) { const xx = sx + dx; const yy = sy + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h && P[yy * w + xx]) sample.push(yy * w + xx); } }
  else for (let i = 0; i < core.length; i += 1) if (core[i]) sample.push(i);
  const mean = [0, 0, 0];
  for (const i of sample) { mean[0] += rgb[i * 3]; mean[1] += rgb[i * 3 + 1]; mean[2] += rgb[i * 3 + 2]; }
  for (let k = 0; k < 3; k += 1) mean[k] /= Math.max(1, sample.length);
  let v = 0;
  for (const i of sample) v += (rgb[i * 3] - mean[0]) ** 2 + (rgb[i * 3 + 1] - mean[1]) ** 2 + (rgb[i * 3 + 2] - mean[2]) ** 2;
  const sd = Math.sqrt(v / Math.max(1, sample.length * 3));
  const tau = Math.min(60, Math.max(18, 2.5 * sd + 12));
  const band = dilate(P, w, h, Math.max(2, Math.round(0.08 * side)));
  const grown = new Uint8Array(w * h); const q: number[] = [];
  const dist = (i: number) => Math.sqrt((rgb[i * 3] - mean[0]) ** 2 + (rgb[i * 3 + 1] - mean[1]) ** 2 + (rgb[i * 3 + 2] - mean[2]) ** 2);
  const start = seeds.length ? seeds : sample;
  for (const i of start) if (!grown[i]) { grown[i] = 1; q.push(i); }
  while (q.length) {
    const i = q.pop()!; const x = i % w; const y = (i - x) / w;
    const visit = (j: number) => {
      if (grown[j] || !band[j]) return;
      if (dist(j) <= tau && grad[j] < 160) { grown[j] = 1; q.push(j); }
    };
    if (x > 0) visit(i - 1); if (x < w - 1) visit(i + 1); if (y > 0) visit(i - w); if (y < h - 1) visit(i + w);
  }
  let mask = fillHoles(erode(dilate(grown, w, h, 1), w, h, 1), w, h);
  for (let i = 0; i < mask.length; i += 1) if (!band[i]) mask[i] = 0;
  let inter = 0; let uni = 0;
  for (let i = 0; i < mask.length; i += 1) { if (mask[i] && P[i]) inter += 1; if (mask[i] || P[i]) uni += 1; }
  const iou = uni ? inter / uni : 0;
  // A real object's growth stops at its own edges; growth that ran into the band's limit found background.
  let boundary = 0; let clipped = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue;
    const x = i % w; const y = (i - x) / w;
    const out = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1].filter((j) => j >= 0 && !mask[j]);
    if (!out.length) continue;
    boundary += 1;
    if (out.some((j) => !band[j])) clipped += 1;
  }
  const clippedShare = boundary ? clipped / boundary : 1;
  if (iou >= 0.55 && clippedShare <= 0.35) return { mask, method: 'REFINED', iou };
  mask = P;
  return { mask, method: 'OUTLINE', iou };
}

export interface EditMap {
  ids: RgbPixels;
  legend: { width: number; height: number; entries: Array<{ color: string; kind: string; id: string; roomId: string | null; coverage: number; box: [number, number, number, number] }> };
  accepted: Array<{ id: string; label: SceneLabel; method: 'REFINED' | 'OUTLINE'; iou: number; pixels: number }>;
  rejected: Array<{ label: SceneLabel; reason: 'TOO_SMALL' | 'BOX_OUTLINE' | 'HIDDEN' }>;
}

/** A distinct, non-black id colour per target (deterministic). */
export function idColor(i: number): string {
  const c = ((Math.imul(i + 1, 2654435761) >>> 8) & 0xffffff) | 0x010101;
  return `#${c.toString(16).padStart(6, '0')}`;
}

/**
 * The edit map of a picture from what OpenAI saw in it. Surfaces are laid down
 * first and objects over them (larger first, so a cushion on a sofa stays the
 * cushion's); a target left with too few pixels is not editable.
 */
export function buildEditMap(img: RgbPixels, elements: SceneElement[], rooms: ReadonlySet<string>, maxSide = MAP_MAX_SIDE): EditMap {
  const work = workingImage(img, maxSide);
  const { w, h } = work;
  const owner = new Int32Array(w * h).fill(-1);
  const rejected: EditMap['rejected'] = [];
  const kept: Array<{ el: SceneElement; r: Refined; area: number }> = [];
  for (const el of elements) {
    const r = refineElement(work, el);
    if (!r) { rejected.push({ label: el.label, reason: 'TOO_SMALL' }); continue; }
    if (r.method === 'OUTLINE' && el.kind === 'OBJECT' && isBoxOutline(el.outline)) { rejected.push({ label: el.label, reason: 'BOX_OUTLINE' }); continue; }
    kept.push({ el, r, area: count(r.mask) });
  }
  const order = kept.map((k, i) => ({ ...k, i }))
    .sort((a, b) => (a.el.kind === 'OBJECT' ? 1 : 0) - (b.el.kind === 'OBJECT' ? 1 : 0) || b.area - a.area);
  for (const k of order) for (let p = 0; p < k.r.mask.length; p += 1) if (k.r.mask[p]) owner[p] = k.i;
  const ids = new Uint8Array(w * h * 3);
  const entries: EditMap['legend']['entries'] = []; const accepted: EditMap['accepted'] = [];
  const perLabel = new Map<string, number>();
  for (const k of order.sort((a, b) => a.i - b.i)) {
    let n = 0; let x0 = w; let y0 = h; let x1 = -1; let y1 = -1;
    for (let p = 0; p < owner.length; p += 1) {
      if (owner[p] !== k.i) continue;
      n += 1; const x = p % w; const y = (p - x) / w;
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
    }
    if (n < MIN_PIXELS) { rejected.push({ label: k.el.label, reason: 'HIDDEN' }); for (let p = 0; p < owner.length; p += 1) if (owner[p] === k.i) owner[p] = -1; continue; }
    const base = k.el.kind === 'OBJECT' ? k.el.label.toLowerCase() : k.el.kind.toLowerCase();
    const seq = (perLabel.get(base) ?? 0) + 1; perLabel.set(base, seq);
    const id = `ai:${base}:${seq}`;
    const color = idColor(entries.length);
    const c = parseInt(color.slice(1), 16);
    for (let p = 0; p < owner.length; p += 1) if (owner[p] === k.i) { ids[p * 3] = (c >> 16) & 255; ids[p * 3 + 1] = (c >> 8) & 255; ids[p * 3 + 2] = c & 255; }
    entries.push({
      color, kind: k.el.kind, id, roomId: rooms.has(k.el.room) ? k.el.room : null,
      coverage: Math.round((n / (w * h)) * 1e5) / 1e5,
      box: [x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h].map((v) => Math.round(v * 1e4) / 1e4) as [number, number, number, number],
    });
    accepted.push({ id, label: k.el.label, method: k.r.method, iou: Math.round(k.r.iou * 1000) / 1000, pixels: n });
  }
  return { ids: { width: w, height: h, data: ids, channels: 3 }, legend: { width: w, height: h, entries }, accepted, rejected };
}

/** The semantic label of an AI edit-map id ("ai:sofa:2" → "SOFA"); null for any other id. */
export function aiLabelOf(id: string): string | null {
  const m = /^ai:([a-z_]+):\d+$/.exec(id);
  return m ? m[1].toUpperCase() : null;
}
