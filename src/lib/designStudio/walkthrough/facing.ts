// WHICH WAY A PIECE FACES — inferred from what is around it, never from a fixed angle per type.
//
// A traced front (a reading's frontPx, unprojected) is evidence; so is the room the piece stands in. A dining chair
// faces the table it is drawn up to, an armchair the table or screen its group is gathered round, a bed, wardrobe,
// cabinet, run or console stands with its back to the wall behind it and its front to the room, a bedside table
// faces the way its bed does. This file names that expectation for every piece that has a front, measures how far
// the piece's actual front is from it, and corrects only what the context says plainly (a chair turned away from
// its own table is a mistake, not a design). Every correction is recorded.
//
// Conventions (designState.ts): rotationY is radians counter-clockwise from +x; the front is local +y, so the front
// points along (−sin r, cos r). Pure (Deno + Node).

import type { CatalogAsset } from '../catalog.ts';
import type { DesignState, ObjectInstance } from '../designState.ts';
import { wallFrame, type SpaceModel } from '../space.ts';

type Pt = { x: number; y: number };

export type FacingRole = 'SEAT_AT_TABLE' | 'LOUNGE_SEAT' | 'BACK_TO_WALL' | 'BEDSIDE' | 'NONE';
export type FacingCode = 'REVERSED' | 'TURNED_AWAY' | 'FACES_WALL';

export interface FacingExpectation {
  role: FacingRole;
  /** Direction the front should point (radians, plan, atan2(y, x)). */
  dir: number;
  /** STRONG: the context leaves no doubt (a chair at a table, a bed against a wall); WEAK: a reasonable default. */
  strength: 'STRONG' | 'WEAK';
  /** What it was inferred from: the table / bed / group / wall. */
  basis: string;
  targetId: string | null;
}

export interface FacingFinding {
  instanceId: string;
  type: string;
  role: FacingRole;
  code: FacingCode;
  /** Angle between the front and the expectation, degrees. */
  offDeg: number;
  basis: string;
}

export interface FacingCorrection { instanceId: string; type: string; fromDeg: number; toDeg: number; basis: string }

const TABLES = new Set(['DINING_TABLE', 'DESK', 'OUTDOOR_TABLE', 'KITCHEN_ISLAND']);
const LOW_TABLES = new Set(['COFFEE_TABLE', 'SIDE_TABLE', 'OUTDOOR_TABLE']);
const SEATS_AT_TABLE = new Set(['CHAIR', 'OFFICE_CHAIR', 'BAR_STOOL']);
const LOUNGE = new Set(['SOFA', 'ARMCHAIR', 'OUTDOOR_CHAIR', 'OUTDOOR_SOFA']);
const AGAINST_WALL = new Set(['BED_DOUBLE', 'BED_SINGLE', 'WARDROBE', 'DRESSER', 'SHELVING', 'TV_UNIT', 'KITCHEN_RUN', 'FRIDGE', 'VANITY', 'TOILET', 'DESK', 'WASHING_MACHINE']);
const BEDS = new Set(['BED_DOUBLE', 'BED_SINGLE']);
const SCREENS = new Set(['TV_UNIT', 'TV']);

/** How far a back may stand from a wall face and still be against it (metres). */
const WALL_REACH_M = 0.5;
/** A seat this far (edge to centre) from a table is drawn up to it. */
const TABLE_REACH_M = 1.0;
/** A lounge seat gathers round a low table this close, else a screen this close. */
const GROUP_REACH_M = 2.4;
const SCREEN_REACH_M = 4.5;

const PROCEDURAL_TYPE: Record<string, string> = {
  SOFA: 'SOFA', ARMCHAIR: 'ARMCHAIR', RECLINER: 'ARMCHAIR', CHAIR: 'CHAIR', STOOL: 'BAR_STOOL', BED: 'BED_DOUBLE', WARDROBE: 'WARDROBE',
  DRESSER: 'DRESSER', SHELF: 'SHELVING', TV_UNIT: 'TV_UNIT', KITCHEN_RUN: 'KITCHEN_RUN', FRIDGE: 'FRIDGE', VANITY: 'VANITY', TOILET: 'TOILET',
  WASHER: 'WASHING_MACHINE', ROUND_TABLE: 'DINING_TABLE', TABLE: 'DINING_TABLE', CABINET: 'BEDSIDE', RUG: 'RUG', PLANT: 'PLANT', PLANTER: 'PLANTER', LAMP: 'FLOOR_LAMP',
};

