// The uploaded-model inspector, against GLBs assembled here byte by byte.

import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectModel, MODEL_LIMITS, normalize, tokens } from '../modelInspect.ts';

/* ── A tiny glTF writer ─────────────────────────────────────────────── */

const pad4 = (n) => (4 - (n % 4)) % 4;

function glb(json, bin = null, { version = 2, magic = 0x46546c67 } = {}) {
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonPadded = Buffer.concat([jsonBytes, Buffer.alloc(pad4(jsonBytes.length), 0x20)]);
  const parts = [jsonPadded];
  let total = 12 + 8 + jsonPadded.length;
  let binPadded = null;
  if (bin) {
    binPadded = Buffer.concat([bin, Buffer.alloc(pad4(bin.length))]);
    total += 8 + binPadded.length;
  }
  const header = Buffer.alloc(12);
  header.writeUInt32LE(magic, 0);
  header.writeUInt32LE(version, 4);
  header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonPadded.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const out = [header, jsonHeader, ...parts];
  if (binPadded) {
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(binPadded.length, 0);
    binHeader.writeUInt32LE(0x004e4942, 4);
    out.push(binHeader, binPadded);
  }
  return new Uint8Array(Buffer.concat(out));
}

/** One box of the given size, shared by every mesh; node names decide what it "is". */
function boxModel({ names = ['Mesh'], size = [1, 1, 1], extra = {}, nodeExtras = [] } = {}) {
  const [x, y, z] = size;
  const positions = new Float32Array([
    0, 0, 0, x, 0, 0, x, y, 0, 0, y, 0,
    0, 0, z, x, 0, z, x, y, z, 0, y, z,
  ]);
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
    2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 0, 3, 7, 0, 7, 4,
  ]);
  const bin = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(indices.buffer)]);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: names.map((_, i) => i) }],
    nodes: names.map((name, i) => ({ name, mesh: 0, translation: [0, 0, 0], ...(nodeExtras[i] ? { extras: nodeExtras[i] } : {}) })),
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [0, 0, 0], max: [x, y, z] },
      { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 96 },
      { buffer: 0, byteOffset: 96, byteLength: 72 },
    ],
    buffers: [{ byteLength: bin.length }],
    ...extra,
  };
  return { json, bin };
}

const inspect = (model) => inspectModel(glb(model.json, model.bin));

/* ── What it accepts, and what it concludes ────────────────────────── */

test('a named apartment is FULLY_STRUCTURED, with honest counts', () => {
  const r = inspect(boxModel({
    names: ['Floor_Living', 'Wall_N', 'Wall_E', 'Wall_S', 'Wall_W', 'Sofa', 'Ceiling'],
    size: [8, 2.7, 6],
  }));
  assert.equal(r.ok, true, JSON.stringify(r));
  const a = r.analysis;
  assert.equal(a.editability, 'FULLY_STRUCTURED');
  assert.equal(a.stats.container, 'GLB');
  assert.equal(a.stats.triangles, 7 * 12);
  assert.equal(a.stats.meshNodes, 7);
  assert.deepEqual(a.semantics.counts, { FLOOR: 1, WALL: 4, CEILING: 1, DOOR: 0, WINDOW: 0, FURNITURE: 1 });
  assert.deepEqual(a.semantics.rooms, ['living']);
  assert.equal(a.normalization.scale, 1);
  assert.equal(a.normalization.upAxis, 'Y');
  assert.deepEqual(a.normalization.sizeM, [8, 2.7, 6]);
  assert.deepEqual(a.warnings, []);
});

test('one baked mesh is a VISUAL_MODEL, whatever it is called', () => {
  const r = inspect(boxModel({ names: ['Floor and walls'], size: [8, 2.7, 6] }));
  assert.equal(r.ok, true);
  assert.equal(r.analysis.editability, 'VISUAL_MODEL');
});

test('some identified parts make it PARTIALLY_STRUCTURED', () => {
  const r = inspect(boxModel({ names: ['Object001', 'Object002', 'Object003', 'Sofa'], size: [8, 2.7, 6] }));
  assert.equal(r.analysis.editability, 'PARTIALLY_STRUCTURED');
  assert.equal(r.analysis.semantics.unidentified, 3);
});

