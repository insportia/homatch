// Stairs in the walkthrough: the parts stairParts.ts describes, as a handful
// of merged meshes (one per material across every flight), so a home with
// three flights costs three draw calls, not three hundred.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { StairMesh } from '@/lib/floorplan/geometry';
import { stairParts, stairSides, type StairPartKind } from '@/lib/designStudio/stairParts';
import type { SpaceModel } from '@/lib/designStudio/space';

/** Which material each part wears. */
export type StairMaterialRole = 'WOOD' | 'PAINT' | 'METAL' | 'WELL_UP' | 'WELL_DOWN';

const ROLE: Record<StairPartKind, 'WOOD' | 'PAINT' | 'METAL' | 'WELL'> = {
  TREAD: 'WOOD', RAIL: 'WOOD', POST: 'WOOD', RISER: 'PAINT', STRINGER: 'PAINT', BALUSTER: 'METAL', GUARD: 'METAL', WELL: 'WELL',
};

/** Every flight's parts as world-space geometry, merged per material role. */
export function stairGeometries(space: Pick<SpaceModel, 'stairs' | 'walls'>): Map<StairMaterialRole, THREE.BufferGeometry> {
  const lists = new Map<StairMaterialRole, THREE.BufferGeometry[]>();
  const walls = space.walls.map((w) => ({ start: w.mesh.start, end: w.mesh.end, thicknessM: w.mesh.thicknessM }));
  const m = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const pitch = new THREE.Matrix4();
  for (const st of space.stairs as StairMesh[]) {
    const angle = Math.atan2(st.b.y - st.a.y, st.b.x - st.a.x);
    const flight = new THREE.Matrix4().makeRotationY(angle).setPosition(st.a.x, 0, -st.a.y);
    for (const part of stairParts(st, stairSides(st, walls))) {
      const [u, v, h] = part.centre;
      const [su, sv, sh] = part.size;
      const g = new THREE.BoxGeometry(su, sh, sv);
      // Flight frame → three: x = u, y = h, z = −v; a pitch rises with v.
      local.makeTranslation(u, h, -v);
      pitch.makeRotationX(part.pitch);
      m.copy(flight).multiply(local).multiply(pitch);
      g.applyMatrix4(m);
      const base = ROLE[part.kind];
      const role: StairMaterialRole = base === 'WELL' ? (st.direction === 'DOWN' ? 'WELL_DOWN' : 'WELL_UP') : base;
      const list = lists.get(role) ?? [];
      list.push(g);
      lists.set(role, list);
    }
  }
  const out = new Map<StairMaterialRole, THREE.BufferGeometry>();
  for (const [role, list] of lists) {
    const merged = mergeGeometries(list, false);
    list.forEach((g) => g.dispose());
    if (merged) out.set(role, merged);
  }
  return out;
}
