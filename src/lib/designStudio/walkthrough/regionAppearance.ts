// WHAT EACH REGION OF THE SELECTED RENDER LOOKS LIKE — measured from its pixels, never guessed.
//
// The render was generated with an id image (ds_renders.map_key): every pixel's colour IS the legend id of the
// floor, wall or object it belongs to (the legend lists them). Reading both, each region gets:
//
//   color   its robust colour: the region's own pixels only (edges eroded so a neighbour never bleeds in),
//           shadows and highlights trimmed, the per-channel median of the rest
//   second  a second colour when the region clearly has two (bedding on a frame, a worktop on cabinets): the
//           smaller of two clusters, when it is a real share of the region and clearly different
//   spread  how varied it is (a patterned rug, a grained wood) — luminance deviation, 0..1
//
// The render is lit (a warm evening scene): colours are corrected half-way toward a neutral grey world, so the
// walkthrough's own lighting does not warm them a second time. Pure: the server passes decoded pixels in.

import type { LegendEntry, RegionLook } from './designGraph.ts';

export interface Pixels { width: number; height: number; data: Uint8Array | Uint8ClampedArray; channels?: number }

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
const toHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Two-means on RGB, a few rounds, seeded from the darkest and lightest samples. */
function twoMeans(px: Array<[number, number, number]>): { a: [number, number, number]; b: [number, number, number]; na: number; nb: number } {
  const sorted = [...px].sort((p, q) => lum(...p) - lum(...q));
  let a = sorted[Math.floor(sorted.length * 0.2)] ?? sorted[0];
  let b = sorted[Math.floor(sorted.length * 0.8)] ?? sorted[sorted.length - 1];
  let na = 0; let nb = 0;
  for (let round = 0; round < 6; round += 1) {
    const sa = [0, 0, 0]; const sb = [0, 0, 0]; na = 0; nb = 0;
    for (const p of px) {
      const da = (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2 + (p[2] - a[2]) ** 2;
      const db = (p[0] - b[0]) ** 2 + (p[1] - b[1]) ** 2 + (p[2] - b[2]) ** 2;
      if (da <= db) { sa[0] += p[0]; sa[1] += p[1]; sa[2] += p[2]; na += 1; } else { sb[0] += p[0]; sb[1] += p[1]; sb[2] += p[2]; nb += 1; }
    }
    if (na) a = [sa[0] / na, sa[1] / na, sa[2] / na];
    if (nb) b = [sb[0] / nb, sb[1] / nb, sb[2] / nb];
  }
  return { a, b, na, nb };
}

/**
 * The look of every legend region, keyed by legend id. `ids` is the id image (its colours are the legend's), at any
 * size relative to `render` (it is sampled through the same normalised coordinates). Regions with too few clean
 * pixels are left out — no colour is better than a wrong one.
 */
export function regionAppearance(render: Pixels, ids: Pixels, legend: LegendEntry[], opts: { step?: number; minPixels?: number; balance?: number } = {}): Record<string, RegionLook> {
  const step = opts.step ?? 2;
  const minPixels = opts.minPixels ?? 24;
  const rc = render.channels ?? 4; const ic = ids.channels ?? 4;
  const byColor = new Map<number, number>();
  legend.forEach((e, i) => { const h = e.color.replace('#', ''); byColor.set(parseInt(h, 16), i); });
  const idAt = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= ids.width || y >= ids.height) return -1;
    const k = (y * ids.width + x) * ic;
    return byColor.get((ids.data[k] << 16) | (ids.data[k + 1] << 8) | ids.data[k + 2]) ?? -1;
  };
  const samples: Array<Array<[number, number, number]>> = legend.map(() => []);
  for (let y = 1; y < ids.height - 1; y += step) {
    for (let x = 1; x < ids.width - 1; x += step) {
      const i = idAt(x, y);
      if (i < 0) continue;
      // Eroded: all four neighbours belong to the same region (no edge, no anti-aliased seam).
      if (idAt(x - 1, y) !== i || idAt(x + 1, y) !== i || idAt(x, y - 1) !== i || idAt(x, y + 1) !== i) continue;
      const rx = Math.min(render.width - 1, Math.floor(((x + 0.5) / ids.width) * render.width));
      const ry = Math.min(render.height - 1, Math.floor(((y + 0.5) / ids.height) * render.height));
      const k = (ry * render.width + rx) * rc;
      samples[i].push([render.data[k], render.data[k + 1], render.data[k + 2]]);
    }
  }
  // The scene's light: per-channel gain toward grey over every labelled pixel, applied half-way (opts.balance).
  const all = samples.flat();
  const mean = [0, 1, 2].map((c) => all.reduce((s, p) => s + p[c], 0) / Math.max(1, all.length));
  const grey = (mean[0] + mean[1] + mean[2]) / 3;
  const k = opts.balance ?? 0.5;
  const gain = mean.map((m) => (m > 1 ? 1 + ((grey / m) - 1) * k : 1));
  const fix = (p: [number, number, number]): [number, number, number] => [p[0] * gain[0], p[1] * gain[1], p[2] * gain[2]];

  const out: Record<string, RegionLook> = {};
  legend.forEach((e, i) => {
    const px = samples[i];
    if (px.length < minPixels) return;
    // Trim the darkest and brightest tenth (contact shadows, specular highlights).
    const byL = [...px].sort((p, q) => lum(...p) - lum(...q));
    const trimmed = byL.slice(Math.floor(byL.length * 0.1), Math.ceil(byL.length * 0.9));
    const main: [number, number, number] = [median(trimmed.map((p) => p[0])), median(trimmed.map((p) => p[1])), median(trimmed.map((p) => p[2]))];
    const ls = trimmed.map((p) => lum(...p) / 255);
    const lm = ls.reduce((s, v) => s + v, 0) / ls.length;
    const spread = Math.sqrt(ls.reduce((s, v) => s + (v - lm) ** 2, 0) / ls.length);
    let second: string | null = null;
    if (e.kind === 'OBJECT' && px.length >= minPixels * 2) {
      // Two colours are looked for in all but the extreme 2% (a dark second colour is not a shadow to trim).
      const kept = byL.slice(Math.floor(byL.length * 0.02), Math.ceil(byL.length * 0.98));
      const { a, b, na, nb } = twoMeans(kept);
      const [big, small, nSmall] = na >= nb ? [a, b, nb] : [b, a, na];
      const apart = Math.hypot(big[0] - small[0], big[1] - small[1], big[2] - small[2]) / 441.7;
      if (nSmall / kept.length >= 0.2 && apart >= 0.08) second = toHex(...fix(small as [number, number, number]));
    }
    out[e.id] = { color: toHex(...fix(main)), second, spread: Math.round(spread * 1000) / 1000, pixels: px.length };
  });
  return out;
}
