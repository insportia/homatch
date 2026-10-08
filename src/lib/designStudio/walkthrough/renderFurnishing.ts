// THE SELECTED DESIGN'S FURNISHING, CARRIED WITH THE SPACE READ FROM IT.
//
// When a walkthrough's space is read from the selected render (walkthrough.ts readSpace: the render, its measured
// plan view, the customer's own pictures), the same reading traces every piece the render shows: where it stands
// (its pixels, unprojected through the render's measured frame), which way its front faces (the middle of its front
// edge, traced too), its size, colours and form. Those pieces are the design the customer chose. This file carries
// them, unchanged in meaning, from the reading's plan metres into the built scene's coordinates, so the walkthrough
// furnishes the space with exactly what the render shows instead of asking for a second, separate plan.
//
// Nothing is invented here: no piece is added, none re-typed. Pure (Deno + Node).

import type { ReconObject, ReconSurface, Reconstruction } from '../reconstructRead.ts';
import type { BuildPlan } from './build.ts';

export const FURNISHING_VERSION = 'ds-render-furnishing-1';
const MAX_PIECES = 120;

export interface RenderFurnishing {
  version: typeof FURNISHING_VERSION;
  /** The render it was traced on (the walkthrough's selected design) and that picture's index in the reading. */
  renderId: string;
  image: number;
  /** The pieces, in the built scene's metres; `geometry` says whether each stands where its pixels put it. */
  objects: ReconObject[];
  surfaces: ReconSurface[];
  palette: string[];
  styleWords: string[];
  frameColor: string | null;
  /** How many pieces stand where their pixels put them, of how many were read in the render. */
  traced: number;
  read: number;
  /** The render's own light, measured from its pixels (renderLighting.ts); null when it could not be measured. */
  lighting?: BuildPlan['lighting'] | null;
}

