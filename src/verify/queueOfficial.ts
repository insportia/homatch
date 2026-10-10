/*
 * DURABLE OFFICIAL RESEARCH — the research-agent side of the Verify queue.
 *
 * In QUEUE mode (admin_settings.verify_execution_mode = "QUEUE") the official
 * sources of a cadastral Verify are not one long in-memory worker job any
 * more: each source is a row in verify_tasks (migration 20261026090000),
 * claimed by any worker replica under a lease, retried with backoff, shared
 * between jobs that ask the same question (single-flight + evidence cache),
 * and surviving worker restarts and deploys.
 *
 * This module is pure: it plans the tasks of a job and turns the job's task
 * rows back into the exact shape research-agent already consumes from the
 * worker (`{status, steps, results, discoveredEntities, ...}`), so every
 * downstream stage — official prompt, TAS intelligence, visuals, synthesis —
 * reads queue results and legacy results identically.
 */

export const QUEUE_SOURCES_CADASTRAL = ['TAS_MAP', 'tas', 'mygov'] as const;
/** Same bound as the worker's in-job entity follow-ups (MAX_AUTO_ENREG_ENTITIES). */
export const MAX_QUEUE_ENTITY_COMPANIES = 3;
/** rstax stays out of automatic follow-ups for the same reason as in the worker. */
const ENTITY_FOLLOW_UP_SOURCES = ['enreg', 'debtor'] as const;

export type QueueState = 'QUEUED' | 'RUNNING' | 'WAITING_SHARED' | 'SUCCEEDED' | 'FAILED' | 'DEAD' | 'CANCELLED';
export const TERMINAL_TASK_STATES: ReadonlySet<string> = new Set(['SUCCEEDED', 'FAILED', 'DEAD', 'CANCELLED']);

export interface QueueTaskRow {
  id: string;
  source: string;
  dedupe_key: string;
  state: QueueState | string;
  input?: Record<string, any> | null;
  result?: any;
  error?: string | null;
  reused?: string | null;
  attempts?: number | null;
  created_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  updated_at?: string | null;
}

export interface TaskPlan {
  source: string;
  dedupeKey: string;
  scopeKey: string | null;
  input: Record<string, unknown>;
  priority: number;
}

export interface TasImplementationLike {
  active?: string | null;
  fallback?: string | null;
}

/** Normalised cadastral code used in scope keys (no spaces, as validated at start). */
const code = (q: unknown) => String(q ?? '').trim().replace(/\s+/g, '');

/**
 * The primary official tasks of a job. Cadastral jobs only: property-mode
 * jobs keep the legacy in-worker path (their primary ENREG/NAPR steps are
 * query-shaped, not scope-shaped).
 */
export function officialTaskPlan(
  job: { mode: string; query: string },
  ctx: { tasImplementation?: TasImplementationLike | null; captchaPolicy?: unknown } = {},
): TaskPlan[] {
  if (job.mode !== 'cadastral') return [];
  const c = code(job.query);
  if (!c) return [];
  const legacyTas = String(ctx.tasImplementation?.active ?? '').toUpperCase() === 'LEGACY';
  const base = { cadastral: c, query: c, mode: 'cadastral' };
  return [
    { source: 'TAS_MAP', dedupeKey: 'TAS_MAP', scopeKey: `TAS_MAP:${c}`, input: base, priority: 100 },
    legacyTas
      ? { source: 'tas_legacy', dedupeKey: 'tas', scopeKey: `tas_legacy:${c}`, input: base, priority: 100 }
      : { source: 'tas', dedupeKey: 'tas', scopeKey: `tas:${c}`, input: base, priority: 100 },
    { source: 'mygov', dedupeKey: 'mygov', scopeKey: `mygov:${c}`, input: { ...base, captchaPolicy: ctx.captchaPolicy ?? null }, priority: 100 },
  ];
}

/** One registry lookup for one company, as a task. */
export function entityTask(source: 'enreg' | 'rstax' | 'debtor', entity: { idCode: string | null; name: string }, captchaPolicy?: unknown): TaskPlan {
  const id = entity.idCode ? String(entity.idCode).trim() : null;
  const keyPart = id ?? `name:${String(entity.name).trim().toLowerCase().slice(0, 120)}`;
  return {
    source,
    dedupeKey: `${source}:${keyPart}`,
    // Only an identified company is shareable across jobs: a name search is
    // the job's own question.
    scopeKey: id ? `${source}:${id}` : null,
    input: { idCode: id, name: entity.name, query: id ?? entity.name, mode: 'cadastral', ...(source === 'rstax' ? { captchaPolicy: captchaPolicy ?? null } : {}) },
    priority: 120,
  };
}

