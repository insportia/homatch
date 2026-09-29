// EVERY CHANGE TO A DESIGN IS AN OPERATION.
//
// The customer's clicks, drags and colour picks, and later the AI designer's
// plans, all become the same explicit operations. One validator decides
// whether an operation is allowed; one pure function applies it and returns
// its exact inverse. That single path is what makes undo, redo, autosave,
// history, audit and AI validation the same machinery instead of five.
//
//   validate → apply → (state', inverse) → history / persistence
//
// Nothing here renders, fetches or guesses. An operation that would put a
// sofa through a wall is REJECTED with a reason; it is never nudged into a
// different place behind the customer's back.

import { HEX, type CatalogAsset, type CatalogMaterial } from './catalog.ts';
import type { DesignState, LightingState, LockSet, ObjectInstance, SurfaceAssignment } from './designState.ts';
import { blocks, evaluatePlacement, type PlacementIssue } from './placement.ts';
import { parseSurfaceId, type SpaceModel } from './space.ts';
import { HIDEABLE_ROLES, PAINTABLE_ROLES, type PartRole } from './modelParts.ts';

export type Operation =
  | { type: 'ADD_OBJECT'; object: ObjectInstance }
  | { type: 'REMOVE_OBJECT'; instanceId: string }
  | { type: 'MOVE_OBJECT'; instanceId: string; position: { x: number; y: number; z: number }; roomId: string | null }
  | { type: 'ROTATE_OBJECT'; instanceId: string; rotationY: number }
  | { type: 'REPLACE_OBJECT'; instanceId: string; assetId: string }
  | { type: 'SET_OBJECT_COLOR'; instanceId: string; color: string | null }
  | { type: 'SET_OBJECT_VARIANT'; instanceId: string; variant: string | null }
  | { type: 'LOCK_OBJECT'; instanceId: string }
  | { type: 'UNLOCK_OBJECT'; instanceId: string }
  | { type: 'ASSIGN_MATERIAL'; surfaceIds: string[]; materialId: string | null }
  | { type: 'SET_SURFACE_COLOR'; surfaceIds: string[]; color: string | null; finish?: SurfaceAssignment['finish'] }
  /** Exact restore of surface assignments — the inverse of the two above. */
  | { type: 'SET_SURFACES'; assignments: Record<string, SurfaceAssignment | null> }
  | { type: 'SET_LIGHTING'; lighting: Partial<Omit<LightingState, 'locked'>> }
  | { type: 'SET_LOCKS'; locks: Partial<LockSet> }
  | { type: 'APPLY_PALETTE'; palette: string[] }
  | { type: 'SET_STYLE'; styleCode: string | null }
  /** Uploaded models: hide or show an identified furniture part. */
  | { type: 'SET_PART_HIDDEN'; partId: string; hidden: boolean };

export type OperationType = Operation['type'];

export type RejectionCode =
  | 'UNKNOWN_OPERATION' | 'MALFORMED' | 'UNKNOWN_OBJECT' | 'DUPLICATE_OBJECT' | 'UNKNOWN_ASSET' | 'INACTIVE_ASSET'
  | 'UNKNOWN_SURFACE' | 'UNKNOWN_MATERIAL' | 'MATERIAL_NOT_FOR_SURFACE' | 'BAD_COLOR' | 'OBJECT_LOCKED'
  | 'CATEGORY_LOCKED' | 'PLACEMENT_BLOCKED' | 'NO_SPACE_MODEL' | 'TOO_MANY_OBJECTS';

export interface Rejection {
  code: RejectionCode;
  detail?: string;
  placement?: PlacementIssue[];
}

export interface OperationContext {
  space: SpaceModel | null;
  /** Uploaded models: the parts the server identified, by `part:<node>` id. */
  parts?: Map<string, PartRole>;
  assets: Map<string, CatalogAsset>;
  materials: Map<string, CatalogMaterial>;
}

