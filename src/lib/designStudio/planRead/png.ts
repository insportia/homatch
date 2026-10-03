// HOMATCH DESIGN STUDIO — a PNG's pixels at bit depths below 8 (1, 2, 4).
//
// Scanned and exported floor plans are often 1-bit. The general PNG decoder the
// edge function uses returned those rows wrongly (production 2026-10-03: a
// clean 1-bit plan came back mostly inverted and broken into dots, so fusion
// judged its ink, found no doorway in any wall and "stairs" in the bedrooms).
// This reads exactly what the PNG specification says, for greyscale and
// indexed colour at depths 1, 2 and 4, non-interlaced: inflate, undo each row's
// filter (the filter unit is one byte below depth 8), unpack.
//
// Pure: the inflater is passed in (pako on the edge, zlib in tests).

export interface LowDepthPng { width: number; height: number; depth: number; colorType: number; samples: Uint8Array; palette: Array<[number, number, number]> | null }

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

/** The header of a PNG: size, bit depth, colour type, interlace. Null when it is not a PNG. */
export function pngHeader(bytes: Uint8Array): { width: number; height: number; depth: number; colorType: number; interlace: number } | null {
  if (bytes.length < 33 || SIG.some((v, i) => bytes[i] !== v)) return null;
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== 'IHDR') return null;
  return { width: u32(bytes, 16), height: u32(bytes, 20), depth: bytes[24], colorType: bytes[25], interlace: bytes[28] };
}

/**
 * One sample per pixel of a greyscale or indexed PNG below 8 bits, or null when
 * the picture is anything else (8/16-bit, colour, interlaced): those take the
 * general decoder.
 */
export function decodeLowDepthPng(bytes: Uint8Array, inflate: (data: Uint8Array) => Uint8Array): LowDepthPng | null {
  const h = pngHeader(bytes);
  if (!h || h.depth >= 8 || h.interlace !== 0 || (h.colorType !== 0 && h.colorType !== 3)) return null;
  const parts: Uint8Array[] = [];
  let palette: Array<[number, number, number]> | null = null;
  let o = 8;
  while (o + 8 <= bytes.length) {
    const n = u32(bytes, o);
    const type = String.fromCharCode(bytes[o + 4], bytes[o + 5], bytes[o + 6], bytes[o + 7]);
    const data = bytes.subarray(o + 8, o + 8 + n);
    if (type === 'IDAT') parts.push(data);
    if (type === 'PLTE') { palette = []; for (let i = 0; i + 2 < data.length; i += 3) palette.push([data[i], data[i + 1], data[i + 2]]); }
    if (type === 'IEND') break;
    o += 12 + n;
  }
  if (!parts.length || (h.colorType === 3 && !palette)) return null;
  const total = parts.reduce((s, p) => s + p.length, 0);
  const z = new Uint8Array(total);
  let k = 0;
  for (const p of parts) { z.set(p, k); k += p.length; }
  const raw = inflate(z);
  const rowBytes = Math.ceil((h.width * h.depth) / 8);
  if (raw.length < (rowBytes + 1) * h.height) return null;
  const rows = new Uint8Array(rowBytes * h.height);
  for (let y = 0; y < h.height; y += 1) {
    const f = raw[y * (rowBytes + 1)];
    const src = y * (rowBytes + 1) + 1;
    const dst = y * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const a = x >= 1 ? rows[dst + x - 1] : 0;
      const b = y ? rows[dst - rowBytes + x] : 0;
      const c = y && x >= 1 ? rows[dst - rowBytes + x - 1] : 0;
      let pred = 0;
      if (f === 1) pred = a;
      else if (f === 2) pred = b;
      else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      rows[dst + x] = (raw[src + x] + pred) & 255;
    }
  }
  const max = (1 << h.depth) - 1;
  const samples = new Uint8Array(h.width * h.height);
  for (let y = 0; y < h.height; y += 1) {
    for (let x = 0; x < h.width; x += 1) {
      const bit = x * h.depth;
      samples[y * h.width + x] = (rows[y * rowBytes + (bit >> 3)] >> (8 - h.depth - (bit & 7))) & max;
    }
  }
  return { width: h.width, height: h.height, depth: h.depth, colorType: h.colorType, samples, palette };
}

/** Grey bytes (0..255) for a low-depth PNG: greyscale levels stretched, palette entries by luma. */
export function lowDepthGray(png: LowDepthPng): Uint8Array {
  const out = new Uint8Array(png.samples.length);
  const max = (1 << png.depth) - 1;
  if (png.colorType === 3 && png.palette) {
    const luma = png.palette.map(([r, g, b]) => Math.round((r * 299 + g * 587 + b * 114) / 1000));
    for (let i = 0; i < out.length; i += 1) out[i] = luma[png.samples[i]] ?? 255;
  } else {
    for (let i = 0; i < out.length; i += 1) out[i] = Math.round((png.samples[i] * 255) / max);
  }
  return out;
}
