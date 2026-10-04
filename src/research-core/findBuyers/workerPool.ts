// FIND BUYERS — the bounded worker pool the discovery driver runs memo23
// queue jobs through.
//
// N lanes run side by side. Each lane claims ONE job, runs it, and claims the
// next as soon as it is done, so a free lane is refilled immediately: there is
// no batch of N that must all finish before the next N start, and a slow job
// holds only its own lane. When nothing is runnable a lane naps briefly and
// looks again (a provider run that is due for a poll in a few seconds is
// picked up inside the same pass) and stops when no open work remains or the
// pass's time box closes. The pool owns no money: the reservation in the
// database stays the authority on how many provider runs are in flight.

export interface PoolOptions<J, R> {
  /** Lanes running side by side (the memo23 concurrency, 4 to start). */
  lanes: number;
  /** Absolute time (ms) after which no lane claims another job. */
  deadline: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Claim one runnable job, or null when none is runnable right now. */
  claim: () => Promise<J | null>;
  /** Run and finish one job. A throw is contained to this job. */
  run: (job: J) => Promise<R>;
  /** Is any job still open (runnable later, or held by another lane)? */
  hasOpenWork: () => Promise<boolean>;
  /** Nap between empty claims while work is still open. */
  idleMs?: number;
  /** Lane i makes its first claim i × this later, so lanes do not collide. */
  staggerMs?: number;
}

export interface PoolResult<R> {
  results: Array<R | { error: string }>;
  claimed: number;
  maxInFlight: number;
}

export async function runWorkerPool<J, R>(o: PoolOptions<J, R>): Promise<PoolResult<R>> {
  const lanes = Math.max(1, Math.floor(o.lanes));
  const idle = Math.max(10, o.idleMs ?? 2_000);
  const results: Array<R | { error: string }> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let claimed = 0;

  const lane = async (index: number) => {
    if (index > 0 && o.staggerMs) await o.sleep(index * o.staggerMs);
    while (o.now() < o.deadline) {
      let job: J | null;
      try { job = await o.claim(); } catch (e) { results.push({ error: `CLAIM_FAILED: ${String(e)}` }); return; }
      if (job == null) {
        let open = false;
        try { open = await o.hasOpenWork(); } catch { open = false; }
        if (!open) return;
        if (o.now() + idle >= o.deadline) return;
        await o.sleep(idle);
        continue;
      }
      claimed++;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try { results.push(await o.run(job)); }
      catch (e) { results.push({ error: String(e) }); }
      finally { inFlight--; }
    }
  };

  await Promise.all(Array.from({ length: lanes }, (_, i) => lane(i)));
  return { results, claimed, maxInFlight };
}
