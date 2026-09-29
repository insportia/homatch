// THE DESIGN GRAMMAR — WHAT MAKES A ROOM WORK, CHECKED WITHOUT AI.
//
// The AI designer is told these rules (server copy in
// supabase/functions/_shared/designStudio/aiPlan.ts; a matrix test keeps
// the style codes in step). Here they are CHECKED, deterministically, on any
// design — the customer's own or a proposal — and reported as notes:
//
//   · a room is missing what it is for (a bedroom without a bed)
//   · the colour story is scattered (more distinct wall colours than a
//     60/30/10 scheme can hold)
//   · a piece blocks a door or leaves too little room to pass
//
// Notes inform; they never block and never change the design.

import type { CatalogAsset } from './catalog.ts';
import type { DesignState } from './designState.ts';
import { evaluatePlacement } from './placement.ts';
import type { SpaceModel } from './space.ts';

export const STYLE_CODES = [
  'warm-minimal', 'scandinavian', 'japandi', 'contemporary', 'mediterranean', 'industrial', 'classic', 'luxury',
] as const;
export type StyleCode = typeof STYLE_CODES[number];

/** A representative colour story per style, for the style picker. */
export const STYLE_SWATCHES: Record<StyleCode, string[]> = {
  'warm-minimal': ['#f2eee6', '#e2d3b9', '#cdb28b'],
  scandinavian: ['#f8f8f6', '#b6bfa7', '#cdb28b'],
  japandi: ['#ece6dc', '#b48b5e', '#4a3f36'],
  contemporary: ['#f8f8f6', '#d8d0c3', '#2e3a52'],
  mediterranean: ['#e2d3b9', '#c27f63', '#b9765a'],
  industrial: ['#9e9c98', '#3f4348', '#a39a8d'],
  classic: ['#efe7da', '#6d4b36', '#b48b5e'],
  luxury: ['#e7e3dc', '#6d4b36', '#44474c'],
};

/** What each room kind is for: at least one piece of each listed category. */
export const ROOM_ESSENTIALS: Record<string, Array<{ category: string; subcategory?: string; minAreaM2?: number }>> = {
  LIVING: [{ category: 'SOFA' }],
  BEDROOM: [{ category: 'BED' }, { category: 'WARDROBE', minAreaM2: 9 }],
  OFFICE: [{ category: 'TABLE', subcategory: 'DESK' }],
  // Bathrooms and kitchens are fitted: their fixtures are not on the drawing,
  // so a missing vanity or kitchen run is not something to point out.
};

/** Beyond this many distinct wall colours a home stops reading as one scheme. */
export const MAX_WALL_COLORS = 4;

export type DesignNote =
  | { code: 'MISSING_ESSENTIAL'; roomId: string; category: string }
  | { code: 'SCATTERED_COLORS'; count: number }
  | { code: 'BLOCKS_DOOR'; roomId: string | null; instanceId: string }
  | { code: 'TIGHT_ACCESS'; roomId: string | null; instanceId: string };

export function critique(state: DesignState, space: SpaceModel, assets: Map<string, CatalogAsset>, roomIds?: string[]): DesignNote[] {
  const notes: DesignNote[] = [];
  const rooms = space.rooms.filter((r) => !r.outdoor && (!roomIds || roomIds.includes(r.id)));

  for (const room of rooms) {
    const inRoom = state.objects.filter((o) => o.roomId === room.id).map((o) => assets.get(o.assetId)).filter((a): a is CatalogAsset => !!a);
    for (const need of ROOM_ESSENTIALS[room.kind] ?? []) {
      if (need.minAreaM2 && room.areaM2 < need.minAreaM2) continue;
      const has = inRoom.some((a) => a.category === need.category && (!need.subcategory || a.subcategory === need.subcategory));
      if (!has) notes.push({ code: 'MISSING_ESSENTIAL', roomId: room.id, category: need.subcategory ?? need.category });
    }
  }

  const wallColors = new Set(
    Object.entries(state.surfaces)
      .filter(([id, s]) => id.startsWith('wall:') && s.color)
      .map(([, s]) => s.color!.toLowerCase()),
  );
  if (wallColors.size > MAX_WALL_COLORS) notes.push({ code: 'SCATTERED_COLORS', count: wallColors.size });

  for (const obj of state.objects) {
    if (roomIds && (!obj.roomId || !roomIds.includes(obj.roomId))) continue;
    const asset = assets.get(obj.assetId);
    if (!asset || asset.placement !== 'FLOOR') continue;
    const issues = evaluatePlacement({ space, assets, objects: state.objects }, asset, { x: obj.position.x, y: obj.position.z }, obj.rotationY, obj.roomId, obj.instanceId);
    if (issues.some((i) => i.code === 'BLOCKS_DOOR')) notes.push({ code: 'BLOCKS_DOOR', roomId: obj.roomId, instanceId: obj.instanceId });
    else if (issues.some((i) => i.code === 'TIGHT_ACCESS')) notes.push({ code: 'TIGHT_ACCESS', roomId: obj.roomId, instanceId: obj.instanceId });
  }
  return notes;
}
