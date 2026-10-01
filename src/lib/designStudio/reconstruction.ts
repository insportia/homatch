// FROM WHAT HOMATCH SAW TO A DESIGN YOU CAN EDIT.
//
// The server reads the customer's images into a Reconstruction (see
// reconstructRead.ts): an estimated plan, and the pieces, surfaces and
// cameras it could see — each with a confidence and a basis. The customer
// reviews it and corrects what is wrong; then, deterministically:
//
//   plan      → the shared floor-plan generator (like a drawn plan), with
//               the same ESTIMATED / CALIBRATED / VERIFIED truth
//   pieces    → the closest HOMATCH catalogue piece of the same family,
//               scored on size, colour and style; the match, its score and
//               whether it is an APPROXIMATION are kept on the object
//   surfaces  → catalogue materials by colour and words, else the colour
//   camera    → "Match reference view": roughly where the picture was taken
//
// What a piece can DO in the walkthrough (a door that opens, a sofa to sit
// on) comes from the matched HOMATCH asset's own declarations — never from
// the pixels. Nothing here calls the network.

import { type Candidate, rank as rankAssets } from './catalogResolver.ts';
import type { CatalogAsset, CatalogMaterial } from './catalog.ts';
import { emptyDesignState, type DesignState, type ObjectInstance, type ObjectProvenance } from './designState.ts';
import { blocks, evaluatePlacement, rotationFacing, type PlacementContext } from './placement.ts';
import { shapedAsset, type ObjectShape } from './objectShape.ts';
import { buildWalkModel, findPath, isFree } from './navigation.ts';
import { pointInPolygon, roomContaining, wallFrame, type Point, type SpaceModel } from './space.ts';
import { floorPattern, type ObjectType, type Reconstruction, type ReconObject, type ReconRoomKind } from './reconstructRead.ts';

// ── Corrections the customer makes in review ──────────────────────────

export interface ReconCorrections {
  /** Room kinds corrected, by reconstruction room key. */
  roomKinds: Record<string, ReconRoomKind>;
  /** Rooms, openings and objects the customer said are wrong (by key). */
  rejected: string[];
  /** Object types corrected ("that is an armchair, not a sofa"). */
  objectTypes: Record<string, ObjectType>;
  /** A specific catalogue piece chosen for an object. */
  assetChoices: Record<string, string>;
  /** Objects the customer looked at and confirmed. AI never replaces these without asking. */
  confirmed: string[];
}

export const emptyCorrections = (): ReconCorrections => ({ roomKinds: {}, rejected: [], objectTypes: {}, assetChoices: {}, confirmed: [] });

export function normalizeCorrections(raw: unknown): ReconCorrections {
  const x = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rec = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, string> : {});
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').slice(0, 500) : []);
  return {
    roomKinds: rec(x.roomKinds) as Record<string, ReconRoomKind>,
    rejected: list(x.rejected),
    objectTypes: rec(x.objectTypes) as Record<string, ObjectType>,
    assetChoices: rec(x.assetChoices),
    confirmed: list(x.confirmed),
  };
}

// ── Catalogue matching ────────────────────────────────────────────────

/** Which catalogue family serves each recognised type. */
const FAMILY: Record<ObjectType, { category?: string; sub?: string[]; kinds?: string[] } | null> = {
  SOFA: { category: 'SOFA' },
  ARMCHAIR: { kinds: ['ARMCHAIR', 'RECLINER'] },
  CHAIR: { category: 'CHAIR', sub: ['DINING'] },
  OFFICE_CHAIR: { category: 'CHAIR', sub: ['OFFICE'] },
  BAR_STOOL: { category: 'CHAIR', sub: ['STOOL'] },
  DINING_TABLE: { category: 'TABLE', sub: ['DINING'] },
  COFFEE_TABLE: { category: 'TABLE', sub: ['COFFEE'] },
  SIDE_TABLE: { category: 'TABLE', sub: ['SIDE'] },
  DESK: { category: 'TABLE', sub: ['DESK'] },
  BED_DOUBLE: { category: 'BED', sub: ['DOUBLE'] },
  BED_SINGLE: { category: 'BED', sub: ['SINGLE'] },
  BEDSIDE: { sub: ['BEDSIDE'] },
  WARDROBE: { kinds: ['WARDROBE'] },
  DRESSER: { sub: ['DRESSER'] },
  SHELVING: { sub: ['SHELVING'] },
  TV_UNIT: { sub: ['MEDIA'] },
  TV: { sub: ['MEDIA'] },
  KITCHEN_RUN: { category: 'KITCHEN', sub: ['RUN'] },
  KITCHEN_ISLAND: { category: 'KITCHEN', sub: ['ISLAND'] },
  FRIDGE: { kinds: ['FRIDGE'] },
  RUG: { kinds: ['RUG'] },
  FLOOR_LAMP: { sub: ['FLOOR_LAMP'] },
  PLANT: { sub: ['PLANT'] },
  PLANTER: { sub: ['PLANTER'] },
  VANITY: { sub: ['VANITY'] },
  SHOWER: { kinds: ['SHOWER'] },
  TOILET: { kinds: ['TOILET'] },
  BATH: { kinds: ['BATH'] },
  WASHING_MACHINE: { kinds: ['WASHER'] },
  CURTAIN: { kinds: ['CURTAIN'] },
  BLIND: { kinds: ['BLIND'] },
  OUTDOOR_CHAIR: { category: 'OUTDOOR', sub: ['CHAIR'] },
  OUTDOOR_TABLE: { category: 'OUTDOOR', sub: ['TABLE'] },
  OUTDOOR_SOFA: { category: 'OUTDOOR', sub: ['SOFA'] },
  ARTWORK: null,
  DECOR: null,
  OTHER: null,
};

