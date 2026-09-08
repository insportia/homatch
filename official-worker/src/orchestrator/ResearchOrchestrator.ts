// ResearchOrchestrator.ts — mandate Section 4's "Research Orchestrator."
// Replaces the pre-refactor index.js's run()/one()/hold()/
// tasWithCadastralFallback() with a single driver that calls the four
// explicit *Workflow.ts functions, manages the shared EvidenceLedger and
// EntityQueue for one job, and handles the WAITING_HUMAN pause/resume/skip
// lifecycle (mandate Section 10) generically across all four sources
// instead of ad hoc per-source resume logic.
import { launchJobBrowser, jobContext, closeJobBrowser, logBrowserLifecycle, type JobBrowser } from '../browser/LocalBrowserRuntime.js';
import { randomUUID } from 'node:crypto';
import { EvidenceLedger } from '../evidence/EvidenceLedger.js';
import { EntityQueue } from '../entities/EntityQueue.js';
import { runTasMapWorker } from '../workflows/tasmap/TasMapWorker.js';
import { runTasWorkflow } from '../workflows/tas/TasWorkflow.js';
import { runMyGovWorkflow } from '../workflows/mygov/MyGovWorkflow.js';
import { runEnregWorkflow } from '../workflows/enreg/EnregWorkflow.js';
import { runRsTaxpayerWorker } from '../workflows/financial/RsTaxpayerWorker.js';
import { runDebtorWorker } from '../workflows/financial/DebtorWorker.js';
import { runGenericWorkflow } from '../workflows/generic/GenericWorkflow.js';
import { buildInitialSteps, stepMatchesResult, primaryStepsRemain, buildEntitySteps, type ResearchJob, type StepDescriptor } from './ResearchContext.js';
import { looksLikeCompanyId } from '../entities/EntityValidation.js';
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

/** A reCAPTCHA iframe/widget may remain mounted after a human has solved it.
 * Treat a real response token or aria-checked=true anchor as proof that the
 * human step completed. This never solves or bypasses the challenge; it only
 * observes the browser state that the human created. */
async function recaptchaSolved(page: any): Promise<boolean> {
  try {
    const token = await page.locator('textarea[name="g-recaptcha-response"]').first().inputValue().catch(() => '');
    if (String(token || '').trim()) return true;
  } catch {
    /* keep checking frames */
  }
  try {
    for (const frame of page.frames()) {
      if (!/recaptcha/i.test(String(frame.url?.() || ''))) continue;
      const anchor = frame.locator('#recaptcha-anchor').first();
      if (await anchor.count().catch(() => 0)) {
        const checked = await anchor.getAttribute('aria-checked').catch(() => null);
        if (checked === 'true') return true;
      }
    }
  } catch {
    /* unresolved means not proven solved */
  }
  return false;
}

async function humanVerificationPending(page: any): Promise<boolean> {
  if (await recaptchaSolved(page)) return false;
  return !!(await challenge(page));
}

const now = () => new Date().toISOString();
const TTL = 15 * 60 * 1000;
// Bounds an otherwise-unbounded research graph — a document mentioning many
// unrelated companies must never turn one Verify into dozens of ENREG/RS/
// Debtor jobs. Counts COMPANIES, not steps: buildEntitySteps() now emits a
// full enreg->rstax->debtor triple per bounded company (2026-09-06 pipeline
// mandate), so this caps at most MAX_AUTO_ENREG_ENTITIES * 3 auto-queued
// entity steps.
const MAX_AUTO_ENREG_ENTITIES = 3;

const NAPR_META = { name: 'NAPR', class: 'OFFICIAL_REGISTRY', url: 'https://napr.gov.ge/' };
const ENREG_PROPERTY_META = { name: 'Entrepreneur Registry', class: 'OFFICIAL_REGISTRY', url: 'https://enreg.reestri.gov.ge/main.php?m=new_index' };

interface SessionState {
  /** The job's local Chromium (persistent context + throwaway profile). */
  jobBrowser: JobBrowser;
  ctx: any;
  page: any;
  jobId: string;
  step: StepDescriptor;
  query: string;
  expires: number;
}

