// SURFACE FINISHES, DRAWN BY HOMATCH — no texture files, no licences.
//
// A finish is a PATTERN (planks, herringbone, tile, stone, a fabric weave…)
// drawn once per quality tier on a canvas as a neutral light-grey detail map
// plus a normal map from the same height field. The material's own colour
// tints it (MeshStandardMaterial multiplies colour × map), so one herringbone
// serves every wood tone and a recoloured sofa keeps its weave.
//
// Floors use plan-metre UVs (ShapeGeometry), so `repeat` is 1 / tile size in
// metres. Furniture faces use 0…1 UVs per face; their weave repeats a fixed
// number of times per face instead.

import * as THREE from 'three';

export type SurfacePattern =
  | 'WOOD_PLANK' | 'WOOD_HERRINGBONE' | 'TILE' | 'STONE' | 'CONCRETE' | 'CARPET'
  | 'PAINT' | 'FABRIC' | 'WOOD_GRAIN' | 'LEATHER';

export const SURFACE_PATTERNS: readonly SurfacePattern[] = [
  'WOOD_PLANK', 'WOOD_HERRINGBONE', 'TILE', 'STONE', 'CONCRETE', 'CARPET', 'PAINT', 'FABRIC', 'WOOD_GRAIN', 'LEATHER',
];

export interface FinishMaps {
  map: THREE.Texture | null;
  normalMap: THREE.Texture | null;
  normalScale: number;
  /** Floors: metres per texture tile. Objects: tiles per face. */
  tile: number;
  roughness: number;
}

/** A small deterministic noise so every tier draws the same pattern. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

type Draw = (ctx: CanvasRenderingContext2D, n: number, h: Float32Array) => void;

/** Light grey around 0.86 with ±variation; `h` receives a height (0…1) per pixel for the normal map. */
function paint(n: number, draw: Draw) {
  const canvas = document.createElement('canvas');
  canvas.width = n; canvas.height = n;
  const ctx = canvas.getContext('2d');
  const h = new Float32Array(n * n).fill(0.5);
  if (!ctx) return { canvas, h };
  ctx.fillStyle = '#dcdcdc';
  ctx.fillRect(0, 0, n, n);
  draw(ctx, n, h);
  return { canvas, h };
}

/** Plank-like wood fibres inside a rectangle, running along its long side. */
function woodFibres(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, hgt: number, r: () => number, along: 'x' | 'y') {
  const base = 208 + Math.round((r() - 0.5) * 26);
  ctx.fillStyle = `rgb(${base},${base},${base})`;
  ctx.fillRect(x, y, w, hgt);
  const lines = Math.round((along === 'x' ? hgt : w) / 2.2);
  for (let i = 0; i < lines; i += 1) {
    const t = r();
    const v = base + Math.round((r() - 0.5) * 22);
    ctx.strokeStyle = `rgba(${v},${v},${v},${0.25 + r() * 0.3})`;
    ctx.lineWidth = 0.6 + r() * 1.2;
    ctx.beginPath();
    if (along === 'x') {
      const yy = y + t * hgt;
      ctx.moveTo(x, yy);
      for (let k = 1; k <= 6; k += 1) ctx.lineTo(x + (w * k) / 6, yy + (r() - 0.5) * 1.6);
    } else {
      const xx = x + t * w;
      ctx.moveTo(xx, y);
      for (let k = 1; k <= 6; k += 1) ctx.lineTo(xx + (r() - 0.5) * 1.6, y + (hgt * k) / 6);
    }
    ctx.stroke();
  }
}

/** Mark a joint (a groove) in the height field and draw it. */
function groove(ctx: CanvasRenderingContext2D, h: Float32Array, n: number, x: number, y: number, w: number, hgt: number) {
  ctx.fillStyle = 'rgba(90,90,90,0.4)';
  ctx.fillRect(x, y, w, hgt);
  const x0 = Math.max(0, Math.floor(x)); const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(n, Math.ceil(x + w)); const y1 = Math.min(n, Math.ceil(y + hgt));
  for (let yy = y0; yy < y1; yy += 1) for (let xx = x0; xx < x1; xx += 1) h[yy * n + xx] = 0.15;
}

