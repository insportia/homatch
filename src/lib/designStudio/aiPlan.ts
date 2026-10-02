// AN AI PROPOSAL, TURNED INTO OPERATIONS BY HOMATCH — NOT BY THE AI.
//
// The server (supabase/functions/_shared/designStudio/aiPlan.ts) returns a
// validated plan: WHAT each room should have. This file decides HOW, with
// the same deterministic engine the customer's own edits use:
//
//   palette, lighting            → APPLY_PALETTE, SET_LIGHTING
//   wall colour / material       → SET_SURFACE_COLOR / ASSIGN_MATERIAL on
//                                  every wall face of that room
//   floor material               → ASSIGN_MATERIAL on the room's floor
//   "clear the room"             → REMOVE_OBJECT for every piece not kept
//   furniture                    → ADD_OBJECT where autoPlace() finds room
//
// Every operation is validated against the design as it stands at that
// point; one that is refused (a kept piece, a wall, a door swing) is left
// out and REPORTED, never forced in. Same plan + same design = same result.
//
// The customer's look (plan-to-home): the server already held the plan to
// it; here the furnishing cap and the room semantics are checked again
// (nothing in a corridor or on stairs, only outdoor pieces outside), and no
// piece may stand on the built stairs (SpaceModel.stairs).

import type { CatalogAsset, CatalogMaterial } from './catalog.ts';
import type { DesignState, ObjectInstance } from './designState.ts';
import { applyOperation, validateOperation, type Operation, type OperationContext, type RejectionCode } from './operations.ts';
import { autoPlace, footprint, obbCorners, roomOf } from './placement.ts';
import { FURNISHING_CAP, type DesignPreferences, type FurnishingLevel } from './planToHome.ts';
import { floorSurfaceId, pointInPolygon, surfacesOfRoom, type Point, type SpaceModel } from './space.ts';

/** Mirrors PlanAlternative on the server (a matrix test keeps them in step). */
export interface PlanRoom {
  roomId: string;
  wallColor: string | null;
  wallMaterial: string | null;
  floorMaterial: string | null;
  clearFurniture: boolean;
  furniture: string[];
}

export interface PlanAlternative {
  title: string;
  rationale: string;
  styleCode: string | null;
  palette: string[];
  lighting: { timeOfDay: 'DAY' | 'EVENING' | 'NIGHT' | null; temperature: 'WARM' | 'NEUTRAL' | 'COOL' | null; interiorIntensity: number | null } | null;
  rooms: PlanRoom[];
}

export interface ValidatedPlan {
  version: string;
  alternatives: PlanAlternative[];
  dropped: Record<string, number>;
  /** The look the server held the plan to (plan-to-home flow only). */
  intent?: { preferences: DesignPreferences; filled: Record<string, number> } | null;
}

export type SkipReason = 'NO_SPACE' | 'UNKNOWN_ASSET' | 'UNKNOWN_MATERIAL' | 'ALREADY_THERE' | 'WRONG_ROOM' | 'ON_STAIRS' | 'FURNISHING_CAP' | RejectionCode;

/** Rooms that receive no furniture, and rooms that take only outdoor pieces (mirrors designIntent.ts). */
const EMPTY_KINDS = new Set(['CORRIDOR', 'STAIRS', 'STAIRCASE', 'STORAGE']);
const OUTDOOR_KINDS = new Set(['BALCONY', 'TERRACE']);
const outdoorPiece = (a: CatalogAsset) => a.category.toUpperCase() === 'OUTDOOR' || /PLANT/i.test(a.subcategory ?? '');
/** Room semantics of the plan-to-home flow: nothing in a corridor or on stairs; outside only outdoor pieces and plants, inside no outdoor furniture. */
function semanticFit(a: CatalogAsset, kind: string): boolean {
  if (EMPTY_KINDS.has(kind)) return false;
  if (OUTDOOR_KINDS.has(kind)) return outdoorPiece(a);
  return a.category.toUpperCase() !== 'OUTDOOR' || /PLANT/i.test(a.subcategory ?? '');
}

