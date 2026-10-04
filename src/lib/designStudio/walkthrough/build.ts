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
//   plan       one coherent solution per room before anything stands: no
//              second dining table or island, no duplicated singletons
//              (walkability.ts redundantPieces); after placement a crowded
//              room gives up its least important pieces, and a room missing
//              the piece that makes it what it is (a living room's sofa, a
//              bedroom's bed) gets one from the catalogue
//   circulation every room a comfortable walk reached before furnishing is
//              still reached after it — with the comfort margin, not a 2 cm
//              gap (COMFORT_RADIUS_M) — and no narrow strip is left for a
//              body to squeeze into and get stuck (strandedFloor). What is in
//              the way MOVES first (decor, chairs, side tables, tables, large
//              pieces, the room's own bed or kitchen last) and is dropped
//              only when no clean pose fixes it; then everything is walked
//              again (bounded passes). The result carries its gate.
//   reference  a piece the selected picture shows clearly (a reference-locked
//              anchor: BuildItem.lock) is placed first and only ever NUDGED:
//              a small move, then a small scale-down, then a small turn,
//              within its lock — never searched for room-wide, never moved
//              away to open a way, never given up for density or decor. If it
//              has no safe place within its lock it is reported dropped and
//              the reference-fidelity gate (fidelity.ts) fails the build.
//
// The floor plan is never touched: no wall, door, window, room or stair is an
// output of this file. Same plan + same design + same catalogue = the same
// design, byte for byte.

