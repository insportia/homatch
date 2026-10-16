// WALKABILITY: A WALKTHROUGH IS READY ONLY WHEN A PERSON CAN ACTUALLY WALK IT.
//
// The scene builder (build.ts) furnishes rooms; this file holds what it is
// judged by and the room-level planning rules it furnishes with:
//
//   plan       one coherent solution per room: no second dining table or
//              island, no duplicated singletons (redundantPieces); a room is
//              neither crowded (overfurnished) nor missing the piece that
//              makes it what it is (essentialRole)
//   clearance  a route counts only when a body walks it with a comfort
//              margin (COMFORT_RADIUS_M: a 0.7 m passage), not when a 2 cm
//              gap is theoretically free
//   traps      comfortable floor that only a squeeze reaches — the far side
//              of a bed and a wardrobe with a narrow gap between them, the
//              corner behind an island — found on the final geometry
//              (strandedFloor)
//   repair     what moves first when something is in the way: decor, chairs,
//              side tables, tables, then large pieces, the room's essential
//              piece last (repairRank)
//
// Pure and deterministic (Deno + Node): same scene, same answer.

import type { CatalogAsset } from '../catalog.ts';
import { pieceRole, type PieceRole } from '../placementSearch.ts';
import { isFree, type WalkModel } from '../navigation.ts';
import { pointInPolygon, type Point, type SpaceModel, type SpaceRoom } from '../space.ts';

type AssetWords = Pick<CatalogAsset, 'category' | 'subcategory' | 'code' | 'heightM'> & { canonicalSubcategory?: string | null };

const words = (a: AssetWords) => [a.canonicalSubcategory, a.subcategory, a.category, a.code].filter(Boolean).join(' ').toUpperCase();
/** A kitchen island (a table-like block in the middle of a kitchen). */
export const isIsland = (a: AssetWords) => /ISLAND/.test(words(a));
/** Kitchen cabinetry: a run, a unit, an appliance — the kitchen itself. */
export const isKitchen = (a: AssetWords) => !isIsland(a) && /KITCHEN|REFRIGERATOR|FRIDGE|APPLIANCE|COOKER|OVEN|HOB/.test(words(a));
export const isDesk = (a: AssetWords) => /DESK/.test(words(a));
/** Sanitary fittings: a bathroom without them is not a bathroom — never moved for a walk, never dropped. */
export const isFixture = (a: AssetWords) => /TOILET|WC\b|SHOWER|BATH|VANITY|SINK|BASIN|BIDET/.test(words(a));

/**
 * The order things give way when circulation needs room (0 first): decor and plants, chairs and stools, side and
 * coffee tables, tables and islands, large pieces (sofas, storage, the TV), and last the bed and the kitchen.
 */
export function repairRank(a: AssetWords): number {
  if (isKitchen(a) || isFixture(a)) return 5;
  const role = pieceRole(a);
  const rank: Record<PieceRole, number> = {
    PLANT: 0, LAMP: 0, OTHER: 0, RUG: 0, CHAIR: 1, NIGHTSTAND: 2, COFFEE_TABLE: 2, TABLE: 3, ARMCHAIR: 3, TV: 4, STORAGE: 4, SOFA: 4, BED: 5,
  };
  return isIsland(a) ? 3 : rank[role];
}

/** What a room needs to be what it is (one piece); null for a room that needs nothing in particular. */
export type EssentialRole = 'SOFA' | 'BED' | 'TABLE' | 'KITCHEN';
export function essentialRole(kind: string): EssentialRole | null {
  if (kind === 'LIVING' || kind === 'STUDIO' || kind === 'KITCHEN_LIVING') return 'SOFA';
  if (kind === 'BEDROOM' || kind === 'KIDS_ROOM' || kind === 'GUEST_ROOM') return 'BED';
  if (kind === 'DINING') return 'TABLE';
  if (kind === 'KITCHEN') return 'KITCHEN';
  return null;
}
export function servesRole(a: AssetWords, role: EssentialRole): boolean {
  if (role === 'KITCHEN') return isKitchen(a);
  const r = pieceRole(a);
  if (role === 'TABLE') return r === 'TABLE' && !isDesk(a) && !isIsland(a);
  return r === role;
}

/**
 * The singletons of one room: how many of each a coherent room holds. A kitchen gets ONE dining-table-or-island
 * solution (an island and a table only when the room is large enough for both), a living room one coffee table
 * and one TV, a bedroom one bed (two singles allowed).
 */