const isPrimary = (r: QueueTaskRow) => !String(r.dedupe_key).includes(':');

/**
 * Follow-up tasks that the current rows call for, mirroring the worker:
 *   * once every primary task is terminal, registry lookups (ENREG, Debtor)
 *     for up to three identified companies named in the official documents;
 *   * the legacy TAS browser workflow once, when TAS API_FIRST ended without
 *     a result and the admin configured LEGACY as its fallback.
 * Deduplicated against what the job already has, so calling it again plans
 * nothing new.
 */
export function followUpTasks(rows: QueueTaskRow[], ctx: { tasImplementation?: TasImplementationLike | null } = {}): TaskPlan[] {
  const have = new Set(rows.map((r) => r.dedupe_key));
  const out: TaskPlan[] = [];
  const tas = rows.find((r) => r.source === 'tas' && r.dedupe_key === 'tas');
  const fallbackLegacy = String(ctx.tasImplementation?.fallback ?? '').toUpperCase() === 'LEGACY';
  if (tas && fallbackLegacy && (tas.state === 'FAILED' || tas.state === 'DEAD') && !have.has('tas_legacy')) {
    const c = code(tas.input?.cadastral ?? tas.input?.query);
    if (c) out.push({ source: 'tas_legacy', dedupeKey: 'tas_legacy', scopeKey: `tas_legacy:${c}`, input: { cadastral: c, query: c, mode: 'cadastral' }, priority: 100 });
  }
  const primaries = rows.filter(isPrimary);
  const primaryDone = primaries.length > 0 && primaries.every((r) => TERMINAL_TASK_STATES.has(String(r.state))) && !out.length;
  if (primaryDone) {
    // Companies named by the PRIMARY sources only, as in the worker: a
    // registry extract naming further companies never fans out again.
    const ordered = [...primaries].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || a.dedupe_key.localeCompare(b.dedupe_key));
    for (const e of confirmedEntities(ordered).slice(0, MAX_QUEUE_ENTITY_COMPANIES)) {
      for (const source of ENTITY_FOLLOW_UP_SOURCES) {
        const t = entityTask(source, { idCode: e.identificationCode, name: e.name });
        if (!have.has(t.dedupeKey)) out.push(t);
      }
    }
  }
  return out;
}

/** Every company/person the official documents named, deduplicated. */
export function discoveredEntitiesOf(rows: QueueTaskRow[]): any[] {
  const seen = new Map<string, any>();
  for (const r of rows) {
    const list = r.state === 'SUCCEEDED' && Array.isArray(r.result?.queueEntities) ? r.result.queueEntities : [];
    for (const e of list) {
      if (!e || typeof e !== 'object') continue;
      const k = e.identificationCode ? `id:${e.identificationCode}` : `n:${String(e.name ?? '').toLowerCase()}`;
      if (!seen.has(k)) seen.set(k, e);
    }
  }
  return [...seen.values()];
}

function confirmedEntities(rows: QueueTaskRow[]): Array<{ identificationCode: string; name: string }> {
  return discoveredEntitiesOf(rows)
    .filter((e) => typeof e.identificationCode === 'string' && e.identificationCode.trim())
    .map((e) => ({ identificationCode: String(e.identificationCode).trim(), name: String(e.name ?? e.identificationCode) }));
}

/** The result a source contributes, or an honest placeholder when it has none. */
export function taskResult(r: QueueTaskRow): any | null {
  const entity = r.input && (r.input.idCode || r.input.name) && !isPrimary(r) ? { name: r.input.name ?? null, idCode: r.input.idCode ?? null } : null;
  if (r.state === 'SUCCEEDED' && r.result && typeof r.result === 'object') {
    const { queueEntities: _drop, ...rest } = r.result;
    return {
      ...rest,
      source: rest.source ?? (r.source === 'tas_legacy' ? 'tas' : r.source),
      ...(entity && !rest.forEntity ? { forEntity: entity } : {}),
      queue: { taskId: r.id, reused: r.reused ?? null, attempts: r.attempts ?? null },
    };
  }
  if (r.state === 'FAILED' || r.state === 'DEAD') {
    const human = /HUMAN_VERIFICATION_REQUIRED/.test(String(r.error ?? ''));
    const source = r.source === 'tas_legacy' ? 'tas' : r.source;
    return {
      source,
      sourceName: source,
      status: human ? 'SKIPPED_HUMAN_VERIFICATION' : 'FAILED',
      traversal: human ? { status: 'SKIPPED_HUMAN_VERIFICATION' } : null,
      error: human ? null : publicTaskError(r.error),
      documents: [],
      discoveredEntities: [],
      resultConfirmed: false,
      noResultConfirmed: false,
      resultValidated: false,
      forEntity: entity,
      ...(human ? { skippedHumanVerification: true } : {}),
      retrievedAt: r.finished_at ?? r.updated_at ?? null,
      queue: { taskId: r.id, state: r.state, attempts: r.attempts ?? null },
    };
  }
  return null;
}