/** Does a piece's footprint at this spot touch a flight of stairs? */
export function onStairs(space: SpaceModel, asset: Pick<CatalogAsset, 'widthM' | 'depthM'>, at: Point, rotation: number): boolean {
  const stairs = space.stairs ?? [];
  if (!stairs.length) return false;
  const box = obbCorners(footprint(asset, at, rotation));
  const cross = (p: Point, q: Point, r: Point, s: Point) => {
    const d = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    return d(p, q, r) * d(p, q, s) < 0 && d(r, s, p) * d(r, s, q) < 0;
  };
  for (const st of stairs) {
    const poly = st.polygon as Point[];
    if (poly.length < 3) continue;
    if (box.some((p) => pointInPolygon(p, poly)) || poly.some((p) => pointInPolygon(p, box))) return true;
    for (let i = 0; i < 4; i += 1) {
      for (let j = 0; j < poly.length; j += 1) {
        if (cross(box[i], box[(i + 1) % 4], poly[j], poly[(j + 1) % poly.length])) return true;
      }
    }
  }
  return false;
}

export interface Skipped {
  roomId: string | null;
  what: 'FURNITURE' | 'WALLS' | 'FLOOR' | 'PALETTE' | 'LIGHTING' | 'CLEAR';
  code: string | null;
  reason: SkipReason;
}

export interface ProposalSummary {
  added: number;
  removed: number;
  surfaces: number;
  rooms: number;
  palette: boolean;
  lighting: boolean;
}

export interface Proposal {
  ops: Operation[];
  state: DesignState;
  skipped: Skipped[];
  summary: ProposalSummary;
}

