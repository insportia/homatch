// HOMATCH DESIGN STUDIO — ONE OPENAI-FIRST GENERATION, STEP BY STEP.
//
// A generated render (MASTER, ROOM or VARIANT) is one ds_renders row with no
// factory job behind it. It moves through three steps, each small enough for
// one edge invocation, each claimed with a lease so exactly one worker runs it:
//
//   IMAGE  the reference picture (the customer's source for MASTER, the
//          approved master for ROOM / VARIANT) + the specification's
//          instruction → ONE image call → the final picture is stored.
//          The request is recorded BEFORE it is made: a worker that dies after
//          asking is never followed by a second paid request — the row fails
//          and its money is released.
//   SCENE  OpenAI is shown the finished picture and lists what is in it
//          (sceneMap.ts). A cheap text answer; asked at most twice.
//   MAP    the picture is decoded once and the edit map is built and stored:
//          the id picture + legend the stable edit pipeline reads. Then the
//          row is READY and its money is settled, once.
//
// No factory, no GPU, no Blender, no 3D asset is involved anywhere here.
// Pure orchestration over injected I/O (the route supplies it); Deno + Node.

import { buildEditMap, type SceneElement } from './sceneMap.ts';
import type { RgbPixels } from './renderCheck.ts';

export type AiStep = 'IMAGE' | 'SCENE' | 'MAP';
export type GenMode = 'MASTER' | 'ROOM' | 'VARIANT';

/** Kept on the row (timings.ai): where the generation is and what it has spent. */
export interface AiProgress {
  step: AiStep;
  mode: GenMode;
  specJobId: string;
  imageRequestedAt?: string | null;
  /** How many times the edit-map step was claimed (an invocation killed mid-map leaves a lapsed lease). */
  mapAttempts?: number;
  imageAt?: string | null;
  sceneAttempts?: number;
  sceneJobId?: string | null;
  mapAt?: string | null;
  imageUsd?: number | null;
  imageKnown?: boolean;
  sceneUsd?: number | null;
  sceneKnown?: boolean;
}

// deno-lint-ignore no-explicit-any
export type Row = any;

export const GEN_LEASE_MS = 5 * 60_000;
export const MAX_SCENE_ATTEMPTS = 2;

export type GenAction =
  | { action: 'NONE' } | { action: 'WAIT' } | { action: 'FAIL'; code: string }
  | { action: 'IMAGE' } | { action: 'SCENE' } | { action: 'MAP' };

export const aiOf = (row: Row): AiProgress | null => (row?.timings?.ai && typeof row.timings.ai === 'object' ? row.timings.ai as AiProgress : null);

/** What a poll should do with this row now. */
export function genNext(row: Row, nowMs: number): GenAction {
  const ai = aiOf(row);
  if (!ai || row.factory_job_id) return { action: 'NONE' };
  if (!['QUEUED', 'RENDERING', 'FINISHING'].includes(row.status)) return { action: 'NONE' };
  const leased = row.lease_at && Date.parse(row.lease_at) > nowMs - GEN_LEASE_MS;
  if (leased && row.status !== 'QUEUED') return { action: 'WAIT' };
  if (row.status === 'QUEUED') return { action: 'IMAGE' };
  if (row.status === 'RENDERING') return ai.imageRequestedAt && !row.final_key ? { action: 'FAIL', code: 'GENERATION_INTERRUPTED' } : { action: 'IMAGE' };
  if (ai.step === 'SCENE') return { action: (ai.sceneAttempts ?? 0) >= MAX_SCENE_ATTEMPTS ? 'MAP' : 'SCENE' };
  return { action: 'MAP' };
}

export interface ImageAnswer {
  ok: boolean; provider: string; model: string; bytes?: Uint8Array; mime?: string; error?: string; ms: number;
  cost: { usd: number | null; basis: 'ESTIMATED' | 'UNPRICED' };
}

