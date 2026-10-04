// REFERENCE FIDELITY: A WALKTHROUGH OF A PICTURE IS READY ONLY WHEN IT IS THAT PICTURE.
//
// A reference-locked scene plan (scenePlan.ts, ds-scene-plan-2) reads the
// selected design picture into the plan: which room it shows, the camera,
// every visible piece with its pose, real size, zone and where it touches the
// floor in the picture. The builder (build.ts) then makes it walkable. This
// file judges the BUILT result against the picture, deterministically:
//
//   objects   every reference-locked anchor stands; most of what the picture
//             shows (anchors and major pieces) is there    → REFERENCE_OBJECT_MISSING
//   layout    anchors stay where the picture has them; the pictured room's
//             composition keeps its spread and its centre (furniture packed
//             into a corner fails even when it is walkable); the plan's poses,
//             seen from the reference camera, land where the picture shows
//             them                                          → REFERENCE_LAYOUT_MISMATCH
//   zones     no piece migrates to another part of its room; no zone the
//             picture furnishes is left empty                → REFERENCE_ZONE_MISMATCH
//   scale     a piece measured in the picture is built at about that size,
//             and nothing takes an unreal share of its room  → REFERENCE_SCALE_MISMATCH
//   camera    the picture is located in the plan (a room, a camera inside it,
//             consistent with what it shows)                 → REFERENCE_CAMERA_MISMATCH
//   safety    the walkability gate (walkability.ts)          → NOT_WALKABLE
//   balance   the pictured rooms are neither crowded nor missing what makes
//             them what they are                             → OVERFURNISHED / UNDERFURNISHED
//
// It also carries what the reference camera is for the factory's QA render and
// the findings a bounded replan is told about (feedbackOf: codes and numbers
// generated here, never model or customer text).
//
// Pure and deterministic (Deno + Node): same scene, same verdict.

import type { WalkGate } from './walkability.ts';
import type { Point, SpaceModel, SpaceRoom } from '../space.ts';

export const FIDELITY_CODES = [
  'NOT_WALKABLE', 'REFERENCE_OBJECT_MISSING', 'REFERENCE_LAYOUT_MISMATCH', 'REFERENCE_ZONE_MISMATCH', 'REFERENCE_SCALE_MISMATCH',
  'REFERENCE_CAMERA_MISMATCH', 'OVERFURNISHED', 'UNDERFURNISHED',
] as const;
export type FidelityCode = typeof FIDELITY_CODES[number];

/** Preferred clear width of a walking path, and the hard minimum (walkability.ts gates the comfort margin). */
export const CIRCULATION_PREFERRED_M = 0.9;
export const CIRCULATION_MIN_M = 0.8;

// ── The plan and the build, structurally (scenePlan.ts ValidatedScenePlan, build.ts BuildReport) ─────────────

type Basis = 'OBSERVED' | 'STRONGLY_INFERRED' | 'INFERRED' | 'UNKNOWN';
export interface RefFacts {
  key: string;
  basis: Basis;
  importance: 'ANCHOR' | 'MAJOR' | 'MINOR' | 'DECOR';
  locked: boolean;
  zone: string;
  dims: { widthM: number; depthM: number; heightM: number | null } | null;
  sizeBasis: Basis;
  imagePx: [number, number] | null;
}
/** ROOM: x, y in roomId's own frame; HOME: x, y in the home frame (homeOrigin), a dollhouse view from above. */
export interface RefCamera { frame?: 'ROOM' | 'HOME'; roomId: string | null; x: number; y: number; heightM: number; yawDeg: number; pitchDeg: number; fovDeg: number; basis: Basis; confidence: number }
export interface FidelityPlan {
  rooms: Array<{ roomId: string; items: Array<{ code: string; type: string; pose: { x: number; y: number; rotationDeg: number } | null; scale: number; ref?: RefFacts }> }>;
  reference?: { view?: 'ROOM' | 'MASTER'; roomId: string | null; visibleRoomIds: string[]; camera: RefCamera | null; cameraNote: string | null };
}
export interface FidelityBuild {
  items: Array<{ roomId: string; code: string; instanceId: string | null; outcome: string; reason: string | null; refKey?: string | null }>;
  gate?: WalkGate;
}
export interface FidelityObject { instanceId: string; roomId: string | null; assetId: string; position: { x: number; z: number }; rotationY: number; shape?: { widthM: number; depthM: number } | null }
export interface FidelityAsset { widthM: number; depthM: number; placement?: string; heightM?: number }

