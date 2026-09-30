// VERSIONS AS WORK STATES.
//
// A version is a design state with a name and a lineage. Because a state is
// only the design (asset references, surface assignments, lighting), a
// version is kilobytes whatever the apartment weighs, and comparing two of
// them is a comparison of decisions, not of meshes.

import type { DesignState } from './designState.ts';

export interface DesignDiff {
  objectsAdded: number;
  objectsRemoved: number;
  objectsReplaced: number;
  objectsMoved: number;
  objectsRestyled: number;
  surfacesChanged: number;
  lightingChanged: boolean;
  paletteChanged: boolean;
  styleChanged: boolean;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** What differs between two design states — counts a person can read, not a patch. */
export function diffDesigns(a: DesignState, b: DesignState): DesignDiff {
  const aObjects = new Map(a.objects.map((o) => [o.instanceId, o]));
  const bObjects = new Map(b.objects.map((o) => [o.instanceId, o]));
  let added = 0; let removed = 0; let replaced = 0; let moved = 0; let restyled = 0;
  for (const [id, o] of bObjects) {
    const before = aObjects.get(id);
    if (!before) { added += 1; continue; }
    if (before.assetId !== o.assetId) replaced += 1;
    if (!same(before.position, o.position) || before.rotationY !== o.rotationY) moved += 1;
    if (before.materialVariant !== o.materialVariant || before.colorOverride !== o.colorOverride) restyled += 1;
  }
  for (const id of aObjects.keys()) if (!bObjects.has(id)) removed += 1;

  const surfaceIds = new Set([...Object.keys(a.surfaces), ...Object.keys(b.surfaces)]);
  let surfacesChanged = 0;
  for (const id of surfaceIds) {
    const x = a.surfaces[id];
    const y = b.surfaces[id];
    if (!same(x?.materialId, y?.materialId) || !same(x?.color, y?.color) || !same(x?.finish, y?.finish)) surfacesChanged += 1;
  }
  const { locked: _la, ...la } = a.lighting;
  const { locked: _lb, ...lb } = b.lighting;
  return {
    objectsAdded: added,
    objectsRemoved: removed,
    objectsReplaced: replaced,
    objectsMoved: moved,
    objectsRestyled: restyled,
    surfacesChanged,
    lightingChanged: !same(la, lb),
    paletteChanged: !same(a.palette, b.palette),
    styleChanged: a.styleCode !== b.styleCode,
  };
}

export const isEmptyDiff = (d: DesignDiff) =>
  !d.objectsAdded && !d.objectsRemoved && !d.objectsReplaced && !d.objectsMoved && !d.objectsRestyled
  && !d.surfacesChanged && !d.lightingChanged && !d.paletteChanged && !d.styleChanged;

/** A fresh copy of a state for a new version: instance ids are kept so versions stay comparable. */
export function copyState(state: DesignState): DesignState {
  return JSON.parse(JSON.stringify(state)) as DesignState;
}

/** "Warm Minimal" → "Warm Minimal 2" when the name is taken. */
export function uniqueVersionName(base: string, taken: string[]): string {
  const names = new Set(taken.map((n) => n.trim().toLowerCase()));
  if (!names.has(base.trim().toLowerCase())) return base.trim();
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base.trim()} ${i}`;
    if (!names.has(candidate.toLowerCase())) return candidate;
  }
  return `${base.trim()} ${Date.now()}`;
}