export const MAX_OBJECTS = 2000;

const finite = (...n: number[]) => n.every((v) => typeof v === 'number' && Number.isFinite(v));
const findObject = (s: DesignState, id: string) => s.objects.find((o) => o.instanceId === id);
const KITCHEN_CATEGORIES = new Set(['KITCHEN']);

function roomKindOf(ctx: OperationContext, roomId: string | null): string | null {
  return roomId ? ctx.space?.rooms.find((r) => r.id === roomId)?.kind ?? null : null;
}

/** Why this operation may not be applied to this state, or null when it may. */
export function validateOperation(state: DesignState, op: Operation, ctx: OperationContext): Rejection | null {
  if (!op || typeof op !== 'object' || typeof (op as { type?: unknown }).type !== 'string') return { code: 'MALFORMED' };
  const locks = state.locks;

  const objectOp = (id: string, action: 'EDIT' | 'LAYOUT' | 'FURNITURE' | 'COLOR'): Rejection | ObjectInstance => {
    const obj = findObject(state, id);
    if (!obj) return { code: 'UNKNOWN_OBJECT', detail: id };
    if (obj.locked) return { code: 'OBJECT_LOCKED', detail: id };
    if (action === 'LAYOUT' && locks.layout) return { code: 'CATEGORY_LOCKED', detail: 'layout' };
    if (action === 'FURNITURE' && locks.furniture) return { code: 'CATEGORY_LOCKED', detail: 'furniture' };
    if (action === 'COLOR' && locks.colors) return { code: 'CATEGORY_LOCKED', detail: 'colors' };
    const asset = ctx.assets.get(obj.assetId);
    if (locks.kitchen && (KITCHEN_CATEGORIES.has(asset?.category ?? '') || roomKindOf(ctx, obj.roomId) === 'KITCHEN')) {
      return { code: 'CATEGORY_LOCKED', detail: 'kitchen' };
    }
    return obj;
  };
  const placementCheck = (asset: CatalogAsset, x: number, z: number, rotation: number, roomId: string | null, instanceId?: string): Rejection | null => {
    if (!ctx.space) return { code: 'NO_SPACE_MODEL' };
    if (asset.placement !== 'FLOOR') return null;
    const others = state.objects;
    const issues = evaluatePlacement({ space: ctx.space, assets: ctx.assets, objects: others }, asset, { x, y: z }, rotation, roomId, instanceId);
    return blocks(issues) ? { code: 'PLACEMENT_BLOCKED', placement: issues } : null;
  };
  const surfaceCheck = (ids: string[]): Rejection | null => {
    if (!Array.isArray(ids) || ids.length === 0) return { code: 'MALFORMED', detail: 'surfaceIds' };
    const known = new Set(ctx.space?.surfaces.map((s) => s.id) ?? []);
    for (const id of ids) {
      if (typeof id === 'string' && id.startsWith('part:')) {
        const role = ctx.parts?.get(id);
        if (!role || !PAINTABLE_ROLES.has(role)) return { code: 'UNKNOWN_SURFACE', detail: id };
        if (state.surfaces[id]?.locked) return { code: 'OBJECT_LOCKED', detail: id };
        if (role === 'FLOOR' && locks.floor) return { code: 'CATEGORY_LOCKED', detail: 'floor' };
        if (role === 'WALL' && locks.walls) return { code: 'CATEGORY_LOCKED', detail: 'walls' };
        continue;
      }
      const parsed = parseSurfaceId(id);
      if (!parsed || !known.has(id)) return { code: 'UNKNOWN_SURFACE', detail: id };
      if (state.surfaces[id]?.locked) return { code: 'OBJECT_LOCKED', detail: id };
      if (parsed.kind === 'FLOOR' && locks.floor) return { code: 'CATEGORY_LOCKED', detail: 'floor' };
      if (parsed.kind === 'WALL' && locks.walls) return { code: 'CATEGORY_LOCKED', detail: 'walls' };
      if (locks.kitchen && roomKindOf(ctx, parsed.roomId) === 'KITCHEN') return { code: 'CATEGORY_LOCKED', detail: 'kitchen' };
    }
    return null;
  };

  switch (op.type) {
    case 'ADD_OBJECT': {
      const o = op.object;
      if (!o || typeof o.instanceId !== 'string' || !o.instanceId || typeof o.assetId !== 'string') return { code: 'MALFORMED' };
      if (!finite(o.position?.x, o.position?.y, o.position?.z, o.rotationY)) return { code: 'MALFORMED', detail: 'transform' };
      if (findObject(state, o.instanceId)) return { code: 'DUPLICATE_OBJECT' };
      if (state.objects.length >= MAX_OBJECTS) return { code: 'TOO_MANY_OBJECTS' };
      if (locks.layout) return { code: 'CATEGORY_LOCKED', detail: 'layout' };
      if (locks.furniture) return { code: 'CATEGORY_LOCKED', detail: 'furniture' };
      const asset = ctx.assets.get(o.assetId);
      if (!asset) return { code: 'UNKNOWN_ASSET', detail: o.assetId };
      if (!asset.active) return { code: 'INACTIVE_ASSET', detail: o.assetId };
      if (o.colorOverride != null && !HEX.test(o.colorOverride)) return { code: 'BAD_COLOR' };
      if (locks.kitchen && (asset.category === 'KITCHEN' || roomKindOf(ctx, o.roomId) === 'KITCHEN')) return { code: 'CATEGORY_LOCKED', detail: 'kitchen' };
      return placementCheck(asset, o.position.x, o.position.z, o.rotationY, o.roomId);
    }
    case 'REMOVE_OBJECT': {
      const r = objectOp(op.instanceId, 'FURNITURE');
      if ('code' in r) return r;
      return locks.layout ? { code: 'CATEGORY_LOCKED', detail: 'layout' } : null;
    }
    case 'MOVE_OBJECT': {
      if (!finite(op.position?.x, op.position?.y, op.position?.z)) return { code: 'MALFORMED', detail: 'position' };
      const r = objectOp(op.instanceId, 'LAYOUT');
      if ('code' in r) return r;
      const asset = ctx.assets.get(r.assetId);
      if (!asset) return { code: 'UNKNOWN_ASSET', detail: r.assetId };
      return placementCheck(asset, op.position.x, op.position.z, r.rotationY, op.roomId, r.instanceId);
    }
    case 'ROTATE_OBJECT': {
      if (!finite(op.rotationY)) return { code: 'MALFORMED', detail: 'rotation' };
      const r = objectOp(op.instanceId, 'LAYOUT');
      if ('code' in r) return r;
      const asset = ctx.assets.get(r.assetId);
      if (!asset) return { code: 'UNKNOWN_ASSET', detail: r.assetId };
      return placementCheck(asset, r.position.x, r.position.z, op.rotationY, r.roomId, r.instanceId);
    }
    case 'REPLACE_OBJECT': {
      const r = objectOp(op.instanceId, 'FURNITURE');
      if ('code' in r) return r;
      const asset = ctx.assets.get(op.assetId);
      if (!asset) return { code: 'UNKNOWN_ASSET', detail: op.assetId };
      if (!asset.active) return { code: 'INACTIVE_ASSET', detail: op.assetId };
      return placementCheck(asset, r.position.x, r.position.z, r.rotationY, r.roomId, r.instanceId);
    }
    case 'SET_OBJECT_COLOR': {
      if (op.color != null && !HEX.test(op.color)) return { code: 'BAD_COLOR' };
      const r = objectOp(op.instanceId, 'COLOR');
      return 'code' in r ? r : null;
    }
    case 'SET_OBJECT_VARIANT': {
      const r = objectOp(op.instanceId, 'EDIT');
      if ('code' in r) return r;
      if (op.variant != null && !ctx.assets.get(r.assetId)?.variants.some((v) => v.id === op.variant)) return { code: 'MALFORMED', detail: 'variant' };
      return null;
    }
    case 'LOCK_OBJECT':
    case 'UNLOCK_OBJECT':
      return findObject(state, op.instanceId) ? null : { code: 'UNKNOWN_OBJECT', detail: op.instanceId };
    case 'ASSIGN_MATERIAL': {
      const bad = surfaceCheck(op.surfaceIds);
      if (bad) return bad;
      if (op.materialId == null) return null;
      const m = ctx.materials.get(op.materialId);
      if (!m || !m.active) return { code: 'UNKNOWN_MATERIAL', detail: op.materialId };
      for (const id of op.surfaceIds) {
        const kind = (id.startsWith('part:') ? ctx.parts!.get(id)! : parseSurfaceId(id)!.kind) as 'FLOOR' | 'WALL' | 'CEILING';
        if (!m.appliesTo.includes(kind)) return { code: 'MATERIAL_NOT_FOR_SURFACE', detail: `${m.code} → ${kind}` };
      }
      return null;
    }
    case 'SET_SURFACE_COLOR': {
      if (op.color != null && !HEX.test(op.color)) return { code: 'BAD_COLOR' };
      if (locks.colors) return { code: 'CATEGORY_LOCKED', detail: 'colors' };
      return surfaceCheck(op.surfaceIds);
    }
    case 'SET_SURFACES': {
      // Normally only an inverse (applied unchecked by undo). When sent
      // directly it gets every check the forward operations get.
      if (!op.assignments || typeof op.assignments !== 'object') return { code: 'MALFORMED' };
      const ids = Object.keys(op.assignments);
      const bad = surfaceCheck(ids);
      if (bad) return bad;
      for (const value of Object.values(op.assignments)) {
        if (!value) continue;
        if (value.color != null && !HEX.test(value.color)) return { code: 'BAD_COLOR' };
        if (value.materialId != null && !ctx.materials.get(value.materialId)?.active) return { code: 'UNKNOWN_MATERIAL', detail: value.materialId };
      }
      return null;
    }
    case 'SET_PART_HIDDEN': {
      if (typeof op.partId !== 'string' || typeof op.hidden !== 'boolean') return { code: 'MALFORMED' };
      const role = ctx.parts?.get(op.partId);
      if (!role || !HIDEABLE_ROLES.has(role)) return { code: 'UNKNOWN_OBJECT', detail: op.partId };
      if (locks.layout) return { code: 'CATEGORY_LOCKED', detail: 'layout' };
      if (locks.furniture) return { code: 'CATEGORY_LOCKED', detail: 'furniture' };
      return null;
    }
    case 'SET_LIGHTING': {
      if (locks.lighting || state.lighting.locked) return { code: 'CATEGORY_LOCKED', detail: 'lighting' };
      const l = op.lighting ?? {};
      if (l.timeOfDay && !['DAY', 'EVENING', 'NIGHT'].includes(l.timeOfDay)) return { code: 'MALFORMED', detail: 'timeOfDay' };
      if (l.temperature && !['WARM', 'NEUTRAL', 'COOL'].includes(l.temperature)) return { code: 'MALFORMED', detail: 'temperature' };
      if (l.interiorIntensity != null && (!finite(l.interiorIntensity) || l.interiorIntensity < 0 || l.interiorIntensity > 1)) {
        return { code: 'MALFORMED', detail: 'interiorIntensity' };
      }
      return null;
    }
    case 'SET_LOCKS':
      return op.locks && typeof op.locks === 'object' ? null : { code: 'MALFORMED' };
    case 'APPLY_PALETTE':
      if (locks.colors) return { code: 'CATEGORY_LOCKED', detail: 'colors' };
      return Array.isArray(op.palette) && op.palette.length <= 12 && op.palette.every((c) => HEX.test(c)) ? null : { code: 'BAD_COLOR' };
    case 'SET_STYLE':
      return op.styleCode == null || typeof op.styleCode === 'string' ? null : { code: 'MALFORMED' };
    default:
      return { code: 'UNKNOWN_OPERATION' };
  }
}

