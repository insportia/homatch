// THE SELECTED DESIGN AS A SPATIAL DESIGN GRAPH — what the walkthrough is built FROM.
//
// The selected render is the design truth; the plan (or the space reconstructed
// from the customer's pictures) is the architectural truth. This file joins
// what HOMATCH already knows about the selected render, deterministically:
//
//   scene map   (ds_jobs SCENE_MAP, made when the render was generated)
//               every visible floor, wall and object with its outline and room
//   legend      (ds_renders.legend, the id image's key) the same regions with
//               their image boxes; pixel statistics per region when the server
//               could read the render (regionAppearance.ts)
//   design spec (the job the render was generated from) the palette with its
//               roles and names, the materials, cabinetry, wet rooms, furnishing
//   scene plan  (the walkthrough's reference plan) poses in the plan frame
//
// into one graph: per room, its floor / wall / ceiling design, and every object
// the render shows, with the region it came from, its semantic form, its
// colours and why it exists (provenance). Nothing is invented: an object the
// render does not show is not in the graph, and an object the graph cannot
// build is reported UNRESOLVED, never silently swapped.
//
// Pure: no I/O, no AI. Shared by the edge function and the tests.

import type { CatalogAsset, CatalogMaterial } from '../catalog.ts';
import type { DesignState, ObjectInstance } from '../designState.ts';
import type { DesignForm } from '../objectShape.ts';
import { type Point, type SpaceModel, surfacesOfRoom, wallFrame } from '../space.ts';
import type { BuildItem, BuildPlan, BuildReport, BuildRoom } from './build.ts';

export const GRAPH_VERSION = 'ds-graph-1';

// ── Evidence (structural types: the edge function passes its rows as they are) ─────────────────────

export interface MapElement { kind: 'OBJECT' | 'WALL' | 'FLOOR' | 'CEILING'; label: string; room: string; outline: Array<[number, number]>; inside?: Array<[number, number]> }
export interface LegendEntry { id: string; box: [number, number, number, number]; kind: string; color: string; roomId: string | null; coverage: number }
export interface Legend { width: number; height: number; entries: LegendEntry[] }
export interface PaletteEntry { hex: string; name: string; role: string }
export interface SpecDesign {
  palette?: PaletteEntry[];
  flooring?: string; wallFinishes?: string; cabinetry?: string; wetRooms?: string; textilesAndDecor?: string; fixtures?: string;
  materials?: string[]; furnishing?: string[]; continuity?: string[];
  lighting?: { timeOfDay?: string; temperature?: string } | null;
}
export interface PlanItemRef { type: string; code: string; pose: { x: number; y: number; rotationDeg: number } | null; ref?: { key?: string; imagePx?: [number, number] | null } | null }
export interface ScenePlanEvidence { rooms: Array<{ roomId: string; items: PlanItemRef[] }> }
/** Pixel statistics of one legend region (regionAppearance.ts), when the server read the render. */
export interface RegionLook { color: string; second: string | null; spread: number; pixels: number }

export interface DesignGraphInput {
  space: SpaceModel;
  spec: { design?: SpecDesign } | null;
  sceneMap: MapElement[];
  legend: Legend | null;
  /** The reading's rooms (the ids the scene map and legend use), in reading order. */
  sourceRooms: Array<{ id: string; kind: string }>;
  scenePlan: ScenePlanEvidence | null;
  /** Measured appearance per legend id (server only). */
  appearance?: Record<string, RegionLook> | null;
  source: { renderId: string; sceneMapJobId: string | null; specJobId: string | null };
}

// ── The graph ───────────────────────────────────────────────────────────────────────────────────

export type MaterialClass = 'WOOD_HERRINGBONE' | 'WOOD_PLANK' | 'STONE_TILE' | 'CERAMIC_TILE' | 'PLASTER' | 'PAINT' | 'CONCRETE' | 'TERRAZZO' | 'CARPET' | 'OUTDOOR_TILE';
export type Evidence = 'SPEC' | 'PIXELS' | 'PALETTE' | 'SCENE_MAP' | 'LEGEND' | 'PLAN_POSE' | 'CONTINUITY';

export interface SurfaceDesign {
  klass: MaterialClass;
  color: string;
  evidence: Evidence[];
  /** The legend region it was measured from, when one was. */
  region: string | null;
  confidence: number;
}

export type Importance = 'ANCHOR' | 'MAJOR' | 'MINOR';

export interface GraphObject {
  /** Stable: `<label>:<n>` within the render (the legend id when there is one). */
  id: string;
  label: string;
  roomId: string;
  sourceRoomId: string;
  /** Catalogue code the piece is built from, or null when HOMATCH has no way to build it (UNRESOLVED). */
  code: string | null;
  form: DesignForm | null;
  colors: { main: string | null; second: string | null };
  importance: Importance;
  /** Where in the render (normalised image px): the region's box and a point inside it. */
  region: { legendId: string | null; box: [number, number, number, number]; at: [number, number] };
  /** A pose from the reference plan (room frame, metres), matched by label, room and image position. */
  pose: { x: number; y: number; rotationDeg: number } | null;
  /** Regions of the render this object also accounts for (a countertop is the kitchen's worktop). */
  absorbs: string[];
  evidence: Evidence[];
  confidence: number;
  /** Why it could not be built, when code is null. */
  unresolved: string | null;
}

export interface GraphRoom {
  roomId: string;
  sourceRoomId: string | null;
  kind: string;
  floor: SurfaceDesign;
  walls: SurfaceDesign;
  /** A feature plane (behind the television wall, a headboard): its colour, and the object it sits behind. */
  feature: { color: string; behind: string } | null;
  ceiling: SurfaceDesign;
  objects: GraphObject[];
}

export interface SpatialDesignGraph {
  version: typeof GRAPH_VERSION;
  source: DesignGraphInput['source'];
  roomMap: Record<string, string | null>;
  rooms: GraphRoom[];
  palette: PaletteEntry[];
  frames: string | null;
  lighting: { timeOfDay: 'DAY' | 'EVENING' | 'NIGHT'; temperature: 'WARM' | 'NEUTRAL' | 'COOL' };
  /** Every region of the render and what consumed it (an object, a surface, or nothing). */
  regions: Array<{ id: string; kind: string; label: string; consumedBy: string | null }>;
}

