// WHAT THE PICTURE SHOWED OF A PIECE — its size, its form, its second colour.
//
// A piece rebuilt from a picture stands for something the customer SAW: a
// 2.6 m curved teal sofa is not "the catalogue's 2.2 m sofa in teal". The
// catalogue asset still says what the piece IS (its family, what it can do in
// the walkthrough, its licence); the shape says how it LOOKED, and is drawn,
// collided and walked around at that size.
//
// Parametric (HOMATCH-drawn) pieces take the seen size exactly. A catalogue
// MODEL is scaled toward it only within a bound, so a real object is never
// stretched into a caricature of itself.
//
// Scene data only: a shape is a few numbers on the design, never a copy of
// any catalogue file.

import type { CatalogAsset } from './catalog.ts';
import { OBJECT_FORMS, type ObjectForm } from './reconstructRead.ts';

/**
 * Forms a DESIGN gives a piece (walkthrough/designGraph.ts), beyond what a reading of a picture names: a framed
 * shaker kitchen, a deep club chair, a built-in television wall, an upholstered bed, a built-in wardrobe, a fluted
 * vanity, a bordered rug. Drawn by procedural.ts (and the factory's furniture.py) as their own geometry.
 */
export const DESIGN_FORMS = ['SHAKER', 'CLUB', 'TV_WALL', 'UPHOLSTERED', 'BUILT_IN', 'FLUTED', 'BORDERED'] as const;
export type DesignForm = typeof DESIGN_FORMS[number];
const ALL_FORMS: readonly string[] = [...OBJECT_FORMS, ...DESIGN_FORMS];

export interface ObjectShape {
  widthM: number;
  depthM: number;
  heightM: number;
  form: ObjectForm | DesignForm | null;
  /** The second colour that defines it (#rrggbb): bedding, a worktop, a pot, a frame. */
  secondary: string | null;
}

const HEX = /^#[0-9a-f]{6}$/i;
const metres = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v * 1000) / 1000 : null);

/** A stored shape, bounded; anything malformed reads as no shape (the catalogue piece as it is). */
export function normalizeShape(raw: unknown): ObjectShape | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const widthM = metres(o.widthM, 0.05, 8);
  const depthM = metres(o.depthM, 0.02, 8);
  const heightM = metres(o.heightM, 0.005, 4);
  if (widthM === null || depthM === null || heightM === null) return undefined;
  return {
    widthM, depthM, heightM,
    form: ALL_FORMS.includes(String(o.form)) ? o.form as ObjectForm | DesignForm : null,
    secondary: typeof o.secondary === 'string' && HEX.test(o.secondary) ? o.secondary.toLowerCase() : null,
  };
}

/** How far a catalogue MODEL may be scaled toward what was seen, per axis. */
export const MODEL_SCALE_MIN = 0.7;
export const MODEL_SCALE_MAX = 1.45;

const clampScale = (seen: number, own: number) => Math.min(MODEL_SCALE_MAX, Math.max(MODEL_SCALE_MIN, seen / Math.max(own, 0.01)));

/** Per-axis scale a catalogue model is drawn at for this piece (1 when it has no shape). */
export function modelScale(asset: CatalogAsset, shape: ObjectShape | undefined | null): { x: number; y: number; z: number } {
  if (!shape || asset.procedural) return { x: 1, y: 1, z: 1 };
  return { x: clampScale(shape.widthM, asset.widthM), y: clampScale(shape.heightM, asset.heightM), z: clampScale(shape.depthM, asset.depthM) };
}

const cache = new WeakMap<CatalogAsset, Map<string, CatalogAsset>>();

/**
 * The asset as this piece is drawn and collided: at the seen size for a
 * parametric piece, at the bounded scale for a model. The same object for the
 * same asset and shape (placement and navigation call this often).
 */
export function shapedAsset(asset: CatalogAsset, obj: { shape?: ObjectShape | null }): CatalogAsset {
  const shape = obj.shape;
  if (!shape) return asset;
  const key = `${shape.widthM}|${shape.depthM}|${shape.heightM}`;
  let byShape = cache.get(asset);
  if (!byShape) { byShape = new Map(); cache.set(asset, byShape); }
  let out = byShape.get(key);
  if (!out) {
    if (asset.procedural) {
      out = { ...asset, widthM: shape.widthM, depthM: shape.depthM, heightM: shape.heightM };
    } else {
      const s = modelScale(asset, shape);
      out = { ...asset, widthM: asset.widthM * s.x, depthM: asset.depthM * s.z, heightM: asset.heightM * s.y };
    }
    byShape.set(key, out);
  }
  return out;
}

/**
 * Which slot of a parametric piece wears the colour that was seen, and which
 * the second colour: a plant's colour is its leaves (its pot is the second), a
 * table's is its top, a bed's is its frame (the bedding is the second).
 */
export const COLOUR_SLOTS: Record<string, { main: string; second: string | null }> = {
  PLANT: { main: 'leaves', second: 'pot' },
  PLANTER: { main: 'pot', second: 'leaves' },
  TABLE: { main: 'top', second: 'legs' },
  ROUND_TABLE: { main: 'top', second: 'legs' },
  BED: { main: 'body', second: 'linen' },
  KITCHEN_RUN: { main: 'body', second: 'top' },
  VANITY: { main: 'body', second: 'top' },
  LAMP: { main: 'body', second: 'shade' },
  SOFA: { main: 'body', second: 'cushion' },
  ARMCHAIR: { main: 'body', second: 'legs' },
  CHAIR: { main: 'body', second: 'legs' },
  RUG: { main: 'body', second: 'accent' },
};

/** The slot colours a piece is drawn in, with what was seen applied to the right parts. */
export function seenColors(asset: CatalogAsset, base: Record<string, string>, seen: string | null, shape: ObjectShape | undefined | null): Record<string, string> {
  const kind = asset.procedural?.kind ?? '';
  const slots = COLOUR_SLOTS[kind];
  const out = { ...base };
  if (seen && slots) out[slots.main] = seen;
  else if (seen) out[asset.materialSlots.find((s) => s.id === 'body' || s.id === 'top' || s.id === 'pot')?.id ?? 'body'] = seen;
  if (shape?.secondary && slots?.second) out[slots.second] = shape.secondary;
  return out;
}
