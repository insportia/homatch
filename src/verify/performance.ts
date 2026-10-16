/*
 * VERIFY END-TO-END PERFORMANCE — one pure function, server timestamps only.
 *
 * Answers the owner's question for any finished (or running) job: how long
 * did the customer wait from pressing Start to the complete report being
 * available, and where did that time go?
 *
 * Every timestamp read here was written by a server — Postgres (`created_at`,
 * `completed_at`, `synthesis_at`, verify_tasks `created_at/started_at/
 * finished_at`), research-agent (`result_json._stageTimes`), the official
 * worker (`verify_tasks.result._exec`, `tasApi.timings`) or verify-synthesis
 * (`synthesis_json._timing`). Nothing comes from a browser clock.
 *
 * The pipeline is sequential at the top level (identity → official sources →
 * official write-up → public research → market → research write-up →
 * finalize → report), so the top-level chain IS the critical path; inside the
 * official stage the sources run in parallel and the one that finished last
 * is the critical one. Time between two top-level stages that no stage
 * accounts for (driver ticks, polling, budget gates) is reported as hand-off
 * time rather than silently absorbed.
 *
 * Pure and dependency-free: imported by research-agent (Deno, admin
 * diagnostics) and by node tests.
 */

export interface PerfJob {
  id?: string | null;
  status?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
  synthesis_at?: string | null;
  synthesis_state?: string | null;
  updated_at?: string | null;
}

/** Worker-side stamp of one task's FINAL attempt (official-worker QueueRunner). */
export interface ExecStamp {
  startedAt?: string | null;
  finishedAt?: string | null;
  ms?: number | null;
  attempt?: number | null;
}

export interface PerfTask {
  id?: string | null;
  source: string;
  dedupe_key?: string | null;
  state?: string | null;
  attempts?: number | null;
  reused?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  exec?: ExecStamp | null;
  result?: { _exec?: ExecStamp | null } | null;
}

/** synthesis_json._timing, written by verify-synthesis. */
export interface SynthesisTiming {
  startedAt?: string | null;
  modelStartedAt?: string | null;
  modelEndedAt?: string | null;
  modelMs?: number | null;
  persistAt?: string | null;
  trigger?: string | null;
  forced?: boolean | null;
}

export interface PerfExtras {
  /** verify_captcha_events rows for this job. */
  captcha?: Array<{ task_id?: string | null; source?: string | null; solve_ms?: number | null; outcome?: string | null }>;
  /** For a job still running: the server's "now", to report elapsed time. */
  now?: string | null;
}

export type StageKind = 'pipeline' | 'task' | 'tas' | 'synthesis' | 'parallel';

export interface PerfStage {
  key: string;
  label: string;
  kind: StageKind;
  parent: string | null;
  startedAt: string | null;
  endedAt: string | null;
  /** Wall-clock span startedAt → endedAt (for a task: first claim → finish). */
  ms: number | null;
  /** Worker execution of the final attempt (tasks), when the worker stamped it. */
  execMs: number | null;
  /** Waiting in the queue before the first claim (tasks). */
  queueMs: number | null;
  attempts: number | null;
  /** Time spent on failed attempts before the final one (tasks). */
  retryMs: number | null;
  /** CAPTCHA solve time attributed to this stage. */
  captchaMs: number | null;
  /** Unaccounted time between the previous top-level stage and this one. */
  gapBeforeMs: number | null;
  status: string | null;
}

export type TasPriorityCoverage = 'COMPLETE' | 'PARTIAL' | null;

