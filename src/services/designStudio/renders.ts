// Design Studio renders — the browser's side of the render service.
//
//   design-studio-reconstruct/render-quote    server-computed credits, signed, 10 minutes
//   design-studio-reconstruct/render-start    the quote presented unchanged → records + one factory pass
//   design-studio-reconstruct/render-status   poll: factory → photoreal finish → structure check → READY
//   design-studio-reconstruct/render-edit     one appearance edit inside a target's own mask
//
// The browser never prices, never names a storage key to write, never sees a
// provider, a model key or a prompt: it asks for a quote, shows it, and
// presents it back. Pictures are read through short-lived signed URLs.

import { supabase } from '@/db/supabase';
import type { SceneBuildSpec } from '@/lib/designStudio/hybrid/sceneSpec';
import type { PropertyDesignDNA, RenderEdit, RenderProduct, RenderQuote, RenderRecord, SpecView } from '@/lib/designStudio/renders/contract';
import { signedUrls } from './files';

const RECORD = 'id, project_id, version_id, kind, parent_id, view, status, factory_job_id, base_key, map_key, final_key, legend, finish, edit, billing, error, created_at, updated_at';
const TERMINAL: ReadonlySet<RenderRecord['status']> = new Set(['READY', 'FAILED', 'CANCELLED']);

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

/** A fresh idempotency key for one customer action (reuse it when retrying that same action). */
export const newRenderRequestKey = (): string => `ds-${crypto.randomUUID()}`;

export async function quoteRender(input: {
  projectId: string; versionId: string; product: RenderProduct | 'DS_WALKTHROUGH'; views: number;
  /** A mode with its own measured reference (VARIANT: no plan reading); the server decides what it means. */
  mode?: 'VARIANT' | null;
}): Promise<{ quote: RenderQuote | null; error: string | null }> {
  const r = await call<RenderQuote>('render-quote', input);
  return r.data?.token ? { quote: r.data, error: null } : { quote: null, error: r.error ?? 'QUOTE_FAILED' };
}

export async function startRenders(input: {
  quote: RenderQuote; projectId: string; versionId: string; views: SpecView[]; spec: SceneBuildSpec; idempotencyKey: string;
}): Promise<{ renders: RenderRecord[]; error: string | null }> {
  const r = await call<{ renders: RenderRecord[]; error?: string }>('render-start', {
    quoteToken: input.quote.token, projectId: input.projectId, versionId: input.versionId, views: input.views, spec: input.spec, idempotencyKey: input.idempotencyKey,
  });
  return { renders: r.data?.renders ?? [], error: r.error ?? r.data?.error ?? null };
}

/** One poll. A transient failure answers null (keep waiting), never a failed render. */
export async function renderStatus(renderIds: string[]): Promise<RenderRecord[] | null> {
  if (!renderIds.length) return [];
  const r = await call<{ renders: RenderRecord[] }>('render-status', { renderIds: renderIds.slice(0, 24) });
  return r.data?.renders ?? null;
}

/** Poll until every render is READY / FAILED / CANCELLED, or the time runs out. */
export async function pollRenders(renderIds: string[], opts: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal; onUpdate?: (r: RenderRecord[]) => void } = {}): Promise<RenderRecord[]> {
  const interval = opts.intervalMs ?? 4000;
  const deadline = Date.now() + (opts.timeoutMs ?? 20 * 60_000);
  let last: RenderRecord[] = [];
  while (!opts.signal?.aborted && Date.now() < deadline) {
    const r = await renderStatus(renderIds);
    if (r) {
      last = r;
      opts.onUpdate?.(r);
      if (r.length && r.every((x) => TERMINAL.has(x.status))) break;
    }
    await new Promise((ok) => setTimeout(ok, interval));
  }
  return last;
}

export async function editRender(input: {
  renderId: string; edit: Extract<RenderEdit, { type: 'APPEARANCE' }>; newVersionId: string; quote: RenderQuote; idempotencyKey: string;
}): Promise<{ render: RenderRecord | null; error: string | null }> {
  const r = await call<{ render: RenderRecord; error?: string }>('render-edit', {
    renderId: input.renderId, targetId: input.edit.targetId, edit: input.edit, newVersionId: input.newVersionId,
    quoteToken: input.quote.token, idempotencyKey: input.idempotencyKey,
  });
  return { render: r.data?.render ?? null, error: r.error ?? r.data?.error ?? null };
}

/** The project's renders, newest first (RLS: the owner's own). */
export async function listRenders(projectId: string): Promise<RenderRecord[]> {
  const { data, error } = await supabase.from('ds_renders').select(RECORD).eq('project_id', projectId).order('created_at', { ascending: false }).limit(200);
  return error ? [] : ((data ?? []) as unknown as RenderRecord[]);
}

/** The picture a customer sees: the finished one, else Blender's. Short-lived URLs; an unsignable one is absent. */
export async function renderPictureUrls(renders: RenderRecord[], expiresIn = 600): Promise<Map<string, string>> {
  const keyOf = new Map(renders.filter((r) => r.status === 'READY').map((r) => [r.id, r.final_key ?? r.base_key] as const).filter(([, k]) => !!k) as Array<[string, string]>);
  const urls = await signedUrls([...keyOf.values()], expiresIn);
  const out = new Map<string, string>();
  for (const [id, key] of keyOf) { const u = urls.get(key); if (u) out.set(id, u); }
  return out;
}

/** The object map's id image (for picking targets on the picture). */
export async function renderMapUrl(render: RenderRecord, expiresIn = 600): Promise<string | null> {
  if (!render.map_key) return null;
  return (await signedUrls([render.map_key], expiresIn)).get(render.map_key) ?? null;
}

/** Keep the design's DNA with its version (the owner's own row; RLS decides). */
export async function saveDesignDna(versionId: string, dna: PropertyDesignDNA): Promise<boolean> {
  const { error } = await supabase.from('ds_versions').update({ design_dna: dna } as never).eq('id', versionId);
  return !error;
}
