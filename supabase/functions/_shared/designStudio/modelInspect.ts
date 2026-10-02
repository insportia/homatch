// HOMATCH DESIGN STUDIO — WHAT AN UPLOADED 3D MODEL REALLY IS.
//
// A customer's glTF is untrusted input. Before it becomes a space, the
// server reads it here — the bytes, not the file name — and decides:
//
//   1. Is it glTF 2.0 at all, structurally sound, every offset in bounds?
//   2. Does it reach outside itself (external buffers or images)? Refused:
//      a model is one self-contained file, never a set of URLs to fetch.
//   3. Does it need a decoder HOMATCH does not ship? Refused, by name.
//   4. Is it light enough to open on a phone? Triangles, meshes, nodes,
//      materials, textures and texture sizes all have limits.
//   5. How to show it upright and at the right size (normalization). The
//      upload itself is never rewritten; the transform is stored beside it.
//   6. What it contains (semantic analysis) and therefore what the customer
//      can truthfully edit (editability classification):
//
//        FULLY_STRUCTURED      floors and walls are separate, named parts and
//                              almost nothing is unidentified
//        PARTIALLY_STRUCTURED  some parts are identified, the rest is not
//        VISUAL_MODEL          one baked mesh, or nothing identifiable: it
//                              can be looked at and lit, not taken apart
//
// Pure: no I/O, no Deno or Node APIs beyond TextDecoder and atob, so the same
// code runs in the edge function and in the node test suite.

import { imageSize } from './floorplanRead.ts';

export const MODEL_INSPECT_VERSION = 'ds-model-1';

export const MODEL_LIMITS = {
  maxBytes: 100 * 1024 * 1024,
  maxJsonBytes: 16 * 1024 * 1024,
  maxTriangles: 3_000_000,
  maxPrimitives: 20_000,
  maxNodes: 50_000,
  maxMaterials: 2_000,
  maxImages: 256,
  maxTextureDimension: 8192,
  maxTextureBytes: 96 * 1024 * 1024,
  maxDepth: 64,
} as const;

/** Extensions the Design Studio loader can honour (three.js GLTFLoader + Draco, Meshopt, KTX2). */
export const SUPPORTED_EXTENSIONS = new Set([
  'KHR_draco_mesh_compression',
  'EXT_meshopt_compression',
  'KHR_mesh_quantization',
  'KHR_texture_basisu',
  'KHR_texture_transform',
  'EXT_texture_webp',
  'KHR_materials_emissive_strength',
  'KHR_materials_ior',
  'KHR_materials_specular',
  'KHR_materials_transmission',
  'KHR_materials_volume',
  'KHR_materials_clearcoat',
  'KHR_materials_sheen',
  'KHR_materials_unlit',
  'KHR_materials_iridescence',
  'KHR_materials_anisotropy',
  'KHR_lights_punctual',
]);

export type ModelRefusal =
  | 'NOT_GLTF'
  | 'UNSUPPORTED_VERSION'
  | 'MALFORMED'
  | 'EXTERNAL_RESOURCE'
  | 'UNSUPPORTED_EXTENSION'
  | 'TOO_LARGE'
  | 'TOO_COMPLEX'
  | 'TEXTURE_TOO_LARGE'
  | 'BAD_TEXTURE'
  | 'EMPTY_MODEL';

export type Editability = 'FULLY_STRUCTURED' | 'PARTIALLY_STRUCTURED' | 'VISUAL_MODEL';
export type Role = 'FLOOR' | 'WALL' | 'CEILING' | 'DOOR' | 'WINDOW' | 'FURNITURE';

export interface ModelStats {
  container: 'GLB' | 'GLTF';
  bytes: number;
  triangles: number;
  primitives: number;
  meshNodes: number;
  nodes: number;
  materials: number;
  images: number;
  textureBytes: number;
  maxTextureDimension: number;
  extensions: string[];
}

