// executor.ts — runs one durable Verify task with the existing source code.
//
// The source implementations are unchanged; this only decides HOW a task
// runs: which lane resource it needs, how its evidence is stored, and how a
// shared (single-flight) scope is resolved.
//
//   tas        HTTP. Probes which cadastral code TAS answers for (one request).
//              A flat without case files of its own resolves to its parcel and
//              DELEGATES to the parcel scope: one read per building, shared by
//              every flat. Complete case text is stored as evidence.
//   tas_legacy BROWSER. The legacy TAS browser workflow.
//   TAS_MAP    BROWSER.
//   mygov      HTTP (Service 176 API + reCAPTCHA via 2Captcha, no Chromium).
//   enreg / debtor / rstax   BROWSER, per company.
//
// A source that needs a human (a CAPTCHA no provider can solve) is reported
// as HUMAN_VERIFICATION_REQUIRED, not retried: the report says that source was
// not verified, exactly like today's unattended skip.

import type { JobBrowser } from '../browser/LocalBrowserRuntime.js';
import { captchaService, parseCaptchaPolicy } from '../captcha/captchaService.js';
import type { CaptchaPolicy } from '../captcha/captchaService.js';
import type { StepDescriptor } from '../orchestrator/ResearchContext.js';
import { acquireTasApi, getCachedVisual, probeTasResolvedCode, tasEvidenceObjects, toLegacyTasResult } from '../workflows/tas/api/TasApiWorkflow.js';
import { tasApiOptionsFromEnv } from '../workflows/tas/api/TasApiStep.js';
import { runMyGovApiStep } from '../workflows/mygov/MyGovApiWorkflow.js';
import { EntityQueue } from '../entities/EntityQueue.js';
import { compactResult, sha256 } from './evidence.js';
import { EVIDENCE_UPLOAD_CONCURRENCY, mapSettled } from './concurrency.js';
import { classifySourceOutcome, lastCaptchaOutcome, SUCCESS_OUTCOMES, type SourceVerdict } from './sourceOutcome.js';
import { rsDomOnlyNoResult } from '../workflows/financial/RsTaxpayerResponse.js';
import type { EvidenceRef, QueueTask } from './gateway.js';
import type { Executor, TaskOutcome } from './QueueRunner.js';
import { withTraffic } from '../net/proxyGateway.js';
import type { BrowserNetOptions } from '../browser/LocalBrowserRuntime.js';

/** The orchestrator surface the executor needs (structural, so this module
 *  does not pull the browser-bound orchestrator into unit-test builds). */
export interface SourceRunner {
  executeSource(
    jobBrowser: JobBrowser | null,
    task: { id: string; query: string; mode: 'cadastral' | 'property'; step: StepDescriptor; tasConfig?: any; captchaPolicy?: CaptchaPolicy },
  ): Promise<{ result: any; keep: boolean }>;
}

export interface ExecutorDeps {
  orchestrator: SourceRunner;
  launchBrowser: (id: string, net?: BrowserNetOptions) => Promise<JobBrowser>;
  /** The source's network options for a browser task (proxy/metering); absent = direct, unmetered (as before). */
  browserNet?: (task: QueueTask) => BrowserNetOptions | undefined;
  closeBrowser: (b: JobBrowser, reason: string) => Promise<void>;
  /** Test seams. */
  tas?: { probe: typeof probeTasResolvedCode; acquire: typeof acquireTasApi };
  mygov?: typeof runMyGovApiStep;
}

const BROWSER_STEPS: Record<string, (t: QueueTask) => StepDescriptor> = {
  TAS_MAP: () => ({ type: 'source', key: 'TAS_MAP' }),
  tas_legacy: () => ({ type: 'source', key: 'tas' }),
  enreg: (t) => ({ type: 'entity', source: 'enreg', idCode: t.input.idCode ?? null, name: String(t.input.name ?? t.input.idCode ?? '') }),
  debtor: (t) => ({ type: 'entity', source: 'debtor', idCode: t.input.idCode ?? null, name: String(t.input.name ?? t.input.idCode ?? '') }),
  rstax: (t) => ({ type: 'entity', source: 'rstax', idCode: t.input.idCode ?? null, name: String(t.input.name ?? t.input.idCode ?? '') }),
};

