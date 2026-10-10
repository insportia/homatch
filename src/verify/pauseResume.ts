/*
 * STOP & RESUME — the pure decisions behind research-agent's pause/continue.
 *
 * Kept out of the Deno function so every rule here is unit-tested:
 *   * which states may be stopped;
 *   * where a paused job continues from (never from the beginning, never a
 *     stage that already finished);
 *   * how a finished job's budget session is closed (charged, or released
 *     for a system failure);
 *   * whether an optional paid stage still fits in the authorised budget.
 */

/** Statuses a customer can stop. Terminal and already-paused jobs cannot. */
export const PAUSABLE_STATUSES = ['CREATED', 'RUNNING', 'WAITING_HUMAN'] as const;
export const isPausable = (status: unknown): boolean => (PAUSABLE_STATUSES as readonly string[]).includes(String(status));

/** The research stage that (re)starts an AI stage that was stopped mid-flight. */
const AI_STAGE_RESTART: Record<string, string> = {
  IDENTITY: 'QUEUED',
  OFFICIAL_COLLECTION: 'OFFICIAL_READY',
  PUBLIC_RESEARCH: 'PUBLIC_RESEARCH_READY',
  MARKET: 'MARKET_READY',
  SYNTHESIS: 'SYNTHESIS_READY',
};

export interface PauseRecord {
  status: string;
  stage: string;
  /** The AI response finished before it could be cancelled: its result is kept and re-read on resume. */
  responseKept?: boolean;
  /** The official stage ran on the durable queue (its tasks are re-queued, not restarted). */
  queue?: boolean;
  /** Where a human-verification pause would have returned to. */
  captchaReturnStage?: string | null;
}

export interface ResumeTarget {
  status: 'CREATED' | 'RUNNING';
  stage: string;
  /** Re-queue unfinished official tasks (completed ones are kept). */
  requeueOfficial: boolean;
  /** Restart the official browser job (legacy, in-memory worker). */
  restartBrowser: boolean;
}

/** Where a paused job continues. */
export function resumeTarget(p: PauseRecord): ResumeTarget {
  const stage = String(p.stage || '');
  const base = { requeueOfficial: false, restartBrowser: false };
  const ai = stage.match(/^(IDENTITY|OFFICIAL_COLLECTION|PUBLIC_RESEARCH|MARKET|SYNTHESIS)_WAITING$/);
  if (ai) {
    // A response that completed is re-read, not paid for again; a cancelled one is relaunched.
    if (p.responseKept) return { ...base, status: 'RUNNING', stage };
    return { ...base, status: 'CREATED', stage: AI_STAGE_RESTART[ai[1]] };
  }
  const officialStage = stage === 'BROWSER_WAITING' || stage === 'BROWSER_READY'
    || (stage === 'CAPTCHA_REQUIRED' && (p.captchaReturnStage ?? 'BROWSER_WAITING') === 'BROWSER_WAITING');
  if (officialStage) {
    return p.queue
      ? { status: 'RUNNING', stage: 'BROWSER_WAITING', requeueOfficial: true, restartBrowser: false }
      : { status: 'CREATED', stage: 'BROWSER_READY', requeueOfficial: false, restartBrowser: true };
  }
  if (stage === 'FINANCIAL_ENTITY_WAITING' || stage === 'CAPTCHA_REQUIRED') {
    // The interrupted lookup goes back to the front of its queue (done at pause).
    return { ...base, status: 'RUNNING', stage: 'FINANCIAL_ENTITY_WAITING' };
  }
  return { ...base, status: p.status === 'RUNNING' ? 'RUNNING' : 'CREATED', stage };
}

/** How the open budget session of a job in this state is closed, or null to wait. */
export function settlementOutcome(
  job: { status?: string | null; synthesis_state?: string | null; synthesis_attempts?: number | null; completed_at?: string | null; paused_at?: string | null },
  opts: { maxSynthesisAttempts: number; synthesisGraceMs: number; now?: number; openSessionAt?: string | null; resumeGraceMs?: number },
): 'COMPLETE' | 'STOPPED' | 'SYSTEM_FAILED' | null {
  const now = opts.now ?? Date.now();
  switch (job.status) {
    case 'PAUSED': {
      // A budget opened AFTER the pause is a continuation in progress: it is
      // left alone for a short grace (the job is about to run on it); one that
      // never got its job running is released after that.
      const opened = Date.parse(opts.openSessionAt ?? '');
      const paused = Date.parse(job.paused_at ?? '');
      if (Number.isFinite(opened) && Number.isFinite(paused) && opened > paused && now - opened < (opts.resumeGraceMs ?? 10 * 60_000)) return null;
      return 'STOPPED';
    }
    case 'CANCELLED':
      return 'STOPPED';
    case 'FAILED':
      return 'SYSTEM_FAILED';
    case 'COMPLETE': {
      if (job.synthesis_state === 'READY') return 'COMPLETE';
      // The research is done but the report could not be written: the
      // customer did not get what they paid for, so nothing is charged.
      if (job.synthesis_state === 'FAILED' && (job.synthesis_attempts ?? 0) >= opts.maxSynthesisAttempts) return 'SYSTEM_FAILED';
      const done = Date.parse(job.completed_at ?? '');
      if (Number.isFinite(done) && now - done > opts.synthesisGraceMs) {
        return job.synthesis_state === 'READY' ? 'COMPLETE' : 'SYSTEM_FAILED';
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Whether an optional paid stage still fits the authorised budget. Unknown
 * state (no billing, not enabled) never blocks: the stage runs as before.
 */
export function optionalStageFits(
  billing: { remaining?: unknown; usageState?: unknown } | null | undefined,
  stageMaxCredits: number,
): boolean {
  if (!billing || typeof billing.remaining !== 'number' && typeof billing.remaining !== 'string') return true;
  const remaining = Number(billing.remaining);
  if (!Number.isFinite(remaining)) return true;
  return remaining >= stageMaxCredits;
}

/**
 * Why a paused job is waiting, for the customer: 'APPROVAL' — the next check
 * needs another +25 the customer has not approved yet; 'LIMIT' — the
 * 100-credit maximum is reached; null — an ordinary stop (or not paused).
 */
export function budgetHold(pause: { reason?: unknown } | null | undefined): 'APPROVAL' | 'LIMIT' | null {
  if (!pause || typeof pause !== 'object') return null;
  if (pause.reason === 'BUDGET') return 'APPROVAL';
  if (pause.reason === 'BUDGET_LIMIT') return 'LIMIT';
  return null;
}

/** The customer-safe billing summary (no costs, rates, VAT or margins). */
export function publicBilling(state: Record<string, unknown> | null | undefined, pause?: { reason?: unknown } | null): Record<string, unknown> | null {
  if (!state || typeof state !== 'object') return null;
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  };
  const last = state.lastSession && typeof state.lastSession === 'object' ? (state.lastSession as Record<string, unknown>) : null;
  return {
    state: typeof state.state === 'string' ? state.state : null,
    authorized: num(state.authorizedTotal),
    used: num(state.used),
    remaining: num(state.remaining),
    charged: num(state.chargedTotal),
    live: state.usageState === 'LIVE',
    calculating: state.usageState === 'CALCULATING',
    lastReturned: last ? num(last.released) : null,
    lastCharged: last ? num(last.charged) : null,
    authorizations: Number.isInteger(Number(state.authorizations)) ? Number(state.authorizations) : null,
    increment: num(state.increment),
    maxBudget: num(state.maxBudget),
    canExtend: state.canExtend === true,
    hold: budgetHold(pause),
  };
}
