// WHERE SHOULD IT GO? — the best free spot for a NEW piece.
//
// autoPlace (placement.ts) answers "is there any spot?" by taking the first
// candidate without a finding, from a short list. That is how a new sofa
// landed on the dining table, an armchair inside a sofa, and a sofa against a
// wall where every turn was refused. This searches the whole room and ranks
// what it finds instead:
//
//   1. CANDIDATES  every wall face of the room (backs to the wall, facing in,
//      stepped along the face and slid snug into each corner), plus a grid
//      over the room's free floor in the room's own axes, each point at the
//      four axis-aligned turns and — for seating and a TV — turned towards
//      what it should face. The total number of footprint tests is capped
//      (DEFAULT_MAX_EVALUATIONS); the grid coarsens in a big room rather
//      than the search slowing down.
//   2. HARD FILTER  nothing that evaluatePlacement would BLOCK (outside the
//      room, through a wall); nothing that overlaps another piece or stands
//      in a doorway — a new piece is never auto-placed on top of something.
//      And a piece must still be turnable where it lands: at least one of
//      the editor's own turn steps (±15°, ±90°) must be legal there. A
//      WALL-anchored piece backed flat against a wall is exempt (judgement,
//      documented): it already faces the right way, and no rectangle backed
//      within a centimetre of a wall can turn in place — turning it means
//      pulling it out, which the customer can do. Every other piece (an
//      armchair, a plant, a free-standing sofa) must keep a legal turn,
//      which is the "mobile sofa wedged against a wall" fix.
//   3. SCORE  walking room in front (the asset's clearance, or a sensible
//      default per kind of piece), away from doors, the anchor's meaning
//      (WALL backed to a wall, CORNER in a corner, CENTRE near the middle),
//      what the piece is for (a sofa faces the TV or the room, a bed's head
//      away from the door, chairs at a table, a nightstand by the bed),
//      breathing room from unrelated pieces, square to the room's walls, and
//      — for a drop — closeness to where it was dropped. A spot with TIGHT
//      access only wins when no spot without it exists.
//   4. The winner is re-checked with evaluatePlacement itself, which stays
//      the single authority. No acceptable spot → null, and the caller says
//      so; nothing is ever forced into a poor spot.
//
// Pure and deterministic: same design in, same spot out. It only ever
// places the NEW piece — existing pieces are read, never moved.

import { isFlat, type CatalogAsset } from './catalog.ts';
import {
  evaluatePlacement, footprint, frontOf, frontZone, hitsWall, insideRoom, placementWorld, rotationFacing,
  solidBox, solidOverlap, zoneClear,
  type PlacementContext, type PlacementIssue, type PlacementWorld, type SolidBox,
} from './placement.ts';
import { pointInPolygon, wallFrame, type Point, type SpaceRoom } from './space.ts';

export type PieceRole =
  | 'SOFA' | 'ARMCHAIR' | 'CHAIR' | 'BED' | 'NIGHTSTAND' | 'COFFEE_TABLE' | 'TABLE'
  | 'STORAGE' | 'TV' | 'PLANT' | 'LAMP' | 'RUG' | 'OTHER';

type RoleSource = Pick<CatalogAsset, 'category' | 'subcategory' | 'code' | 'heightM'> & { canonicalSubcategory?: string | null };

