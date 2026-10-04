// HOMATCH DESIGN STUDIO — the selected render's own camera, measured on the server.
//
// A customer's uploaded picture is measured in their browser (services/designStudio/reconstructions.ts
// measurePicture); a generated design never passes through a browser before its walkthrough, so the same
// measurement (pictureGeometry.ts measureFrame: the floor's two directions and their ratio, the outline) and the
// same top-down plan view (renderPlanView) are made here, on the render's pixels, at a reduced size (the frame is
// scale-free; the edge runtime's CPU is not). Null for a picture that is not an isometric cut-away, or that cannot
// be decoded: the reading then proceeds without it, exactly as before.

import { borderColor, measureFrame, renderPlanView } from '../../../src/lib/designStudio/pictureGeometry.ts';
import { type PictureFrame, readFrame } from '../_shared/designStudio/pictureFrame.ts';
import { decodeRgba, encodeJpeg } from './rasterRgba.ts';

/** The render is measured at this longest edge (~0.8 s of CPU on a 1536 × 1024 render). */
export const RENDER_MEASURE_EDGE_PX = 768;

export interface MeasuredRender { frame: PictureFrame; view: Uint8Array; viewWidth: number; viewHeight: number; aspect: number }

export function measureRender(bytes: Uint8Array): MeasuredRender | null {
  const decoded = decodeRgba(bytes);
  if (!decoded.ok) return null;
  const { width: W, height: H, data, channels } = decoded.img;
  const k = Math.min(1, RENDER_MEASURE_EDGE_PX / Math.max(W, H));
  const w = Math.max(64, Math.round(W * k));
  const h = Math.max(64, Math.round(H * k));
  // Box-sampled down (each target pixel the mean of its source block), on white like the browser's canvas.
  const rgba = new Uint8Array(w * h * 4);
  const grey = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.floor((y * H) / h); const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * H) / h));
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.floor((x * W) / w); const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * W) / w));
      let r = 0; let g = 0; let b = 0; let n = 0;
      for (let yy = y0; yy < y1; yy += 1) {
        for (let xx = x0; xx < x1; xx += 1) {
          const i = (yy * W + xx) * channels;
          const a = channels === 4 ? data[i + 3] / 255 : 1;
          r += data[i] * a + 255 * (1 - a); g += data[i + 1] * a + 255 * (1 - a); b += data[i + 2] * a + 255 * (1 - a); n += 1;
        }
      }
      const o = (y * w + x) * 4;
      rgba[o] = r / n; rgba[o + 1] = g / n; rgba[o + 2] = b / n; rgba[o + 3] = 255;
      grey[y * w + x] = Math.round(0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]);
    }
  }
  const measured = measureFrame(grey, w, h);
  if (!measured) return null;
  const frame = readFrame({ ...measured, background: borderColor(rgba, w, h) });
  if (!frame) return null;
  const pixels = renderPlanView(rgba, w, h, frame);
  const view = encodeJpeg(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength), frame.view.width, frame.view.height, 90);
  return { frame, view, viewWidth: frame.view.width, viewHeight: frame.view.height, aspect: W / H };
}
