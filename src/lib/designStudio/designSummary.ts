// WHAT A DESIGN IS, ROOM BY ROOM — for presentations and shared pages.
//
// From the design state and the catalogue: each room's wall finish, floor
// finish and furniture, and the palette. Pure; no rendering.

import type { CatalogAsset, CatalogMaterial } from './catalog.ts';
import type { DesignState } from './designState.ts';
import { floorSurfaceId, surfacesOfRoom, type SpaceModel } from './space.ts';

export interface Finish { color: string | null; materialName: string | null }

export interface RoomSummary {
  roomId: string;
  kind: string;
  areaM2: number;
  walls: Finish | null;
  floor: Finish | null;
  furniture: Array<{ name: string; count: number }>;
}

export interface DesignSummary {
  palette: string[];
  rooms: RoomSummary[];
  pieces: number;
}

function finishOf(state: DesignState, ids: string[], materials: Map<string, CatalogMaterial>): Finish | null {
  // The most common assignment across the surfaces: one room, one answer.
  const counts = new Map<string, { finish: Finish; n: number }>();
  for (const id of ids) {
    const a = state.surfaces[id];
    if (!a || (!a.color && !a.materialId)) continue;
    const m = a.materialId ? materials.get(a.materialId) : undefined;
    const finish: Finish = { color: a.color ?? m?.pbr.baseColor ?? null, materialName: m?.name ?? null };
    const key = `${finish.color}|${finish.materialName}`;
    const hit = counts.get(key);
    if (hit) hit.n += 1; else counts.set(key, { finish, n: 1 });
  }
  let best: { finish: Finish; n: number } | null = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  return best?.finish ?? null;
}

export function summarizeDesign(
  state: DesignState, space: SpaceModel, assets: Map<string, CatalogAsset>, materials: Map<string, CatalogMaterial>,
): DesignSummary {
  const rooms: RoomSummary[] = space.rooms.map((room) => {
    const walls = surfacesOfRoom(space, room.id).filter((s) => s.kind === 'WALL').map((s) => s.id);
    const furniture = new Map<string, number>();
    for (const o of state.objects) {
      if (o.roomId !== room.id) continue;
      const name = assets.get(o.assetId)?.name ?? o.assetId;
      furniture.set(name, (furniture.get(name) ?? 0) + 1);
    }
    return {
      roomId: room.id,
      kind: room.kind,
      areaM2: room.areaM2,
      walls: finishOf(state, walls, materials),
      floor: finishOf(state, [floorSurfaceId(room.id)], materials),
      furniture: [...furniture.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
  return { palette: state.palette, rooms, pieces: state.objects.length };
}