// ── Rooms: the reading's ids → the space's rooms ─────────────────────────────────────────────────

const KIND_ALIASES: Record<string, string[]> = {
  HALL: ['HALL', 'CORRIDOR'], CORRIDOR: ['CORRIDOR', 'HALL'], BALCONY: ['BALCONY', 'TERRACE'], TERRACE: ['TERRACE', 'BALCONY'], WC: ['WC', 'BATHROOM'], BATHROOM: ['BATHROOM', 'WC'],
};

/**
 * The reading's rooms matched to the space's: by kind, in order (the space was built from the same reading, so its
 * second bedroom is the reading's second bedroom). A room with no counterpart maps to null.
 */
export function mapSourceRooms(sourceRooms: Array<{ id: string; kind: string }>, space: SpaceModel): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const used = new Set<string>();
  for (const s of sourceRooms) {
    const kinds = KIND_ALIASES[s.kind] ?? [s.kind];
    const room = kinds.map((k) => space.rooms.find((r) => r.kind === k && !used.has(r.id))).find(Boolean) ?? null;
    if (room) used.add(room.id);
    out[s.id] = room?.id ?? null;
  }
  return out;
}

// ── The spec, read deterministically ─────────────────────────────────────────────────────────────

const sentencesOf = (text: string | undefined | null): string[] => (text ?? '').split(/(?<=[.;])\s+/).map((s) => s.trim()).filter(Boolean);
/** The reading's room ids a sentence names (the spec writes the reading's own ids: r1, r2…). */
let SOURCE_IDS: string[] = [];
const roomIdsIn = (text: string): string[] => SOURCE_IDS.filter((id) => new RegExp(`\\b${id.replace(/[^A-Za-z0-9_-]/g, '')}\\b`).test(text));
const words = (s: string) => s.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2);

/** Palette entries a sentence names (by the distinctive words of their names: "olive", "oatmeal", "limestone"…). */
function paletteNamed(text: string, palette: PaletteEntry[]): PaletteEntry[] {
  const t = ` ${text.toLowerCase()} `;
  const generic = new Set(['warm', 'soft', 'deep', 'natural', 'muted', 'existing', 'aged', 'brushed', 'light', 'dark', 'green', 'white', 'black', 'off', 'colour', 'color', 'frames']);
  return palette.filter((p) => words(p.name).filter((w) => !generic.has(w)).some((w) => t.includes(w)));
}

const byRole = (palette: PaletteEntry[], ...roles: string[]) => roles.map((r) => palette.find((p) => p.role === r)).find(Boolean) ?? null;

/** The material class a sentence describes for a surface. */
function classOf(text: string, surface: 'FLOOR' | 'WALL', wet = false): MaterialClass | null {
  const t = text.toLowerCase();
  // A wet room is stone or tile when its words say so ("dark oak vanity fronts" is not its floor).
  if (wet && surface === 'FLOOR') {
    if (/limestone|travertine|marble|stone/.test(t)) return 'STONE_TILE';
    if (/ceramic|tile|porcelain|terrazzo/.test(t)) return 'CERAMIC_TILE';
  }
  if (surface === 'FLOOR') {
    if (/herringbone|chevron|parquet/.test(t)) return 'WOOD_HERRINGBONE';
    if (/oak|walnut|wood|plank/.test(t)) return 'WOOD_PLANK';
    if (/terrazzo/.test(t)) return 'TERRAZZO';
    if (/limestone|travertine|marble|stone/.test(t)) return 'STONE_TILE';
    if (/ceramic|tile|porcelain/.test(t)) return 'CERAMIC_TILE';
    if (/concrete|micro.?cement/.test(t)) return 'CONCRETE';
    if (/carpet/.test(t)) return 'CARPET';
    return null;
  }
  if (/plaster|lime.?wash|tadelakt|venetian/.test(t)) return 'PLASTER';
  if (/limestone|travertine|marble|ceramic|tile/.test(t)) return 'CERAMIC_TILE';
  if (/concrete/.test(t)) return 'CONCRETE';
  if (/paint|matte|eggshell/.test(t)) return 'PAINT';
  return null;
}

// ── Labels → what HOMATCH builds ─────────────────────────────────────────────────────────────────

interface LabelRule { code: string | null; importance: Importance; form?: DesignForm; absorbs?: string; outdoorCode?: string; why?: string }
/** The scene map's fixed vocabulary (sceneMap.ts SCENE_LABELS) → a catalogue piece and its semantic form. */
export const LABEL_RULES: Record<string, LabelRule> = {
  KITCHEN_CABINETS: { code: 'dev/kitchen-run', importance: 'ANCHOR', form: 'SHAKER' },
  COUNTERTOP: { code: null, importance: 'MAJOR', absorbs: 'KITCHEN_CABINETS' },
  KITCHEN_ISLAND: { code: 'dev/kitchen-island', importance: 'ANCHOR', form: 'SHAKER' },
  DINING_TABLE: { code: 'dev/dining-table-4', importance: 'ANCHOR' },
  CHAIR: { code: 'dev/dining-chair', importance: 'MINOR' },
  SOFA: { code: 'dev/sofa-3', importance: 'ANCHOR' },
  ARMCHAIR: { code: 'dev/armchair', importance: 'ANCHOR', form: 'CLUB' },
  COFFEE_TABLE: { code: 'dev/coffee-table', importance: 'MAJOR' },
  SIDE_TABLE: { code: 'dev/side-table', importance: 'MINOR' },
  TV_UNIT: { code: 'dev/tv-unit', importance: 'ANCHOR', form: 'TV_WALL' },
  RUG: { code: 'dev/rug-large', importance: 'MAJOR', form: 'BORDERED' },
  BED: { code: 'dev/bed-double', importance: 'ANCHOR', form: 'UPHOLSTERED' },
  NIGHTSTAND: { code: 'dev/bedside', importance: 'MAJOR' },
  WARDROBE: { code: 'dev/wardrobe-3', importance: 'ANCHOR', form: 'BUILT_IN' },
  DRESSER: { code: 'dev/dresser', importance: 'MAJOR' },
  DESK: { code: 'dev/desk', importance: 'MAJOR' },
  SHELF: { code: 'dev/bookshelf', importance: 'MAJOR' },
  SHOWER: { code: 'dev/shower', importance: 'ANCHOR' },
  VANITY: { code: 'dev/vanity', importance: 'ANCHOR', form: 'FLUTED' },
  TOILET: { code: 'dev/toilet', importance: 'ANCHOR' },
  BATH: { code: 'dev/bath', importance: 'ANCHOR' },
  PLANT: { code: 'dev/plant-large', importance: 'MINOR', outdoorCode: 'dev/planter' },
  LAMP: { code: null, importance: 'MINOR', absorbs: 'NIGHTSTAND' },
  CURTAIN: { code: 'dev/curtains', importance: 'MINOR' },
  OUTDOOR_FURNITURE: { code: 'dev/outdoor-chair', importance: 'MAJOR' },
  ARTWORK: { code: null, importance: 'MINOR', why: 'NO_ARTWORK_GEOMETRY' },
  DECOR: { code: null, importance: 'MINOR', why: 'NO_DECOR_GEOMETRY' },
};

