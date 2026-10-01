// WHAT A BUILT HOME MUST SATISFY — deterministic, before any AI looks at it.
//
// Every room can be walked to from every other through its doors; no two
// pieces stand inside each other; no piece stands outside the home; the scale
// is what the source established (a measured plan stays measured). These are
// facts computed from the canonical scene, not opinions.

import type { CanonicalSpace } from '../types.ts';
import type { CatalogAsset } from '../catalog.ts';
import type { DesignState } from '../designState.ts';
import { buildWalkModel, findPath, inSpace, nearestFree } from '../navigation.ts';
import { shapedAsset } from '../objectShape.ts';
import { footprint, obbOverlap } from '../placement.ts';
import type { SpaceModel } from '../space.ts';
import type { Dimension, Gate } from './fidelity.ts';

export interface DesignChecks {
  unreachableRooms: string[];
  overlaps: Array<[string, string]>;
  outside: string[];
  dimensions: Dimension[];
}

export function designChecks(space: SpaceModel, state: DesignState, assets: ReadonlyMap<string, CatalogAsset>, canonical: CanonicalSpace | null): DesignChecks {
  const model = buildWalkModel(space, state.objects, assets as Map<string, CatalogAsset>);
  // Walkability: from the first indoor room to every other room, doors open.
  const rooms = space.rooms.filter((r) => !r.outdoor);
  const start = rooms.length ? nearestFree(model, rooms[0].centroid, 2.5) : null;
  const unreachable: string[] = [];
  if (start) {
    for (const r of space.rooms.slice(1)) {
      const goal = nearestFree(model, r.centroid, 2.5);
      if (!goal || !findPath(model, start, goal, { throughDoors: true, maxCells: 60000 })) unreachable.push(r.id);
    }
  } else if (rooms.length) unreachable.push(...rooms.map((r) => r.id));
  // Intersections: pieces standing on the floor (rugs and wall pieces aside) never overlap, never stand outside.
  const solid = state.objects.flatMap((o) => {
    const own = assets.get(o.assetId);
    if (!own || own.placement !== 'FLOOR' || own.heightM <= 0.05) return [];
    const a = shapedAsset(own, { shape: o.shape });
    return [{ id: o.instanceId, box: footprint(a, { x: o.position.x, y: o.position.z }, o.rotationY), at: { x: o.position.x, y: o.position.z } }];
  });
  const overlaps: Array<[string, string]> = [];
  for (let i = 0; i < solid.length; i += 1) for (let j = i + 1; j < solid.length; j += 1) if (obbOverlap(solid[i].box, solid[j].box, 0.02)) overlaps.push([solid[i].id, solid[j].id]);
  const outside = solid.filter((s) => !inSpace(model, s.at)).map((s) => s.id);
  const scaleGate: Gate = !canonical ? 'UNKNOWN' : canonical.geometryState === 'CALIBRATED' ? 'PASS' : canonical.geometryState === 'ESTIMATED' ? 'WARN' : 'UNKNOWN';
  const built = canonical?.scene.built; const skipped = canonical?.scene.skipped;
  const dimensions: Dimension[] = [
    { name: 'scale', value: canonical ? `${canonical.geometryState}${canonical.scaleUncertainty ? ` (±${Math.round(canonical.scaleUncertainty * 100)}%)` : ''}` : 'unknown', gate: scaleGate, note: 'from the source: a measured plan stays measured' },
    { name: 'walls', value: built ? `${built.walls} built, ${skipped?.walls ?? 0} not verified` : `${space.walls.length} built`, gate: !skipped || skipped.walls === 0 ? 'PASS' : 'WARN', note: 'source-derived' },
    { name: 'openings', value: built ? `${built.doors} doors, ${built.windows} windows built; ${(skipped?.doors ?? 0) + (skipped?.windows ?? 0)} not verified` : 'n/a', gate: !skipped || skipped.doors + skipped.windows === 0 ? 'PASS' : 'WARN', note: 'source-derived' },
    { name: 'rooms', value: `${space.rooms.length} rooms${built ? `, ${built.balconies} balcony` : ''}`, gate: space.rooms.length ? 'PASS' : 'FAIL', note: 'source-derived' },
    { name: 'walkability', value: unreachable.length ? `${unreachable.length} room(s) cannot be walked to` : 'every room reachable through its doors', gate: unreachable.length ? 'FAIL' : 'PASS', note: unreachable.join(', ') },
    { name: 'intersections', value: `${overlaps.length} overlapping pairs, ${outside.length} outside the home`, gate: overlaps.length === 0 && outside.length === 0 ? 'PASS' : overlaps.length + outside.length <= 2 ? 'WARN' : 'FAIL', note: [...overlaps.slice(0, 4).map(([a, b]) => `${a}×${b}`), ...outside.slice(0, 4)].join(', ') },
  ];
  return { unreachableRooms: unreachable, overlaps, outside, dimensions };
}