export interface Finding { code: FidelityCode; roomId: string | null; key: string | null; detail: string }
export interface FidelityReport {
  ok: boolean;
  /** The first failure, in FIDELITY_CODES order; null when it passed. */
  code: FidelityCode | null;
  codes: FidelityCode[];
  findings: Finding[];
  metrics: {
    anchors: number; anchorsPresent: number; objectRecall: number | null;
    meanShiftM: number | null; maxShiftM: number | null;
    spreadRatio: number | null; centroidShiftRatio: number | null;
    zoneMatches: number; zoneChecks: number;
    scaleChecks: number; scaleOk: number;
    imageError: number | null; imageChecks: number;
    referenceRoomPieces: number;
  };
  /** 0..1, for observability (never the gate itself). */
  score: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const DEG = Math.PI / 180;
const diagOf = (room: SpaceRoom) => Math.hypot(room.bounds.maxX - room.bounds.minX, room.bounds.maxY - room.bounds.minY);

/** How far a reference-locked anchor may be nudged (room-relative, bounded) and turned. */
export function anchorLock(room: SpaceRoom): { maxShiftM: number; maxTurnDeg: number } {
  return { maxShiftM: r3(Math.min(0.6, Math.max(0.35, 0.1 * diagOf(room)))), maxTurnDeg: 20 };
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const spreadOf = (pts: Point[]) => {
  const c = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  return { c, rms: Math.sqrt(pts.reduce((s, p) => s + (p.x - c.x) ** 2 + (p.y - c.y) ** 2, 0) / pts.length) };
};
/** A room's 3 × 3 part a point is in (column, row). */
const cellOf = (room: SpaceRoom, p: Point) => [
  Math.min(2, Math.max(0, Math.floor(((p.x - room.bounds.minX) / Math.max(0.01, room.bounds.maxX - room.bounds.minX)) * 3))),
  Math.min(2, Math.max(0, Math.floor(((p.y - room.bounds.minY) / Math.max(0.01, room.bounds.maxY - room.bounds.minY)) * 3))),
] as const;

// ── The reference camera ─────────────────────────────────────────────────────

/** The home frame's origin: the south-west corner of all rooms' bounds (the frame a dollhouse camera is given in). */
export function homeOrigin(space: SpaceModel): Point {
  return { x: Math.min(...space.rooms.map((r) => r.bounds.minX)), y: Math.min(...space.rooms.map((r) => r.bounds.minY)) };
}

/** The camera in plan metres: eye position (z up) and unit look direction. */
export function cameraInPlan(space: SpaceModel, cam: RefCamera): { eye: [number, number, number]; look: [number, number, number] } | null {
  let o: Point;
  if (cam.frame === 'HOME') {
    if (!space.rooms.length) return null;
    o = homeOrigin(space);
  } else {
    const room = space.rooms.find((r) => r.id === cam.roomId);
    if (!room) return null;
    o = { x: room.bounds.minX, y: room.bounds.minY };
  }
  const yaw = cam.yawDeg * DEG; const pitch = cam.pitchDeg * DEG;
  // yaw as rotationDeg: 0 looks north (+y), 90 west (−x), counter-clockwise.
  return {
    eye: [o.x + cam.x, o.y + cam.y, cam.heightM],
    look: [-Math.sin(yaw) * Math.cos(pitch), Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch)],
  };
}

/** A floor point (plan metres, at height z) seen from the reference camera → picture fractions [x right, y down]; null behind it. */
export function projectToImage(space: SpaceModel, cam: RefCamera, p: Point, aspect: number, z = 0): [number, number] | null {
  const c = cameraInPlan(space, cam);
  if (!c) return null;
  const f = c.look;
  const yaw = cam.yawDeg * DEG;
  const right: [number, number, number] = [Math.cos(yaw), Math.sin(yaw), 0];
  const up: [number, number, number] = [right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]];
  const d = [p.x - c.eye[0], p.y - c.eye[1], z - c.eye[2]];
  const zc = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
  if (zc < 0.1) return null;
  const xc = d[0] * right[0] + d[1] * right[1] + d[2] * right[2];
  const yc = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
  const tanV = Math.tan((cam.fovDeg * DEG) / 2); const tanH = tanV * aspect;
  return [0.5 + xc / zc / tanH / 2, 0.5 - yc / zc / tanV / 2];
}