export interface ModelNormalization {
  /** Multiply model units by this to get metres. */
  scale: number;
  units: 'm' | 'cm' | 'mm';
  /** 'Z' means the file was authored Z-up and is turned upright (−90° about X). */
  upAxis: 'Y' | 'Z';
  /** Size of the normalized model in metres: [width (x), height (y), depth (z)]. */
  sizeM: [number, number, number];
}

export interface ModelSemantics {
  counts: Record<Role, number>;
  unidentified: number;
  rooms: string[];
  /** Mesh-bearing node index → role, for the parts that were identified. */
  roles: Record<string, Role>;
}

export interface ModelAnalysis {
  schema: 1;
  kind: 'MODEL_ANALYSIS';
  inspectVersion: string;
  stats: ModelStats;
  normalization: ModelNormalization;
  semantics: ModelSemantics;
  editability: Editability;
  warnings: string[];
}

export type InspectResult =
  | { ok: true; analysis: ModelAnalysis }
  | { ok: false; reason: ModelRefusal; detail?: string };

// ── Parsing ──────────────────────────────────────────────────────────

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

class Refused extends Error {
  reason: ModelRefusal;
  detail?: string;
  constructor(reason: ModelRefusal, detail?: string) {
    super(reason);
    this.reason = reason;
    this.detail = detail;
  }
}
const refuse = (reason: ModelRefusal, detail?: string): never => { throw new Refused(reason, detail); };

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Parsed {
  container: 'GLB' | 'GLTF';
  gltf: Json;
  /** Buffer index → bytes, where they are available to inspect (GLB BIN, data: URIs). */
  buffers: Map<number, Uint8Array>;
}

function isWhitespace(b: number) { return b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d; }

function parseJson(bytes: Uint8Array): Json {
  if (bytes.length > MODEL_LIMITS.maxJsonBytes) refuse('TOO_LARGE', 'json');
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const value = JSON.parse(text.replace(/^﻿/, ''));
    if (!value || typeof value !== 'object' || Array.isArray(value)) refuse('MALFORMED', 'json root');
    return value;
  } catch (e) {
    if (e instanceof Refused) throw e;
    return refuse('MALFORMED', 'json');
  }
}

function decodeDataUri(uri: string, allowed: RegExp): Uint8Array {
  const m = uri.match(/^data:([^;,]*)(;base64)?,(.*)$/s);
  if (!m || !m[2]) refuse('MALFORMED', 'data uri');
  if (!allowed.test(m![1])) refuse('MALFORMED', `data uri type ${m![1]}`);
  let bin: string;
  try { bin = atob(m![3]); } catch { return refuse('MALFORMED', 'base64'); }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function parseContainer(bytes: Uint8Array): Parsed {
  if (bytes.length < 20) refuse('NOT_GLTF');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) === GLB_MAGIC) {
    const version = view.getUint32(4, true);
    if (version !== 2) refuse('UNSUPPORTED_VERSION', `glb v${version}`);
    const length = view.getUint32(8, true);
    if (length > bytes.length || length < 20) refuse('MALFORMED', 'glb length');
    let offset = 12;
    let json: Json = null;
    let bin: Uint8Array | null = null;
    let index = 0;
    while (offset + 8 <= length) {
      const chunkLength = view.getUint32(offset, true);
      const chunkType = view.getUint32(offset + 4, true);
      const start = offset + 8;
      const end = start + chunkLength;
      if (end > length) refuse('MALFORMED', 'chunk bounds');
      if (index === 0) {
        if (chunkType !== CHUNK_JSON) refuse('MALFORMED', 'first chunk is not JSON');
        json = parseJson(bytes.subarray(start, end));
      } else if (chunkType === CHUNK_BIN) {
        if (bin) refuse('MALFORMED', 'two BIN chunks');
        bin = bytes.subarray(start, end);
      }
      offset = end + ((4 - (chunkLength % 4)) % 4);
      index += 1;
    }
    if (!json) refuse('MALFORMED', 'no JSON chunk');
    const buffers = new Map<number, Uint8Array>();
    if (bin) buffers.set(0, bin);
    return { container: 'GLB', gltf: json, buffers };
  }
  let i = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (i < bytes.length && isWhitespace(bytes[i])) i += 1;
  if (bytes[i] !== 0x7b) refuse('NOT_GLTF');
  return { container: 'GLTF', gltf: parseJson(bytes), buffers: new Map() };
}