export interface VerifyPerformance {
  jobId: string | null;
  /** READY (report available) · RESEARCH_COMPLETE (report pending) · RUNNING · ENDED (failed/cancelled/paused). */
  state: 'READY' | 'RESEARCH_COMPLETE' | 'RUNNING' | 'ENDED';
  /** research_jobs.created_at — the customer's Start. */
  startedAt: string | null;
  /** research_jobs.completed_at — research finished. */
  researchCompletedAt: string | null;
  /** research_jobs.synthesis_at once synthesis_state is READY — report available. */
  readyAt: string | null;
  /** Start → report READY: what the customer actually waited. */
  totalMs: number | null;
  /** Start → research COMPLETE. */
  researchMs: number | null;
  /** Research COMPLETE → report READY (trigger wait + build + persist). */
  synthesisMs: number | null;
  /** Research COMPLETE → report build started (trigger latency). */
  synthesisWaitMs: number | null;
  /** Report build start → persist. */
  synthesisBuildMs: number | null;
  /** The report model call alone. */
  modelMs: number | null;
  /** First official task enqueued → first claimed by a worker (or legacy admission wait). */
  queueWaitMs: number | null;
  /** First moment a worker worked on this job. */
  firstWorkerActivityAt: string | null;
  /** Union of worker execution intervals — machine time, not customer waiting time. */
  workerMs: number | null;
  /** Sum of unaccounted gaps between top-level stages. */
  handoffMs: number | null;
  /** For a job not yet READY: Start → now (server clock, when given). */
  elapsedMs: number | null;
  retries: { count: number; ms: number };
  stages: PerfStage[];
  criticalPath: string[];
  bottleneck: string | null;
  coverage: { tasPriority: TasPriorityCoverage; sources: Record<string, { state: string | null; ms: number | null; attempts: number | null }> };
  /** The report was rebuilt after it was first READY: readyAt is the rebuild time. */
  rebuilt: boolean;
}

/* ── helpers ─────────────────────────────────────────────────────────── */

const ms = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const t = typeof v === 'number' ? v : Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
};
const iso = (t: number | null): string | null => (t === null ? null : new Date(t).toISOString());
const span = (a: unknown, b: unknown): number | null => {
  const x = ms(a);
  const y = ms(b);
  return x !== null && y !== null && y >= x ? y - x : null;
};
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

function stage(p: Partial<PerfStage> & { key: string; label: string; kind: StageKind }): PerfStage {
  const s: PerfStage = {
    parent: null, startedAt: null, endedAt: null, ms: null, execMs: null, queueMs: null,
    attempts: null, retryMs: null, captchaMs: null, gapBeforeMs: null, status: null, ...p,
  };
  if (s.ms === null) s.ms = span(s.startedAt, s.endedAt);
  return s;
}

/** Union length of [start, end] intervals. */
function unionMs(intervals: Array<[number, number]>): number {
  const sorted = intervals.filter(([a, b]) => b >= a).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let cs = -1;
  let ce = -1;
  for (const [a, b] of sorted) {
    if (a > ce) {
      if (ce >= cs && cs >= 0) total += ce - cs;
      cs = a;
      ce = b;
    } else if (b > ce) ce = b;
  }
  if (cs >= 0) total += ce - cs;
  return total;
}

const MODEL_STAGES: Array<[string, string]> = [
  ['identity', 'Identity (model)'],
  ['official_collection', 'Official write-up (model)'],
  ['public_research', 'Public research (model)'],
  ['market', 'Market (model)'],
  ['synthesis', 'Research write-up (model)'],
];

/** The order TAS sub-steps are listed in (unknown keys follow, alphabetically). */
export const TAS_TIMING_ORDER = ['search', 'detail', 'priorityCases', 'attachmentDownloads', 'pdfText', 'pageRender', 'visualClassify', 'olderCases'] as const;
const TAS_TIMING_LABEL: Record<string, string> = {
  search: 'TAS case search',
  detail: 'TAS case detail',
  priorityCases: 'TAS newest-two cases',
  attachmentDownloads: 'TAS attachment downloads',
  pdfText: 'TAS PDF text',
  pageRender: 'TAS page render',
  visualClassify: 'TAS visual analysis',
  olderCases: 'TAS older cases',
};

const SOURCE_LABEL: Record<string, string> = {
  tas: 'TAS', tas_legacy: 'TAS (legacy browser)', TAS_MAP: 'TAS map', mygov: 'MyGov / NAPR',
  enreg: 'Company registry', debtor: 'Debtor registry', rstax: 'RS.ge',
};