/** buildTechnicalFailureResult() — the one shape every source uses to report
 * "this source could not be checked," whether the workflow itself threw or
 * the browser/page never came up at all. Centralized (2026-09-08 P0
 * Browserless lifecycle fix) so the newPage()-outside-a-try bug this
 * replaces — see runStep()'s header comment — could not silently duplicate
 * this literal a second, drifting time. `status: 'FAILED'` here is a
 * TECHNICAL/source-level failure only (mandate: "SOURCE FAILURE VS PROPERTY
 * RISK" — NO EVIDENCE = NO FACT); it is never treated as negative evidence
 * about the property downstream, and — critically — it no longer takes the
 * whole job down with it (see run()'s loop below), so the customer still
 * gets whatever OTHER sources did complete. */
function buildTechnicalFailureResult(key: string, forEntity: { name: string; idCode: string | null } | null, e: unknown): any {
  return {
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
  };
}

/** page.url() without the ability to throw on a closed/dead target. The URL
 * of a government page is not a secret; a live-view URL, a CDP endpoint or a
 * token would be, and none of those can appear here. */
function safePageUrl(page: any): string | null {
  try {
    return page?.url?.() ?? null;
  } catch {
    return null;
  }
}

export class ResearchOrchestrator {
  private jobs = new Map<string, ResearchJob>();
  private sessions = new Map<string, SessionState>();
  private ledgers = new Map<string, EvidenceLedger>();
  private entityQueues = new Map<string, EntityQueue>();
  // One local Chromium per job (LocalBrowserRuntime.JobBrowser), kept so TTL
  // cleanup and process signals can close a context whose job never finished.
  private jobBrowsers = new Map<string, JobBrowser>();