/**
 * The reference camera as the factory takes it (compileSceneSpec: a three.js pose — x, up, −north), moved to the
 * nearest free spot when a piece stands where the eye is (`free`), for the QA render from the picture's viewpoint.
 */
export function referenceCameraPose(space: SpaceModel, cam: RefCamera, aspect: number, free?: (p: Point) => Point | null) {
  const c = cameraInPlan(space, cam);
  if (!c) return null;
  const at = free ? free({ x: c.eye[0], y: c.eye[1] }) ?? { x: c.eye[0], y: c.eye[1] } : { x: c.eye[0], y: c.eye[1] };
  const eye: [number, number, number] = [at.x, at.y, c.eye[2]];
  const target = [eye[0] + c.look[0] * 3, eye[1] + c.look[1] * 3, eye[2] + c.look[2] * 3];
  // A dollhouse is seen with its walls cut low, as such pictures show it.
  const cut = cam.frame === 'HOME' ? { exteriorM: 1.2, interiorM: 1.2 } : null;
  return {
    position: [r3(eye[0]), r3(eye[2]), r3(-eye[1])] as [number, number, number],
    target: [r3(target[0]), r3(target[2]), r3(-target[1])] as [number, number, number],
    fov: cam.fovDeg, near: 0.05, far: 500, aspect: r3(Math.min(3, Math.max(0.33, aspect))), background: null, cut,
    moved: r3(Math.hypot(at.x - c.eye[0], at.y - c.eye[1])),
  };
}

// ── The verdict ─────────────────────────────────────────────────────────────

/**
 * The built walkthrough against the picture. Only for a reference-locked plan (one with `reference`); a plan
 * made from the specification alone is judged by the walkability gate as before.
 */
