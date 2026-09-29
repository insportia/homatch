// A reading is a proposal: normalised, bounded, never invented. And a file is
// what its bytes say it is, not what the browser declared.

import test from 'node:test';
import assert from 'node:assert/strict';
import { imageSize, sniffType, validateReading } from '../floorplanRead.ts';

test('every element arrives UNVERIFIED and missing values stay null', () => {
  const { doc } = validateReading({
    walls: [{ id: 'w1', start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, kind: 'EXTERIOR', confidence: 0.9 }],
    rooms: [{ id: 'r1', kind: 'LIVING', polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }], confidence: 0.8 }],
    detectedScale: null, ceilingHeight: null,
  }, 200, 200, 'k');
  assert.equal(doc.walls[0].state, 'UNVERIFIED');
  assert.equal(doc.rooms[0].state, 'UNVERIFIED');
  assert.equal(doc.detectedScale, null);
  assert.equal(doc.ceilingHeight, null);
  assert.equal(doc.extractionConfidence, 0.8, 'the weakest link, not the average');
});

test('malformed and out-of-image elements are dropped, not repaired', () => {
  const { doc, dropped } = validateReading({
    walls: [
      { id: 'w1', start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, kind: 'EXTERIOR', confidence: 1 },
      { id: 'w2', start: { x: 0, y: 0 }, end: { x: 9999, y: 0 }, kind: 'EXTERIOR', confidence: 1 },
      { id: 'w3', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, kind: 'SIDEWAYS', confidence: 1 },
    ],
    doors: [{ id: 'd1', wallId: 'nope', position: 0.5, widthPx: 10, confidence: 1 }],
  }, 200, 200, 'k');
  assert.deepEqual(doc.walls.map((w) => w.id), ['w1']);
  assert.equal(dropped, 2);
  assert.ok(doc.warnings.some((w) => w.code === 'OPENING_WITHOUT_WALL'));
});

test('implausible scale, ceiling and area values are not accepted as readings', () => {
  const { doc } = validateReading({
    detectedScale: 5, ceilingHeight: 40,
    rooms: [{ id: 'r', kind: 'LIVING', polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], statedAreaM2: 99999, confidence: 1 }],
  }, 10, 10, 'k');
  assert.equal(doc.detectedScale, null);
  assert.equal(doc.ceilingHeight, null);
  assert.equal(doc.rooms[0].statedAreaM2, null);
});

test('printed dimensions are kept as signals with their pixel span', () => {
  const { dimensionStrings } = validateReading({
    dimensionStrings: [
      { valueM: 4.1, from: { x: 10, y: 10 }, to: { x: 420, y: 10 }, confidence: 0.9 },
      { valueM: -3, from: { x: 0, y: 0 }, to: { x: 5, y: 0 }, confidence: 1 },
    ],
  }, 500, 500, 'k');
  assert.equal(dimensionStrings.length, 1);
  assert.equal(dimensionStrings[0].valueM, 4.1);
});

test('file types are sniffed from bytes', () => {
  assert.equal(sniffType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  assert.equal(sniffType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffType(new TextEncoder().encode('%PDF-1.7')), 'application/pdf');
  assert.equal(sniffType(new TextEncoder().encode('glTF')), 'model/gltf-binary');
  assert.equal(sniffType(new TextEncoder().encode('<html><script>')), null);
});

test('image size is read from the header', () => {
  // 1x1 PNG
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAEUlEQVR4nGP48O4FVsQwkBIABL+FIRNEZwAAAAAASUVORK5CYII=', 'base64'));
  assert.deepEqual(imageSize(png), { width: 8, height: 6 });
  // Minimal JPEG header with an SOF0 marker: 300 x 200.
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xc8, 0x01, 0x2c, 0x03]);
  assert.deepEqual(imageSize(jpeg), { width: 300, height: 200 });
});
