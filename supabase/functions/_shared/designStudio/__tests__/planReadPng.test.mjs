// PNGs below 8 bits are read by the specification: inflate, unfilter (one byte
// per filter unit), unpack most-significant bits first.

import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { decodeLowDepthPng, lowDepthGray, pngHeader } from '../planRead/png.ts';

const inflate = (z) => new Uint8Array(zlib.inflateSync(z));

function crc32(buf) {
  let c; const t = [];
  for (let n = 0; n < 256; n += 1) { c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  let x = 0xffffffff;
  for (const b of buf) x = t[(x ^ b) & 255] ^ (x >>> 8);
  return (x ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, c]);
}
/** A PNG from packed rows; `filter(y)` picks each row's filter (0 none, 1 Sub, 2 Up). */
function makePng({ width, height, depth, colorType, rows, palette = null, filter = () => 0 }) {
  const rowBytes = Math.ceil((width * depth) / 8);
  const raw = [];
  for (let y = 0; y < height; y += 1) {
    const f = filter(y); const cur = rows[y]; const prev = y ? rows[y - 1] : new Uint8Array(rowBytes);
    const enc = new Uint8Array(rowBytes);
    for (let x = 0; x < rowBytes; x += 1) enc[x] = (cur[x] - (f === 1 ? (x ? cur[x - 1] : 0) : f === 2 ? prev[x] : 0)) & 255;
    raw.push(Buffer.from([f]), Buffer.from(enc));
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = depth; ihdr[9] = colorType;
  return new Uint8Array(Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    ...(palette ? [chunk('PLTE', Buffer.from(palette.flat()))] : []),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(raw))), chunk('IEND', Buffer.alloc(0)),
  ]));
}
/** Pack samples (one per pixel) into rows of `depth` bits, most significant first. */
function pack(samples, width, height, depth) {
  const rowBytes = Math.ceil((width * depth) / 8);
  return Array.from({ length: height }, (_, y) => {
    const row = new Uint8Array(rowBytes);
    for (let x = 0; x < width; x += 1) { const bit = x * depth; row[bit >> 3] |= samples[y * width + x] << (8 - depth - (bit & 7)); }
    return row;
  });
}

test('a 2-bit greyscale PNG, rows filtered None / Sub / Up, reads back exactly', () => {
  const width = 7; const height = 3;
  const samples = Uint8Array.from({ length: width * height }, (_, i) => (i * 3 + (i >> 2)) % 4);
  const png = makePng({ width, height, depth: 2, colorType: 0, rows: pack(samples, width, height, 2), filter: (y) => y });
  const got = decodeLowDepthPng(png, inflate);
  assert.deepEqual(Array.from(got.samples), Array.from(samples));
  assert.deepEqual(Array.from(lowDepthGray(got)).slice(0, 4), Array.from(samples).slice(0, 4).map((v) => Math.round((v * 255) / 3)));
});

test('a 4-bit indexed PNG reads through its palette', () => {
  const width = 5; const height = 2;
  const palette = [[255, 255, 255], [0, 0, 0], [200, 0, 0]];
  const samples = Uint8Array.from([0, 1, 2, 1, 0, 2, 2, 0, 1, 1]);
  const png = makePng({ width, height, depth: 4, colorType: 3, rows: pack(samples, width, height, 4), palette, filter: () => 1 });
  const got = decodeLowDepthPng(png, inflate);
  assert.deepEqual(Array.from(got.samples), Array.from(samples));
  assert.deepEqual(Array.from(lowDepthGray(got)), Array.from(samples).map((i) => [255, 0, 60][i]));
});

test('8-bit, colour and interlaced pictures are left to the general decoder', () => {
  const png8 = makePng({ width: 2, height: 1, depth: 8, colorType: 0, rows: [new Uint8Array([0, 255])] });
  assert.equal(pngHeader(png8).depth, 8);
  assert.equal(decodeLowDepthPng(png8, inflate), null);
  assert.equal(decodeLowDepthPng(new Uint8Array([1, 2, 3]), inflate), null);
});