/** Internal error text reduced to a stable, non-sensitive code. */
export function publicTaskError(e: unknown): string {
  const s = String(e ?? '');
  if (/SHARED_PRODUCER/.test(s)) return 'SHARED_SOURCE_UNAVAILABLE';
  if (/LEASE_EXPIRED/.test(s)) return 'SOURCE_TIMED_OUT';
  if (/timeout|timed out/i.test(s)) return 'SOURCE_TIMED_OUT';
  if (/CANCEL/.test(s)) return 'CANCELLED';
  return 'SOURCE_UNAVAILABLE';
}

const ORDER: Record<string, number> = { TAS_MAP: 0, tas: 1, tas_legacy: 2, mygov: 3 };

/**
 * The job's task rows as the worker job view research-agent already reads.
 * `status` is COMPLETE only when every task is terminal; QUEUED while none
 * has started (the job is waiting its turn, not slow).
 */
export function queueWorkerView(rows: QueueTaskRow[]): {
  view: 'queue';
  status: 'QUEUED' | 'RUNNING' | 'COMPLETE';
  steps: Array<{ type: string; key?: string; source?: string }>;
  results: any[];
  discoveredEntities: any[];
  runStartedAt: string | null;
  completedAt: string | null;
  sourceIndex: number;
  /** When the most recent task finished (null while none has). */
  lastFinishedAt: string | null;
  /**
   * Every unfinished task is a RETRY (attempts > 1): it already used a full
   * lease once. Waiting for it costs a whole second run while the rest of
   * the report sits ready.
   */
  stragglersRetrying: boolean;
} {
  const sorted = [...rows].sort((a, b) =>
    (ORDER[a.source] ?? 10) - (ORDER[b.source] ?? 10) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  // A TAS API task that failed and was replaced by the legacy fallback
  // contributes nothing of its own: the fallback's result stands for TAS.
  const replaced = sorted.some((r) => r.source === 'tas_legacy' && r.dedupe_key === 'tas_legacy');
  const visible = sorted.filter((r) => !(replaced && r.source === 'tas' && r.dedupe_key === 'tas' && r.state !== 'SUCCEEDED'));
  const results = visible.map(taskResult).filter(Boolean);
  const terminal = rows.length > 0 && rows.every((r) => TERMINAL_TASK_STATES.has(String(r.state)));
  const started = rows.map((r) => r.started_at).filter(Boolean).sort() as string[];
  const finished = rows.map((r) => r.finished_at).filter(Boolean).sort() as string[];
  const status = terminal ? 'COMPLETE' : started.length || rows.some((r) => r.state !== 'QUEUED') ? 'RUNNING' : 'QUEUED';
  return {
    view: 'queue',
    status,
    steps: visible.map((r) => (isPrimary(r) || r.dedupe_key === 'tas_legacy' ? { type: 'source', key: r.source } : { type: 'entity', source: r.source })),
    results,
    discoveredEntities: discoveredEntitiesOf(rows),
    runStartedAt: started[0] ?? null,
    completedAt: terminal ? finished[finished.length - 1] ?? null : null,
    sourceIndex: results.length,
    lastFinishedAt: finished[finished.length - 1] ?? null,
    stragglersRetrying: !terminal && rows.filter((r) => !TERMINAL_TASK_STATES.has(String(r.state))).every((r) => Number(r.attempts ?? 0) > 1),
  };
}

/** A single task (a financial-entity lookup) as a one-result worker view. */
export function singleTaskView(row: QueueTaskRow | null): { status: 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'FAILED'; results: any[] } {
  if (!row) return { status: 'FAILED', results: [] };
  if (row.state === 'SUCCEEDED') return { status: 'COMPLETE', results: [taskResult(row)].filter(Boolean) };
  if (row.state === 'FAILED' || row.state === 'DEAD') return { status: 'COMPLETE', results: [taskResult(row)].filter(Boolean) };
  if (row.state === 'CANCELLED') return { status: 'FAILED', results: [] };
  return { status: row.state === 'QUEUED' ? 'QUEUED' : 'RUNNING', results: [] };
}