/** Which plan item types a label's pose may come from. */
const PLAN_TYPES: Record<string, string[]> = {
  KITCHEN_CABINETS: ['KITCHEN_RUN'], DINING_TABLE: ['DINING_TABLE'], CHAIR: ['DINING_CHAIR', 'CHAIR'], SOFA: ['SOFA'], ARMCHAIR: ['ARMCHAIR'],
  COFFEE_TABLE: ['COFFEE_TABLE'], TV_UNIT: ['MEDIA', 'TV_UNIT'], RUG: ['RUG'], BED: ['BED'], NIGHTSTAND: ['BEDSIDE', 'NIGHTSTAND'], WARDROBE: ['WARDROBE'],
  SHOWER: ['SHOWER'], VANITY: ['VANITY'], TOILET: ['TOILET'], BATH: ['BATH'], PLANT: ['PLANT', 'PLANTER'], OUTDOOR_FURNITURE: ['OUTDOOR_CHAIR', 'OUTDOOR_TABLE', 'OUTDOOR_SOFA'],
  DRESSER: ['DRESSER'], DESK: ['DESK'], SHELF: ['SHELF', 'BOOKSHELF'], SIDE_TABLE: ['SIDE_TABLE'],
};

const boxOf = (outline: Array<[number, number]>): [number, number, number, number] => {
  const xs = outline.map((p) => p[0]); const ys = outline.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};
const centreOf = (b: [number, number, number, number]): [number, number] => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const iou = (a: [number, number, number, number], b: [number, number, number, number]) => {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])); const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy; const u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return u > 0 ? inter / u : 0;
};

// ── Colours of a piece, from the spec's own words ────────────────────────────────────────────────

/** Spec sentences that talk about a label (its furnishing line, cabinetry, wet rooms…). */
const LABEL_WORDS: Record<string, RegExp> = {
  KITCHEN_CABINETS: /kitchen|cabinet|fronts|joinery/, KITCHEN_ISLAND: /island/, DINING_TABLE: /dining/, CHAIR: /dining chair|chairs/, SOFA: /sofa/,
  ARMCHAIR: /occasional chair|lounge chair|armchair|chairs angled|chairs/, COFFEE_TABLE: /coffee table/, TV_UNIT: /television|tv/, RUG: /rug/,
  BED: /\bbed\b|bedding|headboard/, NIGHTSTAND: /bedside|nightstand/, WARDROBE: /wardrobe|storage/, VANITY: /vanity/, SHOWER: /shower/, TOILET: /toilet/,
  PLANT: /plant|planter|foliage/, OUTDOOR_FURNITURE: /lounge chairs|teak|outdoor|balcony/, LAMP: /lamp/,
};

interface Slots { main: string | null; second: string | null }