type P = [number, number];
interface Axis { scale: number; offset: number }
export interface SceneTransform { x: Axis; y: Axis }

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const bounds = (poly: P[]) => {
  const xs = poly.map((p) => p[0]); const ys = poly.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

/**
 * How the reading's plan metres map onto the built scene: per axis a scale (its sign says whether the axis was
 * flipped on the way) and an offset, from the rooms both share (room `key` ↔ floor `r-key`). Null when fewer than
 * two rooms can be paired or the pairs disagree (then nothing is carried: better no furnishing than a shifted one).
 */
export function sceneTransform(recon: Pick<Reconstruction, 'rooms'>, floors: Array<{ id: string; polygon: Array<{ x: number; y: number }> }>): SceneTransform | null {
  const byId = new Map(floors.map((f) => [f.id, f]));
  const pairs = recon.rooms
    .map((r) => ({ a: bounds(r.polygon), f: byId.get(`r-${r.key}`) }))
    .filter((p): p is { a: ReturnType<typeof bounds>; f: { id: string; polygon: Array<{ x: number; y: number }> } } => !!p.f && p.f.polygon.length >= 3)
    .map((p) => ({ a: p.a, b: bounds(p.f.polygon.map((q) => [q.x, q.y] as P)) }));
  if (pairs.length < 2) return null;
  const axis = (lo: (b: ReturnType<typeof bounds>) => number, hi: (b: ReturnType<typeof bounds>) => number): Axis | null => {
    // Each room's extent pairs either way round (an axis may be flipped): the sign the rooms agree on wins.
    const slopes: number[] = [];
    for (const { a, b } of pairs) {
      const da = hi(a) - lo(a); const db = hi(b) - lo(b);
      if (da > 0.2 && db > 0.2) slopes.push(db / da);
    }
    if (!slopes.length) return null;
    const k = median(slopes);
    if (!(k > 0.5 && k < 2)) return null;
    // Flipped or not: whichever keeps every room's extent in place.
    const fit = (sign: 1 | -1) => {
      const offs = pairs.map(({ a, b }) => (sign > 0 ? lo(b) - k * lo(a) : lo(b) + k * hi(a)));
      const off = median(offs);
      const err = pairs.reduce((s, { a, b }) => s + Math.abs((sign > 0 ? k * lo(a) + off : -k * hi(a) + off) - lo(b)), 0) / pairs.length;
      return { scale: sign * k, offset: off, err };
    };
    const best = [fit(1), fit(-1)].sort((p, q) => p.err - q.err)[0];
    return best.err <= 0.15 ? { scale: best.scale, offset: best.offset } : null;
  };
  const x = axis((b) => b.minX, (b) => b.maxX);
  const y = axis((b) => b.minY, (b) => b.maxY);
  return x && y ? { x, y } : null;
}

const apply = (t: SceneTransform, p: P): P => [Math.round((t.x.scale * p[0] + t.x.offset) * 1000) / 1000, Math.round((t.y.scale * p[1] + t.y.offset) * 1000) / 1000];

/** A facing (degrees clockwise from +y) through the transform: a flipped axis mirrors it. */
export function carryFacing(t: SceneTransform, deg: number): number {
  const r = (deg * Math.PI) / 180;
  const dx = Math.sin(r) * Math.sign(t.x.scale); const dy = Math.cos(r) * Math.sign(t.y.scale);
  return Math.round((((Math.atan2(dx, dy) * 180) / Math.PI) + 360) % 360);
}

/**
 * The render's pieces from a reading whose space has been built (`floors` from the canonical scene). Only pieces
 * the reading saw in the render itself; bounded. Null without a render in the reading or without a transform.
 */
export function furnishingFromReading(
  recon: Reconstruction, floors: Array<{ id: string; polygon: Array<{ x: number; y: number }> }>, renderId: string, image: number,
  lighting: BuildPlan['lighting'] | null = null,
): RenderFurnishing | null {
  if (!Number.isInteger(image) || image < 0) return null;
  const t = sceneTransform(recon, floors);
  if (!t) return null;
  const inRender = recon.objects.filter((o) => o.seenIn.includes(image) || o.px?.image === image).slice(0, MAX_PIECES);
  const objects = inRender.map((o): ReconObject => ({
    ...o,
    at: apply(t, o.at),
    facingDeg: carryFacing(t, o.facingDeg),
    // Traces stay with the piece (they are what makes its pose evidence, not a guess).
    px: o.px ? { image: o.px.image, points: [...o.px.points] } : null,
  }));
  return {
    version: FURNISHING_VERSION, renderId, image, objects,
    surfaces: recon.surfaces.map((s) => ({ ...s })), palette: recon.palette.slice(0, 6), styleWords: recon.styleWords.slice(0, 4), frameColor: recon.frameColor ?? null,
    traced: objects.filter((o) => o.geometry === 'PIXELS').length, read: inRender.length,
    lighting: lighting ? { timeOfDay: lighting.timeOfDay, temperature: lighting.temperature, interiorIntensity: lighting.interiorIntensity } : null,
  };
}

/**
 * What the reader is told about the selected render (walkthrough.ts readSpace): it is the design the walkthrough is
 * furnished with, piece for piece, so every piece it shows is read on it and traced (the reader's SYSTEM says how).
 */
export function renderTraceBrief(image: number, view: number | null): string {
  return `THE SELECTED DESIGN: picture ${image} is the design the customer chose. The walkthrough is furnished with exactly what it shows, so:
- Read EVERY piece picture ${image} shows as its own object (each chair, stool, bedside table, armchair, plant, rug, lamp, appliance — never merge two pieces into one, never skip a small one), with seenIn including ${image}.
- Trace each on picture ${image}: pxImage ${image}, atPx the centre of its TOP surface, frontPx the middle of the FRONT edge of that top (a chair's seat front, a bed's foot, a wardrobe's doors, a kitchen run's worktop edge); heightM its real height.
- Give each piece its seen size, form, colour and material; a round table is ROUND, a tub chair ROUNDED.
- Doors and openings: trace each on picture ${image} at floor level (atPx) where it is visible.${view != null ? `
- Plan view ${view} is picture ${image} redrawn from directly above, from its measured camera: trace every ROOM there.` : ''}`;
}

/** A stored light, only when every part of it is one the build knows. */
function readLighting(raw: unknown): BuildPlan['lighting'] | null {
  const l = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!l || !['DAY', 'EVENING', 'NIGHT'].includes(String(l.timeOfDay)) || !['WARM', 'NEUTRAL', 'COOL'].includes(String(l.temperature))) return null;
  const i = Number(l.interiorIntensity);
  return { timeOfDay: l.timeOfDay as BuildPlan['lighting']['timeOfDay'], temperature: l.temperature as BuildPlan['lighting']['temperature'], interiorIntensity: Number.isFinite(i) ? Math.max(0, Math.min(1, i)) : 0.8 };
}

/** A stored furnishing, bounded; anything malformed reads as none. */
export function readFurnishing(raw: unknown): RenderFurnishing | null {
  const o = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!o || o.version !== FURNISHING_VERSION || typeof o.renderId !== 'string' || !Array.isArray(o.objects)) return null;
  const objects = (o.objects as ReconObject[]).filter((x) => x && Array.isArray(x.at) && x.at.length === 2 && x.at.every(Number.isFinite)
    && Number.isFinite(x.widthM) && Number.isFinite(x.depthM) && Number.isFinite(x.heightM) && typeof x.type === 'string').slice(0, MAX_PIECES);
  return {
    version: FURNISHING_VERSION, renderId: o.renderId, image: Number.isInteger(o.image) ? o.image as number : 0, objects,
    surfaces: Array.isArray(o.surfaces) ? (o.surfaces as ReconSurface[]).slice(0, 40) : [],
    palette: Array.isArray(o.palette) ? (o.palette as string[]).filter((c) => typeof c === 'string').slice(0, 6) : [],
    styleWords: Array.isArray(o.styleWords) ? (o.styleWords as string[]).filter((w) => typeof w === 'string').slice(0, 4) : [],
    frameColor: typeof o.frameColor === 'string' ? o.frameColor : null,
    traced: Number(o.traced) || 0, read: Number(o.read) || objects.length,
    lighting: readLighting(o.lighting),
  };
}