const EMPTY_SURFACE: SurfaceAssignment = { materialId: null, color: null, finish: null, locked: false };

function mapObject(state: DesignState, id: string, fn: (o: ObjectInstance) => ObjectInstance): DesignState {
  return { ...state, objects: state.objects.map((o) => (o.instanceId === id ? fn(o) : o)) };
}

/**
 * Apply an ALREADY VALIDATED operation. Returns the new state and the
 * operation(s) that exactly undo it. Pure: the input state is not touched.
 */
export function applyOperation(state: DesignState, op: Operation): { state: DesignState; inverse: Operation[] } {
  switch (op.type) {
    case 'ADD_OBJECT':
      return { state: { ...state, objects: [...state.objects, op.object] }, inverse: [{ type: 'REMOVE_OBJECT', instanceId: op.object.instanceId }] };
    case 'REMOVE_OBJECT': {
      const obj = findObject(state, op.instanceId)!;
      return { state: { ...state, objects: state.objects.filter((o) => o.instanceId !== op.instanceId) }, inverse: [{ type: 'ADD_OBJECT', object: obj }] };
    }
    case 'MOVE_OBJECT': {
      const obj = findObject(state, op.instanceId)!;
      return {
        state: mapObject(state, op.instanceId, (o) => ({ ...o, position: { ...op.position }, roomId: op.roomId })),
        inverse: [{ type: 'MOVE_OBJECT', instanceId: op.instanceId, position: { ...obj.position }, roomId: obj.roomId }],
      };
    }
    case 'ROTATE_OBJECT': {
      const obj = findObject(state, op.instanceId)!;
      return {
        state: mapObject(state, op.instanceId, (o) => ({ ...o, rotationY: op.rotationY })),
        inverse: [{ type: 'ROTATE_OBJECT', instanceId: op.instanceId, rotationY: obj.rotationY }],
      };
    }
    case 'REPLACE_OBJECT': {
      const obj = findObject(state, op.instanceId)!;
      // A different asset starts from its own defaults: the old variant may not exist on it.
      return {
        state: mapObject(state, op.instanceId, (o) => ({ ...o, assetId: op.assetId, materialVariant: null })),
        inverse: [
          { type: 'REPLACE_OBJECT', instanceId: op.instanceId, assetId: obj.assetId },
          ...(obj.materialVariant ? [{ type: 'SET_OBJECT_VARIANT', instanceId: op.instanceId, variant: obj.materialVariant } as Operation] : []),
        ],
      };
    }
    case 'SET_OBJECT_COLOR': {
      const obj = findObject(state, op.instanceId)!;
      return {
        state: mapObject(state, op.instanceId, (o) => ({ ...o, colorOverride: op.color })),
        inverse: [{ type: 'SET_OBJECT_COLOR', instanceId: op.instanceId, color: obj.colorOverride }],
      };
    }
    case 'SET_OBJECT_VARIANT': {
      const obj = findObject(state, op.instanceId)!;
      return {
        state: mapObject(state, op.instanceId, (o) => ({ ...o, materialVariant: op.variant })),
        inverse: [{ type: 'SET_OBJECT_VARIANT', instanceId: op.instanceId, variant: obj.materialVariant }],
      };
    }
    case 'LOCK_OBJECT':
    case 'UNLOCK_OBJECT': {
      const obj = findObject(state, op.instanceId)!;
      const locked = op.type === 'LOCK_OBJECT';
      return {
        state: mapObject(state, op.instanceId, (o) => ({ ...o, locked })),
        inverse: [{ type: obj.locked ? 'LOCK_OBJECT' : 'UNLOCK_OBJECT', instanceId: op.instanceId }],
      };
    }
    case 'ASSIGN_MATERIAL':
    case 'SET_SURFACE_COLOR': {
      const before: Record<string, SurfaceAssignment | null> = {};
      const surfaces = { ...state.surfaces };
      for (const id of op.surfaceIds) {
        before[id] = state.surfaces[id] ?? null;
        const current = state.surfaces[id] ?? EMPTY_SURFACE;
        surfaces[id] = op.type === 'ASSIGN_MATERIAL'
          ? { ...current, materialId: op.materialId }
          : { ...current, color: op.color, finish: op.finish ?? current.finish };
      }
      return { state: { ...state, surfaces }, inverse: [{ type: 'SET_SURFACES', assignments: before }] };
    }
    case 'SET_SURFACES': {
      const before: Record<string, SurfaceAssignment | null> = {};
      const surfaces = { ...state.surfaces };
      for (const [id, value] of Object.entries(op.assignments)) {
        before[id] = state.surfaces[id] ?? null;
        if (value) surfaces[id] = value;
        else delete surfaces[id];
      }
      return { state: { ...state, surfaces }, inverse: [{ type: 'SET_SURFACES', assignments: before }] };
    }
    case 'SET_LIGHTING': {
      const { locked: _locked, ...previous } = state.lighting;
      return {
        state: { ...state, lighting: { ...state.lighting, ...op.lighting } },
        inverse: [{ type: 'SET_LIGHTING', lighting: previous }],
      };
    }
    case 'SET_LOCKS':
      return { state: { ...state, locks: { ...state.locks, ...op.locks } }, inverse: [{ type: 'SET_LOCKS', locks: { ...state.locks } }] };
    case 'APPLY_PALETTE':
      return { state: { ...state, palette: [...op.palette] }, inverse: [{ type: 'APPLY_PALETTE', palette: [...state.palette] }] };
    case 'SET_STYLE':
      return { state: { ...state, styleCode: op.styleCode }, inverse: [{ type: 'SET_STYLE', styleCode: state.styleCode }] };
    case 'SET_PART_HIDDEN': {
      const was = state.hiddenParts.includes(op.partId);
      const hiddenParts = op.hidden
        ? (was ? state.hiddenParts : [...state.hiddenParts, op.partId])
        : state.hiddenParts.filter((p) => p !== op.partId);
      return { state: { ...state, hiddenParts }, inverse: [{ type: 'SET_PART_HIDDEN', partId: op.partId, hidden: was }] };
    }
  }
}

