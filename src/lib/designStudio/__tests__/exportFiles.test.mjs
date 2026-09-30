// The export writers, read back byte by byte.

import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, fileSlug, jpegSize, pdfFromJpegs, zipStore } from '../exportFiles.ts';
import { summarizeDesign } from '../designSummary.ts';
import { emptyDesignState } from '../designState.ts';
import { buildSpaceModel } from '../space.ts';
import { oneBedroomScene, testAssets, testMaterials } from './fixtures.mjs';

// A 2×1 baseline JPEG (hand-made SOF0, enough for the size reader and a PDF).
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x02, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  0xff, 0xd9,
]);

test('crc32 is the standard one', () => {
  assert.equal(crc32(new TextEncoder().encode('hello')), 0x3610a686);
  assert.equal(crc32(new Uint8Array()), 0);
});

test('a ZIP reads back: every entry, name, size and checksum', () => {
  const files = [
    { name: '01-overview.jpg', data: JPEG },
    { name: '02-მისაღები.jpg', data: new TextEncoder().encode('second file') },
  ];
  const zip = zipStore(files);
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const endAt = zip.length - 22;
  assert.equal(v.getUint32(endAt, true), 0x06054b50);
  assert.equal(v.getUint16(endAt + 10, true), 2);
  let at = v.getUint32(endAt + 16, true);
  const dec = new TextDecoder();
  for (const f of files) {
    assert.equal(v.getUint32(at, true), 0x02014b50);
    const nameLen = v.getUint16(at + 28, true);
    const localAt = v.getUint32(at + 42, true);
    assert.equal(dec.decode(zip.subarray(at + 46, at + 46 + nameLen)), f.name);
    assert.equal(v.getUint32(at + 16, true), crc32(f.data));
    const localName = v.getUint16(localAt + 26, true);
    const data = zip.subarray(localAt + 30 + localName, localAt + 30 + localName + v.getUint32(localAt + 18, true));
    assert.deepEqual([...data], [...f.data]);
    at += 46 + nameLen;
  }
});

test('the JPEG size reader finds the frame', () => {
  assert.deepEqual(jpegSize(JPEG), { width: 2, height: 1 });
  assert.equal(jpegSize(new Uint8Array([0x89, 0x50])), null);
});

test('a PDF has one page per image and a correct cross-reference table', () => {
  const pdf = pdfFromJpegs([JPEG, JPEG, JPEG], [842, 595], 'Two-bedroom, Vake');
  const text = new TextDecoder('latin1').decode(pdf);
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.match(text, /\/Type \/Pages \/Count 3/);
  assert.equal((text.match(/\/Subtype \/Image/g) ?? []).length, 3);
  const startxref = Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.ok(text.slice(startxref).startsWith('xref'));
  // Every xref offset points at its object.
  const rows = text.slice(startxref).split('\n').slice(3).filter((r) => / n $/.test(r));
  rows.forEach((row, i) => {
    const off = Number(row.slice(0, 10));
    assert.ok(text.slice(off).startsWith(`${i + 1} 0 obj`), `object ${i + 1} not at ${off}`);
  });
  assert.throws(() => pdfFromJpegs([new Uint8Array([1, 2, 3])]));
});

test('file names are safe and never empty', () => {
  assert.equal(fileSlug('Two-bedroom apartment, Vake'), 'two-bedroom-apartment-vake');
  assert.equal(fileSlug('ჩემი ბინა'), 'design');
  assert.equal(fileSlug('Café Été'), 'cafe-ete');
});

test('a design summary names each room’s finishes and furniture', () => {
  const space = buildSpaceModel(oneBedroomScene());
  const walls = space.surfaces.filter((s) => s.kind === 'WALL' && s.roomId === 'r-living').map((s) => s.id);
  const state = {
    ...emptyDesignState(),
    palette: ['#f2eee6'],
    surfaces: {
      ...Object.fromEntries(walls.map((id) => [id, { materialId: null, color: '#b6bfa7', finish: null, locked: false }])),
      'floor:r-living': { materialId: 'm-oak', color: null, finish: null, locked: false },
    },
    objects: [
      { instanceId: 'a', assetId: 'dev/sofa-3', roomId: 'r-living', position: { x: 1, y: 0, z: 1 }, rotationY: 0, materialVariant: null, colorOverride: null, locked: false },
      { instanceId: 'b', assetId: 'dev/sofa-3', roomId: 'r-living', position: { x: 3, y: 0, z: 1 }, rotationY: 0, materialVariant: null, colorOverride: null, locked: false },
    ],
  };
  const s = summarizeDesign(state, space, testAssets(), testMaterials());
  const living = s.rooms.find((r) => r.roomId === 'r-living');
  assert.deepEqual(living.walls, { color: '#b6bfa7', materialName: null });
  assert.deepEqual(living.floor, { color: '#b48b5e', materialName: 'm-oak' });
  assert.deepEqual(living.furniture, [{ name: 'dev/sofa-3', count: 2 }]);
  assert.equal(s.pieces, 2);
  assert.equal(s.rooms.find((r) => r.roomId === 'r-bed').walls, null);
});