/** What a piece is for, from its catalogue words (ASCII codes, never display names). */
export function pieceRole(a: RoleSource): PieceRole {
  const words = new Set(
    [a.canonicalSubcategory, a.subcategory, a.category, a.code].filter(Boolean).join(' ').toUpperCase().split(/[^A-Z0-9]+/),
  );
  const has = (...w: string[]) => w.some((x) => words.has(x));
  if (isFlat(a) || has('RUG', 'CARPET', 'MAT')) return 'RUG';
  if (has('NIGHTSTAND', 'BEDSIDE')) return 'NIGHTSTAND';
  if (has('TV', 'TELEVISION', 'MEDIA')) return 'TV';
  if (has('COFFEE')) return 'COFFEE_TABLE';
  if (has('ARMCHAIR', 'RECLINER', 'LOUNGE')) return 'ARMCHAIR';
  if (has('SOFA', 'SECTIONAL', 'COUCH', 'LOVESEAT')) return 'SOFA';
  if (has('BED', 'HEADBOARD')) return 'BED';
  if (has('CHAIR', 'STOOL', 'BENCH', 'OTTOMAN')) return 'CHAIR';
  if (has('TABLE', 'DESK')) return 'TABLE';
  if (has('WARDROBE', 'DRESSER', 'BOOKCASE', 'CABINET', 'STORAGE', 'SHELF', 'SHELVING', 'SIDEBOARD', 'CHEST', 'KITCHEN', 'REFRIGERATOR', 'APPLIANCE')) {
    return 'STORAGE';
  }
  if (has('PLANT', 'PLANTER', 'TREE')) return 'PLANT';
  if (has('LAMP')) return 'LAMP';
  return 'OTHER';
}

/** Walking room a piece wants in front of it when its catalogue row gives none. */
const DEFAULT_CLEARANCE: Record<PieceRole, number> = {
  SOFA: 0.9, ARMCHAIR: 0.7, CHAIR: 0.6, BED: 0.7, NIGHTSTAND: 0, COFFEE_TABLE: 0.4, TABLE: 0.75,
  STORAGE: 0.8, TV: 0, PLANT: 0, LAMP: 0, RUG: 0, OTHER: 0.5,
};

export const effectiveClearance = (a: CatalogAsset): number => (a.clearanceM > 0 ? a.clearanceM : DEFAULT_CLEARANCE[pieceRole(a)]);

export const DEFAULT_MAX_EVALUATIONS = 2000;
/** Footprint tests held back for the turn check and the final verification. */
const RESERVE = 200;
const TURN_STEPS = [Math.PI / 12, -Math.PI / 12, Math.PI / 2, -Math.PI / 2];
const BACK_GAP = 0.01;

export interface PlacementSearchOptions {
  /** A drop point: the search stays near it and prefers spots closest to it. */
  near?: Point | null;
  maxEvaluations?: number;
}

export interface PlacementChoice {
  at: Point;
  rotation: number;
  /** evaluatePlacement's own findings at the chosen spot (at most TIGHT_ACCESS). */
  issues: PlacementIssue[];
  score: number;
}

export interface PlacementSearchResult {
  choice: PlacementChoice | null;
  /** Footprint tests spent — bounded by maxEvaluations. */
  evaluations: number;
  /** Spots that passed the hard filter and were scored. */
  candidates: number;
}

const TAU = Math.PI * 2;
function normAngle(r: number): number {
  let x = r % TAU;
  if (x <= -Math.PI) x += TAU;
  if (x > Math.PI) x -= TAU;
  return Math.round(x * 1e6) / 1e6;
}
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function unit(from: Point, to: Point): Point {
  const d = dist(from, to);
  return d < 1e-9 ? { x: 0, y: 0 } : { x: (to.x - from.x) / d, y: (to.y - from.y) / d };
}
const grow = (b: SolidBox, m: number) => solidBox({ ...b.obb, hw: b.obb.hw + m, hd: b.obb.hd + m });

interface Spot {
  at: Point;
  rotation: number;
  box: SolidBox;
  /** Generated against a wall face, back flat to it. */
  backed: boolean;
}

/** Everything about the room the scoring needs, worked out once per search. */
interface Scene {
  world: PlacementWorld;
  axis: number;
  doors: Point[];
  centre: Point;
  tv: SolidBox | null;
  sofa: SolidBox | null;
  bed: SolidBox | null;
  tables: SolidBox[];
  seating: SolidBox[];
  flats: SolidBox[];
}

