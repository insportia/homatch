// THE SCENE BUILD SPEC — what the Blender factory builds, as DATA.
//
// HOMATCH (the reading, the measured camera, the calibrated plan, the
// catalogue) decides WHAT the home is; this file turns HOMATCH's canonical
// scene into a strict, bounded description, and the Blender factory
// (infra/design-studio-gpu-worker/factory) is the only code that turns that
// description into geometry, materials, light and a render. Nothing here or
// in the factory ever executes code that came from a model or a customer: a
// spec is numbers, colours, enums and ids, validated twice (here, on the
// edge before it is sent, and again in the worker before Blender sees it).
//
// Coordinates: plan metres, x east, y north (the plan's own axes), z up.
// three.js world is (x, z, −y); Blender's is exactly this; glTF export of a
// Blender scene lands back on three's convention, so a model the factory
// builds drops into the walkthrough unchanged.

export const SPEC_VERSION = 'hm-scene-1';

export const SPEC_LIMITS = {
  rooms: 80, polygonPoints: 64, walls: 400, openingsPerWall: 16, facesPerWall: 24, railings: 120,
  objects: 300, materials: 48, surfaces: 1500, colorSlots: 12, coord: 200, size: [0.02, 12] as const, height: 6,
  renderEdge: [256, 2560] as const, samples: [1, 512] as const,
  stairs: 8, treads: [3, 25] as const, stairRunM: [0.5, 12] as const, stairWidthM: [0.5, 6] as const,
};

/** How an opening closes (floorplan OpeningLeaf). Optional: absent means the drawing did not say. */
export const SPEC_LEAVES = ['HINGED', 'DOUBLE', 'SLIDING', 'NONE', 'FRENCH', 'FIXED', 'CASEMENT'] as const;
export type SpecLeaf = typeof SPEC_LEAVES[number];

export const SPEC_KINDS = [
  'SOFA', 'ARMCHAIR', 'TABLE', 'ROUND_TABLE', 'CABINET', 'SHELF', 'BED', 'RUG', 'LAMP', 'PLANT', 'CHAIR', 'STOOL',
  'KITCHEN_RUN', 'VANITY', 'PLANTER', 'WARDROBE', 'DRESSER', 'FRIDGE', 'RECLINER', 'TV_UNIT', 'SHOWER', 'TOILET',
  'BATH', 'CURTAIN', 'BLIND', 'WASHER', 'MODEL',
] as const;
export type SpecKind = typeof SPEC_KINDS[number];

/**
 * Pieces whose factory-built model replaces HOMATCH's drawn piece in the
 * walkthrough. Anything with parts that open, switch or slide (wardrobes,
 * kitchens, fridges, lamps, curtains, a TV) keeps HOMATCH's own piece so its
 * interactions keep working; the factory still builds it for the render.
 */
export const RUNTIME_KINDS: ReadonlySet<SpecKind> = new Set<SpecKind>([
  'SOFA', 'ARMCHAIR', 'RECLINER', 'TABLE', 'ROUND_TABLE', 'BED', 'RUG', 'PLANT', 'PLANTER', 'CHAIR', 'STOOL',
]);

/** The forms a reading names (reconstructRead OBJECT_FORMS). */
export const SPEC_FORMS = ['STRAIGHT', 'ROUNDED', 'CURVED', 'ROUND', 'OVAL', 'SHELL', 'L_SHAPED', 'U_SHAPED'] as const;
/** The surface patterns a reading or material names (finishTextures SurfacePattern). */
export const SPEC_PATTERNS = ['WOOD_PLANK', 'WOOD_HERRINGBONE', 'TILE', 'STONE', 'CONCRETE', 'CARPET', 'PAINT', 'FABRIC', 'WOOD_GRAIN', 'LEATHER'] as const;

export type Provenance = 'OBSERVED' | 'INFERRED' | 'DESIGN';
export type XY = [number, number];
export type XYZ = [number, number, number];