/** A group of operations applied and undone as ONE step (e.g. an AI plan). */
export interface Transaction {
  id: string;
  label: string;
  origin: 'USER' | 'AI' | 'SYSTEM';
  ops: Operation[];
  inverse: Operation[];
}

/**
 * Validate and apply operations in order, all or nothing. The first
 * rejection aborts the whole transaction and the state is unchanged.
 */
export function applyTransaction(
  state: DesignState,
  ops: Operation[],
  ctx: OperationContext,
  meta: { id: string; label: string; origin: Transaction['origin'] },
): { ok: true; state: DesignState; transaction: Transaction } | { ok: false; index: number; rejection: Rejection } {
  let current = state;
  const inverse: Operation[] = [];
  for (let i = 0; i < ops.length; i += 1) {
    const rejection = validateOperation(current, ops[i], ctx);
    if (rejection) return { ok: false, index: i, rejection };
    const result = applyOperation(current, ops[i]);
    current = result.state;
    inverse.unshift(...result.inverse);
  }
  return { ok: true, state: current, transaction: { ...meta, ops, inverse } };
}

/**
 * Undo/redo apply inverses WITHOUT re-validating placement or locks: the
 * inverse restores a state that already existed, and a lock added later
 * must not trap the customer in a change they want to take back.
 */
export function applyUnchecked(state: DesignState, ops: Operation[]): DesignState {
  return ops.reduce((s, op) => applyOperation(s, op).state, state);
}