// ── Checks ───────────────────────────────────────────────────────────

const arr = (v: unknown): Json[] => (Array.isArray(v) ? v : []);
const isIndex = (v: unknown, list: unknown[]) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < list.length;
const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COUNT: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

function checkVersionAndExtensions(gltf: Json): string[] {
  const version = String(gltf.asset?.version ?? '');
  if (!/^2\.\d+$/.test(version)) refuse('UNSUPPORTED_VERSION', version || 'missing asset.version');
  const required = arr(gltf.extensionsRequired).map(String);
  const unsupported = required.filter((e) => !SUPPORTED_EXTENSIONS.has(e));
  if (unsupported.length) refuse('UNSUPPORTED_EXTENSION', unsupported.join(', '));
  return [...new Set(arr(gltf.extensionsUsed).map(String))].sort();
}

/** Every buffer is inside the file: the GLB BIN chunk or a data: URI. */
function checkBuffers(p: Parsed) {
  const buffers = arr(p.gltf.buffers);
  buffers.forEach((b, i) => {
    const byteLength = b?.byteLength;
    if (!Number.isInteger(byteLength) || byteLength < 0) refuse('MALFORMED', `buffer ${i} byteLength`);
    if (typeof b.uri === 'string') {
      if (!b.uri.startsWith('data:')) refuse('EXTERNAL_RESOURCE', `buffer ${i}`);
      const data = decodeDataUri(b.uri, /^(application\/octet-stream|application\/gltf-buffer)$/);
      if (data.length < byteLength) refuse('MALFORMED', `buffer ${i} shorter than declared`);
      p.buffers.set(i, data);
    } else if (p.container === 'GLB' && i === 0) {
      const bin = p.buffers.get(0);
      if (!bin || bin.length < byteLength) refuse('MALFORMED', 'BIN chunk shorter than buffer 0');
    } else if (b?.extensions?.EXT_meshopt_compression?.fallback === true) {
      // EXT_meshopt_compression: the uncompressed layout is a declared, data-less fallback buffer;
      // its bytes come from compressed views into a real buffer (checked below).
    } else {
      refuse('MALFORMED', `buffer ${i} has no data`);
    }
  });
  arr(p.gltf.bufferViews).forEach((v, i) => {
    const mo = v?.extensions?.EXT_meshopt_compression;
    if (mo) {
      // A compressed view's source must be real data inside the file.
      if (!isIndex(mo.buffer, buffers) || buffers[mo.buffer]?.extensions?.EXT_meshopt_compression?.fallback === true) refuse('MALFORMED', `bufferView ${i} meshopt source`);
      const so = mo.byteOffset ?? 0;
      if (!Number.isInteger(so) || so < 0 || !Number.isInteger(mo.byteLength) || mo.byteLength <= 0 || so + mo.byteLength > buffers[mo.buffer].byteLength) refuse('MALFORMED', `bufferView ${i} meshopt range`);
    }
    if (!isIndex(v?.buffer, buffers)) refuse('MALFORMED', `bufferView ${i} buffer`);
    const offset = v.byteOffset ?? 0;
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(v.byteLength) || v.byteLength <= 0) refuse('MALFORMED', `bufferView ${i} range`);
    if (offset + v.byteLength > buffers[v.buffer].byteLength) refuse('MALFORMED', `bufferView ${i} out of bounds`);
    if (v.byteStride != null && (!Number.isInteger(v.byteStride) || v.byteStride < 4 || v.byteStride > 252)) refuse('MALFORMED', `bufferView ${i} stride`);
  });
}