const PATTERNS: Record<SurfacePattern, { draw: Draw; tile: number; roughness: number; normalScale: number; seed: number }> = {
  // 1.2 m × 1.2 m: planks 0.2 m wide, staggered joints.
  WOOD_PLANK: {
    tile: 1.2, roughness: 0.62, normalScale: 0.6, seed: 11,
    draw: (ctx, n, h) => {
      const r = rng(11); const rows = 6; const ph = n / rows;
      for (let i = 0; i < rows; i += 1) {
        const off = (i % 3) * (n / 3);
        for (let k = -1; k < 2; k += 1) {
          const x = off + k * n;
          woodFibres(ctx, x, i * ph, n, ph, r, 'x');
          groove(ctx, h, n, x + n - 1, i * ph, 2, ph);
        }
        groove(ctx, h, n, 0, i * ph + ph - 1, n, 2);
      }
    },
  },
  // 0.9 m repeat of 0.09 × 0.45 m blocks at right angles.
  WOOD_HERRINGBONE: {
    tile: 0.9, roughness: 0.6, normalScale: 0.6, seed: 12,
    draw: (ctx, n, h) => {
      const r = rng(12); const u = n / 10; // block width; length = 5u
      for (let row = -12; row < 24; row += 1) {
        for (let col = -2; col < 4; col += 1) {
          const bx = col * 10 * u + row * u; const by = row * u;
          woodFibres(ctx, bx, by, 5 * u, u, r, 'x');
          groove(ctx, h, n, bx, by + u - 1, 5 * u, 1.5);
          groove(ctx, h, n, bx + 5 * u - 1, by, 1.5, u);
          woodFibres(ctx, bx + 5 * u, by - 4 * u, u, 5 * u, r, 'y');
          groove(ctx, h, n, bx + 6 * u - 1, by - 4 * u, 1.5, 5 * u);
          groove(ctx, h, n, bx + 5 * u, by + u - 1, u, 1.5);
        }
      }
    },
  },
  // 0.6 m tiles with a grout line.
  TILE: {
    tile: 1.2, roughness: 0.45, normalScale: 0.8, seed: 13,
    draw: (ctx, n, h) => {
      const r = rng(13); const k = 2; const s = n / k;
      for (let i = 0; i < k; i += 1) for (let j = 0; j < k; j += 1) {
        const v = 208 + Math.round((r() - 0.5) * 18);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(i * s, j * s, s, s);
        groove(ctx, h, n, i * s, j * s, s, 2);
        groove(ctx, h, n, i * s, j * s, 2, s);
      }
    },
  },
  STONE: {
    tile: 1.6, roughness: 0.35, normalScale: 0.25, seed: 14,
    draw: (ctx, n) => {
      const r = rng(14);
      for (let i = 0; i < 900; i += 1) {
        const v = 200 + Math.round((r() - 0.5) * 50);
        ctx.fillStyle = `rgba(${v},${v},${v},0.35)`;
        ctx.beginPath(); ctx.arc(r() * n, r() * n, 1 + r() * 6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(150,150,150,0.25)';
      for (let i = 0; i < 6; i += 1) {
        ctx.lineWidth = 0.5 + r();
        ctx.beginPath(); let x = r() * n; let y = r() * n; ctx.moveTo(x, y);
        for (let k = 0; k < 8; k += 1) { x += (r() - 0.4) * n * 0.12; y += (r() - 0.5) * n * 0.08; ctx.lineTo(x, y); }
        ctx.stroke();
      }
    },
  },
  CONCRETE: {
    tile: 2.4, roughness: 0.55, normalScale: 0.2, seed: 15,
    draw: (ctx, n) => {
      const r = rng(15);
      for (let i = 0; i < 2600; i += 1) {
        const v = 195 + Math.round((r() - 0.5) * 40);
        ctx.fillStyle = `rgba(${v},${v},${v},0.25)`;
        ctx.fillRect(r() * n, r() * n, 1 + r() * 3, 1 + r() * 3);
      }
    },
  },
  CARPET: {
    tile: 0.5, roughness: 0.98, normalScale: 0.5, seed: 16,
    draw: (ctx, n, h) => {
      const r = rng(16);
      for (let y = 0; y < n; y += 2) for (let x = 0; x < n; x += 2) {
        const v = 200 + Math.round((r() - 0.5) * 36);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(x, y, 2, 2);
        h[y * n + x] = 0.3 + r() * 0.4;
      }
    },
  },
  PAINT: {
    tile: 2, roughness: 0.9, normalScale: 0.08, seed: 17,
    draw: (ctx, n) => {
      const r = rng(17);
      for (let i = 0; i < 1200; i += 1) {
        const v = 214 + Math.round((r() - 0.5) * 10);
        ctx.fillStyle = `rgba(${v},${v},${v},0.3)`;
        ctx.fillRect(r() * n, r() * n, 2, 2);
      }
    },
  },
  // Upholstery: a fine basket weave (bouclé/linen read at room distance).
  FABRIC: {
    tile: 6, roughness: 0.95, normalScale: 0.55, seed: 18,
    draw: (ctx, n, h) => {
      const r = rng(18); const c = n / 32;
      for (let j = 0; j < 32; j += 1) for (let i = 0; i < 32; i += 1) {
        const over = (i + j) % 2 === 0;
        const v = (over ? 222 : 196) + Math.round((r() - 0.5) * 14);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(i * c, j * c, c, c);
        for (let yy = Math.floor(j * c); yy < Math.floor((j + 1) * c); yy += 1) {
          for (let xx = Math.floor(i * c); xx < Math.floor((i + 1) * c); xx += 1) h[yy * n + xx] = over ? 0.65 : 0.35;
        }
      }
    },
  },
  // Solid wood (tables, cabinets, frames): long fibres, no joints.
  WOOD_GRAIN: {
    tile: 1, roughness: 0.55, normalScale: 0.25, seed: 19,
    draw: (ctx, n) => { woodFibres(ctx, 0, 0, n, n, rng(19), 'x'); },
  },
  LEATHER: {
    tile: 3, roughness: 0.5, normalScale: 0.35, seed: 20,
    draw: (ctx, n, h) => {
      const r = rng(20);
      for (let i = 0; i < 1800; i += 1) {
        const x = r() * n; const y = r() * n; const rad = 1 + r() * 2.5;
        const v = 200 + Math.round((r() - 0.5) * 30);
        ctx.fillStyle = `rgba(${v},${v},${v},0.5)`;
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
        const idx = Math.floor(y) * n + Math.floor(x);
        if (idx >= 0 && idx < h.length) h[idx] = 0.6;
      }
    },
  },
};

/** Tangent-space normals from a height field (Sobel), wrapped so the texture tiles. */
function normalCanvas(h: Float32Array, n: number) {
  const canvas = document.createElement('canvas');
  canvas.width = n; canvas.height = n;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const img = ctx.createImageData(n, n);
  const at = (x: number, y: number) => h[((y + n) % n) * n + ((x + n) % n)];
  for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * 2;
    const dy = (at(x, y + 1) - at(x, y - 1)) * 2;
    const len = Math.hypot(dx, dy, 1);
    const i = (y * n + x) * 4;
    img.data[i] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
    img.data[i + 1] = Math.round(((dy / len) * 0.5 + 0.5) * 255);
    img.data[i + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

const cache = new Map<string, FinishMaps>();

/**
 * The maps for a pattern at a texture size (the quality tier's budget).
 * Shared by every surface wearing it; callers must NOT dispose them.
 * Returns flat (no maps) when there is no DOM (tests, workers).
 */
export function finishMaps(pattern: SurfacePattern, size: number, anisotropy = 1): FinishMaps {
  const spec = PATTERNS[pattern];
  const key = `${pattern}|${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined') {
    return { map: null, normalMap: null, normalScale: spec.normalScale, tile: spec.tile, roughness: spec.roughness };
  }
  const n = Math.max(128, Math.min(1024, size));
  const { canvas, h } = paint(n, spec.draw);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(normalCanvas(h, n));
  for (const t of [map, normalMap]) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = anisotropy;
    t.generateMipmaps = true;
  }
  const out: FinishMaps = { map, normalMap, normalScale: spec.normalScale, tile: spec.tile, roughness: spec.roughness };
  cache.set(key, out);
  return out;
}

/**
 * Dress a material in a finish. `planMetres` surfaces (floors) repeat per
 * metre; object faces repeat `tile` times per face. The texture objects are
 * shared, so repeat is set on per-material clones that share the image.
 */
export function applyFinish(m: THREE.MeshStandardMaterial, pattern: SurfacePattern | null, size: number, planMetres: boolean, anisotropy = 1) {
  if (!pattern) {
    m.map = null; m.normalMap = null; m.needsUpdate = true;
    return;
  }
  const f = finishMaps(pattern, size, anisotropy);
  if (!f.map || !f.normalMap) { m.roughness = f.roughness; m.needsUpdate = true; return; }
  const rep = planMetres ? 1 / f.tile : f.tile;
  const key = `${pattern}|${size}|${rep}`;
  m.map = sharedRepeat(f.map, rep, `m|${key}`);
  m.normalMap = sharedRepeat(f.normalMap, rep, `n|${key}`);
  m.normalScale.set(f.normalScale, f.normalScale);
  m.roughness = f.roughness;
  m.needsUpdate = true;
}

const repeats = new Map<string, THREE.Texture>();
function sharedRepeat(base: THREE.Texture, rep: number, key: string) {
  let t = repeats.get(key);
  if (!t) {
    t = base.clone();
    t.source = base.source; // share the pixels, not a copy
    t.repeat.set(rep, rep);
    t.needsUpdate = true;
    repeats.set(key, t);
  }
  return t;
}

/** What a catalogue material looks like, from its own category and name (no per-product data). */
export function patternOfMaterial(m: { category: string; code: string; name: string; colorFamily: string | null } | undefined, surface: 'FLOOR' | 'WALL' | 'CEILING'): SurfacePattern | null {
  if (!m) return null;
  const text = `${m.code} ${m.name}`.toLowerCase();
  if (surface !== 'FLOOR') return m.category === 'TILE' || /tile/.test(text) ? 'TILE' : 'PAINT';
  if (/herringbone|chevron|parquet/.test(text)) return 'WOOD_HERRINGBONE';
  if (m.category === 'TILE' || /tile/.test(text)) return 'TILE';
  if (m.category === 'STONE' || /stone|marble/.test(text)) return 'STONE';
  if (/concrete|cement/.test(text)) return 'CONCRETE';
  if (/carpet|rug/.test(text)) return 'CARPET';
  if (m.colorFamily === 'wood' || /oak|walnut|wood|timber/.test(text)) return 'WOOD_PLANK';
  return null;
}

/**
 * What a piece's slot is made of, from the piece's kind, the slot and its
 * colour — a generic rule, never a per-asset table.
 */
export function patternOfSlot(kind: string, slot: string, color: string, metalness = 0): SurfacePattern | null {
  if (metalness > 0.5) return null;
  const c = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  const woodTone = hsl.h > 0.04 && hsl.h < 0.13 && hsl.s > 0.18 && hsl.l > 0.12 && hsl.l < 0.72;
  if (/linen|mattress|duvet|pillow|bedding/.test(slot)) return 'FABRIC';
  // A bed's body is its frame: wood when it looks like wood, else upholstered.
  if (/BED/.test(kind) && /body|frame|headboard/.test(slot)) return woodTone ? 'WOOD_GRAIN' : 'FABRIC';
  const upholstered = /SOFA|ARMCHAIR|RECLINER|OTTOMAN|POUF/.test(kind);
  if (upholstered && /body|cushion|seat|upholstery/.test(slot)) return 'FABRIC';
  if (/RUG/.test(kind)) return 'CARPET';
  if (/leather/.test(slot)) return 'LEATHER';
  if (woodTone && /legs|frame|top|body|shelf|front|door|plinth|base|headboard/.test(slot)) return 'WOOD_GRAIN';
  return null;
}
