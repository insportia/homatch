// The picture's depth, estimated on the customer's device (Depth Anything V2,
// small, ONNX through transformers.js) — in a Web Worker (depth.worker.ts), so
// the page stays responsive and its time limit always holds.
//
// No server, no GPU job, no new service, no key. The model (≈ 27 MB
// quantised) is fetched once from the Hugging Face CDN and kept in the
// browser's cache; the worker and the library load only when a picture is
// entered. The picture is reduced to the model's own size first (the model
// sees ~518 px whatever it is given; a full-size picture only costs time).

import type { DepthMap } from './depthMesh';

export const DEPTH_MODEL = 'onnx-community/depth-anything-v2-small';
/** The model's own input size: the picture is reduced to this on its longer side before it is measured. */
export const DEPTH_INPUT = 518;
/** Nothing (a stalled download, a slow device) keeps the customer waiting longer than this. */
export const DEPTH_TIMEOUT_MS = 40_000;

export type DepthProgress = { stage: 'DOWNLOADING'; fraction: number } | { stage: 'MEASURING' };

let worker: Worker | null = null;
let next = 1;
const cache = new Map<string, DepthMap>();
const inflight = new Map<string, Promise<DepthMap>>();

/** The picture at the model's size, as RGBA pixels. */
export function reducedPixels(img: CanvasImageSource & { width: number; height: number }, naturalWidth: number, naturalHeight: number) {
  const s = Math.min(1, DEPTH_INPUT / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * s)); const height = Math.max(1, Math.round(naturalHeight * s));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('NO_CANVAS');
  g.drawImage(img, 0, 0, width, height);
  return { width, height, rgba: g.getImageData(0, 0, width, height).data.buffer };
}

/** The depth of the picture behind `key` (asked again, the same answer from memory). */
export function estimateDepth(key: string, img: HTMLImageElement, progress: (p: DepthProgress) => void = () => {}): Promise<DepthMap> {
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  // Already being measured (the next room, prepared while this one is walked): the same answer, not a second one.
  const busy = inflight.get(key);
  if (busy) return busy;
  let p: Promise<DepthMap>;
  try { p = measure(key, img, progress); } catch (e) { return Promise.reject(e); }
  inflight.set(key, p);
  const clear = () => { if (inflight.get(key) === p) inflight.delete(key); };
  p.then(clear, clear);
  return p;
}

function measure(key: string, img: HTMLImageElement, progress: (p: DepthProgress) => void): Promise<DepthMap> {
  const px = reducedPixels(img, img.naturalWidth, img.naturalHeight);
  if (!worker) worker = new Worker(new URL('./depth.worker.ts', import.meta.url), { type: 'module' });
  const w = worker;
  const id = next++;
  return new Promise<DepthMap>((resolve, reject) => {
    const done = (fn: () => void) => { clearTimeout(timer); w.removeEventListener('message', on); w.removeEventListener('error', fail); fn(); };
    // A worker that stalls is ended: the next picture starts a fresh one.
    const timer = setTimeout(() => done(() => { w.terminate(); if (worker === w) worker = null; reject(new Error('DEPTH_TIMEOUT')); }), DEPTH_TIMEOUT_MS);
    const fail = () => done(() => { w.terminate(); if (worker === w) worker = null; reject(new Error('DEPTH_WORKER')); });
    const on = (e: MessageEvent) => {
      const m = e.data as { id: number; progress?: number; measuring?: boolean; depth?: DepthMap; error?: string };
      if (m?.id !== id) return;
      if (typeof m.progress === 'number') progress({ stage: 'DOWNLOADING', fraction: m.progress });
      else if (m.measuring) progress({ stage: 'MEASURING' });
      else if (m.depth) done(() => { cache.set(key, m.depth!); resolve(m.depth!); });
      else if (m.error) done(() => reject(new Error(m.error)));
    };
    w.addEventListener('message', on);
    w.addEventListener('error', fail);
    w.postMessage({ id, ...px }, [px.rgba]);
  });
}
