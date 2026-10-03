// THE WALKTHROUGH'S DESIGN, BUILT BY HOMATCH FROM A VALIDATED SCENE PLAN.
//
// The scene plan (supabase/functions/_shared/designStudio/walkthrough/scenePlan.ts)
// says WHAT each room gets and where OpenAI would put it. This file decides
// WHERE, with the same deterministic engine the customer's own edits use
// (placement.ts, operations.ts, navigation.ts):
//
//   finishes   floor material/colour, wall material/colour and finish, one
//              accent wall, ceiling colour, palette and lighting — each an
//              operation, validated against the design as it stands
//   furniture  the proposed pose is kept only if it is CLEAN: inside the
//              room, through no wall, on no stairs or their approach, in no
//              doorway, overlapping nothing. Otherwise the nearest clean
//              pose is searched (the engine's own wall and centre candidates,
//              then rings around the proposal); a pose with only a tight
//              access zone is the last resort, and a piece with no safe
//              place is dropped and reported — never forced in
//   circulation every room that could be reached through its doors before
//              furnishing must still be reachable after it (a walking body,
//              doors opened on the way); a room that is not loses its most
//              recently placed pieces until it is
//
// The floor plan is never touched: no wall, door, window, room or stair is an
// output of this file. Same plan + same design + same catalogue = the same
// design, byte for byte.

import type { CatalogAsset, CatalogMaterial } from '../catalog.ts';
import { isFlat } from '../catalog.ts';
import type { DesignState, ObjectInstance } from '../designState.ts';
import { applyOperation, validateOperation, type Operation, type OperationContext } from '../operations.ts';
import { candidatePositions, evaluateInWorld, placementWorld, snapToWall, type PlacementIssue } from '../placement.ts';
import { onStairs } from '../aiPlan.ts';
import { buildWalkModel, findPath, isFree, nearestFree, type WalkModel } from '../navigation.ts';
import { shapedAsset, type ObjectShape } from '../objectShape.ts';
import { ceilingSurfaceId, floorSurfaceId, pointInPolygon, surfacesOfRoom, wallFrame, type Point, type SpaceModel, type SpaceRoom } from '../space.ts';

// ── The rooms, as the model is shown them ────────────────────────────────────

