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

import { rsDomOnlyNoResult, rsStatusFromTaskError, withoutRsRaw } from './rsTaxpayer.ts';
import { parentCadastral } from './cadastralInput.ts';
import { decodeLegacyGeorgian } from './legacyGeorgian.ts';

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

/*
 * THE PARENT PARCEL, WHEN THE CODE ITSELF FINDS NOTHING (owner 2026-10-24).
 *
 * TAS and TAS_MAP already search the parcel of a unit code; MyGov (Service
 * 176) searches the exact code only. When every primary source has finished
 * and none found anything — MyGov having CONFIRMED there is no record, not
 * failed — MyGov is asked once more for the parent parcel. Its dedupe key has
 * no ':' so it gates the stage like a primary. A source that failed is never
 * a reason: that is "unavailable", not "absent".
 */
export const PARENT_ROUND_KEY = 'mygov_parent';
const PRIMARY_KEYS = new Set(['TAS_MAP', 'tas', 'mygov']);
const confirmedAbsent = (r: QueueTaskRow | undefined) => !!r && r.state === 'SUCCEEDED' && r.result?.status === 'NO_RESULT_CONFIRMED';
const foundSomething = (r: QueueTaskRow) => r.state === 'SUCCEEDED' && (r.result?.resultConfirmed === true || r.result?.status === 'SEARCH_CONFIRMED');

export function parentRoundTask(rows: QueueTaskRow[], captchaPolicy?: unknown): TaskPlan | null {
  if (rows.some((r) => r.dedupe_key === PARENT_ROUND_KEY)) return null;
  const primaries = rows.filter((r) => PRIMARY_KEYS.has(r.dedupe_key));
  const mygov = primaries.find((r) => r.dedupe_key === 'mygov');
  if (!mygov || !primaries.every((r) => TERMINAL_TASK_STATES.has(String(r.state)))) return null;
  if (primaries.some(foundSomething) || !confirmedAbsent(mygov)) return null;
  const c = code(mygov.input?.cadastral ?? mygov.input?.query);
  const parent = c ? parentCadastral(c) : null;
  if (!parent) return null;
  return { source: 'mygov', dedupeKey: PARENT_ROUND_KEY, scopeKey: `mygov:${parent}`, input: { cadastral: parent, query: parent, mode: 'cadastral', parentOf: c, captchaPolicy: captchaPolicy ?? null }, priority: 100 };
}

/**
 * The code does not exist: every official source finished and CONFIRMED it
 * has no record — for the code and, when it has one, for its parent parcel.
 * Any failed, cancelled or still-running source makes this false.
 */
export function officialCodeNotFound(rows: QueueTaskRow[]): boolean {
  const primaries = rows.filter((r) => PRIMARY_KEYS.has(r.dedupe_key));
  if (primaries.length < 2 || !primaries.every(confirmedAbsent)) return false;
  const mygov = primaries.find((r) => r.dedupe_key === 'mygov');
  const c = code(mygov?.input?.cadastral ?? mygov?.input?.query);
  if (c && parentCadastral(c)) return confirmedAbsent(rows.find((r) => r.dedupe_key === PARENT_ROUND_KEY));
  return true;
}

/**
 * Follow-up tasks that the current rows call for, mirroring the worker:
 *   * once every primary task is terminal, registry lookups (ENREG, Debtor)
 *     for up to three identified companies named in the official documents;
 *   * the legacy TAS browser workflow once, when TAS API_FIRST ended without
 *     a result and the admin configured LEGACY as its fallback.
 * Deduplicated against what the job already has, so calling it again plans
 * nothing new.
 */