export function referenceFidelity(input: {
  space: SpaceModel; plan: FidelityPlan; build: FidelityBuild; objects: FidelityObject[]; assets: ReadonlyMap<string, FidelityAsset>; aspect: number | null;
}): FidelityReport {
  const { space, plan, build } = input;
  const findings: Finding[] = [];
  const add = (code: FidelityCode, roomId: string | null, key: string | null, detail: string) => findings.push({ code, roomId, key, detail });
  const rooms = new Map(space.rooms.map((r) => [r.id, r]));
  const ref = plan.reference ?? { roomId: null, visibleRoomIds: [], camera: null, cameraNote: 'NO_REFERENCE' };
  const visible = new Set(ref.visibleRoomIds);
  const objects = new Map(input.objects.map((o) => [o.instanceId, o]));
  const reportOf = new Map(build.items.filter((i) => i.refKey).map((i) => [`${i.roomId}:${i.refKey}`, i]));
  const sizeOf = (o: FidelityObject) => {
    const a = input.assets.get(o.assetId);
    return o.shape ? { w: o.shape.widthM, d: o.shape.depthM } : a ? { w: a.widthM, d: a.depthM } : null;
  };

  // ── Safety first: the walkability gate ──
  const gate = build.gate;
  if (gate && !gate.ok) {
    add('NOT_WALKABLE', gate.unreachable[0] ?? gate.traps[0]?.roomId ?? null, null,
      `${gate.unreachable.length} room(s) cut off, ${gate.traps.length} narrow trap(s)${gate.spawnValid ? '' : ', no free place to start'}`);
  }

  // ── Every piece the plan read from the picture: where it was proposed, where it stands ──
  interface Judged { roomId: string; key: string; type: string; refx: RefFacts; proposed: Point | null; final: (Point & { rot: number; w: number; d: number }) | null; reason: string | null }
  const judged: Judged[] = [];
  for (const pr of plan.rooms) {
    const room = rooms.get(pr.roomId);
    if (!room) continue;
    for (const it of pr.items) {
      if (!it.ref) continue;
      const rep = reportOf.get(`${pr.roomId}:${it.ref.key}`);
      const obj = rep?.instanceId ? objects.get(rep.instanceId) : undefined;
      const size = obj ? sizeOf(obj) : null;
      judged.push({
        roomId: pr.roomId, key: it.ref.key, type: it.type, refx: it.ref,
        proposed: it.pose ? { x: room.bounds.minX + it.pose.x, y: room.bounds.minY + it.pose.y } : null,
        final: obj && size && rep?.outcome !== 'DROPPED' ? { x: obj.position.x, y: obj.position.z, rot: obj.rotationY, w: size.w, d: size.d } : null,
        reason: rep?.reason ?? (rep ? null : 'NOT_BUILT'),
      });
    }
  }

  // ── Objects ──
  const anchors = judged.filter((j) => j.refx.locked);
  for (const a of anchors.filter((j) => !j.final)) add('REFERENCE_OBJECT_MISSING', a.roomId, a.key, `${a.type} ${a.key} is in the picture but not in the walkthrough (${a.reason ?? 'dropped'})`);
  const shown = judged.filter((j) => (j.refx.importance === 'ANCHOR' || j.refx.importance === 'MAJOR') && (j.refx.basis === 'OBSERVED' || j.refx.basis === 'STRONGLY_INFERRED'));
  const recall = shown.length ? shown.filter((j) => j.final).length / shown.length : null;
  if (recall != null && shown.length >= 3 && recall < 0.7) add('REFERENCE_OBJECT_MISSING', ref.roomId, null, `only ${Math.round(recall * 100)}% of the picture's major pieces stand`);

  // ── Layout: anchors stay; the composition keeps its spread and centre ──
  const shifts: number[] = [];
  for (const a of anchors) {
    if (!a.final || !a.proposed) continue;
    const room = rooms.get(a.roomId)!;
    const s = Math.hypot(a.final.x - a.proposed.x, a.final.y - a.proposed.y);
    shifts.push(s);
    if (s > anchorLock(room).maxShiftM + 0.05) add('REFERENCE_LAYOUT_MISMATCH', a.roomId, a.key, `${a.type} ${a.key} moved ${r3(s)} m from where the picture has it`);
  }
  let spreadRatio: number | null = null; let centroidShiftRatio: number | null = null;
  for (const roomId of visible) {
    const room = rooms.get(roomId);
    if (!room) continue;
    const pairs = judged.filter((j) => j.roomId === roomId && j.proposed && j.final && j.refx.importance !== 'DECOR');
    if (pairs.length < 3) continue;
    const before = spreadOf(pairs.map((j) => j.proposed!)); const after = spreadOf(pairs.map((j) => ({ x: j.final!.x, y: j.final!.y })));
    const ratio = before.rms > 0.05 ? after.rms / before.rms : 1;
    const shift = Math.hypot(after.c.x - before.c.x, after.c.y - before.c.y) / diagOf(room);
    if (roomId === ref.roomId || spreadRatio == null) { spreadRatio = r3(ratio); centroidShiftRatio = r3(shift); }
    if (ratio < 0.6) add('REFERENCE_LAYOUT_MISMATCH', roomId, null, `the room's furniture is packed together (spread ${Math.round(ratio * 100)}% of the picture's)`);
    else if (shift > 0.2) add('REFERENCE_LAYOUT_MISMATCH', roomId, null, `the room's furniture shifted ${Math.round(shift * 100)}% of the room away from where the picture has it`);
  }
  // A corner cluster, judged on the built room alone (whatever the plan said): pieces packed together far from the middle.
  let referenceRoomPieces = 0;
  for (const roomId of visible) {
    const room = rooms.get(roomId);
    if (!room) continue;
    const standing = input.objects.filter((o) => o.roomId === room.id && (input.assets.get(o.assetId)?.placement ?? 'FLOOR') === 'FLOOR'
      && (input.assets.get(o.assetId)?.heightM ?? 1) > 0.05);
    if (roomId === ref.roomId || !ref.roomId) referenceRoomPieces += standing.length;
    if (room.areaM2 >= 12 && standing.length >= 3) {
      const s = spreadOf(standing.map((o) => ({ x: o.position.x, y: o.position.z })));
      const off = Math.hypot(s.c.x - room.centroid.x, s.c.y - room.centroid.y);
      if (s.rms < 0.18 * diagOf(room) && off > 0.28 * diagOf(room)) add('REFERENCE_LAYOUT_MISMATCH', room.id, null, 'the furniture is packed into one corner and the room is left empty');
    }
  }

  // ── The plan against the picture itself: seen from the reference camera, do the pieces land where it shows them? ──
  const cam = ref.camera;
  const aspect = input.aspect && input.aspect > 0 ? input.aspect : 16 / 9;
  const imgErr: number[] = []; const shownPx: Array<[number, number]> = []; const planPx: Array<[number, number]> = [];
  if (cam) {
    for (const j of judged) {
      if ((cam.frame !== 'HOME' && j.roomId !== cam.roomId) || !j.refx.imagePx || !j.proposed || j.refx.basis !== 'OBSERVED' || j.refx.importance === 'DECOR') continue;
      const p = projectToImage(space, cam, j.proposed, aspect);
      if (!p) { imgErr.push(1); continue; }
      imgErr.push(Math.hypot((p[0] - j.refx.imagePx[0]) * aspect, p[1] - j.refx.imagePx[1]) / Math.max(1, aspect));
      shownPx.push(j.refx.imagePx); planPx.push(p);
    }
  }
  const imageError = median(imgErr);
  if (!cam && plan.reference) add('REFERENCE_CAMERA_MISMATCH', ref.roomId, null, `the picture could not be located in the plan (${ref.cameraNote ?? 'no camera'})`);
  else if (cam && imageError != null && imgErr.length >= 2 && imageError > 0.22) {
    const spreadShown = shownPx.length >= 3 ? spreadOf(shownPx.map(([x, y]) => ({ x, y }))).rms : 0;
    const spreadPlan = planPx.length >= 3 ? spreadOf(planPx.map(([x, y]) => ({ x, y }))).rms : 0;
    if (spreadShown > 0.05 && spreadPlan < 0.5 * spreadShown) add('REFERENCE_LAYOUT_MISMATCH', cam.roomId, null, 'seen from the picture\'s camera, the planned pieces bunch together where the picture spreads them out');
    else add('REFERENCE_CAMERA_MISMATCH', cam.roomId, null, `seen from the estimated camera, the pieces land ${Math.round(imageError * 100)}% of the picture away from where it shows them`);
  }

  // ── Zones: nothing migrates; no furnished zone is left empty ──
  let zoneChecks = 0; let zoneMatches = 0;
  for (const j of judged) {
    if (!j.final || !j.proposed || j.refx.importance === 'DECOR' || !lockedOrShown(j.refx)) continue;
    const room = rooms.get(j.roomId)!;
    const a = cellOf(room, j.proposed); const b = cellOf(room, j.final);
    zoneChecks += 1;
    if (Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1) zoneMatches += 1;
    else add('REFERENCE_ZONE_MISMATCH', j.roomId, j.key, `${j.type} ${j.key} moved to another part of the room`);
  }
  for (const roomId of visible) {
    const byZone = new Map<string, Judged[]>();
    for (const j of judged.filter((x) => x.roomId === roomId && lockedOrShown(x.refx) && x.refx.importance !== 'DECOR' && x.refx.importance !== 'MINOR')) {
      (byZone.get(j.refx.zone) ?? byZone.set(j.refx.zone, []).get(j.refx.zone)!).push(j);
    }
    for (const [zone, list] of byZone) if (zone !== 'OTHER' && list.every((j) => !j.final)) add('REFERENCE_ZONE_MISMATCH', roomId, null, `the picture's ${zone.toLowerCase()} area is empty`);
  }

  // ── Scale: built at about the size the picture shows; nothing an unreal share of its room ──
  let scaleChecks = 0; let scaleOk = 0;
  for (const j of judged) {
    if (!j.final) continue;
    const room = rooms.get(j.roomId)!;
    if (!/KITCHEN_RUN/.test(j.type) && j.final.w * j.final.d > 0.45 * room.areaM2) add('REFERENCE_SCALE_MISMATCH', j.roomId, j.key, `${j.type} ${j.key} takes ${Math.round((j.final.w * j.final.d * 100) / room.areaM2)}% of the room's floor`);
    const dims = j.refx.dims;
    if (!dims || j.refx.sizeBasis !== 'OBSERVED' || j.refx.importance === 'DECOR') continue;
    scaleChecks += 1;
    const long = Math.max(j.final.w, j.final.d) / Math.max(dims.widthM, dims.depthM);
    const area = (j.final.w * j.final.d) / (dims.widthM * dims.depthM);
    if (long >= 0.7 && long <= 1.4 && area >= 0.5 && area <= 1.9) scaleOk += 1;
    else if (j.refx.locked || j.refx.importance === 'ANCHOR') add('REFERENCE_SCALE_MISMATCH', j.roomId, j.key, `${j.type} ${j.key} is built at ${Math.round(long * 100)}% of the length the picture shows`);
  }

  // ── Balance in the pictured rooms ──
  if (gate) {
    for (const id of gate.crowded) if (visible.has(id)) add('OVERFURNISHED', id, null, 'the room is more crowded than the picture');
    for (const id of gate.missingEssential) if (visible.has(id)) add('UNDERFURNISHED', id, null, 'the room is missing the piece that makes it what it is');
  }
  for (const roomId of visible) {
    const shownHere = judged.filter((j) => j.roomId === roomId && lockedOrShown(j.refx) && j.refx.importance !== 'DECOR');
    const standHere = shownHere.filter((j) => j.final).length;
    if (shownHere.length >= 2 && standHere < Math.ceil(shownHere.length * 0.5)) add('UNDERFURNISHED', roomId, null, `${standHere} of the picture's ${shownHere.length} pieces stand`);
  }

  const codes = FIDELITY_CODES.filter((c) => findings.some((f) => f.code === c));
  const meanShift = shifts.length ? r3(shifts.reduce((s, x) => s + x, 0) / shifts.length) : null;
  const parts = [
    recall ?? 1,
    anchors.length ? anchors.filter((a) => a.final).length / anchors.length : 1,
    zoneChecks ? zoneMatches / zoneChecks : 1,
    scaleChecks ? scaleOk / scaleChecks : 1,
    spreadRatio == null ? 1 : Math.min(1, spreadRatio),
    imageError == null ? 1 : Math.max(0, 1 - imageError / 0.4),
  ];
  return {
    ok: !codes.length, code: codes[0] ?? null, codes, findings: findings.slice(0, 40),
    metrics: {
      anchors: anchors.length, anchorsPresent: anchors.filter((a) => a.final).length, objectRecall: recall == null ? null : r3(recall),
      meanShiftM: meanShift, maxShiftM: shifts.length ? r3(Math.max(...shifts)) : null, spreadRatio, centroidShiftRatio,
      zoneMatches, zoneChecks, scaleChecks, scaleOk, imageError: imageError == null ? null : r3(imageError), imageChecks: imgErr.length, referenceRoomPieces,
    },
    score: r3(parts.reduce((s, x) => s + x, 0) / parts.length),
  };
}

