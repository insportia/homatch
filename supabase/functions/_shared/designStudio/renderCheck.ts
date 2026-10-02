// HOMATCH DESIGN STUDIO — the structure check: did the photoreal finish keep the picture's structure?
//
// The Blender picture is the truth about WHERE things are (it is drawn from
// the validated geometry and the approved design). An image model may change
// how things LOOK — light, texture, material character — and nothing else. So
// a finished picture is compared with the Blender picture on structure only:
//
//   1. Both are reduced to grey at a small working size (area-averaged) and
//      softened (3×3 box), so texture noise and JPEG blocks do not count.
//   2. Sobel edge maps, thresholded at a fixed gradient (EDGE_THRESHOLD).
//   3. EDGE AGREEMENT: an F-beta score with a tolerance radius — a Blender
//      edge counts as kept when the finished picture has an edge within
//      `toleranceRadius` working pixels, and vice versa. beta = 2 weights
//      RECALL (Blender edges that survived): a finish legitimately ADDS
//      edges (wood grain, fabric folds, reflections), but a wall that moved
//      or a sofa that vanished REMOVES Blender edges.
//   4. MASK AGREEMENT, per major target of the object map (coverage ≥
//      majorCoverage): the target's own boundary pixels that are VISIBLE in
//      the Blender picture (a Blender edge within the radius) must still
//      carry an edge in the finished picture. Overall = coverage-weighted
//      mean; any one major target below minTargetAgreement refuses (a single
//      moved piece is a refusal even when the room is otherwise identical).
//
// An EDIT is checked the other way round: outside its (dilated) mask the
// picture must be unchanged — mean grey difference and edge agreement
// measured outside only.
//
// Thresholds are configuration (RenderCheckOptions), documented below and
// overridable per call; the defaults were set on synthetic pictures (see
// __tests__/renderCheck.test.mjs) and are deliberately conservative: a refused
// finish costs a nicer picture, an accepted bad one costs the truth.
//
// Pure: no I/O, no decoding. Callers hand in decoded grey / RGB(A) pixels.

export interface GrayPixels { width: number; height: number; data: Uint8Array }
export interface RgbPixels { width: number; height: number; data: Uint8Array; channels: 3 | 4 }
export interface CheckTarget { color: string; id: string; kind: string; coverage: number }

export interface RenderCheckOptions {
  /** Working width in pixels (height follows the Blender picture's aspect). */
  workWidth: number;
  /** Sobel |gx|+|gy| on the softened grey at or above this is an edge (0–2040 scale). */
  edgeThreshold: number;
  /** How far (working pixels) an edge may sit from its counterpart and still agree. */
  toleranceRadius: number;
  /** F-beta weighting; > 1 favours recall (Blender edges kept). */
  beta: number;
  /** Accept a finish only at or above this edge agreement. */
  minEdgeAgreement: number;
  /** …and at or above this coverage-weighted boundary agreement over major targets. */
  minMaskAgreement: number;
  /** …and with no single major target below this. */
  minTargetAgreement: number;
  /** A target is major when it covers at least this share of the picture. */
  majorCoverage: number;
  /** A target with fewer visible boundary pixels than this is not judged (too small to measure). */
  minBoundaryPixels: number;
  /** The finished picture's aspect may differ from Blender's by at most this ratio (framing kept). */
  maxAspectDrift: number;
  /** EDIT: outside the mask, mean |Δgrey| (0–255) at or below this. */
  maxOutsideMeanDiff: number;
  /** EDIT: outside the mask, edge agreement at or above this. */
  minOutsideEdgeAgreement: number;
}

export const CHECK_DEFAULTS: Readonly<RenderCheckOptions> = Object.freeze({
  workWidth: 256,
  edgeThreshold: 96,
  toleranceRadius: 2,
  beta: 2,
  minEdgeAgreement: 0.6,
  minMaskAgreement: 0.6,
  minTargetAgreement: 0.35,
  majorCoverage: 0.02,
  minBoundaryPixels: 12,
  maxAspectDrift: 0.03,
  maxOutsideMeanDiff: 14,
  minOutsideEdgeAgreement: 0.7,
});

export interface TargetAgreement { id: string; kind: string; coverage: number; boundary: number; agreement: number | null }