function colorsFor(label: string, sourceRoom: string | null, design: SpecDesign, palette: PaletteEntry[]): Slots {
  const re = LABEL_WORDS[label];
  const pool = [...(design.furnishing ?? []), design.cabinetry ?? '', design.wetRooms ?? '', design.textilesAndDecor ?? ''];
  // Sentences about this label — in its own room first (r5's bed is not r6's).
  const about = pool.flatMap(sentencesOf).filter((s) => re?.test(s.toLowerCase()));
  const inRoom = sourceRoom ? about.filter((s) => roomIdsIn(s).includes(sourceRoom)) : [];
  // The clause that names the piece ("…a linen sofa…, with two deep olive occasional chairs…"): its own colours only.
  const clauses = (inRoom.length ? inRoom : about).flatMap((s) => s.split(/,|;|\bwith\b|\band\b(?= (?:a|an|two|three|one|some|the)\b)/i)).filter((c) => re?.test(c.toLowerCase()));
  const sentence = (inRoom.length ? inRoom : about).join(' ');
  // A clause that names no colour ("retain the source bed…, using a quieter clay-and-oat palette"): the sentence's.
  const fromClauses = clauses.length ? paletteNamed(clauses.join(' '), palette) : [];
  const named = fromClauses.length ? fromClauses : paletteNamed(sentence, palette);
  const wood = named.find((p) => p.role === 'WOOD') ?? byRole(palette, 'WOOD');
  const textile = named.find((p) => p.role === 'TEXTILE' || p.role === 'ACCENT') ?? null;
  const stone = named.find((p) => p.role === 'STONE') ?? byRole(palette, 'STONE');
  const metal = named.find((p) => p.role === 'METAL' && !/black|charcoal/i.test(p.name)) ?? byRole(palette, 'METAL');
  const light = byRole(palette, 'DOMINANT');
  switch (label) {
    case 'KITCHEN_CABINETS': case 'KITCHEN_ISLAND': case 'VANITY':
      return { main: wood?.hex ?? null, second: stone?.hex ?? null };
    case 'ARMCHAIR': case 'SOFA':
      return { main: textile?.hex ?? byRole(palette, 'TEXTILE')?.hex ?? null, second: wood?.hex ?? null };
    case 'BED': {
      // The bed's upholstery and its bedding: the room's own words (taupe linen, clay-and-oat), else the textile.
      const fabrics = named.filter((p) => p.role === 'TEXTILE' || p.role === 'ACCENT' || p.role === 'SECONDARY');
      return { main: fabrics[0]?.hex ?? byRole(palette, 'TEXTILE')?.hex ?? null, second: fabrics[1]?.hex ?? light?.hex ?? null };
    }
    case 'RUG': {
      const fabrics = named.filter((p) => p.role !== 'WOOD' && p.role !== 'METAL');
      return { main: fabrics[0]?.hex ?? byRole(palette, 'SECONDARY')?.hex ?? null, second: fabrics[1]?.hex ?? byRole(palette, 'ACCENT')?.hex ?? null };
    }
    case 'PLANT':
      return { main: null, second: named.find((p) => p.role === 'ACCENT' || p.role === 'STONE')?.hex ?? byRole(palette, 'ACCENT')?.hex ?? null };
    case 'TV_UNIT': case 'WARDROBE': case 'NIGHTSTAND': case 'DINING_TABLE': case 'COFFEE_TABLE': case 'DRESSER': case 'DESK': case 'SHELF': case 'SIDE_TABLE':
      return { main: wood?.hex ?? null, second: metal?.hex ?? null };
    case 'CHAIR':
      return { main: wood?.hex ?? null, second: byRole(palette, 'TEXTILE')?.hex ?? null };
    case 'OUTDOOR_FURNITURE':
      return { main: wood?.hex ?? null, second: byRole(palette, 'TEXTILE')?.hex ?? null };
    default:
      return { main: null, second: null };
  }
}

// ── Building the graph ───────────────────────────────────────────────────────────────────────────

const HEX = /^#[0-9a-f]{6}$/i;
const okHex = (h: unknown): string | null => (typeof h === 'string' && HEX.test(h) ? h.toLowerCase() : null);