export interface AssetMatch {
  assetId: string;
  /** 0..1: how close the catalogue piece is to what was seen. */
  score: number;
  /** A GOOD match is the same family at close to the same size; anything else is an approximation. */
  quality: 'GOOD' | 'APPROXIMATE';
  colorOverride: string | null;
}

const inFamily = (a: CatalogAsset, f: NonNullable<typeof FAMILY[ObjectType]>) =>
  (!f.category || a.category === f.category)
  && (!f.sub || (a.subcategory !== null && f.sub.includes(a.subcategory)))
  && (!f.kinds || (a.procedural !== null && f.kinds.includes(a.procedural.kind)));

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  // A cheap perceptual weighting; 0 identical … ~1 opposite.
  return Math.sqrt(2 * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + 3 * (b1 - b2) ** 2) / 764.8;
}

/** Size agreement 0..1: 1 when the same, falling as the ratio grows (0.5 at twice or half). */
const sizeFit = (seen: number, have: number) => Math.min(Math.max(0.01, seen), Math.max(0.01, have)) / Math.max(Math.max(0.01, seen), Math.max(0.01, have));

/**
 * The closest catalogue piece for something seen. Same family only — a
 * sofa is never "matched" to a table because a table happened to be the
 * right size. Returns null when HOMATCH has nothing of that family.
 */
/**
 * What the reader calls an object → the catalogue's canonical subtypes that can stand for it.
 *
 * Kitchen boundary: cabinetry and built-ins (the kitchen run, the island) are
 * HOMATCH's own parametric generation, fitted to the measured wall; an
 * imported kitchen set never stands in for them. Movable pieces (appliances,
 * stools, the table) come from the catalogue.
 */
export const PARAMETRIC_ONLY: ReadonlySet<ObjectType> = new Set<ObjectType>(['KITCHEN_RUN', 'KITCHEN_ISLAND']);

export const CANONICAL_FOR: Partial<Record<ObjectType, string[]>> = {
  SOFA: ['SOFA', 'SECTIONAL_SOFA'], ARMCHAIR: ['ARMCHAIR'], CHAIR: ['CHAIR', 'DINING_CHAIR'], OFFICE_CHAIR: ['OFFICE_CHAIR'], BAR_STOOL: ['BAR_STOOL'],
  DINING_TABLE: ['DINING_TABLE'], COFFEE_TABLE: ['COFFEE_TABLE'], SIDE_TABLE: ['SIDE_TABLE'], DESK: ['DESK'], BEDSIDE: ['NIGHTSTAND'],
  BED_DOUBLE: ['BED'], BED_SINGLE: ['BED'], WARDROBE: ['WARDROBE'], DRESSER: ['DRESSER'], SHELVING: ['SHELVING', 'BOOKCASE'], TV_UNIT: ['TV_UNIT'], TV: ['TV'],
  FRIDGE: ['REFRIGERATOR'], WASHING_MACHINE: ['WASHING_MACHINE'],
  RUG: ['RUG'], FLOOR_LAMP: ['FLOOR_LAMP'], PLANT: ['PLANT'], PLANTER: ['PLANTER'], VANITY: ['VANITY'], SHOWER: ['SHOWER'], TOILET: ['TOILET'],
  BATH: ['BATHTUB'], CURTAIN: ['CURTAIN'], BLIND: ['BLIND'], ARTWORK: ['WALL_ART', 'FRAME'], DECOR: ['VASE', 'SCULPTURE', 'ORNAMENT'],
};

/**
 * The licensed library first: when imported assets of the right canonical
 * subtype exist, the Asset Resolver ranks them on what the picture showed —
 * type, size and proportion, colour, material, style, room — and returns ONE
 * canonical id. Otherwise the hand-made catalogue is matched as before.
 */
function matchImported(obj: Pick<ReconObject, 'type' | 'widthM' | 'depthM' | 'heightM' | 'color' | 'style'>, assets: CatalogAsset[], styleWords: string[]): AssetMatch | null {
  const subs = CANONICAL_FOR[obj.type];
  if (!subs) return null;
  const pool = assets.filter((a) => a.active && a.homatchAssetId && a.canonicalSubcategory && subs.includes(a.canonicalSubcategory));
  if (!pool.length) return null;
  const candidates: Candidate[] = pool.map((a) => ({
    homatchAssetId: a.code, kind: 'MODEL', sourceProvider: a.sourceProvider ?? 'homatch', canonicalCategory: a.canonicalCategory ?? '',
    canonicalSubcategory: a.canonicalSubcategory ?? '', styles: a.styleTags, colors: [...a.dominantColors, ...a.colorTags, ...(a.colorFamilies ?? [])],
    materials: a.materialTags, aliases: a.searchAliases ?? [], sizeM: { width: a.widthM, depth: a.depthM, height: a.heightM }, roomKinds: a.roomKinds,
    qualityTier: a.qualityTier ?? null, webSuitability: a.webSuitability ?? null, state: 'READY',
  }));
  const [best] = rankAssets({
    kind: 'MODEL', styles: [...styleWords, ...(obj.style ? [obj.style] : [])], color: obj.color ?? undefined,
    sizeM: { width: obj.widthM, depth: obj.depthM, height: obj.heightM },
  }, candidates, 1);
  if (!best) return null;
  const a = pool.find((x) => x.code === best.homatchAssetId) as CatalogAsset;
  const within = (seen: number, have: number) => Math.abs(seen - have) / Math.max(have, 0.01) <= 0.2;
  return { assetId: a.code, score: Math.round(best.score * 100) / 100, quality: within(obj.widthM, a.widthM) && within(obj.depthM, a.depthM) ? 'GOOD' : 'APPROXIMATE', colorOverride: null };
}