export interface CheckResult {
  accepted: boolean;
  edgeAgreement: number | null;
  maskAgreement: number | null;
  reason: string | null;
  targets?: TargetAgreement[];
  meanOutsideDiff?: number | null;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

// ── Pixels ────────────────────────────────────────────────────────────────

/** Area-average resize (also correct when enlarging: each output pixel reads at least one input pixel). */
export function resizeGray(g: GrayPixels, width: number, height: number): GrayPixels {
  const out = new Uint8Array(width * height);
  const sx = g.width / width; const sy = g.height / height;
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor(y * sy); const y1 = Math.max(y0 + 1, Math.min(g.height, Math.floor((y + 1) * sy)));
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor(x * sx); const x1 = Math.max(x0 + 1, Math.min(g.width, Math.floor((x + 1) * sx)));
      let sum = 0; let n = 0;
      for (let yy = y0; yy < y1; yy += 1) for (let xx = x0; xx < x1; xx += 1) { sum += g.data[yy * g.width + xx]; n += 1; }
      out[y * width + x] = Math.round(sum / n);
    }
  }
  return { width, height, data: out };
}

export function rgbToGray(img: RgbPixels): GrayPixels {
  const n = img.width * img.height; const out = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i += 1, j += img.channels) out[i] = Math.round(0.299 * img.data[j] + 0.587 * img.data[j + 1] + 0.114 * img.data[j + 2]);
  return { width: img.width, height: img.height, data: out };
}

/** The id image sampled at working-pixel centres (nearest: ids are labels, never averaged). */
export function sampleIds(ids: RgbPixels, width: number, height: number): Int32Array {
  const out = new Int32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(ids.height - 1, Math.floor((y + 0.5) * ids.height / height));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(ids.width - 1, Math.floor((x + 0.5) * ids.width / width));
      const j = (sy * ids.width + sx) * ids.channels;
      out[y * width + x] = (ids.data[j] << 16) | (ids.data[j + 1] << 8) | ids.data[j + 2];
    }
  }
  return out;
}

export const colorInt = (hex: string): number => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return m ? parseInt(m[1], 16) : -1;
};

function soften(g: GrayPixels): Float32Array {
  const { width: w, height: h, data } = g; const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    let s = 0; let n = 0;
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const yy = y + dy; const xx = x + dx;
      if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
      s += data[yy * w + xx]; n += 1;
    }
    out[y * w + x] = s / n;
  }
  return out;
}

/** Sobel |gx|+|gy| ≥ threshold → 1. Border pixels are never edges (the frame is not structure). */
export function edgeMap(g: GrayPixels, threshold: number): Uint8Array {
  const { width: w, height: h } = g; const s = soften(g); const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y += 1) for (let x = 1; x < w - 1; x += 1) {
    const p = (yy: number, xx: number) => s[yy * w + xx];
    const gx = p(y - 1, x + 1) + 2 * p(y, x + 1) + p(y + 1, x + 1) - p(y - 1, x - 1) - 2 * p(y, x - 1) - p(y + 1, x - 1);
    const gy = p(y + 1, x - 1) + 2 * p(y + 1, x) + p(y + 1, x + 1) - p(y - 1, x - 1) - 2 * p(y - 1, x) - p(y - 1, x + 1);
    if (Math.abs(gx) + Math.abs(gy) >= threshold) out[y * w + x] = 1;
  }
  return out;
}

/** Square dilation by r (separable). */
export function dilate(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return m.slice();
  const tmp = new Uint8Array(w * h); const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    if (!m[y * w + x]) continue;
    for (let dx = -r; dx <= r; dx += 1) { const xx = x + dx; if (xx >= 0 && xx < w) tmp[y * w + xx] = 1; }
  }
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    if (!tmp[y * w + x]) continue;
    for (let dy = -r; dy <= r; dy += 1) { const yy = y + dy; if (yy >= 0 && yy < h) out[yy * w + x] = 1; }
  }
  return out;
}

/** Tolerant edge F-beta, optionally restricted to `where` (1 = counted). */
export function edgeAgreement(base: Uint8Array, cand: Uint8Array, w: number, h: number, r: number, beta: number, where?: Uint8Array) {
  const bd = dilate(base, w, h, r); const cd = dilate(cand, w, h, r);
  let nb = 0; let nc = 0; let kept = 0; let true_ = 0;
  for (let i = 0; i < w * h; i += 1) {
    if (where && !where[i]) continue;
    if (base[i]) { nb += 1; if (cd[i]) kept += 1; }
    if (cand[i]) { nc += 1; if (bd[i]) true_ += 1; }
  }
  if (nb === 0 && nc === 0) return { precision: 1, recall: 1, f: 1, baseEdges: 0, candEdges: 0 };
  const precision = nc ? true_ / nc : 1; const recall = nb ? kept / nb : 1;
  const b2 = beta * beta;
  const f = precision + recall > 0 ? ((1 + b2) * precision * recall) / (b2 * precision + recall) : 0;
  return { precision, recall, f, baseEdges: nb, candEdges: nc };
}

function workSize(base: { width: number; height: number }, opts: RenderCheckOptions) {
  const w = Math.max(16, Math.min(opts.workWidth, base.width));
  const h = Math.max(16, Math.round(base.height * w / base.width));
  return { w, h };
}

