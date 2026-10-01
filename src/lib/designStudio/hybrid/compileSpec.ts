// HOMATCH'S CANONICAL SCENE → THE FACTORY'S SCENE BUILD SPEC. Deterministic.
//
// The canonical scene (the SpaceModel the floor-plan generator built and the
// DesignState the reading or the customer furnished) stays the product's
// truth. This compiles it, with the walkthrough's own rules (default finishes,
// the colours a picture showed, railings on open balcony edges), into the
// bounded description the Blender factory builds. The same scene compiles to
// the same spec, byte for byte.

import type { CatalogAsset, CatalogMaterial } from '../catalog.ts';
import type { DesignState, ObjectInstance } from '../designState.ts';
import { seenColors, shapedAsset } from '../objectShape.ts';
import { pbrRepeat } from '../pbrMaps.ts';
import type { Point, SpaceModel } from '../space.ts';
import { ceilingSurfaceId, floorSurfaceId } from '../space.ts';
import {
  objectGroup, RUNTIME_KINDS, SPEC_FORMS, SPEC_KINDS, SPEC_PATTERNS, SPEC_VERSION,
  type Provenance, type SceneBuildSpec, type SpecCamera, type SpecKind, type SpecMaterial, type SpecObject, type SpecSurface, type XY,
} from './sceneSpec.ts';

/** The walkthrough's own finishes when a design says nothing (SceneController TONE). */
export const DEFAULT_FINISH = { floor: '#d8c4a6', outdoor: '#c3cabe', wall: '#f7f5f1', ceiling: '#fbfbf9', frames: '#f4f4f2' };

export interface CompileInput {
  space: SpaceModel;
  state: DesignState;
  assets: ReadonlyMap<string, CatalogAsset>;
  materials: ReadonlyMap<string, CatalogMaterial>;
  source: SceneBuildSpec['source'];
  /** three.js camera pose (SceneController SourcePose) and what the picture showed around it. */
  camera: { position: [number, number, number]; target: [number, number, number]; fov: number; near: number; far: number; aspect: number; background: string | null; cut: { exteriorM: number; interiorM: number } | null } | null;
  render?: { edge?: number; samples?: number };
  outputs: SceneBuildSpec['outputs'];
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const rp = (p: Point): XY => [r3(p.x), r3(p.y)];
/** three.js world (x, up, −north) → plan (x, north, up). */
const fromThree = (v: [number, number, number]): [number, number, number] => [r3(v[0]), r3(-v[2]), r3(v[1])];
const lower = (c: string | null | undefined) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null);

/** The colours of a piece's parts as the walkthrough paints them (SceneController.buildObject). */
export function pieceColors(asset: CatalogAsset, obj: Pick<ObjectInstance, 'materialVariant' | 'colorOverride' | 'shape'>): Record<string, string> {
  const base: Record<string, string> = {};
  for (const s of asset.materialSlots) base[s.id] = s.defaultColor;
  const v = obj.materialVariant ? asset.variants.find((x) => x.id === obj.materialVariant) : null;
  if (v) Object.assign(base, v.colors);
  let colors = base;
  if (obj.shape) colors = seenColors(asset, base, obj.colorOverride, obj.shape);
  else if (obj.colorOverride) {
    const main = asset.materialSlots.find((s) => s.id === 'body' || s.id === 'top' || s.id === 'pot')?.id ?? 'body';
    colors = { ...base, [main]: obj.colorOverride };
  }
  const out: Record<string, string> = {};
  for (const k of Object.keys(colors).sort().slice(0, 12)) {
    const c = lower(colors[k]);
    if (c && /^[a-z][a-z0-9_]{0,23}$/.test(k)) out[k] = c;
  }
  return out;
}