/**
 * Would this catalogue MODEL look like what the picture showed? A model is a
 * fixed object: it can only stand in for a piece of the same plain form,
 * close in colour and size. Otherwise HOMATCH draws the piece itself, at the
 * seen size, form and colours (and says it is an approximation) — a
 * "category-correct" model that looks nothing like the picture is not used.
 */
export function looksLike(obj: Pick<ReconObject, 'widthM' | 'depthM' | 'heightM' | 'color'> & { form?: ReconObject['form'] }, a: CatalogAsset): boolean {
  if (obj.form && obj.form !== 'STRAIGHT') return false;
  const near = (seen: number, have: number) => Math.abs(seen - have) / Math.max(have, 0.01) <= 0.25;
  if (!near(obj.widthM, a.widthM) || !near(obj.depthM, a.depthM) || !near(obj.heightM, a.heightM)) return false;
  const colours = [...a.dominantColors];
  if (!obj.color || !colours.length) return false;
  return Math.min(...colours.map((c) => colorDistance(obj.color as string, c))) <= 0.12;
}

export function matchAsset(obj: Pick<ReconObject, 'type' | 'widthM' | 'depthM' | 'heightM' | 'color' | 'style'> & { form?: ReconObject['form'] }, assets: CatalogAsset[], styleWords: string[] = []): AssetMatch | null {
  const imported = matchImported(obj, assets, styleWords);
  if (imported) {
    const model = assets.find((a) => a.code === imported.assetId);
    if (model && looksLike(obj, model)) return imported;
  }
  const family = FAMILY[obj.type];
  if (!family) return null;
  const candidates = assets.filter((a) => a.active && inFamily(a, family));
  if (!candidates.length) return null;
  const words = new Set([...styleWords, ...(obj.style ? [obj.style] : [])].map((w) => w.toLowerCase()));
  let best: { a: CatalogAsset; score: number; size: number } | null = null;
  for (const a of candidates) {
    const size = (sizeFit(obj.widthM, a.widthM) * 2 + sizeFit(obj.depthM, a.depthM) + sizeFit(obj.heightM, a.heightM)) / 4;
    const colour = obj.color && a.dominantColors[0] ? 1 - colorDistance(obj.color, a.dominantColors[0]) : 0.5;
    const style = words.size && a.styleTags.some((t) => words.has(t.toLowerCase())) ? 1 : 0.5;
    const score = size * 0.7 + colour * 0.15 + style * 0.15;
    if (!best || score > best.score || (score === best.score && a.code < best.a.code)) best = { a, score, size };
  }
  if (!best) return null;
  const within = (seen: number, have: number) => Math.abs(seen - have) / Math.max(have, 0.01) <= 0.2;
  const good = within(obj.widthM, best.a.widthM) && within(obj.depthM, best.a.depthM);
  // Wear the colour that was seen when the piece's own is noticeably different.
  const main = best.a.materialSlots.find((s) => s.id === 'body' || s.id === 'top' || s.id === 'pot');
  const colorOverride = obj.color && main && colorDistance(obj.color, main.defaultColor) > 0.06 ? obj.color : null;
  return { assetId: best.a.code, score: Math.round(best.score * 100) / 100, quality: good ? 'GOOD' : 'APPROXIMATE', colorOverride };
}

// ── Building the design ───────────────────────────────────────────────

export interface BuildReport {
  placed: Array<{ key: string; instanceId: string; assetId: string; quality: AssetMatch['quality']; moved: number }>;
  /** Seen, but HOMATCH has no catalogue family for it yet (artwork, a washing machine…). */
  unmatched: Array<{ key: string; type: ObjectType; label: string }>;
  /** Matched, but no legal place for it could be found near where it was seen. */
  unplaced: Array<{ key: string; assetId: string }>;
  surfaces: number;
}

/** Degrees clockwise from north (what the reader reports) → the design's rotation. */
export const rotationFromFacing = (deg: number) => {
  const r = -(deg * Math.PI) / 180;
  return Math.atan2(Math.sin(r), Math.cos(r));
};

/** A legal spot, clear of every door, as close as possible to where the piece was seen (spiral search, 5 cm steps). */
/**
 * How much a rebuilt piece may give way to where it was seen:
 *   CLEAR   nothing in its way — no wall, no other piece, no door's swing;
 *   DOORWAY the picture shows it in a door's swing zone (a terrace chair by the
 *           glazing): allowed, still never through a wall or into a piece;
 *   TOUCH   as a last resort, a little overlap with a neighbour (the reading
 *           is a few centimetres off) rather than an empty spot in the picture.
 */
type Give = 'CLEAR' | 'DOORWAY' | 'TOUCH';