const aspectDrift = (a: { width: number; height: number }, b: { width: number; height: number }) =>
  Math.abs(a.width / a.height - b.width / b.height) / (a.width / a.height);

// ── The finish check ──────────────────────────────────────────────────────

/**
 * A finished picture against the Blender picture (and its object map, when there is one).
 * The finished picture may be any size of the same aspect; it is compared at the working size.
 */
export function checkFinish(
  base: GrayPixels, finished: GrayPixels,
  map: { ids: RgbPixels; targets: CheckTarget[] } | null,
  options: Partial<RenderCheckOptions> = {},
): CheckResult {
  const o = { ...CHECK_DEFAULTS, ...options };
  if (aspectDrift(base, finished) > o.maxAspectDrift) return { accepted: false, edgeAgreement: null, maskAgreement: null, reason: 'FRAMING_CHANGED' };
  const { w, h } = workSize(base, o);
  const be = edgeMap(resizeGray(base, w, h), o.edgeThreshold);
  const ce = edgeMap(resizeGray(finished, w, h), o.edgeThreshold);
  const ea = edgeAgreement(be, ce, w, h, o.toleranceRadius, o.beta);
  const edge = round3(ea.f);

  let mask: number | null = null;
  const targets: TargetAgreement[] = [];
  if (map) {
    const ids = sampleIds(map.ids, w, h);
    const bd = dilate(be, w, h, o.toleranceRadius); const cd = dilate(ce, w, h, o.toleranceRadius);
    let wsum = 0; let asum = 0;
    for (const t of map.targets) {
      if (!(t.coverage >= o.majorCoverage)) continue;
      const c = colorInt(t.color); if (c < 0) continue;
      let boundary = 0; let agree = 0;
      for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
        const i = y * w + x;
        if (ids[i] !== c) continue;
        const edgeOfTarget = (x > 0 && ids[i - 1] !== c) || (x < w - 1 && ids[i + 1] !== c) || (y > 0 && ids[i - w] !== c) || (y < h - 1 && ids[i + w] !== c);
        if (!edgeOfTarget || !bd[i]) continue; // only the boundary Blender actually shows
        boundary += 1; if (cd[i]) agree += 1;
      }
      const a = boundary >= o.minBoundaryPixels ? agree / boundary : null;
      targets.push({ id: t.id, kind: t.kind, coverage: round3(t.coverage), boundary, agreement: a === null ? null : round3(a) });
      if (a !== null) { wsum += t.coverage; asum += t.coverage * a; }
    }
    mask = wsum > 0 ? round3(asum / wsum) : null;
  }

  let reason: string | null = null;
  if (edge < o.minEdgeAgreement) reason = 'EDGES_MOVED';
  else if (mask !== null && mask < o.minMaskAgreement) reason = 'TARGETS_MOVED';
  else {
    const worst = targets.find((t) => t.agreement !== null && t.agreement < o.minTargetAgreement);
    if (worst) reason = `TARGET_MOVED:${worst.id}`.slice(0, 120);
  }
  return { accepted: reason === null, edgeAgreement: edge, maskAgreement: mask, reason, targets };
}

// ── The edit check ────────────────────────────────────────────────────────

/** Editable pixels of the id image for one target colour, dilated by `grow` pixels (1 = editable). */
export function maskFromIds(ids: RgbPixels, color: string, grow = 2): { width: number; height: number; data: Uint8Array; pixels: number } {
  const c = colorInt(color);
  const { width: w, height: h } = ids; const m = new Uint8Array(w * h);
  if (c >= 0) for (let i = 0, j = 0; i < w * h; i += 1, j += ids.channels) {
    if (((ids.data[j] << 16) | (ids.data[j + 1] << 8) | ids.data[j + 2]) === c) m[i] = 1;
  }
  const data = dilate(m, w, h, grow);
  let pixels = 0; for (let i = 0; i < data.length; i += 1) pixels += data[i];
  return { width: w, height: h, data, pixels };
}

/** Mask at the working size: a working pixel is editable when any source pixel under it is. */
export function resizeMask(m: { width: number; height: number; data: Uint8Array }, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h); const sx = m.width / w; const sy = m.height / h;
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.floor(y * sy); const y1 = Math.max(y0 + 1, Math.min(m.height, Math.ceil((y + 1) * sy)));
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.floor(x * sx); const x1 = Math.max(x0 + 1, Math.min(m.width, Math.ceil((x + 1) * sx)));
      let any = 0;
      for (let yy = y0; yy < y1 && !any; yy += 1) for (let xx = x0; xx < x1; xx += 1) if (m.data[yy * m.width + xx]) { any = 1; break; }
      out[y * w + x] = any;
    }
  }
  return out;
}

