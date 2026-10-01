// The hybrid engine's server calls: objects built on the GPU, and the visual check.
//
//   design-studio-reconstruct/generate         start (idempotent) — the server derives every crop itself
//   design-studio-reconstruct/generate-status  poll; on completion each model is verified server-side
//   design-studio-reconstruct/qa               source vs render from the same camera → structured differences

import { supabase } from '@/db/supabase';
import type { QaReport } from '@/lib/designStudio/hybrid/qa';

export interface GeneratedAsset {
  id: string;
  source_ref: string;
  object_key: string;
  sha256: string | null;
  bytes: number | null;
  triangles: number | null;
  textures: number | null;
  dims_m: number[] | null;
  state: 'PENDING' | 'READY' | 'FAILED' | 'DELETED';
  model_version: string;
}

export type GenerationState = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'UNAVAILABLE';

export interface GenerationStatus {
  state: GenerationState;
  assets?: GeneratedAsset[];
  timings?: Record<string, unknown>;
  cost?: Array<{ usd: number | null; basis: string; detail: string }>;
  result?: Record<string, unknown>;
  error?: string | null;
}

async function call<T>(route: string, body: Record<string, unknown>): Promise<{ data: T | null; status: number; error: string | null }> {
  const { data, error } = await supabase.functions.invoke(`design-studio-reconstruct/${route}`, { body });
  if (error) {
    // deno edge errors carry the status on the context
    const status = (error as { context?: { status?: number } }).context?.status ?? 500;
    let code: string | null = null;
    try { code = (await (error as { context?: Response }).context?.json?.())?.error ?? null; } catch { /* no body */ }
    return { data: null, status, error: code ?? error.message };
  }
  return { data: data as T, status: 200, error: null };
}

/** Start building these objects on the GPU (the same request twice is the same job). UNAVAILABLE when no GPU is configured. */
export async function startGeneration(reconstructionId: string, keys: string[]): Promise<{ jobId: string | null; state: GenerationState; error: string | null }> {
  const r = await call<{ jobId: string; state: GenerationState }>('generate', { reconstructionId, keys });
  if (r.data?.jobId) return { jobId: r.data.jobId, state: r.data.state, error: null };
  return { jobId: null, state: r.status === 503 ? 'UNAVAILABLE' : 'FAILED', error: r.error };
}

export async function generationStatus(jobId: string): Promise<GenerationStatus> {
  const r = await call<GenerationStatus>('generate-status', { jobId });
  return r.data ?? { state: 'FAILED', error: r.error };
}

export async function visualQa(input: { reconstructionId: string; render: string; objects: Array<{ key: string; type: string; label: string }>; rooms: Array<{ key: string; kind: string }> }) {
  const r = await call<{ report: QaReport; ms: number; cost: { usd: number | null; basis: string }; tokens: unknown }>('qa', input);
  return r.data;
}
