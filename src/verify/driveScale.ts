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

/*
 * NO IDLE GAP BETWEEN STAGES (owner 2026-10-30, Verify V3 speed).
 *
 * driveJob stepped a job, then always slept DRIVE_TICK_SPACING_MS before the next step. Finishing
 * a model stage only parks the job in an internal state (OFFICIAL_READY, *_CHECK_PENDING,
 * *_READY); launching the next stage takes another step or two, so each transition idled
 * 3–9 s inside an invocation (prod c89cc933: 89 s of gaps between stages; cc158dde: 36 s).
 *
 * The next step runs at once when the step moved the job to a different stage that is not a
 * wait for something outside (an OpenAI background response, the browser worker, a financial
 * lookup: every such stage ends in _WAITING). A step that changed nothing, or that left the job
 * waiting, keeps the spacing, so this can never spin; the per-invocation step and wall-clock
 * budgets, the lease, the claim and the cron fallback are unchanged.
 */
export function stepDelayMs(before: { stage?: string | null; status?: string | null } | null, after: { stage?: string | null; status?: string | null } | null, spacingMs: number): number {
  if (!after?.stage || !before) return spacingMs;
  if (after.stage === before.stage && after.status === before.status) return spacingMs;
  if (/_WAITING$/.test(after.stage)) return spacingMs;
  return 0;
}

/*
 * THE PAGE'S OWN POLL CHAINS THE SAME WAY (owner 2026-10-30, Verify V3 speed).
 *
 * While a Verify tab is open (even hidden: one poll per ~10 s) its status polls keep updated_at
 * fresh, so verify_drive_claim (updated_at older than 30 s) never hands the job to the driver and
 * the poll is the only advancer. It stepped once per request, so every internal hand-off cost a
 * whole poll period: prod d84f06db, public → market → reconciliation → synthesis took 24 s each,
 * 106 s of idle in one run. The status path now follows a step that parked the job in an internal
 * state with the next step at once, by the same rule as driveJob, inside a small budget so the
 * response is never held: at most STATUS_CHAIN_MAX_STEPS extra steps and STATUS_CHAIN_BUDGET_MS.
 * Every step still takes the advance lease; a finished, paused or human-wait job is never stepped.
 */
export const STATUS_CHAIN_MAX_STEPS = 4;
export const STATUS_CHAIN_BUDGET_MS = 8_000;
const CHAIN_LIVE_STATUSES = ['CREATED', 'RUNNING'];
export function chainNextStep(before: { stage?: string | null; status?: string | null; cancelled_at?: string | null } | null, after: { stage?: string | null; status?: string | null; cancelled_at?: string | null } | null): boolean {
  if (!after || after.cancelled_at || !CHAIN_LIVE_STATUSES.includes(String(after.status))) return false;
  return stepDelayMs(before, after, 1) === 0;
}

/** Customer-facing capacity: how many jobs one cron tick can keep moving. */
export function jobsPerTick(s: DriveSettings): number {
  return s.batch * (s.maxFanout + 1);
}