function sceneOf(ctx: PlacementContext, world: PlacementWorld, room: SpaceRoom): Scene {
  // The room's own axes: the direction of its longest wall face, folded into a quarter turn.
  let axis = 0;
  let longest = -1;
  for (const w of ctx.space.walls) {
    for (const s of w.segments) {
      if (s.roomId !== room.id || s.to - s.from <= longest) continue;
      longest = s.to - s.from;
      const a = wallFrame(w.mesh).angle % (Math.PI / 2);
      axis = a < 0 ? a + Math.PI / 2 : a;
    }
  }
  const doors: Point[] = [];
  for (const d of ctx.space.doors) {
    const wall = ctx.space.walls.find((w) => w.id === d.wallId);
    if (!wall) continue;
    const f = wallFrame(wall.mesh);
    const probe = wall.mesh.thicknessM / 2 + 0.2;
    const sides = [f.normalL, f.normalR].map((n) => ({ x: d.centre.x + n.x * probe, y: d.centre.y + n.y * probe }));
    if (sides.some((p) => pointInPolygon(p, room.polygon))) doors.push(d.centre);
  }
  const mine = world.objects.filter((o) => o.object.roomId === room.id || pointInPolygon(centreOf(o.box), room.polygon));
  const firstOf = (role: PieceRole) => mine.find((o) => !o.flat && pieceRole(o.asset) === role)?.box ?? null;
  return {
    world,
    axis,
    doors,
    centre: room.centroid,
    tv: firstOf('TV'),
    sofa: firstOf('SOFA'),
    bed: firstOf('BED'),
    tables: mine.filter((o) => !o.flat && pieceRole(o.asset) === 'TABLE').map((o) => o.box),
    seating: mine.filter((o) => !o.flat && ['SOFA', 'ARMCHAIR', 'CHAIR'].includes(pieceRole(o.asset))).map((o) => o.box),
    flats: mine.filter((o) => o.flat).map((o) => o.box),
  };
}

const centreOf = (b: SolidBox): Point => ({ x: b.obb.cx, y: b.obb.cy });

/** Pieces a new piece may stand close to without it counting against the spot. */
function related(role: PieceRole, other: PieceRole): boolean {
  if (role === 'CHAIR') return other === 'TABLE';
  if (role === 'TABLE') return other === 'CHAIR';
  if (role === 'NIGHTSTAND') return other === 'BED';
  if (role === 'BED') return other === 'NIGHTSTAND';
  if (role === 'LAMP') return other === 'SOFA' || other === 'ARMCHAIR';
  if (role === 'COFFEE_TABLE') return other === 'SOFA' || other === 'ARMCHAIR';
  return false;
}

/**
 * Search the room for the best spot for a new piece. Pure; see the header
 * for the rules. `choice` is null when no acceptable spot exists.
 */
