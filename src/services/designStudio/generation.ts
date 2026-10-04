// Design Studio — the browser's side of OpenAI-first generation.
//
//   design-studio-reconstruct/design-spec           OpenAI's Design Specification from the customer's own source
//   design-studio-reconstruct/render-generate       one quoted picture (MASTER / ROOM / VARIANT), reserved and generated
//   design-studio-reconstruct/render-generate-step  poll: image → scene → edit map → READY (settled once)
//
// The browser never sees a prompt, a provider or a model key; it asks for a
// specification, presents a quote back, and follows the render until it is
// READY. The same idempotency key is the same work: a double tap, a reload or
// a retry of the same action never makes a second picture.

import { supabase } from '@/db/supabase';
import type { PropertyDesignDNA, RenderQuote, RenderRecord } from '@/lib/designStudio/renders/contract';
import type { DesignPreferences } from '@/lib/designStudio/planToHome';

export type GenerationMode = 'MASTER' | 'ROOM' | 'VARIANT';

type Result<T> = { data: T | null; status: number; error: string | null };

async function call<T>(route: string, body: Record<string, unknown>): Promise<Result<T>> {
  const { data, error } = await supabase.functions.invoke(`design-studio-reconstruct/${route}`, { body });
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status ?? 500;
    let code: string | null = null;
    try {
      const b = await (error as { context?: Response }).context?.json?.();
      code = typeof b?.error === 'string' ? b.error : null;
    } catch { /* no body */ }
    return { data: null, status, error: code ?? 'NETWORK' };
  }
  return { data: data as T, status: 200, error: null };
}

export interface SpecAnswer {
  jobId: string;
  mode: GenerationMode;
  dna: PropertyDesignDNA;
  summary: { style: string; quality: string; palette: Array<{ name: string; hex: string; role: string }>; conflicts: number };
}

/** OpenAI reads the customer's source with HOMATCH's evidence and writes the design specification. */
export async function requestDesignSpec(input: {
  projectId: string; versionId: string; mode: GenerationMode; idempotencyKey: string;
  look: { style: string; quality: string } | null; preferences: DesignPreferences;
  roomId?: string | null; parentRenderId?: string | null; change?: { style?: string | null; quality?: string | null; note?: string | null } | null;
}): Promise<{ spec: SpecAnswer | null; error: string | null }> {
  const r = await call<SpecAnswer>('design-spec', input as unknown as Record<string, unknown>);
  return r.data?.jobId ? { spec: r.data, error: null } : { spec: null, error: r.error ?? 'SPEC_FAILED' };
}

/** One generated picture, from a quote the customer saw. The same key is the same render. */
export async function generateRender(input: {
  quote: RenderQuote; projectId: string; versionId: string; specJobId: string; mode: GenerationMode; idempotencyKey: string;
  /** ROOM: one of the room's four 360° pictures (0 up the plan, then a quarter turn right each). */
  heading?: 0 | 1 | 2 | 3 | null;
}): Promise<{ render: RenderRecord | null; error: string | null }> {
  const r = await call<{ render: RenderRecord | null; error?: string }>('render-generate', {
    quoteToken: input.quote.token, projectId: input.projectId, versionId: input.versionId, specJobId: input.specJobId, mode: input.mode, idempotencyKey: input.idempotencyKey,
    ...(input.mode === 'ROOM' && input.heading != null ? { heading: input.heading } : {}),
  });
  return { render: r.data?.render ?? null, error: r.error ?? r.data?.error ?? null };
}

/** One poll that also moves the generation on. A transient failure answers null (keep waiting). */
export async function stepGenerated(renderIds: string[]): Promise<RenderRecord[] | null> {
  if (!renderIds.length) return [];
  const r = await call<{ renders: RenderRecord[] }>('render-generate-step', { renderIds: renderIds.slice(0, 24) });
  return r.data?.renders ?? null;
}

/** Where a generated render is (for the customer's four stages). */
export function generationStep(r: RenderRecord | null): 'QUEUED' | 'IMAGE' | 'SCENE' | 'MAP' | 'READY' | 'FAILED' {
  if (!r) return 'QUEUED';
  if (r.status === 'READY') return 'READY';
  if (r.status === 'FAILED' || r.status === 'CANCELLED') return 'FAILED';
  if (r.status === 'QUEUED') return 'QUEUED';
  if (r.status === 'RENDERING') return 'IMAGE';
  const step = (r as unknown as { timings?: { ai?: { step?: string } } }).timings?.ai?.step;
  return step === 'MAP' ? 'MAP' : 'SCENE';
}

/** A render OpenAI made (not a Blender view): its edit map comes from the picture itself. */
export const isGenerated = (r: Pick<RenderRecord, 'finish' | 'factory_job_id'> | null | undefined): boolean =>
  !!r && !r.factory_job_id && (r.finish as unknown as { generator?: string } | null)?.generator === 'OPENAI_FIRST';
