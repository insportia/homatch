// HOMATCH DESIGN STUDIO — render pictures as RGB(A) pixels, and back to PNG.
//
// The structure check and the edit mask need real pixels: the Blender picture
// and the provider's answer (JPEG or PNG) as RGB(A), the id image (a lossless
// PNG whose colours ARE the object ids) exactly as written. Pure JavaScript
// decoders (no native code in the edge runtime), bounded like rasterDecode.ts:
// a picture over MAX_MEGAPIXELS is refused rather than decoded.

import jpeg from 'npm:jpeg-js@0.4.4';
import { decode as decodePng, encode as encodePngRaw } from 'npm:fast-png@6.2.0';
import type { RgbPixels } from '../_shared/designStudio/renderCheck.ts';

const MAX_MEGAPIXELS = 17;

export type RgbaOutcome = { ok: true; img: RgbPixels } | { ok: false; reason: 'UNSUPPORTED_TYPE' | 'TOO_LARGE' | 'DECODE_FAILED' };

const sniff = (b: Uint8Array) => (b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : null);

export function decodeRgba(bytes: Uint8Array): RgbaOutcome {
  const type = sniff(bytes);
  try {
    if (type === 'image/jpeg') {
      const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: MAX_MEGAPIXELS, maxMemoryUsageInMB: 480 });
      return { ok: true, img: { width: img.width, height: img.height, data: img.data as Uint8Array, channels: 4 } };
    }
    if (type === 'image/png') {
      const img = decodePng(bytes);
      if (img.width * img.height > MAX_MEGAPIXELS * 1_000_000) return { ok: false, reason: 'TOO_LARGE' };
      const n = img.width * img.height;
      const out = new Uint8Array(n * 4);
      if (img.palette && img.palette.length) {
        if (img.depth < 8) return { ok: false, reason: 'DECODE_FAILED' };
        const pal = img.palette as number[][]; const idx = img.data as Uint8Array;
        for (let i = 0; i < n; i += 1) { const c = pal[idx[i]] ?? pal[0]; out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = c[3] ?? 255; }
      } else {
        const ch = img.channels;
        const src = img.data as Uint8Array | Uint16Array;
        const v = (k: number) => (img.depth === 16 ? (src[k] as number) >> 8 : src[k] as number);
        for (let i = 0; i < n; i += 1) {
          const s = i * ch;
          if (ch >= 3) { out[i * 4] = v(s); out[i * 4 + 1] = v(s + 1); out[i * 4 + 2] = v(s + 2); out[i * 4 + 3] = ch === 4 ? v(s + 3) : 255; }
          else { const g = v(s); out[i * 4] = g; out[i * 4 + 1] = g; out[i * 4 + 2] = g; out[i * 4 + 3] = ch === 2 ? v(s + 1) : 255; }
        }
      }
      return { ok: true, img: { width: img.width, height: img.height, data: out, channels: 4 } };
    }
    return { ok: false, reason: 'UNSUPPORTED_TYPE' };
  } catch {
    return { ok: false, reason: 'DECODE_FAILED' };
  }
}

/** RGBA → JPEG (a photograph's own format: far smaller and cheaper to encode than PNG). */
export function encodeJpeg(rgba: Uint8Array, width: number, height: number, quality = 92): Uint8Array {
  return new Uint8Array(jpeg.encode({ data: rgba, width, height }, quality).data);
}

export function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  return encodePngRaw({ width, height, data: rgba, channels: 4, depth: 8 });
}

export function rgbaOf(img: RgbPixels): Uint8Array {
  if (img.channels === 4) return img.data;
  const out = new Uint8Array(img.width * img.height * 4);
  for (let i = 0; i < img.width * img.height; i += 1) { out[i * 4] = img.data[i * 3]; out[i * 4 + 1] = img.data[i * 3 + 1]; out[i * 4 + 2] = img.data[i * 3 + 2]; out[i * 4 + 3] = 255; }
  return out;
}