export function searchPlacement(
  ctx: PlacementContext, asset: CatalogAsset, room: SpaceRoom, options: PlacementSearchOptions = {},
): PlacementSearchResult {
  const max = Math.max(50, options.maxEvaluations ?? DEFAULT_MAX_EVALUATIONS);
  const near = options.near ?? null;
  const world = placementWorld(ctx, room);
  const scene = sceneOf(ctx, world, room);
  const role = pieceRole(asset);
  const flat = isFlat(asset);
  const ceiling = asset.placement === 'CEILING';
  const wallMounted = asset.placement === 'WALL';
  const hw = asset.widthM / 2;
  const hd = asset.depthM / 2;
  let evaluations = 0;
  const budget = max - RESERVE;

  // A ceiling piece only has to be inside the room; a wall-mounted one may
  // hang above low furniture (a picture over a sofa). Everything else may
  // not overlap any solid piece or stand in a doorway.
  const tolerates = (other: CatalogAsset) => ceiling || (wallMounted && other.heightM <= 1.2);
  const overlapTolerated = (instanceId?: string) => {
    const o = world.objects.find((x) => x.id === instanceId);
    return !!o && tolerates(o.asset);
  };
  const legal = (box: SolidBox) => insideRoom(world, box) && !hitsWall(world, box);
  const acceptable = (box: SolidBox): boolean => {
    evaluations += 1;
    if (!legal(box)) return false;
    if (flat || ceiling) return true;
    for (const d of world.doors) if (solidOverlap(box, d.box)) return false;
    for (const o of world.objects) {
      if (o.flat || tolerates(o.asset)) continue;
      if (solidOverlap(box, o.box)) return false;
    }
    return true;
  };

  const spots: Spot[] = [];
  const consider = (at: Point, rotation: number, backed: boolean, flips: boolean) => {
    if (evaluations >= budget) return;
    const box = solidBox(footprint(asset, at, rotation));
    if (!acceptable(box)) return;
    spots.push({ at, rotation: normAngle(rotation), box, backed });
    // The same rectangle turned half round: same footprint, other facing.
    if (flips) spots.push({ at, rotation: normAngle(rotation + Math.PI), box, backed });
  };

  // ── 1a. Against every wall face of the room, facing in ─────────────
  if (!ceiling && !flat) {
    const faces = ctx.space.walls
      .flatMap((w) => w.segments.filter((s) => s.roomId === room.id).map((s) => ({ wall: w, seg: s })))
      .sort((a, b) => (b.seg.to - b.seg.from) - (a.seg.to - a.seg.from) || a.seg.surfaceId.localeCompare(b.seg.surfaceId));
    for (const { wall, seg } of faces) {
      const f = wallFrame(wall.mesh);
      const inward = seg.side === 'L' ? f.normalL : f.normalR;
      const rotation = rotationFacing(inward);
      const offset = wall.mesh.thicknessM / 2 + hd + BACK_GAP;
      const lo = seg.from + hw;
      const hi = seg.to - hw;
      if (hi < lo) continue;
      const at = (u: number): Point => ({
        x: wall.mesh.start.x + f.dir.x * u + inward.x * offset,
        y: wall.mesh.start.y + f.dir.y * u + inward.y * offset,
      });
      const us: number[] = [];
      // Snug into each corner: slide along the face until clear of the cross wall.
      for (const [from, step] of [[lo, 0.025], [hi, -0.025]] as const) {
        for (let k = 0; k <= 20 && evaluations < budget; k += 1) {
          const u = from + step * k;
          if (u < lo - 1e-9 || u > hi + 1e-9) break;
          evaluations += 1;
          if (legal(solidBox(footprint(asset, at(u), rotation)))) { us.push(u); break; }
        }
      }
      const mid = (lo + hi) / 2;
      us.push(mid);
      for (let d = 0.2; d <= (hi - lo) / 2 + 1e-9; d += 0.2) us.push(mid + d, mid - d);
      const seen = new Set<number>();
      for (const u of us) {
        const key = Math.round(u * 100);
        if (seen.has(key)) continue;
        seen.add(key);
        consider(at(u), rotation, true, false);
      }
    }
  }

  // ── 1b. A grid over the free floor, in the room's own axes ─────────
  const U = { x: Math.cos(scene.axis), y: Math.sin(scene.axis) };
  const V = { x: -U.y, y: U.x };
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of room.polygon) {
    const u = p.x * U.x + p.y * U.y;
    const v = p.x * V.x + p.y * V.y;
    minU = Math.min(minU, u); maxU = Math.max(maxU, u);
    minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }
  if (near) {
    const nu = near.x * U.x + near.y * U.y;
    const nv = near.x * V.x + near.y * V.y;
    minU = Math.max(minU, nu - 2.5); maxU = Math.min(maxU, nu + 2.5);
    minV = Math.max(minV, nv - 2.5); maxV = Math.min(maxV, nv + 2.5);
  }
  const facingTarget = role === 'SOFA' ? scene.tv
    : role === 'ARMCHAIR' ? scene.tv ?? scene.sofa
      : role === 'CHAIR' ? null
        : role === 'TV' ? scene.sofa : null;
  const squareTurns = ceiling ? [scene.axis] : [scene.axis, scene.axis + Math.PI / 2];
  const perPoint = squareTurns.length + (facingTarget ? 1 : 0);
  const remaining = Math.max(0, budget - evaluations);
  const area = Math.max(0.01, (maxU - minU) * (maxV - minV));
  const step = Math.max(0.15, Math.sqrt((area * perPoint) / Math.max(1, remaining)));
  const points: Point[] = [room.centroid];
  if (near) points.push(near);
  for (let u = minU + step / 2; u < maxU; u += step) {
    for (let v = minV + step / 2; v < maxV; v += step) {
      const p = { x: U.x * u + V.x * v, y: U.y * u + V.y * v };
      if (pointInPolygon(p, room.polygon)) points.push(p);
    }
  }
  for (const p of points) {
    if (evaluations >= budget) break;
    for (const r of squareTurns) consider(p, r, false, !ceiling);
    if (facingTarget) {
      const toward = rotationFacing(unit(p, centreOf(facingTarget)));
      const q = Math.round(toward / (Math.PI / 12)) * (Math.PI / 12);
      const off = Math.abs(normAngle(q - scene.axis)) % (Math.PI / 2);
      if (off > 1e-6 && Math.abs(off - Math.PI / 2) > 1e-6) consider(p, q, false, false);
    }
  }

  // ── 2/3. Score what survived ───────────────────────────────────────
  const clearance = effectiveClearance(asset);
  const others = world.objects.filter((o) => !o.flat);
  const coffeeTarget = role === 'COFFEE_TABLE' && scene.sofa
    ? (() => {
      const s = scene.sofa.obb;
      const f = frontOf(s.angle);
      const d = s.hd + 0.45 + hd;
      return { x: s.cx + f.x * d, y: s.cy + f.y * d };
    })()
    : null;

  const scored = spots.map((spot, index) => {
    const { at, rotation, box } = spot;
    const front = frontOf(rotation);
    let score = 0;

    if (ceiling) {
      score -= 10 * dist(at, scene.centre);
    } else {
      // Square to the room.
      const off = Math.abs(normAngle(rotation - scene.axis)) % (Math.PI / 2);
      score -= 25 * (Math.min(off, Math.PI / 2 - off) / (Math.PI / 4));

      // Backed to a wall (generated there, or a grid spot that happens to be).
      const backed = spot.backed || !!hitsWall(world, frontZone(asset, at, rotation + Math.PI, 0.06));
      const hugged = new Set<string>();
      const halo = grow(box, 0.2);
      for (const w of world.walls) if (solidOverlap(halo, w.box)) hugged.add(w.id);

      if (asset.anchor === 'WALL') score += backed ? 30 : -25;
      else if (asset.anchor === 'CORNER') score += hugged.size >= 2 ? 30 : hugged.size === 1 ? 6 : 0;
      else if (asset.anchor === 'CENTRE') score -= 6 * dist(at, coffeeTarget ?? scene.centre);
      else if (hugged.size >= 1) score += 5;

      // Walking room in front.
      if (!flat && clearance > 0) {
        if (role === 'TABLE' || role === 'COFFEE_TABLE') {
          const turned = { widthM: asset.depthM, depthM: asset.widthM };
          for (let k = 0; k < 4; k += 1) {
            const piece = k % 2 === 0 ? asset : turned;
            if (zoneClear(world, frontZone(piece, at, rotation + (k * Math.PI) / 2, clearance))) score += 5;
          }
        } else {
          // A chair at a table faces the table; the room it needs is behind it, to pull out.
          const probe = role === 'CHAIR' && scene.tables.length ? rotation + Math.PI : rotation;
          for (const frac of [1, 2 / 3, 1 / 3]) {
            if (zoneClear(world, frontZone(asset, at, probe, clearance * frac))) { score += 20 * frac; break; }
          }
        }
      }

      // Facing what it is for.
      const faceTo = facingTarget ? centreOf(facingTarget)
        : role === 'CHAIR' && scene.tables.length
          ? centreOf(scene.tables.reduce((a, b) => (dist(centreOf(a), at) <= dist(centreOf(b), at) ? a : b)))
          : null;
      if (faceTo) {
        const u = unit(at, faceTo);
        score += 14 * (front.x * u.x + front.y * u.y);
      } else if (!flat && role !== 'PLANT' && role !== 'LAMP') {
        const u = unit(at, scene.centre);
        score += 6 * (front.x * u.x + front.y * u.y);
      }

      // What it belongs next to, and breathing room from everything else.
      const near45 = grow(box, 0.45);
      const near30 = grow(box, 0.3);
      for (const o of others) {
        const otherRole = pieceRole(o.asset);
        if (related(role, otherRole)) {
          if (solidOverlap(near45, o.box)) score += role === 'CHAIR' || role === 'NIGHTSTAND' ? 25 : 10;
        } else if (solidOverlap(near30, o.box)) {
          score -= 8;
        }
      }
      if (role === 'ARMCHAIR' && scene.sofa && solidOverlap(grow(box, 1.4), scene.sofa) && !solidOverlap(grow(box, 0.4), scene.sofa)) score += 12;
      if (flat) for (const r of scene.flats) if (solidOverlap(box, r)) score -= 20;

      // Doors: keep the way in clear; a bed's head goes away from the door.
      for (const d of scene.doors) {
        const gap = dist(at, d) - Math.max(hw, hd);
        if (gap < 1) score -= (1 - gap) * 12;
      }
      if (role === 'BED' && scene.doors.length) {
        const head = { x: at.x - front.x * hd, y: at.y - front.y * hd };
        score += 4 * Math.min(4, Math.min(...scene.doors.map((d) => dist(head, d))));
      }
    }

    if (near) score -= 15 * dist(at, near);

    const tight = !flat && !ceiling && asset.clearanceM > 0
      && !zoneClear(world, frontZone(asset, at, rotation, asset.clearanceM));
    return { spot, score, tight, index };
  });

  scored.sort((a, b) => Number(a.tight) - Number(b.tight) || b.score - a.score || a.index - b.index);

  // ── 4. The best spot that can still turn and that the rules accept ──
  for (const s of scored) {
    if (evaluations >= max) break;
    const { at, rotation, backed } = s.spot;
    const exempt = ceiling || flat || (backed && (asset.anchor === 'WALL' || wallMounted));
    if (!exempt) {
      let turnable = false;
      for (const d of TURN_STEPS) {
        evaluations += 1;
        if (legal(solidBox(footprint(asset, at, rotation + d)))) { turnable = true; break; }
      }
      if (!turnable) continue;
    }
    const spotAt = { x: round3(at.x), y: round3(at.y) };
    evaluations += 1;
    const issues = evaluatePlacement(ctx, asset, spotAt, rotation, room.id);
    if (issues.some((i) => i.severity === 'BLOCK')) continue;
    if (!ceiling && issues.some((i) => i.code === 'BLOCKS_DOOR')) continue;
    if (issues.some((i) => i.code === 'OVERLAPS_OBJECT' && !overlapTolerated(i.relatedId))) continue;
    return { choice: { at: spotAt, rotation, issues, score: Math.round(s.score * 1000) / 1000 }, evaluations, candidates: scored.length };
  }
  return { choice: null, evaluations, candidates: scored.length };
}

/**
 * The best spot for a new piece in a room, or null when there is no
 * acceptable one. With `near`, the spot closest to it wins; if nothing
 * acceptable is near, the whole room is searched before giving up.
 */
export function findPlacement(
  ctx: PlacementContext, asset: CatalogAsset, room: SpaceRoom, options: PlacementSearchOptions = {},
): PlacementChoice | null {
  const choice = searchPlacement(ctx, asset, room, options).choice;
  if (choice || !options.near) return choice;
  return searchPlacement(ctx, asset, room, { ...options, near: null }).choice;
}