export interface RoomSketch {
  id: string;
  kind: string;
  label: string | null;
  areaM2: number;
  widthM: number;
  depthM: number;
  polygon: Array<[number, number]>;
  doors: Array<{ x: number; y: number; widthM: number }>;
  windows: Array<{ x: number; y: number; widthM: number }>;
  walls: Array<{ surfaceId: string; from: [number, number]; to: [number, number]; lengthM: number; facing: 'N' | 'E' | 'S' | 'W' }>;
  stairs: boolean;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const cardinal = (v: Point): 'N' | 'E' | 'S' | 'W' => (Math.abs(v.x) > Math.abs(v.y) ? (v.x > 0 ? 'E' : 'W') : (v.y > 0 ? 'N' : 'S'));

/** Every room in its own frame: origin at its bounding box's south-west corner, metres. */
export function roomSketches(space: SpaceModel): RoomSketch[] {
  return space.rooms.map((room) => {
    const o = { x: room.bounds.minX, y: room.bounds.minY };
    const local = (p: Point): [number, number] => [r3(p.x - o.x), r3(p.y - o.y)];
    const doors: RoomSketch['doors'] = []; const windows: RoomSketch['windows'] = []; const walls: RoomSketch['walls'] = [];
    for (const wall of space.walls) {
      const f = wallFrame(wall.mesh);
      for (const seg of wall.segments) {
        if (seg.roomId !== room.id) continue;
        const at = (u: number): Point => ({ x: wall.mesh.start.x + f.dir.x * u, y: wall.mesh.start.y + f.dir.y * u });
        const inward = seg.side === 'L' ? f.normalL : f.normalR;
        walls.push({ surfaceId: seg.surfaceId, from: local(at(seg.from)), to: local(at(seg.to)), lengthM: r3(seg.to - seg.from), facing: cardinal(inward) });
        for (const op of wall.mesh.openings) {
          if (op.offsetM < seg.from - 0.05 || op.offsetM > seg.to + 0.05) continue;
          const c = local(at(op.offsetM));
          const entry = { x: c[0], y: c[1], widthM: r3(op.widthM) };
          if (op.kind === 'DOOR') { if (!doors.some((d) => Math.hypot(d.x - entry.x, d.y - entry.y) < 0.05)) doors.push(entry); }
          else if (op.kind === 'WINDOW') { if (!windows.some((d) => Math.hypot(d.x - entry.x, d.y - entry.y) < 0.05)) windows.push(entry); }
        }
      }
    }
    const stairs = (space.stairs ?? []).some((st) => (st.polygon as Point[]).some((p) => pointInPolygon(p, room.polygon)));
    return {
      id: room.id, kind: room.kind, label: room.label, areaM2: r3(room.areaM2),
      widthM: r3(room.bounds.maxX - room.bounds.minX), depthM: r3(room.bounds.maxY - room.bounds.minY),
      polygon: room.polygon.map(local), doors, windows, walls, stairs,
    };
  });
}

// ── The plan this file builds (structurally: ValidatedScenePlan) ─────────────

export interface BuildItem {
  code: string;
  type: string;
  pose: { x: number; y: number; rotationDeg: number } | null;
  scale: number;
  color: string | null;
  origin: 'PLANNED' | 'PROGRAMME';
}
export interface BuildRoom {
  roomId: string;
  floorMaterial: string | null;
  floorColor: string | null;
  wallMaterial: string | null;
  wallColor: string | null;
  wallFinish: 'MATTE' | 'SATIN' | 'GLOSS' | null;
  accent: { surfaceId: string; color: string } | null;
  ceilingColor: string | null;
  items: BuildItem[];
}
export interface BuildPlan {
  lighting: { timeOfDay: 'DAY' | 'EVENING' | 'NIGHT'; temperature: 'WARM' | 'NEUTRAL' | 'COOL'; interiorIntensity: number };
  palette: string[];
  styleCode: string | null;
  rooms: BuildRoom[];
}

export type Outcome = 'PLANNED' | 'CORRECTED' | 'PLACED' | 'DROPPED';
export interface ItemReport {
  roomId: string;
  code: string;
  type: string;
  instanceId: string | null;
  outcome: Outcome;
  /** Why it was corrected or dropped. */
  reason: string | null;
  /** How far the piece moved from where the plan put it (metres; null without a planned pose). */
  movedM: number | null;
  /** Findings it was accepted with (only ever TIGHT_ACCESS). */
  warnings: string[];
}
export interface BuildReport {
  items: ItemReport[];
  finishes: Array<{ roomId: string; what: string; applied: boolean; reason: string | null }>;
  circulation: { checked: string[]; reachableBefore: string[]; reachableAfter: string[]; repaired: string[] };
  counts: { planned: number; corrected: number; placed: number; dropped: number };
}

export interface BuildInput {
  space: SpaceModel;
  base: DesignState;
  plan: BuildPlan;
  /** Catalogue by code (the design's keying). */
  assets: Map<string, CatalogAsset>;
  /** Materials by code (the plan's) and by id (the design's). */
  materialsByCode: Map<string, CatalogMaterial>;
  materialsById: Map<string, CatalogMaterial>;
  /** Deterministic instance ids: `${idPrefix}-${n}`. */
  idPrefix: string;
}

const DEG = Math.PI / 180;
/** CLEAN: no finding at all. TIGHT: only a tight access zone (the last resort). Anything else is refused. */
type Verdict = 'CLEAN' | 'TIGHT' | null;
const verdictOf = (issues: PlacementIssue[]): Verdict =>
  issues.length === 0 ? 'CLEAN' : issues.every((i) => i.code === 'TIGHT_ACCESS') ? 'TIGHT' : null;

/** The shape a scaled piece is drawn and collided at (no shape at scale 1). */
function shapeAt(asset: CatalogAsset, scale: number): ObjectShape | undefined {
  if (Math.abs(scale - 1) < 0.005) return undefined;
  return { widthM: r3(asset.widthM * scale), depthM: r3(asset.depthM * scale), heightM: r3(asset.heightM * scale), form: null, secondary: null };
}

export function buildWalkthrough(input: BuildInput): { state: DesignState; report: BuildReport } {
  const { space, assets } = input;
  const ctxOps: OperationContext = { space, assets, materials: input.materialsById };
  let working: DesignState = structuredClone(input.base);
  const report: BuildReport = { items: [], finishes: [], circulation: { checked: [], reachableBefore: [], reachableAfter: [], repaired: [] }, counts: { planned: 0, corrected: 0, placed: 0, dropped: 0 } };
  const apply = (op: Operation): string | null => {
    const rejection = validateOperation(working, op, ctxOps);
    if (rejection) return rejection.code;
    working = applyOperation(working, op).state;
    return null;
  };
  const finish = (roomId: string, what: string, op: Operation | null) => {
    if (!op) return;
    const why = apply(op);
    report.finishes.push({ roomId, what, applied: !why, reason: why });
  };

  // ── Palette, light, style ──
  if (input.plan.palette.length) finish('*', 'PALETTE', { type: 'APPLY_PALETTE', palette: input.plan.palette });
  finish('*', 'LIGHTING', { type: 'SET_LIGHTING', lighting: { ...input.plan.lighting } });
  if (input.plan.styleCode) finish('*', 'STYLE', { type: 'SET_STYLE', styleCode: input.plan.styleCode });

  // ── Finishes, room by room ──
  const rooms = new Map(space.rooms.map((r) => [r.id, r]));
  for (const pr of input.plan.rooms) {
    const room = rooms.get(pr.roomId);
    if (!room) continue;
    const surfaces = surfacesOfRoom(space, room.id);
    const walls = surfaces.filter((s) => s.kind === 'WALL').map((s) => s.id);
    const floorMat = pr.floorMaterial ? input.materialsByCode.get(pr.floorMaterial) : null;
    if (floorMat) finish(room.id, 'FLOOR', { type: 'ASSIGN_MATERIAL', surfaceIds: [floorSurfaceId(room.id)], materialId: floorMat.id });
    else if (pr.floorColor) finish(room.id, 'FLOOR', { type: 'SET_SURFACE_COLOR', surfaceIds: [floorSurfaceId(room.id)], color: pr.floorColor, finish: 'SATIN' });
    const accentId = pr.accent && walls.includes(pr.accent.surfaceId) ? pr.accent.surfaceId : null;
    const plain = walls.filter((id) => id !== accentId);
    const wallMat = pr.wallMaterial ? input.materialsByCode.get(pr.wallMaterial) : null;
    if (wallMat && plain.length) finish(room.id, 'WALLS', { type: 'ASSIGN_MATERIAL', surfaceIds: plain, materialId: wallMat.id });
    if (pr.wallColor && plain.length) finish(room.id, 'WALLS', { type: 'SET_SURFACE_COLOR', surfaceIds: plain, color: pr.wallColor, finish: pr.wallFinish ?? 'MATTE' });
    if (accentId && pr.accent) finish(room.id, 'ACCENT_WALL', { type: 'SET_SURFACE_COLOR', surfaceIds: [accentId], color: pr.accent.color, finish: pr.wallFinish ?? 'MATTE' });
    if (pr.ceilingColor && !room.outdoor) finish(room.id, 'CEILING', { type: 'SET_SURFACE_COLOR', surfaceIds: [ceilingSurfaceId(room.id)], color: pr.ceilingColor, finish: 'MATTE' });
  }

  // ── Furniture: the plan's rooms are furnished afresh (kept pieces stay) ──
  const planned = new Set(input.plan.rooms.map((r) => r.roomId));
  for (const obj of working.objects.filter((o) => o.roomId && planned.has(o.roomId) && !o.locked && !o.provenance?.confirmed)) {
    apply({ type: 'REMOVE_OBJECT', instanceId: obj.instanceId });
  }
  let n = 0;
  const placedOrder: Array<{ roomId: string; instanceId: string; flat: boolean; area: number; report: ItemReport }> = [];
  for (const pr of input.plan.rooms) {
    const room = rooms.get(pr.roomId);
    if (!room) continue;
    // Big standing pieces first (they need the walls), rugs and other flat pieces last.
    const order = pr.items.map((item, i) => ({ item, i, asset: assets.get(item.code) }))
      .filter((x): x is { item: BuildItem; i: number; asset: CatalogAsset } => !!x.asset)
      .sort((a, b) => Number(isFlat(a.asset)) - Number(isFlat(b.asset)) || b.asset.widthM * b.asset.depthM - a.asset.widthM * a.asset.depthM || a.i - b.i);
    for (const { item, asset: own } of order) {
      const shape = shapeAt(own, item.scale);
      const asset = shapedAsset(own, { shape });
      const found = findPose(space, assets, working.objects, room, asset, item);
      const entry: ItemReport = { roomId: room.id, code: item.code, type: item.type, instanceId: null, outcome: 'DROPPED', reason: null, movedM: null, warnings: [] };
      report.items.push(entry);
      if (!found) { entry.reason = 'NO_SAFE_PLACE'; continue; }
      n += 1;
      const object: ObjectInstance = {
        instanceId: `${input.idPrefix}-${n}`, assetId: item.code, roomId: room.id,
        position: { x: r3(found.at.x), y: 0, z: r3(found.at.y) }, rotationY: Math.round(found.rotation * 1e6) / 1e6,
        materialVariant: null, colorOverride: item.color, locked: false,
        ...(shape ? { shape } : {}),
      };
      const why = apply({ type: 'ADD_OBJECT', object });
      if (why) { entry.reason = why; continue; }
      entry.instanceId = object.instanceId;
      entry.outcome = item.pose ? (found.kept ? 'PLANNED' : 'CORRECTED') : 'PLACED';
      entry.reason = found.kept || !item.pose ? null : found.why;
      entry.movedM = found.movedM;
      entry.warnings = found.verdict === 'TIGHT' ? ['TIGHT_ACCESS'] : [];
      placedOrder.push({ roomId: room.id, instanceId: object.instanceId, flat: isFlat(asset), area: asset.widthM * asset.depthM, report: entry });
    }
  }

  // ── Circulation: furnishing never cuts a room off ──
  const before = reachableRooms(space, buildWalkModel(space, [], assets));
  report.circulation.reachableBefore = [...before].sort();
  report.circulation.checked = space.rooms.filter((r) => !r.outdoor || before.has(r.id)).map((r) => r.id).sort();
  for (let guard = 0; guard < 40; guard += 1) {
    const after = reachableRooms(space, buildWalkModel(space, working.objects, assets));
    const lost = [...before].filter((id) => !after.has(id)).sort();
    report.circulation.reachableAfter = [...after].sort();
    if (!lost.length) break;
    // The most recently placed standing piece of a cut-off room goes first; then of the room it is reached through.
    const victim = [...placedOrder].reverse().find((p) => !p.flat && lost.includes(p.roomId) && p.report.outcome !== 'DROPPED')
      ?? [...placedOrder].reverse().find((p) => !p.flat && p.report.outcome !== 'DROPPED');
    if (!victim) break;
    apply({ type: 'REMOVE_OBJECT', instanceId: victim.instanceId });
    victim.report.outcome = 'DROPPED'; victim.report.reason = 'CIRCULATION'; victim.report.instanceId = null;
    if (!report.circulation.repaired.includes(victim.roomId)) report.circulation.repaired.push(victim.roomId);
  }

  for (const it of report.items) {
    if (it.outcome === 'PLANNED') report.counts.planned += 1;
    else if (it.outcome === 'CORRECTED') report.counts.corrected += 1;
    else if (it.outcome === 'PLACED') report.counts.placed += 1;
    else report.counts.dropped += 1;
  }
  return { state: working, report };
}

/**
 * Where one piece stands: the plan's pose when it is clean; otherwise the
 * nearest clean pose; otherwise the nearest one whose only finding is a tight
 * access zone; otherwise nowhere.
 */
function findPose(
  space: SpaceModel, assets: Map<string, CatalogAsset>, objects: ObjectInstance[], room: SpaceRoom, asset: CatalogAsset, item: BuildItem,
): { at: Point; rotation: number; kept: boolean; why: string | null; movedM: number | null; verdict: Verdict } | null {
  const ctx = { space, assets, objects };
  const world = placementWorld(ctx, room);
  const judge = (at: Point, rotation: number): Verdict => {
    if (!pointInPolygon(at, room.polygon)) return null;
    if (onStairs(space, asset, at, rotation)) return null;
    return verdictOf(evaluateInWorld(world, asset, at, rotation));
  };
  const proposal = item.pose ? { at: { x: room.bounds.minX + item.pose.x, y: room.bounds.minY + item.pose.y }, rotation: item.pose.rotationDeg * DEG } : null;
  let firstIssue: string | null = null;
  if (proposal) {
    const v = judge(proposal.at, proposal.rotation);
    if (v === 'CLEAN') return { ...proposal, kept: true, why: null, movedM: 0, verdict: v };
    firstIssue = evaluateInWorld(world, asset, proposal.at, proposal.rotation).find((i) => i.code !== 'TIGHT_ACCESS')?.code
      ?? (v === 'TIGHT' ? 'TIGHT_ACCESS' : onStairs(space, asset, proposal.at, proposal.rotation) ? 'ON_STAIRS' : 'OUTSIDE_ROOM');
  }

  // Candidates, nearest to the proposal first (the engine's order without one).
  const cands: Array<{ at: Point; rotation: number }> = [];
  if (proposal) {
    const snapped = snapToWall(ctx, asset, proposal.at, proposal.rotation, room.id, 0.6);
    if (snapped.snapped) cands.push({ at: snapped.at, rotation: snapped.rotation });
  }
  const engine = candidatePositions(ctx, asset, room);
  cands.push(...engine);
  if (proposal && (asset.anchor === 'CENTRE' || asset.anchor === 'FREE')) {
    for (let r = 0.2; r <= 1.6 + 1e-9; r += 0.2) {
      for (let k = 0; k < 12; k += 1) {
        const a = (k / 12) * Math.PI * 2;
        const at = { x: proposal.at.x + Math.cos(a) * r, y: proposal.at.y + Math.sin(a) * r };
        cands.push({ at, rotation: proposal.rotation }, { at, rotation: proposal.rotation + Math.PI / 2 });
      }
    }
  }
  const cost = (c: { at: Point; rotation: number }) => {
    if (!proposal) return 0;
    const turn = Math.abs(Math.atan2(Math.sin(c.rotation - proposal.rotation), Math.cos(c.rotation - proposal.rotation)));
    return Math.hypot(c.at.x - proposal.at.x, c.at.y - proposal.at.y) + turn * 0.25;
  };
  const ordered = proposal ? cands.map((c, i) => ({ c, i, k: cost(c) })).sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.c) : cands;
  let tight: { at: Point; rotation: number } | null = null;
  for (const c of ordered) {
    const v = judge(c.at, c.rotation);
    if (v === 'CLEAN') return { ...c, kept: false, why: firstIssue, movedM: proposal ? r3(Math.hypot(c.at.x - proposal.at.x, c.at.y - proposal.at.y)) : null, verdict: v };
    if (v === 'TIGHT' && !tight) tight = c;
  }
  if (tight) return { ...tight, kept: false, why: firstIssue, movedM: proposal ? r3(Math.hypot(tight.at.x - proposal.at.x, tight.at.y - proposal.at.y)) : null, verdict: 'TIGHT' };
  return null;
}

