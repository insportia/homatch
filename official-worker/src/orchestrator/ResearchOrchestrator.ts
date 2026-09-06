// ResearchOrchestrator.ts — mandate Section 4's "Research Orchestrator."
// Replaces the pre-refactor index.js's run()/one()/hold()/
// tasWithCadastralFallback() with a single driver that calls the four
// explicit *Workflow.ts functions, manages the shared EvidenceLedger and
// EntityQueue for one job, and handles the WAITING_HUMAN pause/resume/skip
// lifecycle (mandate Section 10) generically across all four sources
// instead of ad hoc per-source resume logic.
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { EvidenceLedger } from '../evidence/EvidenceLedger.js';
import { EntityQueue } from '../entities/EntityQueue.js';
import { runMsMapWorkflow } from '../workflows/msmap/MsMapWorkflow.js';
import { runTasWorkflow } from '../workflows/tas/TasWorkflow.js';
import { runMyGovWorkflow } from '../workflows/mygov/MyGovWorkflow.js';
import { runEnregWorkflow } from '../workflows/enreg/EnregWorkflow.js';
import { runRsTaxpayerWorker } from '../workflows/financial/RsTaxpayerWorker.js';
import { runDebtorWorker } from '../workflows/financial/DebtorWorker.js';
import { runGenericWorkflow } from '../workflows/generic/GenericWorkflow.js';
import { buildInitialSteps, stepMatchesResult, primaryStepsRemain, buildEntitySteps, type ResearchJob, type StepDescriptor } from './ResearchContext.js';
import { challenge } from '../browser/BrowserSession.js';
import { buildHistoricalComparison } from '../documents/HistoricalComparison.js';
import { toLegacyDocument } from '../documents/DocumentTypes.js';

/** Applies the legacy wire-alias mapping (DocumentTypes.ts's
 * toLegacyDocument) to a result's `documents` array in place, right before
 * that result crosses the HTTP boundary into job.results — the one point
 * every source's result (success, WAITING_HUMAN pause, or resume) passes
 * through. Never applied inside a *Workflow.ts itself. */
function legacyDocuments(result: any): any {
  if (result && Array.isArray(result.documents)) result.documents = result.documents.map(toLegacyDocument);
  return result;
}

const now = () => new Date().toISOString();
const TTL = 15 * 60 * 1000;
// Bounds an otherwise-unbounded research graph — a document mentioning many
// unrelated companies must never turn one Verify into dozens of ENREG jobs.
const MAX_AUTO_ENREG_ENTITIES = 3;

const NAPR_META = { name: 'NAPR', class: 'OFFICIAL_REGISTRY', url: 'https://napr.gov.ge/' };
const ENREG_PROPERTY_META = { name: 'Entrepreneur Registry', class: 'OFFICIAL_REGISTRY', url: 'https://enreg.reestri.gov.ge/main.php?m=new_index' };

interface SessionState {
  browser: any;
  ctx: any;
  page: any;
  jobId: string;
  step: StepDescriptor;
  query: string;
  expires: number;
}

export class ResearchOrchestrator {
  private jobs = new Map<string, ResearchJob>();
  private sessions = new Map<string, SessionState>();
  private ledgers = new Map<string, EvidenceLedger>();
  private entityQueues = new Map<string, EntityQueue>();

  constructor() {
    setInterval(async () => {
      for (const [id, s] of this.sessions) {
        if (Date.now() > s.expires) {
          await s.ctx.close().catch(() => {});
          await s.browser.close().catch(() => {});
          this.sessions.delete(id);
        }
      }
    }, 30000).unref();
  }

  getJob(id: string): ResearchJob | undefined {
    return this.jobs.get(id);
  }

  getSession(id: string): SessionState | undefined {
    return this.sessions.get(id);
  }

  start(query: string, mode: 'cadastral' | 'property'): ResearchJob {
    const id = randomUUID();
    const job: ResearchJob = { id, query, mode, status: 'QUEUED', stage: 'QUEUED', sourceIndex: 0, results: [], createdAt: now(), updatedAt: now() };
    this.jobs.set(id, job);
    this.run(job).catch((e) => {
      job.status = 'FAILED';
      job.stage = 'FAILED';
      job.error = String(e);
    });
    return job;
  }