/** A legal spot as close as possible to where the piece was seen (spiral search, 5 cm steps). */
function legalSpot(
  ctx: PlacementContext, asset: CatalogAsset, at: Point, rotation: number, roomId: string | null, stayIn: string | null = null, give: Give = 'CLEAR', reach = 1.5,
  passable: (p: Point, roomId: string, doorIds: string[]) => boolean = () => true,
): { at: Point; roomId: string } | null {
  const own = stayIn ? ctx.space.rooms.find((r) => r.id === stayIn) ?? null : null;
  const tryAt = (p: Point) => {
    // A piece the reader put in a room stays in that room.
    if (own && !pointInPolygon(p, own.polygon)) return null;
    const room = own ? own.id : roomContaining(ctx.space, p) ?? roomId;
    if (!room) return null;
    const issues = evaluatePlacement(ctx, asset, p, rotation, room);
    if (blocks(issues)) return null;
    if (give !== 'TOUCH' && issues.some((i) => i.code === 'OVERLAPS_OBJECT')) return null;
    // A rebuilt home stays walkable: a piece read in front of a door is shifted clear of it when it can
    // be, and is only ever left in a door's zone when people can still walk through that door.
    const doors = issues.filter((i) => i.code === 'BLOCKS_DOOR').map((i) => i.relatedId).filter((id): id is string => !!id);
    if (doors.length && give === 'CLEAR') return null;
    if (!passable(p, room, doors)) return null;
    return { at: p, roomId: room };
  };
  // Walkability is checked on the legal spots only, and only so many times (it walks the home).
  let probes = 0;
  const guarded = passable;
  passable = (p, room, doors) => (probes += 1) <= 60 && guarded(p, room, doors);
  const first = tryAt(at);
  if (first) return first;
  for (let r = 0.05; r <= reach + 1e-9 && probes <= 60; r += 0.05) {
    const n = Math.max(8, Math.round((2 * Math.PI * r) / 0.05));
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2;
      const hit = tryAt({ x: Math.round((at.x + Math.cos(a) * r) * 1000) / 1000, y: Math.round((at.y + Math.sin(a) * r) * 1000) / 1000 });
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Can a person still get between the rooms these doors join, with the
 * furniture as it would stand? A pair of rooms joined by several doors (a
 * terrace along a row of glazed doors) only needs one of them free; a side
 * that is not in any room (the outside of an entrance door) only needs to be
 * clear.
 */
export function doorsPassable(space: SpaceModel, assets: Map<string, CatalogAsset>, objects: ObjectInstance[], doorIds: string[]): boolean {
  if (!doorIds.length) return true;
  const model = buildWalkModel(space, objects, assets);
  const sidesOf = (id: string) => {
    const door = space.doors.find((d) => d.id === id);
    const wall = door ? space.walls.find((w) => w.id === door.wallId) : null;
    if (!door || !wall) return null;
    const n = wallFrame(wall.mesh).normalL;
    return [1, -1].map((k) => ({ x: door.centre.x + n.x * 0.42 * k, y: door.centre.y + n.y * 0.42 * k }))
      .map((p) => ({ p, room: space.rooms.find((r) => pointInPolygon(p, r.polygon))?.id ?? null }))
      .filter((x) => x.room);
  };
  const usable = (id: string) => {
    const sides = sidesOf(id);
    if (!sides) return true;
    if (sides.some((x) => !isFree(model, x.p))) return false;
    return sides.length < 2 || !!findPath(model, sides[0].p, sides[1].p, { throughDoors: true, maxCells: 1500 });
  };
  const pair = (id: string) => (sidesOf(id) ?? []).map((x) => x.room).sort().join('|');
  for (const id of doorIds) {
    if (usable(id)) continue;
    // Another door between the same two rooms will do.
    const between = pair(id);
    if (!between.includes('|') || !space.doors.some((d) => d.id !== id && pair(d.id) === between && usable(d.id))) return false;
  }
  return true;
}

/** The point inside `poly` nearest to `p`, `margin` in from the edge (p itself when it is already inside). */
export function nearestInside(poly: Point[], p: Point, margin: number): Point {
  if (pointInPolygon(p, poly)) return p;
  let best: { q: Point; d: number; n: Point } | null = null;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x; const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    const len = Math.sqrt(l2);
    if (!best || d < best.d) best = { q, d, n: { x: -dy / len, y: dx / len } };
  }
  if (!best) return p;
  for (const s of [1, -1]) {
    const c = { x: best.q.x + best.n.x * s * margin, y: best.q.y + best.n.y * s * margin };
    if (pointInPolygon(c, poly)) return c;
  }
  return best.q;
}

const ORDER: ObjectType[] = [
  // Big fixed things first, so smaller pieces find their place around them.
  'KITCHEN_RUN', 'KITCHEN_ISLAND', 'FRIDGE', 'WARDROBE', 'SHOWER', 'BATH', 'VANITY', 'TOILET', 'BED_DOUBLE', 'BED_SINGLE',
  'SOFA', 'OUTDOOR_SOFA', 'TV_UNIT', 'TV', 'DINING_TABLE', 'DESK', 'SHELVING', 'DRESSER',
];
const rank = (t: ObjectType) => { const i = ORDER.indexOf(t); return i < 0 ? ORDER.length : i; };

/**
 * The reconstruction, as a design over a built space. `scale` carries a
 * calibration onto the positions (1 while ESTIMATED). Deterministic: the
 * same reconstruction, corrections and catalogue give the same design.
 */
export function buildDesign(
  recon: Reconstruction, corrections: ReconCorrections, space: SpaceModel, assets: CatalogAsset[],
  materials: CatalogMaterial[], options: { scale?: number; roomIdOf?: (key: string) => string; referenceImageIds?: string[] } = {},
): { state: DesignState; report: BuildReport } {
  const scale = options.scale ?? 1;
  const roomIdOf = options.roomIdOf ?? ((k: string) => `r-${k}`);
  const byCode = new Map(assets.map((a) => [a.code, a]));
  const state = emptyDesignState();
  const report: BuildReport = { placed: [], unmatched: [], unplaced: [], surfaces: 0 };
  const ctx: PlacementContext = { space, assets: byCode, objects: state.objects };
  const rejected = new Set(corrections.rejected);
  const confirmed = new Set(corrections.confirmed);

  const objects = recon.objects
    .filter((o) => !rejected.has(o.key) && !(o.room && rejected.has(o.room)))
    .map((o) => ({ ...o, type: corrections.objectTypes[o.key] ?? o.type }))
    .sort((a, b) => rank(a.type) - rank(b.type) || a.key.localeCompare(b.key));

  let n = 0;
  for (const o of objects) {
    const chosen = corrections.assetChoices[o.key] ? byCode.get(corrections.assetChoices[o.key]) : undefined;
    const match: AssetMatch | null = chosen
      ? { assetId: chosen.code, score: 1, quality: 'GOOD', colorOverride: o.color && chosen.materialSlots[0] && colorDistance(o.color, chosen.materialSlots[0].defaultColor) > 0.06 ? o.color : null }
      : matchAsset(o, assets, recon.styleWords);
    if (!match) { report.unmatched.push({ key: o.key, type: o.type, label: o.label }); continue; }
    const own = byCode.get(match.assetId)!;
    // What was seen: the piece is drawn and placed at that size (objectShape.ts).
    const shape: ObjectShape = {
      widthM: o.widthM, depthM: o.depthM, heightM: o.heightM,
      form: o.form ?? null, secondary: o.secondaryColor ?? null,
    };
    const asset = shapedAsset(own, { shape });
    const hint = o.room ? roomIdOf(o.room) : null;
    const hintInSpace = hint && space.rooms.some((r) => r.id === hint) ? hint : null;
    const seen0 = { x: o.at[0] * scale, y: o.at[1] * scale };
    // As read first; a long piece that cannot stand that way (a sofa read across a
    // narrow terrace) is tried a quarter turn round, then the other way round.
    let spot: { at: Point; roomId: string } | null = null;
    let rotation = 0;
    const read = rotationFromFacing(o.facingDeg);
    // Standing as seen in a door's zone is allowed only while that door can still be walked through.
    const probe = (rot: number) => (p: Point, roomId: string, doors: string[]) => doorsPassable(space, byCode, [...state.objects, {
      instanceId: '__probe', assetId: own.code, roomId, position: { x: p.x, y: 0, z: p.y }, rotationY: rot, materialVariant: null, colorOverride: null, locked: false, shape,
    }], doors);
    for (const turn of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
      const pose = settle(space, asset, o.type, hintInSpace, seen0, read + turn);
      const roomFor = hintInSpace ?? nearestRoom(space, pose.at);
      spot = legalSpot(ctx, asset, pose.at, pose.rotation, roomFor, hintInSpace, 'CLEAR', 0.35)
        ?? legalSpot(ctx, asset, pose.at, pose.rotation, roomFor, hintInSpace, 'DOORWAY', 1.0, probe(pose.rotation))
        ?? legalSpot(ctx, asset, pose.at, pose.rotation, roomFor, hintInSpace, 'TOUCH', 0.3, probe(pose.rotation));
      rotation = pose.rotation;
      if (spot) break;
    }
    // Last: anywhere legal near where it was seen (never through a wall), every way round — still
    // keeping the doors usable; then, for a piece the room is about (a bed, a sofa, the kitchen…),
    // even where it narrows a passage. A small piece that could only stand in a doorway is left out
    // (and reported), so every door stays usable.
    for (const last of ESSENTIAL.has(o.type) ? [true, false] : [true]) {
      for (const turn of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
        if (spot) break;
        const pose = settle(space, asset, o.type, hintInSpace, seen0, read + turn);
        spot = legalSpot(ctx, asset, pose.at, pose.rotation, hintInSpace ?? nearestRoom(space, pose.at), hintInSpace, 'TOUCH', 1.5, last ? probe(pose.rotation) : undefined);
        rotation = pose.rotation;
      }
    }
    if (!spot) { report.unplaced.push({ key: o.key, assetId: own.code }); continue; }
    n += 1;
    const provenance: ObjectProvenance = {
      source: 'IMAGE_RECONSTRUCTION',
      ref: o.key,
      label: o.label,
      detectedType: o.type,
      images: (options.referenceImageIds ?? []).length ? o.seenIn.map((i) => options.referenceImageIds![i]).filter(Boolean) : [],
      confidence: o.confidence,
      basis: o.basis,
      match: match.score,
      approximate: match.quality === 'APPROXIMATE',
      confirmed: confirmed.has(o.key),
    };
    const instance: ObjectInstance = {
      instanceId: `rc-${n}-${o.key}`.slice(0, 60),
      assetId: own.code,
      roomId: spot.roomId,
      position: { x: spot.at.x, y: 0, z: spot.at.y },
      rotationY: Math.round(rotation * 1e6) / 1e6,
      materialVariant: null,
      // A piece HOMATCH draws wears the colour that was seen; a model keeps its own unless it is clearly different.
      colorOverride: own.procedural ? o.color ?? match.colorOverride : match.colorOverride,
      locked: false,
      provenance,
      shape,
    };
    state.objects.push(instance);
    report.placed.push({ key: o.key, instanceId: instance.instanceId, assetId: own.code, quality: match.quality, moved: Math.round(Math.hypot(spot.at.x - seen0.x, spot.at.y - seen0.y) * 100) / 100 });
  }

  // Surfaces: a catalogue material when one is close in colour and kind, else the colour itself.
  for (const s of recon.surfaces) {
    if (rejected.has(s.room)) continue;
    const roomId = roomIdOf(s.room);
    if (!space.rooms.some((r) => r.id === roomId)) continue;
    const ids = space.surfaces.filter((x) => x.roomId === roomId && x.kind === (s.part === 'FLOOR' ? 'FLOOR' : 'WALL')).map((x) => x.id);
    if (!ids.length || !s.color) continue;
    // Readings stored before the code existed (or that gave no code) still say what they saw.
    const pattern = s.part === 'FLOOR' ? floorPattern(s.pattern ?? null, s.material) : null;
    // A textured catalogue material of the kind that was seen, balanced to the seen colour;
    // else a hand-made one close in colour; else the colour itself.
    const textured = chooseSurfaceMaterial(s.part === 'FLOOR' ? 'FLOOR' : 'WALL', s.color, s.material, pattern, materials);
    const mat = textured ?? matchMaterial(s.part === 'FLOOR' ? 'FLOOR' : 'WALL', s.color, s.material, materials);
    for (const id of ids) {
      state.surfaces[id] = {
        materialId: mat?.id ?? null, color: mat ? null : s.color, finish: null, locked: false,
        ...(textured ? { tint: s.color } : {}),
        ...(s.part === 'FLOOR' && pattern ? { pattern } : {}),
      };
    }
    report.surfaces += ids.length;
  }
  state.palette = recon.palette.slice(0, 6);
  if (recon.frameColor) state.frames = recon.frameColor;
  return { state, report };
}

/** What a room is about: placed even where it narrows a passage, rather than left out. */
const ESSENTIAL: ReadonlySet<ObjectType> = new Set<ObjectType>(['SOFA', 'BED_DOUBLE', 'BED_SINGLE', 'WARDROBE', 'KITCHEN_RUN', 'KITCHEN_ISLAND', 'FRIDGE', 'DINING_TABLE', 'DESK', 'SHOWER', 'BATH', 'TOILET', 'VANITY', 'OUTDOOR_SOFA']);

/** Pieces that stand with their back to a wall. */
const AGAINST_WALL: ReadonlySet<ObjectType> = new Set<ObjectType>(['SOFA', 'BED_DOUBLE', 'BED_SINGLE', 'WARDROBE', 'DRESSER', 'SHELVING', 'TV_UNIT', 'KITCHEN_RUN', 'FRIDGE', 'VANITY', 'BEDSIDE', 'DESK', 'WASHING_MACHINE', 'TOILET', 'BATH', 'OUTDOOR_SOFA', 'PLANTER']);
/** How far (m) a piece's back may be from a wall and still be read as standing against it. */
const WALL_REACH_M = 0.6;

/**
 * Where a piece settles, from where it was seen: inside the room the reader
 * put it in; squared to the room when it is nearly square to it; and, for a
 * piece that stands against a wall, back to the wall BEHIND it (the one it
 * faces away from) — a reading is a few centimetres off, a sofa is not.
 */
export function settle(space: SpaceModel, asset: Pick<CatalogAsset, 'widthM' | 'depthM'>, type: ObjectType, roomId: string | null, at: Point, rotation: number): { at: Point; rotation: number } {
  const room = roomId ? space.rooms.find((r) => r.id === roomId) : null;
  let p: Point = { ...at };
  // Into the reader's room, at the nearest point, when the trace landed just outside it.
  if (room) p = nearestInside(room.polygon, p, Math.min(asset.widthM, asset.depthM) / 2 + 0.02);
  // Square to the walls when within 12 degrees of square.
  let r = rotation;
  const quarter = Math.round(r / (Math.PI / 2)) * (Math.PI / 2);
  if (Math.abs(r - quarter) < (12 * Math.PI) / 180) r = quarter;
  const free = { at: p, rotation: Math.atan2(Math.sin(r), Math.cos(r)) };
  if (!room || !AGAINST_WALL.has(type)) return free;
  const front = { x: -Math.sin(r), y: Math.cos(r) };
  let best: { at: Point; rotation: number; d: number } | null = null;
  for (const wall of space.walls) {
    const f = wallFrame(wall.mesh);
    for (const seg of wall.segments) {
      if (seg.roomId !== room.id) continue;
      const inward = seg.side === 'L' ? f.normalL : f.normalR;
      // The wall behind the piece: the piece faces away from it (into the room).
      if (inward.x * front.x + inward.y * front.y < 0.7) continue;
      const rel = { x: p.x - wall.mesh.start.x, y: p.y - wall.mesh.start.y };
      const u = rel.x * f.dir.x + rel.y * f.dir.y;
      if (u < seg.from - 0.2 || u > seg.to + 0.2) continue;
      const back = rel.x * inward.x + rel.y * inward.y - wall.mesh.thicknessM / 2 - asset.depthM / 2;
      if (back > WALL_REACH_M || back < -WALL_REACH_M) continue;
      const half = Math.min(asset.widthM / 2, (seg.to - seg.from) / 2);
      const cu = Math.min(seg.to - half, Math.max(seg.from + half, u));
      const off = wall.mesh.thicknessM / 2 + asset.depthM / 2 + 0.01;
      const cand = { at: { x: wall.mesh.start.x + f.dir.x * cu + inward.x * off, y: wall.mesh.start.y + f.dir.y * cu + inward.y * off }, rotation: rotationFacing(inward), d: Math.abs(back) };
      if (!best || cand.d < best.d) best = cand;
    }
  }
  if (!best) {
    // No wall behind it (a terrace's railing, an open side): it backs onto the room's own edge.
    const poly = room.polygon;
    const area = poly.reduce((acc, q, i) => { const r = poly[(i + 1) % poly.length]; return acc + q.x * r.y - r.x * q.y; }, 0);
    const turn = area >= 0 ? 1 : -1;
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i]; const b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.3) continue;
      const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      // Inward is the left of each edge for a counter-clockwise outline (the right for a clockwise one).
      const inward = { x: -dir.y * turn, y: dir.x * turn };
      if (inward.x * front.x + inward.y * front.y < 0.7) continue;
      const rel = { x: p.x - a.x, y: p.y - a.y };
      const u = rel.x * dir.x + rel.y * dir.y;
      if (u < -0.2 || u > len + 0.2) continue;
      const back = rel.x * inward.x + rel.y * inward.y - asset.depthM / 2;
      // A railing is a lighter line to read against than a wall: a little more reach.
      if (back > WALL_REACH_M * 1.5 || back < -WALL_REACH_M) continue;
      const half = Math.min(asset.widthM / 2, len / 2);
      const cu = Math.min(len - half, Math.max(half, u));
      const off = asset.depthM / 2 + 0.06;
      const cand = { at: { x: a.x + dir.x * cu + inward.x * off, y: a.y + dir.y * cu + inward.y * off }, rotation: rotationFacing(inward), d: Math.abs(back) };
      if (!best || cand.d < best.d) best = cand;
    }
  }
  return best ? { at: best.at, rotation: best.rotation } : free;
}

