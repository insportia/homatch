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
import { acquireTasApi, getCachedVisual, probeTasResolvedCode, toLegacyTasResult } from '../workflows/tas/api/TasApiWorkflow.js';
import { tasApiOptionsFromEnv } from '../workflows/tas/api/TasApiStep.js';
import { runMyGovApiStep } from '../workflows/mygov/MyGovApiWorkflow.js';
import { EntityQueue } from '../entities/EntityQueue.js';
import { compactResult } from './evidence.js';
import type { QueueTask } from './gateway.js';
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

/** Map a finished source result to a task outcome; store complete evidence. */
async function settle(task: QueueTask, out: { result: any; keep: boolean }, upload: (sha: string, ct: any, body: any) => Promise<string>, cacheScope: string | null): Promise<TaskOutcome> {
  const r = out.result ?? {};
  if (out.keep || r.status === 'WAITING_HUMAN' || r.status === 'CAPTCHA_REQUIRED') {
    return { type: 'fail', error: 'HUMAN_VERIFICATION_REQUIRED', retryable: false };
  }
  if (r.status === 'FAILED') {
    return { type: 'fail', error: String(r.error ?? 'SOURCE_FAILED').slice(0, 500), retryable: true };
  }
  const c = await compactResult(r, upload);
  return { type: 'complete', result: c.result, evidenceRefs: c.evidenceRefs, contentHash: c.contentHash, cacheScope };
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
        for (const v of result.tasApi?.visuals ?? []) {
          const img = getCachedVisual(String(v.id));
          if (img) await upload(String(v.id), img.mime === 'image/png' ? 'image/png' : 'image/jpeg', img.bytes).catch(() => {});
        }
        return settle(task, { result, keep: false }, upload, scope);
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
        return settle(task, out, upload, task.scopeKey);
      } finally {
        await deps.closeBrowser(browser, 'queue_task_done').catch(() => {});
      }
    } finally {
      stopAccounting();
    }
  };
}