/** Edges of an outdoor floor with no wall along them: where a railing stands (SceneController). */
export function railingEdges(space: SpaceModel): Array<{ a: Point; b: Point }> {
  const onWall = (a: Point, b: Point) => space.walls.some((w) => {
    const s = w.mesh.start; const e = w.mesh.end;
    const len = Math.hypot(e.x - s.x, e.y - s.y) || 1;
    const dist = (p: Point) => Math.abs((e.x - s.x) * (s.y - p.y) - (s.x - p.x) * (e.y - s.y)) / len;
    const along = (p: Point) => ((p.x - s.x) * (e.x - s.x) + (p.y - s.y) * (e.y - s.y)) / (len * len);
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return dist(a) < 0.08 && dist(b) < 0.08 && along(m) > 0 && along(m) < 1;
  });
  const out: Array<{ a: Point; b: Point }> = [];
  for (const room of space.rooms) {
    if (!room.outdoor) continue;
    for (let i = 0; i < room.polygon.length; i += 1) {
      const a = room.polygon[i]; const b = room.polygon[(i + 1) % room.polygon.length];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 0.3 || onWall(a, b)) continue;
      out.push({ a, b });
    }
  }
  return out;
}

const SUN: Record<string, [number, number, number]> = {
  // SceneController lightRig sunPos (three) → plan: (x, −z, y).
  DAY: [-7, 5, 13], SUNSET: [14, -4, 3.5], EVENING: [12, -8, 5], NIGHT: [-6, 8, 12],
};

/** The direction toward the sun, unit length. */
const unit = (v: [number, number, number]): [number, number, number] => { const n = Math.hypot(...v) || 1; return [r3(v[0] / n), r3(v[1] / n), r3(v[2] / n)]; };

