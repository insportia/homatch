// ZONES OF AN OPEN ROOM — WHERE THE KITCHEN, THE TABLE AND THE SOFA GO BEFORE ANY PIECE IS PLACED.
//
// A kitchen-living room furnished piece by piece ends up with the dining table between the sofa and its television
// and the fridge across the room from the kitchen. A designer first splits the room along its length: the kitchen at
// one end (its run against the end wall, the fridge beside it — or the run along a long wall when the end wall
// is too short), the dining table in the middle, the living group at the other end (the sofa looking at the wall the
// television stands on). A studio keeps the kitchen at one end and the bed at the other.
//
// Pure: for a near-rectangular room it returns a few variants (which end the kitchen takes, which way the sofa looks);
// each gives, for a need and the catalogue piece chosen for it, the poses that piece should take. The build places
// them through its own checks (doors, windows, walls, walking room) and keeps the variant that furnishes the room
// best. A room of another shape gets no variants: the engine's own placement is used.

import type { Point } from '../space.ts';

export interface ZonePose { at: Point; rotation: number }
export type ZoneProposals = (need: string, asset: { widthM: number; depthM: number }) => ZonePose[];

/** A piece against a wall stands inside the wall's face (the outline runs along the wall's centre line). */
const INSET_M = 0.17;
/** Typical sizes the zones are measured with (the real piece is measured when it is placed). */
const RUN_M = 2.4;
const FRIDGE_M = 0.75;
/** From the sofa's centre to the television wall: about 2.4 m of view plus the pieces' own depth. */
const SOFA_TO_TV_WALL_M = 3.0;
/** Floor the dining table and its chairs take along the room. */
const DINING_M = 2.6;

const rotationFacing = (dx: number, dy: number) => Math.atan2(-dx, dy);

function polygonArea(poly: Point[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i += 1) { const a = poly[i]; const b = poly[(i + 1) % poly.length]; s += a.x * b.y - b.x * a.y; }
  return Math.abs(s) / 2;
}

