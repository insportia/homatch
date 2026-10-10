// THE WALKTHROUGH'S FURNISHING, FROM THE SELECTED RENDER'S OWN PIECES.
//
// renderFurnishing.ts carries the pieces the render shows into the built scene. Here they become the walkthrough's
// build plan through the same deterministic half the photo reconstruction uses (reconstruction.ts buildDesign: each
// piece matched to the catalogue or drawn by HOMATCH at its seen size, form and colour, settled where it was seen,
// back to the wall it stands against, never across a door), then turned to face what its context says it faces
// (facing.ts), then locked where it stands so the walkability build (build.ts) nudges a piece only as far as a
// clear route needs. What the render shows is what is built; what could not stand is reported, never invented.
// Pure (Deno + Node).

import type { CatalogAsset, CatalogMaterial } from '../catalog.ts';
import type { DesignState, ObjectInstance } from '../designState.ts';
import type { ObjectShape } from '../objectShape.ts';
import { buildDesign, emptyCorrections } from '../reconstruction.ts';
import type { ReconObject, Reconstruction } from '../reconstructRead.ts';
import { BODY_RADIUS_M, buildWalkModel } from '../navigation.ts';
import type { SpaceModel } from '../space.ts';
import type { BuildPlan, BuildRoom } from './build.ts';
import { correctFacing, type FacingCorrection } from './facing.ts';
import type { RenderFurnishing } from './renderFurnishing.ts';

/** How far the walkability build may nudge a piece: one placed from its pixels barely, one placed from an estimate more. */
export const TRACED_LOCK = { maxShiftM: 0.35, maxTurnDeg: 12 } as const;
export const ESTIMATED_LOCK = { maxShiftM: 0.8, maxTurnDeg: 30 } as const;
/**
 * The clearance a render-furnished walk keeps (build.ts walkRadiusM): the walker's body (navigation.ts
 * BODY_RADIUS_M) plus 3 cm, i.e. a 0.5 m clear way everywhere. A real home's compact kitchen is walked as the
 * render shows it; the comfortable 0.7 m standard would move or remove what the customer chose.
 */
export const RENDER_WALK_RADIUS_M = BODY_RADIUS_M + 0.03;

export interface PieceLook { shape: ObjectShape | null; colorOverride: string | null; provenance: ObjectInstance['provenance'] }

export interface RenderPlan {
  plan: BuildPlan;
  /** What each piece looks like (keyed by its reading key = BuildItem.refKey), re-applied after the walkability build. */
  looks: Map<string, PieceLook>;
  /** The render's surfaces as the design states them (floor patterns, materials, colours), by surface id. */
  surfaces: DesignState['surfaces'];
  frames: string | null;
  corrections: FacingCorrection[];
  /** Built-in runs shortened to the wall they stand on (recorded, never silent). */
  fitted: WallFit[];
  /** Pieces the render showed that matched nothing, or had nowhere to stand (reported, never invented). */
  unmatched: string[];
  unplaced: string[];
  read: number;
  traced: number;
}

export function planFromFurnishing(
  f: RenderFurnishing, space: SpaceModel, assets: CatalogAsset[], materials: CatalogMaterial[],
  look: Pick<BuildPlan, 'lighting' | 'styleCode'>,
): RenderPlan {
  const recon: Reconstruction = {
    version: f.version, view: 'AERIAL', scaleConfidence: 1, scaleEvidence: null, ceilingHeightM: null,
    rooms: [], openings: [], objects: f.objects, surfaces: f.surfaces, palette: f.palette, styleWords: f.styleWords,
    cameras: [], unknowns: [], usesPlan: false, fidelity: null, frameColor: f.frameColor,
  };
  const byCode = new Map(assets.map((a) => [a.code, a]));
  const fitted = fitToWalls(joinKitchenRuns(recon.objects), space);
  recon.objects = fitted.objects;
  const built = buildDesign(recon, emptyCorrections(), space, assets, materials, { asSeen: true });
  const turned = correctFacing(built.state, space, byCode);
  const traced = new Set(f.objects.filter((o) => o.geometry === 'PIXELS').map((o) => o.key));
  const looks = new Map<string, PieceLook>();
  const rooms = new Map<string, BuildRoom>();
  for (const o of turned.state.objects) {
    const room = space.rooms.find((r) => r.id === o.roomId);
    const key = o.provenance?.ref;
    if (!room || !key) continue;
    const entry = rooms.get(room.id) ?? {
      roomId: room.id, floorMaterial: null, floorColor: null, wallMaterial: null, wallColor: null, wallFinish: null, accent: null, ceilingColor: null, items: [],
    };
    entry.items.push({
      code: o.assetId, type: o.provenance?.detectedType ?? 'OTHER', scale: 1, color: o.colorOverride, origin: 'PLANNED', refKey: key,
      pose: { x: Math.round((o.position.x - room.bounds.minX) * 1000) / 1000, y: Math.round((o.position.z - room.bounds.minY) * 1000) / 1000, rotationDeg: Math.round((o.rotationY * 180) / Math.PI * 100) / 100 },
      lock: traced.has(key) ? { ...TRACED_LOCK } : { ...ESTIMATED_LOCK },
      ...(o.shape ? { shape: o.shape } : {}),
    });
    rooms.set(room.id, entry);
    looks.set(key, { shape: o.shape ?? null, colorOverride: o.colorOverride, provenance: o.provenance });
  }
  return {
    plan: { lighting: look.lighting, palette: f.palette, styleCode: look.styleCode, rooms: [...rooms.values()] },
    looks, surfaces: turned.state.surfaces, frames: turned.state.frames ?? null, corrections: turned.corrections, fitted: fitted.fitted,
    unmatched: built.report.unmatched.map((u) => u.key), unplaced: built.report.unplaced.map((u) => u.key), read: f.read, traced: f.traced,
  };
}