export interface GenIo {
  now(): number;
  /** Compare-and-set: from one of `from` statuses (and no live lease, or this lease) to the patch; null when another worker holds it. */
  claim(row: Row, from: string[], patch: Row): Promise<Row | null>;
  /** The row as stored now. */
  reload(row: Row): Promise<Row | null>;
  /** Update while holding `lease`; null when the lease was lost. */
  save(row: Row, lease: string, patch: Row): Promise<Row | null>;
  reference(row: Row): Promise<{ bytes: Uint8Array; mime: string } | null>;
  instruction(row: Row): Promise<string | null>;
  size(row: Row): { width: number; height: number };
  image(input: { base: { bytes: Uint8Array; mime: string }; prompt: string; size: { width: number; height: number } }): Promise<ImageAnswer>;
  putPicture(row: Row, bytes: Uint8Array, mime: string): Promise<string | null>;
  readPicture(key: string): Promise<Uint8Array | null>;
  scene(row: Row, picture: { bytes: Uint8Array; mime: string }): Promise<{ elements: SceneElement[]; usd: number | null } | null>;
  storeScene(row: Row, elements: SceneElement[]): Promise<string | null>;
  loadScene(jobId: string): Promise<SceneElement[] | null>;
  rooms(row: Row): Promise<ReadonlySet<string>>;
  decode(bytes: Uint8Array): { ok: true; img: RgbPixels } | { ok: false; reason: string };
  encodeIds(ids: RgbPixels): Uint8Array;
  putIds(row: Row, png: Uint8Array): Promise<string | null>;
  /** Settle the READY row's money with what was measured and store the result; never throws. */
  close(row: Row, outcome: 'SETTLE' | 'RELEASE', m: { aiUsd: number | null; aiKnown: boolean; provider: string | null; model: string | null; ms: number; detail: Record<string, unknown> }): Promise<Row>;
  /** FAILED exactly once (compare-and-set), then release. */
  fail(row: Row, code: string, lease: string | null): Promise<boolean>;
}

const iso = (ms: number) => new Date(ms).toISOString();
/** After this many map attempts die, the picture is finished without its edit map (it is still the result). */
export const MAX_MAP_ATTEMPTS = 2;
const merged = (row: Row, ai: Partial<AiProgress>) => ({ ...(row.timings ?? {}), ai: { ...(aiOf(row) ?? {}), ...ai } });

/** IMAGE: one recorded request, one picture. */
export async function runImageStep(io: GenIo, row: Row): Promise<'STORED' | 'FAILED' | 'BUSY'> {
  const lease = iso(io.now());
  const claimed = await io.claim(row, ['QUEUED', 'RENDERING'], { status: 'RENDERING', lease_at: lease });
  if (!claimed) return 'BUSY';
  const ai = aiOf(claimed)!;
  if (ai.imageRequestedAt && !claimed.final_key) { await io.fail(claimed, 'GENERATION_INTERRUPTED', lease); return 'FAILED'; }
  const [reference, prompt] = await Promise.all([io.reference(claimed), io.instruction(claimed)]);
  if (!reference) { await io.fail(claimed, 'REFERENCE_MISSING', lease); return 'FAILED'; }
  if (!prompt) { await io.fail(claimed, 'SPEC_MISSING', lease); return 'FAILED'; }
  // Recorded first: from here on a lost worker means "asked", never "ask again".
  const asked = await io.save(claimed, lease, { timings: merged(claimed, { imageRequestedAt: iso(io.now()) }) });
  if (!asked) return 'BUSY';
  const answer = await io.image({ base: reference, prompt, size: io.size(asked) });
  if (!answer.ok || !answer.bytes || !answer.mime) {
    const failed = await io.save(asked, lease, { timings: merged(asked, { imageUsd: answer.cost.usd, imageKnown: answer.cost.basis === 'ESTIMATED' }) });
    await io.fail(failed ?? asked, `IMAGE_${answer.error ?? 'FAILED'}`.slice(0, 120), lease);
    return 'FAILED';
  }
  const key = await io.putPicture(asked, answer.bytes, answer.mime);
  if (!key) { await io.fail(asked, 'PICTURE_NOT_STORED', lease); return 'FAILED'; }
  const stored = await io.save(asked, lease, {
    status: 'FINISHING', final_key: key, lease_at: null,
    finish: { ...(asked.finish ?? {}), provider: answer.provider, model: answer.model, check: null, ms: answer.ms, usd: answer.cost.usd },
    timings: merged(asked, { step: 'SCENE', imageAt: iso(io.now()), imageUsd: answer.cost.usd, imageKnown: answer.cost.basis === 'ESTIMATED' }),
  });
  return stored ? 'STORED' : 'BUSY';
}

/** SCENE: what is in the finished picture (cheap; at most MAX_SCENE_ATTEMPTS asks). */
export async function runSceneStep(io: GenIo, row: Row): Promise<'STORED' | 'SKIPPED' | 'BUSY'> {
  const lease = iso(io.now());
  const claimed = await io.claim(row, ['FINISHING'], { lease_at: lease });
  if (!claimed) return 'BUSY';
  const ai = aiOf(claimed)!;
  const attempts = (ai.sceneAttempts ?? 0) + 1;
  const marked = await io.save(claimed, lease, { timings: merged(claimed, { sceneAttempts: attempts }) });
  if (!marked) return 'BUSY';
  const bytes = claimed.final_key ? await io.readPicture(claimed.final_key) : null;
  const answer = bytes ? await io.scene(marked, { bytes, mime: 'image/png' }) : null;
  const jobId = answer?.elements.length ? await io.storeScene(marked, answer.elements) : null;
  const next = jobId || attempts >= MAX_SCENE_ATTEMPTS ? 'MAP' : 'SCENE';
  await io.save(marked, lease, {
    lease_at: null,
    timings: merged(marked, { step: next, sceneJobId: jobId, sceneUsd: answer ? answer.usd : (ai.sceneUsd ?? null), sceneKnown: answer ? answer.usd != null : (ai.sceneKnown ?? true) }),
  });
  return jobId ? 'STORED' : 'SKIPPED';
}