test('nothing identifiable is a VISUAL_MODEL', () => {
  const r = inspect(boxModel({ names: ['Object001', 'Object002'], size: [8, 2.7, 6] }));
  assert.equal(r.analysis.editability, 'VISUAL_MODEL');
});

test('HOMATCH extras declare roles and rooms explicitly', () => {
  const r = inspect(boxModel({
    names: ['a', 'b', 'c', 'd'],
    size: [8, 2.7, 6],
    nodeExtras: [
      { homatch: { role: 'floor', room: 'Kitchen' } },
      { homatch: { role: 'WALL' } }, { homatch: { role: 'WALL' } }, { homatch: { role: 'WALL' } },
    ],
  }));
  assert.equal(r.analysis.editability, 'FULLY_STRUCTURED');
  assert.deepEqual(r.analysis.semantics.rooms, ['Kitchen']);
});

test('a self-contained .gltf with an embedded buffer is accepted', () => {
  const { json, bin } = boxModel({ names: ['Floor', 'Wall', 'Wall', 'Wall'], size: [5, 2.6, 4] });
  json.buffers[0].uri = `data:application/octet-stream;base64,${bin.toString('base64')}`;
  const r = inspectModel(new Uint8Array(Buffer.from(JSON.stringify(json))));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.analysis.stats.container, 'GLTF');
});

/* ── Normalization ─────────────────────────────────────────────────── */

test('centimetres are detected and converted, and the correction is stated', () => {
  const r = inspect(boxModel({ names: ['Mesh'], size: [800, 270, 600] }));
  assert.equal(r.analysis.normalization.units, 'cm');
  assert.equal(r.analysis.normalization.scale, 0.01);
  assert.deepEqual(r.analysis.normalization.sizeM, [8, 2.7, 6]);
  assert.ok(r.analysis.warnings.includes('UNITS_CENTIMETRES'));
});

test('millimetres are detected', () => {
  const r = inspect(boxModel({ names: ['Mesh'], size: [8000, 2700, 6000] }));
  assert.equal(r.analysis.normalization.units, 'mm');
  assert.deepEqual(r.analysis.normalization.sizeM, [8, 2.7, 6]);
});

test('a Z-up export is turned upright, and says so', () => {
  const r = inspect(boxModel({ names: ['Mesh'], size: [8, 6, 2.7] }));
  assert.equal(r.analysis.normalization.upAxis, 'Z');
  assert.deepEqual(r.analysis.normalization.sizeM, [8, 2.7, 6]);
  assert.ok(r.analysis.warnings.includes('UP_AXIS_CORRECTED'));
});

test('an object smaller than a room is flagged, not rescaled', () => {
  const n = normalize([0.9, 0.8, 0.9], []);
  assert.equal(n.scale, 1);
  const warnings = [];
  normalize([0.9, 0.8, 0.9], warnings);
  assert.deepEqual(warnings, ['SMALLER_THAN_A_ROOM']);
});

/* ── Refusals ──────────────────────────────────────────────────────── */

test('not glTF at all', () => {
  assert.equal(inspectModel(new Uint8Array(Buffer.from('PK\x03\x04 this is a zip file, not a model'))).reason, 'NOT_GLTF');
  const { json, bin } = boxModel();
  assert.equal(inspectModel(glb(json, bin, { magic: 0x12345678 })).reason, 'NOT_GLTF');
});

test('glTF 1.0 is refused by version', () => {
  const { json, bin } = boxModel();
  assert.equal(inspectModel(glb(json, bin, { version: 1 })).reason, 'UNSUPPORTED_VERSION');
  json.asset.version = '1.0';
  assert.equal(inspectModel(glb(json, bin)).reason, 'UNSUPPORTED_VERSION');
});