/** One tasApi.timings entry, whatever shape the worker gave it. */
function tasTiming(key: string, v: unknown, parent: string): PerfStage | null {
  if (typeof v === 'number') return stage({ key: `tas.${key}`, label: TAS_TIMING_LABEL[key] ?? `TAS ${key}`, kind: 'tas', parent, ms: num(v) });
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const startedAt = typeof o.startedAt === 'string' ? o.startedAt : null;
  const endedAt = typeof o.endedAt === 'string' ? o.endedAt : typeof o.finishedAt === 'string' ? o.finishedAt : null;
  const explicit = num(o.ms) ?? num(o.durationMs) ?? num(o.totalMs) ?? num(o.wallMs);
  const status = typeof o.status === 'string' ? o.status : o.complete === true ? 'COMPLETE' : o.complete === false ? 'PARTIAL' : null;
  return stage({
    key: `tas.${key}`, label: TAS_TIMING_LABEL[key] ?? `TAS ${key}`, kind: 'tas', parent,
    startedAt, endedAt, ms: explicit ?? span(startedAt, endedAt), attempts: num(o.attempts) ?? num(o.retries) ?? null,
    retryMs: num(o.retryMs), status,
  });
}

function tasPriorityOf(tas: any): TasPriorityCoverage {
  const t = tas?.tasApi?.timings?.priorityCases ?? tas?.tasApi?.priorityCases ?? tas?.tasApi?.priority ?? null;
  if (t && typeof t === 'object') {
    const s = String(t.status ?? t.coverage ?? '').toUpperCase();
    if (s === 'COMPLETE' || s === 'PARTIAL') return s;
    if (t.complete === true) return 'COMPLETE';
    if (t.complete === false) return 'PARTIAL';
  }
  // Everything processed implies the newest two were; an incomplete ledger
  // says nothing about WHICH cases were cut, so it stays unknown.
  const ledger = tas?.tasApi?.ledger;
  if (ledger && typeof ledger === 'object' && ledger.incomplete === false) return 'COMPLETE';
  return null;
}

const isPrimaryTask = (t: PerfTask) => !String(t.dedupe_key ?? t.source).includes(':');

/* ── the function ───────────────────────────────────────────────────── */