import { onStairs } from '../aiPlan.ts';
import type { CatalogAsset, CatalogMaterial } from '../catalog.ts';
import { isFlat } from '../catalog.ts';
import type { DesignState, ObjectInstance } from '../designState.ts';
import { BODY_RADIUS_M, COMFORT_RADIUS_M, buildWalkModel, distanceToObb, findPath, isFree, nearestFree, type WalkModel } from '../navigation.ts';
import {
  DENSITY_MAX, density, densityChecked, essentialRole, redundantPieces, repairRank, servesRole, strandedFloor, type WalkGate,
} from './walkability.ts';
import { ANCHOR_FALLBACK_M } from './fidelity.ts';
import { type ObjectShape, shapedAsset } from '../objectShape.ts';
import { applyOperation, type Operation, type OperationContext, validateOperation } from '../operations.ts';
import { candidatePositions, evaluateInWorld, footprint, isSeat, isSeatTable, type Obb, type PlacementIssue, placementWorld, snapToWall, solidBox, solidOverlap, TUCK_M } from '../placement.ts';
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
  /** The selected picture's id for this piece (reference-locked plans). */
  refKey?: string | null;
  /** Reference-locked: how far it may be nudged and turned (fidelity.ts anchorLock); it never moves further. */
  lock?: { maxShiftM: number; maxTurnDeg: number } | null;
  /** The size and form the piece was seen at (a render-furnished plan): it stands and collides at that, not the catalogue's. */
  shape?: ObjectShape | null;
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
  /** The picture's id for it (reference-locked plans). */
  refKey?: string | null;
  /** A picture's piece made smaller to open a required way (share of its seen size; recorded, never silent). */
  resizedTo?: number;
  /** Reference-locked (nudged within its lock only). */
  locked?: boolean;
}
export interface BuildReport {
  items: ItemReport[];
  finishes: Array<{ roomId: string; what: string; applied: boolean; reason: string | null }>;
  circulation: { checked: string[]; reachableBefore: string[]; reachableAfter: string[]; repaired: string[] };
  counts: { planned: number; corrected: number; placed: number; dropped: number };
  /** The walkability gate the design passed (or, never expected, what is left). */
  gate?: WalkGate;
  /** Pieces moved (not dropped) to open a way. */
  relocated?: number;
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
  /**
   * The clearance every route must keep (a body of this radius walks it). Default: the comfortable walk. A plan that
   * reproduces a real home's furniture (renderPlan.ts) asks for the walker's own body plus a margin instead: a
   * compact kitchen the picture shows is walked as it is, not emptied to make it roomy.
   */
  walkRadiusM?: number;
  /**
   * The plan's locked pieces are a picture of a real home (renderPlan.ts): at its pose a piece may leave a tight
   * front zone, or stand in a door's keep-out beside the passage, as the picture shows it; only a piece in the
   * passage itself, a collision or a wall moves it. The walk (walkRadiusM) is still proven afterwards.
   */
  anchorsAsSeen?: boolean;
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

/** An item's shape at `scale`: its seen shape (scaled relative to the item's own scale), else the catalogue's. */
function itemShape(asset: CatalogAsset, item: BuildItem, scale: number): ObjectShape | undefined {
  if (!item.shape) return shapeAt(asset, scale);
  const k = scale / (item.scale || 1);
  if (Math.abs(k - 1) < 0.005) return item.shape;
  return { ...item.shape, widthM: r3(item.shape.widthM * k), depthM: r3(item.shape.depthM * k), heightM: r3(item.shape.heightM * k) };
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
  type Placed = { roomId: string; instanceId: string; flat: boolean; area: number; box: Obb; report: ItemReport; asset: CatalogAsset; rank: number; essential: boolean; lock?: { at: Point; rotation: number; maxShiftM: number; maxTurnDeg: number } };
  const placedOrder: Placed[] = [];
  for (const pr of input.plan.rooms) {
    const room = rooms.get(pr.roomId);
    if (!room) continue;
    // Big standing pieces first (they need the walls), rugs and other flat pieces last.
    // One coherent solution: the redundant table, island or duplicated singleton never stands at all.
    const known = pr.items.map((item) => ({ item, asset: assets.get(item.code) })).filter((x): x is { item: BuildItem; asset: CatalogAsset } => !!x.asset);
    // The picture's anchors are kept before anything else of their kind.
    const known1 = [...known].sort((a, b) => Number(!!(b.item.lock && b.item.pose)) - Number(!!(a.item.lock && a.item.pose)));
    const redundant = redundantPieces(room.kind, room.areaM2, known1.map((x) => ({ item: x.item, asset: x.asset, planned: !!x.item.pose })));
    // What the picture clearly shows is never "redundant" (it is the design).
    for (const item of [...redundant]) if (item.lock && item.pose) redundant.delete(item);
    for (const item of redundant) report.items.push({ roomId: room.id, code: item.code, type: item.type, instanceId: null, outcome: 'DROPPED', reason: 'REDUNDANT', movedM: null, warnings: [], ...(item.refKey ? { refKey: item.refKey } : {}) });
    // The picture's anchors stand first (nothing else takes their place), then big standing pieces, flat ones last.
    const isLocked = (item: BuildItem) => !!(item.lock && item.pose);
    const order = pr.items.filter((item) => !redundant.has(item)).map((item, i) => ({ item, i, asset: assets.get(item.code) }))
      .filter((x): x is { item: BuildItem; i: number; asset: CatalogAsset } => !!x.asset)
      .sort((a, b) => Number(isLocked(b.item)) - Number(isLocked(a.item)) || Number(isFlat(a.asset)) - Number(isFlat(b.asset)) || b.asset.widthM * b.asset.depthM - a.asset.widthM * a.asset.depthM || a.i - b.i);
    for (const { item, asset: own } of order) {
      let shape = itemShape(own, item, item.scale);
      let asset = shapedAsset(own, { shape });
      const entry: ItemReport = {
        roomId: room.id, code: item.code, type: item.type, instanceId: null, outcome: 'DROPPED', reason: null, movedM: null, warnings: [],
        ...(item.refKey ? { refKey: item.refKey } : {}), ...(isLocked(item) ? { locked: true } : {}),
      };
      report.items.push(entry);
      // A locked piece: its candidates in repair order, each tried until the design accepts one (the operation
      // validator is the final word; a pose it refuses never ends the search).
      const options: Array<NonNullable<ReturnType<typeof findPose>> & { scale?: number }> = isLocked(item)
        ? lockedOptions(space, assets, working.objects, room, own, item, 8, !!input.anchorsAsSeen)
        : [findPose(space, assets, working.objects, room, asset, item)].filter((x): x is NonNullable<ReturnType<typeof findPose>> => !!x);
      if (!options.length) { entry.reason = isLocked(item) ? 'ANCHOR_NO_SAFE_PLACE' : 'NO_SAFE_PLACE'; continue; }
      let found: (typeof options)[number] | null = null;
      let object: ObjectInstance | null = null;
      for (const option of options) {
        const s1 = option.scale != null ? itemShape(own, item, option.scale) : shape;
        const candidate: ObjectInstance = {
          instanceId: `${input.idPrefix}-${n + 1}`, assetId: item.code, roomId: room.id,
          position: { x: r3(option.at.x), y: 0, z: r3(option.at.y) }, rotationY: Math.round(option.rotation * 1e6) / 1e6,
          materialVariant: null, colorOverride: item.color, locked: false,
          ...(s1 ? { shape: s1 } : {}),
        };
        const why = apply({ type: 'ADD_OBJECT', object: candidate });
        if (why) { entry.reason = why; continue; }
        found = option; object = candidate; shape = s1; asset = shapedAsset(own, { shape });
        break;
      }
      if (!found || !object) continue;
      n += 1;
      entry.instanceId = object.instanceId;
      entry.outcome = item.pose ? (found.kept ? 'PLANNED' : 'CORRECTED') : 'PLACED';
      entry.reason = found.kept || !item.pose ? null : found.why;
      entry.movedM = found.movedM;
      entry.warnings = found.verdict === 'TIGHT' ? ['TIGHT_ACCESS'] : [];
      const lock = isLocked(item) && item.lock && item.pose
        ? { at: { x: room.bounds.minX + item.pose.x, y: room.bounds.minY + item.pose.y }, rotation: item.pose.rotationDeg * DEG, maxShiftM: item.lock.maxShiftM, maxTurnDeg: item.lock.maxTurnDeg }
        : undefined;
      placedOrder.push({ roomId: room.id, instanceId: object.instanceId, flat: isFlat(asset), area: asset.widthM * asset.depthM, box: footprint(asset, found.at, found.rotation), report: entry, asset, rank: repairRank(asset), essential: false, ...(lock ? { lock } : {}) });
    }
  }

  // ── Balance: crowded rooms give up their least important pieces; a room missing its piece gets one ──
  const standingIn = (roomId: string) => placedOrder.filter((p) => p.roomId === roomId && !p.flat && p.report.outcome !== 'DROPPED');
  const drop = (p: typeof placedOrder[number], reason: string) => {
    apply({ type: 'REMOVE_OBJECT', instanceId: p.instanceId });
    p.report.outcome = 'DROPPED'; p.report.reason = reason; p.report.instanceId = null;
  };
  for (const room of space.rooms) {
    if (!planned.has(room.id) || !densityChecked(room.kind)) continue;
    const essential = essentialRole(room.kind);
    for (let guard = 0; guard < 12 && density(room, standingIn(room.id).map((p) => p.area)) > DENSITY_MAX; guard += 1) {
      const victim = [...standingIn(room.id)].filter((p) => !p.lock && !(essential && servesRole(p.asset, essential)))
        .sort((a, b) => a.rank - b.rank || a.area - b.area)[0];
      if (!victim) break;
      drop(victim, 'OVERFURNISHED');
    }
  }
  for (const pr of input.plan.rooms) {
    const room = rooms.get(pr.roomId);
    const role = room ? essentialRole(room.kind) : null;
    if (!room || !role || room.areaM2 < 5) continue;
    const have = standingIn(room.id).find((p) => servesRole(p.asset, role));
    if (have) { have.essential = true; continue; }
    // A picture's home is furnished with what the picture shows: nothing is added to it.
    if (input.anchorsAsSeen) continue;
    // The catalogue's best piece for the role: the design's style first, then the size that suits the room.
    const target = role === 'BED' ? (room.areaM2 >= 10 ? 3.2 : 2.0) : role === 'SOFA' ? (room.areaM2 >= 18 ? 2.0 : 1.5) : role === 'TABLE' ? 1.4 : 1.8;
    const options = [...assets.values()].filter((a) => a.active !== false && a.placement === 'FLOOR' && servesRole(a, role)
      && (!a.roomKinds?.length || a.roomKinds.includes(room.kind)))
      .sort((a, b) => Number(b.styleTags?.includes(input.plan.styleCode ?? '')) - Number(a.styleTags?.includes(input.plan.styleCode ?? ''))
        || Math.abs(a.widthM * a.depthM - target) - Math.abs(b.widthM * b.depthM - target) || (a.code < b.code ? -1 : 1))
      .slice(0, 5);
    for (const asset of options) {
      const found = findPose(space, assets, working.objects, room, asset, { code: asset.code, type: role, pose: null, scale: 1, color: null, origin: 'PROGRAMME' } as BuildItem);
      if (!found) continue;
      n += 1;
      const object: ObjectInstance = {
        instanceId: `${input.idPrefix}-${n}`, assetId: asset.code, roomId: room.id,
        position: { x: r3(found.at.x), y: 0, z: r3(found.at.y) }, rotationY: Math.round(found.rotation * 1e6) / 1e6,
        materialVariant: null, colorOverride: null, locked: false,
      };
      if (apply({ type: 'ADD_OBJECT', object })) continue;
      const entry: ItemReport = { roomId: room.id, code: asset.code, type: role, instanceId: object.instanceId, outcome: 'PLACED', reason: 'ESSENTIAL', movedM: null, warnings: [] };
      report.items.push(entry);
      placedOrder.push({ roomId: room.id, instanceId: object.instanceId, flat: false, area: asset.widthM * asset.depthM, box: footprint(asset, found.at, found.rotation), report: entry, asset, rank: repairRank(asset), essential: true });
      break;
    }
  }

  // ── Circulation: a comfortable walk everywhere it went before, and no narrow trap ──
  // Measured from one fixed way in (found on the bare plan), so a piece standing there cannot move the question.
  const walkRadius = input.walkRadiusM ?? COMFORT_RADIUS_M;
  const comfortModel = (objects: ObjectInstance[]) => { const m = buildWalkModel(space, objects, assets); m.radius = walkRadius; return m; };
  const empty = buildWalkModel(space, [], assets);
  const emptyComfort = comfortModel([]);
  const start = circulationStart(space, empty);
  const before = reachableRooms(space, empty, { start });
  // Rooms a comfortable walk reaches on the bare plan must stay comfortable; the rest (a narrow plan) at least walkable.
  const comfortBefore = start ? reachableRooms(space, emptyComfort, { start }) : new Set<string>();
  report.circulation.reachableBefore = [...before].sort();
  report.circulation.checked = space.rooms.filter((r) => !r.outdoor || before.has(r.id)).map((r) => r.id).sort();
  // Comfortable rooms are judged by the comfortable walk alone (it implies the body's); the body's own walk is only
  // asked for the rooms a narrow plan reaches at all (one flood each, not two).
  const bodyOnly = [...before].filter((id) => !comfortBefore.has(id));
  const lostRooms = (objects: ObjectInstance[], only?: string) => {
    const lost: string[] = [];
    const check = only ? [only] : [...before];
    if (check.some((id) => comfortBefore.has(id))) {
      const comfort = reachableRooms(space, comfortModel(objects), { start });
      for (const id of check) if (comfortBefore.has(id) && !comfort.has(id)) lost.push(id);
    }
    if (check.some((id) => bodyOnly.includes(id))) {
      const body = reachableRooms(space, buildWalkModel(space, objects, assets), { start });
      for (const id of check) if (bodyOnly.includes(id) && !body.has(id)) lost.push(id);
    }
    return lost.sort();
  };
  const bareReach = start ? bareComfortReach(space, assets, start, walkRadius) : undefined;
  const trapsOf = (objects: ObjectInstance[], only?: string) => stranded(space, objects, assets, start, only, bareReach, walkRadius);
  const standing = () => placedOrder.filter((p) => !p.flat && p.report.outcome !== 'DROPPED');
  const objectOf = (p: typeof placedOrder[number]) => working.objects.find((o) => o.instanceId === p.instanceId)!;
  let relocated = 0;
  /** Move a piece to another clean pose in its room for which `fixes` holds; true when it moved. */
  const relocate = (p: typeof placedOrder[number], fixes: (objects: ObjectInstance[]) => boolean, avoid: Point[] = [], widen = false): boolean => {
    const room = rooms.get(p.roomId);
    const obj = objectOf(p);
    if (!room || !obj) return false;
    const others = working.objects.filter((o) => o.instanceId !== p.instanceId);
    // A reference-locked piece is only nudged within its lock, never sent elsewhere in the room.
    const lock = p.lock && widen ? { ...p.lock, maxShiftM: Math.max(p.lock.maxShiftM, WIDE_SHIFT_M) } : p.lock;
    const poses = lock ? lockedPoses(space, assets, others, room, p.asset, lock, 6, !!input.anchorsAsSeen) : cleanPoses(space, assets, others, room, p.asset, 5);
    for (const pose of poses) {
      if (Math.hypot(pose.at.x - obj.position.x, pose.at.y - obj.position.z) < 0.1) continue;
      // Still on the way it blocks: cannot be the fix (no walk is needed to know).
      if (avoid.length && !input.anchorsAsSeen) { const box = footprint(p.asset, pose.at, pose.rotation); if (avoid.some((q) => distanceToObb(q, box) < walkRadius)) continue; }
      const moved: ObjectInstance = { ...obj, position: { x: r3(pose.at.x), y: 0, z: r3(pose.at.y) }, rotationY: Math.round(pose.rotation * 1e6) / 1e6 };
      const trial = [...others, moved];
      if (!fixes(trial)) continue;
      working = { ...working, objects: working.objects.map((o) => (o.instanceId === p.instanceId ? moved : o)) };
      p.box = footprint(p.asset, pose.at, pose.rotation);
      if (p.report.outcome === 'PLANNED') p.report.outcome = 'CORRECTED';
      p.report.reason = p.report.reason ?? 'CIRCULATION_MOVED';
      relocated += 1;
      if (!report.circulation.repaired.includes(p.roomId)) report.circulation.repaired.push(p.roomId);
      return true;
    }
    return false;
  };
  /**
   * Of `candidates` (most expendable first): the first that MOVES to fix it; else the first that may be DROPPED and
   * does; else a pair that may be dropped (a desk and its chair rather than the bed); else, last, a larger or
   * essential piece moved. Bounded: the plan step has one edge invocation's CPU.
   */
  const repairWith = (candidates: Array<typeof placedOrder[number]>, fixes: (objects: ObjectInstance[]) => boolean, mayDrop: (p: typeof placedOrder[number]) => boolean, avoid: Point[] = []): boolean => {
    const note = (p: typeof placedOrder[number]) => { if (!report.circulation.repaired.includes(p.roomId)) report.circulation.repaired.push(p.roomId); };
    // Moved first: the two most expendable pieces, and the two largest movable ones (a table moved beats four chairs lost).
    const largest = [...candidates].filter((p) => p.rank <= 4).sort((a, b) => b.area - a.area).slice(0, 2);
    const movers = [...new Set([...candidates.slice(0, 2), ...largest])];
    for (const p of movers) if (relocate(p, fixes, avoid)) return true;
    const droppable = candidates.filter((p) => !p.lock && mayDrop(p));
    // Tier by tier (decor, chairs, side tables, tables, large pieces): one piece, then two of that tier or below —
    // two dining chairs go before the dining table does.
    const fixedWithout = (gone: Set<string>) => fixes(working.objects.filter((o) => !gone.has(o.instanceId)));
    for (let tier = 0; tier <= 4; tier += 1) {
      const pool = droppable.filter((p) => p.rank <= tier);
      for (const p of pool.filter((x) => x.rank === tier).slice(0, 4)) {
        if (fixedWithout(new Set([p.instanceId]))) { drop(p, 'CIRCULATION'); note(p); return true; }
      }
      const few = pool.slice(0, 4);
      for (let a = 0; a < few.length; a += 1) {
        for (let b = a + 1; b < few.length; b += 1) {
          if (Math.max(few[a].rank, few[b].rank) !== tier) continue;
          if (fixedWithout(new Set([few[a].instanceId, few[b].instanceId]))) { drop(few[a], 'CIRCULATION'); drop(few[b], 'CIRCULATION'); note(few[a]); return true; }
        }
      }
    }
    for (const p of candidates.filter((x) => !movers.includes(x)).slice(0, 2)) if (relocate(p, fixes, avoid)) return true;
    // A picture's piece in the way (its lock allowed no fix): moved further, at most WIDE_SHIFT_M, never removed.
    if (input.anchorsAsSeen) {
      // The pieces that stand on the way first (nearest to it), not the most expendable.
      const onWay = candidates.filter((x) => x.lock).map((x) => ({ x, d: avoid.length ? Math.min(...avoid.map((q) => distanceToObb(q, x.box))) : 0 }))
        .filter((e) => e.d < walkRadius).sort((a, b) => a.d - b.d).map((e) => e.x);
      for (const p of onWay.slice(0, 4)) {
        if (relocate(p, fixes, avoid, true)) { p.report.reason = 'CIRCULATION_MOVED'; return true; }
      }
    }
    return false;
  };
  const byRank = (list: Array<typeof placedOrder[number]>) => [...list].sort((a, b) => Number(a.essential) - Number(b.essential) || a.rank - b.rank || a.area - b.area);
  /**
   * A picture's home (anchorsAsSeen): the piece that narrows the way is pushed straight off it, by the least that
   * clears it (never through a wall, never into another piece, the way it faces kept); only when no push does,
   * it is made a little smaller where it stands. Each step must clear part of the way and lose no room.
   */
  const pushAside = (route: Point[], fixes: (objects: ObjectInstance[]) => boolean): boolean => {
    if (!route.length) return false;
    const m = comfortModel(working.objects);
    // Only what furniture blocks (a way squeezed past a wall's end stays as the wall leaves it).
    const bare = comfortModel([]);
    const blocked = route.filter((q) => !isFree(m, q) && (isFree(bare, q) || m.furniture.some((o) => distanceToObb(q, o) < walkRadius)));
    if (!blocked.length) return false;
    const pieces = standing().map((p) => ({ p, q: blocked.map((b) => ({ b, d: distanceToObb(b, p.box) })).sort((x, y) => x.d - y.d)[0] }))
      .filter((e) => e.q && e.q.d < walkRadius + 0.02).sort((x, y) => x.q.d - y.q.d);
    /** A dining set moves as one: a table with the seats drawn up to it, a seat with its table and the others. */
    const setOf = (p: typeof placedOrder[number]) => {
      const tableOf = (x: typeof placedOrder[number]) => (isSeatTable(x.asset) ? x : isSeat(x.asset)
        ? standing().filter((t) => t.roomId === x.roomId && isSeatTable(t.asset)).map((t) => ({ t, d: distanceToObb({ x: x.box.cx, y: x.box.cy }, t.box) })).filter((e) => e.d <= TUCK_M + 0.35).sort((a, b) => a.d - b.d)[0]?.t ?? null
        : null);
      const table = tableOf(p);
      if (!table) return [p];
      return [table, ...standing().filter((x) => x !== table && isSeat(x.asset) && tableOf(x) === table)];
    };
    for (const { p, q } of pieces.slice(0, 6)) {
      const room = rooms.get(p.roomId);
      if (!room) continue;
      for (const group of p.lock ? [[p], setOf(p)] : [[p]]) {
        if (group.length === 1 && group[0] !== p) continue;
        const ids = new Set(group.map((x) => x.instanceId));
        const members = group.map((x) => ({ x, obj: objectOf(x), own: assets.get(objectOf(x)?.assetId ?? '') })).filter((e) => e.obj && e.own);
        if (members.length !== group.length) continue;
        const others = working.objects.filter((o) => !ids.has(o.instanceId));
        const world = placementWorld({ space, assets, objects: others }, room);
        const lead = objectOf(p)!;
        const at0 = { x: lead.position.x, y: lead.position.z };
        // Away from the way: from the blocked point to the piece's centre, and the piece's own two axes nearest to it.
        let dx = at0.x - q.b.x; let dy = at0.y - q.b.y; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
        const ax = [{ x: Math.cos(lead.rotationY), y: Math.sin(lead.rotationY) }, { x: -Math.sin(lead.rotationY), y: Math.cos(lead.rotationY) }]
          .map((a) => (a.x * dx + a.y * dy >= 0 ? a : { x: -a.x, y: -a.y }));
        // A piece that stands against a wall slides along it (never off it); a free piece moves any way.
        const leadOwn = assets.get(lead.assetId);
        const onWall = group.length === 1 && !!leadOwn && leadOwn.anchor !== 'CENTRE' && leadOwn.anchor !== 'FREE';
        const dirs = onWall ? ax.slice(0, 1).flatMap((a) => [a, { x: -a.x, y: -a.y }]) : [{ x: dx, y: dy }, ...ax];
        // How much smaller than seen it already is (each resize is of the seen size, never compounded).
        const already = p.report.resizedTo ?? 1;
        const tryMove = (v: Point, k: number | null): ObjectInstance[] | null => {
          if ((p.report.movedM ?? 0) + Math.hypot(v.x, v.y) > WIDE_SHIFT_M + 0.05) return null;
          const moved: ObjectInstance[] = [];
          for (const { obj, own } of members) {
            const rel = k ? k / already : 1;
            const shape = k && obj!.instanceId === lead.instanceId
              ? { ...(obj!.shape ?? { widthM: own!.widthM, depthM: own!.depthM, heightM: own!.heightM, form: null, secondary: null }), widthM: r3((obj!.shape?.widthM ?? own!.widthM) * rel), depthM: r3((obj!.shape?.depthM ?? own!.depthM) * rel) }
              : obj!.shape;
            const at = { x: obj!.position.x + v.x, y: obj!.position.z + v.y };
            const asset = shapedAsset(own!, { shape });
            if (!pointInPolygon(at, room.polygon)) return null;
            if (seenIssues(space, evaluateInWorld(world, asset, at, obj!.rotationY), asset, at, obj!.rotationY).length) return null;
            moved.push({ ...obj!, position: { x: r3(at.x), y: 0, z: r3(at.y) }, ...(shape ? { shape } : {}) });
          }
          return fixes([...others, ...moved]) ? moved : null;
        };
        const accept = (moved: ObjectInstance[], k: number | null) => {
          const byId = new Map(moved.map((o) => [o.instanceId, o]));
          working = { ...working, objects: working.objects.map((o) => byId.get(o.instanceId) ?? o) };
          for (const { x, own } of members) {
            const o = byId.get(x.instanceId)!;
            const prev = x.box;
            x.asset = shapedAsset(own!, o);
            x.box = footprint(x.asset, { x: o.position.x, y: o.position.z }, o.rotationY);
            if (x.report.outcome === 'PLANNED') x.report.outcome = 'CORRECTED';
            x.report.reason = k && x === p ? 'CIRCULATION_RESIZED' : 'CIRCULATION_MOVED';
            x.report.movedM = r3((x.report.movedM ?? 0) + Math.hypot(x.box.cx - prev.cx, x.box.cy - prev.cy));
            if (k && x === p) x.report.resizedTo = k;
            if (!report.circulation.repaired.includes(x.roomId)) report.circulation.repaired.push(x.roomId);
          }
          relocated += 1;
          return true;
        };
        for (const step of PUSH_STEPS_M) {
          for (const d of dirs) {
            const moved = tryMove({ x: d.x * step, y: d.y * step }, null);
            if (moved) return accept(moved, null);
          }
        }
        if (group.length > 1) continue;
        for (const k of RESIZE_STEPS.filter((x) => x < already - 1e-6)) {
          for (const step of [0, ...PUSH_STEPS_M]) {
            for (const d of step ? dirs : dirs.slice(0, 1)) {
              const moved = tryMove({ x: d.x * step, y: d.y * step }, k);
              if (moved) return accept(moved, k);
            }
          }
        }
      }
    }
    return false;
  };

  for (let guard = 0; guard < 30 && start; guard += 1) {
    const lost = lostRooms(working.objects);
    if (lost.length) {
      // The nearest lost room first (a room reached through another lost room is opened after it).
      const id = [...lost].sort((a, b) => doorHops(space, start, a) - doorHops(space, start, b) || (a < b ? -1 : 1))[0];
      const room = space.rooms.find((r) => r.id === id);
      const goal = room ? freeInside(empty, room) : null;
      // The way to open: for a picture's home the bare plan's comfortable way (through the middle of each door),
      // else the body's.
      const route = goal ? (input.anchorsAsSeen ? findPath(emptyComfort, start, nearestFree(emptyComfort, goal) ?? goal, { throughDoors: true, maxCells: 20000 }) : null)
        ?? findPath(empty, start, goal, { throughDoors: true, maxCells: 20000 }) : null;
      // A room is entered through a door: where a body stands on its side of each door is part of the way too.
      const pts = [...(route ? routePoints([start, ...route]) : []), ...(input.anchorsAsSeen && room ? doorSides(space).map((d) => d.p).filter((q) => pointInPolygon(q, room.polygon)) : [])];
      const near = standing().map((p) => ({ p, d: pts.length ? Math.min(...pts.map((q) => distanceToObb(q, p.box))) : (p.roomId === id ? 0 : Infinity) }))
        .filter((x) => x.d < 1.5).map((x) => x.p);
      // A picture's home: the way is opened piece by piece (each move clears some of the route, none loses a room),
      // since two pieces in one doorway are never fixed by moving either alone.
      const onRoute = input.anchorsAsSeen ? pts : [];
      const intrusions = (objects: ObjectInstance[]) => { const m = comfortModel(objects); return onRoute.filter((q) => !isFree(m, q)).length; };
      const blockedNow = onRoute.length ? intrusions(working.objects) : 0;
      const fixes = (objects: ObjectInstance[]) => !lostRooms(objects, id).length
        || (blockedNow > 0 && intrusions(objects) < blockedNow && lostRooms(objects).length <= lost.length);
      // Small and mid pieces give way first; a large one (a wardrobe, a sofa) only when none of them can.
      if (input.anchorsAsSeen && pushAside(pts, fixes)) continue;
      if (repairWith(byRank(near), fixes, (p) => !p.essential && p.rank <= 3, pts)) continue;
      if (repairWith(byRank(near).filter((p) => p.rank <= 4), fixes, (p) => !p.essential && p.rank <= 4, pts)) continue;
      // Nothing near the route alone does it: the least important standing piece of the cut-off room goes.
      const last = byRank(standing().filter((p) => p.roomId === id && !p.lock))[0];
      if (last && !last.essential && last.rank < 5) { drop(last, 'CIRCULATION'); continue; }
      break;
    }
    const traps = trapsOf(working.objects);
    if (!traps.length) break;
    const t = traps[0];
    // The pieces that make the strip narrow: within reach of it.
    const near = standing().filter((p) => t.cells.some((c) => distanceToObb(c, p.box) < walkRadius + 0.1));
    const fixes = (objects: ObjectInstance[]) => {
      const left = trapsOf(objects, t.roomId).reduce((s, x) => s + x.areaM2, 0);
      return left < t.areaM2 - 0.05 && !lostRooms(objects, t.roomId).length;
    };
    if (input.anchorsAsSeen && start && t.cells.length) {
      // The way into the strip, as the furniture narrowly leaves it: the piece narrowing it is pushed off it.
      const squeeze = buildWalkModel(space, working.objects, assets); squeeze.radius = SQUEEZE_RADIUS_M;
      const c = t.cells[Math.floor(t.cells.length / 2)];
      const way = findPath(squeeze, start, nearestFree(squeeze, c) ?? c, { throughDoors: true, maxCells: 20000 });
      if (way && pushAside(routePoints([start, ...way]), fixes)) continue;
    }
    // A trap is never fixed by dropping a bed, a sofa or the kitchen: only small and mid pieces may go.
    if (!repairWith(byRank(near), fixes, (p) => !p.essential && p.rank <= 3, t.cells)) break;
  }

  // ── A picture's home: every doorway usable from both sides (a piece standing where one steps through is pushed
  //    off that spot, as little as clears it) ──
  if (input.anchorsAsSeen && start) {
    for (let guard = 0; guard < 12; guard += 1) {
      const m = comfortModel(working.objects);
      const blockedSide = doorSides(space).find((d) => space.rooms.some((r) => pointInPolygon(d.p, r.polygon)) && !isFree(m, d.p) && !nearestFree(m, d.p, DOOR_SIDE_SLACK_M));
      if (!blockedSide) break;
      const lostNow = lostRooms(working.objects).length;
      const fixes = (objects: ObjectInstance[]) => { const mm = comfortModel(objects); return (isFree(mm, blockedSide.p) || !!nearestFree(mm, blockedSide.p, DOOR_SIDE_SLACK_M)) && lostRooms(objects).length <= lostNow; };
      if (!pushAside([blockedSide.p], fixes)) break;
    }
  }

  // ── Last resort (bounded): a room still cut off, or a trap still there, loses what stands in it or by it —
  //    anything but sanitary fittings and the kitchen — rather than a walkthrough nobody can walk.
  for (let guard = 0; guard < 8 && start; guard += 1) {
    const lost = lostRooms(working.objects);
    const traps = lost.length ? [] : trapsOf(working.objects);
    if (!lost.length && !traps.length) break;
    const where = lost[0] ?? traps[0].roomId;
    const cells = traps[0]?.cells ?? [];
    const victim = byRank(standing().filter((p) => p.rank < 5 && !p.lock && (p.roomId === where || cells.some((c) => distanceToObb(c, p.box) < walkRadius + 0.1))))
      .sort((a, b) => Number(a.essential) - Number(b.essential) || a.rank - b.rank)[0];
    if (!victim) break;
    drop(victim, 'CIRCULATION');
    if (!report.circulation.repaired.includes(victim.roomId)) report.circulation.repaired.push(victim.roomId);
  }

  // ── The gate: what the walk is left with ──
  const finalTraps = trapsOf(working.objects);
  const unreachable = start ? lostRooms(working.objects) : [];
  report.circulation.reachableAfter = start ? [...reachableRooms(space, buildWalkModel(space, working.objects, assets), { start })].sort() : [];
  const crowded = space.rooms.filter((r) => planned.has(r.id) && densityChecked(r.kind) && density(r, standingIn(r.id).map((p) => p.area)) > DENSITY_MAX + 0.08).map((r) => r.id);
  const missingEssential = input.plan.rooms.map((pr) => rooms.get(pr.roomId)).filter((r): r is SpaceRoom => !!r && r.areaM2 >= 5)
    .filter((r) => { const role = essentialRole(r.kind); return !!role && !standingIn(r.id).some((p) => servesRole(p.asset, role)); }).map((r) => r.id);
  const furnishedModel = buildWalkModel(space, working.objects, assets);
  const spawn = circulationStart(space, furnishedModel);
  report.relocated = relocated;
  report.gate = {
    ok: !unreachable.length && !finalTraps.length && !!spawn,
    unreachable, traps: finalTraps.map((t) => ({ roomId: t.roomId, areaM2: t.areaM2 })), crowded, missingEssential, spawnValid: !!spawn && isFree(furnishedModel, spawn),
  };

  for (const it of report.items) {
    if (it.outcome === 'PLANNED') report.counts.planned += 1;
    else if (it.outcome === 'CORRECTED') report.counts.corrected += 1;
    else if (it.outcome === 'PLACED') report.counts.placed += 1;
    else report.counts.dropped += 1;
  }
  return { state: working, report };
}

/**
 * Clean poses for a piece in its room (the engine's candidates, clean only), at most `max`, spread over the room
 * (every k-th of them): a piece moved to open a way goes somewhere really different, not 25 cm along.
 */
function cleanPoses(space: SpaceModel, assets: Map<string, CatalogAsset>, objects: ObjectInstance[], room: SpaceRoom, asset: CatalogAsset, max: number): Array<{ at: Point; rotation: number }> {
  const ctx = { space, assets, objects };
  const world = placementWorld(ctx, room);
  const all: Array<{ at: Point; rotation: number }> = [];
  for (const c of candidatePositions(ctx, asset, room).slice(0, 120)) {
    if (!pointInPolygon(c.at, room.polygon) || onStairs(space, asset, c.at, c.rotation)) continue;
    if (verdictOf(evaluateInWorld(world, asset, c.at, c.rotation)) !== 'CLEAN') continue;
    all.push(c);
  }
  if (all.length <= max) return all;
  return Array.from({ length: max }, (_, i) => all[Math.round((i * (all.length - 1)) / (max - 1))]);
}

/**
 * Clean poses within a reference lock: rings around the picture's pose up to its radius, at its rotation, then
 * turned by up to its angle; nearest first. Bounded (a few dozen judgements).
 */
function lockedPoses(space: SpaceModel, assets: Map<string, CatalogAsset>, objects: ObjectInstance[], room: SpaceRoom, asset: CatalogAsset, lock: { at: Point; rotation: number; maxShiftM: number; maxTurnDeg: number }, max = 6, asSeen = false): Array<{ at: Point; rotation: number }> {
  const ctx = { space, assets, objects };
  const world = placementWorld(ctx, room);
  const out: Array<{ at: Point; rotation: number }> = [];
  for (const c0 of lockCandidates(lock)) {
    // A picture's wall piece stays against a wall wherever it is moved (see lockedOptions).
    const s0 = asSeen ? snapToWall(ctx, asset, c0.at, c0.rotation, room.id, 0.35) : null;
    const c = s0?.snapped ? { at: s0.at, rotation: s0.rotation } : c0;
    if (out.some((o) => Math.hypot(o.at.x - c.at.x, o.at.y - c.at.y) < 0.02 && Math.abs(o.rotation - c.rotation) < 1e-3)) continue;
    if (!pointInPolygon(c.at, room.polygon) || onStairs(space, asset, c.at, c.rotation)) continue;
    const issues = evaluateInWorld(world, asset, c.at, c.rotation);
    if (verdictOf(asSeen ? seenIssues(space, issues, asset, c.at, c.rotation) : issues) !== 'CLEAN') continue;
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

/** The poses a locked piece may take, in repair order: the picture's pose, small moves, then small turns with small moves. */
function lockCandidates(lock: { at: Point; rotation: number; maxShiftM: number; maxTurnDeg: number }): Array<{ at: Point; rotation: number; turn: number }> {
  const rings: Array<{ r: number; n: number }> = [{ r: 0, n: 1 }];
  for (let r = 0.1; r <= lock.maxShiftM + 1e-9; r += 0.1) rings.push({ r, n: Math.max(8, Math.round((2 * Math.PI * r) / 0.12)) });
  const turns = [0, ...[10, 20].filter((d) => d <= lock.maxTurnDeg).flatMap((d) => [d, -d])];
  const out: Array<{ at: Point; rotation: number; turn: number }> = [];
  for (const t of turns) {
    for (const { r, n } of rings) {
      for (let k = 0; k < n; k += 1) {
        const a = (k / n) * Math.PI * 2;
        out.push({ at: { x: lock.at.x + Math.cos(a) * r, y: lock.at.y + Math.sin(a) * r }, rotation: lock.rotation + t * DEG, turn: t });
      }
    }
  }
  return out;
}

/**
 * Where a reference-locked piece may stand, in the repair order (fidelity first), clean poses only, at most
 * `max`: the picture's pose; a small move (within its lock); the same at a slightly smaller scale (never under
 * SCALE_FLOOR of the catalogue size); a small turn; then, last, the nearest clean place in the SAME part of the
 * room (its 3 × 3 cell or a neighbour, within ANCHOR_FALLBACK of the picture's pose) — the plan of a space read
 * from pictures is an estimate, and a piece a few decimetres off is the picture, a piece missing is not.
 */
function lockedOptions(
  space: SpaceModel, assets: Map<string, CatalogAsset>, objects: ObjectInstance[], room: SpaceRoom, own: CatalogAsset, item: BuildItem, max = 8, asSeen = false,
): Array<{ at: Point; rotation: number; kept: boolean; why: string | null; movedM: number | null; verdict: Verdict; scale: number }> {
  if (!item.pose || !item.lock) return [];
  const lock = { at: { x: room.bounds.minX + item.pose.x, y: room.bounds.minY + item.pose.y }, rotation: item.pose.rotationDeg * DEG, maxShiftM: item.lock.maxShiftM, maxTurnDeg: item.lock.maxTurnDeg };
  const ctx = { space, assets, objects };
  const world = placementWorld(ctx, room);
  const scales = [item.scale, ...[0.94, 0.88].map((k) => r3(Math.max(SCALE_FLOOR, item.scale * k))).filter((x) => x < item.scale - 0.005)];
  const out: ReturnType<typeof lockedOptions> = [];
  let firstIssue: string | null = null;
  const consider = (at: Point, rotation: number, scale: number, turn: number) => {
    const asset = shapedAsset(own, { shape: itemShape(own, item, scale) });
    if (!pointInPolygon(at, room.polygon) || onStairs(space, asset, at, rotation)) return;
    const all = evaluateInWorld(world, asset, at, rotation);
    const issues = asSeen ? seenIssues(space, all, asset, at, rotation) : all;
    if (!firstIssue && issues.length) firstIssue = issues.find((i) => i.code !== 'TIGHT_ACCESS')?.code ?? 'TIGHT_ACCESS';
    if (verdictOf(issues) !== 'CLEAN') return;
    const movedM = r3(Math.hypot(at.x - lock.at.x, at.y - lock.at.y));
    const kept = movedM < 0.005 && turn === 0 && scale === item.scale;
    out.push({ at, rotation, kept, why: kept ? null : firstIssue ?? 'COLLISION', movedM, verdict: 'CLEAN', scale });
  };
  const cands = lockCandidates(lock);
  // Position before scale, scale before orientation; a few of each tier (the validator may still refuse one).
  for (const turnPhase of [false, true]) {
    for (const scale of scales) {
      let found = 0;
      for (const c of cands) {
        if ((c.turn !== 0) !== turnPhase || found >= 2 || out.length >= max) continue;
        const before = out.length;
        consider(c.at, c.rotation, scale, c.turn);
        if (out.length > before) found += 1;
      }
    }
  }
  if (out.length < max) {
    // The fallback: the same part of the room, nearest first, at the picture's rotation (or a quarter turn).
    const cell = (p: Point) => [
      Math.floor(((p.x - room.bounds.minX) / Math.max(0.01, room.bounds.maxX - room.bounds.minX)) * 3),
      Math.floor(((p.y - room.bounds.minY) / Math.max(0.01, room.bounds.maxY - room.bounds.minY)) * 3),
    ];
    const home = cell(lock.at);
    const reach = Math.max(ANCHOR_FALLBACK_M, 0.25 * Math.hypot(room.bounds.maxX - room.bounds.minX, room.bounds.maxY - room.bounds.minY));
    const snapped = snapToWall(ctx, shapedAsset(own, { shape: itemShape(own, item, item.scale) }), lock.at, lock.rotation, room.id, 0.9);
    const ring: Array<{ at: Point; rotation: number }> = snapped.snapped ? [{ at: snapped.at, rotation: snapped.rotation }] : [];
    for (let r = lock.maxShiftM + 0.15; r <= reach + 1e-9; r += 0.15) {
      const k = Math.max(12, Math.round((2 * Math.PI * r) / 0.2));
      for (let i = 0; i < k; i += 1) {
        const a = (i / k) * Math.PI * 2;
        const at = { x: lock.at.x + Math.cos(a) * r, y: lock.at.y + Math.sin(a) * r };
        // A picture's piece keeps the way it faces (its facing is evidence); a planned one may take a quarter turn.
        ring.push({ at, rotation: lock.rotation }, ...(asSeen ? [] : [{ at, rotation: lock.rotation + Math.PI / 2 }]));
      }
    }
    const shaped = shapedAsset(own, { shape: itemShape(own, item, item.scale) });
    for (const c0 of ring) {
      if (out.length >= max) break;
      // A picture's wall piece moved along the room stands against the wall it reaches, facing away from it (the
      // walk is then proven with the way it will face, never turned after).
      const s0 = asSeen ? snapToWall(ctx, shaped, c0.at, c0.rotation, room.id, 0.35) : null;
      const c = s0?.snapped ? { at: s0.at, rotation: s0.rotation } : c0;
      const cc = cell(c.at);
      if (Math.abs(cc[0] - home[0]) > 1 || Math.abs(cc[1] - home[1]) > 1) continue;
      for (const scale of scales.slice(0, 2)) {
        const before = out.length;
        consider(c.at, c.rotation, scale, 1);
        if (out.length > before) break;
      }
    }
  }
  return out;
}

/** A door side counts as usable when a body fits within this of it (renderGate.ts uses the same). */
export const DOOR_SIDE_SLACK_M = 0.25;
/** How far a picture's piece is pushed off a way, step by step (the least that clears it wins). */
const PUSH_STEPS_M = [0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6];
/** How much smaller a picture's piece may be made, last, to open a required way. */
const RESIZE_STEPS = [0.92, 0.85];
/** The body a too-tight way is looked for with (the gaps furniture leaves that a move could widen). */
const SQUEEZE_RADIUS_M = 0.1;
/** How far a picture's piece may be moved, last, to open a required route (recorded as CIRCULATION_MOVED). */
const WIDE_SHIFT_M = 1.0;

/** A door's passage: its opening (at most 1 m of it, centred) and half a metre either side. */
const PASSAGE_HALF_M = 0.5;
const PASSAGE_DEPTH_M = 0.5;
/** A piece's edge within this of the opening's edge is beside the passage, not in it (a frame, a reading's centimetres). */
const PASSAGE_TOLERANCE_M = 0.05;
/**
 * The findings that still move a piece standing where a picture of the real home shows it: not a tight front
 * zone, and not a door's keep-out unless it stands in the passage itself (see BuildInput.anchorsAsSeen).
 */
function seenIssues(space: SpaceModel, issues: PlacementIssue[], asset: CatalogAsset, at: Point, rotation: number): PlacementIssue[] {
  if (!issues.some((i) => i.code === 'TIGHT_ACCESS' || i.code === 'BLOCKS_DOOR')) return issues;
  const box = solidBox(footprint(asset, at, rotation));
  return issues.filter((i) => {
    if (i.code === 'TIGHT_ACCESS') return false;
    if (i.code !== 'BLOCKS_DOOR') return true;
    const door = space.doors.find((d) => d.id === i.relatedId);
    const wall = door ? space.walls.find((w) => w.id === door.wallId) : null;
    if (!door || !wall) return true;
    const passage = solidBox({ cx: door.centre.x, cy: door.centre.y, hw: Math.min(door.widthM / 2 - PASSAGE_TOLERANCE_M, PASSAGE_HALF_M), hd: PASSAGE_DEPTH_M, angle: wallFrame(wall.mesh).angle });
    return solidOverlap(box, passage);
  });
}

/** A locked piece is never scaled below this share of its catalogue size to fit (scenePlan SCALE_MIN). */
const SCALE_FLOOR = 0.85;

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

/** How many doors a room is from the room `start` stands in (rooms joined by their doors; unknown: a large number). */
function doorHops(space: SpaceModel, start: Point, roomId: string): number {
  const from = space.rooms.find((r) => pointInPolygon(start, r.polygon))?.id;
  if (!from) return 99;
  const links = new Map<string, Set<string>>();
  for (const d of space.doors) {
    const wall = space.walls.find((w) => w.id === d.wallId);
    if (!wall) continue;
    const { dir } = wallFrame(wall.mesh);
    const ids = [1, -1].map((k) => space.rooms.find((r) => pointInPolygon({ x: d.centre.x - dir.y * 0.3 * k, y: d.centre.y + dir.x * 0.3 * k }, r.polygon))?.id)
      .filter((x): x is string => !!x);
    for (const a of ids) for (const b of ids) if (a !== b) { if (!links.has(a)) links.set(a, new Set()); links.get(a)!.add(b); }
  }
  const seen = new Map([[from, 0]]); const queue = [from];
  while (queue.length) {
    const r = queue.shift()!;
    for (const n of links.get(r) ?? []) if (!seen.has(n)) { seen.set(n, seen.get(r)! + 1); queue.push(n); }
  }
  return seen.get(roomId) ?? 99;
}

/**
 * The comfortable floor a comfortable walk from `start` does not reach, room by room (walkability.ts
 * strandedFloor on the furnished space at the comfort margin): the trap a bed and a wardrobe make together.
 */
export function stranded(space: SpaceModel, objects: ObjectInstance[], assets: Map<string, CatalogAsset>, start: Point | null, only?: string, bare?: (p: Point) => boolean, radius = COMFORT_RADIUS_M) {
  if (!start) return [];
  const roomy = buildWalkModel(space, objects, assets);
  roomy.radius = radius;
  const before = bare ?? bareComfortReach(space, assets, start, radius);
  return strandedFloor(space, roomy, walkableFrom(roomy, start), only, before);
}

/** Where the comfortable walk goes with no furniture at all (the plan's own reach). */
export function bareComfortReach(space: SpaceModel, assets: Map<string, CatalogAsset>, start: Point, radius = COMFORT_RADIUS_M): (p: Point) => boolean {
  const bare = buildWalkModel(space, [], assets);
  bare.radius = radius;
  return walkableFrom(bare, start);
}

/** Points just either side of every door (where a body stands to walk through it). */
export function doorSides(space: SpaceModel): Array<{ doorId: string; p: Point }> {
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
  // Cells by number (i, j within ±2^15 cells: 4.9 km): no strings in the hot loop.
  const K = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);
  const closed = model.closedDoors;
  model.closedDoors = new Set();
  const free = new Map<number, boolean>();
  // Half-cell points (diagonal corners) are keyed on a doubled grid.
  const freeAt2 = (i2: number, j2: number) => {
    const k = K(i2, j2);
    let v = free.get(k);
    if (v === undefined) { v = isFree(model, { x: start.x + (i2 * G) / 2, y: start.y + (j2 * G) / 2 }); free.set(k, v); }
    return v;
  };
  const seen = new Set<number>([K(0, 0)]);
  try {
    const qi: number[] = [0]; const qj: number[] = [0];
    for (let q = 0; q < qi.length && seen.size < maxCells; q += 1) {
      const i = qi[q]; const j = qj[q];
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const ni = i + di; const nj = j + dj; const k = K(ni, nj);
        if (seen.has(k)) continue;
        if (!freeAt2(ni * 2, nj * 2)) continue;
        if (di !== 0 && dj !== 0) {
          if (!freeAt2((i + di) * 2, j * 2) || !freeAt2(i * 2, (j + dj) * 2) || !freeAt2(i * 2 + di, j * 2 + dj)) continue;
        }
        seen.add(k);
        qi.push(ni); qj.push(nj);
      }
    }
  } finally {
    model.closedDoors = closed;
  }
  return (p: Point) => {
    const ci = Math.round((p.x - start.x) / G); const cj = Math.round((p.y - start.y) / G);
    for (let di = -1; di <= 1; di += 1) for (let dj = -1; dj <= 1; dj += 1) if (seen.has(K(ci + di, cj + dj))) return true;
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