function checkAccessors(gltf: Json) {
  const views = arr(gltf.bufferViews);
  arr(gltf.accessors).forEach((a, i) => {
    const size = COMPONENT_BYTES[a?.componentType];
    const n = TYPE_COUNT[a?.type];
    if (!size || !n || !Number.isInteger(a.count) || a.count < 1) refuse('MALFORMED', `accessor ${i}`);
    if (a.bufferView == null) return; // zero-filled, sparse-only or Draco-decoded
    if (!isIndex(a.bufferView, views)) refuse('MALFORMED', `accessor ${i} bufferView`);
    const view = views[a.bufferView];
    const element = size * n;
    const stride = view.byteStride ?? element;
    const offset = a.byteOffset ?? 0;
    if (!Number.isInteger(offset) || offset < 0) refuse('MALFORMED', `accessor ${i} offset`);
    if (offset + stride * (a.count - 1) + element > view.byteLength) refuse('MALFORMED', `accessor ${i} out of bounds`);
  });
}

function viewBytes(p: Parsed, viewIndex: number): Uint8Array | null {
  const view = arr(p.gltf.bufferViews)[viewIndex];
  if (!view) return null;
  const buffer = p.buffers.get(view.buffer);
  if (!buffer) return null;
  const start = view.byteOffset ?? 0;
  return buffer.subarray(start, start + view.byteLength);
}

function ktx2Size(b: Uint8Array): { width: number; height: number } | null {
  const id = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 32 || !id.every((x, i) => b[i] === x)) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { width: v.getUint32(20, true), height: Math.max(1, v.getUint32(24, true)) };
}

function checkImages(p: Parsed): { textureBytes: number; maxDim: number } {
  const images = arr(p.gltf.images);
  if (images.length > MODEL_LIMITS.maxImages) refuse('TOO_COMPLEX', `${images.length} images`);
  let textureBytes = 0;
  let maxDim = 0;
  images.forEach((img, i) => {
    let data: Uint8Array | null = null;
    if (typeof img?.uri === 'string') {
      if (!img.uri.startsWith('data:')) refuse('EXTERNAL_RESOURCE', `image ${i}`);
      data = decodeDataUri(img.uri, /^image\/(png|jpeg|webp|ktx2)$/);
    } else if (img?.bufferView != null) {
      if (!isIndex(img.bufferView, arr(p.gltf.bufferViews))) refuse('MALFORMED', `image ${i} bufferView`);
      data = viewBytes(p, img.bufferView);
    } else {
      refuse('MALFORMED', `image ${i} has no data`);
    }
    if (!data) refuse('MALFORMED', `image ${i} data`);
    const size = imageSize(data!.subarray(0, Math.min(data!.length, 256 * 1024))) ?? ktx2Size(data!);
    if (!size || size.width < 1 || size.height < 1) refuse('BAD_TEXTURE', `image ${i}`);
    maxDim = Math.max(maxDim, size!.width, size!.height);
    if (size!.width > MODEL_LIMITS.maxTextureDimension || size!.height > MODEL_LIMITS.maxTextureDimension) {
      refuse('TEXTURE_TOO_LARGE', `image ${i} ${size!.width}×${size!.height}`);
    }
    textureBytes += data!.length;
  });
  if (textureBytes > MODEL_LIMITS.maxTextureBytes) refuse('TEXTURE_TOO_LARGE', `${Math.round(textureBytes / 1048576)} MB of textures`);
  return { textureBytes, maxDim };
}

// ── Scene walk: transforms, bounds, triangles ────────────────────────

type Mat4 = number[];
const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      let s = 0;
      for (let k = 0; k < 4; k += 1) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

