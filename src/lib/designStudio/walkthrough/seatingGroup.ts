// HOMATCH Design Studio — a living room's seating group, arranged as ONE thing.
//
// A living room is a sofa that faces a television (or a coffee table), with
// the table between them and the armchairs at its sides. Placing those pieces
// one at a time and repairing each on its own (moved off a door here, dropped
// there) leaves a sofa facing an empty rug and an armchair pressed against the
// television — every piece "legal", the room absurd. This chooses the group's
// poses together, before the pieces are placed:
//
//   · the sofa against a wall, where the plan put it when that pose is clean;
//   · the television on the wall the sofa faces, 1.6–4.2 m away, centred on it;
//   · the coffee table in front of the sofa, a knee's gap away;
//   · the armchairs either side of the table, turned toward it;
//   · every pose clean by the same placement rules as any piece (walls, doors'
//     keep-out, stairs, overlaps, access in front), and the group as a whole
//     must leave every room as walkable as the bare plan (`walkable`).
//
// Score: a coherent group first (a TV the sofa faces, a table, chairs), then
// nearness to the plan's sofa. The floor plan is never touched; a room that
// cannot hold a coherent group keeps the plan's poses (and the usual repair).
//
// Pure and dependency-free (Deno + Node + browser).

import type { CatalogAsset } from '../catalog.ts';
import type { ObjectInstance } from '../designState.ts';
import { candidatePositions, evaluateInWorld, frontOf, placementWorld, rotationFacing } from '../placement.ts';
import type { Point, SpaceModel, SpaceRoom } from '../space.ts';
import { pointInPolygon } from '../space.ts';

export type SeatRole = 'SOFA' | 'TV' | 'TABLE' | 'CHAIR' | 'RUG';

export interface SeatPiece<T> {
  item: T;
  role: SeatRole;
  /** The asset at the size it will stand (scaled shape applied). */
  asset: CatalogAsset;
  /** The plan's pose, in plan metres (not room-local), when it has one. */
  planned: { at: Point; rotation: number } | null;
}

export interface SeatPose<T> { item: T; at: Point; rotation: number }

/** Where a television may stand from the sofa it faces (centre to centre along the sofa's view, metres). */
export const TV_VIEW_MIN_M = 1.6;
export const TV_VIEW_MAX_M = 4.2;
/** How far off the sofa's axis the television may stand (metres). */
const TV_LATERAL_M = 0.6;
/** The gap between a sofa's front and its coffee table (metres). */
const TABLE_GAP_M = 0.42;
/** The gap between the coffee table's side and an armchair's front (metres). */
const CHAIR_GAP_M = 0.35;
/** Where an armchair may stand beside the table: [gap from the table's side, shift toward what the sofa faces]. */
const CHAIR_SPOTS: Array<[number, number]> = [[CHAIR_GAP_M, 0], [CHAIR_GAP_M, 0.35], [CHAIR_GAP_M + 0.25, 0.35], [CHAIR_GAP_M + 0.25, 0.7]];
/** At most this many sofa poses are tried, and the walk is proven for at most this many of the best groups. */
const SOFA_TRIES = 48;
const WALK_PROOFS = 8;

