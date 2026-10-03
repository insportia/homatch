// THE 3D WALKTHROUGH'S LIFECYCLE — owned by the server, decided here.
//
//   QUEUED → PLANNING → SUBMITTED → RUNNING → PROCESSING_RESULT → READY
//                  ↘           ↘          ↘                ↘
//                   FAILED      FAILED     FAILED            FAILED      (or CANCELLED)
//
// A row (ds_walkthroughs) is worked on by whoever claims it: the request that
// created it, a status poll, or the reconciler (pg_cron, every minute). A
// claim is a compare-and-set that takes a LEASE; a lease older than LEASE_MS
// was abandoned (an invocation killed mid-step) and may be taken over. Every
// step counts its attempts and has a bound; the provider job has a hard
// deadline. So nothing runs twice at once, nothing is ever stuck RUNNING, and
// a retry never starts a second GPU job while the first one is alive.
//
// Pure: no I/O. The edge route (design-studio-reconstruct/walkthrough.ts)
// does the reading, the calling and the writing; this file only decides.

export const WALKTHROUGH_ENGINE = 'ds-walk-1';

export const WALK_STATES = ['QUEUED', 'PLANNING', 'SUBMITTED', 'RUNNING', 'PROCESSING_RESULT', 'READY', 'FAILED', 'CANCELLED'] as const;
export type WalkState = typeof WALK_STATES[number];
export const TERMINAL: ReadonlySet<WalkState> = new Set<WalkState>(['READY', 'FAILED', 'CANCELLED']);
export const isTerminal = (s: string): boolean => TERMINAL.has(s as WalkState);

/** Longer than one step can take in an edge invocation (the OpenAI plan is the longest), so a live worker is never taken over. */
export const LEASE_MS = 4 * 60_000;
/** Plan attempts (one OpenAI scene plan each). */
export const MAX_PLAN_ATTEMPTS = 2;
/** Factory submissions: a second only after the first was proven dead at the provider. */
export const MAX_SUBMIT_ATTEMPTS = 2;
/** Result-processing attempts (re-reading and verifying the outputs). */
export const MAX_RESULT_ATTEMPTS = 3;
/** Every claim of any step, together: the backstop against a loop nobody foresaw. */
export const MAX_ATTEMPTS = 240;
/** From submission to a finished provider job (the worker's own deadline is 900 s; queue and cold start on top). */
export const PROVIDER_DEADLINE_MS = 35 * 60_000;
/** How soon the provider is asked again while it works. */
export const POLL_MS = { queued: 20_000, running: 15_000, unknown: 30_000 } as const;

export interface WalkRow {
  state: WalkState;
  attempts: number;
  plan_attempts: number;
  submit_attempts: number;
  result_attempts: number;
  lease_at: string | null;
  next_check_at: string | null;
  deadline_at: string | null;
  scene_plan: unknown | null;
  walk_version_id: string | null;
  factory_job_id: string | null;
  provider_job_id: string | null;
}

export const leaseFree = (row: Pick<WalkRow, 'lease_at'>, now: number): boolean =>
  !row.lease_at || Date.parse(row.lease_at) <= now - LEASE_MS;

export const due = (row: Pick<WalkRow, 'next_check_at'>, now: number): boolean =>
  !row.next_check_at || Date.parse(row.next_check_at) <= now;

/** What the next claim of this row must do. */
export type Step =
  | { kind: 'WAIT'; reason: 'TERMINAL' | 'LEASED' | 'NOT_DUE' }
  | { kind: 'FAIL'; code: string }
  | { kind: 'PLAN' }
  | { kind: 'SUBMIT' }
  | { kind: 'POLL' }
  | { kind: 'PROCESS' };