// ── Reachability ─────────────────────────────────────────────────────────────

/** Points just either side of every door (where a body stands to walk through it). */
function doorSides(space: SpaceModel): Array<{ doorId: string; p: Point }> {
  const out: Array<{ doorId: string; p: Point }> = [];
  const walls = new Map(space.walls.map((w) => [w.id, w]));
  for (const d of space.doors) {
    const w = walls.get(d.wallId);
    if (!w) continue;
    const f = wallFrame(w.mesh);
    const reach = w.mesh.thicknessM / 2 + 0.45;
    for (const n of [f.normalL, f.normalR]) out.push({ doorId: d.id, p: { x: d.centre.x + n.x * reach, y: d.centre.y + n.y * reach } });
  }
  return out;
}

/**
 * The rooms a person can walk into from the home's best-connected room,
 * opening doors on the way, and then on to the middle of the room (or as near
 * as the furniture allows).
 */
export function reachableRooms(space: SpaceModel, model: WalkModel): Set<string> {
  const sides = doorSides(space);
  const roomOfPoint = (p: Point) => space.rooms.find((r) => pointInPolygon(p, r.polygon))?.id ?? null;
  const byRoom = new Map<string, Point[]>();
  for (const s of sides) {
    const id = roomOfPoint(s.p);
    if (!id) continue;
    (byRoom.get(id) ?? byRoom.set(id, []).get(id)!).push(s.p);
  }
  // The start: a free door side of the room with the most doors (ties: the larger room, then id).
  const hub = [...space.rooms].filter((r) => !r.outdoor && (byRoom.get(r.id)?.length ?? 0) > 0)
    .sort((a, b) => (byRoom.get(b.id)!.length - byRoom.get(a.id)!.length) || b.areaM2 - a.areaM2 || (a.id < b.id ? -1 : 1))[0];
  const reach = new Set<string>();
  if (!hub) return reach;
  const start = byRoom.get(hub.id)!.map((p) => nearestFree(model, p, 0.4)).find((p): p is Point => !!p);
  if (!start) return reach;
  for (const room of space.rooms) {
    const goals = [...(byRoom.get(room.id) ?? [])];
    const centre = freeInside(model, room);
    let entered = false;
    for (const g of goals) {
      const free = isFree(model, g) ? g : nearestFree(model, g, 0.3);
      if (free && (Math.hypot(free.x - start.x, free.y - start.y) < 1e-6 || findPath(model, start, free, { throughDoors: true, maxCells: 20000 }))) { entered = true; break; }
    }
    if (!entered && room.id === hub.id) entered = true;
    if (!entered) continue;
    // Inside: the middle of the room (or the nearest free spot to it, inside it) is reachable too.
    if (centre && findPath(model, start, centre, { throughDoors: true, maxCells: 20000 })) reach.add(room.id);
  }
  return reach;
}

/** The free spot nearest the room's centre that is inside the room (never one found through a wall). */
function freeInside(model: WalkModel, room: SpaceRoom): Point | null {
  const c = room.centroid;
  if (pointInPolygon(c, room.polygon) && isFree(model, c)) return c;
  for (let r = 0.1; r <= 2 + 1e-9; r += 0.1) {
    const n = Math.max(8, Math.round((2 * Math.PI * r) / 0.1));
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2;
      const q = { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
      if (pointInPolygon(q, room.polygon) && isFree(model, q)) return q;
    }
  }
  return null;
}