/** What a placed piece is, from the reading that placed it, else from its asset. */
export function typeOf(o: ObjectInstance, asset: CatalogAsset | undefined): string {
  const seen = o.provenance?.detectedType;
  if (seen && seen !== 'OTHER') return seen;
  const code = `${asset?.code ?? ''} ${asset?.category ?? ''} ${asset?.subcategory ?? ''}`.toLowerCase();
  if (/coffee/.test(code)) return 'COFFEE_TABLE';
  if (/side.?table|bedside|nightstand/.test(code)) return /bedside|nightstand/.test(code) ? 'BEDSIDE' : 'SIDE_TABLE';
  if (/outdoor.?(chair|lounge)/.test(code)) return 'OUTDOOR_CHAIR';
  if (/outdoor.?table/.test(code)) return 'OUTDOOR_TABLE';
  if (/dining.?chair|tub.?chair/.test(code)) return 'CHAIR';
  if (/dining.?table/.test(code)) return 'DINING_TABLE';
  return (asset?.procedural?.kind && PROCEDURAL_TYPE[asset.procedural.kind]) || 'OTHER';
}

export const frontOf = (rotationY: number): Pt => ({ x: -Math.sin(rotationY), y: Math.cos(rotationY) });
const angleDiff = (a: number, b: number) => { const d = Math.abs(a - b) % (2 * Math.PI); return Math.min(d, 2 * Math.PI - d); };
const deg = (r: number) => Math.round((r * 180) / Math.PI);
const at = (o: ObjectInstance): Pt => ({ x: o.position.x, y: o.position.z });
/** The rotation whose front points along `dir`. */
export const rotationFor = (dir: number) => { const r = dir - Math.PI / 2; return Math.atan2(Math.sin(r), Math.cos(r)); };

/** Distance from a point to an axis-agnostic footprint (rotated rectangle) of a piece. */
function distToFootprint(p: Pt, o: ObjectInstance, w: number, d: number): number {
  const c = at(o); const r = o.rotationY;
  const dx = p.x - c.x; const dy = p.y - c.y;
  const lx = dx * Math.cos(-r) - dy * Math.sin(-r); const ly = dx * Math.sin(-r) + dy * Math.cos(-r);
  const ex = Math.max(0, Math.abs(lx) - w / 2); const ey = Math.max(0, Math.abs(ly) - d / 2);
  return Math.hypot(ex, ey);
}

/** The point of a piece's footprint nearest to `p` (its centre when `p` is inside, or the piece is round). */
function nearestOnFootprint(p: Pt, o: ObjectInstance, w: number, d: number): Pt {
  const c = at(o); const r = o.rotationY;
  const dx = p.x - c.x; const dy = p.y - c.y;
  const lx = dx * Math.cos(-r) - dy * Math.sin(-r); const ly = dx * Math.sin(-r) + dy * Math.cos(-r);
  if (Math.abs(lx) <= w / 2 && Math.abs(ly) <= d / 2) return c;
  // A round (or square) table: its centre; a long one: the nearest point of its edge, moved in to the centre line.
  if (o.shape?.form === 'ROUND' || o.shape?.form === 'OVAL' || Math.abs(w - d) < 0.15) return c;
  const qx = Math.max(-w / 2, Math.min(w / 2, lx)) * (w > d ? 1 : 0);
  const qy = Math.max(-d / 2, Math.min(d / 2, ly)) * (d > w ? 1 : 0);
  return { x: c.x + qx * Math.cos(r) - qy * Math.sin(r), y: c.y + qx * Math.sin(r) + qy * Math.cos(r) };
}

const sizeOf = (o: ObjectInstance, asset: CatalogAsset | undefined) => ({
  w: o.shape?.widthM ?? asset?.widthM ?? 0.5, d: o.shape?.depthM ?? asset?.depthM ?? 0.5,
});