/**
 * An L- or U-shaped kitchen read as straight runs meets itself in its corners: each run is read to the full length
 * of its wall, so two runs overlap where they meet. A run whose end lies inside a perpendicular run of the same room
 * is shortened to meet that run's back edge (its other end, against its own wall, stays exactly where it was seen),
 * so the corner is one corner and neither run is pushed off its wall to make room.
 */
const JOIN_GAP_M = 0.01;
export function joinKitchenRuns(objects: ReconObject[]): ReconObject[] {
  const runs = objects.filter((o) => o.type === 'KITCHEN_RUN');
  if (runs.length < 2) return objects;
  const rect = (o: ReconObject) => {
    const r = (o.facingDeg * Math.PI) / 180; const f = [Math.sin(r), Math.cos(r)]; const w = [f[1], -f[0]];
    return { f, w, c: o.at, hw: o.widthM / 2, hd: o.depthM / 2 };
  };
  const out = new Map(objects.map((o) => [o.key, o]));
  for (const a of runs) {
    for (const b of runs) {
      if (a === b || a.room !== b.room) continue;
      const A = rect(out.get(a.key)!); const B = rect(out.get(b.key)!);
      if (Math.abs(A.w[0] * B.w[0] + A.w[1] * B.w[1]) > 0.3) continue; // not perpendicular
      // B's footprint in A's own axes (along its length, across its depth).
      const corners = [-1, 1].flatMap((i) => [-1, 1].map((j) => [B.c[0] + i * B.hw * B.w[0] + j * B.hd * B.f[0], B.c[1] + i * B.hw * B.w[1] + j * B.hd * B.f[1]]));
      const al = corners.map((p) => (p[0] - A.c[0]) * A.w[0] + (p[1] - A.c[1]) * A.w[1]);
      const ac = corners.map((p) => (p[0] - A.c[0]) * A.f[0] + (p[1] - A.c[1]) * A.f[1]);
      const lo = Math.min(...al); const hi = Math.max(...al);
      if (Math.max(...ac) <= -A.hd + 0.05 || Math.min(...ac) >= A.hd - 0.05) continue; // not across A's depth
      if (hi <= -A.hw + 0.05 || lo >= A.hw - 0.05) continue; // not along A's length
      // Which end of A runs into B: A stops where B begins, the corner is B's.
      const end = lo + hi > 0 ? 1 : -1;
      const from = end > 0 ? -A.hw : Math.max(-A.hw, hi + JOIN_GAP_M);
      const to = end > 0 ? Math.min(A.hw, lo - JOIN_GAP_M) : A.hw;
      if (to - from < 0.4) continue;
      const mid = (from + to) / 2;
      const cur = out.get(a.key)!;
      out.set(a.key, { ...cur, widthM: Math.round((to - from) * 1000) / 1000, at: [Math.round((A.c[0] + mid * A.w[0]) * 1000) / 1000, Math.round((A.c[1] + mid * A.w[1]) * 1000) / 1000] });
    }
  }
  return objects.map((o) => out.get(o.key)!);
}

/** Pieces built along a wall from end to end: read a little long, they are shortened, not pushed off their wall. */
const BUILT_IN = new Set(['KITCHEN_RUN', 'WARDROBE', 'SHELVING', 'TV_UNIT', 'DRESSER', 'VANITY']);
/** How far from `base` along ±`w` the way is clear of walls (up to `max`). */
function reachFrom(base: number[], w: number[], dir: 1 | -1, max: number, solid: (x: number, y: number) => boolean): number {
  for (let t = 0; t <= max + 0.005; t += 0.02) if (solid(base[0] + dir * t * w[0], base[1] + dir * t * w[1])) return Math.max(0, t - 0.02);
  return max;
}
/** At most this share of a run is cut to fit (more means the reading put it somewhere else, left to the build). */
const MAX_FIT_CUT = 0.35;
export interface WallFit { key: string; fromWidthM: number; toWidthM: number }