/** Companies named in a source's complete document text (same scanner the
 *  in-job EntityQueue uses), for the job's registry follow-ups. */
function scanEntities(source: string, docs: any[] | undefined) {
  const q = new EntityQueue();
  for (const d of docs ?? []) {
    const text = typeof d?.fullText === 'string' && d.fullText ? d.fullText : d?.rawText;
    if (text) q.scanText(text, { source, sourceDocument: d.url, retrievedAt: new Date().toISOString() });
  }
  return q.all();
}

const TRANSIENT_CAPTCHA = new Set(['NO_CHANGE', 'TIMEOUT', 'UNSOLVABLE', 'PROVIDER_ERROR', 'BUDGET_EXHAUSTED']);

/** CAPTCHA solves earlier attempts of this task spent (their error carries `solves=N`). */
export function priorSolves(task: Pick<QueueTask, 'attempts' | 'error'>): number {
  if (Number(task.attempts ?? 1) < 2) return 0;
  const n = Number(/\bsolves=(\d+)\b/.exec(String(task.error ?? ''))?.[1] ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** What a failed task's error says about its outcome (read by src/verify/queueOfficial.ts). */
function outcomeTag(v: SourceVerdict, solves: number): string {
  return ` sourceOutcome=${v.outcome}${v.reason ? ` reason=${v.reason}` : ''}${solves > 0 ? ` solves=${solves}` : ''}`;
}

/** The task's precise outcome travels in the completed result, next to its status. */
function stampOutcome(r: any, v: SourceVerdict): void {
  if (r && typeof r === 'object') {
    r.sourceOutcome = v.outcome;
    r.outcomeReason = v.reason;
  }
}

/** What the settle functions need to know about the task's CAPTCHA budget. */
interface SpendCtx {
  /** Solves this task has spent so far, earlier attempts included. */
  solves: number;
  /** The task's whole budget (policy.maxSolvesPerJob). */
  maxSolves: number;
}

/** The four RS.ge states, from the worker's record or (older shapes) its status. */
function rsStatusOf(r: any): 'VERIFIED' | 'PENDING_VERIFICATION' | 'TEMPORARILY_UNAVAILABLE' | 'VERIFICATION_FAILED' {
  const s = String(r?.rsVerification?.status ?? '');
  if (s === 'VERIFIED' || s === 'PENDING_VERIFICATION' || s === 'TEMPORARILY_UNAVAILABLE' || s === 'VERIFICATION_FAILED') return s;
  if (r?.status === 'SEARCH_CONFIRMED' || r?.status === 'NO_RESULT_CONFIRMED') return 'VERIFIED';
  if (r?.status === 'WAITING_HUMAN' || r?.status === 'CAPTCHA_REQUIRED') return 'PENDING_VERIFICATION';
  if (r?.status === 'FAILED' || r?.status === 'TEMPORARILY_UNAVAILABLE') return 'TEMPORARILY_UNAVAILABLE';
  return 'VERIFICATION_FAILED';
}

/**
 * RS.ge (rstax). Every outcome — success or failure — stores RS.ge's own
 * answer (redacted: TIN masked, ≤ 20 KB, with HTTP status and outcome) as
 * content-addressed evidence; the result keeps a reference, never the raw
 * text. Only a VERIFIED check (a parsed record or a confirmed no-record)
 * completes the task, so a failure is never cached for other jobs. A
 * transient failure (network / 5xx / timeout) gets ONE more go; so does an
 * UNPARSEABLE 200 answer (production 2026-10-22: the search was submitted and
 * answered, but not with a grid), continuing the task's CAPTCHA budget,
 * never beyond it. A refusal, a record and a no-record never repeat.
 */
async function settleRs(task: QueueTask, out: { result: any; keep: boolean }, upload: (sha: string, ct: any, body: any) => Promise<string>, spend: SpendCtx): Promise<TaskOutcome> {
  const r = out.result ?? {};
  let rec = r.rsVerification && typeof r.rsVerification === 'object' ? r.rsVerification : null;
  /*
   * A "no record" read off the PAGE while RS.ge's own answer was captured and
   * unreadable is not a confirmed absence: the grid's empty state ("Not
   * found", 0 rows) is also what an unreadable answer leaves on screen.
   * Production 2026-10-22, company 405456359 (a registered LLC): reason
   * PAGE_READ_UNPARSEABLE, stored as VERIFIED / NO_RESULT. Never again.
   */
  if (rec && rsDomOnlyNoResult(rec)) {
    rec = { ...rec, status: 'VERIFICATION_FAILED', serverOutcome: 'UNPARSEABLE' };
    r.rsVerification = rec;
    r.status = 'VERIFICATION_FAILED';
    r.noResultConfirmed = false;
  }
  const refs: EvidenceRef[] = [];
  let evidence: string | null = null;
  if (rec) {
    const doc = JSON.stringify({ source: 'rstax', taskId: task.id, ...rec });
    const hash = sha256(doc);
    try {
      const path = await upload(hash, 'application/json', doc);
      refs.push({ sha256: hash, path, chars: doc.length, contentType: 'application/json', documentId: `rstax_answer_${hash.slice(0, 12)}`, title: 'RS.ge search answer (redacted)' });
      evidence = hash;
      const { rawResponse: _raw, ...rest } = rec;
      r.rsVerification = { ...rest, rawResponseRef: { sha256: hash, path, chars: doc.length } };
    } catch (e) {
      // Storage down: keep the (already redacted, bounded) answer inline rather than lose it.
      console.error(JSON.stringify({ level: 'warn', scope: 'verify_queue', event: 'rstax_answer_upload_failed', task: task.id, error: String((e as Error)?.message ?? e).slice(0, 160) }));
    }
  }
  const status = rsStatusOf(r);
  const tag = `rs=${status} outcome=${rec?.serverOutcome ?? 'NONE'} http=${rec?.httpStatus ?? '-'}${evidence ? ` evidence=${evidence}` : ''}`;
  console.log(JSON.stringify({ scope: 'rstax_captcha', event: 'task_outcome', task: task.id.slice(0, 8), attempt: Number(task.attempts ?? 1), status, serverOutcome: rec?.serverOutcome ?? null, httpStatus: rec?.httpStatus ?? null, rowCount: rec?.rowCount ?? null, columns: rec?.columns ?? [], evidence: evidence ? evidence.slice(0, 12) : null, solves: spend.solves }));
  const firstAttempt = Number(task.attempts ?? 1) < 2;
  const budgetLeft = spend.solves < spend.maxSolves;
  if (status === 'VERIFIED') {
    const found = rec ? rec.serverOutcome === 'ACCEPTED' : r.status === 'SEARCH_CONFIRMED';
    stampOutcome(r, { outcome: found ? 'RETRIEVED' : 'NO_RECORD_CONFIRMED', reason: null });
    const c = await compactResult(r, upload);
    return { type: 'complete', result: c.result, evidenceRefs: [...c.evidenceRefs, ...refs], contentHash: c.contentHash, cacheScope: task.scopeKey };
  }
  if (status === 'PENDING_VERIFICATION') {
    const why = lastCaptchaOutcome(r);
    const t = outcomeTag({ outcome: 'CAPTCHA_BLOCKED', reason: `CAPTCHA_${why}` }, spend.solves);
    if (TRANSIENT_CAPTCHA.has(why) && firstAttempt && budgetLeft) return { type: 'fail', error: `CAPTCHA_${why} ${tag}${t}`, retryable: true, retryAfterSeconds: 20 };
    return { type: 'fail', error: `HUMAN_VERIFICATION_REQUIRED:${why} ${tag}${t}`, retryable: false };
  }
  if (status === 'TEMPORARILY_UNAVAILABLE') {
    const t = outcomeTag({ outcome: 'PROVIDER_UNAVAILABLE', reason: String(rec?.serverOutcome ?? 'NO_RESPONSE') }, spend.solves);
    return firstAttempt
      ? { type: 'fail', error: `RS_TEMPORARILY_UNAVAILABLE ${tag}${t}`, retryable: true, retryAfterSeconds: 30 }
      : { type: 'fail', error: `RS_TEMPORARILY_UNAVAILABLE ${tag}${t}`, retryable: false };
  }
  if (rec?.serverOutcome === 'REJECTED') {
    return { type: 'fail', error: `RS_VERIFICATION_FAILED ${tag}${outcomeTag({ outcome: 'CAPTCHA_BLOCKED', reason: 'CAPTCHA_REJECTED' }, spend.solves)}`, retryable: false };
  }
  const why = String(rec?.reason ?? rec?.serverOutcome ?? r.status ?? 'NONE').replace(/[^A-Za-z0-9_]+/g, '_').slice(0, 60);
  const t = outcomeTag({ outcome: 'UNPARSEABLE', reason: why }, spend.solves);
  // RS.ge answered 200, but not with a grid: ONE more go on a fresh page.
  if (rec?.serverOutcome === 'UNPARSEABLE' && firstAttempt && budgetLeft) return { type: 'fail', error: `RS_VERIFICATION_FAILED ${tag}${t}`, retryable: true, retryAfterSeconds: 20 };
  return { type: 'fail', error: `RS_VERIFICATION_FAILED ${tag}${t}`, retryable: false };
}

/**
 * Map a finished source result to a task outcome; store complete evidence.
 * Only RETRIEVED, PARTIAL (what was read is kept) and NO_RECORD_CONFIRMED
 * complete the task; anything else fails it, its outcome in the error.
 */
async function settle(task: QueueTask, out: { result: any; keep: boolean }, upload: (sha: string, ct: any, body: any) => Promise<string>, cacheScope: string | null, spend: SpendCtx, extraRefs: EvidenceRef[] = []): Promise<TaskOutcome> {
  const r = out.result ?? {};
  const v = classifySourceOutcome(r, out.keep);
  const t = outcomeTag(v, spend.solves);
  const firstAttempt = Number(task.attempts ?? 1) < 2;
  if (SUCCESS_OUTCOMES.has(v.outcome)) {
    stampOutcome(r, v);
    const c = await compactResult(r, upload);
    return { type: 'complete', result: c.result, evidenceRefs: [...c.evidenceRefs, ...extraRefs], contentHash: c.contentHash, cacheScope };
  }
  if (v.outcome === 'CAPTCHA_BLOCKED') {
    // Why the CAPTCHA gave up travels with the task (matched by prefix downstream).
    const why = lastCaptchaOutcome(r);
    // A transient give-up (the site did not refresh, the solver timed out)
    // earns ONE more go on a fresh page — the queue closes the page, so no
    // human can finish it here anyway (live run 2026-10-10: RS.ge NO_CHANGE
    // twice → the company's tax status was lost). The retry continues the
    // task's solve budget (solves=N), so it never spends beyond it.
    if (TRANSIENT_CAPTCHA.has(why) && firstAttempt && spend.solves < spend.maxSolves) {
      return { type: 'fail', error: `CAPTCHA_${why}${t}`, retryable: true, retryAfterSeconds: 20 };
    }
    return { type: 'fail', error: `HUMAN_VERIFICATION_REQUIRED:${why}${t}`, retryable: false };
  }
  if (v.outcome === 'AUTH_REQUIRED') return { type: 'fail', error: `AUTH_REQUIRED${t}`, retryable: false };
  if (v.outcome === 'UNPARSEABLE') {
    // The source answered with something unreadable: one more look, no loop.
    return firstAttempt ? { type: 'fail', error: `SOURCE_UNPARSEABLE${t}`, retryable: true, retryAfterSeconds: 20 } : { type: 'fail', error: `SOURCE_UNPARSEABLE${t}`, retryable: false };
  }
  // PROVIDER_UNAVAILABLE. A crashed source keeps its retries (max_attempts);
  // a provider deadline (MyGov's 7-minute budget) gets one more go only.
  const base = String(r.error ?? (r.status === 'TIMEOUT' ? 'SOURCE_TIMEOUT' : 'SOURCE_FAILED')).slice(0, 400);
  if (r.status === 'FAILED') return { type: 'fail', error: `${base}${t}`, retryable: true };
  return { type: 'fail', error: `${base}${t}`, retryable: firstAttempt };
}

export function createVerifyExecutor(deps: ExecutorDeps): Executor {
  const tas = deps.tas ?? { probe: probeTasResolvedCode, acquire: acquireTasApi };
  const mygov = deps.mygov ?? runMyGovApiStep;

  return async (task, ctx) => withTraffic({ jobId: task.jobId ?? null, worker: 'verify' }, () => runTask(task, ctx));
  async function runTask(task: QueueTask, ctx: Parameters<Executor>[1]): Promise<TaskOutcome> {
    const upload = (sha: string, ct: any, body: any) => ctx.gateway.upload(sha, ct, body);
    const policy = parseCaptchaPolicy(task.input.captchaPolicy ?? null);
    const cadastral = String(task.input.cadastral ?? task.input.query ?? '');

    // A retry continues the task's solve budget: what earlier attempts spent
    // (any replica) counts against maxSolvesPerJob here too.
    captchaService.carrySolves(task.id, priorSolves(task));
    let solves = captchaService.solvesFor(task.id);
    const spend = (): SpendCtx => ({ solves: Math.max(solves, captchaService.solvesFor(task.id)), maxSolves: policy.maxSolvesPerJob });

    // Durable CAPTCHA accounting for this task.
    const stopAccounting = captchaService.onRecord((e) => {
      if (e.jobId !== task.id) return;
      // Every solve is followed by a ledger entry; read the count while it is
      // live (a browser source forgets its counters when it returns).
      solves = Math.max(solves, captchaService.solvesFor(task.id));
      void ctx.gateway.captcha([{
        idempotencyKey: `${task.id}:${task.attempts}:${e.provider}:${e.at}`, taskId: task.id, jobId: task.jobId,
        source: task.source, outcome: e.outcome, costUsd: e.estCostUsd, solveMs: e.latencyMs, kind: 'recaptcha_v2', errorCode: e.code ?? null,
      }]).catch(() => {});
    });

    try {
      if (task.source === 'tas') {
        let query = cadastral;
        let scope = task.scopeKey;
        if (!task.input.resolved) {
          const probe = await tas.probe(cadastral, { ...tasApiOptionsFromEnv(), signal: ctx.signal });
          if (probe.code && probe.code !== cadastral) {
            const d = await ctx.gateway.delegate(task, `tas:${probe.code}`, { ...task.input, cadastral: probe.code, resolved: true });
            if (!d.ok) return { type: 'fail', error: `DELEGATE_${d.reason ?? 'FAILED'}`, retryable: true };
            if (d.outcome !== 'PRODUCE') return { type: 'delegated' };
            query = probe.code;
            scope = `tas:${probe.code}`;
          }
        }
        const raw = await tas.acquire(query, { ...tasApiOptionsFromEnv(), signal: ctx.signal });
        const result: any = toLegacyTasResult(raw, { includeFullText: true });
        result.tasImplementation = { implementation: 'API_FIRST', fallbackFrom: null, queue: true };
        result.queueEntities = scanEntities('tas', result.documents);
        // Visuals: stored by content hash where the report reads them, so any
        // replica can serve any job.
        // Bounded upstream (≤ VISUAL_ASSET_MAX assets, byte budget); `stored`
        // tells research-agent the object exists without a storage listing.
        // The two newest cases' visuals (a superset of their gallery assets) are stored the same way, once per hash.
        // Our own storage only, a few at a time (concurrency.ts): each unique hash once, every
        // occurrence marked when it landed; the raw replies keep their order in extraRefs.
        const writeBack0 = performance.now();
        const allVisuals = [...(result.tasApi?.visuals ?? []), ...(result.tasApi?.priorityVisuals ?? [])];
        const uniqueIds = [...new Set(allVisuals.map((v: any) => String(v.id)))].filter((id) => getCachedVisual(id));
        const visualOutcomes = await mapSettled(uniqueIds, EVIDENCE_UPLOAD_CONCURRENCY, (id) => {
          const img = getCachedVisual(id)!;
          return upload(id, img.mime === 'image/png' ? 'image/png' : 'image/jpeg', img.bytes);
        });
        const storedIds = new Set<string>();
        visualOutcomes.forEach((o, i) => {
          if (o.status === 'fulfilled') storedIds.add(uniqueIds[i]);
          else console.error(JSON.stringify({ level: 'warn', scope: 'verify_queue', event: 'visual_upload_failed', task: task.id, sha: uniqueIds[i].slice(0, 12), error: String((o.reason as Error)?.message ?? o.reason).slice(0, 160) }));
        });
        for (const v of allVisuals) if (storedIds.has(String(v.id))) v.stored = true;
        // Sanitized raw detail / form replies: content-addressed evidence, never inline.
        const evidenceObjects = tasEvidenceObjects(raw);
        const refOutcomes = await mapSettled(evidenceObjects, EVIDENCE_UPLOAD_CONCURRENCY, (ev) => upload(ev.sha256, 'application/json', ev.json));
        const extraRefs: EvidenceRef[] = [];
        refOutcomes.forEach((o, i) => {
          const ev = evidenceObjects[i];
          if (o.status === 'fulfilled') extraRefs.push({ sha256: ev.sha256, path: o.value, chars: ev.json.length, contentType: 'application/json', documentId: `tas_${ev.documentId}`, title: `TAS ${ev.kind} reply ${ev.documentId}` });
          else console.error(JSON.stringify({ level: 'warn', scope: 'verify_queue', event: 'tas_raw_upload_failed', task: task.id, kind: ev.kind, error: String((o.reason as Error)?.message ?? o.reason).slice(0, 160) }));
        });
        if (result.tasApi?.timings) result.tasApi.timings.writeBackMs = Math.round(performance.now() - writeBack0);
        return settle(task, { result, keep: false }, upload, scope, spend(), extraRefs);
      }

      if (task.source === 'mygov') {
        const entities = new EntityQueue();
        const out = await mygov(cadastral, entities, { captcha: { service: captchaService, policy, jobId: task.id } });
        if (out?.result && typeof out.result === 'object') (out.result as any).queueEntities = entities.all();
        return settle(task, out, upload, task.scopeKey, spend());
      }

      const step = BROWSER_STEPS[task.source];
      if (!step) return { type: 'fail', error: `UNKNOWN_SOURCE ${task.source}`, retryable: false };
      const browser = await deps.launchBrowser(task.id, deps.browserNet?.(task));
      try {
        const out = await deps.orchestrator.executeSource(browser, {
          id: task.id, query: task.input.query ?? cadastral, mode: task.input.mode === 'property' ? 'property' : 'cadastral',
          step: step(task), tasConfig: { active: 'LEGACY', fallback: null }, captchaPolicy: policy,
        });
        if (task.source === 'rstax') return settleRs(task, out, upload, spend());
        return settle(task, out, upload, task.scopeKey, spend());
      } finally {
        await deps.closeBrowser(browser, 'queue_task_done').catch(() => {});
      }
    } finally {
      stopAccounting();
      captchaService.forgetJob(task.id);
    }
  }
}
