// HOMATCH DESIGN STUDIO — the object edit across two edge invocations.
//
//   render-edit   step 1 (editRequestPixels): one paid provider request; its
//                 answer is staged unchanged (deterministic key) and recorded in
//                 timings.staged, and the lease is rotated — so nothing from
//                 step 1 can write to the row after that.
//   render-status step 2 (editFinishPixels): a poll that finds a staged answer
//                 claims the row (compare-and-set on the lease), finishes it in
//                 the background, writes READY and only then settles the money.
//
// Each invocation has its own CPU budget (production killed the single-step edit
// at 2433 ms CPU). Every write is compare-and-set on status FINISHING and the
// current lease: two polls cannot both claim, a superseded worker cannot write,
// READY and FAILED exclude each other, so the money is settled or released once.
// Step 2 never calls the provider; a dead step 2 is claimed again (bounded); a
// dead step 1 is failed (never re-requested). No row stays FINISHING: silence and
// a hard ceiling end it (released, not charged), and the customer may ask again.

import { editFinishPixels, editRequestPixels, type AnswerMeta, type AnswerOk, type EditFailure, type EditFinishIo, type EditRequestIo } from './editPipeline.ts';

/** A running step writes its heartbeat this often (the only sign it is alive). */
export const EDIT_HEARTBEAT_MS = 10_000;
/**
 * No heartbeat for this long: the step's worker is gone (an instance killed for
 * memory or CPU cannot clean up after itself). Seven missed beats: far above a
 * CPU-bound stretch, independent of how long the provider takes (the beat
 * continues while it is waited for).
 */
export const EDIT_SILENT_MS = 75_000;
/** Hard ceiling for an edit from its request, alive or not. */
export const EDIT_LEASE_MS = 10 * 60_000;
/** A finish whose worker died is claimed again at most this many times in all (no provider call involved). */
export const MAX_FINISH_ATTEMPTS = 2;

export interface StagedAnswer { key: string; mime: string; at: string; answer: AnswerOk }
export interface Finisher { lease: string; heartbeatAt: string; attempt: number }
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export type EditNext =
  | { action: 'WAIT' }
  | { action: 'FAIL'; code: 'EDIT_TIMEOUT' | 'EDIT_INTERRUPTED' | 'EDIT_FINISH_INTERRUPTED' }
  | { action: 'FINISH'; attempt: number };

const t = (s: unknown) => (typeof s === 'string' ? Date.parse(s) : NaN);

/** What the status poll does with an edit now. */
export function editNext(row: Row, nowMs: number): EditNext {
  if (row.kind !== 'EDIT' || row.status !== 'FINISHING' || !row.lease_at) return { action: 'WAIT' };
  const lease = t(row.lease_at);
  if (!Number.isFinite(lease)) return { action: 'WAIT' };
  const timings = row.timings ?? {};
  const requested = Number.isFinite(t(timings.requestedAt)) ? t(timings.requestedAt) : lease;
  if (nowMs - requested > EDIT_LEASE_MS) return { action: 'FAIL', code: 'EDIT_TIMEOUT' };
  const staged = timings.staged as StagedAnswer | undefined;
  if (!staged?.key) {
    // Step 1 still running: alive while it beats.
    const beat = t(timings.heartbeatAt);
    const last = Number.isFinite(beat) ? Math.max(beat, lease) : lease;
    return nowMs - last > EDIT_SILENT_MS ? { action: 'FAIL', code: 'EDIT_INTERRUPTED' } : { action: 'WAIT' };
  }
  const fin = timings.finisher as Finisher | undefined;
  if (!fin) return { action: 'FINISH', attempt: 1 };
  const beat = t(fin.heartbeatAt);
  const last = Number.isFinite(beat) ? Math.max(beat, lease) : lease;
  if (nowMs - last <= EDIT_SILENT_MS) return { action: 'WAIT' };
  return fin.attempt >= MAX_FINISH_ATTEMPTS ? { action: 'FAIL', code: 'EDIT_FINISH_INTERRUPTED' } : { action: 'FINISH', attempt: fin.attempt + 1 };
}

/** The row store: every write is compare-and-set on status FINISHING and `lease`. */
export interface EditStore {
  /** Updates the FINISHING row holding `lease`; the updated row, or null when it was not (any more) that row. */
  update(rowId: string, lease: string, fields: Row): Promise<Row | null>;
  /** FINISHING row holding `lease` → FAILED and its reservation released, exactly once; true when this call did it. */
  fail(row: Row, lease: string, code: string, failure: Pick<EditFailure, 'finishReason' | 'check'> | null, answer: AnswerMeta | null): Promise<boolean>;
  /** Settles the money of a row that just became READY. */
  settle(done: Row, answer: AnswerOk): Promise<void>;
  put(key: string, bytes: Uint8Array, mime: string): Promise<boolean>;
  remove(key: string): Promise<void>;
  stagedKey(row: Row, mime: string): Promise<string>;
  finalKey(row: Row): Promise<string>;
  /** READY's `finish` record from the check and the answer. */
  finishRecord(check: EditFailure['check'], answer: AnswerOk): Row;
  now(): number;
  every(ms: number, fn: () => void): () => void;
}

const iso = (ms: number) => new Date(ms).toISOString();
/** A lease strictly after `prev` (a write holding `prev` must lose, even within the same millisecond). */
const nextLease = (prev: unknown, nowMs: number) => iso(Math.max(nowMs, (Number.isFinite(t(prev)) ? t(prev) : 0) + 1));

