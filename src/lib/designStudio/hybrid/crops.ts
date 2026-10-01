// WHERE AN OBJECT IS IN THE PICTURE — projected, not guessed.
//
// The reading gives each object's place, facing and size in plan metres, and
// the picture's camera is measured (sourceCamera.CameraFit). The object's
// box, projected through that camera, is exactly where it is drawn: its crop
// for the GPU, and the box its mask is prompted with. A margin keeps soft
// edges (cushions, leaves) inside the crop.

import type { CameraFit } from '../sourceCamera.ts';
import { projectPlan } from '../sourceCamera.ts';

export interface Crop {
  /** Fractions of the picture: left, top, right, bottom. */
  box: [number, number, number, number];
  /** The object's own box in the picture (no margin): the segmentation prompt. */
  tight: [number, number, number, number];
}

/** Projected box of an object of size (w, d, h) at plan `at`, its front facing `facingDeg` (clockwise from north). */
export function objectCrop(fit: CameraFit, at: [number, number], facingDeg: number, size: { width: number; depth: number; height: number }, margin = 0.12): Crop | null {
  const a = (facingDeg * Math.PI) / 180;
  // The object's local axes in plan: across its front (x) and toward its front (f).
  const f: [number, number] = [Math.sin(a), Math.cos(a)];
  const x: [number, number] = [Math.cos(a), -Math.sin(a)];
  const us: number[] = []; const vs: number[] = [];
  for (const sx of [-0.5, 0.5]) for (const sf of [-0.5, 0.5]) for (const h of [0, size.height]) {
    const p: [number, number] = [at[0] + x[0] * sx * size.width + f[0] * sf * size.depth, at[1] + x[1] * sx * size.width + f[1] * sf * size.depth];
    const q = projectPlan(fit, p, h);
    if (!q) return null;
    us.push(q[0]); vs.push(q[1]);
  }
  const tight: [number, number, number, number] = [Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs)];
  const mw = (tight[2] - tight[0]) * margin; const mh = (tight[3] - tight[1]) * margin;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const box: [number, number, number, number] = [clamp(tight[0] - mw), clamp(tight[1] - mh), clamp(tight[2] + mw), clamp(tight[3] + mh)];
  if (box[2] - box[0] < 0.005 || box[3] - box[1] < 0.005) return null;
  return { box: box.map((n) => Math.round(n * 1e4) / 1e4) as Crop['box'], tight: tight.map((n) => Math.round(clamp(n) * 1e4) / 1e4) as Crop['tight'] };
}
