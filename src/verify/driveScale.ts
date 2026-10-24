// HOMATCH Verify — the driver at scale (owner 2026-10-24: 1,000 verifications at once).
//
// One driver invocation used to step six jobs one after another, each holding
// the invocation for up to 55 s: a cron tick advanced about one job, and a
// burst of hundreds waited hours. Now:
//   * an invocation claims a SMALL batch atomically (verify_drive_claim:
//     FOR UPDATE SKIP LOCKED, fair across customers) and steps those jobs
//     concurrently;
//   * while the claim came back full (work remains), it starts ONE more
//     invocation before working, so a backlog spreads over many invocations
//     in a chain bounded by maxFanout — each invocation stays small enough
//     for the edge CPU budget (~2 s of CPU per invocation);
//   * nothing is driven twice: the claim is the lock, released after.
// Pure: no clock, no network.

export interface DriveSettings {
  /** Jobs one invocation claims and steps concurrently. */
  batch: number;
  /** Invocations one cron tick may chain into (the backlog bound per tick). */
  maxFanout: number;
}

export const DRIVE_DEFAULTS: DriveSettings = { batch: 3, maxFanout: 60 };

const clamp = (v: unknown, lo: number, hi: number, d: number): number => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/** admin_settings.verify_drive_scale → settings, clamped; missing → defaults. */
export function driveSettings(raw: unknown): DriveSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    batch: clamp(o.batch, 1, 10, DRIVE_DEFAULTS.batch),
    maxFanout: clamp(o.maxFanout, 0, 300, DRIVE_DEFAULTS.maxFanout),
  };
}

/** Whether this invocation starts the next one: its claim came back full and the chain is not at its bound. */
export function shouldFanOut(claimed: number, s: DriveSettings, depth: number): boolean {
  return claimed >= s.batch && depth < s.maxFanout;
}

/** Runs fn over items with at most `limit` in flight; never rejects (failures are fn's to report). */
export async function runPool<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: lanes }, async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await fn(item);
      } catch {
        /* one job's failure never stops the others */
      }
    }
  }));
}

/** Customer-facing capacity: how many jobs one cron tick can keep moving. */
export function jobsPerTick(s: DriveSettings): number {
  return s.batch * (s.maxFanout + 1);
}
