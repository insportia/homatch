// The picture's depth, estimated in the browser (Depth Anything V2, small, ONNX through transformers.js).
//
// Runs on the customer's device: no server, no GPU job, no new service, no
// key. The model (≈ 27 MB quantised) is fetched once from the Hugging Face CDN
// and kept in the browser's cache; the library itself is loaded only when a
// picture is entered (a separate chunk, never in the main bundle). WebGPU when
// the device has it, WebAssembly otherwise.

import type { DepthMap } from './depthMesh';

export const DEPTH_MODEL = 'onnx-community/depth-anything-v2-small';

type Progress = (fraction: number | null) => void;
type Estimator = (image: unknown) => Promise<unknown>;

/** A model that has not arrived (a blocked or stalled network) never keeps the customer waiting longer than this. */
export const DEPTH_TIMEOUT_MS = 60_000;
const within = <T,>(p: Promise<T>, ms: number): Promise<T> => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('DEPTH_TIMEOUT')), ms);
  p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
});

let estimator: Promise<Estimator> | null = null;
const cache = new Map<string, DepthMap>();

async function load(progress: Progress): Promise<Estimator> {
  const tf = await import('@huggingface/transformers');
  tf.env.allowLocalModels = false;
  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (info: unknown) => {
    const p = info as { status?: string; file?: string; loaded?: number; total?: number } | null;
    if (p?.status !== 'progress' || typeof p.file !== 'string') return;
    files.set(p.file, { loaded: Number(p.loaded) || 0, total: Number(p.total) || 0 });
    const all = [...files.values()];
    const total = all.reduce((s, f) => s + f.total, 0);
    progress(total > 0 ? all.reduce((s, f) => s + f.loaded, 0) / total : null);
  };
  const gpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
  if (gpu) {
    try {
      return await tf.pipeline('depth-estimation', DEPTH_MODEL, { device: 'webgpu', dtype: 'fp16', progress_callback }) as unknown as Estimator;
    } catch { /* no usable adapter: WebAssembly below */ }
  }
  return await tf.pipeline('depth-estimation', DEPTH_MODEL, { device: 'wasm', dtype: 'q8', progress_callback }) as unknown as Estimator;
}

/** The depth of the picture behind `key` (asked again, the same answer from memory). */
export async function estimateDepth(key: string, picture: Blob, progress: Progress = () => {}): Promise<DepthMap> {
  const hit = cache.get(key);
  if (hit) return hit;
  if (!estimator) estimator = load(progress).catch((e) => { estimator = null; throw e; });
  const run = await within(estimator, DEPTH_TIMEOUT_MS);
  const tf = await import('@huggingface/transformers');
  const image = await tf.RawImage.fromBlob(picture);
  type Out = { predicted_depth?: { data?: ArrayLike<number>; dims?: number[] } };
  const out = (await within(run(image), DEPTH_TIMEOUT_MS)) as Out | Out[];
  const t = Array.isArray(out) ? out[0]?.predicted_depth : out?.predicted_depth;
  if (!t?.data || !Array.isArray(t.dims)) throw new Error('NO_DEPTH');
  const dims = t.dims.slice(-2) as number[];
  const map: DepthMap = { data: t.data, height: dims[0], width: dims[1] };
  cache.set(key, map);
  return map;
}
