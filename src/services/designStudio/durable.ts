// HOMATCH DESIGN STUDIO — WAITING ON WORK THE SERVER OWNS.
//
// Reading a plan, understanding photos, writing a design and generating a
// picture are owned by the server (design-studio-reconstruct/durable.ts): a
// request starts them and the work continues whether or not this page stays
// open. The browser only watches. Asking again is always safe — the server
// answers "running" for work in progress and takes over work that was
// abandoned — so the page re-asks now and then while it watches, which is also
// what restarts work after an instance was lost.
//
// A failure arrives with its category:
//   retryable  — the source is fine; "try again" without uploading again
//   terminal   — the source itself cannot be used; choose another file
// and a lost connection is never reported as a failure of the work.

import { DesignStudioError } from './errors.ts';

export type Outcome = { state: 'DONE' } | { state: 'FAILED'; code: string; retryable: boolean };

/** A stored server failure ("RETRYABLE:CODE" / "TERMINAL:CODE"; a legacy plain code counts as retryable). */
export function storedFailure(stored: string | null | undefined): { code: string; retryable: boolean } {
  const m = /^(RETRYABLE|TERMINAL):([A-Z0-9_]+)/.exec(stored ?? '');
  if (m) return { code: m[2], retryable: m[1] === 'RETRYABLE' };
  const plain = /^[A-Z0-9_]+/.exec(stored ?? '')?.[0];
  return { code: plain || 'UNKNOWN', retryable: true };
}

/** The error the flows show for a failed operation: DS_<code>, and whether retry is offered. */
export class DesignStudioFailure extends DesignStudioError {
  readonly retryable: boolean;
  constructor(code: string, retryable: boolean) {
    super(code.startsWith('DS_') ? code : `DS_${code}`);
    this.retryable = retryable;
  }
}

export const isRetryable = (e: unknown) => !(e instanceof DesignStudioFailure) || e.retryable;

export interface WatchOptions {
  /** Ask the server to start (or confirm) the work; errors are tolerated — the watch decides. */
  kick: () => Promise<unknown>;
  /** Read the authoritative state. null = not known yet (network); keep watching. */
  poll: () => Promise<Outcome | null>;
  pollMs?: number;
  /** How often the page asks again while the work is not finished (restarts abandoned work). */
  rekickMs?: number;
  /** Give up watching (not the work) after this long; the project resumes it later. */
  timeoutMs?: number;
  signal?: { cancelled: boolean };
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Watch one server-owned operation to its end. Resolves when it is done,
 * throws DesignStudioFailure when the server stored a failure, and throws
 * DS_STILL_WORKING when the watch gave up — the work itself carries on.
 */
export async function watchOperation(o: WatchOptions): Promise<void> {
  const sleep = o.sleep ?? defaultSleep;
  const now = o.now ?? Date.now;
  const pollMs = o.pollMs ?? 2500;
  const rekickMs = o.rekickMs ?? 20_000;
  const until = now() + (o.timeoutMs ?? 15 * 60_000);
  await o.kick().catch(() => null);
  let lastKick = now();
  for (;;) {
    if (o.signal?.cancelled) throw new DesignStudioError('DS_WATCH_STOPPED');
    const seen = await o.poll().catch(() => null);
    if (seen?.state === 'DONE') return;
    if (seen?.state === 'FAILED') throw new DesignStudioFailure(seen.code, seen.retryable);
    if (now() >= until) throw new DesignStudioError('DS_STILL_WORKING');
    if (now() - lastKick >= rekickMs) { await o.kick().catch(() => null); lastKick = now(); }
    await sleep(pollMs);
  }
}