function nearestRoom(space: SpaceModel, p: Point): string | null {
  const inside = space.rooms.find((r) => pointInPolygon(p, r.polygon));
  if (inside) return inside.id;
  let best: { id: string; d: number } | null = null;
  for (const r of space.rooms) {
    const d = Math.hypot(r.centroid.x - p.x, r.centroid.y - p.y);
    if (!best || d < best.d) best = { id: r.id, d };
  }
  return best?.id ?? null;
}

const WORDS: Record<string, string[]> = {
  WOOD: ['oak', 'wood', 'walnut', 'parquet', 'herringbone', 'timber', 'decking', 'ash', 'pine'],
  STONE: ['stone', 'marble', 'granite', 'travertine', 'concrete', 'terrazzo'],
  TILE: ['tile', 'ceramic', 'porcelain'],
  PAINT: ['paint', 'painted', 'plaster'],
};

/** What a seen surface is made of, from its pattern code first and its words second. */
const KIND_OF_PATTERN: Record<string, string> = { WOOD_HERRINGBONE: 'WOOD', WOOD_PLANK: 'WOOD', TILE: 'TILE', STONE: 'STONE', CONCRETE: 'STONE', CARPET: 'CARPET' };
/** Words that pick the right texture within a kind (any language the reader writes is reduced to these by the pattern code). */
const PATTERN_WORDS_EN: Record<string, string[]> = {
  // "Parquet" alone is not herringbone (rectangular parquet is a plank layout).
  WOOD_HERRINGBONE: ['herringbone', 'chevron', 'fishbone'],
  WOOD_PLANK: ['plank', 'floor boards', 'flooring', 'laminate', 'wood floor'],
  TILE: ['tile', 'tiles', 'ceramic', 'porcelain'],
  STONE: ['stone', 'marble', 'granite', 'travertine', 'terrazzo'],
  CONCRETE: ['concrete', 'cement'],
  CARPET: ['carpet', 'rug', 'fabric'],
};
/** A texture that looks used or outdoors does not stand for a clean interior finish unless the reading says so. */
const WORN = ['weathered', 'damaged', 'dirty', 'mossy', 'cracked', 'broken', 'rough', 'old', 'rusty', 'worn', 'stained', 'moss', 'decayed'];