export function nextStep(row: WalkRow, now: number, opts: { force?: boolean } = {}): Step {
  if (isTerminal(row.state)) return { kind: 'WAIT', reason: 'TERMINAL' };
  if (!leaseFree(row, now)) return { kind: 'WAIT', reason: 'LEASED' };
  if (!opts.force && !due(row, now)) return { kind: 'WAIT', reason: 'NOT_DUE' };
  if (row.attempts >= MAX_ATTEMPTS) return { kind: 'FAIL', code: 'TOO_MANY_ATTEMPTS' };
  switch (row.state) {
    case 'QUEUED':
    case 'PLANNING':
      // A plan already saved (an invocation that died after saving it) is never asked for again.
      if (row.scene_plan && row.walk_version_id) return row.factory_job_id ? { kind: 'POLL' } : row.submit_attempts >= MAX_SUBMIT_ATTEMPTS ? { kind: 'FAIL', code: 'SUBMIT_FAILED' } : { kind: 'SUBMIT' };
      return row.plan_attempts >= MAX_PLAN_ATTEMPTS ? { kind: 'FAIL', code: 'PLAN_FAILED' } : { kind: 'PLAN' };
    case 'SUBMITTED':
    case 'RUNNING':
      if (!row.factory_job_id) return row.submit_attempts >= MAX_SUBMIT_ATTEMPTS ? { kind: 'FAIL', code: 'SUBMIT_FAILED' } : { kind: 'SUBMIT' };
      return { kind: 'POLL' };
    case 'PROCESSING_RESULT':
      return row.result_attempts >= MAX_RESULT_ATTEMPTS ? { kind: 'FAIL', code: 'RESULT_PROCESSING_FAILED' } : { kind: 'PROCESS' };
  }
  return { kind: 'FAIL', code: 'UNKNOWN_STATE' };
}

/** What the provider said about the one job this walkthrough submitted (RunPod /status). */
export type ProviderPoll =
  | { kind: 'QUEUED' }
  | { kind: 'RUNNING'; stage: string | null }
  | { kind: 'COMPLETED' }
  | { kind: 'FAILED'; status: string; error: string | null }
  /** The provider no longer knows the job (expired, purged) or never answered usefully. */
  | { kind: 'UNKNOWN'; httpStatus: number | null };

export type PollDecision =
  | { kind: 'CONTINUE'; state: 'SUBMITTED' | 'RUNNING'; stage: string | null; nextInMs: number }
  | { kind: 'PROCESS' }
  /** The job is dead at the provider: submit again (a fresh job) while attempts remain. */
  | { kind: 'RESUBMIT'; reason: string }
  | { kind: 'FAIL'; code: string; cancelProvider: boolean };

/** Provider failures worth one more job (the infrastructure failed, not the spec). */
const RETRYABLE_PROVIDER = new Set(['TIMED_OUT', 'CANCELLED', 'WORKER_LOST']);

export function decidePoll(row: Pick<WalkRow, 'submit_attempts' | 'deadline_at'>, poll: ProviderPoll, now: number): PollDecision {
  const late = !!row.deadline_at && Date.parse(row.deadline_at) <= now;
  switch (poll.kind) {
    case 'COMPLETED':
      return { kind: 'PROCESS' };
    case 'QUEUED':
    case 'RUNNING':
      if (late) return { kind: 'FAIL', code: 'PROVIDER_TIMEOUT', cancelProvider: true };
      return poll.kind === 'QUEUED'
        ? { kind: 'CONTINUE', state: 'SUBMITTED', stage: null, nextInMs: POLL_MS.queued }
        : { kind: 'CONTINUE', state: 'RUNNING', stage: poll.stage, nextInMs: POLL_MS.running };
    case 'FAILED': {
      const retry = RETRYABLE_PROVIDER.has(poll.status) && row.submit_attempts < MAX_SUBMIT_ATTEMPTS;
      return retry ? { kind: 'RESUBMIT', reason: `PROVIDER_${poll.status}` } : { kind: 'FAIL', code: `PROVIDER_${poll.status || 'FAILED'}`, cancelProvider: false };
    }
    case 'UNKNOWN':
      // Unknown is never treated as finished or as failed while there is still time: ask again later.
      if (!late) return { kind: 'CONTINUE', state: 'RUNNING', stage: null, nextInMs: POLL_MS.unknown };
      return { kind: 'FAIL', code: poll.httpStatus === 404 ? 'PROVIDER_LOST' : 'PROVIDER_UNREACHABLE', cancelProvider: poll.httpStatus !== 404 };
  }
}