export interface SpecSurface {
  id: string;
  /** A catalogue material id (its maps are resolved on the server, never sent by the browser). */
  material: string | null;
  color: string;
  roughness: number;
  metalness: number;
  pattern: string | null;
  /** The colour a picture showed, balancing a material's texture toward it. */
  tint: string | null;
}

export interface SpecMaterial {
  id: string;
  baseColor: string;
  roughness: number;
  metalness: number;
  /** Metres one texture tile covers, [u, v]. */
  tileM: XY;
  rotationDeg: number;
  normalScale: number;
}

export interface SpecRoom { id: string; kind: string; polygon: XY[]; outdoor: boolean; floor: string; ceiling: string | null }
export interface SpecOpening {
  id: string; kind: 'DOOR' | 'WINDOW'; offsetM: number; widthM: number; sillM: number; heightM: number;
  /** Additive (still hm-scene-1): present only when the plan says how it closes. */
  leaf?: SpecLeaf;
  /** The wall face a swinging leaf opens towards (L: left walking start→end). */
  swing?: 'L' | 'R';
}
/**
 * A straight flight (geometry StairMesh): it starts at the edge a→b and climbs
 * (UP) or descends (DOWN) `runM` towards the LEFT of a→b, in `treads` equal
 * steps over `riseM`. Built architecture: never moved, never furniture.
 */
export interface SpecStair { id: string; a: XY; b: XY; runM: number; riseM: number; treads: number; direction: 'UP' | 'DOWN' }
export interface SpecWall {
  id: string; kind: 'EXTERIOR' | 'INTERIOR'; start: XY; end: XY; thicknessM: number; heightM: number;
  openings: SpecOpening[];
  faces: Array<{ side: 'L' | 'R'; from: number; to: number; surface: string }>;
}
export interface SpecRailing { id: string; a: XY; b: XY; heightM: number }

export interface SpecObject {
  id: string;
  kind: SpecKind;
  /** MODEL: the catalogue asset code whose model the factory places (resolved on the server). */
  model: string | null;
  form: string | null;
  size: { w: number; d: number; h: number };
  at: XY;
  elevationM: number;
  /** Radians about z; the piece's front faces −y_local turned by this (HOMATCH's convention). */
  rotation: number;
  colors: Record<string, string>;
  provenance: Provenance;
  /** Export this piece's model for the walkthrough (one model per group). */
  runtime: boolean;
  group: string | null;
}

export interface SpecCamera {
  position: XYZ;
  target: XYZ;
  /** Vertical field of view, degrees. */
  fovDeg: number;
  near: number;
  far: number;
  aspect: number;
  background: string | null;
  /** The source picture's own section cut: wall heights for the render only. */
  cut: { exteriorM: number; interiorM: number } | null;
}

export interface SceneBuildSpec {
  version: typeof SPEC_VERSION;
  units: 'm';
  coordinateSystem: 'PLAN_XY_Z_UP';
  source: { kind: 'PICTURE' | 'FLOOR_PLAN' | 'DESIGN'; architecture: Provenance; furnishing: Provenance };
  ceilingHeightM: number;
  rooms: SpecRoom[];
  walls: SpecWall[];
  railings: SpecRailing[];
  /**
   * Additive and optional (still hm-scene-1): absent means none. Left out
   * rather than empty so a spec without stairs hashes exactly as before.
   */
  stairs?: SpecStair[];
  surfaces: SpecSurface[];
  materials: SpecMaterial[];
  objects: SpecObject[];
  frames: string;
  lighting: { timeOfDay: 'DAY' | 'SUNSET' | 'EVENING' | 'NIGHT'; temperature: 'WARM' | 'NEUTRAL' | 'COOL'; interior: number; sun: XYZ };
  camera: SpecCamera | null;
  render: { width: number; height: number; samples: number };
  outputs: { render: boolean; scene: boolean; objects: boolean };
}

// ── Validation ───────────────────────────────────────────────────────

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;
const HEX = /^#[0-9a-f]{6}$/;
const CODE = /^[a-z0-9][a-z0-9_./-]{0,79}$/;