export function buildDesignGraph(input: DesignGraphInput): SpatialDesignGraph {
  const { space } = input;
  const design: SpecDesign = input.spec?.design ?? {};
  const palette = (design.palette ?? []).filter((p) => okHex(p.hex)).map((p) => ({ ...p, hex: p.hex.toLowerCase() }));
  const roomMap = mapSourceRooms(input.sourceRooms, space);
  SOURCE_IDS = input.sourceRooms.map((r) => r.id);
  const sourceOf = new Map(Object.entries(roomMap).filter(([, v]) => v).map(([k, v]) => [v as string, k]));
  const look = input.appearance ?? {};
  const legend = input.legend?.entries ?? [];
  const regions: SpatialDesignGraph['regions'] = legend.map((e) => ({ id: e.id, kind: e.kind, label: e.id.split(':')[1]?.toUpperCase() ?? e.kind, consumedBy: null }));
  const consume = (legendId: string | null, by: string) => { const r = legendId ? regions.find((x) => x.id === legendId) : null; if (r && !r.consumedBy) r.consumedBy = by; };

  // ── Surfaces: the spec's sentences that name a room, then the whole-home continuity, then the room's kind.
  const floorSentences = sentencesOf(design.flooring);
  const wallSentences = sentencesOf(design.wallFinishes);
  const wet = design.wetRooms ?? '';
  const dominant = byRole(palette, 'DOMINANT');
  const wood = byRole(palette, 'WOOD');
  const stone = byRole(palette, 'STONE');
  const homeFloor = floorSentences.map((s) => classOf(s, 'FLOOR')).find((k) => k === 'WOOD_HERRINGBONE' || k === 'WOOD_PLANK') ?? null;
  const homeWall = wallSentences.map((s) => classOf(s, 'WALL')).find(Boolean) ?? null;
  const featureColor = (() => {
    const s = wallSentences.find((x) => /feature|accent|behind/.test(x.toLowerCase()));
    return s ? paletteNamed(s, palette).find((p) => p.role !== 'DOMINANT' && p.role !== 'WOOD')?.hex ?? null : null;
  })();
  const legendFor = (src: string | null, kind: string) => legend.filter((e) => e.kind === kind && e.roomId === src).sort((a, b) => b.coverage - a.coverage)[0] ?? null;

  const rooms: GraphRoom[] = space.rooms.map((room) => {
    const src = sourceOf.get(room.id) ?? null;
    const named = (sentences: string[]) => sentences.filter((s) => src && roomIdsIn(s).includes(src));
    const wetRoom = room.kind === 'BATHROOM' || room.kind === 'WC';
    // Floor.
    const fNamed = named(floorSentences);
    let fClass = fNamed.map((s) => classOf(s, 'FLOOR', wetRoom)).find(Boolean) ?? null;
    const fEvidence: Evidence[] = [];
    if (fClass) fEvidence.push('SPEC');
    else if (wetRoom) { fClass = classOf(wet, 'FLOOR', true) ?? 'STONE_TILE'; fEvidence.push('SPEC'); }
    else if (room.outdoor) { fClass = 'OUTDOOR_TILE'; fEvidence.push('SPEC'); }
    else if (homeFloor) { fClass = homeFloor; fEvidence.push('CONTINUITY'); }
    else fClass = 'WOOD_PLANK';
    const fRegion = legendFor(src, 'FLOOR');
    const fSeen = fRegion ? look[fRegion.id] : undefined;
    const fColor = fSeen?.color ?? ((fClass === 'WOOD_HERRINGBONE' || fClass === 'WOOD_PLANK') ? wood?.hex : stone?.hex ?? dominant?.hex) ?? '#b48b5e';
    if (fSeen) fEvidence.push('PIXELS'); else fEvidence.push('PALETTE');
    if (fRegion) { fEvidence.push('LEGEND'); consume(fRegion.id, `floor:${room.id}`); }
    const floor: SurfaceDesign = { klass: fClass, color: fColor, evidence: fEvidence, region: fRegion?.id ?? null, confidence: fSeen ? 0.9 : fNamed.length ? 0.75 : 0.55 };
    // Walls.
    const wRegion = legendFor(src, 'WALL');
    const wSeen = wRegion ? look[wRegion.id] : undefined;
    const wClass: MaterialClass = wetRoom ? (classOf(wet, 'WALL') ?? 'CERAMIC_TILE') : (named(wallSentences).map((s) => classOf(s, 'WALL')).find(Boolean) ?? homeWall ?? 'PAINT');
    const wColor = wSeen?.color ?? (wetRoom ? stone?.hex : dominant?.hex) ?? '#f2eee6';
    const walls: SurfaceDesign = { klass: wClass, color: wColor, evidence: [wetRoom || named(wallSentences).length ? 'SPEC' : 'CONTINUITY', wSeen ? 'PIXELS' : 'PALETTE', ...(wRegion ? ['LEGEND' as const] : [])], region: wRegion?.id ?? null, confidence: wSeen ? 0.9 : 0.6 };
    for (const w of legend.filter((e) => e.kind === 'WALL' && e.roomId === src)) consume(w.id, `walls:${room.id}`);
    const ceiling: SurfaceDesign = { klass: 'PAINT', color: dominant?.hex ?? '#f5f2ed', evidence: ['PALETTE'], region: null, confidence: 0.5 };
    return { roomId: room.id, sourceRoomId: src, kind: room.kind, floor, walls, feature: null, ceiling, objects: [] };
  });

  // ── Objects: every OBJECT element of the scene map, with its legend region, a plan pose when one matches.
  const planItems = (input.scenePlan?.rooms ?? []).flatMap((r) => r.items.filter((i) => i.pose && i.ref?.imagePx).map((i) => ({ roomId: r.roomId, item: i, used: false })));
  const counters = new Map<string, number>();
  const objects: GraphObject[] = [];
  for (const el of input.sceneMap.filter((e) => e.kind === 'OBJECT')) {
    const roomId = roomMap[el.room] ?? null;
    if (!roomId) continue;
    const room = rooms.find((r) => r.roomId === roomId)!;
    const n = (counters.get(el.label) ?? 0) + 1; counters.set(el.label, n);
    const box = boxOf(el.outline);
    // The legend region that is this element: same label and room, most overlap.
    const candidates = legend.filter((e) => e.kind === 'OBJECT' && e.roomId === el.room && e.id.split(':')[1]?.toUpperCase() === el.label);
    const lg = candidates.map((e) => ({ e, s: iou(e.box, box) })).sort((a, b) => b.s - a.s)[0];
    const legendId = lg && lg.s > 0.2 ? lg.e.id : null;
    const id = legendId ?? `${el.label.toLowerCase()}:${n}`;
    const rule = LABEL_RULES[el.label] ?? { code: null, importance: 'MINOR' as Importance, why: 'UNKNOWN_LABEL' };
    const at = el.inside?.[0] ?? centreOf(box);
    let code = rule.code;
    if (room.kind === 'BALCONY' || room.kind === 'TERRACE') code = rule.outdoorCode ?? code;
    const seen = legendId ? look[legendId] : undefined;
    const fromSpec = colorsFor(el.label, el.room, design, palette);
    const colors = { main: seen?.color ?? fromSpec.main, second: seen?.second ?? fromSpec.second };
    const evidence: Evidence[] = ['SCENE_MAP', ...(legendId ? ['LEGEND' as const] : []), ...(seen ? ['PIXELS' as const] : []), ...(fromSpec.main ? ['SPEC' as const] : [])];
    objects.push({
      id, label: el.label, roomId, sourceRoomId: el.room, code, form: rule.form ?? null, colors, importance: rule.importance,
      region: { legendId, box, at }, pose: null, absorbs: [], evidence, confidence: legendId ? 0.85 : 0.7,
      unresolved: code ? null : (rule.absorbs ? null : rule.why ?? 'NO_GEOMETRY'),
    });
    consume(legendId, `object:${id}`);
  }

  // Regions another piece accounts for (a countertop is its kitchen's worktop, a bedside lamp sits on its nightstand).
  for (const o of objects.filter((x) => !x.code && LABEL_RULES[x.label]?.absorbs)) {
    const host = objects.filter((h) => h.code && h.label === LABEL_RULES[o.label]!.absorbs && h.roomId === o.roomId)
      .sort((a, b) => Math.hypot(a.region.at[0] - o.region.at[0], a.region.at[1] - o.region.at[1]) - Math.hypot(b.region.at[0] - o.region.at[0], b.region.at[1] - o.region.at[1]))[0];
    if (host) {
      host.absorbs.push(o.id);
      if (o.label === 'COUNTERTOP' && o.colors.main && host.evidence.includes('PIXELS')) host.colors.second = o.colors.main;
      const r = regions.find((x) => x.id === o.region.legendId); if (r) r.consumedBy = `object:${host.id}`;
    } else {
      o.unresolved = 'NO_HOST';
    }
  }

  // Outdoor furniture: the smallest piece of a group of three or more is its table (a table sits between chairs).
  const outdoor = objects.filter((o) => o.label === 'OUTDOOR_FURNITURE');
  if (outdoor.length >= 3) {
    const area = (o: GraphObject) => (o.region.box[2] - o.region.box[0]) * (o.region.box[3] - o.region.box[1]);
    outdoor.sort((a, b) => area(a) - area(b))[0].code = 'dev/outdoor-table';
  }

  // Poses: the reference plan's item for the same kind in the same room, nearest in the picture.
  for (const o of objects.filter((x) => x.code)) {
    const types = PLAN_TYPES[o.label] ?? [];
    const best = planItems.filter((p) => !p.used && p.roomId === o.roomId && types.includes(p.item.type))
      .map((p) => ({ p, d: Math.hypot(p.item.ref!.imagePx![0] - o.region.at[0], p.item.ref!.imagePx![1] - o.region.at[1]) }))
      .sort((a, b) => a.d - b.d)[0];
    // A plan's image anchor can sit at a piece's foot, not its middle: within a fifth of the picture, same room and kind.
    if (best && best.d < 0.2) { best.p.used = true; o.pose = best.p.item.pose; o.evidence.push('PLAN_POSE'); }
  }
  for (const o of objects) rooms.find((r) => r.roomId === o.roomId)!.objects.push(o);

  // Feature planes: the spec's accent colour behind the television wall (and, in bedrooms, the headboard).
  if (featureColor) {
    for (const r of rooms) {
      const host = r.objects.find((o) => o.label === 'TV_UNIT') ?? (r.kind === 'BEDROOM' ? r.objects.find((o) => o.label === 'BED') : undefined);
      if (host && /television|tv|headboard|bed/.test((design.wallFinishes ?? '').toLowerCase())) r.feature = { color: featureColor, behind: host.id };
    }
  }

  const frames = palette.find((p) => p.role === 'METAL' && /black|charcoal/i.test(p.name))?.hex ?? null;
  const tod = String(design.lighting?.timeOfDay ?? 'DAY').toUpperCase();
  const temp = String(design.lighting?.temperature ?? 'NEUTRAL').toUpperCase();
  return {
    version: GRAPH_VERSION, source: input.source, roomMap, rooms, palette, frames,
    lighting: { timeOfDay: tod === 'EVENING' || tod === 'NIGHT' ? tod : 'DAY', temperature: temp === 'WARM' || temp === 'COOL' ? temp : 'NEUTRAL' },
    regions,
  };
}