/**
 * A built-in run read longer than the wall it stands on (the reading's metres are an estimate; a kitchen run is
 * as long as its wall allows) is shortened to the free stretch of that wall, keeping the end that fits where it
 * was seen. Measured along the run's back line against the walls of the built space.
 */
export function fitToWalls(objects: ReconObject[], space: SpaceModel): { objects: ReconObject[]; fitted: WallFit[] } {
  const walls = buildWalkModel(space, [], new Map()).walls;
  const solid = (x: number, y: number) => walls.some((o) => {
    const c = Math.cos(o.angle); const s = Math.sin(o.angle); const dx = x - o.cx; const dy = y - o.cy;
    return Math.abs(dx * c + dy * s) <= o.hw + 0.01 && Math.abs(-dx * s + dy * c) <= o.hd + 0.01;
  });
  const fitted: WallFit[] = [];
  const out = objects.map((o) => {
    if (!BUILT_IN.has(o.type) || o.widthM < 0.6) return o;
    const r = (o.facingDeg * Math.PI) / 180; const f = [Math.sin(r), Math.cos(r)]; const w = [f[1], -f[0]];
    // The run's centre line, a few centimetres in front of its back (the back itself touches the wall).
    const base = [o.at[0], o.at[1]];
    const reach = (dir: 1 | -1) => {
      for (let t = 0; t <= o.widthM / 2 + 0.005; t += 0.02) {
        const x = base[0] + dir * t * w[0]; const y = base[1] + dir * t * w[1];
        if (solid(x, y)) return Math.max(0, t - 0.02);
      }
      return o.widthM / 2;
    };
    const a = reach(-1); const b = reach(1);
    if (a >= o.widthM / 2 - 0.01 && b >= o.widthM / 2 - 0.01) return o;
    // A run is as long as its wall allows (cut); a freestanding piece moves along the wall first, cut only if the
    // stretch is shorter than the piece.
    const hw = o.widthM / 2;
    let lo = -Math.min(a, hw); let hi = Math.min(b, hw);
    if (o.type !== 'KITCHEN_RUN') {
      if (a < hw && b >= hw) { const far = reachFrom(base, w, 1, 2 * hw - a, solid); lo = -a; hi = Math.min(far, -a + o.widthM); }
      else if (b < hw && a >= hw) { const far = reachFrom(base, w, -1, 2 * hw - b, solid); hi = b; lo = Math.max(-far, b - o.widthM); }
    }
    const width = hi - lo;
    if (width < o.widthM * (1 - MAX_FIT_CUT)) return o;
    const mid = (lo + hi) / 2;
    fitted.push({ key: o.key, fromWidthM: o.widthM, toWidthM: Math.round(width * 1000) / 1000 });
    return { ...o, widthM: Math.round(width * 1000) / 1000, at: [Math.round((base[0] + mid * w[0]) * 1000) / 1000, Math.round((base[1] + mid * w[1]) * 1000) / 1000] as [number, number] };
  });
  return { objects: out, fitted };
}

/**
 * The walkability build's result wearing the render's look: each piece the plan placed gets back its seen shape,
 * colour and provenance (the build places catalogue codes; the look is the render's), the render's surfaces are
 * laid on its rooms, and every piece is turned once more to its context (a nudge for a clear route never leaves a
 * chair facing away from its table).
 */
export function dressBuilt(
  state: DesignState, items: Array<{ refKey?: string | null; instanceId: string | null }>, rp: RenderPlan, space: SpaceModel, assets: Map<string, CatalogAsset>,
): { state: DesignState; corrections: FacingCorrection[] } {
  const byInstance = new Map(items.filter((i) => i.refKey && i.instanceId).map((i) => [i.instanceId!, i.refKey!]));
  const objects = state.objects.map((o) => {
    const key = byInstance.get(o.instanceId);
    const look = key ? rp.looks.get(key) : undefined;
    if (!look) return o;
    const { generated: _drop, ...rest } = o;
    // The seen form and colours; the size the walk was proven at (a piece resized to open a way stays resized).
    const shape = look.shape ? { ...look.shape, ...(o.shape ? { widthM: o.shape.widthM, depthM: o.shape.depthM, heightM: o.shape.heightM } : {}) } : o.shape;
    return { ...rest, ...(shape ? { shape } : {}), colorOverride: look.colorOverride ?? o.colorOverride, ...(look.provenance ? { provenance: look.provenance } : {}) };
  });
  const surfaces = { ...state.surfaces, ...rp.surfaces };
  const dressed: DesignState = { ...state, objects, surfaces, ...(rp.frames ? { frames: rp.frames } : {}) };
  const turned = correctFacing(dressed, space, assets);
  return { state: turned.state, corrections: [...rp.corrections, ...turned.corrections] };
}
