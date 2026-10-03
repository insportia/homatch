// Design Studio — FOLLOWING ONE DESIGN TO ITS PICTURE (the browser only watches).
//
// One call covers the whole OpenAI-first generation of a design, for any
// source (floor plan or photos) and any mode (MASTER / ROOM / VARIANT):
//
//   1. the price is quoted and the customer's confirmed credits are checked;
//   2. design-spec is asked with `then` (the confirmed quote): the server
//      writes the specification, then by itself makes the design version and
//      the render, its picture and its edit map (generate.ts) — nothing waits
//      for this page;
//   3. the render is followed (render-generate-step) until it is READY.
//
// Every request is idempotent on the run's key, so this can be called again
// at any time — after a refresh, on another device, after the page was
// closed — and it picks the run up where the SERVER has it, never paying for
// a step twice. A lost connection is waiting, not failure. A stored failure
// arrives with its category (retry without uploading again, or choose
// another file).

import { supabase } from '@/db/supabase';
import type { RenderProduct, RenderRecord } from '@/lib/designStudio/renders/contract';
import type { DesignPreferences } from '@/lib/designStudio/planToHome';
import { DesignStudioError } from './projects';
import { DesignStudioFailure } from './durable';
import { generateRender, generationStep, stepGenerated, type GenerationMode } from './generation';
import { quoteRender } from './renders';

export type RunStage = 'DESIGN' | 'IMAGE' | 'RESULT';

export interface RunProgress {
  specJobId?: string | null;
  designVersionId?: string | null;
  renderId?: string | null;
  /** A failed picture asked again: a new picture of the same design (the specification is kept). */
  renderAttempt?: number;
}

export interface RunInput {
  projectId: string;
  /** The version the design is made from (the Original for a master; the design for a room or a variant). */
  versionId: string;
  mode: GenerationMode;
  /** The run's identity: the same key is the same design, wherever it got to. */
  key: string;
  look: { style: string; quality: string } | null;
  preferences: DesignPreferences;
  roomId?: string | null;
  parentRenderId?: string | null;
  change?: { style?: string | null; quality?: string | null; note?: string | null } | null;
  /** The credits the customer saw and confirmed; a different price stops before anything is spent. */
  confirmedCredits?: number | null;
  versionName: string;
  /** The customer tapped "try again": a stored, retryable failure is asked again. */
  retry?: boolean;
  progress?: RunProgress;
  onStage?: (stage: RunStage) => void;
  /** Called as the server reaches each step, so a resumed page knows where it is. */
  onProgress?: (p: RunProgress) => void | Promise<void>;
  signal?: { cancelled: boolean };
  pollMs?: number;
  timeoutMs?: number;
}

export interface RunResult { versionId: string; render: RenderRecord }

const productOf = (mode: GenerationMode): RenderProduct => (mode === 'ROOM' ? 'DS_ROOM_RENDER' : 'DS_MASTER_RENDER');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface SpecReply {
  state?: 'RUNNING' | 'DONE' | 'FAILED';
  jobId?: string;
  reason?: string;
  retryable?: boolean;
  error?: string;
  chain?: { versionId?: string; renderId?: string | null; error?: string; render?: RenderRecord | null };
}

async function askSpec(body: Record<string, unknown>): Promise<{ reply: SpecReply | null; status: number }> {
  const { data, error } = await supabase.functions.invoke('design-studio-reconstruct/design-spec', { body });
  if (!error) return { reply: data as SpecReply, status: 200 };
  const status = (error as { context?: { status?: number } }).context?.status ?? 0;
  try {
    const b = await (error as { context?: Response }).context?.json?.();
    return { reply: (b ?? null) as SpecReply | null, status };
  } catch { return { reply: null, status }; }
}

/** Codes that mean "this request can never succeed as asked" (not a network blip). */
const HARD = new Set(['BAD_REQUEST', 'NOT_FOUND', 'SOURCE_MISSING', 'QUOTE_MISMATCH', 'QUOTE_STALE', 'QUOTE_EXPIRED', 'RATE_LIMITED', 'DESIGN_UNAVAILABLE', 'QUOTE_NOT_CONFIGURED', 'UNAUTHENTICATED']);