  constructor() {
    setInterval(async () => {
      for (const [id, s] of this.sessions) {
        if (Date.now() > s.expires) {
          // Abandoned/TTL session (mandate scenario #18): the whole job is
          // being given up on, so — unlike every other close path in this
          // class — closing the entire browser (not just the page/context)
          // is correct here, not a violation of per-source ownership.
          // `.catch(()=>{})` on both makes a second sweep over an
          // already-deleted session id impossible (the Map delete below is
          // synchronous within this same tick) and a double-close of an
          // already-closed target harmless either way (scenario #19).
          // Abandoned job: the whole local Chromium goes, including its
          // throwaway profile directory. closeJobBrowser() is idempotent, so a
          // second sweep or a terminal path racing this one is harmless.
          await closeJobBrowser(s.jobBrowser, 'ttl_expired');
          this.sessions.delete(id);
          this.jobBrowsers.delete(id);
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

  /** Source key of a step — the label used in every human-session log line
   * and in the humanVerification response. */
  private static sourceOf(step: StepDescriptor): string {
    return step.type === 'entity' ? step.source : step.key;
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
    // Real production job 08379309-bb2e-4ac6-9d97-727edb3af2b8: this used
    // to fall back to `idCode || name` for 'enreg', which copied the
    // company NAME into the idCode field whenever idCode was null/absent —
    // confirmed live as `forEntity: { name: "Millenio Group", idCode:
    // "Millenio Group" }`, which then made runEnregWorkflow's own
    // hasIdentifier/searchMethod selection treat a NAME as an ID_CODE
    // search value (`searchMethod: "ID_CODE"`, `searchValue: "Millenio
    // Group"`). Required invariant: idCode must be a real numeric
    // registry ID or null — NEVER a name, for any source. Leaving it
    // honestly null here is exactly what makes ENREG's own, already-
    // correct NAME fallback (driven by `forEntity.name` directly) fire —
    // nothing else needs to change for that to work. rstax/debtor still
    // get idCode as given (validated the same way) since they have no
    // name-search field of their own — a non-numeric idCode there
    // resolves to a clean, honest "no identifier" precondition skip in
    // RsTaxpayerWorker/DebtorWorker, never a name typed into a TIN input.
    const stepIdCode = looksLikeCompanyId(idCode) ? (idCode as string) : null;
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

  /**
   * runStep() — P0 incident 2026-09-08 (job
   * 61496cf0-36de-4da9-acf7-7e2a75728043) fix.
   *
   * Before this fix, `const page = await ctx.newPage()` sat OUTSIDE this
   * function's own try/catch. A dead Browserless context/browser (see
   * BrowserlessRuntime.ts's module header for the proven root cause — an
   * unconfigured session timeout) threw there uncaught, which propagated
   * all the way to run()'s own catch and marked the ENTIRE job FAILED —
   * discarding every source's real evidence and giving the customer zero
   * report, even when one or more sources (here, TAS_MAP) had already
   * completed successfully. That is exactly the outcome mandate section
   * "SOURCE FAILURE VS PROPERTY RISK"/"REALISTIC FAILURE POLICY" forbids
   * for a technical, per-source problem.
   *
   * Now: acquiring the context/page is inside its own try. A confirmed-dead
   * BROWSER (BrowserDisconnectedError, not merely a dead cached context —
   * researchContext() already recovers a dead context on its own when the
   * browser is still alive) gets exactly one bounded reconnect attempt for
   * THIS source attempt; anything else, or a reconnect that itself fails,
   * becomes a clean TECHNICAL_FAILED result for THIS source only — never a
   * whole-job crash, never negative evidence about the property.
   *
   * P0 INCIDENT 2026-09-08 (job 4d2ec4ba-e0ca-49f8-b7a1-cf1e37e23d44): that
   * budget used to be once per JOB, so when Browserless sessions expired
   * every ~2 minutes, TAS spent the job's only reconnect and MyGov, ENREG,
   * RSTAX and DEBTOR were all refused one and failed technically. The budget
   * is now scoped to one independent source attempt — see
   * BrowserlessRecovery.ts — so each source can recover once from its own
   * separate session expiration, while still never looping.
   */
  private async runStep(jobBrowser: JobBrowser, job: ResearchJob, step: StepDescriptor): Promise<{ result: any; keep: boolean }> {
    const ledger = this.ledgerFor(job.id);
    const entities = this.entitiesFor(job.id);
    const key = step.type === 'entity' ? step.source : step.key;
    const query = step.type === 'entity' ? step.idCode || step.name : job.query;
    const forEntity = step.type === 'entity' ? { name: step.name, idCode: step.idCode } : null;

    const ctx = jobContext(jobBrowser);
    let page: any;

    // Pages this source causes to be opened beyond its own (target=_blank
    // popups, government sites that spawn viewers). Tracked so they can be
    // cleaned up with the source WITHOUT ever closing the shared job context.
    const popups: any[] = [];
    const onPopup = (p: any) => {
      if (p !== page) popups.push(p);
    };
    ctx.on('page', onPopup);

    const releaseSourcePages = async (reason: string) => {
      ctx.off?.('page', onPopup);
      for (const popup of popups) {
        if (!popup.isClosed?.()) await popup.close().catch(() => {});
      }
      logBrowserLifecycle('close_page', { jobId: job.id, source: key, reason, closes: 'page', popupsClosed: popups.length });
      await page?.close().catch(() => {});
    };

    try {
      logBrowserLifecycle('before_source', {
        jobId: job.id,
        source: key,
        pageCount: ctx.pages?.()?.length ?? null,
      });
      page = await ctx.newPage();
      logBrowserLifecycle('page_created', { jobId: job.id, source: key, pageCount: ctx.pages?.()?.length ?? null });
    } catch (e) {
      ctx.off?.('page', onPopup);
      // A page that cannot be opened is a TECHNICAL failure for THIS source
      // only — never a whole-job crash and never negative property evidence.
      logBrowserLifecycle('page_acquisition_failed', { jobId: job.id, source: key, error: String(e).slice(0, 200) });
      return { result: buildTechnicalFailureResult(key, forEntity, e), keep: false };
    }

    await page.setViewportSize({ width: 1440, height: 1000 }).catch(() => {});

    try {
      let result: any;
      if (key === 'tas') result = await runTasWorkflow(page, query, job.mode, entities);
      else if (key === 'TAS_MAP') result = await runTasMapWorker(page, query, ledger, entities);
      else if (key === 'mygov') result = await runMyGovWorkflow(page, ctx, query, entities);
      else if (key === 'enreg') result = await runEnregWorkflow(page, forEntity || { name: query, idCode: /^[0-9-]{6,}$/.test(String(query || '').trim()) ? query : null }, entities);
      else if (key === 'rstax') result = await runRsTaxpayerWorker(page, forEntity, entities);
      else if (key === 'debtor') result = await runDebtorWorker(page, forEntity, entities);
      else result = await runGenericWorkflow(page, key, NAPR_META, query);

      const isWaitingHuman = result?.status === 'WAITING_HUMAN';
      if (isWaitingHuman) {
        // Preserve the EXACT Chromium, context, page, cookies and extension
        // state. Nothing is closed, nothing is re-created, and the source
        // index does not advance: /screenshot and /action drive this very
        // Page, and resume() continues on it.
        ctx.off?.('page', onPopup);
        this.sessions.set(job.id, { jobBrowser, ctx, page, jobId: job.id, step, query, expires: Date.now() + TTL });
        return { result, keep: true };
      }

      // SOURCE COMPLETED: the source owns only its own Page (and any popups
      // it opened). The job context stays alive for the next source.
      await releaseSourcePages('source_complete');
      return { result, keep: false };
    } catch (e) {
      logBrowserLifecycle('source_exception', { jobId: job.id, source: key, error: String(e).slice(0, 200) });
      await releaseSourcePages('source_error');
      return { result: buildTechnicalFailureResult(key, forEntity, e), keep: false };
    }
  }

  private async run(job: ResearchJob, startIndex = 0, existing: JobBrowser | null = null): Promise<void> {
    if (!job.steps) job.steps = buildInitialSteps(job);
    job.status = 'RUNNING';
    job.updatedAt = now();
    let jobBrowser: JobBrowser | null = existing;
    try {
      // ONE local Chromium per job: a persistent context with its own
      // throwaway profile and the bundled human-assist extension loaded.
      // Headed under xvfb-run (Dockerfile), exactly as this repository ran
      // before Browserless. CAPTCHA is still solved only by the human.
      jobBrowser = jobBrowser || (await launchJobBrowser(job.id));
      this.jobBrowsers.set(job.id, jobBrowser);
      for (let i = startIndex; i < job.steps.length; i++) {
        const step = job.steps[i];
        job.sourceIndex = i;
        job.stage = step.type === 'entity' ? `CHECKING_${step.source.toUpperCase()}_ENTITY_${step.idCode}` : `CHECKING_${step.key.toUpperCase()}`;
        const { result, keep } = await this.runStep(jobBrowser, job, step);
        job.results = job.results.filter((x) => !stepMatchesResult(step, x));
        job.results.push(legacyDocuments(result));
        job.updatedAt = now();
        if (keep) {
          job.status = 'WAITING_HUMAN';
          job.stage = 'CAPTCHA_REQUIRED';
          job.humanVerification = {
            sessionId: job.id,
            required: true,
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
      await closeJobBrowser(jobBrowser, 'job_complete');
      this.jobBrowsers.delete(job.id);
    } catch (e) {
      job.status = 'FAILED';
      job.stage = 'FAILED';
      job.error = String(e);

      // Keep fatal worker failures observable without logging credentials,
      // request headers, Browserless URLs, tokens, or environment values.
      const rawFailureMessage =
        e instanceof Error
          ? String(e.message || 'worker job failed')
          : String(e || 'worker job failed');

      const safeFailureMessage = rawFailureMessage
        // Never persist URL query strings; Browserless credentials can be
        // transported as query parameters on CDP/WebSocket URLs.
        .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s?#]+)\?[^\s#]*/gi, '$1?[REDACTED]')
        // Redact common credential-bearing key/value forms even when the
        // message contains no complete URL.
        .replace(/\b(token|access_token|api[_-]?key|authorization|bearer|secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
        .slice(0, 300);

      const failure = {
        name: e instanceof Error
          ? String(e.name || 'Error').slice(0, 80)
          : 'Error',
        message: safeFailureMessage,
      };

      logBrowserLifecycle('job_error', {
        jobId: job.id,
        errorName: failure.name,
        errorMessage: failure.message,
      });

      await closeJobBrowser(jobBrowser, 'job_failed');
      this.jobBrowsers.delete(job.id);
      job.updatedAt = now();
    }
  }

  async resume(jobId: string): Promise<{ ok: boolean; error?: string }> {
    const job = this.jobs.get(jobId);
    const session = this.sessions.get(jobId);
    if (!job || !session) return { ok: false, error: 'active human session not found' };
    const key = session.step.type === 'entity' ? session.step.source : session.step.key;

    // Never use "visible CAPTCHA iframe" alone as the resume gate: both RS
    // and MyGov can keep the widget mounted after it has been solved. We
    // first observe the actual solved token/aria state, then fall back to the
    // generic challenge detector only when it is not solved.
    if (await humanVerificationPending(session.page)) return { ok: false, error: 'human verification is not complete' };

    const ledger = this.ledgerFor(jobId);
    const entities = this.entitiesFor(jobId);
    let finalResult: any = null;
    try {
      if (key === 'tas') finalResult = await runTasWorkflow(session.page, session.query, job.mode, entities, { skipGoto: true });
      else if (key === 'TAS_MAP') finalResult = await runTasMapWorker(session.page, session.query, ledger, entities, { skipGoto: true });
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

    // A deeper application/document can trigger a second CAPTCHA after the
    // first one was solved. Preserve the exact same headed browser session
    // instead of closing it and incorrectly advancing to the next source.
    if (finalResult?.status === 'WAITING_HUMAN') {
      job.results = job.results.filter((x) => !stepMatchesResult(session.step, x));
      job.results.push(legacyDocuments(finalResult));
      session.expires = Date.now() + TTL;
      job.status = 'WAITING_HUMAN';
      job.stage = 'CAPTCHA_REQUIRED';
      // Same preserved page, second challenge: nothing is re-created — the
      // human keeps interacting with this exact Page through /screenshot and
      // /action.
      job.humanVerification = {
        sessionId: job.id,
        required: true,
        source: key,
        step: session.step,
        url: finalResult.finalUrl || finalResult.sourceUrl || session.page.url(),
        expiresAt: new Date(session.expires).toISOString(),
        recommendedWidth: 1100,
        recommendedMaxHeight: '90vh',
        fullInteractiveSession: true,
        scrollable: true,
        message: 'დამატებითი ადამიანის დადასტურებაა საჭირო. დაასრულეთ იგი იმავე ბრაუზერში და შემდეგ გააგრძელეთ.',
      };
      return { ok: false, error: 'human verification is not complete' };
    }

    job.results = job.results.filter((x) => !stepMatchesResult(session.step, x));
    job.results.push(legacyDocuments({ ...finalResult, humanVerificationCompleted: true }));
    job.humanVerification = null;
    // The human is done with this page. Close the PAGE only — the job's
    // context, cookies and extension stay alive for the next source.
    logBrowserLifecycle('close_page', { jobId: job.id, source: key, reason: 'resume_complete', closes: 'page' });
    await session.page.close().catch(() => {});
    this.sessions.delete(jobId);
    this.run(job, job.sourceIndex + 1, session.jobBrowser).catch((e) => {
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
    // Skipping abandons this source only. Close its Page; the job's context
    // survives so the remaining sources still run.
    logBrowserLifecycle('close_page', { jobId: job.id, source: key, reason: 'skip_human_verification', closes: 'page' });
    await session.page.close().catch(() => {});
    const jobBrowser = session.jobBrowser;
    this.sessions.delete(jobId);
    this.run(job, job.sourceIndex + 1, jobBrowser).catch((e) => {
      job.status = 'FAILED';
      job.error = String(e);
    });
    return { ok: true, source: key };
  }
}