export function followUpTasks(
  rows: QueueTaskRow[],
  ctx: { tasImplementation?: TasImplementationLike | null; captchaPolicy?: { enabled?: boolean; providers?: { rstax?: boolean } } | null } = {},
): TaskPlan[] {
  const have = new Set(rows.map((r) => r.dedupe_key));
  const out: TaskPlan[] = [];
  const parent = parentRoundTask(rows, ctx.captchaPolicy);
  if (parent) out.push(parent);
  const tas = rows.find((r) => r.source === 'tas' && r.dedupe_key === 'tas');
  const fallbackLegacy = String(ctx.tasImplementation?.fallback ?? '').toUpperCase() === 'LEGACY';
  if (tas && fallbackLegacy && (tas.state === 'FAILED' || tas.state === 'DEAD') && !have.has('tas_legacy')) {
    const c = code(tas.input?.cadastral ?? tas.input?.query);
    if (c) out.push({ source: 'tas_legacy', dedupeKey: 'tas_legacy', scopeKey: `tas_legacy:${c}`, input: { cadastral: c, query: c, mode: 'cadastral' }, priority: 100 });
  }
  /*
   * REGISTRY LOOKUPS START AS SOON AS A SOURCE NAMES A COMPANY.
   *
   * They used to wait for EVERY primary source to finish. Owner live run
   * 2026-10-11: MyGov named the companies at 06:44, TAS finished at 06:51,
   * so ENREG/Debtor sat idle for seven minutes, and RS.ge only started after
   * the whole official stage — then took seven more minutes on the critical
   * path. Now each succeeded primary's companies are looked up at once, in
   * parallel with the slower sources, and RS.ge (the one CAPTCHA lookup) is
   * started for the first company in the same breath. The later financial
   * stage asks for the same task and finds it running or finished. Still at
   * most MAX_QUEUE_ENTITY_COMPANIES companies per job, and still only the
   * PRIMARY sources' companies: a registry extract never fans out again.
   */
  const primaries = rows.filter(isPrimary);
  const succeeded = primaries.filter((r) => r.state === 'SUCCEEDED');
  if (succeeded.length && !out.some((t) => t.source === 'tas_legacy')) {
    const ordered = [...succeeded].sort((a, b) => String(a.finished_at ?? a.created_at ?? '').localeCompare(String(b.finished_at ?? b.created_at ?? '')) || a.dedupe_key.localeCompare(b.dedupe_key));
    const companies = new Set(
      rows.filter((r) => !isPrimary(r) && ENTITY_FOLLOW_UP_SOURCES.includes(r.source as any)).map((r) => String(r.dedupe_key).split(':').slice(1).join(':')),
    );
    const rstaxOn = !!ctx.captchaPolicy && ctx.captchaPolicy.enabled !== false && ctx.captchaPolicy.providers?.rstax !== false;
    const rstaxPlanned = rows.some((r) => r.source === 'rstax');
    let first = true;
    for (const e of confirmedEntities(ordered)) {
      const key = String(e.identificationCode);
      if (!companies.has(key) && companies.size >= MAX_QUEUE_ENTITY_COMPANIES) break;
      companies.add(key);
      for (const source of ENTITY_FOLLOW_UP_SOURCES) {
        const t = entityTask(source, { idCode: e.identificationCode, name: e.name });
        if (!have.has(t.dedupeKey)) out.push(t);
      }
      if (first && rstaxOn && !rstaxPlanned) {
        const t = entityTask('rstax', { idCode: e.identificationCode, name: e.name }, ctx.captchaPolicy);
        if (!have.has(t.dedupeKey)) out.push(t);
      }
      first = false;
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

/*
 * SOURCE OUTCOMES (official-worker src/queue/sourceOutcome.ts). A task is
 * SUCCEEDED only for RETRIEVED, PARTIAL (what was read is kept) and
 * NO_RECORD_CONFIRMED; the worker stamps the outcome on the result, and on a
 * failed task's error as "sourceOutcome=<X> reason=<Y>". A DEAD task ran out
 * of attempts: RETRY_EXHAUSTED. Older rows carry no tag; their outcome is
 * read from the existing prefixes.
 */
export type SourceOutcome =
  | 'RETRIEVED' | 'PARTIAL' | 'NO_RECORD_CONFIRMED'
  | 'CAPTCHA_BLOCKED' | 'UNPARSEABLE' | 'PROVIDER_UNAVAILABLE' | 'RETRY_EXHAUSTED' | 'AUTH_REQUIRED';
const OUTCOMES: ReadonlySet<string> = new Set(['RETRIEVED', 'PARTIAL', 'NO_RECORD_CONFIRMED', 'CAPTCHA_BLOCKED', 'UNPARSEABLE', 'PROVIDER_UNAVAILABLE', 'RETRY_EXHAUSTED', 'AUTH_REQUIRED']);

/** A failed task's outcome and machine reason, from its error text. */
export function failedTaskOutcome(state: string, error: unknown): { sourceOutcome: SourceOutcome; outcomeReason: string | null } {
  const s = String(error ?? '');
  const tagged = /\bsourceOutcome=([A-Z_]+)\b/.exec(s)?.[1];
  const reason = /\breason=([A-Za-z0-9_,]+)/.exec(s)?.[1] ?? null;
  const outcome: SourceOutcome = tagged && OUTCOMES.has(tagged)
    ? (tagged as SourceOutcome)
    : /HUMAN_VERIFICATION_REQUIRED|CAPTCHA_|outcome=REJECTED/.test(s)
      ? 'CAPTCHA_BLOCKED'
      : /outcome=UNPARSEABLE|RS_VERIFICATION_FAILED/.test(s)
        ? 'UNPARSEABLE'
        : 'PROVIDER_UNAVAILABLE';
  // Out of attempts: the last attempt's own outcome stays as the reason.
  if (state === 'DEAD') return { sourceOutcome: 'RETRY_EXHAUSTED', outcomeReason: outcome };
  return { sourceOutcome: outcome, outcomeReason: reason };
}

/** The result a source contributes, or an honest placeholder when it has none. */
export function taskResult(r: QueueTaskRow): any | null {
  const entity = r.input && (r.input.idCode || r.input.name) && !isPrimary(r) ? { name: r.input.name ?? null, idCode: r.input.idCode ?? null } : null;
  if (r.state === 'SUCCEEDED' && r.result && typeof r.result === 'object') {
    // _exec: the worker's timing stamp — performance diagnostics only.
    // RS.ge's raw answer lives in evidence storage, never in the job row.
    const { queueEntities: _drop, _exec: _dropExec, ...rest } = withoutRsRaw(r.result);
    // Results stored (or reused from the 24 h cache) before the worker decoded legacy-font Georgian.
    if (Array.isArray(rest.documents)) rest.documents = rest.documents.map((d: any) => (d && typeof d.rawText === 'string' ? { ...d, rawText: decodeLegacyGeorgian(d.rawText) } : d));
    // An RS.ge "no record" that only the page said, over an unreadable
    // answer (stored before the worker fix, or reused from the 24 h cache),
    // is not a confirmed absence: it reads as the failed check it was.
    if ((r.source === 'rstax' || rest.source === 'rstax') && rsDomOnlyNoResult(rest.rsVerification)) {
      return {
        ...rest,
        status: 'VERIFICATION_FAILED',
        rsVerification: { ...rest.rsVerification, status: 'VERIFICATION_FAILED', serverOutcome: 'UNPARSEABLE' },
        resultConfirmed: false,
        noResultConfirmed: false,
        resultValidated: false,
        sourceOutcome: 'UNPARSEABLE',
        outcomeReason: String(rest.rsVerification?.reason ?? 'PAGE_READ_UNPARSEABLE'),
        ...(entity && !rest.forEntity ? { forEntity: entity } : {}),
        queue: { taskId: r.id, reused: r.reused ?? null, attempts: r.attempts ?? null },
      };
    }
    return {
      ...rest,
      source: rest.source ?? (r.source === 'tas_legacy' ? 'tas' : r.source),
      ...(r.input?.parentOf ? { searchedCode: r.input.cadastral ?? null, parentOf: r.input.parentOf, scope: 'PARENT_PARCEL' } : {}),
      ...(entity && !rest.forEntity ? { forEntity: entity } : {}),
      queue: { taskId: r.id, reused: r.reused ?? null, attempts: r.attempts ?? null },
    };
  }
  if (r.state === 'FAILED' || r.state === 'DEAD') {
    const source = r.source === 'tas_legacy' ? 'tas' : r.source;
    // RS.ge says which of its four states it ended in (rs=… in the error).
    const rs = source === 'rstax' ? rsStatusFromTaskError(r.error) : null;
    const human = rs ? rs === 'PENDING_VERIFICATION' : /HUMAN_VERIFICATION_REQUIRED/.test(String(r.error ?? ''));
    const evidence = rs ? /\bevidence=([0-9a-f]{64})\b/.exec(String(r.error ?? ''))?.[1] ?? null : null;
    return {
      source,
      sourceName: source,
      status: human ? 'SKIPPED_HUMAN_VERIFICATION' : rs === 'VERIFICATION_FAILED' ? 'VERIFICATION_FAILED' : rs === 'TEMPORARILY_UNAVAILABLE' ? 'TEMPORARILY_UNAVAILABLE' : 'FAILED',
      ...(rs ? { rsVerification: { status: rs, ...(evidence ? { rawResponseRef: { sha256: evidence } } : {}) } } : {}),
      traversal: human ? { status: 'SKIPPED_HUMAN_VERIFICATION' } : null,
      error: human ? null : publicTaskError(r.error),
      ...failedTaskOutcome(String(r.state), r.error),
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
  /** Official tasks still waiting their turn (QUEUED / WAITING_SHARED): queue time is not execution time. */
  waitingTasks: number;
  /** The most recent start among tasks still running: each running task gets its own full execution window. */
  latestRunningStartedAt: string | null;
} {
  const sorted = [...rows].sort((a, b) =>
    (ORDER[a.source] ?? 10) - (ORDER[b.source] ?? 10) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  // A TAS API task that failed and was replaced by the legacy fallback
  // contributes nothing of its own: the fallback's result stands for TAS.
  const replaced = sorted.some((r) => r.source === 'tas_legacy' && r.dedupe_key === 'tas_legacy');
  const visible = sorted.filter((r) => !(replaced && r.source === 'tas' && r.dedupe_key === 'tas' && r.state !== 'SUCCEEDED'));
  const results = visible.map(taskResult).filter(Boolean);
  /*
   * RS.ge never holds the official stage open. It is one CAPTCHA lookup that
   * takes 2–7 minutes; the stage finishes on its other sources, an RS.ge
   * result already in is included, and one still running is picked up later
   * by the financial stage (the same task: enqueue is idempotent per job and
   * key), so the report's other sections never wait on it.
   */
  const gating = rows.filter((r) => r.source !== 'rstax');
  const terminal = gating.length > 0 && gating.every((r) => TERMINAL_TASK_STATES.has(String(r.state)));
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
    stragglersRetrying: !terminal && gating.filter((r) => !TERMINAL_TASK_STATES.has(String(r.state))).every((r) => Number(r.attempts ?? 0) > 1),
    waitingTasks: gating.filter((r) => r.state === 'QUEUED' || r.state === 'WAITING_SHARED').length,
    latestRunningStartedAt: (gating.filter((r) => r.state === 'RUNNING' && r.started_at).map((r) => String(r.started_at)).sort().pop()) ?? null,
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

/*
 * THE OFFICIAL STAGE, AS IT HAPPENS (customer progress only).
 *
 * Owner live run 2026-10-11: MyGov and TAS had both finished while the job
 * page still showed every official section as "not started" — the sections
 * read result_json, and result_json only receives the official results when
 * the whole stage ends. This is the per-source state of the primary tasks,
 * written on every tick while the stage runs, so the page can say what has
 * genuinely finished. States only: no payload, no personal data.
 */
export type OfficialLiveState = 'QUEUED' | 'RUNNING' | 'DONE' | 'UNAVAILABLE';
export interface OfficialLive {
  sources: Array<{ source: string; state: OfficialLiveState }>;
  done: number;
  total: number;
}
export function officialLiveOf(rows: QueueTaskRow[]): OfficialLive {
  const sorted = [...rows].filter(isPrimary).sort((a, b) => (ORDER[a.source] ?? 10) - (ORDER[b.source] ?? 10));
  const replaced = sorted.some((r) => r.source === 'tas_legacy');
  const sources = sorted
    .filter((r) => !(replaced && r.source === 'tas' && r.state !== 'SUCCEEDED'))
    .map((r) => {
      const s = String(r.state);
      const state: OfficialLiveState = s === 'SUCCEEDED'
        ? 'DONE'
        : TERMINAL_TASK_STATES.has(s)
          ? 'UNAVAILABLE'
          : s === 'QUEUED' && !r.started_at
            ? 'QUEUED'
            : 'RUNNING';
      return { source: r.source === 'tas_legacy' ? 'tas' : r.source, state };
    });
  return { sources, done: sources.filter((s) => s.state === 'DONE' || s.state === 'UNAVAILABLE').length, total: sources.length };
}
