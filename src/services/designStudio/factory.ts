// The scene factory's server calls, and the visual check.
//
//   design-studio-reconstruct/factory          one Blender pass over a SceneBuildSpec (idempotent)
//   design-studio-reconstruct/factory-status   poll; on completion every output is verified server-side
//   design-studio-reconstruct/factory-discard  a superseded pass's outputs deleted
//   design-studio-reconstruct/qa               source vs render from the same camera → structured differences

import { supabase } from '@/db/supabase';
import type { QaReport } from '@/lib/designStudio/hybrid/qa';
import type { FactoryPoll } from '@/lib/designStudio/hybrid/orchestrate';
import type { SceneBuildSpec } from '@/lib/designStudio/hybrid/sceneSpec';

async function call<T>(route: string, body: Record<string, unknown>): Promise<{ data: T | null; status: number; error: string | null }> {
  const { data, error } = await supabase.functions.invoke(`design-studio-reconstruct/${route}`, { body });
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status ?? 500;
    let code: string | null = null;
    try { code = (await (error as { context?: Response }).context?.json?.())?.error ?? null; } catch { /* no body */ }
    return { data: null, status, error: code ?? error.message };
  }
  return { data: data as T, status: 200, error: null };
}

/** Start one factory pass (the same spec at the same pass is the same job). UNAVAILABLE when no factory is configured. */
export async function startFactory(input: { projectId: string; reconstructionId?: string | null; versionId?: string | null; pass: number; spec: SceneBuildSpec }) {
  const r = await call<{ jobId: string; state: FactoryPoll['state'] }>('factory', input as unknown as Record<string, unknown>);
  if (r.data?.jobId) return { jobId: r.data.jobId, state: r.data.state, error: null };
  return { jobId: null, state: (r.status === 503 ? 'UNAVAILABLE' : 'FAILED') as FactoryPoll['state'], error: r.error };
}

export async function factoryStatus(jobId: string): Promise<FactoryPoll> {
  const r = await call<FactoryPoll>('factory-status', { jobId });
  // A transient error while polling is not a failed pass: keep waiting (the pass is bounded by time).
  return r.data ?? { state: 'RUNNING', error: r.error };
}

export async function discardFactory(jobId: string): Promise<void> {
  await call('factory-discard', { jobId });
}

export async function visualQa(input: {
  reconstructionId?: string; floorplanId?: string; renderAssetId?: string; render?: string;
  objects: Array<{ key: string; type: string; label: string }>; rooms: Array<{ key: string; kind: string }>;
}) {
  const r = await call<{ report: QaReport; ms: number; cost: { usd: number | null; basis: string }; tokens: unknown }>('qa', input);
  return r.data;
}