export class SpecError extends Error {
  path: string;
  constructor(path: string, message: string) { super(`${path}: ${message}`); this.path = path; }
}

const fail = (path: string, msg: string): never => { throw new SpecError(path, msg); };
const obj = (v: unknown, p: string): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : fail(p, 'not an object'));
const arr = (v: unknown, p: string, max: number): unknown[] => (Array.isArray(v) ? (v.length <= max ? v : fail(p, `more than ${max}`)) : fail(p, 'not a list'));
const num = (v: unknown, p: string, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : fail(p, `not a number in [${lo}, ${hi}]`));
const id = (v: unknown, p: string): string => (typeof v === 'string' && ID.test(v) ? v : fail(p, 'bad id'));
const hex = (v: unknown, p: string): string => (typeof v === 'string' && HEX.test(v.toLowerCase()) ? v.toLowerCase() : fail(p, 'bad colour'));
const hexOrNull = (v: unknown, p: string) => (v == null ? null : hex(v, p));
const oneOf = <T extends string>(v: unknown, p: string, set: readonly T[]): T => (set.includes(v as T) ? v as T : fail(p, `not one of ${set.join('|')}`));
const bool = (v: unknown, p: string): boolean => (typeof v === 'boolean' ? v : fail(p, 'not a boolean'));
const xy = (v: unknown, p: string): XY => { const a = arr(v, p, 2); if (a.length !== 2) fail(p, 'not a point'); return [num(a[0], `${p}[0]`, -SPEC_LIMITS.coord, SPEC_LIMITS.coord), num(a[1], `${p}[1]`, -SPEC_LIMITS.coord, SPEC_LIMITS.coord)]; };
const xyz = (v: unknown, p: string, lim = 2000): XYZ => { const a = arr(v, p, 3); if (a.length !== 3) fail(p, 'not a 3D point'); return [num(a[0], `${p}[0]`, -lim, lim), num(a[1], `${p}[1]`, -lim, lim), num(a[2], `${p}[2]`, -lim, lim)]; };
const PROV = ['OBSERVED', 'INFERRED', 'DESIGN'] as const;

/**
 * A spec, bounded and type-exact, or a SpecError naming the first problem.
 * Unknown fields are dropped (never passed on to the factory).
 */
