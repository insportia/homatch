// WHICH TEXTURE MAPS AN IMPORTED MATERIAL WEARS, AND HOW OFTEN THEY REPEAT.
//
// Imported (licensed) materials carry their look in maps, not in a colour:
// their baseColor is white and the albedo/normal/ORM JPEGs are listed per
// resolution in pbr.mapsByRes. This file decides — purely, with no three.js
// and no network — which resolution a device gets and how many times a tile
// repeats per metre. The renderer (canvas/pbrTextures.ts) does the loading.
//
// Resolution: a LOW-tier device gets the material's mobile variant ('1k').
// Every other tier gets the desktop variant ('2k' when it exists), unless
// that is wider than the tier's maxTextureSize, in which case the mobile one.
//
// Repeat: design surfaces carry plan-metre UVs (floors, ceilings, and wall
// faces — SceneController lays those out in metres too), so a texture that
// covers `physicalSizeM` metres repeats 1 / physicalSizeM times per UV unit.

import type { Pbr, PbrMapSet } from './catalog.ts';

export type PbrTier = 'HIGH' | 'BALANCED' | 'LOW';

/**
 * How metallic a catalogue surface is. Imported materials carry metalness 1 as a MULTIPLIER on
 * their ORM map, and that slot is sometimes a packed AO/roughness/metal map and sometimes a plain
 * greyscale roughness map — whose blue channel would turn wood, tile and plaster into metal. Only a
 * material catalogued as METAL is metal; everything else is dielectric.
 */
export function surfaceMetalness(mat: { category?: string | null; pbr: { metalness?: number | null } }): number {
  if (String(mat.category ?? '').toUpperCase() !== 'METAL') return 0;
  const m = mat.pbr.metalness;
  return typeof m === 'number' && Number.isFinite(m) ? Math.max(0, Math.min(1, m)) : 1;
}

/** The pixel edge a resolution label stands for ('1k' → 1024, '2k' → 2048). */
export function resolutionEdge(res: string): number {
  const m = /^(\d+)k$/i.exec(res.trim());
  return m ? Number(m[1]) * 1024 : Number.POSITIVE_INFINITY;
}

/** True when a material's look lives in texture maps (an imported material). */
export function hasPbrMaps(pbr: Pbr | null | undefined): boolean {
  if (!pbr?.mapsByRes) return false;
  return Object.values(pbr.mapsByRes).some((s) => !!s?.albedo);
}

/** The resolution label a device should load, or null when there is none. */
export function pbrResolution(pbr: Pbr, tier: PbrTier, maxTextureSize = Number.POSITIVE_INFINITY): string | null {
  const byRes = pbr.mapsByRes;
  if (!byRes) return null;
  const usable = (r: string | undefined): r is string => !!r && !!byRes[r]?.albedo;
  const m = pbr.variants?.mobile;
  const d = pbr.variants?.desktop;
  const mobile = usable(m) ? m : null;
  const desktop = usable(d) ? d : null;
  // The smallest available resolution: what a constrained device falls back to.
  const smallest = Object.keys(byRes).filter(usable).sort((a, b) => resolutionEdge(a) - resolutionEdge(b))[0] ?? null;
  const low = mobile ?? smallest;
  if (tier === 'LOW') return low;
  const wanted = desktop ?? mobile ?? smallest;
  if (wanted && resolutionEdge(wanted) <= maxTextureSize) return wanted;
  return low;
}

export interface PbrSelection {
  res: string;
  albedo: string;
  normal: string | null;
  orm: string | null;
  /** Repeats per UV unit, [u, v]. */
  repeat: [number, number];
  normalScale: number;
  /** Stable identity of what is shown: same signature, same look. */
  signature: string;
}

/** Repeats per metre from the tile's physical size (or repeatM), never zero or negative. */
export function pbrRepeat(pbr: Pick<Pbr, 'physicalSizeM' | 'repeatM' | 'controls'>): [number, number] {
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
  const user = pbr.controls?.repeatM;
  const size = pbr.physicalSizeM;
  let sx: number; let sy: number;
  if (ok(user) && ok(pbr.repeatM) && user !== pbr.repeatM && size && ok(size[0]) && ok(size[1])) {
    // The editor changed the tile width: keep the tile's proportions.
    sx = user; sy = (size[1] / size[0]) * user;
  } else if (size && ok(size[0]) && ok(size[1])) {
    sx = size[0]; sy = size[1];
  } else if (ok(user)) {
    sx = user; sy = user;
  } else if (ok(pbr.repeatM)) {
    sx = pbr.repeatM; sy = pbr.repeatM;
  } else {
    sx = 1; sy = 1;
  }
  const round = (n: number) => Math.round(n * 10000) / 10000;
  return [round(1 / sx), round(1 / sy)];
}

/**
 * The maps an imported material should wear on this device, or null for a
 * hand-made material (which keeps the flat-colour path). `uvMetres` is false
 * for surfaces whose UVs are the model's own (uploaded model parts): those
 * repeat once per UV unit.
 */
export function selectPbrMaps(pbr: Pbr | null | undefined, tier: PbrTier, maxTextureSize = Number.POSITIVE_INFINITY, uvMetres = true): PbrSelection | null {
  if (!pbr || !hasPbrMaps(pbr)) return null;
  const res = pbrResolution(pbr, tier, maxTextureSize);
  if (!res) return null;
  const set = pbr.mapsByRes?.[res] as PbrMapSet | undefined;
  if (!set?.albedo) return null;
  const repeat: [number, number] = uvMetres ? pbrRepeat(pbr) : [1, 1];
  const normalScale = typeof pbr.controls?.normalScale === 'number' && Number.isFinite(pbr.controls.normalScale) ? pbr.controls.normalScale : 1;
  const normal = set.normal ?? null;
  const orm = set.orm ?? null;
  return {
    res, albedo: set.albedo, normal, orm, repeat, normalScale,
    signature: `${set.albedo}|${normal ?? ''}|${orm ?? ''}|${repeat[0]}x${repeat[1]}|${normalScale}`,
  };
}