/** The room's wall faces as segments (the face looking into the room), each with its inward normal. */
function wallFaces(space: SpaceModel, roomId: string | null) {
  const faces: Array<{ a: Pt; b: Pt; inward: Pt }> = [];
  for (const wall of space.walls) {
    const f = wallFrame(wall.mesh);
    for (const seg of wall.segments) {
      if (roomId && seg.roomId !== roomId) continue;
      const n = seg.side === 'L' ? f.normalL : f.normalR;
      const off = wall.mesh.thicknessM / 2;
      const p = (u: number): Pt => ({ x: wall.mesh.start.x + f.dir.x * u + n.x * off, y: wall.mesh.start.y + f.dir.y * u + n.y * off });
      faces.push({ a: p(seg.from), b: p(seg.to), inward: n });
    }
  }
  return faces;
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x; const dy = b.y - a.y; const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/**
 * Which way each piece should face, from its context. Pieces without a front (tables, rugs, plants, lamps…)
 * have no expectation.
 */
export function expectedFacing(o: ObjectInstance, state: Pick<DesignState, 'objects'>, space: SpaceModel, assets: Map<string, CatalogAsset>): FacingExpectation | null {
  const type = typeOf(o, assets.get(o.assetId));
  const c = at(o);
  const others = state.objects.filter((x) => x.instanceId !== o.instanceId);
  const typed = others.map((x) => ({ x, type: typeOf(x, assets.get(x.assetId)), size: sizeOf(x, assets.get(x.assetId)) }));
  const toward = (p: Pt) => Math.atan2(p.y - c.y, p.x - c.x);

  if (SEATS_AT_TABLE.has(type) || (type === 'OUTDOOR_CHAIR')) {
    const tables = typed.filter((t) => TABLES.has(t.type) && (t.x.roomId === o.roomId || !o.roomId))
      .map((t) => ({ ...t, dist: distToFootprint(c, t.x, t.size.w, t.size.d) }))
      .filter((t) => t.dist <= TABLE_REACH_M).sort((a, b) => a.dist - b.dist);
    // Toward the table's nearest edge (a round table's is its centre): a chair at a long table looks across it.
    if (tables[0]) return { role: 'SEAT_AT_TABLE', dir: toward(nearestOnFootprint(c, tables[0].x, tables[0].size.w, tables[0].size.d)), strength: 'STRONG', basis: `table ${tables[0].x.instanceId}`, targetId: tables[0].x.instanceId };
    if (SEATS_AT_TABLE.has(type)) return null;
  }
  if (LOUNGE.has(type)) {
    const low = typed.filter((t) => LOW_TABLES.has(t.type) && t.x.roomId === o.roomId)
      .map((t) => ({ ...t, dist: Math.hypot(at(t.x).x - c.x, at(t.x).y - c.y) })).filter((t) => t.dist <= GROUP_REACH_M).sort((a, b) => a.dist - b.dist);
    // A side table at the seat's own elbow is not what it faces: the group's centre table is the larger one.
    const centre = low.filter((t) => t.type !== 'SIDE_TABLE')[0] ?? null;
    if (centre) return { role: 'LOUNGE_SEAT', dir: toward(at(centre.x)), strength: 'STRONG', basis: `table ${centre.x.instanceId}`, targetId: centre.x.instanceId };
    const screen = typed.filter((t) => SCREENS.has(t.type) && t.x.roomId === o.roomId)
      .map((t) => ({ ...t, dist: Math.hypot(at(t.x).x - c.x, at(t.x).y - c.y) })).filter((t) => t.dist <= SCREEN_REACH_M).sort((a, b) => a.dist - b.dist)[0];
    if (screen) return { role: 'LOUNGE_SEAT', dir: toward(at(screen.x)), strength: 'WEAK', basis: `screen ${screen.x.instanceId}`, targetId: screen.x.instanceId };
    // Seats gathered with others: toward the group's centre.
    const group = typed.filter((t) => LOUNGE.has(t.type) && t.x.roomId === o.roomId && Math.hypot(at(t.x).x - c.x, at(t.x).y - c.y) <= 3);
    if (group.length) {
      const g = group.reduce((s, t) => ({ x: s.x + at(t.x).x, y: s.y + at(t.x).y }), { x: c.x, y: c.y });
      return { role: 'LOUNGE_SEAT', dir: toward({ x: g.x / (group.length + 1), y: g.y / (group.length + 1) }), strength: 'WEAK', basis: 'seating group', targetId: null };
    }
  }
  if (type === 'BEDSIDE') {
    const bed = typed.filter((t) => BEDS.has(t.type) && t.x.roomId === o.roomId)
      .map((t) => ({ ...t, dist: distToFootprint(c, t.x, t.size.w, t.size.d) })).filter((t) => t.dist <= 0.6).sort((a, b) => a.dist - b.dist)[0];
    if (bed) { const f = frontOf(bed.x.rotationY); return { role: 'BEDSIDE', dir: Math.atan2(f.y, f.x), strength: 'STRONG', basis: `bed ${bed.x.instanceId}`, targetId: bed.x.instanceId }; }
  }
  if (AGAINST_WALL.has(type) || type === 'BEDSIDE' || type === 'TV' || LOUNGE.has(type)) {
    // The wall its back is nearest to (the back = the side opposite its current front, then any side).
    const size = sizeOf(o, assets.get(o.assetId));
    const faces = wallFaces(space, o.roomId);
    let best: { inward: Pt; d: number } | null = null;
    for (const f of faces) {
      const d = segDist(c, f.a, f.b);
      if (!best || d < best.d) best = { inward: f.inward, d };
    }
    // Its back stands within reach of that wall whichever way it is turned (depth/2 or width/2 from its centre).
    if (best && best.d <= Math.max(size.w, size.d) / 2 + WALL_REACH_M) {
      const strong = AGAINST_WALL.has(type) && best.d <= Math.min(size.w, size.d) / 2 + WALL_REACH_M;
      return { role: 'BACK_TO_WALL', dir: Math.atan2(best.inward.y, best.inward.x), strength: strong ? 'STRONG' : 'WEAK', basis: 'wall behind', targetId: null };
    }
  }
  return null;
}

/** Pieces whose front is plainly wrong for where they stand. */
/** How far a seat may be angled from what it faces before it counts as turned away (a chair set at an angle). */
export const SEAT_ANGLE_LIMIT = Math.PI / 3;
export const TABLE_SEAT_ANGLE_LIMIT = Math.PI / 6;

export function facingFindings(state: Pick<DesignState, 'objects'>, space: SpaceModel, assets: Map<string, CatalogAsset>): FacingFinding[] {
  const out: FacingFinding[] = [];
  for (const o of state.objects) {
    const e = expectedFacing(o, state, space, assets);
    if (!e || e.strength !== 'STRONG') continue;
    const f = frontOf(o.rotationY);
    const off = angleDiff(Math.atan2(f.y, f.x), e.dir);
    // A chair is drawn up to its table, looking at it (30° of play); a lounge seat may be set at an angle (60°).
    const limit = e.role === 'BACK_TO_WALL' || e.role === 'BEDSIDE' ? Math.PI / 4 : e.role === 'SEAT_AT_TABLE' ? TABLE_SEAT_ANGLE_LIMIT : SEAT_ANGLE_LIMIT;
    if (off <= limit) continue;
    out.push({
      instanceId: o.instanceId, type: typeOf(o, assets.get(o.assetId)), role: e.role,
      code: off >= (3 * Math.PI) / 4 ? 'REVERSED' : e.role === 'BACK_TO_WALL' ? 'FACES_WALL' : 'TURNED_AWAY', offDeg: deg(off), basis: e.basis,
    });
  }
  return out;
}

/**
 * Turn the pieces the context plainly contradicts to face as it says. A piece against a wall is squared to it;
 * a seat at a table looks at the table's centre (a round table's chairs fan round it, exactly as drawn). Pieces
 * that already agree, and every WEAK expectation, are left as the evidence put them.
 */
export function correctFacing(state: DesignState, space: SpaceModel, assets: Map<string, CatalogAsset>): { state: DesignState; corrections: FacingCorrection[] } {
  const corrections: FacingCorrection[] = [];
  const findings = new Map(facingFindings(state, space, assets).map((f) => [f.instanceId, f]));
  if (!findings.size) return { state, corrections };
  const objects = state.objects.map((o) => {
    if (!findings.has(o.instanceId)) return o;
    const e = expectedFacing(o, state, space, assets);
    if (!e) return o;
    const rotation = Math.round(rotationFor(e.dir) * 1e6) / 1e6;
    corrections.push({ instanceId: o.instanceId, type: findings.get(o.instanceId)!.type, fromDeg: deg(o.rotationY), toDeg: deg(rotation), basis: e.basis });
    return { ...o, rotationY: rotation };
  });
  return { state: { ...state, objects }, corrections };
}
