// The picture's depth, measured off the page's thread (a Web Worker): a slow
// phone never freezes the page, and the page's time limit always holds.
// Depth Anything V2 small (ONNX, q8) on WebAssembly — the path every device
// has. The picture arrives already reduced to the model's own size.

import { env, pipeline, RawImage } from '@huggingface/transformers';

const MODEL = 'onnx-community/depth-anything-v2-small';
env.allowLocalModels = false;

type Estimator = (image: unknown) => Promise<unknown>;
let estimator: Promise<Estimator> | null = null;

interface Ask { id: number; width: number; height: number; rgba: ArrayBuffer }

self.onmessage = async (e: MessageEvent<Ask>) => {
  const { id, width, height, rgba } = e.data;
  const post = (m: Record<string, unknown>, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage({ id, ...m }, transfer);
  try {
    if (!estimator) {
      const files = new Map<string, { loaded: number; total: number }>();
      estimator = pipeline('depth-estimation', MODEL, {
        device: 'wasm', dtype: 'q8',
        progress_callback: (info: unknown) => {
          const p = info as { status?: string; file?: string; loaded?: number; total?: number } | null;
          if (p?.status !== 'progress' || typeof p.file !== 'string') return;
          files.set(p.file, { loaded: Number(p.loaded) || 0, total: Number(p.total) || 0 });
          const all = [...files.values()];
          const total = all.reduce((s, f) => s + f.total, 0);
          if (total > 0) post({ progress: all.reduce((s, f) => s + f.loaded, 0) / total });
        },
      }) as unknown as Promise<Estimator>;
      estimator.catch(() => { estimator = null; });
    }
    const run = await estimator;
    post({ measuring: true });
    const image = new RawImage(new Uint8ClampedArray(rgba), width, height, 4);
    type Out = { predicted_depth?: { data?: ArrayLike<number>; dims?: number[] } };
    const out = (await run(image)) as Out | Out[];
    const t = Array.isArray(out) ? out[0]?.predicted_depth : out?.predicted_depth;
    if (!t?.data || !Array.isArray(t.dims)) throw new Error('NO_DEPTH');
    const dims = t.dims.slice(-2);
    const data = Float32Array.from(t.data as ArrayLike<number>);
    post({ depth: { data, height: dims[0], width: dims[1] } }, [data.buffer]);
  } catch (err) {
    post({ error: String((err as Error)?.message ?? err).slice(0, 200) });
  }
};