/** An edited picture against the picture it edited: outside the mask nothing may change. */
export function checkEdit(
  before: GrayPixels, after: GrayPixels, mask: { width: number; height: number; data: Uint8Array },
  options: Partial<RenderCheckOptions> = {},
): CheckResult {
  const o = { ...CHECK_DEFAULTS, ...options };
  if (aspectDrift(before, after) > o.maxAspectDrift) return { accepted: false, edgeAgreement: null, maskAgreement: null, reason: 'FRAMING_CHANGED', meanOutsideDiff: null };
  const { w, h } = workSize(before, o);
  const bg = resizeGray(before, w, h); const ag = resizeGray(after, w, h);
  // The seam (blur + tolerance) belongs to the edit, not to "outside".
  const inside = dilate(resizeMask(mask, w, h), w, h, o.toleranceRadius + 1);
  const outside = new Uint8Array(w * h); let n = 0; let diff = 0;
  for (let i = 0; i < w * h; i += 1) if (!inside[i]) { outside[i] = 1; n += 1; diff += Math.abs(bg.data[i] - ag.data[i]); }
  if (n === 0) return { accepted: false, edgeAgreement: null, maskAgreement: null, reason: 'MASK_COVERS_PICTURE', meanOutsideDiff: null };
  const mean = round3(diff / n);
  const ea = edgeAgreement(edgeMap(bg, o.edgeThreshold), edgeMap(ag, o.edgeThreshold), w, h, o.toleranceRadius, 1, outside);
  const edge = round3(ea.f);
  const reason = mean > o.maxOutsideMeanDiff ? 'OUTSIDE_CHANGED' : edge < o.minOutsideEdgeAgreement ? 'OUTSIDE_EDGES_MOVED' : null;
  return { accepted: reason === null, edgeAgreement: edge, maskAgreement: null, reason, meanOutsideDiff: mean };
}

// ── Compositing ───────────────────────────────────────────────────────────

/** Nearest resample of RGB(A) pixels to a target size (the provider may answer at its own size). */
export function resizeRgbNearest(img: RgbPixels, width: number, height: number): RgbPixels {
  const ch = img.channels; const out = new Uint8Array(width * height * ch);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(img.height - 1, Math.floor((y + 0.5) * img.height / height));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(img.width - 1, Math.floor((x + 0.5) * img.width / width));
      const s = (sy * img.width + sx) * ch; const d = (y * width + x) * ch;
      for (let k = 0; k < ch; k += 1) out[d + k] = img.data[s + k];
    }
  }
  return { width, height, data: out, channels: img.channels };
}

/**
 * The edit, pasted back inside its own mask only: outside, the original pixels
 * are kept exactly (a model that re-rendered the whole frame cannot drift the rest).
 */
export function compositeInsideMask(original: RgbPixels, edited: RgbPixels, mask: { width: number; height: number; data: Uint8Array }): RgbPixels {
  const e = edited.width === original.width && edited.height === original.height ? edited : resizeRgbNearest(edited, original.width, original.height);
  const m = mask.width === original.width && mask.height === original.height ? mask.data : resizeMask(mask, original.width, original.height);
  const out = new Uint8Array(original.data);
  const ch = original.channels; const ech = e.channels;
  for (let i = 0; i < original.width * original.height; i += 1) {
    if (!m[i]) continue;
    for (let k = 0; k < 3; k += 1) out[i * ch + k] = e.data[i * ech + k];
  }
  return { width: original.width, height: original.height, data: out, channels: original.channels };
}

/**
 * compositeInsideMask written INTO `dest` — the same pixels, without a copy of
 * the picture or a resized copy of the answer (at 2400×1504 each is ~14 MB, and
 * the edge runtime's memory limit is what killed a production edit). An answer
 * at another size is sampled where it is needed with resizeRgbNearest's exact
 * mapping. `dest` is changed and returned.
 */
export function compositeInsideMaskInto(dest: RgbPixels, edited: RgbPixels, mask: { width: number; height: number; data: Uint8Array }): RgbPixels {
  const W = dest.width; const H = dest.height;
  const m = mask.width === W && mask.height === H ? mask.data : resizeMask(mask, W, H);
  const same = edited.width === W && edited.height === H;
  const ch = dest.channels; const ech = edited.channels;
  for (let y = 0; y < H; y += 1) {
    const sy = same ? y : Math.min(edited.height - 1, Math.floor((y + 0.5) * edited.height / H));
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      if (!m[i]) continue;
      const sx = same ? x : Math.min(edited.width - 1, Math.floor((x + 0.5) * edited.width / W));
      const s = (sy * edited.width + sx) * ech;
      for (let k = 0; k < 3; k += 1) dest.data[i * ch + k] = edited.data[s + k];
    }
  }
  return dest;
}