export function planToOperations(
  alt: PlanAlternative,
  input: {
    state: DesignState;
    space: SpaceModel;
    ctx: OperationContext;
    /** Catalogue by code (the design's own keying). */
    assets: Map<string, CatalogAsset>;
    materials: CatalogMaterial[];
    /** Deterministic instance ids: `${idPrefix}-${n}`. */
    idPrefix: string;
    /** The customer's furnishing level: at most FURNISHING_CAP pieces added per room. */
    furnishing?: FurnishingLevel;
  },
): Proposal {
  let working = input.state;
  const ops: Operation[] = [];
  const skipped: Skipped[] = [];
  const touched = new Set<string>();
  const summary: ProposalSummary = { added: 0, removed: 0, surfaces: 0, rooms: 0, palette: false, lighting: false };
  const materialByCode = new Map(input.materials.filter((m) => m.active).map((m) => [m.code, m]));
  let n = 0;

  const attempt = (op: Operation, skip: Omit<Skipped, 'reason'>): boolean => {
    const rejection = validateOperation(working, op, input.ctx);
    if (rejection) {
      skipped.push({ ...skip, reason: rejection.code });
      return false;
    }
    working = applyOperation(working, op).state;
    ops.push(op);
    return true;
  };

  if (alt.palette.length) {
    summary.palette = attempt({ type: 'APPLY_PALETTE', palette: alt.palette }, { roomId: null, what: 'PALETTE', code: null });
  }
  if (alt.lighting) {
    const l = alt.lighting;
    const lighting = {
      ...(l.timeOfDay ? { timeOfDay: l.timeOfDay } : {}),
      ...(l.temperature ? { temperature: l.temperature } : {}),
      ...(l.interiorIntensity != null ? { interiorIntensity: l.interiorIntensity } : {}),
    };
    if (Object.keys(lighting).length) summary.lighting = attempt({ type: 'SET_LIGHTING', lighting }, { roomId: null, what: 'LIGHTING', code: null });
  }

  for (const plan of alt.rooms) {
    const room = roomOf(input.space, plan.roomId);
    if (!room) continue;
    const before = ops.length;

    if (plan.clearFurniture) {
      // Locked pieces, and pieces the customer confirmed from their own picture, stay.
      for (const obj of working.objects.filter((o) => o.roomId === room.id && !o.locked && !o.provenance?.confirmed)) {
        if (attempt({ type: 'REMOVE_OBJECT', instanceId: obj.instanceId }, { roomId: room.id, what: 'CLEAR', code: obj.assetId })) summary.removed += 1;
      }
    }

    const walls = surfacesOfRoom(input.space, room.id).filter((s) => s.kind === 'WALL').map((s) => s.id);
    if (plan.wallMaterial && walls.length) {
      const m = materialByCode.get(plan.wallMaterial);
      if (!m) skipped.push({ roomId: room.id, what: 'WALLS', code: plan.wallMaterial, reason: 'UNKNOWN_MATERIAL' });
      else if (attempt({ type: 'ASSIGN_MATERIAL', surfaceIds: walls, materialId: m.id }, { roomId: room.id, what: 'WALLS', code: m.code })) summary.surfaces += walls.length;
    }
    if (plan.wallColor && walls.length) {
      if (attempt({ type: 'SET_SURFACE_COLOR', surfaceIds: walls, color: plan.wallColor }, { roomId: room.id, what: 'WALLS', code: plan.wallColor }) && !plan.wallMaterial) {
        summary.surfaces += walls.length;
      }
    }
    if (plan.floorMaterial) {
      const m = materialByCode.get(plan.floorMaterial);
      if (!m) skipped.push({ roomId: room.id, what: 'FLOOR', code: plan.floorMaterial, reason: 'UNKNOWN_MATERIAL' });
      else if (attempt({ type: 'ASSIGN_MATERIAL', surfaceIds: [floorSurfaceId(room.id)], materialId: m.id }, { roomId: room.id, what: 'FLOOR', code: m.code })) summary.surfaces += 1;
    }

    const cap = input.furnishing ? FURNISHING_CAP[input.furnishing] : Infinity;
    let addedHere = 0;
    for (const code of plan.furniture) {
      const asset = input.assets.get(code);
      if (!asset) { skipped.push({ roomId: room.id, what: 'FURNITURE', code, reason: 'UNKNOWN_ASSET' }); continue; }
      if (addedHere >= cap) { skipped.push({ roomId: room.id, what: 'FURNITURE', code, reason: 'FURNISHING_CAP' }); continue; }
      if ((asset.roomKinds.length && !asset.roomKinds.includes(room.kind)) || (input.furnishing && !semanticFit(asset, room.kind))) {
        skipped.push({ roomId: room.id, what: 'FURNITURE', code, reason: 'WRONG_ROOM' });
        continue;
      }
      if (working.objects.some((o) => o.roomId === room.id && o.assetId === code) && !plan.clearFurniture) {
        skipped.push({ roomId: room.id, what: 'FURNITURE', code, reason: 'ALREADY_THERE' });
        continue;
      }
      const spot = autoPlace({ space: input.space, assets: input.assets, objects: working.objects }, asset, room);
      if (!spot) { skipped.push({ roomId: room.id, what: 'FURNITURE', code, reason: 'NO_SPACE' }); continue; }
      if (onStairs(input.space, asset, spot.at, spot.rotation)) { skipped.push({ roomId: room.id, what: 'FURNITURE', code, reason: 'ON_STAIRS' }); continue; }
      n += 1;
      const object: ObjectInstance = {
        instanceId: `${input.idPrefix}-${n}`, assetId: code, roomId: room.id,
        position: { x: spot.at.x, y: 0, z: spot.at.y }, rotationY: spot.rotation,
        materialVariant: null, colorOverride: null, locked: false,
      };
      if (attempt({ type: 'ADD_OBJECT', object }, { roomId: room.id, what: 'FURNITURE', code })) { summary.added += 1; addedHere += 1; }
    }
    if (ops.length > before) touched.add(room.id);
  }
  summary.rooms = touched.size;
  return { ops, state: working, skipped, summary };
}