export function validateSceneSpec(raw: unknown): SceneBuildSpec {
  const r = obj(raw, 'spec');
  if (r.version !== SPEC_VERSION) fail('version', 'unsupported');
  if (r.units !== 'm' || r.coordinateSystem !== 'PLAN_XY_Z_UP') fail('units', 'unsupported');
  const src = obj(r.source, 'source');
  const ceilingHeightM = num(r.ceilingHeightM, 'ceilingHeightM', 1.8, SPEC_LIMITS.height);

  const surfaces = arr(r.surfaces, 'surfaces', SPEC_LIMITS.surfaces).map((v, i) => {
    const s = obj(v, `surfaces[${i}]`);
    return {
      id: typeof s.id === 'string' && /^(floor|ceiling|wall):[A-Za-z0-9_.:-]{1,120}$/.test(s.id) ? s.id : fail(`surfaces[${i}].id`, 'bad surface id'),
      material: s.material == null ? null : typeof s.material === 'string' && ID.test(s.material) ? s.material : fail(`surfaces[${i}].material`, 'bad material id'),
      color: hex(s.color, `surfaces[${i}].color`),
      roughness: num(s.roughness, `surfaces[${i}].roughness`, 0, 1),
      metalness: num(s.metalness, `surfaces[${i}].metalness`, 0, 1),
      pattern: s.pattern == null ? null : oneOf(s.pattern, `surfaces[${i}].pattern`, SPEC_PATTERNS),
      tint: hexOrNull(s.tint, `surfaces[${i}].tint`),
    };
  });
  const surfaceIds = new Set(surfaces.map((s) => s.id));
  if (surfaceIds.size !== surfaces.length) fail('surfaces', 'duplicate id');
  const surfaceRef = (v: unknown, p: string) => (typeof v === 'string' && surfaceIds.has(v) ? v : fail(p, 'unknown surface'));

  const materials = arr(r.materials, 'materials', SPEC_LIMITS.materials).map((v, i) => {
    const m = obj(v, `materials[${i}]`);
    return {
      id: typeof m.id === 'string' && ID.test(m.id) ? m.id : fail(`materials[${i}].id`, 'bad id'),
      baseColor: hex(m.baseColor, `materials[${i}].baseColor`),
      roughness: num(m.roughness, `materials[${i}].roughness`, 0, 1),
      metalness: num(m.metalness, `materials[${i}].metalness`, 0, 1),
      tileM: ((t) => [num(t[0], `materials[${i}].tileM[0]`, 0.02, 20), num(t[1], `materials[${i}].tileM[1]`, 0.02, 20)] as XY)(arr(m.tileM, `materials[${i}].tileM`, 2)),
      rotationDeg: num(m.rotationDeg, `materials[${i}].rotationDeg`, -360, 360),
      normalScale: num(m.normalScale, `materials[${i}].normalScale`, 0, 4),
    };
  });
  const materialIds = new Set(materials.map((m) => m.id));
  for (const s of surfaces) if (s.material && !materialIds.has(s.material)) fail(`surface ${s.id}`, 'material not declared');

  const rooms = arr(r.rooms, 'rooms', SPEC_LIMITS.rooms).map((v, i) => {
    const m = obj(v, `rooms[${i}]`);
    const polygon = arr(m.polygon, `rooms[${i}].polygon`, SPEC_LIMITS.polygonPoints).map((p, j) => xy(p, `rooms[${i}].polygon[${j}]`));
    if (polygon.length < 3) fail(`rooms[${i}].polygon`, 'fewer than 3 points');
    return {
      id: id(m.id, `rooms[${i}].id`), kind: typeof m.kind === 'string' && /^[A-Z_]{2,20}$/.test(m.kind) ? m.kind : fail(`rooms[${i}].kind`, 'bad kind'),
      polygon, outdoor: bool(m.outdoor, `rooms[${i}].outdoor`), floor: surfaceRef(m.floor, `rooms[${i}].floor`),
      ceiling: m.ceiling == null ? null : surfaceRef(m.ceiling, `rooms[${i}].ceiling`),
    };
  });

  const walls = arr(r.walls, 'walls', SPEC_LIMITS.walls).map((v, i) => {
    const w = obj(v, `walls[${i}]`);
    const start = xy(w.start, `walls[${i}].start`); const end = xy(w.end, `walls[${i}].end`);
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (length < 0.05) fail(`walls[${i}]`, 'degenerate');
    const heightM = num(w.heightM, `walls[${i}].heightM`, 0.3, SPEC_LIMITS.height);
    const openings = arr(w.openings, `walls[${i}].openings`, SPEC_LIMITS.openingsPerWall).map((o, j) => {
      const q = obj(o, `walls[${i}].openings[${j}]`);
      const p = `walls[${i}].openings[${j}]`;
      const widthM = num(q.widthM, `${p}.widthM`, 0.2, Math.max(0.2, length));
      const offsetM = num(q.offsetM, `${p}.offsetM`, widthM / 2 - 0.01, length - widthM / 2 + 0.01);
      const sillM = num(q.sillM, `${p}.sillM`, 0, heightM - 0.1);
      const opening: SpecOpening = { id: id(q.id, `${p}.id`), kind: oneOf(q.kind, `${p}.kind`, ['DOOR', 'WINDOW'] as const), offsetM, widthM, sillM, heightM: num(q.heightM, `${p}.heightM`, 0.1, heightM - sillM) };
      if (q.leaf != null) opening.leaf = oneOf(q.leaf, `${p}.leaf`, SPEC_LEAVES);
      if (q.swing != null) opening.swing = oneOf(q.swing, `${p}.swing`, ['L', 'R'] as const);
      return opening;
    });
    const faces = arr(w.faces, `walls[${i}].faces`, SPEC_LIMITS.facesPerWall).map((f, j) => {
      const q = obj(f, `walls[${i}].faces[${j}]`);
      const from = num(q.from, `walls[${i}].faces[${j}].from`, -0.01, length + 0.01);
      return { side: oneOf(q.side, `walls[${i}].faces[${j}].side`, ['L', 'R'] as const), from, to: num(q.to, `walls[${i}].faces[${j}].to`, from, length + 0.01), surface: surfaceRef(q.surface, `walls[${i}].faces[${j}].surface`) };
    });
    return { id: id(w.id, `walls[${i}].id`), kind: oneOf(w.kind, `walls[${i}].kind`, ['EXTERIOR', 'INTERIOR'] as const), start, end, thicknessM: num(w.thicknessM, `walls[${i}].thicknessM`, 0.03, 1), heightM, openings, faces };
  });

  const railings = arr(r.railings, 'railings', SPEC_LIMITS.railings).map((v, i) => {
    const q = obj(v, `railings[${i}]`);
    return { id: id(q.id, `railings[${i}].id`), a: xy(q.a, `railings[${i}].a`), b: xy(q.b, `railings[${i}].b`), heightM: num(q.heightM, `railings[${i}].heightM`, 0.5, 1.6) };
  });

  const stairs: SpecStair[] = r.stairs == null ? [] : arr(r.stairs, 'stairs', SPEC_LIMITS.stairs).map((v, i) => {
    const q = obj(v, `stairs[${i}]`);
    const p = `stairs[${i}]`;
    const a = xy(q.a, `${p}.a`); const b = xy(q.b, `${p}.b`);
    num(Math.hypot(b[0] - a[0], b[1] - a[1]), `${p}.width`, ...SPEC_LIMITS.stairWidthM);
    const treads = num(q.treads, `${p}.treads`, ...SPEC_LIMITS.treads);
    if (!Number.isInteger(treads)) fail(`${p}.treads`, 'not a whole number');
    return {
      id: id(q.id, `${p}.id`), a, b, runM: num(q.runM, `${p}.runM`, ...SPEC_LIMITS.stairRunM),
      riseM: num(q.riseM, `${p}.riseM`, 0.5, SPEC_LIMITS.height), treads,
      direction: oneOf(q.direction, `${p}.direction`, ['UP', 'DOWN'] as const),
    };
  });
  if (new Set(stairs.map((s) => s.id)).size !== stairs.length) fail('stairs', 'duplicate id');

  const objects = arr(r.objects, 'objects', SPEC_LIMITS.objects).map((v, i) => {
    const o = obj(v, `objects[${i}]`);
    const p = `objects[${i}]`;
    const kind = oneOf(o.kind, `${p}.kind`, SPEC_KINDS);
    const size = obj(o.size, `${p}.size`);
    const colors: Record<string, string> = {};
    const c = obj(o.colors ?? {}, `${p}.colors`);
    if (Object.keys(c).length > SPEC_LIMITS.colorSlots) fail(`${p}.colors`, 'too many slots');
    for (const [k, val] of Object.entries(c)) { if (!/^[a-z][a-z0-9_]{0,23}$/.test(k)) fail(`${p}.colors`, 'bad slot'); colors[k] = hex(val, `${p}.colors.${k}`); }
    const model = o.model == null ? null : typeof o.model === 'string' && CODE.test(o.model) ? o.model : fail(`${p}.model`, 'bad asset code');
    if (kind === 'MODEL' && !model) fail(`${p}.model`, 'a MODEL needs its asset code');
    return {
      id: id(o.id, `${p}.id`), kind, model,
      form: o.form == null ? null : oneOf(o.form, `${p}.form`, SPEC_FORMS),
      size: { w: num(size.w, `${p}.size.w`, ...SPEC_LIMITS.size), d: num(size.d, `${p}.size.d`, ...SPEC_LIMITS.size), h: num(size.h, `${p}.size.h`, 0.005, SPEC_LIMITS.height) },
      at: xy(o.at, `${p}.at`), elevationM: num(o.elevationM, `${p}.elevationM`, 0, SPEC_LIMITS.height), rotation: num(o.rotation, `${p}.rotation`, -7, 7),
      colors, provenance: oneOf(o.provenance, `${p}.provenance`, PROV), runtime: bool(o.runtime, `${p}.runtime`),
      group: o.group == null ? null : id(o.group, `${p}.group`),
    };
  });
  if (new Set(objects.map((o) => o.id)).size !== objects.length) fail('objects', 'duplicate id');

  const l = obj(r.lighting, 'lighting');
  const camera = r.camera == null ? null : ((c) => {
    const cut = c.cut == null ? null : ((k) => ({ exteriorM: num(k.exteriorM, 'camera.cut.exteriorM', 0.2, SPEC_LIMITS.height), interiorM: num(k.interiorM, 'camera.cut.interiorM', 0.2, SPEC_LIMITS.height) }))(obj(c.cut, 'camera.cut'));
    return {
      position: xyz(c.position, 'camera.position'), target: xyz(c.target, 'camera.target'), fovDeg: num(c.fovDeg, 'camera.fovDeg', 0.05, 120),
      near: num(c.near, 'camera.near', 0.001, 100), far: num(c.far, 'camera.far', 1, 5000), aspect: num(c.aspect, 'camera.aspect', 0.2, 5),
      background: hexOrNull(c.background, 'camera.background'), cut,
    };
  })(obj(r.camera, 'camera'));
  const rr = obj(r.render, 'render');
  const out = obj(r.outputs, 'outputs');
  return {
    version: SPEC_VERSION, units: 'm', coordinateSystem: 'PLAN_XY_Z_UP',
    source: { kind: oneOf(src.kind, 'source.kind', ['PICTURE', 'FLOOR_PLAN', 'DESIGN'] as const), architecture: oneOf(src.architecture, 'source.architecture', PROV), furnishing: oneOf(src.furnishing, 'source.furnishing', PROV) },
    ceilingHeightM, rooms, walls, railings, ...(stairs.length ? { stairs } : {}), surfaces, materials, objects,
    frames: hex(r.frames, 'frames'),
    lighting: {
      timeOfDay: oneOf(l.timeOfDay, 'lighting.timeOfDay', ['DAY', 'SUNSET', 'EVENING', 'NIGHT'] as const),
      temperature: oneOf(l.temperature, 'lighting.temperature', ['WARM', 'NEUTRAL', 'COOL'] as const),
      interior: num(l.interior, 'lighting.interior', 0, 1), sun: xyz(l.sun, 'lighting.sun', 10),
    },
    camera,
    render: { width: num(rr.width, 'render.width', ...SPEC_LIMITS.renderEdge), height: num(rr.height, 'render.height', ...SPEC_LIMITS.renderEdge), samples: num(rr.samples, 'render.samples', ...SPEC_LIMITS.samples) },
    outputs: { render: bool(out.render, 'outputs.render'), scene: bool(out.scene, 'outputs.scene'), objects: bool(out.objects, 'outputs.objects') },
  };
}

/** Stable JSON (sorted keys): the same spec hashes the same, so the same build is the same job. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

/** The pieces that share one exported model: same kind, form, size (to the centimetre) and colours. */
export function objectGroup(o: Pick<SpecObject, 'kind' | 'form' | 'size' | 'colors'>): string {
  const cm = (x: number) => Math.round(x * 100);
  const colors = Object.keys(o.colors).sort().map((k) => `${k}${o.colors[k].slice(1)}`).join('');
  let h = 2166136261;
  for (const ch of `${o.kind}|${o.form ?? ''}|${cm(o.size.w)}x${cm(o.size.d)}x${cm(o.size.h)}|${colors}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return `g${o.kind.toLowerCase().replace(/_/g, '')}-${h.toString(36)}`.slice(0, 40);
}
