// HOMATCH DESIGN STUDIO — a floor plan's pixels, as grey bytes, for fusion.
//
// JPEG and PNG are decoded in pure JavaScript (no native code in the edge
// runtime); WebP is not decoded and the reading stays model-only (fusion
// without the raster still settles kinds, merges walls and solves the scale).
// Bounded: a picture over MAX_MEGAPIXELS is not decoded at all, so a hostile
// upload cannot exhaust the function's memory or its CPU budget (decoding is
// the costliest step: ~0.1 s per megapixel in pure JS); it is read
// model-only too. Plans are line drawings: 12 MP is ~4000×3000.

import jpeg from 'npm:jpeg-js@0.4.4';
import { decode as decodePng } from 'npm:fast-png@6.2.0';
import { toGray } from '../_shared/designStudio/planRead/raster.ts';
import type { GrayImage } from '../_shared/designStudio/planRead/types.ts';

const MAX_MEGAPIXELS = 12;

export type DecodeOutcome =
  | { ok: true; gray: GrayImage }
  | { ok: false; reason: 'UNSUPPORTED_TYPE' | 'TOO_LARGE' | 'DECODE_FAILED' };

export function decodeGray(bytes: Uint8Array, type: string, size: { width: number; height: number }): DecodeOutcome {
  if (size.width * size.height > MAX_MEGAPIXELS * 1_000_000) return { ok: false, reason: 'TOO_LARGE' };
  try {
    if (type === 'image/jpeg') {
      const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: MAX_MEGAPIXELS, maxMemoryUsageInMB: 320 });
      return { ok: true, gray: toGray(img.data, img.width, img.height, 4) };
    }
    if (type === 'image/png') {
      const img = decodePng(bytes);
      let data: Uint8Array;
      let channels = img.channels;
      if (img.palette && img.palette.length && img.depth < 8) return { ok: false, reason: 'DECODE_FAILED' };
      if (img.palette && img.palette.length) {
        // Indexed colour: expand through the palette to RGB(A).
        const pal = img.palette as number[][];
        const n = img.width * img.height;
        const width = pal[0]?.length ?? 3;
        data = new Uint8Array(n * width);
        const idx = img.data as Uint8Array;
        for (let i = 0; i < n; i += 1) {
          const c = pal[idx[i]] ?? pal[0];
          for (let k = 0; k < width; k += 1) data[i * width + k] = c[k] ?? 255;
        }
        channels = width;
      } else if (img.depth === 16) {
        const src = img.data as Uint16Array;
        data = new Uint8Array(src.length);
        for (let i = 0; i < src.length; i += 1) data[i] = src[i] >> 8;
      } else {
        data = img.data as Uint8Array;
      }
      return { ok: true, gray: toGray(data, img.width, img.height, channels) };
    }
    return { ok: false, reason: 'UNSUPPORTED_TYPE' };
  } catch {
    return { ok: false, reason: 'DECODE_FAILED' };
  }
}
