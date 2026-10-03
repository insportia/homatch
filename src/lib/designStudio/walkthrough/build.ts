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

import { onStairs } from '../aiPlan.ts';
import type { CatalogAsset, CatalogMaterial } from '../catalog.ts';
import { isFlat } from '../catalog.ts';
import type { DesignState, ObjectInstance } from '../designState.ts';
import { BODY_RADIUS_M, buildWalkModel, distanceToObb, findPath, isFree, nearestFree, type WalkModel } from '../navigation.ts';
import { type ObjectShape, shapedAsset } from '../objectShape.ts';
import { applyOperation, type Operation, type OperationContext, validateOperation } from '../operations.ts';
import { candidatePositions, evaluateInWorld, footprint, type Obb, type PlacementIssue, placementWorld, snapToWall } from '../placement.ts';
import { ceilingSurfaceId, floorSurfaceId, type Point, pointInPolygon, type SpaceModel, type SpaceRoom, surfacesOfRoom, wallFrame } from '../space.ts';

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
  const placedOrder: Array<{ roomId: string; instanceId: string; flat: boolean; area: number; box: Obb; report: ItemReport }> = [];
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
      placedOrder.push({ roomId: room.id, instanceId: object.instanceId, flat: isFlat(asset), area: asset.widthM * asset.depthM, box: footprint(asset, found.at, found.rotation), report: entry });
    }
  }

  // ── Circulation: furnishing never cuts a room off ──
  // Measured from one fixed way in (found on the bare plan), so a piece standing there cannot move the question.
  const empty = buildWalkModel(space, [], assets);
  const start = circulationStart(space, empty);
  const before = reachableRooms(space, empty, { start });
  report.circulation.reachableBefore = [...before].sort();
  report.circulation.checked = space.rooms.filter((r) => !r.outdoor || before.has(r.id)).map((r) => r.id).sort();
  for (let guard = 0; guard < 40; guard += 1) {
    const furnished = buildWalkModel(space, working.objects, assets);
    const after = reachableRooms(space, furnished, { start });
    const lost = [...before].filter((id) => !after.has(id)).sort();
    report.circulation.reachableAfter = [...after].sort();
    if (!lost.length || !start) break;
    // What is in the way: of the standing pieces nearest the bare plan's route to a cut-off room, the least floor
    // whose removal lets the walk back into it: one piece, or two smaller ones (a desk and its chair rather than
    // the bed). When nothing near the route does, the first piece on it; with no route at all, the latest standing
    // piece of a cut-off room.
    const standing = placedOrder.filter((p) => !p.flat && p.report.outcome !== 'DROPPED');
    let victims: Array<typeof placedOrder[number]> = [];
    for (const id of lost) {
      const room = space.rooms.find((r) => r.id === id);
      const goal = room ? freeInside(empty, room) : null;
      const route = goal ? findPath(empty, start, goal, { throughDoors: true, maxCells: 20000 }) : null;
      if (!route) continue;
      const pts = routePoints([start, ...route]);
      const near = standing
        .map((p) => ({ p, d: Math.min(...pts.map((q) => distanceToObb(q, p.box))) }))
        .filter((x) => x.d < 1.5)
        .sort((a, b) => a.d - b.d)
        .slice(0, 12);
      const reopens = (set: Array<typeof placedOrder[number]>) => {
        const gone = new Set(set.map((p) => p.instanceId));
        const without = working.objects.filter((o) => !gone.has(o.instanceId));
        return reachableRooms(space, buildWalkModel(space, without, assets), { start, only: new Set([id]) }).has(id);
      };
      const sets: Array<Array<typeof placedOrder[number]>> = near.map(({ p }) => [p]);
      const closest = near.slice(0, 6).map((x) => x.p);
      for (let a = 0; a < closest.length; a += 1) for (let b = a + 1; b < closest.length; b += 1) sets.push([closest[a], closest[b]]);
      const floor = (set: Array<typeof placedOrder[number]>) => set.reduce((sum, p) => sum + p.area, 0);
      // Stable: equal floor keeps the nearer (earlier) candidate.
      const ranked = sets.map((set, i) => ({ set, i, f: floor(set) })).sort((x, y) => x.f - y.f || x.i - y.i);
      victims = ranked.find((x) => reopens(x.set))?.set ?? [];
      if (!victims.length) { const first = near.find((x) => x.d < BODY_RADIUS_M + 0.02)?.p; if (first) victims = [first]; }
      if (victims.length) break;
    }
    if (!victims.length) { const last = [...standing].reverse().find((p) => lost.includes(p.roomId)); if (last) victims = [last]; }
    if (!victims.length) break;
    for (const victim of victims) {
      apply({ type: 'REMOVE_OBJECT', instanceId: victim.instanceId });
      victim.report.outcome = 'DROPPED'; victim.report.reason = 'CIRCULATION'; victim.report.instanceId = null;
      if (!report.circulation.repaired.includes(victim.roomId)) report.circulation.repaired.push(victim.roomId);
    }
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
/** Points every 10 cm along a route. */
function routePoints(route: Point[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < route.length; i += 1) {
    out.push(route[i]);
    if (i + 1 >= route.length) break;
    const a = route[i]; const b = route[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.1));
    for (let k = 1; k < n; k += 1) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

/** The way in walkability is measured from: a free door side of the room with the most doors (ties: larger, then id). */
export function circulationStart(space: SpaceModel, model: WalkModel): Point | null {
  const { byRoom } = doorSidesByRoom(space);
  const hub = [...space.rooms].filter((r) => !r.outdoor && (byRoom.get(r.id)?.length ?? 0) > 0)
    .sort((a, b) => (byRoom.get(b.id)!.length - byRoom.get(a.id)!.length) || b.areaM2 - a.areaM2 || (a.id < b.id ? -1 : 1))[0];
  if (!hub) return null;
  return byRoom.get(hub.id)!.map((p) => nearestFree(model, p, 0.4)).find((p): p is Point => !!p) ?? null;
}

function doorSidesByRoom(space: SpaceModel): { byRoom: Map<string, Point[]> } {
  const roomOfPoint = (p: Point) => space.rooms.find((r) => pointInPolygon(p, r.polygon))?.id ?? null;
  const byRoom = new Map<string, Point[]>();
  for (const s of doorSides(space)) {
    const id = roomOfPoint(s.p);
    if (!id) continue;
    (byRoom.get(id) ?? byRoom.set(id, []).get(id)!).push(s.p);
  }
  return { byRoom };
}

export function reachableRooms(space: SpaceModel, model: WalkModel, opts: { start?: Point | null; only?: Set<string> } = {}): Set<string> {
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
  const given = opts.start ? (isFree(model, opts.start) ? opts.start : nearestFree(model, opts.start, 1.0)) : null;
  const start = opts.start ? given : byRoom.get(hub.id)!.map((p) => nearestFree(model, p, 0.4)).find((p): p is Point => !!p);
  if (!start) return reach;
  const reached = walkableFrom(model, start);
  for (const room of space.rooms) {
    if (opts.only && !opts.only.has(room.id)) continue;
    const goals = [...(byRoom.get(room.id) ?? [])];
    let entered = false;
    for (const g of goals) {
      const free = isFree(model, g) ? g : nearestFree(model, g, 0.3);
      if (free && reached(free)) { entered = true; break; }
    }
    if (!entered && room.id === hub.id) entered = true;
    if (!entered) continue;
    // Inside: some free floor of the room clear of its doorways is reachable too. Several spots spread over the
    // room are tried, so one pocket beside a bed does not count the whole room as cut off.
    if (insideGoals(model, room, goals).some(reached)) reach.add(room.id);
  }
  return reach;
}

/**
 * Everywhere a person can walk from `start`, doors opened on the way: one flood over the same 15 cm grid and
 * corner rule the route finder walks (so a room check is a lookup, not a search). A point counts as reached when
 * a reached cell is within one cell of it, as a route's goal does.
 */
function walkableFrom(model: WalkModel, start: Point, maxCells = 20000): (p: Point) => boolean {
  const G = 0.15;
  const closed = model.closedDoors;
  model.closedDoors = new Set();
  const free = new Map<string, boolean>();
  const freeAt = (x: number, y: number) => {
    const k = `${x.toFixed(3)},${y.toFixed(3)}`;
    let v = free.get(k);
    if (v === undefined) { v = isFree(model, { x, y }); free.set(k, v); }
    return v;
  };
  const at = (i: number, j: number) => ({ x: start.x + i * G, y: start.y + j * G });
  const seen = new Set<string>(['0,0']);
  try {
    const queue: Array<[number, number]> = [[0, 0]];
    for (let q = 0; q < queue.length && seen.size < maxCells; q += 1) {
      const [i, j] = queue[q];
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const ni = i + di; const nj = j + dj; const k = `${ni},${nj}`;
        if (seen.has(k)) continue;
        const n = at(ni, nj);
        if (!freeAt(n.x, n.y)) continue;
        if (di !== 0 && dj !== 0) {
          const a = at(i + di, j); const b = at(i, j + dj);
          if (!freeAt(a.x, a.y) || !freeAt(b.x, b.y) || !freeAt(start.x + (i + di / 2) * G, start.y + (j + dj / 2) * G)) continue;
        }
        seen.add(k);
        queue.push([ni, nj]);
      }
    }
  } finally {
    model.closedDoors = closed;
  }
  return (p: Point) => {
    const ci = Math.round((p.x - start.x) / G); const cj = Math.round((p.y - start.y) / G);
    for (let di = -1; di <= 1; di += 1) for (let dj = -1; dj <= 1; dj += 1) if (seen.has(`${ci + di},${cj + dj}`)) return true;
    return false;
  };
}

/** Up to eight free spots inside the room at least 0.6 m from its door sides, spread from its centre outwards. */
function insideGoals(model: WalkModel, room: SpaceRoom, doorSides: Point[]): Point[] {
  const xs = room.polygon.map((p) => p.x); const ys = room.polygon.map((p) => p.y);
  const free: Point[] = [];
  for (let x = Math.min(...xs) + 0.15; x < Math.max(...xs); x += 0.3) {
    for (let y = Math.min(...ys) + 0.15; y < Math.max(...ys); y += 0.3) {
      const q = { x, y };
      if (pointInPolygon(q, room.polygon) && isFree(model, q) && doorSides.every((d) => Math.hypot(d.x - x, d.y - y) > 0.6)) free.push(q);
    }
  }
  const c = room.centroid;
  free.sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y));
  if (free.length <= 8) return free;
  return Array.from({ length: 8 }, (_, i) => free[Math.round((i * (free.length - 1)) / 7)]);
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