export async function runDesign(input: RunInput): Promise<RunResult> {
  const pollMs = input.pollMs ?? 2500;
  const until = Date.now() + (input.timeoutMs ?? 20 * 60_000);
  const progress: RunProgress = { ...(input.progress ?? {}) };
  const note = async (patch: RunProgress) => { Object.assign(progress, patch); await input.onProgress?.({ ...progress }); };
  const stop = () => { if (input.signal?.cancelled) throw new DesignStudioError('DS_WATCH_STOPPED'); };

  // ── 1. The price the customer confirmed (free; checked again by the server) ──
  input.onStage?.('DESIGN');
  let quoteToken: string | null = null;
  if (!progress.renderId) {
    const quoted = await quoteRender({ projectId: input.projectId, versionId: input.versionId, product: productOf(input.mode), views: 1 });
    if (!quoted.quote) throw new DesignStudioFailure(quoted.error ?? 'QUOTE_FAILED', true);
    if (input.confirmedCredits != null && quoted.quote.credits !== input.confirmedCredits) throw new DesignStudioFailure('PRICE_CHANGED', true);
    quoteToken = quoted.quote.token;
  }

  // ── 2. The design, and the server's own chain to the picture ──
  let renderId = progress.renderId ?? null;
  let versionId = progress.designVersionId ?? null;
  let retry = !!input.retry;
  while (!renderId) {
    stop();
    const { reply, status } = await askSpec({
      projectId: input.projectId, versionId: input.versionId, mode: input.mode, idempotencyKey: input.key, durable: true,
      look: input.look, preferences: input.preferences, roomId: input.roomId ?? null, parentRenderId: input.parentRenderId ?? null,
      change: input.change ?? null, retry, then: quoteToken ? { quoteToken, versionName: input.versionName } : undefined,
    });
    retry = false; // one explicit retry per tap; later asks only watch
    if (reply?.state === 'FAILED') throw new DesignStudioFailure(reply.reason ?? 'SPEC_FAILED', reply.retryable !== false);
    if (reply?.state === 'DONE') {
      if (reply.jobId && reply.jobId !== progress.specJobId) await note({ specJobId: reply.jobId });
      const chain = reply.chain;
      if (chain?.versionId && chain.versionId !== versionId) { versionId = chain.versionId; await note({ designVersionId: versionId }); }
      if (chain?.renderId) { renderId = chain.renderId; break; }
      if (chain?.error) {
        // The server could not carry on by itself (the price changed, a step failed): finish it the ordinary way.
        if (chain.error === 'QUOTE_STALE') throw new DesignStudioFailure('PRICE_CHANGED', true);
        if (!versionId || !reply.jobId) throw new DesignStudioFailure(chain.error, true);
        renderId = await renderDirectly(input, versionId, reply.jobId, 0);
        break;
      }
    } else if (reply?.error && HARD.has(reply.error)) {
      throw new DesignStudioFailure(reply.error === 'QUOTE_STALE' || reply.error === 'QUOTE_EXPIRED' ? 'PRICE_CHANGED' : reply.error, reply.error !== 'SOURCE_MISSING');
    } else if (status === 402) {
      throw new DesignStudioFailure('INSUFFICIENT_CREDITS', true);
    }
    if (Date.now() > until) throw new DesignStudioError('DS_STILL_WORKING');
    await sleep(pollMs);
  }
  await note({ renderId });

  // ── 3. The picture, followed (each poll also moves it on) ──
  for (;;) {
    stop();
    const rows = await stepGenerated([renderId]).catch(() => null);
    const row = rows?.[0] ?? null;
    const step = generationStep(row);
    input.onStage?.(step === 'QUEUED' || step === 'IMAGE' ? 'IMAGE' : 'RESULT');
    if (row && step === 'READY') return { versionId: versionId ?? row.version_id, render: row };
    if (row && step === 'FAILED') {
      if (!input.retry || !progress.specJobId || !versionId) throw new DesignStudioFailure(row.error?.replace(/^.*?:/, '') || 'RENDER_FAILED', true);
      // "Try again" after a failed picture: a new picture of the SAME design (the specification is not paid again).
      const attempt = (progress.renderAttempt ?? 0) + 1;
      renderId = await renderDirectly(input, versionId, progress.specJobId, attempt);
      await note({ renderId, renderAttempt: attempt });
      input.retry = false;
      continue;
    }
    if (Date.now() > until) throw new DesignStudioError('DS_STILL_WORKING');
    await sleep(pollMs);
  }
}

/** The ordinary path (quote → render-generate) for a design whose specification exists. */
async function renderDirectly(input: RunInput, versionId: string, specJobId: string, attempt: number): Promise<string> {
  const quoted = await quoteRender({ projectId: input.projectId, versionId: input.mode === 'ROOM' ? input.versionId : versionId, product: productOf(input.mode), views: 1 });
  if (!quoted.quote) throw new DesignStudioFailure(quoted.error ?? 'QUOTE_FAILED', true);
  if (input.confirmedCredits != null && quoted.quote.credits !== input.confirmedCredits) throw new DesignStudioFailure('PRICE_CHANGED', true);
  const started = await generateRender({
    quote: quoted.quote, projectId: input.projectId, versionId: input.mode === 'ROOM' ? input.versionId : versionId, specJobId, mode: input.mode,
    idempotencyKey: `${input.key}-r${attempt}`,
  });
  if (!started.render) throw new DesignStudioFailure(started.error ?? 'RENDER_FAILED', true);
  return started.render.id;
}