export function buildVerifyPerformance(
  job: PerfJob | null | undefined,
  tasks: PerfTask[] | null | undefined,
  resultJson: any,
  synthesisMeta: SynthesisTiming | null | undefined,
  extras: PerfExtras = {},
): VerifyPerformance {
  const j = job ?? {};
  const r = resultJson && typeof resultJson === 'object' ? resultJson : {};
  const st: Record<string, any> = r._stageTimes && typeof r._stageTimes === 'object' ? r._stageTimes : {};
  const timing: SynthesisTiming = synthesisMeta && typeof synthesisMeta === 'object' ? synthesisMeta : {};
  const rows = Array.isArray(tasks) ? tasks.filter((t) => t && typeof t.source === 'string') : [];

  const startedAt = j.created_at ?? null;
  const researchCompletedAt = j.completed_at ?? null;
  const status = String(j.status ?? '').toUpperCase();
  const ready = String(j.synthesis_state ?? '').toUpperCase() === 'READY' && !!j.synthesis_at;
  const readyAt = ready ? j.synthesis_at! : null;

  const stages: PerfStage[] = [];
  const results: any[] = Array.isArray(r.browserOfficial?.results) ? r.browserOfficial.results : [];
  const tasResult = results.find((x) => x?.source === 'tas') ?? null;

  /* CAPTCHA, by task id and by source. */
  const captchaByTask = new Map<string, number>();
  const captchaBySource = new Map<string, number>();
  for (const c of extras.captcha ?? []) {
    const v = num(c?.solve_ms);
    if (v === null) continue;
    if (c.task_id) captchaByTask.set(c.task_id, (captchaByTask.get(c.task_id) ?? 0) + v);
    if (c.source) captchaBySource.set(c.source, (captchaBySource.get(c.source) ?? 0) + v);
  }
  // Legacy (in-worker) runs: the per-source attempt log.
  if (!rows.length) {
    for (const x of results) {
      for (const c of Array.isArray(x?.captchaResolution) ? x.captchaResolution : []) {
        const v = num(c?.latencyMs);
        if (v !== null && x?.source) captchaBySource.set(x.source, (captchaBySource.get(x.source) ?? 0) + v);
      }
    }
  }

  /* ── top-level pipeline ── */
  const pipeline: PerfStage[] = [];
  const modelStage = (key: string, label: string) => {
    const s = st[key];
    if (s && (s.startedAt || s.finishedAt)) pipeline.push(stage({ key, label, kind: 'pipeline', startedAt: s.startedAt ?? null, endedAt: s.finishedAt ?? null, status: 'DONE' }));
  };
  modelStage(MODEL_STAGES[0][0], MODEL_STAGES[0][1]);

  // Official sources. Stamped by research-agent when the stage ended; for
  // older jobs, derived from the primary task rows.
  const primaries = rows.filter(isPrimaryTask);
  const ob = st.official_browser;
  let officialStart: string | null = ob?.startedAt ?? null;
  let officialEnd: string | null = ob?.finishedAt ?? null;
  if ((!officialStart || !officialEnd) && primaries.length) {
    const c = primaries.map((t) => ms(t.created_at)).filter((x): x is number => x !== null);
    const f = primaries.map((t) => ms(t.finished_at)).filter((x): x is number => x !== null);
    officialStart = officialStart ?? (c.length ? iso(Math.min(...c)) : null);
    officialEnd = officialEnd ?? (f.length ? iso(Math.max(...f)) : null);
  }
  if (!officialEnd && r.browserOfficial?.completedAt) officialEnd = r.browserOfficial.completedAt;
  if (officialStart || officialEnd) {
    pipeline.push(stage({ key: 'official_browser', label: 'Official sources', kind: 'pipeline', startedAt: officialStart, endedAt: officialEnd, status: ob?.outcome ?? (officialEnd ? 'DONE' : 'RUNNING') }));
  }
  for (const [key, label] of MODEL_STAGES.slice(1)) modelStage(key, label);

  // Registry follow-ups that ran after the official stage (financial entity lookups).
  const officialEndMs = ms(officialEnd);
  const followUps = rows.filter((t) => !isPrimaryTask(t) && officialEndMs !== null && (ms(t.created_at) ?? 0) > officialEndMs);
  if (followUps.length) {
    const c = followUps.map((t) => ms(t.created_at)).filter((x): x is number => x !== null);
    const f = followUps.map((t) => ms(t.finished_at)).filter((x): x is number => x !== null);
    pipeline.push(stage({ key: 'registry_followups', label: 'Registry follow-ups', kind: 'pipeline', startedAt: c.length ? iso(Math.min(...c)) : null, endedAt: f.length ? iso(Math.max(...f)) : null, status: f.length === followUps.length ? 'DONE' : 'RUNNING' }));
  }

  // Developer advertising (last research worker): its own claim/start/finish stamps.
  const ads = r._developerAds;
  if (ads && typeof ads === 'object' && (ads.claimedAt || ads.startedAt) && ads.finishedAt) {
    pipeline.push(stage({ key: 'developer_ads', label: 'Developer advertising', kind: 'pipeline', startedAt: ads.claimedAt ?? ads.startedAt, endedAt: ads.finishedAt, status: ads.state ?? null }));
  }

  // Normalization / evidence packaging: research write-up end → COMPLETE row.
  if (st.synthesis?.finishedAt && researchCompletedAt) {
    pipeline.push(stage({ key: 'finalize', label: 'Normalize & package evidence', kind: 'pipeline', startedAt: st.synthesis.finishedAt, endedAt: researchCompletedAt, status: 'DONE' }));
  }

  // The report (verify-synthesis).
  if (researchCompletedAt && timing.startedAt) {
    pipeline.push(stage({ key: 'report_wait', label: 'Report trigger wait', kind: 'synthesis', startedAt: researchCompletedAt, endedAt: timing.startedAt, status: timing.trigger ?? null }));
  }
  if (timing.startedAt) {
    pipeline.push(stage({ key: 'report_build', label: 'Report build (AI synthesis)', kind: 'synthesis', startedAt: timing.startedAt, endedAt: timing.persistAt ?? null, status: timing.persistAt ? 'DONE' : 'RUNNING' }));
  }
  if (timing.persistAt && readyAt) {
    pipeline.push(stage({ key: 'report_persist', label: 'Report persist', kind: 'synthesis', startedAt: timing.persistAt, endedAt: readyAt, status: 'READY' }));
  } else if (!timing.startedAt && researchCompletedAt && readyAt) {
    // A report written before _timing existed: one opaque span.
    pipeline.push(stage({ key: 'report', label: 'Report (trigger + build + persist)', kind: 'synthesis', startedAt: researchCompletedAt, endedAt: readyAt, status: 'READY' }));
  }

  pipeline.sort((a, b) => (ms(a.startedAt) ?? Number.MAX_SAFE_INTEGER) - (ms(b.startedAt) ?? Number.MAX_SAFE_INTEGER));

  // Hand-off gaps: time between one stage ending and the next starting.
  let handoff = 0;
  let cursor = ms(startedAt);
  for (const s of pipeline) {
    const a = ms(s.startedAt);
    if (cursor !== null && a !== null) {
      const gap = Math.max(0, a - cursor);
      s.gapBeforeMs = gap;
      handoff += gap;
    }
    const e = ms(s.endedAt);
    if (e !== null) cursor = cursor === null ? e : Math.max(cursor, e);
  }
  stages.push(...pipeline);

  /* ── official tasks (QUEUE mode) ── */
  const taskStages: PerfStage[] = [];
  const execIntervals: Array<[number, number]> = [];
  let retryCount = 0;
  let retryMs = 0;
  for (const t of rows) {
    const key = `task:${t.dedupe_key ?? t.source}`;
    const parent = isPrimaryTask(t) ? 'official_browser' : followUps.includes(t) ? 'registry_followups' : 'official_browser';
    const reusedCache = t.reused === 'CACHE';
    const exec: ExecStamp | null = reusedCache ? null : (t.exec ?? t.result?._exec ?? null);
    const firstClaim = ms(t.started_at);
    const execStart = ms(exec?.startedAt) ?? firstClaim;
    const end = ms(t.finished_at);
    const attempts = num(t.attempts);
    const retry = attempts !== null && attempts > 1 && execStart !== null && firstClaim !== null ? Math.max(0, execStart - firstClaim) : attempts !== null && attempts > 1 ? null : 0;
    if (attempts !== null && attempts > 1) retryCount += attempts - 1;
    if (retry) retryMs += retry;
    if (!reusedCache && execStart !== null && end !== null && t.reused !== 'SHARED') execIntervals.push([execStart, end]);
    const captcha = (t.id ? captchaByTask.get(t.id) : undefined) ?? null;
    const label = SOURCE_LABEL[t.source] ?? t.source;
    taskStages.push(stage({
      key, label: isPrimaryTask(t) ? label : `${label} · ${String(t.dedupe_key ?? '').split(':').slice(1).join(':')}`,
      kind: 'task', parent,
      startedAt: t.started_at ?? null, endedAt: t.finished_at ?? null,
      execMs: num(exec?.ms) ?? (execStart !== null && end !== null && end >= execStart ? end - execStart : null),
      queueMs: span(t.created_at, t.started_at),
      attempts, retryMs: retry, captchaMs: captcha,
      status: t.reused ? `${t.state ?? ''}${t.state ? '·' : ''}${t.reused}` : t.state ?? null,
    }));
  }
  stages.push(...taskStages);

  /* ── legacy (in-worker) sources: what the result carries ── */
  if (!rows.length && officialStart) {
    const runStartedAt: string | null = ob?.runStartedAt ?? null;
    const tasMs = num(r._tasExecution?.durationMs);
    if (tasMs !== null) stages.push(stage({ key: 'task:tas', label: SOURCE_LABEL.tas, kind: 'task', parent: 'official_browser', ms: tasMs, execMs: tasMs, captchaMs: captchaBySource.get('tas') ?? null, status: tasResult?.status ?? null }));
    for (const x of results) {
      if (!x?.source || x.source === 'tas') continue;
      const c = captchaBySource.get(x.source);
      if (c) stages.push(stage({ key: `task:${x.source}`, label: SOURCE_LABEL[x.source] ?? x.source, kind: 'task', parent: 'official_browser', captchaMs: c, status: x.status ?? null }));
    }
    const runStart = ms(runStartedAt);
    const end = ms(officialEnd);
    if (runStart !== null && end !== null && end >= runStart) execIntervals.push([runStart, end]);
  }

  /* ── TAS sub-steps (tasApi.timings, when the worker reports them) ── */
  const tasParent = taskStages.find((s) => s.key === 'task:tas' || s.key === 'task:tas_legacy')?.key
    ?? stages.find((s) => s.key === 'task:tas')?.key ?? 'official_browser';
  const timings = tasResult?.tasApi?.timings;
  if (timings && typeof timings === 'object') {
    const keys = [...TAS_TIMING_ORDER.filter((k) => k in timings), ...Object.keys(timings).filter((k) => !(TAS_TIMING_ORDER as readonly string[]).includes(k)).sort()];
    for (const k of keys) {
      const s = tasTiming(k, (timings as any)[k], tasParent);
      if (s) stages.push(s);
    }
  }

  /* Parallel lanes that never sit on the critical path, shown for context. */
  const ml = r._marketplaceLedger;
  if (ml && typeof ml === 'object' && num(ml.durationMs) !== null) {
    stages.push(stage({ key: 'marketplace', label: 'Marketplace comparables (parallel)', kind: 'parallel', parent: 'official_browser', ms: num(ml.durationMs), status: ml.state ?? null }));
  }

  /* ── critical path and bottleneck ── */
  const children = (key: string) => stages.filter((s) => s.parent === key);
  /** The child that decided when its parent could end: the last to finish (or the longest). */
  const criticalChild = (key: string): PerfStage | null => {
    const kids = children(key).filter((s) => s.kind !== 'parallel');
    if (!kids.length) return null;
    const withEnd = kids.filter((s) => ms(s.endedAt) !== null);
    if (withEnd.length) return withEnd.reduce((a, b) => ((ms(b.endedAt) ?? 0) > (ms(a.endedAt) ?? 0) ? b : a));
    const withMs = kids.filter((s) => s.ms !== null);
    return withMs.length ? withMs.reduce((a, b) => ((b.ms ?? 0) > (a.ms ?? 0) ? b : a)) : null;
  };
  const criticalPath: string[] = [];
  for (const s of pipeline) {
    if (!s.ms) continue;
    criticalPath.push(s.key);
    let c = criticalChild(s.key);
    while (c) {
      criticalPath.push(c.key);
      c = criticalChild(c.key);
    }
  }
  let bottleneck: string | null = null;
  const top = pipeline.filter((s) => s.ms !== null).reduce<PerfStage | null>((a, b) => (!a || (b.ms ?? 0) > (a.ms ?? 0) ? b : a), null);
  if (top) {
    bottleneck = top.key;
    // Descend to the most specific stage that explains the time.
    let c = criticalChild(top.key);
    while (c) {
      bottleneck = c.key;
      const kids = children(c.key).filter((s) => s.ms !== null);
      c = kids.length ? kids.reduce((a, b) => ((b.ms ?? 0) > (a.ms ?? 0) ? b : a)) : null;
    }
    // A hand-off gap larger than any stage is the real bottleneck.
    const worstGap = pipeline.reduce<PerfStage | null>((a, b) => (!a || (b.gapBeforeMs ?? 0) > (a.gapBeforeMs ?? 0) ? b : a), null);
    if (worstGap && (worstGap.gapBeforeMs ?? 0) > (top.ms ?? 0)) bottleneck = `gap:${worstGap.key}`;
  }

  /* ── coverage ── */
  const sources: VerifyPerformance['coverage']['sources'] = {};
  if (rows.length) {
    for (const s of taskStages) sources[s.key.slice(5)] = { state: s.status, ms: s.ms, attempts: s.attempts };
  } else {
    for (const x of results) if (x?.source) sources[x.source] = { state: x.status ?? null, ms: x.source === 'tas' ? num(r._tasExecution?.durationMs) : null, attempts: null };
  }

  /* ── headline numbers ── */
  const firstCreated = rows.map((t) => ms(t.created_at)).filter((x): x is number => x !== null);
  const firstStarted = rows.map((t) => ms(t.started_at)).filter((x): x is number => x !== null);
  let queueWaitMs: number | null = null;
  let firstWorkerActivityAt: string | null = null;
  if (firstStarted.length) {
    firstWorkerActivityAt = iso(Math.min(...firstStarted));
    queueWaitMs = firstCreated.length ? Math.max(0, Math.min(...firstStarted) - Math.min(...firstCreated)) : null;
  } else if (ob?.runStartedAt) {
    firstWorkerActivityAt = ob.runStartedAt;
    queueWaitMs = span(officialStart, ob.runStartedAt);
  }

  const totalMs = span(startedAt, readyAt);
  const nowMs = ms(extras.now);
  const terminalEnded = status === 'FAILED' || status === 'CANCELLED' || status === 'PAUSED';
  const state: VerifyPerformance['state'] = readyAt ? 'READY' : status === 'COMPLETE' ? 'RESEARCH_COMPLETE' : terminalEnded ? 'ENDED' : 'RUNNING';

  return {
    jobId: j.id ?? null,
    state,
    startedAt,
    researchCompletedAt,
    readyAt,
    totalMs,
    researchMs: span(startedAt, researchCompletedAt),
    synthesisMs: span(researchCompletedAt, readyAt),
    synthesisWaitMs: span(researchCompletedAt, timing.startedAt),
    synthesisBuildMs: span(timing.startedAt, timing.persistAt),
    modelMs: num(timing.modelMs) ?? span(timing.modelStartedAt, timing.modelEndedAt),
    queueWaitMs,
    firstWorkerActivityAt,
    workerMs: execIntervals.length ? unionMs(execIntervals) : null,
    handoffMs: pipeline.length ? handoff : null,
    elapsedMs: readyAt ? totalMs : nowMs !== null ? span(startedAt, iso(nowMs)) : null,
    retries: { count: retryCount, ms: retryMs },
    stages,
    criticalPath,
    bottleneck,
    coverage: { tasPriority: tasResult ? tasPriorityOf(tasResult) : null, sources },
    rebuilt: timing.forced === true,
  };
}

/**
 * The compact task timeline research-agent keeps in result_json._stageTimes
 * so a finished job carries its own timeline even if task rows are pruned.
 */
export function taskTimeline(rows: Array<PerfTask & { exec?: ExecStamp | null }>): PerfTask[] {
  return (Array.isArray(rows) ? rows : []).map((t) => ({
    id: t.id ?? null,
    source: t.source,
    dedupe_key: t.dedupe_key ?? null,
    state: t.state ?? null,
    attempts: t.attempts ?? null,
    reused: t.reused ?? null,
    created_at: t.created_at ?? null,
    started_at: t.started_at ?? null,
    finished_at: t.finished_at ?? null,
    exec: t.exec ?? t.result?._exec ?? null,
  }));
}