/** A colour family for a seen colour (the words imported materials are tagged with). */
export function colourFamily(hex: string): string {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  const l = (max + min) / 2; const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  if (sat < 0.12) return l > 0.82 ? 'WHITE' : l < 0.2 ? 'BLACK' : 'GRAY';
  let h = 0;
  if (max === r) h = ((g - b) / (max - min)) % 6; else if (max === g) h = (b - r) / (max - min) + 2; else h = (r - g) / (max - min) + 4;
  h = (h * 60 + 360) % 360;
  if (h < 15 || h >= 345) return 'RED';
  if (h < 45) return l > 0.6 && sat < 0.5 ? 'BEIGE' : 'BROWN';
  if (h < 65) return 'YELLOW';
  if (h < 170) return 'GREEN';
  if (h < 260) return 'BLUE';
  return 'PURPLE';
}

/**
 * A TEXTURED catalogue material (an imported one, whose look is in its maps)
 * for a surface the picture showed: of the same kind (herringbone is
 * herringbone, tile is tile), the best fit to what was seen, clean unless the
 * reading said otherwise. Painted walls keep a flat colour (a plaster texture
 * is not paint). Null when nothing of that kind is good enough.
 */
export function chooseSurfaceMaterial(applies: 'FLOOR' | 'WALL', color: string, words: string | null, pattern: string | null, materials: CatalogMaterial[]): CatalogMaterial | null {
  const w = (words ?? '').toLowerCase();
  const kind = (pattern && KIND_OF_PATTERN[pattern]) ?? Object.entries(WORDS).find(([, list]) => list.some((x) => w.includes(x)))?.[0] ?? null;
  if (!kind || kind === 'PAINT') return null;
  const wanted = pattern ? PATTERN_WORDS_EN[pattern] ?? [] : [];
  const family = colourFamily(color);
  let best: { m: CatalogMaterial; score: number } | null = null;
  for (const m of materials) {
    if (!m.active || !m.appliesTo.includes(applies) || !m.pbr?.maps?.albedo) continue;
    const text = `${m.name} ${m.category} ${(m.aliases ?? []).join(' ')}`.toLowerCase();
    const isKind = kind === 'TILE' ? /tile/.test(text) : kind === 'CARPET' ? /carpet|rug|fabric/.test(text) : kind === 'STONE' ? /stone|marble|granite|concrete|terrazzo|travertine/.test(text) : /wood|parquet|plank|timber|oak/.test(text);
    if (!isKind) continue;
    let score = 1;
    for (const t of wanted) if (text.includes(t)) score += 3;
    for (const t of w.split(/[^a-z]+/).filter((x) => x.length > 2)) if (text.includes(t)) score += 1;
    if (WORN.some((t) => text.includes(t)) && !WORN.some((t) => w.includes(t))) score -= 4;
    if ((m.colorFamilies ?? []).includes(family)) score += 1;
    if (/outdoor|exterior|roof/.test(text) && applies === 'WALL') score -= 2;
    if (!best || score > best.score || (score === best.score && m.code < best.m.code)) best = { m, score };
  }
  // The pattern itself must be there when one was seen (a herringbone floor is never given planks).
  if (!best || best.score < (wanted.length ? 4 : 2)) return null;
  return best.m;
}

