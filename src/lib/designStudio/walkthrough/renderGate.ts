// THE PROMOTION GATE OF A WALKTHROUGH FURNISHED FROM THE SELECTED RENDER.
//
// Two verdicts, both required (renderPlan.ts builds what this judges):
//
//   VISUAL      the walkthrough is the render: the pieces the render shows stand in it (important ones above all),
//               most of them where their pixels put them, none facing against its context (facing.ts), and the
//               catalogue's stand-ins never dominate what HOMATCH draws in the seen form.
//   NAVIGATION  the home can be walked by the walker's body as it stands: every room reached from the spawn,
//               no stranded floor, every door passable on both sides, the spawn itself free.
//
// Every correction made on the way (facing turns, circulation moves and resizes, runs fitted to walls, pieces
// left out) is listed with the verdict. Nothing here changes the design. Pure (Deno + Node).

import type { CatalogAsset } from '../catalog.ts';
import type { DesignState } from '../designState.ts';
import { buildWalkModel, isFree, nearestFree } from '../navigation.ts';
import { pointInPolygon, type SpaceModel } from '../space.ts';
import { type BuildReport, circulationStart, DOOR_SIDE_SLACK_M, doorSides, reachableRooms, stranded } from './build.ts';
import { facingFindings, type FacingCorrection, type FacingFinding } from './facing.ts';
import type { RenderPlan } from './renderPlan.ts';

/** Pieces a room is about: missing one of these is never a detail. */
export const IMPORTANT_TYPES = new Set([
  'BED_DOUBLE', 'BED_SINGLE', 'SOFA', 'ARMCHAIR', 'DINING_TABLE', 'COFFEE_TABLE', 'CHAIR', 'KITCHEN_RUN', 'KITCHEN_ISLAND', 'FRIDGE',
  'WARDROBE', 'TV_UNIT', 'DESK', 'SHOWER', 'BATH', 'TOILET', 'VANITY', 'OUTDOOR_SOFA', 'OUTDOOR_TABLE', 'OUTDOOR_CHAIR', 'BEDSIDE',
]);
export const MIN_IMPORTANT_RECALL = 0.9;
export const MIN_RECALL = 0.8;
export const MIN_TRACED_SHARE = 0.6;
export const MAX_PLACEHOLDER_RATIO = 0.35;
/** A piece moved further than this from where the render put it counts as displaced (reported; a share is gated). */
export const DISPLACED_M = 0.6;
export const MAX_DISPLACED_SHARE = 0.15;

export interface RenderGateInput {
  space: SpaceModel;
  state: DesignState;
  assets: Map<string, CatalogAsset>;
  build: BuildReport;
  plan: RenderPlan;
  /** The clearance the walk keeps (renderPlan.ts RENDER_WALK_RADIUS_M). */
  walkRadiusM: number;
  corrections: FacingCorrection[];
}

