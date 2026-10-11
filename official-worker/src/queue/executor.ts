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
import type { EvidenceRef, QueueTask } from './gateway.js';
import type { Executor, TaskOutcome } from './QueueRunner.js';

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
  launchBrowser: (id: string) => Promise<JobBrowser>;
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
 * transient failure (network / 5xx / timeout) gets ONE more go; a rejected or
 * unreadable answer, a record and a no-record never repeat.
 */
async function settleRs(task: QueueTask, out: { result: any; keep: boolean }, upload: (sha: string, ct: any, body: any) => Promise<string>): Promise<TaskOutcome> {
  const r = out.result ?? {};
  const rec = r.rsVerification && typeof r.rsVerification === 'object' ? r.rsVerification : null;
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
  console.log(JSON.stringify({ scope: 'rstax_captcha', event: 'task_outcome', task: task.id.slice(0, 8), attempt: Number(task.attempts ?? 1), status, serverOutcome: rec?.serverOutcome ?? null, httpStatus: rec?.httpStatus ?? null, rowCount: rec?.rowCount ?? null, columns: rec?.columns ?? [], evidence: evidence ? evidence.slice(0, 12) : null }));
  const firstAttempt = Number(task.attempts ?? 1) < 2;
  if (status === 'VERIFIED') {
    const c = await compactResult(r, upload);
    return { type: 'complete', result: c.result, evidenceRefs: [...c.evidenceRefs, ...refs], contentHash: c.contentHash, cacheScope: task.scopeKey };
  }
  if (status === 'PENDING_VERIFICATION') {
    const log = Array.isArray(r.captchaResolution) ? r.captchaResolution[r.captchaResolution.length - 1] : null;
    const why = String(log?.outcome ?? 'NONE');
    if (TRANSIENT_CAPTCHA.has(why) && firstAttempt) return { type: 'fail', error: `CAPTCHA_${why} ${tag}`, retryable: true, retryAfterSeconds: 20 };
    return { type: 'fail', error: `HUMAN_VERIFICATION_REQUIRED:${why} ${tag}`, retryable: false };
  }
  if (status === 'TEMPORARILY_UNAVAILABLE') {
    return firstAttempt
      ? { type: 'fail', error: `RS_TEMPORARILY_UNAVAILABLE ${tag}`, retryable: true, retryAfterSeconds: 30 }
      : { type: 'fail', error: `RS_TEMPORARILY_UNAVAILABLE ${tag}`, retryable: false };
  }
  return { type: 'fail', error: `RS_VERIFICATION_FAILED ${tag}`, retryable: false };
}

/** Map a finished source result to a task outcome; store complete evidence. */
async function settle(task: QueueTask, out: { result: any; keep: boolean }, upload: (sha: string, ct: any, body: any) => Promise<string>, cacheScope: string | null, extraRefs: EvidenceRef[] = []): Promise<TaskOutcome> {
  const r = out.result ?? {};
  if (out.keep || r.status === 'WAITING_HUMAN' || r.status === 'CAPTCHA_REQUIRED') {
    // Why the CAPTCHA gave up travels with the task (matched by prefix downstream).
    const log = Array.isArray(r.captchaResolution) ? r.captchaResolution[r.captchaResolution.length - 1] : null;
    const why = String(log?.outcome ?? 'NONE');
    // A transient give-up (the site did not refresh, the solver timed out)
    // earns ONE more go on a fresh page with a fresh solve budget — the queue
    // closes the page, so no human can finish it here anyway (live run
    // 2026-10-10: RS.ge NO_CHANGE twice → the company's tax status was lost).
    if (TRANSIENT_CAPTCHA.has(why) && Number(task.attempts ?? 1) < 2) {
      return { type: 'fail', error: `CAPTCHA_${why}`, retryable: true, retryAfterSeconds: 20 };
    }
    return { type: 'fail', error: `HUMAN_VERIFICATION_REQUIRED:${why}`, retryable: false };
  }
  if (r.status === 'FAILED') {
    return { type: 'fail', error: String(r.error ?? 'SOURCE_FAILED').slice(0, 500), retryable: true };
  }
  const c = await compactResult(r, upload);
  return { type: 'complete', result: c.result, evidenceRefs: [...c.evidenceRefs, ...extraRefs], contentHash: c.contentHash, cacheScope };
}

