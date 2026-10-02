// EDITING THE PICTURE IS EDITING THE HOME.
//
// A tap on a render resolves (through its object map) to a canonical object
// or surface. What the customer may do with it comes from the catalogue's
// capabilities and the design's locks, never from the picture. Every choice
// becomes DesignState operations — the same ones the editor uses, validated
// the same way (walls, door swings, stairs, other pieces) — so the approved
// home the walkthrough is built from is exactly what was edited.
//
//   APPEARANCE  colour / material / finish: nothing moves; the picture is
//               repainted inside the target's own mask, cheaply.
//   SPATIAL     move / rotate / replace / remove: the design changes, is
//               validated, and only the views that show the target (or would
//               show it at its new place) are rendered again by the factory.
//
// Pure: no I/O.

import type { CatalogAsset, CatalogMaterial } from '../catalog.ts';
import type { DesignState } from '../designState.ts';
import { applyOperation, validateOperation, type Operation, type OperationContext, type Rejection } from '../operations.ts';
import type { MapEntry, ObjectMap, RenderEdit, SpecView } from './contract.ts';

export type EditAction = 'COLOR' | 'MATERIAL' | 'REPLACE' | 'MOVE' | 'ROTATE' | 'REMOVE' | 'PAINT' | 'FINISH' | 'OPEN_CLOSE' | 'LIGHT';

/** Categories worth editing in a picture; small decor stays part of the scene. */
const MAJOR = new Set(['SOFA', 'ARMCHAIR', 'RECLINER', 'TABLE', 'ROUND_TABLE', 'BED', 'RUG', 'CABINET', 'SHELF', 'WARDROBE', 'DRESSER',
  'KITCHEN_RUN', 'KITCHEN', 'FRIDGE', 'TV_UNIT', 'VANITY', 'BATH', 'SHOWER', 'LAMP', 'LIGHTING', 'CHAIR', 'DESK', 'CURTAIN', 'BLIND']);

export function kindOf(asset: CatalogAsset | undefined): string {
  return String(asset?.procedural?.kind ?? asset?.category ?? '').toUpperCase();
}

/** What a tapped target offers. An empty list means "not editable here" (no highlight). */
export function actionsFor(entry: MapEntry, state: DesignState, assets: ReadonlyMap<string, CatalogAsset>): EditAction[] {
  const locks = state.locks;
  switch (entry.kind) {
    case 'WALL': return locks.walls || locks.colors ? [] : ['PAINT', 'MATERIAL'];
    case 'FLOOR': return locks.floor ? [] : ['MATERIAL', 'FINISH'];
    case 'CEILING': return locks.colors ? [] : ['PAINT'];
    case 'DOOR': return ['OPEN_CLOSE'];
    case 'OBJECT': {
      const obj = state.objects.find((o) => o.instanceId === entry.id);
      const asset = obj ? assets.get(obj.assetId) : undefined;
      if (!obj || !asset || obj.locked || locks.furniture) return [];
      const kind = kindOf(asset);
      if (!MAJOR.has(kind)) return [];
      const caps = new Set(asset.capabilities ?? []);
      const out: EditAction[] = [];
      if (asset.materialSlots?.length) out.push('COLOR');
      if (asset.variants?.length) out.push('MATERIAL');
      if (caps.has('REPLACEABLE')) out.push('REPLACE');
      if (caps.has('MOVABLE') && !locks.layout) out.push('MOVE');
      if (caps.has('ROTATABLE') && !locks.layout) out.push('ROTATE');
      if (kind === 'LAMP' || kind === 'LIGHTING' || caps.has('SWITCHABLE')) out.push('LIGHT');
      out.push('REMOVE');
      if (kind.startsWith('KITCHEN') && locks.kitchen) return out.filter((a) => a === 'COLOR');
      return out;
    }
    default: return [];
  }
}

export const isAppearance = (a: EditAction) => a === 'COLOR' || a === 'MATERIAL' || a === 'PAINT' || a === 'FINISH';

export type EditChoice =
  | { action: 'COLOR' | 'PAINT'; color: string }
  | { action: 'MATERIAL' | 'FINISH'; materialId?: string | null; variant?: string | null; finish?: 'MATTE' | 'SATIN' | 'GLOSS' | null }
  | { action: 'MOVE'; to: { x: number; y: number }; roomId: string | null }
  | { action: 'ROTATE'; rotationY: number }
  | { action: 'REPLACE'; assetId: string }
  | { action: 'REMOVE' };