function localMatrix(node: Json): Mat4 {
  if (Array.isArray(node.matrix) && node.matrix.length === 16 && node.matrix.every(Number.isFinite)) return node.matrix;
  const [tx, ty, tz] = Array.isArray(node.translation) ? node.translation : [0, 0, 0];
  const [qx, qy, qz, qw] = Array.isArray(node.rotation) ? node.rotation : [0, 0, 0, 1];
  const [sx, sy, sz] = Array.isArray(node.scale) ? node.scale : [1, 1, 1];
  const nums = [tx, ty, tz, qx, qy, qz, qw, sx, sy, sz];
  if (!nums.every(Number.isFinite)) refuse('MALFORMED', 'node transform');
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2, yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function transformPoint(m: Mat4, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

interface Walk {
  triangles: number;
  primitives: number;
  meshNodes: number[];
  min: [number, number, number];
  max: [number, number, number];
  boundsMissing: number;
}

function primitiveTriangles(gltf: Json, prim: Json): number {
  const accessors = arr(gltf.accessors);
  const mode = prim.mode ?? 4;
  const pos = prim.attributes?.POSITION;
  if (!isIndex(pos, accessors)) refuse('MALFORMED', 'primitive without POSITION');
  if (prim.indices != null && !isIndex(prim.indices, accessors)) refuse('MALFORMED', 'primitive indices');
  const count = prim.indices != null ? accessors[prim.indices].count : accessors[pos].count;
  if (mode === 4) return Math.floor(count / 3);
  if (mode === 5 || mode === 6) return Math.max(0, count - 2);
  return 0; // points and lines draw no surfaces
}

function walkScene(gltf: Json): Walk {
  const nodes = arr(gltf.nodes);
  const meshes = arr(gltf.meshes);
  const accessors = arr(gltf.accessors);
  if (nodes.length > MODEL_LIMITS.maxNodes) refuse('TOO_COMPLEX', `${nodes.length} nodes`);
  const scenes = arr(gltf.scenes);
  const sceneIndex = gltf.scene ?? 0;
  const roots: number[] = scenes.length
    ? (isIndex(sceneIndex, scenes) ? arr(scenes[sceneIndex].nodes) : refuse('MALFORMED', 'scene index'))
    : nodes.map((_, i) => i).filter((i) => !nodes.some((n) => arr(n?.children).includes(i)));
  const walk: Walk = {
    triangles: 0, primitives: 0, meshNodes: [], boundsMissing: 0,
    min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity],
  };
  const visited = new Set<number>();
  const visit = (index: number, parent: Mat4, depth: number) => {
    if (!isIndex(index, nodes)) refuse('MALFORMED', `node ${index}`);
    if (visited.has(index)) refuse('MALFORMED', 'node graph is not a tree');
    if (depth > MODEL_LIMITS.maxDepth) refuse('TOO_COMPLEX', 'hierarchy too deep');
    visited.add(index);
    const node = nodes[index] ?? {};
    const world = multiply(parent, localMatrix(node));
    if (node.mesh != null) {
      if (!isIndex(node.mesh, meshes)) refuse('MALFORMED', `node ${index} mesh`);
      walk.meshNodes.push(index);
      for (const prim of arr(meshes[node.mesh].primitives)) {
        walk.primitives += 1;
        if (walk.primitives > MODEL_LIMITS.maxPrimitives) refuse('TOO_COMPLEX', 'too many parts');
        walk.triangles += primitiveTriangles(gltf, prim);
        if (walk.triangles > MODEL_LIMITS.maxTriangles) refuse('TOO_COMPLEX', `over ${MODEL_LIMITS.maxTriangles} triangles`);
        const acc = accessors[prim.attributes.POSITION];
        if (Array.isArray(acc.min) && Array.isArray(acc.max) && acc.min.length === 3 && acc.max.length === 3
          && [...acc.min, ...acc.max].every(Number.isFinite)) {
          for (let c = 0; c < 8; c += 1) {
            const p = transformPoint(world, c & 1 ? acc.max[0] : acc.min[0], c & 2 ? acc.max[1] : acc.min[1], c & 4 ? acc.max[2] : acc.min[2]);
            for (let k = 0; k < 3; k += 1) {
              walk.min[k] = Math.min(walk.min[k], p[k]);
              walk.max[k] = Math.max(walk.max[k], p[k]);
            }
          }
        } else {
          walk.boundsMissing += 1;
        }
      }
    }
    for (const child of arr(node.children)) visit(child, world, depth + 1);
  };
  for (const root of roots) visit(root, IDENTITY, 0);
  return walk;
}

// ── Normalization ────────────────────────────────────────────────────

/**
 * glTF is metres and Y-up by specification, but exports get both wrong.
 * An apartment is wide and low: when the file's Z is its shortest side and
 * Y is long, it was authored Z-up. When its floor span is in the hundreds
 * or thousands, it was authored in centimetres or millimetres. Both are
 * corrections HOMATCH states, never silent.
 */
export function normalize(extent: [number, number, number], warnings: string[]): ModelNormalization {
  let [x, y, z] = extent;
  let upAxis: 'Y' | 'Z' = 'Y';
  if (z < y * 0.6 && z < x * 0.6 && y > 1.5 * z) {
    upAxis = 'Z';
    [y, z] = [z, y];
    warnings.push('UP_AXIS_CORRECTED');
  }
  const span = Math.max(x, z);
  let scale = 1;
  let units: ModelNormalization['units'] = 'm';
  if (span > 2000 && span / 1000 <= 300) { scale = 0.001; units = 'mm'; warnings.push('UNITS_MILLIMETRES'); }
  else if (span > 300 && span / 100 <= 300) { scale = 0.01; units = 'cm'; warnings.push('UNITS_CENTIMETRES'); }
  else if (span > 300) warnings.push('LARGER_THAN_A_HOME');
  const sizeM: [number, number, number] = [x * scale, y * scale, z * scale].map((v) => Math.round(v * 1000) / 1000) as [number, number, number];
  if (Math.max(sizeM[0], sizeM[2]) < 2) warnings.push('SMALLER_THAN_A_ROOM');
  return { scale, units, upAxis, sizeM };
}

// ── Semantics ────────────────────────────────────────────────────────

const WORDS: Array<[Role, RegExp]> = [
  ['FLOOR', /^(floor|floors|flooring|parquet|laminate|screed)$/],
  ['CEILING', /^(ceiling|ceilings|ceil)$/],
  ['WALL', /^(wall|walls|partition|partitions)$/],
  ['DOOR', /^(door|doors|doorway)$/],
  ['WINDOW', /^(window|windows|glazing)$/],
  ['FURNITURE', /^(sofa|couch|chair|chairs|armchair|table|desk|bed|wardrobe|closet|cabinet|cupboard|shelf|shelves|bookcase|dresser|sideboard|nightstand|stool|bench|ottoman|lamp|rug|carpet|tv|mirror|plant|curtain|curtains|furniture)$/],
];
const ROOM_WORDS = /^(living|lounge|bedroom|kitchen|bath|bathroom|wc|toilet|hall|hallway|corridor|dining|office|study|balcony|terrace|storage|laundry|nursery)$/;
const EXTRAS_ROLES = new Set<Role>(['FLOOR', 'WALL', 'CEILING', 'DOOR', 'WINDOW', 'FURNITURE']);

export function tokens(name: unknown): string[] {
  if (typeof name !== 'string') return [];
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

function roleOf(gltf: Json, nodeIndex: number): { role: Role | null; room: string | null } {
  const node = arr(gltf.nodes)[nodeIndex] ?? {};
  const extra = node.extras?.homatch;
  const declared = typeof extra?.role === 'string' ? extra.role.toUpperCase() : null;
  const declaredRoom = typeof extra?.room === 'string' ? extra.room.slice(0, 60) : null;
  if (declared && EXTRAS_ROLES.has(declared as Role)) return { role: declared as Role, room: declaredRoom };
  const mesh = arr(gltf.meshes)[node.mesh] ?? {};
  const materials = arr(mesh.primitives).map((p) => arr(gltf.materials)[p?.material]?.name);
  const words = [node.name, mesh.name, ...materials].flatMap(tokens);
  let role: Role | null = null;
  for (const [r, re] of WORDS) if (words.some((w) => re.test(w))) { role = r; break; }
  const room = declaredRoom ?? (words.find((w) => ROOM_WORDS.test(w)) ?? null);
  return { role, room };
}

export function analyseSemantics(gltf: Json, meshNodes: number[]): ModelSemantics {
  const counts: Record<Role, number> = { FLOOR: 0, WALL: 0, CEILING: 0, DOOR: 0, WINDOW: 0, FURNITURE: 0 };
  const roles: Record<string, Role> = {};
  const rooms = new Set<string>();
  let unidentified = 0;
  for (const i of meshNodes) {
    const { role, room } = roleOf(gltf, i);
    if (role) { counts[role] += 1; roles[String(i)] = role; } else unidentified += 1;
    if (room) rooms.add(room);
  }
  return { counts, unidentified, rooms: [...rooms].sort().slice(0, 50), roles };
}

export function classify(semantics: ModelSemantics, meshNodes: number): Editability {
  if (meshNodes <= 1) return 'VISUAL_MODEL';
  const identified = meshNodes - semantics.unidentified;
  const { FLOOR, WALL } = semantics.counts;
  if (FLOOR >= 1 && WALL >= 3 && semantics.unidentified <= meshNodes * 0.2) return 'FULLY_STRUCTURED';
  if (identified > 0) return 'PARTIALLY_STRUCTURED';
  return 'VISUAL_MODEL';
}

// ── Entry point ──────────────────────────────────────────────────────

export function inspectModel(bytes: Uint8Array): InspectResult {
  try {
    if (bytes.length > MODEL_LIMITS.maxBytes) refuse('TOO_LARGE');
    const parsed = parseContainer(bytes);
    const extensions = checkVersionAndExtensions(parsed.gltf);
    checkBuffers(parsed);
    checkAccessors(parsed.gltf);
    const materials = arr(parsed.gltf.materials).length;
    if (materials > MODEL_LIMITS.maxMaterials) refuse('TOO_COMPLEX', `${materials} materials`);
    const { textureBytes, maxDim } = checkImages(parsed);
    const walk = walkScene(parsed.gltf);
    if (walk.meshNodes.length === 0 || walk.triangles === 0) refuse('EMPTY_MODEL');
    const warnings: string[] = [];
    if (walk.boundsMissing) warnings.push('BOUNDS_INCOMPLETE');
    const hasBounds = walk.min.every(Number.isFinite) && walk.max.every(Number.isFinite);
    const extent: [number, number, number] = hasBounds
      ? [walk.max[0] - walk.min[0], walk.max[1] - walk.min[1], walk.max[2] - walk.min[2]]
      : [0, 0, 0];
    const normalization = normalize(extent, warnings);
    const semantics = analyseSemantics(parsed.gltf, walk.meshNodes);
    const editability = classify(semantics, walk.meshNodes.length);
    if (walk.triangles > 1_000_000) warnings.push('HEAVY_ON_PHONES');
    return {
      ok: true,
      analysis: {
        schema: 1,
        kind: 'MODEL_ANALYSIS',
        inspectVersion: MODEL_INSPECT_VERSION,
        stats: {
          container: parsed.container,
          bytes: bytes.length,
          triangles: walk.triangles,
          primitives: walk.primitives,
          meshNodes: walk.meshNodes.length,
          nodes: arr(parsed.gltf.nodes).length,
          materials,
          images: arr(parsed.gltf.images).length,
          textureBytes,
          maxTextureDimension: maxDim,
          extensions,
        },
        normalization,
        semantics,
        editability,
        warnings,
      },
    };
  } catch (e) {
    if (e instanceof Refused) return { ok: false, reason: e.reason, detail: e.detail };
    return { ok: false, reason: 'MALFORMED' };
  }
}
