// HOMATCH Design Studio — is the furnished home one a person would believe?
//
// A tour can be walkable and still absurd: a wardrobe standing in the middle of
// a bedroom with its back to nothing, a bed half a metre off the wall, a sofa
// that faces away from the television, a visitor who arrives pressed against
// the back of a sofa. Each is measured here, deterministically, from the plan
// and the placed pieces — the same numbers the build repairs toward and the
// READY gate refuses on (walkthrough.ts NOT_PLAUSIBLE).
//
// Pure and dependency-free (Deno + Node + browser).

import type { CatalogAsset } from '../catalog.ts';
import { isFlat } from '../catalog.ts';
import type { ObjectInstance } from '../designState.ts';
import { distanceToObb, type WalkModel } from '../navigation.ts';
import { frontOf } from '../placement.ts';
import { shapedAsset } from '../objectShape.ts';
import { pointInPolygon, wallFrame, type Point, type SpaceModel } from '../space.ts';
import { entryShot, STANCE_CLEAR_M } from '../cameraDirector.ts';
import { seatRole } from './seatingGroup.ts';

export type PlausibilityCode = 'WALL_PIECE_FREE_STANDING' | 'SOFA_FACES_AWAY' | 'START_CRAMPED';
export interface PlausibilityIssue { code: PlausibilityCode; roomId: string | null; instanceId: string | null; detail: string }

/** A wall piece's back further than this from every wall face (m) stands free (a skirting and a reading's error allowed). */
export const WALL_BACK_GAP_M = 0.15;
/** A visitor's first view: at least this far from any standing piece (m) — STANCE_CLEAR_M with a reading's slack. */
const START_CLEAR_M = STANCE_CLEAR_M * 0.75;

/** How far a piece's back is from the nearest wall face of the plan (m). */
export function backGap(space: SpaceModel, asset: Pick<CatalogAsset, 'widthM' | 'depthM'>, at: Point, rotation: number): number {
  const f = frontOf(rotation);
  const back = { x: at.x - f.x * (asset.depthM / 2), y: at.y - f.y * (asset.depthM / 2) };
  let best = Infinity;
  for (const wall of space.walls) {
    const m = wall.mesh;
    const fr = wallFrame(m);
    const rel = { x: back.x - m.start.x, y: back.y - m.start.y };
    const u = Math.max(0, Math.min(fr.length, rel.x * fr.dir.x + rel.y * fr.dir.y));
    const q = { x: m.start.x + fr.dir.x * u, y: m.start.y + fr.dir.y * u };
    best = Math.min(best, Math.max(0, Math.hypot(back.x - q.x, back.y - q.y) - m.thicknessM / 2));
  }
  return best;
}

const isWallPiece = (a: CatalogAsset) => (a.anchor === 'WALL' || a.anchor === 'CORNER') && a.placement === 'FLOOR' && !isFlat(a);

export function plausibility(space: SpaceModel, objects: ObjectInstance[], assets: Map<string, CatalogAsset>, walk: WalkModel): PlausibilityIssue[] {
  const issues: PlausibilityIssue[] = [];
  const placed = objects.map((o) => {
    const own = assets.get(o.assetId);
    return own ? { o, asset: shapedAsset(own, o), at: { x: o.position.x, y: o.position.z } } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x);

  for (const p of placed) {
    if (!isWallPiece(p.asset)) continue;
    const gap = backGap(space, p.asset, p.at, p.o.rotationY);
    if (gap > WALL_BACK_GAP_M) issues.push({ code: 'WALL_PIECE_FREE_STANDING', roomId: p.o.roomId, instanceId: p.o.instanceId, detail: `${p.o.assetId} back ${gap.toFixed(2)} m from the wall` });
  }

  // A living room's sofa faces its television when it has one (on the axis, turned back toward it).
  for (const room of space.rooms) {
    const inRoom = placed.filter((p) => p.o.roomId === room.id || pointInPolygon(p.at, room.polygon));
    const sofas = inRoom.filter((p) => seatRole('', p.asset) === 'SOFA');
    const tvs = inRoom.filter((p) => seatRole('', p.asset) === 'TV');
    if (!sofas.length || !tvs.length) continue;
    const faced = sofas.some((s) => tvs.some((t) => {
      const f = frontOf(s.o.rotationY);
      const rel = { x: t.at.x - s.at.x, y: t.at.y - s.at.y };
      const along = rel.x * f.x + rel.y * f.y;
      const lateral = Math.abs(rel.x * f.y - rel.y * f.x);
      const turned = Math.abs(Math.atan2(Math.sin(t.o.rotationY - s.o.rotationY - Math.PI), Math.cos(t.o.rotationY - s.o.rotationY - Math.PI)));
      return along >= 1.2 && lateral <= 1.0 && turned < 0.6;
    }));
    if (!faced) issues.push({ code: 'SOFA_FACES_AWAY', roomId: room.id, instanceId: sofas[0].o.instanceId, detail: 'no sofa faces the television' });
  }

  // Where a visitor arrives: open floor, never wedged against a piece.
  const shot = entryShot(space, walk);
  if (shot) {
    const clear = walk.furniture.reduce((m, b) => Math.min(m, distanceToObb(shot.position, b)), Infinity);
    if (clear < START_CLEAR_M) issues.push({ code: 'START_CRAMPED', roomId: shot.roomId ?? null, instanceId: null, detail: `arrival ${clear.toFixed(2)} m from a piece` });
  }
  return issues;
}