export function compileSceneSpec(input: CompileInput): SceneBuildSpec {
  const { space, state, assets, materials } = input;
  const surfaces = new Map<string, SpecSurface>();
  const usedMaterials = new Map<string, SpecMaterial>();
  const surface = (id: string, fallback: string): string => {
    if (surfaces.has(id)) return id;
    const a = state.surfaces[id];
    const mat = a?.materialId ? materials.get(a.materialId) ?? null : null;
    const roughness = a?.finish === 'GLOSS' ? 0.25 : a?.finish === 'SATIN' ? 0.55 : a?.finish === 'MATTE' ? 0.95 : mat?.pbr.roughness ?? 0.9;
    if (mat && !usedMaterials.has(mat.id) && usedMaterials.size < 48) {
      // The walkthrough's own tile rule (pbrMaps.pbrRepeat): the same metres per tile in both.
      const [rx, ry] = pbrRepeat(mat.pbr); // repeats per metre
      const tx = 1 / Math.max(rx, 1e-3); const ty = 1 / Math.max(ry, 1e-3);
      usedMaterials.set(mat.id, {
        id: mat.id, baseColor: lower(mat.pbr.baseColor) ?? '#ffffff', roughness: Math.max(0, Math.min(1, mat.pbr.roughness ?? 0.8)),
        metalness: Math.max(0, Math.min(1, mat.pbr.metalness ?? 0)),
        tileM: [r3(Math.max(0.02, Math.min(20, tx))), r3(Math.max(0.02, Math.min(20, ty)))],
        rotationDeg: Math.max(-360, Math.min(360, mat.pbr.controls?.rotationDeg ?? mat.pbr.rotationDeg ?? 0)),
        normalScale: Math.max(0, Math.min(4, mat.pbr.controls?.normalScale ?? 1)),
      });
    }
    const pattern = (a?.pattern ?? null) as string | null;
    surfaces.set(id, {
      id,
      material: mat && usedMaterials.has(mat.id) ? mat.id : null,
      color: lower(a?.color) ?? lower(mat?.pbr.baseColor) ?? fallback,
      roughness: Math.max(0, Math.min(1, roughness)),
      metalness: Math.max(0, Math.min(1, mat?.pbr.metalness ?? 0)),
      pattern: pattern && (SPEC_PATTERNS as readonly string[]).includes(pattern) ? pattern : null,
      tint: lower((a as { tint?: string | null } | undefined)?.tint ?? null),
    });
    return id;
  };

  const rooms = space.rooms.slice(0, 80).map((room) => ({
    id: room.id, kind: room.kind, polygon: room.polygon.slice(0, 64).map(rp), outdoor: room.outdoor,
    floor: surface(floorSurfaceId(room.id), room.outdoor ? DEFAULT_FINISH.outdoor : DEFAULT_FINISH.floor),
    ceiling: room.outdoor ? null : surface(ceilingSurfaceId(room.id), DEFAULT_FINISH.ceiling),
  }));

  const walls = space.walls.slice(0, 400).map((w) => ({
    id: w.id, kind: w.kind, start: rp(w.mesh.start), end: rp(w.mesh.end), thicknessM: r3(w.mesh.thicknessM), heightM: r3(w.mesh.heightM),
    openings: w.mesh.openings.slice(0, 16).map((o) => ({ id: o.id, kind: o.kind, offsetM: r3(o.offsetM), widthM: r3(o.widthM), sillM: r3(o.sillM), heightM: r3(o.heightM) })),
    faces: w.segments.slice(0, 24).map((s) => ({ side: s.side, from: r3(s.from), to: r3(Math.max(s.from, s.to)), surface: surface(s.surfaceId, DEFAULT_FINISH.wall) })),
  }));

  const railings = railingEdges(space).slice(0, 120).map((e, i) => ({ id: `rail-${i}`, a: rp(e.a), b: rp(e.b), heightM: 1.05 }));

  const objects: SpecObject[] = [];
  for (const obj of state.objects.slice(0, 300)) {
    const own = assets.get(obj.assetId);
    if (!own) continue;
    const asset = shapedAsset(own, { shape: obj.shape });
    const kind = (own.procedural ? own.procedural.kind : 'MODEL') as SpecKind;
    if (!(SPEC_KINDS as readonly string[]).includes(kind)) continue;
    const form = obj.shape?.form && (SPEC_FORMS as readonly string[]).includes(obj.shape.form) ? obj.shape.form : null;
    const provenance: Provenance = obj.provenance ? (obj.provenance.basis === 'OBSERVED' || obj.provenance.confirmed ? 'OBSERVED' : 'INFERRED') : 'DESIGN';
    const piece: SpecObject = {
      id: obj.instanceId, kind, model: kind === 'MODEL' ? own.code : null, form,
      size: { w: r3(Math.max(0.02, asset.widthM)), d: r3(Math.max(0.02, asset.depthM)), h: r3(Math.max(0.005, asset.heightM)) },
      at: [r3(obj.position.x), r3(obj.position.z)], elevationM: r3(Math.max(0, obj.position.y)), rotation: r3(obj.rotationY),
      colors: own.procedural ? pieceColors(own, obj) : {}, provenance,
      runtime: input.outputs.objects && RUNTIME_KINDS.has(kind), group: null,
    };
    if (piece.runtime) piece.group = objectGroup(piece);
    objects.push(piece);
  }

  const cam: SpecCamera | null = input.camera ? {
    position: fromThree(input.camera.position), target: fromThree(input.camera.target), fovDeg: r3(input.camera.fov),
    near: input.camera.near, far: input.camera.far, aspect: r3(input.camera.aspect), background: lower(input.camera.background),
    cut: input.camera.cut ? { exteriorM: r3(input.camera.cut.exteriorM), interiorM: r3(input.camera.cut.interiorM) } : null,
  } : null;
  const edge = Math.max(256, Math.min(2560, Math.round(input.render?.edge ?? 1280)));
  const aspect = cam?.aspect ?? 1.5;
  const width = aspect >= 1 ? edge : Math.max(256, Math.round(edge * aspect));
  const height = aspect >= 1 ? Math.max(256, Math.round(edge / aspect)) : edge;
  const l = state.lighting;
  return {
    version: SPEC_VERSION, units: 'm', coordinateSystem: 'PLAN_XY_Z_UP',
    source: input.source,
    ceilingHeightM: r3(space.ceilingHeightM),
    rooms, walls, railings,
    surfaces: [...surfaces.values()],
    materials: [...usedMaterials.values()],
    objects,
    frames: lower(state.frames) ?? DEFAULT_FINISH.frames,
    lighting: { timeOfDay: l.timeOfDay as SceneBuildSpec['lighting']['timeOfDay'], temperature: l.temperature, interior: Math.max(0, Math.min(1, l.interiorIntensity)), sun: unit(SUN[l.timeOfDay] ?? SUN.DAY) },
    camera: cam,
    render: { width, height, samples: Math.max(1, Math.min(512, Math.round(input.render?.samples ?? 96))) },
    outputs: input.outputs,
  };
}