export function zoneVariants(room: { polygon: Point[] }, use: string): ZoneProposals[] {
  if (use !== 'KITCHEN_LIVING' && use !== 'LIVING' && use !== 'STUDIO') return [];
  const xs = room.polygon.map((p) => p.x); const ys = room.polygon.map((p) => p.y);
  const b = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  const W = b.maxX - b.minX; const H = b.maxY - b.minY;
  // Only a room that is (nearly) its bounding rectangle is split this way.
  if (polygonArea(room.polygon) < 0.85 * W * H) return [];
  const alongX = W >= H;
  const L = alongX ? W : H; const D = alongX ? H : W;
  const kitchen = use !== 'LIVING';
  if (L < 3.6 || D < 2.4) return [];
  const out: ZoneProposals[] = [];
  for (const flipS of [false, true]) {
    for (const flipT of [false, true]) {
      for (const sofaMode of ['END', 'WALL'] as const) {
        if (use === 'STUDIO' && sofaMode === 'WALL') continue;
        // Local frame: s along the room (0 = the kitchen's end), t across (0 = the sofa's wall in WALL mode).
        const at = (s: number, t: number): Point => {
          const ls = flipS ? L - s : s; const lt = flipT ? D - t : t;
          return alongX ? { x: b.minX + ls, y: b.minY + lt } : { x: b.minX + lt, y: b.minY + ls };
        };
        const facing = (ds: number, dt: number) => {
          const ls = flipS ? -ds : ds; const lt = flipT ? -dt : dt;
          return alongX ? rotationFacing(ls, lt) : rotationFacing(lt, ls);
        };
        // Kitchen: on the end wall when it holds the run and the fridge, else along the far long wall.
        const runOnEnd = D >= RUN_M + FRIDGE_M + 0.2;
        const kitchenEnd = !kitchen ? 0 : runOnEnd ? 0.6 + 1.3 : Math.min(RUN_M + FRIDGE_M + 0.3, L * 0.45);
        // Living group: at the far end, looking at the end wall, or along the room looking across it.
        const wallMode = sofaMode === 'WALL' && D <= 4.6;
        if (sofaMode === 'WALL' && !wallMode) continue;
        const livingLen = wallMode ? Math.min(4.0, Math.max(3.0, L - kitchenEnd - DINING_M)) : SOFA_TO_TV_WALL_M + 0.9;
        const livingStart = L - livingLen;
        const diningRoom = livingStart - kitchenEnd;
        // A room too short for three zones in a row but wide enough: the living group on one side of it and the
        // table on the other, both past the kitchen.
        const sideBySide = !wallMode && diningRoom < DINING_M - 0.2 && D >= 5.2;
        const proposals: ZoneProposals = (need, asset) => {
          const hw = asset.widthM / 2; const hd = asset.depthM / 2;
          switch (need) {
            case 'KITCHEN_RUN':
              // The end wall, the fridge's corner left free at either side; else along either long wall from the end.
              if (!kitchen) return [];
              return [
                ...(runOnEnd ? [{ at: at(INSET_M + hd, Math.min(D - INSET_M - hw, FRIDGE_M + 0.02 + hw)), rotation: facing(1, 0) },
                  { at: at(INSET_M + hd, Math.max(INSET_M + hw, D - FRIDGE_M - 0.02 - hw)), rotation: facing(1, 0) }] : []),
                { at: at(Math.min(L - INSET_M - hw, FRIDGE_M + 0.02 + hw), D - INSET_M - hd), rotation: facing(0, -1) },
                { at: at(Math.min(L - INSET_M - hw, FRIDGE_M + 0.02 + hw), INSET_M + hd), rotation: facing(0, 1) },
              ];
            case 'SOFA': {
              // The ideal spot first, then along the wall (or across the room) step by step: a door may take the ideal.
              if (use === 'STUDIO') return [];
              const steps = [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6];
              if (wallMode) {
                const mid = livingStart + livingLen / 2;
                return steps.map((k) => mid + k).filter((x) => x - hw >= kitchenEnd && x + hw <= L - INSET_M)
                  .map((x) => ({ at: at(x, INSET_M + hd), rotation: facing(0, 1) }));
              }
              const t0 = sideBySide ? Math.max(INSET_M + hw + 0.3, D * 0.3) : D / 2;
              return [3.0, 2.7, 3.3].flatMap((view) => steps.filter((k) => t0 + k - hw >= INSET_M && t0 + k + hw <= D - INSET_M)
                .map((k) => ({ at: at(L - INSET_M - view, t0 + k), rotation: facing(1, 0) })));
            }
            case 'BED':
              // A studio sleeps at the far end: the bed's head against the end wall, else against a long wall there.
              return use === 'STUDIO' ? [
                { at: at(L - INSET_M - hd, D / 2), rotation: facing(-1, 0) },
                { at: at(L - INSET_M - hw - 0.3, INSET_M + hd), rotation: facing(0, 1) },
                { at: at(L - INSET_M - hw - 0.3, D - INSET_M - hd), rotation: facing(0, -1) },
              ] : [];
            case 'DINING_TABLE': {
              // In the middle, its length along the room; in a studio between the kitchen and the bed.
              if (sideBySide) {
                const s0 = Math.min(L - 1.6, kitchenEnd + 1.6);
                return [0, 0.5, 1.0, 1.5].flatMap((k) => [0, -0.4].map((m) => ({ at: at(s0 + k, D - 1.45 + m), rotation: facing(0, 1) })));
              }
              const mid = use === 'STUDIO' ? (L - kitchenEnd >= 2.6 + 2.4 ? kitchenEnd + 1.3 : null) : diningRoom >= DINING_M - 0.2 ? kitchenEnd + diningRoom / 2 : null;
              return mid == null ? [] : [0, 0.4, -0.4].map((k) => ({ at: at(mid + k, D / 2), rotation: facing(0, 1) }));
            }
            default:
              return [];
          }
        };
        out.push(proposals);
      }
    }
  }
  return out;
}

/** The order a zoned room is furnished in: the kitchen, the living group, the table and its chairs, then the rest. */
export const ZONE_ORDER = ['KITCHEN_RUN', 'FRIDGE', 'BED', 'SOFA', 'TV', 'COFFEE_TABLE', 'ARMCHAIR', 'DINING_TABLE', 'DINING_CHAIR', 'WARDROBE'];