const lockedOrShown = (r: RefFacts) => r.locked || r.basis === 'OBSERVED' || r.basis === 'STRONGLY_INFERRED';

/** What a bounded replan is told: HOMATCH's findings, generated here from fixed codes, keys and numbers. */
export function feedbackOf(report: FidelityReport): string[] {
  return report.findings.slice(0, 12).map((f) => `${f.code}${f.roomId ? ` in room ${f.roomId}` : ''}: ${f.detail}`);
}

// ── The reference view, rendered: the visual check ──────────────────────────

/** The vision check's answer (hybrid/qa.ts QaReport), structurally. */
export interface VisualQa {
  errors: Array<{ code: string; severity: 'LOW' | 'MEDIUM' | 'HIGH'; confidence: number }>;
  scores: { layout: number; furniture: number; overall: number; dimensions?: Partial<Record<string, number | null>> };
}

/**
 * The factory's render from the reference camera against the picture (scores 0..10). Only gross failures fail:
 * the render is the catalogue's furniture in Blender light, never the photoreal picture, so style, colour and
 * light are reported, not judged. Codes in FIDELITY_CODES order; ok when none.
 */
export function visualVerdict(qa: VisualQa): { ok: boolean; code: FidelityCode | null; codes: FidelityCode[]; missingHigh: number } {
  const d = qa.scores.dimensions ?? {};
  const dim = (k: string, fallback: number) => (typeof d[k] === 'number' ? d[k] as number : fallback);
  const missingHigh = qa.errors.filter((e) => e.code === 'objectMissing' && e.severity === 'HIGH' && e.confidence >= 0.6).length;
  const codes: FidelityCode[] = [];
  if (missingHigh >= 3 && dim('inventory', qa.scores.furniture) <= 3) codes.push('REFERENCE_OBJECT_MISSING');
  if (qa.scores.layout <= 3 && dim('placement', qa.scores.layout) <= 3) codes.push('REFERENCE_LAYOUT_MISMATCH');
  if (dim('scale', 10) <= 2) codes.push('REFERENCE_SCALE_MISMATCH');
  if (dim('camera', 10) <= 2 && qa.scores.layout <= 4) codes.push('REFERENCE_CAMERA_MISMATCH');
  const ordered = FIDELITY_CODES.filter((c) => codes.includes(c));
  return { ok: !ordered.length, code: ordered[0] ?? null, codes: ordered, missingHigh };
}