/** A catalogue material for a surface, only when it is genuinely close in colour (and kind, when words say one). */
export function matchMaterial(applies: 'FLOOR' | 'WALL', color: string, words: string | null, materials: CatalogMaterial[]): CatalogMaterial | null {
  const w = (words ?? '').toLowerCase();
  const family = Object.entries(WORDS).find(([, list]) => list.some((x) => w.includes(x)))?.[0] ?? null;
  let best: { m: CatalogMaterial; d: number } | null = null;
  for (const m of materials) {
    if (!m.active || !m.appliesTo.includes(applies)) continue;
    if (family && !`${m.category} ${m.name} ${m.code}`.toUpperCase().includes(family)) continue;
    const d = colorDistance(color, m.pbr.baseColor);
    if (!best || d < best.d) best = { m, d };
  }
  return best && best.d <= 0.08 ? best.m : null;
}

// ── The reference camera ──────────────────────────────────────────────

/**
 * Where the picture was taken, as a camera over the built space (three.js
 * world: x, height, −plan y). Approximate by nature: it lets the customer
 * look at the reconstruction from about where the picture looks from.
 */
export function referenceCamera(recon: Reconstruction, image: number, scale = 1): { position: [number, number, number]; target: [number, number, number]; fov: number } | null {
  const cam = recon.cameras.find((c) => c.image === image) ?? recon.cameras[0];
  if (!cam) return null;
  const yaw = (cam.yawDeg * Math.PI) / 180;
  const pitch = (cam.pitchDeg * Math.PI) / 180;
  const pos = { x: cam.at[0] * scale, y: cam.at[1] * scale, h: cam.heightM };
  // Look along yaw (clockwise from north) and pitch, out to where the ray meets the floor (or 10 m).
  const dir = { x: Math.sin(yaw) * Math.cos(pitch), y: Math.cos(yaw) * Math.cos(pitch), z: Math.sin(pitch) };
  const t = dir.z < -0.05 ? Math.min(60, pos.h / -dir.z) : 10;
  const target = { x: pos.x + dir.x * t, y: pos.y + dir.y * t, h: Math.max(0, pos.h + dir.z * t) };
  return { position: [pos.x, pos.h, -pos.y], target: [target.x, target.h, -target.y], fov: cam.fovDeg };
}

/** What the review shows about a piece's match, without the maths. */
export function matchSummary(recon: Reconstruction, corrections: ReconCorrections, assets: CatalogAsset[]): Array<{ key: string; type: ObjectType; label: string; match: AssetMatch | null; confidence: number; basis: string; rejected: boolean }> {
  const rejected = new Set(corrections.rejected);
  const byCode = new Map(assets.map((a) => [a.code, a]));
  return recon.objects.map((o) => {
    const type = corrections.objectTypes[o.key] ?? o.type;
    const chosen = corrections.assetChoices[o.key] ? byCode.get(corrections.assetChoices[o.key]) : undefined;
    const match = chosen ? { assetId: chosen.code, score: 1, quality: 'GOOD' as const, colorOverride: null } : matchAsset({ ...o, type }, assets, recon.styleWords);
    return { key: o.key, type, label: o.label, match, confidence: o.confidence, basis: o.basis, rejected: rejected.has(o.key) };
  });
}

/** Catalogue pieces a customer may choose instead, for a type (same family). */
export function alternativesFor(type: ObjectType, assets: CatalogAsset[]): CatalogAsset[] {
  const f = FAMILY[type];
  return f ? assets.filter((a) => a.active && inFamily(a, f)) : [];
}