test('external buffers and images are refused: a model never fetches anything', () => {
  const a = boxModel();
  a.json.buffers.push({ byteLength: 10, uri: 'https://example.com/steal.bin' });
  assert.equal(inspect(a).reason, 'EXTERNAL_RESOURCE');
  const b = boxModel();
  b.json.buffers.push({ byteLength: 10, uri: '../../etc/passwd' });
  assert.equal(inspect(b).reason, 'EXTERNAL_RESOURCE');
  const c = boxModel({ extra: { images: [{ uri: 'textures/wood.png' }] } });
  assert.equal(inspect(c).reason, 'EXTERNAL_RESOURCE');
});

test('an extension HOMATCH cannot decode is refused by name', () => {
  const r = inspect(boxModel({ extra: { extensionsRequired: ['KHR_draco_mesh_compression', 'ACME_secret_format'], extensionsUsed: ['ACME_secret_format'] } }));
  assert.equal(r.reason, 'UNSUPPORTED_EXTENSION');
  assert.equal(r.detail, 'ACME_secret_format');
  const ok = inspect(boxModel({ extra: { extensionsRequired: ['KHR_mesh_quantization'], extensionsUsed: ['KHR_mesh_quantization'] } }));
  assert.equal(ok.ok, true);
});

test('offsets that point outside the file are refused', () => {
  const a = boxModel();
  a.json.bufferViews[1].byteLength = 4000;
  assert.equal(inspect(a).reason, 'MALFORMED');
  const b = boxModel();
  b.json.accessors[1].count = 3600;
  assert.equal(inspect(b).reason, 'MALFORMED');
  const c = boxModel();
  c.json.buffers[0].byteLength = 99999;
  assert.equal(inspect(c).reason, 'MALFORMED');
});

test('a node graph with a cycle is refused', () => {
  const a = boxModel({ names: ['A', 'B'] });
  a.json.nodes[0].children = [1];
  a.json.nodes[1].children = [0];
  assert.equal(inspect(a).reason, 'MALFORMED');
});

test('a model with no surfaces is empty', () => {
  const a = boxModel();
  a.json.meshes[0].primitives[0].mode = 1; // lines
  assert.equal(inspect(a).reason, 'EMPTY_MODEL');
});

test('too many triangles is refused before anything is built', () => {
  const count = MODEL_LIMITS.maxTriangles + 10;
  const { json, bin } = boxModel();
  const strip = Buffer.alloc(count);
  const all = Buffer.concat([bin, strip]);
  json.bufferViews.push({ buffer: 0, byteOffset: bin.length, byteLength: count });
  json.accessors.push({ bufferView: 2, componentType: 5121, count, type: 'SCALAR' });
  json.meshes[0].primitives[0] = { attributes: { POSITION: 0 }, indices: 2, mode: 5 };
  json.buffers[0].byteLength = all.length;
  const r = inspectModel(glb(json, all));
  assert.equal(r.reason, 'TOO_COMPLEX');
});

function pngHeader(width, height) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

test('embedded textures are measured; an oversized one is refused', () => {
  const small = boxModel();
  const png = pngHeader(1024, 512);
  small.json.images = [{ uri: `data:image/png;base64,${png.toString('base64')}` }];
  const ok = inspect(small);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.analysis.stats.maxTextureDimension, 1024);

  const big = boxModel();
  const huge = pngHeader(16384, 16);
  big.json.images = [{ uri: `data:image/png;base64,${huge.toString('base64')}` }];
  assert.equal(inspect(big).reason, 'TEXTURE_TOO_LARGE');

  const junk = boxModel();
  junk.json.images = [{ uri: `data:image/png;base64,${Buffer.from('not an image').toString('base64')}` }];
  assert.equal(inspect(junk).reason, 'BAD_TEXTURE');

  const script = boxModel();
  script.json.images = [{ uri: `data:text/html;base64,${Buffer.from('<script>').toString('base64')}` }];
  assert.equal(inspect(script).reason, 'MALFORMED');
});

test('names are split into words the way exporters write them', () => {
  assert.deepEqual(tokens('LivingRoom_Floor.001'), ['living', 'room', 'floor']);
  assert.deepEqual(tokens('wall-north 2'), ['wall', 'north']);
  assert.deepEqual(tokens(null), []);
});