// ── Materials: a surface class and colour → the best catalogue material ──────────────────────────

const CLASS_WORDS: Record<MaterialClass, { must: RegExp; prefer?: RegExp; categories: string[] }> = {
  WOOD_HERRINGBONE: { must: /herringbone|parquet|chevron/i, prefer: /herringbone|chevron/i, categories: ['WOOD', 'FLOOR'] },
  WOOD_PLANK: { must: /oak|walnut|wood|plank|veneer/i, prefer: /floor|plank/i, categories: ['WOOD', 'FLOOR'] },
  STONE_TILE: { must: /limestone|travertine|marble|stone|tile/i, prefer: /beige|limestone|travertine|sand/i, categories: ['STONE', 'TILE', 'FLOOR'] },
  CERAMIC_TILE: { must: /tile|ceramic|limestone|travertine/i, prefer: /interior|wall|large|long/i, categories: ['TILE', 'STONE', 'WALL'] },
  PLASTER: { must: /plaster|stucco|lime/i, prefer: /beige|white|smooth|painted/i, categories: ['WALL'] },
  PAINT: { must: /paint/i, categories: ['WALL'] },
  CONCRETE: { must: /concrete|cement/i, categories: ['FLOOR', 'WALL', 'STONE'] },
  TERRAZZO: { must: /terrazzo/i, categories: ['TILE', 'STONE', 'FLOOR'] },
  CARPET: { must: /carpet/i, categories: ['FLOOR', 'FABRIC'] },
  OUTDOOR_TILE: { must: /tile|paver|paving|stone|deck/i, prefer: /patio|paving|deck|terracotta/i, categories: ['STONE', 'TILE', 'WOOD', 'FLOOR'] },
};
const AVOID = /roof|damaged|dirty|crack|volcanic|rock|slate|weathered|worn|mossy|rough|rubber|anti.?skid|brick|cobble|barrel|gate|shed|moss|rustic|old|exterior|pavement/i;

const rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const colourDistance = (a: string, b: string) => { const x = rgb(a); const y = rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) / 441.7; };