  /** startEntity() — the closed-loop fix for the confirmed production gap:
   * a legal entity (developer/owner company) discovered by research-agent's
   * OWN web research (OpenAI web_search during the OFFICIAL/MARKET
   * stage) never appears in ANY browser-retrieved page/document text this
   * worker scanned, so EntityQueue.scanText() never sees it and the normal
   * primary-step-completion auto-ENREG trigger (buildEntitySteps() in run())
   * never fires for it — ENREG research silently never happens for exactly
   * the entities a customer report most needs it for (mandate: "a
   * discovered company MUST automatically create a company research
   * branch"). This starts a real job whose ONLY step is a single
   * entity_enreg lookup for a name/idCode handed in directly, running
   * through the exact same deterministic EnregWorkflow FSM, CAPTCHA
   * WAITING_HUMAN pause, and resume/skip lifecycle as any other job — a
   * caller (research-agent) polls it via the ordinary GET /research/:id.
   *
   * `source` (2026-09-06, "FINANCIAL SOURCE EXPANSION" mandate, later split
   * into independent workers per the "REBUILD THE CUSTOMER REPORT + OFFICIAL
   * WORKERS AS SEPARATE DETERMINISTIC PIPELINES" mandate): generalized from
   * enreg-only to also serve 'rstax'/'debtor' — same closed-loop shape, same
   * CAPTCHA/resume/skip lifecycle, driven by runRsTaxpayerWorker/
   * runDebtorWorker (each its own independent worker, not a shared
   * source-key-parameterized function) instead of runEnregWorkflow. idCode
   * is REQUIRED (not name-fallback-able) for rstax/debtor since neither
   * exposes a name search (see RsTaxpayerWorker.ts/DebtorWorker.ts) — a
   * caller with only a name and no idCode should not call this for those
   * two sources at all. */
  startEntity(name: string, idCode: string | null, source: 'enreg' | 'rstax' | 'debtor' = 'enreg'): ResearchJob {
    const id = randomUUID();
    // Only 'enreg' falls back to searching by bare name when idCode is
    // absent (it has a real name-search field). rstax/debtor have none —
    // keep idCode genuinely null for them rather than smuggling a company
    // NAME into the step's idCode field, which RsTaxpayerWorker/
    // DebtorWorker would otherwise try to type into a TIN/ID input. A null
    // idCode there resolves to a clean, honest "no identifier" result,
    // never a guess.
    const stepIdCode = source === 'enreg' ? idCode || name : idCode;
    const step: StepDescriptor = { type: 'entity', source, idCode: stepIdCode, name };
    const job: ResearchJob = { id, query: stepIdCode || name, mode: 'cadastral', status: 'QUEUED', stage: 'QUEUED', sourceIndex: 0, results: [], steps: [step], createdAt: now(), updatedAt: now() };
    this.jobs.set(id, job);
    this.run(job).catch((e) => {
      job.status = 'FAILED';
      job.stage = 'FAILED';
      job.error = String(e);
    });
    return job;
  }

  private ledgerFor(jobId: string): EvidenceLedger {
    let l = this.ledgers.get(jobId);
    if (!l) {
      l = new EvidenceLedger();
      this.ledgers.set(jobId, l);
    }
    return l;
  }

  private entitiesFor(jobId: string): EntityQueue {
    let e = this.entityQueues.get(jobId);
    if (!e) {
      e = new EntityQueue();
      this.entityQueues.set(jobId, e);
    }
    return e;
  }