/** RunPod's /status answer → ProviderPoll. `httpStatus` null: the request itself failed. */
export function readProviderStatus(httpStatus: number | null, body: unknown, stages: ReadonlySet<string>): ProviderPoll {
  if (httpStatus === null || httpStatus >= 500 || httpStatus === 429) return { kind: 'UNKNOWN', httpStatus };
  if (httpStatus === 404 || httpStatus === 400) return { kind: 'UNKNOWN', httpStatus };
  if (httpStatus !== 200 || !body || typeof body !== 'object') return { kind: 'UNKNOWN', httpStatus };
  const b = body as { status?: unknown; output?: { stage?: unknown; ok?: unknown; error?: unknown } | null; error?: unknown };
  const status = String(b.status ?? '');
  if (status === 'IN_QUEUE') return { kind: 'QUEUED' };
  if (status === 'IN_PROGRESS') {
    const stage = typeof b.output?.stage === 'string' && stages.has(b.output.stage) ? b.output.stage : null;
    return { kind: 'RUNNING', stage };
  }
  if (status === 'COMPLETED') {
    // A worker that ran and reported its own failure is a failed job, not a result.
    if (b.output && b.output.ok === false) return { kind: 'FAILED', status: 'WORKER_ERROR', error: typeof b.output.error === 'string' ? b.output.error.slice(0, 200) : null };
    return { kind: 'COMPLETED' };
  }
  if (status === 'FAILED' || status === 'CANCELLED' || status === 'TIMED_OUT') {
    return { kind: 'FAILED', status, error: typeof b.error === 'string' ? b.error.slice(0, 200) : null };
  }
  return { kind: 'UNKNOWN', httpStatus };
}

// ── Identity ──────────────────────────────────────────────────────────────────

/**
 * The text whose sha256 is the walkthrough's idempotency key: the engine, the
 * project, the design version AND the exact state it is at (its revision
 * counter), and the walkthrough revision. Same design, same request → same
 * row → same RunPod job.
 */
export const identityText = (a: { projectId: string; designVersionId: string; designRevision: number; revision: number }): string =>
  `${WALKTHROUGH_ENGINE}|${a.projectId}|${a.designVersionId}|${a.designRevision}|${a.revision}`;

// ── What the customer is shown (real stages only) ────────────────────────────

/** Customer-facing progress: one step per real server state, never a percentage. */
export const PROGRESS_STEPS = ['PLANNING', 'BUILDING', 'FINISHING', 'READY'] as const;
export type ProgressStep = typeof PROGRESS_STEPS[number];

export function progressOf(state: string): ProgressStep | 'FAILED' | 'CANCELLED' {
  switch (state) {
    case 'QUEUED': case 'PLANNING': return 'PLANNING';
    case 'SUBMITTED': case 'RUNNING': return 'BUILDING';
    case 'PROCESSING_RESULT': return 'FINISHING';
    case 'READY': return 'READY';
    case 'CANCELLED': return 'CANCELLED';
    default: return 'FAILED';
  }
}

/** Failures a person can do something about by trying again (everything except a design that cannot be walked). */
export const RETRYABLE_FAILURES = new Set([
  'PLAN_FAILED', 'SUBMIT_FAILED', 'RESULT_PROCESSING_FAILED', 'PROVIDER_TIMEOUT', 'PROVIDER_LOST', 'PROVIDER_UNREACHABLE',
  'PROVIDER_FAILED', 'PROVIDER_TIMED_OUT', 'PROVIDER_CANCELLED', 'PROVIDER_WORKER_ERROR', 'PROVIDER_WORKER_LOST', 'TOO_MANY_ATTEMPTS', 'FACTORY_UNAVAILABLE',
  'RESULT_INVALID', 'FACTORY_JOB_MISSING', 'WALK_VERSION_MISSING',
]);

/** May the customer try again? A refused spec or a step that threw is HOMATCH's own failure: retried once it is fixed. */
export const retryableFailure = (code: string | null | undefined): boolean =>
  !!code && (RETRYABLE_FAILURES.has(code) || code.startsWith('BAD_SPEC') || code.startsWith('STEP_'));