/** A piece's role in a seating group, from the plan's type first, then the catalogue's words. */
export function seatRole(type: string, asset: Pick<CatalogAsset, 'category' | 'subcategory' | 'code'>): SeatRole | null {
  const t = type.toUpperCase();
  const words = `${asset.category} ${asset.subcategory ?? ''} ${asset.code}`.toUpperCase();
  if (t === 'SOFA' || (asset.category === 'SOFA' && !/RECLINER/.test(words))) return 'SOFA';
  if (t === 'TV_UNIT' || t === 'TV' || /MEDIA|TV/.test(asset.subcategory ?? '')) return 'TV';
  if (t === 'COFFEE_TABLE' || asset.subcategory === 'COFFEE' || asset.subcategory === 'COFFEE_TABLE') return 'TABLE';
  if (t === 'ARMCHAIR' || asset.category === 'ARMCHAIR') return 'CHAIR';
  if (t === 'RUG' || asset.category === 'RUG') return 'RUG';
  return null;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const add = (p: Point, d: Point, k: number): Point => ({ x: p.x + d.x * k, y: p.y + d.y * k });

/**
 * The group's poses, or null when the room cannot hold a sofa that faces something (the plan's poses then stand
 * as planned). `others` are the pieces already standing (other rooms, kept pieces); `walkable` proves the walk.
 */
export function arrangeSeating<T>(
  space: SpaceModel, assets: Map<string, CatalogAsset>, room: SpaceRoom, pieces: Array<SeatPiece<T>>, others: ObjectInstance[],
  walkable: (objects: ObjectInstance[], assets: Map<string, CatalogAsset>) => boolean,
): { poses: Array<SeatPose<T>>; score: number } | null {
  const sofa = pieces.find((p) => p.role === 'SOFA');
  const tv = pieces.find((p) => p.role === 'TV') ?? null;
  const table = pieces.find((p) => p.role === 'TABLE') ?? null;
  const chairs = pieces.filter((p) => p.role === 'CHAIR').slice(0, 2);
  const rug = pieces.find((p) => p.role === 'RUG') ?? null;
  if (!sofa || (!tv && !table)) return null;

  // Each piece is judged among the pieces already standing plus the group placed so far.
  const local = new Map(assets);
  let k = 0;
  const instance = (p: SeatPiece<T>, at: Point, rotation: number): ObjectInstance => {
    const code = `__seat/${k += 1}`;
    local.set(code, { ...p.asset, code });
    return { instanceId: code, assetId: code, roomId: room.id, position: { x: at.x, y: 0, z: at.y }, rotationY: rotation, materialVariant: null, colorOverride: null, locked: false };
  };
  const clean = (p: SeatPiece<T>, at: Point, rotation: number, group: ObjectInstance[]) => {
    if (!pointInPolygon(at, room.polygon)) return false;
    const world = placementWorld({ space, assets: local, objects: [...others, ...group] }, room);
    return evaluateInWorld(world, p.asset, at, rotation).length === 0;
  };

  const sofaPoses = candidatePositions({ space, assets, objects: others }, sofa.asset, room);
  if (sofa.planned) sofaPoses.unshift(sofa.planned);
  const tvPoses = tv ? candidatePositions({ space, assets, objects: others }, tv.asset, room) : [];

  type Group = { poses: Array<SeatPose<T>>; objects: ObjectInstance[]; score: number };
  const groups: Group[] = [];
  let tried = 0;
  for (const s of sofaPoses) {
    if (tried >= SOFA_TRIES) break;
    if (!clean(sofa, s.at, s.rotation, [])) continue;
    tried += 1;
    const f = frontOf(s.rotation);
    const right = { x: f.y, y: -f.x };
    const objects = [instance(sofa, s.at, s.rotation)];
    const poses: Array<SeatPose<T>> = [{ item: sofa.item, at: s.at, rotation: s.rotation }];
    let score = 0;

    // The television: on the wall the sofa faces, turned back toward it.
    if (tv) {
      const facing = tvPoses
        .map((c) => {
          const rel = { x: c.at.x - s.at.x, y: c.at.y - s.at.y };
          return { c, along: rel.x * f.x + rel.y * f.y, lateral: Math.abs(rel.x * right.x + rel.y * right.y) };
        })
        .filter((x) => Math.abs(wrap(x.c.rotation - (s.rotation + Math.PI))) < 0.15 && x.along >= TV_VIEW_MIN_M && x.along <= TV_VIEW_MAX_M && x.lateral <= TV_LATERAL_M)
        .sort((a, b) => a.lateral - b.lateral);
      const hit = facing.find((x) => clean(tv, x.c.at, x.c.rotation, objects));
      if (hit) {
        objects.push(instance(tv, hit.c.at, hit.c.rotation));
        poses.push({ item: tv.item, at: hit.c.at, rotation: hit.c.rotation });
        // Square on is better than off to one side.
        score += 4 - hit.lateral;
      }
    }
    // The coffee table, a knee's gap in front of the sofa (and short of the television's own front).
    let tableAt: Point | null = null;
    if (table) {
      const at = add(s.at, f, sofa.asset.depthM / 2 + TABLE_GAP_M + table.asset.depthM / 2);
      if (clean(table, at, s.rotation, objects)) {
        objects.push(instance(table, at, s.rotation));
        poses.push({ item: table.item, at, rotation: s.rotation });
        tableAt = at;
        score += 2;
      }
    }
    // The armchairs, either side of the table (or of where it would stand), turned toward it.
    const hub = tableAt ?? add(s.at, f, sofa.asset.depthM / 2 + TABLE_GAP_M + 0.3);
    const tableHalf = table ? table.asset.widthM / 2 : 0.3;
    const used = [false, false];
    for (const chair of chairs) {
      let done = false;
      for (let side = 0; side < 2 && !done; side += 1) {
        if (used[side]) continue;
        const dir = side === 0 ? right : { x: -right.x, y: -right.y };
        const rotation = rotationFacing({ x: -dir.x, y: -dir.y });
        // Beside the table, else a little further out or a little toward what the sofa faces (clear of its front).
        for (const [gap, ahead] of CHAIR_SPOTS) {
          const at = add(add(hub, dir, tableHalf + gap + chair.asset.depthM / 2), f, ahead);
          if (!clean(chair, at, rotation, objects)) continue;
          objects.push(instance(chair, at, rotation));
          poses.push({ item: chair.item, at, rotation });
          score += 1;
          used[side] = true;
          done = true;
          break;
        }
      }
    }
    // A sofa that faces nothing is not a group.
    if (score < 1.5) continue;
    // Nearness to the plan's sofa: the design's intent, when it is coherent.
    if (sofa.planned) score -= 0.25 * Math.hypot(s.at.x - sofa.planned.at.x, s.at.y - sofa.planned.at.y) + 0.2 * Math.abs(wrap(s.rotation - sofa.planned.rotation));
    // The rug lies under the group, centred between the sofa and what it faces (a flat piece never blocks).
    if (rug) {
      const ahead = poses.find((p) => p.item === tv?.item)?.at ?? hub;
      poses.push({ item: rug.item, at: { x: (s.at.x + ahead.x) / 2, y: (s.at.y + ahead.y) / 2 }, rotation: s.rotation });
    }
    groups.push({ poses, objects, score });
  }
  // A group that closes a way is tried again with fewer armchairs (the walk wins over the last chair), best first.
  const chairItems = new Set(chairs.map((c) => c.item));
  const variants: Group[] = [];
  for (const g of groups) {
    variants.push(g);
    let poses = g.poses; let objects = g.objects; let score = g.score;
    for (let drop = poses.filter((p) => chairItems.has(p.item)).length; drop > 0; drop -= 1) {
      const last = [...poses].reverse().find((p) => chairItems.has(p.item))!;
      const at = poses.indexOf(last);
      poses = poses.filter((_, i) => i !== at);
      objects = objects.filter((o) => !(Math.abs(o.position.x - last.at.x) < 1e-9 && Math.abs(o.position.z - last.at.y) < 1e-9));
      score -= 1.05;
      variants.push({ poses, objects, score });
    }
  }
  variants.sort((a, b) => b.score - a.score);
  for (const g of variants.slice(0, WALK_PROOFS * 3)) {
    if (!walkable(g.objects, local)) continue;
    return { poses: g.poses, score: g.score };
  }
  return null;
}