export function redundantPieces<T>(kind: string, areaM2: number, items: Array<{ item: T; asset: AssetWords; planned: boolean }>): Set<T> {
  const out = new Set<T>();
  const keepFirst = (pred: (a: AssetWords) => boolean, max: number) => {
    // The design's own pieces (with a pose) are kept before ones only the room programme added.
    const hits = items.filter((x) => pred(x.asset)).sort((a, b) => Number(b.planned) - Number(a.planned));
    for (const x of hits.slice(max)) out.add(x.item);
  };
  const table = (a: AssetWords) => pieceRole(a) === 'TABLE' && !isDesk(a) && !isIsland(a);
  const kitchenish = kind === 'KITCHEN' || kind === 'KITCHEN_LIVING' || kind === 'DINING' || kind === 'LIVING' || kind === 'STUDIO';
  // An island belongs to a kitchen: in a living or dining room without one it is a random block.
  const hasKitchen = kind === 'KITCHEN' || kind === 'KITCHEN_LIVING' || kind === 'STUDIO' || items.some((x) => isKitchen(x.asset));
  if (!hasKitchen) keepFirst(isIsland, 0);
  if (kitchenish) {
    keepFirst(isIsland, 1);
    // One run of base cabinets with its sink and hob per room: a second (the same run read twice) stood facing it
    // across the room and closed the way between them.
    keepFirst((a) => isKitchen(a) && /\bRUN\b|CABINET|COUNTER/.test(words(a)), 1);
    keepFirst(table, 1);
    // A table AND an island only where the room has the floor for both.
    if (areaM2 < 22) {
      const both = items.filter((x) => !out.has(x.item) && (isIsland(x.asset) || table(x.asset))).sort((a, b) => Number(b.planned) - Number(a.planned));
      for (const x of both.slice(1)) out.add(x.item);
    }
  }
  keepFirst((a) => pieceRole(a) === 'COFFEE_TABLE', 1);
  keepFirst((a) => pieceRole(a) === 'TV', 1);
  keepFirst((a) => pieceRole(a) === 'SOFA', areaM2 >= 24 ? 2 : 1);
  keepFirst((a) => pieceRole(a) === 'BED', /SINGLE|TWIN/.test(items.map((x) => words(x.asset)).join(' ')) ? 2 : 1);
  keepFirst((a) => pieceRole(a) === 'STORAGE' && !isKitchen(a), areaM2 >= 14 ? 3 : 2);
  keepFirst((a) => pieceRole(a) === 'CHAIR', Math.max(2, Math.floor(areaM2 / 3)));
  return out;
}

/** The share of a room's floor its standing pieces may take before it reads as crowded. Kitchens and baths are built-in. */
export const DENSITY_MAX = 0.42;
export const densityChecked = (kind: string) => !['KITCHEN', 'BATHROOM', 'WC', 'CORRIDOR', 'HALL', 'STORAGE', 'LAUNDRY'].includes(kind);

// ── Traps: comfortable floor that only a squeeze reaches ─────────────────────

const G = 0.15;
/** A region of comfortable floor this large (m²) cut off from the comfortable walk is a trap (the far side of a bed). */
export const TRAP_M2 = 0.6;

export interface Strip { roomId: string; areaM2: number; cells: Point[] }

/**
 * Stranded floor (`wasReached`: what the comfortable walk reached with no furniture at all): in each room, the comfortable floor (a body with the comfort margin stands there) that the
 * comfortable walk from the entrance does not reach — the far side of a bed and a wardrobe with only a narrow gap
 * between them, the corner behind an island. `comfort` is the furnished space at COMFORT_RADIUS_M; `reached` says
 * what the comfortable walk reached. A legroom gap between a sofa and its coffee table strands nothing.
 */
export function strandedFloor(space: SpaceModel, comfort: WalkModel, reached: (p: Point) => boolean, only?: string, wasReached?: (p: Point) => boolean): Strip[] {
  const out: Strip[] = [];
  for (const room of space.rooms) {
    if (only && room.id !== only) continue;
    const xs = room.polygon.map((p) => p.x); const ys = room.polygon.map((p) => p.y);
    const x0 = Math.min(...xs); const y0 = Math.min(...ys);
    const ni = Math.ceil((Math.max(...xs) - x0) / G); const nj = Math.ceil((Math.max(...ys) - y0) / G);
    const at = (i: number, j: number) => ({ x: x0 + (i + 0.5) * G, y: y0 + (j + 0.5) * G });
    const key = (i: number, j: number) => i * 4096 + j;
    const stranded = new Set<number>();
    for (let i = 0; i < ni; i += 1) {
      for (let j = 0; j < nj; j += 1) {
        const p = at(i, j);
        if (!pointInPolygon(p, room.polygon) || !isFree(comfort, p) || reached(p)) continue;
        // Only what the furniture cut off: floor the comfortable walk reached on the bare plan (a narrow door of the
        // plan itself is architecture, not a trap).
        if (wasReached && !wasReached(p)) continue;
        stranded.add(key(i, j));
      }
    }
    const seen = new Set<number>();
    for (const k of stranded) {
      if (seen.has(k)) continue;
      const cells: Point[] = []; const queue = [k]; seen.add(k);
      while (queue.length) {
        const c = queue.pop()!;
        const i = Math.floor(c / 4096); const j = c % 4096;
        cells.push(at(i, j));
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = key(i + di, j + dj);
          if (stranded.has(n) && !seen.has(n)) { seen.add(n); queue.push(n); }
        }
      }
      const areaM2 = Math.round(cells.length * G * G * 100) / 100;
      if (areaM2 >= TRAP_M2) out.push({ roomId: room.id, areaM2, cells });
    }
  }
  return out.sort((a, b) => b.areaM2 - a.areaM2);
}

/** A room's footprint share taken by standing pieces. */
export function density(room: SpaceRoom, footprintsM2: number[]): number {
  return room.areaM2 > 0 ? footprintsM2.reduce((s, x) => s + x, 0) / room.areaM2 : 0;
}

export interface WalkGate {
  ok: boolean;
  /** Rooms a comfortable walk no longer reaches, narrow traps left, rooms still crowded, rooms missing their piece. */
  unreachable: string[];
  traps: Array<{ roomId: string; areaM2: number }>;
  crowded: string[];
  missingEssential: string[];
  spawnValid: boolean;
  /** What a person would not believe (plausibility.ts): a wall piece standing free, a sofa facing away, a cramped arrival. */
  implausible?: Array<{ code: string; roomId: string | null; instanceId: string | null; detail: string }>;
}