export interface RenderGate {
  promoted: boolean;
  visual: { pass: boolean; reasons: string[]; metrics: Record<string, number> };
  navigation: { pass: boolean; reasons: string[]; metrics: Record<string, number>; unreachable: string[]; blockedDoors: string[]; traps: Array<{ roomId: string; areaM2: number }>; spawn: { x: number; y: number } | null };
  facing: FacingFinding[];
  corrections: {
    facing: FacingCorrection[];
    circulation: Array<{ refKey: string; reason: string | null; movedM: number | null; resizedTo: number | null }>;
    fitted: RenderPlan['fitted'];
    left: Array<{ refKey: string; reason: string | null }>;
  };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function renderGate(input: RenderGateInput): RenderGate {
  const { space, state, assets, build, plan } = input;
  // ── VISUAL ──
  const items = build.items.filter((i) => i.refKey);
  const standing = new Set(state.objects.map((o) => o.instanceId));
  const placed = items.filter((i) => i.instanceId && standing.has(i.instanceId));
  const typeOfRef = new Map<string, string>();
  for (const [key, look] of plan.looks) typeOfRef.set(key, look.provenance?.detectedType ?? 'OTHER');
  const read = Math.max(plan.read, 1);
  const important = [...typeOfRef.entries()].filter(([, t]) => IMPORTANT_TYPES.has(t)).map(([k]) => k);
  const placedKeys = new Set(placed.map((i) => i.refKey!));
  const importantRecall = important.length ? important.filter((k) => placedKeys.has(k)).length / important.length : 1;
  // Pieces read but never planned (unmatched or with nowhere to stand) count against recall too.
  const recall = placedKeys.size / read;
  const traced = plan.traced / read;
  const ours = state.objects.filter((o) => o.provenance?.ref && placedKeys.has(o.provenance.ref));
  const placeholders = ours.filter((o) => o.provenance?.approximate && !o.shape).length / Math.max(ours.length, 1);
  const displaced = placed.filter((i) => (i.movedM ?? 0) > DISPLACED_M).length / Math.max(placed.length, 1);
  const facing = facingFindings(state, space, assets);
  const visualReasons: string[] = [];
  if (importantRecall < MIN_IMPORTANT_RECALL) visualReasons.push('IMPORTANT_PIECES_MISSING');
  if (recall < MIN_RECALL) visualReasons.push('PIECES_MISSING');
  if (traced < MIN_TRACED_SHARE) visualReasons.push('POSES_NOT_TRACED');
  if (placeholders > MAX_PLACEHOLDER_RATIO) visualReasons.push('PLACEHOLDERS_DOMINATE');
  if (displaced > MAX_DISPLACED_SHARE) visualReasons.push('PIECES_DISPLACED');
  if (facing.length) visualReasons.push(facing.some((f) => f.code === 'REVERSED') ? 'FURNITURE_REVERSED' : 'FURNITURE_TURNED_AWAY');

  // ── NAVIGATION (the dressed scene: every turn made after the walkability build is in it) ──
  const model = buildWalkModel(space, state.objects, assets);
  model.radius = input.walkRadiusM;
  const bare = buildWalkModel(space, [], assets);
  bare.radius = input.walkRadiusM;
  const spawn = circulationStart(space, model);
  const spawnValid = !!spawn && isFree(model, spawn);
  const before = reachableRooms(space, bare, { start: circulationStart(space, bare) });
  const after = spawn ? reachableRooms(space, model, { start: spawn }) : new Set<string>();
  const unreachable = [...before].filter((id) => !after.has(id)).sort();
  const traps = spawn ? stranded(space, state.objects, assets, spawn, undefined, undefined, input.walkRadiusM).map((t) => ({ roomId: t.roomId, areaM2: t.areaM2 })) : [];
  // Each door: where a body stands on either side of it is free (or a step away), on every side that is a room.
  const blockedDoors = [...new Set(doorSides(space).filter((s) => space.rooms.some((r) => pointInPolygon(s.p, r.polygon)))
    .filter((s) => !isFree(model, s.p) && !nearestFree(model, s.p, DOOR_SIDE_SLACK_M)).map((s) => s.doorId))].sort();
  const navReasons: string[] = [];
  if (!spawnValid) navReasons.push('SPAWN_INVALID');
  if (unreachable.length) navReasons.push('ROOM_UNREACHABLE');
  if (traps.length) navReasons.push('TRAPPED_FLOOR');
  if (blockedDoors.length) navReasons.push('DOOR_BLOCKED');

  const visualPass = !visualReasons.length;
  const navPass = !navReasons.length;
  return {
    promoted: visualPass && navPass,
    visual: {
      pass: visualPass, reasons: visualReasons,
      metrics: {
        read: plan.read, placed: placedKeys.size, recall: r3(recall), importantRead: important.length, importantRecall: r3(importantRecall),
        tracedShare: r3(traced), placeholderRatio: r3(placeholders), displacedShare: r3(displaced), facingFindings: facing.length,
      },
    },
    navigation: {
      pass: navPass, reasons: navReasons, unreachable, blockedDoors, traps, spawn: spawn ? { x: r3(spawn.x), y: r3(spawn.y) } : null,
      metrics: { roomsBefore: before.size, roomsReached: after.size, walkRadiusM: input.walkRadiusM, doors: space.doors.length },
    },
    facing,
    corrections: {
      facing: input.corrections,
      circulation: items.filter((i) => i.outcome === 'CORRECTED').map((i) => ({ refKey: i.refKey!, reason: i.reason, movedM: i.movedM, resizedTo: i.resizedTo ?? null })),
      fitted: plan.fitted,
      left: items.filter((i) => i.outcome === 'DROPPED').map((i) => ({ refKey: i.refKey!, reason: i.reason })),
    },
  };
}