/** MAP: the edit map, READY, the money settled once. A picture without a map is still the design (just not object-editable). */
export async function runMapStep(io: GenIo, row: Row): Promise<'READY' | 'BUSY'> {
  const lease = iso(io.now());
  // Each claim is counted: a map step whose invocation died (a lapsed lease) is not tried forever.
  const tries = (aiOf(row)?.mapAttempts ?? 0) + 1;
  const claimed = await io.claim(row, ['FINISHING'], { lease_at: lease, timings: merged(row, { mapAttempts: tries }) });
  if (!claimed) return 'BUSY';
  const ai = aiOf(claimed)!;
  let mapKey: string | null = null; let legend: Row = null;
  let editMap: Record<string, unknown> = { state: 'UNAVAILABLE', reason: ai.sceneJobId ? null : 'NO_SCENE' };
  // Two attempts already died: the picture is the result — it is shown without its edit map rather than never.
  if (tries > MAX_MAP_ATTEMPTS) editMap = { state: 'UNAVAILABLE', reason: 'MAP_BUDGET' };
  else if (ai.sceneJobId && claimed.final_key) {
    const [elements, bytes, rooms] = await Promise.all([io.loadScene(ai.sceneJobId), io.readPicture(claimed.final_key), io.rooms(claimed)]);
    const decoded = bytes ? io.decode(bytes) : null;
    if (!elements?.length) editMap = { state: 'UNAVAILABLE', reason: 'NO_SCENE' };
    else if (!decoded?.ok) editMap = { state: 'UNAVAILABLE', reason: 'PICTURE_UNREADABLE' };
    else {
      const map = buildEditMap(decoded.img, elements, rooms);
      if (map.legend.entries.length) {
        mapKey = await io.putIds(claimed, io.encodeIds(map.ids));
        if (mapKey) legend = map.legend;
      }
      editMap = {
        state: mapKey ? 'READY' : 'UNAVAILABLE', reason: mapKey ? null : map.legend.entries.length ? 'MAP_NOT_STORED' : 'NOTHING_EDITABLE',
        entries: map.accepted.length, refined: map.accepted.filter((a) => a.method === 'REFINED').length,
        outline: map.accepted.filter((a) => a.method === 'OUTLINE').length, rejected: map.rejected.length,
      };
    }
  }
  const done = await io.save(claimed, lease, {
    status: 'READY', map_key: mapKey, legend, lease_at: null, error: null,
    finish: { ...(claimed.finish ?? {}), editMap },
    timings: merged(claimed, { mapAt: iso(io.now()) }),
  });
  if (!done) return 'BUSY';
  const known = (ai.imageKnown ?? false) && (ai.sceneKnown ?? true);
  const aiUsd = ai.imageUsd == null ? null : ai.imageUsd + (ai.sceneUsd ?? 0);
  await io.close(done, 'SETTLE', {
    aiUsd: known ? aiUsd : null, aiKnown: known, provider: done.finish?.provider ?? 'OPENAI', model: done.finish?.model ?? null,
    ms: io.now() - Date.parse(done.timings?.requestedAt ?? iso(io.now())), detail: { step: 'generated', mode: ai.mode, editMap: editMap.state },
  });
  return 'READY';
}

/** Drive a row as far as this invocation should: IMAGE then SCENE (network-bound); MAP is the next poll's (CPU-bound). */
export async function driveUntilMap(io: GenIo, row: Row): Promise<GenAction['action']> {
  let current = row;
  for (let i = 0; i < 3; i += 1) {
    const next = genNext(current, io.now());
    if (next.action === 'IMAGE') { if ((await runImageStep(io, current)) !== 'STORED') return 'IMAGE'; }
    else if (next.action === 'SCENE') { await runSceneStep(io, current); return 'SCENE'; }
    else if (next.action === 'FAIL') { await io.fail(current, next.code, null); return 'FAIL'; }
    else return next.action;
    current = (await io.reload(current)) ?? current;
  }
  return 'WAIT';
}