/** Beats while `work` runs; stops (and waits for a beat in flight) before returning. */
async function beating<T>(store: EditStore, beat: () => Promise<unknown>, work: () => Promise<T>): Promise<T> {
  let inflight: Promise<unknown> = beat();
  await inflight;
  const stop = store.every(EDIT_HEARTBEAT_MS, () => { inflight = beat(); });
  try {
    return await work();
  } finally {
    stop();
    await inflight;
  }
}

/** Step 1, in render-edit's background: request, stage, hand over. Never settles. */
export async function runEditRequest(store: EditStore, io: EditRequestIo, row: Row, lease: string, color: string): Promise<'STAGED' | 'FAILED' | 'SUPERSEDED'> {
  const fail = async (code: string, failure: Pick<EditFailure, 'finishReason' | 'check'> | null = null, answer: AnswerMeta | null = null) => {
    await store.fail(row, lease, code, failure, answer);
    return 'FAILED' as const;
  };
  const beat = () => store.update(row.id, lease, { timings: { ...(row.timings ?? {}), heartbeatAt: iso(store.now()) } }).catch(() => null);
  let staged: { bytes: Uint8Array; mime: string; answer: AnswerOk } | null = null;
  try {
    const o = await beating(store, beat, () => editRequestPixels(io, color));
    if (!o.ok) return await fail(o.code, o.finishReason ? { finishReason: o.finishReason, check: o.check } : null, o.result);
    staged = o;
  } catch (e) {
    return await fail(`EDIT_CRASHED:${String((e as Error)?.message ?? '').slice(0, 80)}`);
  }
  // The heartbeat has stopped: stage the answer, then hand the row over with a new lease.
  const key = await store.stagedKey(row, staged.mime);
  const stored = await store.put(key, staged.bytes, staged.mime).catch(() => false);
  if (!stored) return await fail('EDIT_NOT_STAGED', null, staged.answer);
  const now = store.now();
  const record: StagedAnswer = { key, mime: staged.mime, at: iso(now), answer: staged.answer };
  const handed = await store.update(row.id, lease, { lease_at: nextLease(lease, now), timings: { ...(row.timings ?? {}), staged: record } });
  if (!handed) { await store.remove(key); return 'SUPERSEDED'; }
  return 'STAGED';
}

/** The poll's claim on a staged edit: a new lease and a finisher record, or null when another poll won. */
export async function claimEditFinish(store: EditStore, row: Row, attempt: number): Promise<Row | null> {
  const lease = nextLease(row.lease_at, store.now());
  return await store.update(row.id, row.lease_at, { lease_at: lease, timings: { ...(row.timings ?? {}), finisher: { lease, heartbeatAt: lease, attempt } } });
}

/** Step 2, in render-status's background, on a row this poll claimed: finish, READY, then settle. */
export async function runEditFinish(store: EditStore, io: EditFinishIo, claimed: Row, color: string): Promise<'READY' | 'FAILED' | 'SUPERSEDED'> {
  const lease: string = claimed.lease_at;
  const timings = claimed.timings ?? {};
  const staged = timings.staged as StagedAnswer;
  const fin = timings.finisher as Finisher;
  const answer = staged.answer;
  const beat = () => store.update(claimed.id, lease, { timings: { ...timings, finisher: { ...fin, heartbeatAt: iso(store.now()) } } }).catch(() => null);
  const fail = async (code: string, failure: Pick<EditFailure, 'finishReason' | 'check'> | null = null) => {
    // Only the holder of the lease ends the edit and throws its staged answer away; a superseded
    // finisher touches nothing (the one that replaced it still needs the answer).
    if (!(await store.fail(claimed, lease, code, failure, answer))) return 'SUPERSEDED' as const;
    await store.remove(staged.key);
    return 'FAILED' as const;
  };
  try {
    const result = await beating(store, beat, async () => {
      const o = await editFinishPixels(io, color, answer);
      if (!o.ok) return o;
      const finalKey = await store.finalKey(claimed);
      const stored = await store.put(finalKey, o.png, 'image/png').catch(() => false);
      return stored ? { ...o, finalKey } : { ok: false as const, code: 'FINAL_NOT_STORED', status: 502, finishReason: null, check: o.check, result: answer };
    });
    if (!result.ok) return await fail(result.code, { finishReason: result.finishReason, check: result.check });
    const now = store.now();
    const requested = t(timings.requestedAt);
    const done = await store.update(claimed.id, lease, {
      status: 'READY', final_key: result.finalKey, finish: store.finishRecord(result.check, answer), lease_at: null, error: null, updated_at: iso(now),
      cost: [{ stage: 'RENDERING', kind: 'IMAGE_MODEL', usd: answer.cost.usd, basis: answer.cost.basis === 'ESTIMATED' ? 'ESTIMATED' : 'NOT_AVAILABLE', detail: answer.cost.detail }],
      timings: {
        requestedAt: timings.requestedAt, stagedAt: staged.at, readyAt: iso(now), editMs: answer.ms, checkMs: result.checkMs,
        finishAttempt: fin.attempt, totalMs: Number.isFinite(requested) ? now - requested : null,
      },
    });
    if (!done) return 'SUPERSEDED';
    await store.settle(done, answer);
    await store.remove(staged.key);
    return 'READY';
  } catch (e) {
    return await fail(`EDIT_FINISH_CRASHED:${String((e as Error)?.message ?? '').slice(0, 80)}`);
  }
}

/** The poll ends an edit editNext gave up on: released once, its staged answer (if any) thrown away. */
export async function failEdit(store: EditStore, row: Row, code: string): Promise<boolean> {
  const staged = (row.timings ?? {}).staged as StagedAnswer | undefined;
  if (!(await store.fail(row, row.lease_at, code, null, staged?.answer ?? null))) return false;
  if (staged?.key) await store.remove(staged.key);
  return true;
}