export function createVerifyExecutor(deps: ExecutorDeps): Executor {
  const tas = deps.tas ?? { probe: probeTasResolvedCode, acquire: acquireTasApi };
  const mygov = deps.mygov ?? runMyGovApiStep;

  return async (task, ctx) => {
    const upload = (sha: string, ct: any, body: any) => ctx.gateway.upload(sha, ct, body);
    const policy = parseCaptchaPolicy(task.input.captchaPolicy ?? null);
    const cadastral = String(task.input.cadastral ?? task.input.query ?? '');

    // Durable CAPTCHA accounting for this task.
    const stopAccounting = captchaService.onRecord((e) => {
      if (e.jobId !== task.id) return;
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
        const storedIds = new Set<string>();
        for (const v of [...(result.tasApi?.visuals ?? []), ...(result.tasApi?.priorityVisuals ?? [])]) {
          const id = String(v.id);
          if (storedIds.has(id)) {
            v.stored = true;
            continue;
          }
          const img = getCachedVisual(id);
          if (!img) continue;
          await upload(id, img.mime === 'image/png' ? 'image/png' : 'image/jpeg', img.bytes)
            .then(() => { v.stored = true; storedIds.add(id); })
            .catch((e) => console.error(JSON.stringify({ level: 'warn', scope: 'verify_queue', event: 'visual_upload_failed', task: task.id, sha: id.slice(0, 12), error: String((e as Error)?.message ?? e).slice(0, 160) })));
        }
        // Sanitized raw detail / form replies: content-addressed evidence, never inline.
        const extraRefs: EvidenceRef[] = [];
        for (const ev of tasEvidenceObjects(raw)) {
          await upload(ev.sha256, 'application/json', ev.json)
            .then((path) => { extraRefs.push({ sha256: ev.sha256, path, chars: ev.json.length, contentType: 'application/json', documentId: `tas_${ev.documentId}`, title: `TAS ${ev.kind} reply ${ev.documentId}` }); })
            .catch((e) => console.error(JSON.stringify({ level: 'warn', scope: 'verify_queue', event: 'tas_raw_upload_failed', task: task.id, kind: ev.kind, error: String((e as Error)?.message ?? e).slice(0, 160) })));
        }
        return settle(task, { result, keep: false }, upload, scope, extraRefs);
      }

      if (task.source === 'mygov') {
        const entities = new EntityQueue();
        const out = await mygov(cadastral, entities, { captcha: { service: captchaService, policy, jobId: task.id } });
        if (out?.result && typeof out.result === 'object') (out.result as any).queueEntities = entities.all();
        return settle(task, out, upload, task.scopeKey);
      }

      const step = BROWSER_STEPS[task.source];
      if (!step) return { type: 'fail', error: `UNKNOWN_SOURCE ${task.source}`, retryable: false };
      const browser = await deps.launchBrowser(task.id);
      try {
        const out = await deps.orchestrator.executeSource(browser, {
          id: task.id, query: task.input.query ?? cadastral, mode: task.input.mode === 'property' ? 'property' : 'cadastral',
          step: step(task), tasConfig: { active: 'LEGACY', fallback: null }, captchaPolicy: policy,
        });
        if (task.source === 'rstax') return settleRs(task, out, upload);
        return settle(task, out, upload, task.scopeKey);
      } finally {
        await deps.closeBrowser(browser, 'queue_task_done').catch(() => {});
      }
    } finally {
      stopAccounting();
    }
  };
}