  private async runStep(browser: any, job: ResearchJob, step: StepDescriptor): Promise<{ result: any; keep: boolean; browserCtx?: any; page?: any }> {
    const ledger = this.ledgerFor(job.id);
    const entities = this.entitiesFor(job.id);
    const ctx = await browser.newContext({ locale: 'ka-GE', acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();

    const key = step.type === 'entity' ? step.source : step.key;
    const query = step.type === 'entity' ? step.idCode || step.name : job.query;
    const forEntity = step.type === 'entity' ? { name: step.name, idCode: step.idCode } : null;

    try {
      let result: any;
      if (key === 'tas') result = await runTasWorkflow(page, query, job.mode, entities);
      else if (key === 'msmap') result = await runMsMapWorkflow(page, query, ledger, entities);
      else if (key === 'mygov') result = await runMyGovWorkflow(page, ctx, query, entities);
      else if (key === 'enreg') result = await runEnregWorkflow(page, forEntity || { name: query, idCode: /^[0-9-]{6,}$/.test(String(query || '').trim()) ? query : null }, entities);
      else if (key === 'rstax') result = await runRsTaxpayerWorker(page, forEntity, entities);
      else if (key === 'debtor') result = await runDebtorWorker(page, forEntity, entities);
      else result = await runGenericWorkflow(page, key, NAPR_META, query);

      const isWaitingHuman = result?.status === 'WAITING_HUMAN';
      if (isWaitingHuman) {
        this.sessions.set(job.id, { browser, ctx, page, jobId: job.id, step, query, expires: Date.now() + TTL });
        return { result, keep: true };
      }
      await ctx.close().catch(() => {});
      return { result, keep: false };
    } catch (e) {
      await ctx.close().catch(() => {});
      return {
        result: {
          source: key,
          sourceName: key,
          sourceClass: 'OFFICIAL_GOVERNMENT',
          sourceUrl: '',
          startUrl: '',
          finalUrl: null,
          frameUrls: [],
          searchControlUsed: null,
          queryEntered: null,
          submitAction: null,
          resultContext: null,
          resultConfirmed: false,
          noResultConfirmed: false,
          resultValidated: false,
          status: 'FAILED',
          traversal: null,
          retrievedAt: now(),
          documents: [],
          discoveredEntities: [],
          forEntity,
          error: String(e),
        },
        keep: false,
      };
    }
  }

  private async run(job: ResearchJob, startIndex = 0, browser: any = null): Promise<void> {
    if (!job.steps) job.steps = buildInitialSteps(job);
    job.status = 'RUNNING';
    job.updatedAt = now();
    try {
      browser = browser || (await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--no-sandbox'] }));
      for (let i = startIndex; i < job.steps.length; i++) {
        const step = job.steps[i];
        job.sourceIndex = i;
        job.stage = step.type === 'entity' ? `CHECKING_${step.source.toUpperCase()}_ENTITY_${step.idCode}` : `CHECKING_${step.key.toUpperCase()}`;
        const { result, keep } = await this.runStep(browser, job, step);
        job.results = job.results.filter((x) => !stepMatchesResult(step, x));
        job.results.push(legacyDocuments(result));
        job.updatedAt = now();
        if (keep) {
          job.status = 'WAITING_HUMAN';
          job.stage = 'CAPTCHA_REQUIRED';
          // preserveHumanSession() shape, per the 2026-09-06 CAPTCHA/human-
          // verification UX mandate ("write it more strictly so it doesn't
          // accidentally leave a small/cropped CAPTCHA"): any CAPTCHA/
          // human-verification screen must be shown large enough for a
          // human to solve comfortably — desktop approx. 900-1100px wide,
          // max 90vh, scrollable and uncropped; mobile full-screen. The
          // SAME browser/context/page/session (this job's `sessions` Map
          // entry, keyed by `job.id`) is preserved and resumed after
          // successful human verification — see resume()/skip() below,
          // which never call newContext()/newPage()/goto(sourceUrl)/
          // restartWorker(). `sessionId` is `job.id` itself: it is exactly
          // the identifier the frontend already uses (as `jobId`) to
          // address this same paused session via /research/:id/*.
          // recommendedWidth/recommendedMaxHeight/fullInteractiveSession/
          // scrollable are UX hints for any consumer of this contract; the
          // current frontend (ResearchCaptchaModal.tsx's v30 CAPTCHA UX
          // overhaul) already independently renders within these bounds
          // (sm:w-[min(1100px,94vw)] sm:max-h-[90vh], scrollable image
          // area, uncropped <img>, full-screen on mobile).
          job.humanVerification = {
            sessionId: job.id,
            source: step.type === 'entity' ? step.source : step.key,
            step,
            url: result.finalUrl || result.sourceUrl,
            expiresAt: new Date(Date.now() + TTL).toISOString(),
            recommendedWidth: 1100,
            recommendedMaxHeight: '90vh',
            fullInteractiveSession: true,
            scrollable: true,
            message: 'წყარომ მოითხოვა ადამიანის დადასტურება. დაასრულეთ ეს შემოწმება ან გამოტოვეთ ეს წყარო — იგივე სესია ავტომატურად გაგრძელდება ან კვლევა გააგრძელებს დანარჩენ წყაროებზე.',
          };
          return;
        }
        if (!primaryStepsRemain(job.steps, i + 1) && !job._entityStepsAppended) {
          job._entityStepsAppended = true;
          const entities = this.entitiesFor(job.id);
          const candidates = entities.notYetQueued();
          const newSteps = buildEntitySteps(candidates, MAX_AUTO_ENREG_ENTITIES);
          job.steps.push(...newSteps);
          for (const s of newSteps) {
            if (s.type !== 'entity') continue;
            const match = candidates.find((e) => e.identificationCode === s.idCode);
            if (match) entities.markQueued(match.id);
          }
        }
      }
      job.status = 'COMPLETE';
      job.stage = 'COMPLETE';
      job.completedAt = now();
      job.officialEvidenceCount = job.results.filter((x) => x.resultConfirmed).length;
      job.discoveredEntities = this.entitiesFor(job.id).all();
      job.historicalComparison = buildHistoricalComparison(job.results.flatMap((r) => (Array.isArray(r?.documents) ? r.documents : [])));
      await browser.close().catch(() => {});
    } catch (e) {
      job.status = 'FAILED';
      job.stage = 'FAILED';
      job.error = String(e);
      await browser?.close().catch(() => {});
      job.updatedAt = now();
    }
  }

  async resume(jobId: string): Promise<{ ok: boolean; error?: string }> {
    const job = this.jobs.get(jobId);
    const session = this.sessions.get(jobId);
    if (!job || !session) return { ok: false, error: 'active human session not found' };
    if (await challenge(session.page)) return { ok: false, error: 'human verification is not complete' };

    // Continue directly against the SAME already-verified page/context the
    // paused session held onto — re-navigating (a fresh runStep() context)
    // would discard the just-completed human verification.
    const key = session.step.type === 'entity' ? session.step.source : session.step.key;
    const ledger = this.ledgerFor(jobId);
    const entities = this.entitiesFor(jobId);
    let finalResult: any = null;
    try {
      if (key === 'tas') finalResult = await runTasWorkflow(session.page, session.query, job.mode, entities, { skipGoto: true });
      else if (key === 'msmap') finalResult = await runMsMapWorkflow(session.page, session.query, ledger, entities, { skipGoto: true });
      else if (key === 'mygov') finalResult = await runMyGovWorkflow(session.page, session.ctx, session.query, entities, { skipGoto: true });
      else if (key === 'enreg') {
        const forEntity = session.step.type === 'entity' ? { name: session.step.name, idCode: session.step.idCode } : { name: session.query, idCode: null };
        finalResult = await runEnregWorkflow(session.page, forEntity, entities, { skipGoto: true });
      } else if (key === 'rstax' || key === 'debtor') {
        const forEntity = session.step.type === 'entity' ? { name: session.step.name, idCode: session.step.idCode } : null;
        finalResult = key === 'rstax' ? await runRsTaxpayerWorker(session.page, forEntity, entities, { skipGoto: true }) : await runDebtorWorker(session.page, forEntity, entities, { skipGoto: true });
      } else {
        finalResult = await runGenericWorkflow(session.page, key, NAPR_META, session.query);
      }
    } catch (e) {
      finalResult = { source: key, status: 'FAILED', error: String(e), documents: [], discoveredEntities: [], resultConfirmed: false, noResultConfirmed: false, resultValidated: false, traversal: null, retrievedAt: now() };
    }

    job.results = job.results.filter((x) => !stepMatchesResult(session.step, x));
    job.results.push(legacyDocuments({ ...finalResult, humanVerificationCompleted: true }));
    job.humanVerification = null;
    await session.ctx.close().catch(() => {});
    this.sessions.delete(jobId);
    this.run(job, job.sourceIndex + 1, session.browser).catch((e) => {
      job.status = 'FAILED';
      job.error = String(e);
    });
    return { ok: true };
  }

  async skip(jobId: string): Promise<{ ok: boolean; source?: string; error?: string }> {
    const job = this.jobs.get(jobId);
    const session = this.sessions.get(jobId);
    if (!job || !session) return { ok: false, error: 'active human session not found' };
    const key = session.step.type === 'entity' ? session.step.source : session.step.key;
    const result = {
      source: key,
      sourceName: key,
      sourceClass: null,
      sourceUrl: session.page.url(),
      startUrl: null,
      finalUrl: session.page.url(),
      frameUrls: [],
      searchControlUsed: null,
      queryEntered: session.query || null,
      submitAction: null,
      resultContext: null,
      status: 'SKIPPED_HUMAN_VERIFICATION',
      traversal: { status: 'SKIPPED_HUMAN_VERIFICATION' },
      resultConfirmed: false,
      noResultConfirmed: false,
      resultValidated: false,
      discoveredEntities: [],
      forEntity: session.step.type === 'entity' ? { name: session.step.name, idCode: session.step.idCode } : null,
      error: null,
      retrievedAt: now(),
      documents: [],
      skippedHumanVerification: true,
    };
    job.results = job.results.filter((x) => !stepMatchesResult(session.step, x));
    job.results.push(result);
    job.humanVerification = null;
    await session.ctx.close().catch(() => {});
    const browser = session.browser;
    this.sessions.delete(jobId);
    this.run(job, job.sourceIndex + 1, browser).catch((e) => {
      job.status = 'FAILED';
      job.error = String(e);
    });
    return { ok: true, source: key };
  }
}