/** The catalogue material for a surface: the class's words, a clean (not worn, not roof) material, nearest in tone. */
export function resolveMaterial(surface: SurfaceDesign, kind: 'FLOOR' | 'WALL', materials: CatalogMaterial[]): CatalogMaterial | null {
  const want = CLASS_WORDS[surface.klass];
  const pool = materials.filter((m) => m.active && want.categories.includes(m.category) && (m.appliesTo.length === 0 || m.appliesTo.includes(kind)));
  const text = (m: CatalogMaterial) => `${m.name} ${m.code} ${(m.aliases ?? []).join(' ')}`;
  const scored = pool.filter((m) => want.must.test(text(m)) && !AVOID.test(m.name))
    .map((m) => ({ m, s: (m.isPlaceholder ? 0.15 : 0) + (want.prefer && want.prefer.test(text(m)) ? -0.1 : 0) + (m.pbr.baseColor && !/^#ffffff$/i.test(m.pbr.baseColor) ? colourDistance(m.pbr.baseColor, surface.color) * 0.5 : 0.1) }))
    .sort((a, b) => a.s - b.s || (a.m.code < b.m.code ? -1 : 1));
  return scored[0]?.m ?? null;
}

// ── Assembly: graph → the build plan the walkability-gated builder takes ─────────────────────────

/** The build plan of the selected design: only what the graph holds (nothing invented), with its poses and colours. */
/**
 * A flat piece (a rug) larger than the room it lies in is drawn at the largest size the room holds, a hand's width
 * from every wall: the design's rug, minimally adapted, never dropped for being a catalogue size.
 */
function fitScale(o: GraphObject, asset: CatalogAsset, room: SpaceModel['rooms'][number] | undefined): number {
  if (o.label !== 'RUG' || !room) return 1;
  const w = room.bounds.maxX - room.bounds.minX - 0.5;
  const d = room.bounds.maxY - room.bounds.minY - 0.5;
  const fit = Math.max(Math.min(w / asset.widthM, d / asset.depthM), Math.min(w / asset.depthM, d / asset.widthM));
  return Math.max(0.5, Math.min(1, Math.round(fit * 100) / 100));
}

export function graphToBuildPlan(graph: SpatialDesignGraph, space: SpaceModel, materials: CatalogMaterial[], assets: Map<string, CatalogAsset>): BuildPlan {
  const rooms: BuildRoom[] = graph.rooms.map((r) => {
    const floorM = resolveMaterial(r.floor, 'FLOOR', materials);
    const wallM = resolveMaterial(r.walls, 'WALL', materials);
    const room = space.rooms.find((x) => x.id === r.roomId);
    const items: BuildItem[] = r.objects.filter((o) => o.code && assets.has(o.code)).map((o) => ({
      code: o.code!, type: o.label, pose: o.pose, scale: fitScale(o, assets.get(o.code!)!, room), color: o.colors.main, origin: o.pose ? 'PLANNED' : 'PROGRAMME', refKey: o.id,
      // The render's anchors keep their place: nudged only as far as walkability needs.
      lock: o.pose && o.importance === 'ANCHOR' ? { maxShiftM: 0.45, maxTurnDeg: 20 } : null,
    }));
    return {
      roomId: r.roomId, floorMaterial: floorM?.code ?? null, floorColor: r.floor.color, wallMaterial: wallM?.code ?? null, wallColor: r.walls.color,
      wallFinish: 'MATTE', accent: null, ceilingColor: r.ceiling.color, items,
    };
  });
  return { lighting: { timeOfDay: graph.lighting.timeOfDay, temperature: graph.lighting.temperature, interiorIntensity: graph.lighting.timeOfDay === 'DAY' ? 0.7 : 0.82 }, palette: graph.palette.map((p) => p.hex).slice(0, 8), styleCode: null, rooms };
}

/** The wall face of a room nearest a point (the wall a piece stands against). */
function nearestWallSurface(space: SpaceModel, roomId: string, p: Point): string | null {
  let best: { id: string; d: number } | null = null;
  for (const s of surfacesOfRoom(space, roomId).filter((x) => x.kind === 'WALL' && x.wallId)) {
    const w = space.walls.find((x) => x.id === s.wallId);
    if (!w) continue;
    const f = wallFrame(w.mesh);
    const len = Math.hypot(w.mesh.end.x - w.mesh.start.x, w.mesh.end.y - w.mesh.start.y);
    const t = Math.max(0, Math.min(len, (p.x - w.mesh.start.x) * f.dir.x + (p.y - w.mesh.start.y) * f.dir.y));
    const d = Math.hypot(w.mesh.start.x + f.dir.x * t - p.x, w.mesh.start.y + f.dir.y * t - p.y);
    if (!best || d < best.d) best = { id: s.id, d };
  }
  return best?.id ?? null;
}

/** The full height of the forms that rise above their catalogue piece (procedural.ts / furniture.py draw them so). */
export const FORM_HEIGHT_M: Partial<Record<DesignForm, number>> = { TV_WALL: 2.42, BUILT_IN: 2.5, SHAKER: 2.3, UPHOLSTERED: 1.25 };

/**
 * The design's look on the built state: each piece wears its graph form and second colour (the builder knows sizes
 * and places; the graph knows what it looks like), feature planes are painted behind their host, the window frames
 * take the design's frame colour. Returns a new state.
 */
export function applyGraphLook(graph: SpatialDesignGraph, space: SpaceModel, state: DesignState, report: BuildReport, assets: Map<string, CatalogAsset>): DesignState {
  const out: DesignState = structuredClone(state);
  const byRef = new Map<string, GraphObject>();
  for (const r of graph.rooms) for (const o of r.objects) byRef.set(o.id, o);
  const instanceOf = new Map<string, string>();
  for (const it of report.items) if (it.refKey && it.instanceId) instanceOf.set(it.instanceId, it.refKey);
  for (const obj of out.objects) {
    const g = byRef.get(instanceOf.get(obj.instanceId) ?? '');
    if (!g) continue;
    const asset = assets.get(obj.assetId);
    const shape = obj.shape ?? (asset ? { widthM: asset.widthM, depthM: asset.depthM, heightM: asset.heightM, form: null, secondary: null } : undefined);
    // A design form taller than the catalogue piece carries its real height (the factory fits a piece to it exactly).
    const tall = g.form ? FORM_HEIGHT_M[g.form] : undefined;
    if (shape) obj.shape = { ...shape, heightM: tall ? Math.max(shape.heightM, tall) : shape.heightM, form: g.form ?? shape.form, secondary: g.colors.second ?? shape.secondary };
    if (g.colors.main) obj.colorOverride = g.colors.main;
    // A designed piece is drawn by HOMATCH from the design, never replaced by an earlier generic model.
    delete (obj as ObjectInstance & { generated?: unknown }).generated;
  }
  // Floors keep the design's colour with their material: the texture is tinted to it (SceneController.dressPbr),
  // so a catalogue parquet reads as the design's smoked oak, not as its own photograph's tone.
  for (const r of graph.rooms) {
    const id = `floor:${r.roomId}`;
    const cur = out.surfaces[id];
    if (cur) out.surfaces[id] = { ...cur, color: r.floor.color };
  }
  for (const r of graph.rooms) {
    if (!r.feature) continue;
    const host = out.objects.find((o) => instanceOf.get(o.instanceId) === r.feature!.behind);
    if (!host) continue;
    const id = nearestWallSurface(space, r.roomId, { x: host.position.x, y: host.position.z });
    if (id) out.surfaces[id] = { ...(out.surfaces[id] ?? { materialId: null, finish: 'MATTE', locked: false }), color: r.feature.color, finish: 'MATTE' } as DesignState['surfaces'][string];
  }
  if (graph.frames) out.frames = graph.frames;
  return out;
}

// ── Fidelity: what the walkthrough really carries of the selected design ─────────────────────────

export interface FidelityMetrics {
  importantObjects: number;
  importantPlaced: number;
  /** Placed important objects / important objects the render shows. */
  importantRecall: number;
  unresolvedImportant: string[];
  /** Pieces in the walk that the design accounts for (form + colours from the graph) vs generic defaults. */
  designedPieces: number;
  genericPieces: number;
  inventedPieces: number;
  genericRatio: number;
  /** Rooms whose floor and walls carry the design's material class and colour. */
  materialCoverage: number;
  /** Regions of the render the graph consumed. */
  regionConsumption: number;
  roomsUnmapped: string[];
  walkable: boolean;
}

export interface Promotion { promoted: boolean; reasons: string[]; metrics: FidelityMetrics }

/** The rules a walkthrough must meet before it is presented as the selected design. */
export const PROMOTION_RULES = { minImportantRecall: 0.8, maxGenericRatio: 0.2, minMaterialCoverage: 0.8, minRegionConsumption: 0.8 } as const;

export function fidelityOf(graph: SpatialDesignGraph, state: DesignState, report: BuildReport, walkable: boolean): Promotion {
  const objs = graph.rooms.flatMap((r) => r.objects);
  const important = objs.filter((o) => o.importance !== 'MINOR');
  const placedRefs = new Set(report.items.filter((i) => i.instanceId && i.outcome !== 'DROPPED' && i.refKey).map((i) => i.refKey!));
  // A region another piece accounts for (a countertop, a bedside lamp) is placed when its host is.
  const hostOf = new Map<string, string>();
  for (const o of objs) for (const a of o.absorbs) hostOf.set(a, o.id);
  const placedImportant = important.filter((o) => placedRefs.has(o.id) || (hostOf.has(o.id) && placedRefs.has(hostOf.get(o.id)!)));
  const refOf = new Map(report.items.filter((i) => i.instanceId).map((i) => [i.instanceId!, i.refKey ?? null]));
  const known = new Set(objs.map((o) => o.id));
  let designed = 0; let generic = 0; let invented = 0;
  for (const o of state.objects) {
    const ref = refOf.get(o.instanceId) ?? null;
    if (!ref || !known.has(ref)) { invented += 1; continue; }
    const g = objs.find((x) => x.id === ref)!;
    // Designed: its form (when the design gives one) and its colours or its fixture role come from the graph.
    const fixture = /SHOWER|TOILET|BATH|VANITY|PLANT/.test(g.label);
    if ((g.colors.main || g.colors.second || fixture) && (!g.form || o.shape?.form === g.form)) designed += 1; else generic += 1;
  }
  const total = Math.max(1, state.objects.length);
  const designedRooms = graph.rooms.filter((r) => r.floor.evidence.some((e) => e === 'SPEC' || e === 'PIXELS' || e === 'CONTINUITY') && r.walls.evidence.some((e) => e === 'SPEC' || e === 'PIXELS' || e === 'CONTINUITY'));
  const regionsTotal = graph.regions.length;
  const metrics: FidelityMetrics = {
    importantObjects: important.length,
    importantPlaced: placedImportant.length,
    importantRecall: important.length ? placedImportant.length / important.length : 1,
    unresolvedImportant: important.filter((o) => !placedImportant.includes(o)).map((o) => o.id),
    designedPieces: designed, genericPieces: generic, inventedPieces: invented,
    genericRatio: (generic + invented) / total,
    materialCoverage: graph.rooms.length ? designedRooms.length / graph.rooms.length : 0,
    regionConsumption: regionsTotal ? graph.regions.filter((r) => r.consumedBy).length / regionsTotal : 0,
    roomsUnmapped: Object.entries(graph.roomMap).filter(([, v]) => !v).map(([k]) => k),
    walkable,
  };
  const reasons: string[] = [];
  if (!walkable) reasons.push('NOT_WALKABLE');
  if (metrics.importantRecall < PROMOTION_RULES.minImportantRecall) reasons.push('IMPORTANT_OBJECTS_MISSING');
  if (metrics.genericRatio > PROMOTION_RULES.maxGenericRatio) reasons.push('GENERIC_PLACEHOLDERS');
  if (metrics.materialCoverage < PROMOTION_RULES.minMaterialCoverage) reasons.push('MATERIALS_NOT_FROM_DESIGN');
  if (regionsTotal && metrics.regionConsumption < PROMOTION_RULES.minRegionConsumption) reasons.push('RENDER_REGIONS_UNUSED');
  if (metrics.roomsUnmapped.length) reasons.push('ROOMS_UNMAPPED');
  return { promoted: reasons.length === 0, reasons, metrics };
}

/** The same metrics, for a walkthrough built WITHOUT the graph (the before): every piece is generic or invented. */
export function fidelityOfUngraphed(graph: SpatialDesignGraph, state: DesignState): FidelityMetrics {
  const objs = graph.rooms.flatMap((r) => r.objects);
  const important = objs.filter((o) => o.importance !== 'MINOR');
  // A piece of the same catalogue code in the same room counts as that object (the most a generic build can claim).
  const pool = [...state.objects];
  let placed = 0;
  for (const o of important) {
    const i = pool.findIndex((p) => p.roomId === o.roomId && p.assetId === o.code);
    if (i >= 0) { placed += 1; pool.splice(i, 1); } else if (!o.code && !o.unresolved) placed += 1;
  }
  // What is left once every object the render shows has taken its piece: pieces the render does not show.
  for (const o of objs.filter((x) => x.importance === 'MINOR' && x.code)) {
    const i = pool.findIndex((p) => p.roomId === o.roomId && p.assetId === o.code);
    if (i >= 0) pool.splice(i, 1);
  }
  const invented = pool.filter((p) => !objs.some((o) => o.roomId === p.roomId && o.code === p.assetId)).length;
  const formed = state.objects.filter((o) => o.shape?.form).length;
  return {
    importantObjects: important.length, importantPlaced: placed, importantRecall: important.length ? placed / important.length : 1, unresolvedImportant: [],
    designedPieces: formed, genericPieces: state.objects.length - formed - invented, inventedPieces: invented,
    genericRatio: state.objects.length ? (state.objects.length - formed) / state.objects.length : 0,
    materialCoverage: 0, regionConsumption: 0, roomsUnmapped: [], walkable: true,
  };
}