/** The operations a choice means, for one target. */
export function operationsFor(entry: MapEntry, choice: EditChoice, state: DesignState): Operation[] {
  const obj = entry.kind === 'OBJECT' ? state.objects.find((o) => o.instanceId === entry.id) : null;
  switch (choice.action) {
    case 'COLOR':
    case 'PAINT':
      return obj ? [{ type: 'SET_OBJECT_COLOR', instanceId: obj.instanceId, color: choice.color }]
        : [{ type: 'SET_SURFACE_COLOR', surfaceIds: [entry.id], color: choice.color }];
    case 'MATERIAL':
    case 'FINISH':
      if (obj) return choice.variant !== undefined ? [{ type: 'SET_OBJECT_VARIANT', instanceId: obj.instanceId, variant: choice.variant ?? null }] : [];
      return [
        ...(choice.materialId !== undefined ? [{ type: 'ASSIGN_MATERIAL', surfaceIds: [entry.id], materialId: choice.materialId ?? null } as Operation] : []),
        ...(choice.finish !== undefined ? [{ type: 'SET_SURFACE_COLOR', surfaceIds: [entry.id], color: state.surfaces[entry.id]?.color ?? null, finish: choice.finish } as Operation] : []),
      ];
    case 'MOVE':
      return obj ? [{ type: 'MOVE_OBJECT', instanceId: obj.instanceId, position: { x: choice.to.x, y: obj.position.y, z: choice.to.y }, roomId: choice.roomId }] : [];
    case 'ROTATE':
      return obj ? [{ type: 'ROTATE_OBJECT', instanceId: obj.instanceId, rotationY: choice.rotationY }] : [];
    case 'REPLACE':
      return obj ? [{ type: 'REPLACE_OBJECT', instanceId: obj.instanceId, assetId: choice.assetId }] : [];
    case 'REMOVE':
      return obj ? [{ type: 'REMOVE_OBJECT', instanceId: obj.instanceId }] : [];
  }
}

export type EditResult =
  | { ok: true; state: DesignState; ops: Operation[]; kind: 'APPEARANCE' | 'SPATIAL'; edit: RenderEdit }
  | { ok: false; rejection: Rejection };

/** Apply a choice to the design, validated op by op exactly as the editor does. */
export function applyEdit(entry: MapEntry, choice: EditChoice, state: DesignState, ctx: OperationContext, label: string): EditResult {
  const ops = operationsFor(entry, choice, state);
  if (!ops.length) return { ok: false, rejection: { code: 'MALFORMED' } };
  let working = state;
  for (const op of ops) {
    const rej = validateOperation(working, op, ctx);
    if (rej) return { ok: false, rejection: rej };
    working = applyOperation(working, op).state;
  }
  const appearance = choice.action === 'COLOR' || choice.action === 'PAINT' || choice.action === 'MATERIAL' || choice.action === 'FINISH';
  // A factory-built model is baked in the old colours (or is the old piece): the piece goes back to
  // HOMATCH's own until the next factory pass bakes the new one — the walkthrough never shows the old look.
  if (entry.kind === 'OBJECT' && (appearance || choice.action === 'REPLACE')) {
    working = { ...working, objects: working.objects.map((o) => {
      if (o.instanceId !== entry.id || !o.generated) return o;
      const { generated: _old, ...rest } = o;
      return rest;
    }) };
  }
  const edit: RenderEdit = appearance
    ? {
      type: 'APPEARANCE', targetId: entry.id, targetKind: entry.kind,
      color: choice.action === 'COLOR' || choice.action === 'PAINT' ? choice.color : null,
      materialId: choice.action === 'MATERIAL' || choice.action === 'FINISH' ? (choice.materialId ?? choice.variant ?? null) : null,
      label,
    }
    : { type: 'SPATIAL', targetId: entry.id, op: choice.action as 'MOVE' | 'ROTATE' | 'REPLACE' | 'REMOVE', detail: { ...choice } as Record<string, unknown> };
  return { ok: true, state: working, ops, kind: appearance ? 'APPEARANCE' : 'SPATIAL', edit };
}

/**
 * The views an edit invalidates. Appearance: the views that show the target
 * (repainted in place). Spatial: those, plus the master (it shows the whole
 * home) and any room view of the room the piece moves into.
 */
export function affectedViews(
  edit: RenderEdit, views: Array<{ view: SpecView; legend: ObjectMap | null }>, movedToRoom: string | null = null,
): string[] {
  const shows = (legend: ObjectMap | null) => !!legend?.entries.some((e) => e.id === edit.targetId && e.coverage > 0.0005);
  const out = new Set<string>();
  for (const { view, legend } of views) {
    if (shows(legend)) out.add(view.id);
    if (edit.type === 'SPATIAL' && (view.kind === 'MASTER' || (movedToRoom && view.roomId === movedToRoom))) out.add(view.id);
  }
  return [...out];
}

/** A palette of good alternatives for a colour edit, from the home's own DNA first. */
export function colourChoices(dnaPalette: string[], current: string | null): string[] {
  const base = ['#f3eee4', '#d9d2c7', '#2f4f3a', '#3b4a5a', '#7a5a43', '#c9a77c', '#1d1f22', '#b6bfa7', '#e2d3b9', '#8c5a3c'];
  return [...new Set([...dnaPalette, ...base])].filter((c) => c !== current).slice(0, 10);
}

/** Alternatives for a replace: same kind, fits the room the piece is in (the engine validates the final spot). */
export function replacements(current: CatalogAsset, all: CatalogAsset[]): CatalogAsset[] {
  const kind = kindOf(current);
  return all.filter((a) => a.code !== current.code && a.active && kindOf(a) === kind)
    .sort((a, b) => Math.abs(a.widthM - current.widthM) - Math.abs(b.widthM - current.widthM)).slice(0, 8);
}

export type { CatalogMaterial };
