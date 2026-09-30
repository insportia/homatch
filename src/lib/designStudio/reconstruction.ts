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
import { blocks, evaluatePlacement, type PlacementContext } from './placement.ts';
import { pointInPolygon, roomContaining, type Point, type SpaceModel } from './space.ts';
import type { ObjectType, Reconstruction, ReconObject, ReconRoomKind } from './reconstructRead.ts';

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
/** What the reader calls an object → the catalogue's canonical subtypes that can stand for it. */
export const CANONICAL_FOR: Partial<Record<ObjectType, string[]>> = {
  SOFA: ['SOFA', 'SECTIONAL_SOFA'], ARMCHAIR: ['ARMCHAIR'], CHAIR: ['CHAIR', 'DINING_CHAIR'], OFFICE_CHAIR: ['OFFICE_CHAIR'], BAR_STOOL: ['BAR_STOOL'],
  DINING_TABLE: ['DINING_TABLE'], COFFEE_TABLE: ['COFFEE_TABLE'], SIDE_TABLE: ['SIDE_TABLE'], DESK: ['DESK'], BEDSIDE: ['NIGHTSTAND'],
  BED_DOUBLE: ['BED'], BED_SINGLE: ['BED'], WARDROBE: ['WARDROBE'], DRESSER: ['DRESSER'], SHELVING: ['SHELVING', 'BOOKCASE'], TV_UNIT: ['TV_UNIT'], TV: ['TV'],
  KITCHEN_RUN: ['KITCHEN_UNIT', 'KITCHEN_SET'], KITCHEN_ISLAND: ['KITCHEN_ISLAND'], FRIDGE: ['REFRIGERATOR'], WASHING_MACHINE: ['WASHING_MACHINE'],
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

export function matchAsset(obj: Pick<ReconObject, 'type' | 'widthM' | 'depthM' | 'heightM' | 'color' | 'style'>, assets: CatalogAsset[], styleWords: string[] = []): AssetMatch | null {
  const imported = matchImported(obj, assets, styleWords);
  if (imported) return imported;
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
function legalSpot(ctx: PlacementContext, asset: CatalogAsset, at: Point, rotation: number, roomId: string | null): { at: Point; roomId: string } | null {
  const tryAt = (p: Point) => {
    const room = roomContaining(ctx.space, p) ?? roomId;
    if (!room) return null;
    const issues = evaluatePlacement(ctx, asset, p, rotation, room);
    // A rebuilt home must stay walkable: a piece read in front of a door is
    // shifted clear of it, not left in the way (the shift is reported).
    return blocks(issues) || issues.some((i) => i.code === 'BLOCKS_DOOR') ? null : { at: p, roomId: room };
  };
  const first = tryAt(at);
  if (first) return first;
  for (let r = 0.05; r <= 0.9 + 1e-9; r += 0.05) {
    const n = Math.max(8, Math.round((2 * Math.PI * r) / 0.05));
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2;
      const hit = tryAt({ x: Math.round((at.x + Math.cos(a) * r) * 1000) / 1000, y: Math.round((at.y + Math.sin(a) * r) * 1000) / 1000 });
      if (hit) return hit;
    }
  }
  return null;
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
    const asset = byCode.get(match.assetId)!;
    const seen = { x: o.at[0] * scale, y: o.at[1] * scale };
    const rotation = rotationFromFacing(o.facingDeg);
    const hint = o.room ? roomIdOf(o.room) : null;
    const hintInSpace = hint && space.rooms.some((r) => r.id === hint) ? hint : null;
    const spot = legalSpot(ctx, asset, seen, rotation, hintInSpace ?? nearestRoom(space, seen));
    if (!spot) { report.unplaced.push({ key: o.key, assetId: asset.code }); continue; }
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
      assetId: asset.code,
      roomId: spot.roomId,
      position: { x: spot.at.x, y: 0, z: spot.at.y },
      rotationY: Math.round(rotation * 1e6) / 1e6,
      materialVariant: null,
      colorOverride: match.colorOverride,
      locked: false,
      provenance,
    };
    state.objects.push(instance);
    report.placed.push({ key: o.key, instanceId: instance.instanceId, assetId: asset.code, quality: match.quality, moved: Math.round(Math.hypot(spot.at.x - seen.x, spot.at.y - seen.y) * 100) / 100 });
  }

  // Surfaces: a catalogue material when one is close in colour and kind, else the colour itself.
  for (const s of recon.surfaces) {
    if (rejected.has(s.room)) continue;
    const roomId = roomIdOf(s.room);
    if (!space.rooms.some((r) => r.id === roomId)) continue;
    const ids = space.surfaces.filter((x) => x.roomId === roomId && x.kind === (s.part === 'FLOOR' ? 'FLOOR' : 'WALL')).map((x) => x.id);
    if (!ids.length || !s.color) continue;
    const mat = matchMaterial(s.part === 'FLOOR' ? 'FLOOR' : 'WALL', s.color, s.material, materials);
    for (const id of ids) {
      state.surfaces[id] = { materialId: mat?.id ?? null, color: mat ? null : s.color, finish: null, locked: false, ...(s.part === 'FLOOR' && s.pattern ? { pattern: s.pattern } : {}) };
    }
    report.surfaces += ids.length;
  }
  state.palette = recon.palette.slice(0, 6);
  return { state, report };
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
