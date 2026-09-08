// ResearchOrchestrator.ts — mandate Section 4's "Research Orchestrator."
// Replaces the pre-refactor index.js's run()/one()/hold()/
// tasWithCadastralFallback() with a single driver that calls the four
// explicit *Workflow.ts functions, manages the shared EvidenceLedger and
// EntityQueue for one job, and handles the WAITING_HUMAN pause/resume/skip
// lifecycle (mandate Section 10) generically across all four sources
// instead of ad hoc per-source resume logic.
import { launchResearchBrowser, researchContext, logBrowserLifecycle } from '../browser/BrowserlessRuntime.js';
import { decideBrowserlessReconnect } from '../browser/BrowserlessRecovery.js';
import { openHumanLiveSession, closeHumanLiveSession, humanLiveFields, type HumanLiveSessionState } from '../browser/HumanLiveSession.js';
import { createVisualWatch, attachVisualWatch, detachVisualWatch, isWatchingPage, visualWatchFields, type VisualWatchState } from '../browser/VisualWatchSession.js';
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
  browser: any;
  ctx: any;
  page: any;
  jobId: string;
  step: StepDescriptor;
  query: string;
  expires: number;
  // Interactive Browserless live view onto THIS preserved page (never a
  // different one). Server-side only — humanLiveFields() decides what, if
  // anything, about it may reach the client. `live` is null whenever no view
  // is currently open, `liveError` carries the last non-sensitive reason it
  // could not be opened so GET /research/:id can say "interactive
  // unavailable" honestly instead of silently omitting it.
  live: HumanLiveSessionState | null;
  liveError: string | null;
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
  // OBSERVABILITY ONLY: how many Browserless sessions this job has had to
  // replace in total. It is NOT a budget and must never gate a reconnect —
  // that was the P0 root cause (see BrowserlessRecovery.ts's header: a
  // per-job budget of 1 left MyGov/ENREG/RSTAX/DEBTOR unrecoverable once TAS
  // had spent it). The actual budget is per independent source attempt and
  // lives in decideBrowserlessReconnect(); this counter only enriches the
  // browser_disconnected_reconnecting log line so repeated session
  // expirations within one job stay visible in production.
  private browserlessReconnects = new Map<string, number>();
  // Opt-in VISUAL WATCH state, one per job (see VisualWatchSession.ts).
  // Absent/disabled for every ordinary production job, in which case every
  // watch call below is inert and the job behaves exactly as before.
  private visualWatches = new Map<string, VisualWatchState>();

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
          await this.closeLiveView(s, 'ttl_expired');
          await this.detachWatch(id, ResearchOrchestrator.sourceOf(s.step), 'ttl_expired');
          logBrowserLifecycle('close_context', { jobId: id, reason: 'ttl_expired', closes: 'context' });
          await s.ctx.close().catch(() => {});
          logBrowserLifecycle('close_browser', { jobId: id, reason: 'ttl_expired', closes: 'browser' });
          await s.browser.close().catch(() => {});
          this.sessions.delete(id);
          this.browserlessReconnects.delete(id);
          this.visualWatches.delete(id);
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

  /**
   * Opens (or re-opens) the interactive Browserless live view on a
   * WAITING_HUMAN session's EXACT preserved page.
   *
   * Never launches or reconnects a browser, never creates a context or page:
   * it is handed `session.page` and nothing else, which is what preserves the
   * human's cookies/session/challenge state. Any previous view on that page
   * is closed by openHumanLiveSession() first, so a second CAPTCHA in the
   * same source cannot leak the first view's handle.
   *
   * Best-effort by construction — on failure the session keeps its page and
   * the job stays safely WAITING_HUMAN with interactive:false.
   */
  private async openLiveView(session: SessionState): Promise<void> {
    if (!(session.browser as any).__homatchBrowserless) {
      // Local/dev headed Chromium: there is no Browserless live view to mint,
      // and the developer is already looking at the real window.
      session.live = null;
      session.liveError = 'not_a_browserless_session';
      return;
    }
    const opened = await openHumanLiveSession(session.page, session.live, {
      jobId: session.jobId,
      source: ResearchOrchestrator.sourceOf(session.step),
      // An UPPER BOUND only. The live view cannot outlive the underlying
      // Browserless session, whose own lifetime this worker does not control
      // (see BrowserlessRuntime.ts's header) — this promises nothing.
      timeoutMs: Math.max(60 * 1000, session.expires - Date.now()),
    });
    session.live = opened.session;
    session.liveError = opened.error;
  }

  /** Best-effort teardown of the live VIEW only — never the human's session,
   * page, context or browser. Safe to call when no view is open. */
  private async closeLiveView(session: SessionState | undefined, reason: string): Promise<void> {
    if (!session?.live) return;
    await closeHumanLiveSession(session.page, session.live, {
      jobId: session.jobId,
      source: ResearchOrchestrator.sourceOf(session.step),
      reason,
    });
    session.live = null;
  }

  /** Points the visual watch at the page the orchestrator just created and is
   * about to drive, and republishes the job's `visualWatch` block so a
   * watcher polling GET /research/:id sees the new generation. Inert when
   * watching is off. Never throws — visual watching can never fail research. */
  private async attachWatch(jobId: string, page: any, source: string, reason: string): Promise<void> {
    const watch = this.visualWatches.get(jobId);
    if (!watch?.enabled) return;
    const session = this.sessions.get(jobId);
    await attachVisualWatch(watch, page, {
      jobId,
      source,
      reason,
      // An UPPER BOUND only — a live view cannot outlive the Browserless
      // session it belongs to, whose lifetime this worker does not control.
      timeoutMs: session ? Math.max(60 * 1000, session.expires - Date.now()) : TTL,
    });
    this.publishWatchState(jobId);
  }

  /** Best-effort release of the watched handle (source finished, resume, skip,
   * job end, TTL). Never closes the page. Inert when watching is off. */
  private async detachWatch(jobId: string, source: string, reason: string): Promise<void> {
    const watch = this.visualWatches.get(jobId);
    if (!watch?.enabled) return;
    await detachVisualWatch(watch, { jobId, source, reason });
    this.publishWatchState(jobId);
  }

  /** Recomputes job.visualWatch from whichever live handle is actually
   * streaming right now — the watch's own, or (for an ordinary WAITING_HUMAN
   * live view) the session's. Emits nothing at all when watching is off. */
  private publishWatchState(jobId: string): void {
    const job = this.jobs.get(jobId);
    const watch = this.visualWatches.get(jobId);
    if (!job || !watch?.enabled) return;
    const effective = this.currentLiveView(jobId);
    job.visualWatch = visualWatchFields(jobId, watch, effective.live, effective.error);
    job.updatedAt = now();
  }

  /** The live handle currently streaming this job's active page, whoever owns
   * it: the visual watch (watch jobs) or the WAITING_HUMAN session (ordinary
   * jobs — the deployed behaviour, unchanged). */
  private currentLiveView(jobId: string): { live: HumanLiveSessionState | null; error: string | null; source: string | null; generation: number } {
    const watch = this.visualWatches.get(jobId);
    const session = this.sessions.get(jobId);
    if (watch?.enabled && watch.live) {
      return { live: watch.live, error: watch.error, source: watch.source, generation: watch.generation };
    }
    return {
      live: session?.live ?? null,
      error: session?.liveError ?? watch?.error ?? null,
      source: session ? ResearchOrchestrator.sourceOf(session.step) : watch?.source ?? null,
      generation: watch?.generation ?? 0,
    };
  }

  /**
   * WAITING_HUMAN live view, with the visual-watch case folded in.
   *
   * For an ordinary job this is exactly the deployed path: mint a live view
   * on the preserved page (openLiveView).
   *
   * For a visualWatch job whose watch is ALREADY streaming that very page,
   * nothing is minted at all: the challenge appeared on the page the operator
   * is already looking at, so the same stream simply becomes the interactive
   * human session. That is what guarantees there is never a hidden automation
   * browser plus a separate CAPTCHA browser.
   */
  private async ensureHumanLiveView(session: SessionState): Promise<void> {
    const watch = this.visualWatches.get(session.jobId);
    const source = ResearchOrchestrator.sourceOf(session.step);
    if (watch?.enabled) {
      if (isWatchingPage(watch, session.page)) {
        logBrowserLifecycle('visual_watch_captcha_same_page', { jobId: session.jobId, source, generation: watch.generation });
        this.publishWatchState(session.jobId);
        return;
      }
      // Watching is on but not currently attached to this page (an earlier
      // attach failed, or the page changed): attach it here, to the exact
      // preserved CAPTCHA page.
      await this.attachWatch(session.jobId, session.page, source, 'captcha');
      return;
    }
    await this.openLiveView(session);
  }

  /**
   * The authenticated POST/GET /research/:id/live handler's data source (the
   * path ResearchCaptchaModal.tsx already calls in production):
   * the live URL for an ACTIVE human session, minted on demand if one is not
   * open yet (so a client can retry after a transient creation failure
   * without the job ever leaving WAITING_HUMAN).
   *
   * Returns the URL itself — this is the credential-safe channel, reached
   * only by a caller that already authenticated for this job — but never the
   * liveURLId, and never any browser/context/page handle. Returns null when
   * there is no active session or no view could be opened; the caller turns
   * that into an honest "interactive unavailable", never a job failure.
   */
  async getOrCreateLiveView(jobId: string): Promise<{ liveURL: string; source: string | null; expiresAt: string | null; generation: number; mode: 'human_verification' | 'visual_watch'; pageUrl: string | null } | null> {
    const watch = this.visualWatches.get(jobId);
    const session = this.sessions.get(jobId);

    // 1. An active WAITING_HUMAN session — the deployed path, unchanged: mint
    //    on the preserved page only when nothing is streaming it yet, so a
    //    polling/refreshing UI reuses the open handle instead of duplicating.
    if (session) {
      if (!session.live && !isWatchingPage(watch, session.page)) await this.ensureHumanLiveView(session);
      const current = this.currentLiveView(jobId);
      if (!current.live) return null;
      return {
        liveURL: current.live.liveURL,
        source: ResearchOrchestrator.sourceOf(session.step),
        expiresAt: new Date(session.expires).toISOString(),
        generation: current.generation,
        mode: watch?.enabled && watch.live ? 'visual_watch' : 'human_verification',
        pageUrl: safePageUrl(session.page),
      };
    }

    // 2. A RUNNING visualWatch job: hand back the stream already attached to
    //    the real active worker page. Never minted here — attachment happens
    //    where the page is created, so polling can never create a second
    //    handle or touch the running research.
    if (watch?.enabled && watch.live) {
      return {
        liveURL: watch.live.liveURL,
        source: watch.source,
        expiresAt: null,
        generation: watch.generation,
        mode: 'visual_watch',
        pageUrl: safePageUrl(watch.watchedPage),
      };
    }

    return null;
  }

  /** Whether this job opted into visual watching — lets the HTTP layer tell
   * "no live session for an ordinary job" (404, unchanged) apart from "a
   * watch job whose stream is not up yet" (503, keep polling). */
  isVisualWatchEnabled(jobId: string): boolean {
    return !!this.visualWatches.get(jobId)?.enabled;
  }

  /** `options.visualWatch` (POST /research's `visualWatch: true`) turns on the
   * opt-in live view of the REAL research browser from its very first page —
   * a debugging/observation capability, never a change to how research runs.
   * Absent or false, nothing about this job differs from before. */
  start(query: string, mode: 'cadastral' | 'property', options: { visualWatch?: boolean } = {}): ResearchJob {
    const id = randomUUID();
    const job: ResearchJob = { id, query, mode, status: 'QUEUED', stage: 'QUEUED', sourceIndex: 0, results: [], createdAt: now(), updatedAt: now() };
    if (options.visualWatch) {
      const watch = createVisualWatch(true);
      this.visualWatches.set(id, watch);
      job.visualWatch = visualWatchFields(id, watch);
      logBrowserLifecycle('visual_watch_requested', { jobId: id, mode });
    }
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
  private async runStep(browser: any, job: ResearchJob, step: StepDescriptor): Promise<{ result: any; keep: boolean; browser: any }> {
    const ledger = this.ledgerFor(job.id);
    const entities = this.entitiesFor(job.id);
    const key = step.type === 'entity' ? step.source : step.key;
    const query = step.type === 'entity' ? step.idCode || step.name : job.query;
    const forEntity = step.type === 'entity' ? { name: step.name, idCode: step.idCode } : null;

    let ctx: any;
    let page: any;
    let sharedBrowserlessContext = !!(browser as any).__homatchBrowserless;
    // Scoped to this single source attempt and reset by being a local — this
    // is what makes recovery independent per source yet still bounded.
    let reconnectsUsedForThisSourceAttempt = 0;

    const acquirePage = async () => {
      logBrowserLifecycle('before_source', {
        jobId: job.id,
        source: key,
        browserlessSession: sharedBrowserlessContext,
        contextCount: browser.contexts?.()?.length ?? null,
        cachedContextPresent: !!(browser as any).__homatchResearchContext,
      });
      const c = await researchContext(browser);
      const p = await c.newPage();
      logBrowserLifecycle('page_created', { jobId: job.id, source: key, pageCount: c.pages?.()?.length ?? null });
      return { c, p };
    };

    try {
      const acquired = await acquirePage();
      ctx = acquired.c;
      page = acquired.p;
    } catch (e) {
      // Budget is per INDEPENDENT SOURCE ATTEMPT (this local counter), never
      // per job — a reconnect an earlier source needed must not disqualify
      // this one from recovering from a later, separate session expiration.
      const decision = decideBrowserlessReconnect(sharedBrowserlessContext, e, reconnectsUsedForThisSourceAttempt);
      if (decision.shouldReconnect) {
        reconnectsUsedForThisSourceAttempt = decision.attempt;
        const jobTotal = (this.browserlessReconnects.get(job.id) || 0) + 1;
        this.browserlessReconnects.set(job.id, jobTotal);
        logBrowserLifecycle('browser_disconnected_reconnecting', { jobId: job.id, source: key, attempt: decision.attempt, jobTotal });
        try {
          // The dead browser reference (and the stale context cached on it)
          // is dropped here in favour of a fresh Browserless session; the new
          // browser carries no cached context, so the retry below acquires a
          // genuinely new one.
          browser = await launchResearchBrowser();
          sharedBrowserlessContext = !!(browser as any).__homatchBrowserless;
          const acquired = await acquirePage();
          ctx = acquired.c;
          page = acquired.p;
        } catch (e2) {
          logBrowserLifecycle('browser_reconnect_failed', { jobId: job.id, source: key, error: String(e2).slice(0, 200) });
          return { result: buildTechnicalFailureResult(key, forEntity, e2), keep: false, browser };
        }
      } else {
        logBrowserLifecycle('page_acquisition_failed', { jobId: job.id, source: key, error: String(e).slice(0, 200) });
        return { result: buildTechnicalFailureResult(key, forEntity, e), keep: false, browser };
      }
    }

    await page.setViewportSize({ width: 1440, height: 1000 }).catch(() => {});

    // ACTIVE PAGE ASSIGNED. This is the one place a source's real page comes
    // into existence, for the first source and for every later one, including
    // the fresh page created on a brand-new browser after a Browserless
    // reconnect — so pointing the visual watch here is what makes it follow
    // the ACTUAL worker page across every transition, with `reason` recording
    // which kind of transition it was. Inert unless the job opted in.
    await this.attachWatch(
      job.id,
      page,
      key,
      reconnectsUsedForThisSourceAttempt > 0 ? 'browser_reconnect' : 'source_page'
    );

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
        this.sessions.set(job.id, { browser, ctx, page, jobId: job.id, step, query, expires: Date.now() + TTL, live: null, liveError: null });
        return { result, keep: true, browser };
      }
      // SOURCE COMPLETED: release the watch handle before the page it is
      // attached to goes away; the next source's page gets its own.
      await this.detachWatch(job.id, key, 'source_complete');
      if (sharedBrowserlessContext) {
        logBrowserLifecycle('close_page', { jobId: job.id, source: key, reason: 'source_complete', closes: 'page' });
        await page.close().catch(() => {});
      } else {
        logBrowserLifecycle('close_context', { jobId: job.id, source: key, reason: 'source_complete', closes: 'context' });
        await ctx.close().catch(() => {});
      }
      return { result, keep: false, browser };
    } catch (e) {
      logBrowserLifecycle('source_exception', { jobId: job.id, source: key, error: String(e).slice(0, 200) });
      await this.detachWatch(job.id, key, 'source_error');
      if (sharedBrowserlessContext) {
        logBrowserLifecycle('close_page', { jobId: job.id, source: key, reason: 'source_error', closes: 'page' });
        await page.close().catch(() => {});
      } else {
        logBrowserLifecycle('close_context', { jobId: job.id, source: key, reason: 'source_error', closes: 'context' });
        await ctx.close().catch(() => {});
      }
      return { result: buildTechnicalFailureResult(key, forEntity, e), keep: false, browser };
    }
  }

  private async run(job: ResearchJob, startIndex = 0, browser: any = null): Promise<void> {
    if (!job.steps) job.steps = buildInitialSteps(job);
    job.status = 'RUNNING';
    job.updatedAt = now();
    try {
      // Run Chromium in real headed mode. Railway provides a virtual X
      // display through xvfb-run (Dockerfile), so government sites see the
      // same headed browser mode we live-tested locally instead of the old
      // headless execution mode. CAPTCHA is still solved only by the human.
      browser = browser || (await launchResearchBrowser());
      for (let i = startIndex; i < job.steps.length; i++) {
        const step = job.steps[i];
        job.sourceIndex = i;
        job.stage = step.type === 'entity' ? `CHECKING_${step.source.toUpperCase()}_ENTITY_${step.idCode}` : `CHECKING_${step.key.toUpperCase()}`;
        const { result, keep, browser: possiblyRelaunchedBrowser } = await this.runStep(browser, job, step);
        // runStep() may have relaunched a fresh Browserless browser mid-job
        // (bounded to one recovery per source attempt — see the
        // BrowserDisconnectedError handling there) after the original one's
        // Browserless session died. Every SUBSEQUENT step, and this job's own
        // resume()/skip() session if it pauses on a later step, must use that
        // new browser, not the dead one this loop started with.
        browser = possiblyRelaunchedBrowser;
        job.results = job.results.filter((x) => !stepMatchesResult(step, x));
        job.results.push(legacyDocuments(result));
        job.updatedAt = now();
        if (keep) {
          job.status = 'WAITING_HUMAN';
          job.stage = 'CAPTCHA_REQUIRED';
          // Mint the interactive live view on the EXACT page runStep() just
          // preserved, before the job document is published, so the very
          // first GET /research/:id a client polls already tells it whether
          // an interactive session is available. Best-effort: a failure here
          // leaves the session preserved and the job WAITING_HUMAN with
          // interactive:false — never a lost page, never a job failure.
          const humanSession = this.sessions.get(job.id);
          if (humanSession) await this.ensureHumanLiveView(humanSession);
          const liveNow = this.currentLiveView(job.id);
          job.humanVerification = {
            sessionId: job.id,
            required: true,
            source: step.type === 'entity' ? step.source : step.key,
            step,
            url: result.finalUrl || result.sourceUrl,
            expiresAt: new Date(Date.now() + TTL).toISOString(),
            ...humanLiveFields(job.id, liveNow.live, liveNow.error),
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
      await this.closeLiveView(this.sessions.get(job.id), 'job_complete');
      await this.detachWatch(job.id, 'job', 'job_complete');
      logBrowserLifecycle('close_browser', { jobId: job.id, reason: 'job_complete', closes: 'browser' });
      await browser.close().catch(() => {});
      this.browserlessReconnects.delete(job.id);
      this.visualWatches.delete(job.id);
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

      await this.closeLiveView(this.sessions.get(job.id), 'job_failed');
      await this.detachWatch(job.id, 'job', 'job_failed');
      logBrowserLifecycle('close_browser', { jobId: job.id, reason: 'job_failed', closes: 'browser' });
      await browser?.close().catch(() => {});
      this.browserlessReconnects.delete(job.id);
      this.visualWatches.delete(job.id);
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
      // Same preserved page, second challenge: re-open the live view on it.
      // openHumanLiveSession() closes the superseded handle first, so
      // repeated CAPTCHAs cannot accumulate orphaned Browserless views.
      await this.ensureHumanLiveView(session);
      const liveNow = this.currentLiveView(job.id);
      job.humanVerification = {
        sessionId: job.id,
        required: true,
        source: key,
        step: session.step,
        url: finalResult.finalUrl || finalResult.sourceUrl || session.page.url(),
        expiresAt: new Date(session.expires).toISOString(),
        ...humanLiveFields(job.id, liveNow.live, liveNow.error),
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
    // The human is done with this page — release the live view before the
    // page itself is closed. Best-effort: a failed close never blocks resume.
    await this.closeLiveView(session, 'resume_complete');
    await this.detachWatch(job.id, key, 'resume_complete');
    if ((session.browser as any).__homatchBrowserless) {
      logBrowserLifecycle('close_page', { jobId: job.id, source: key, reason: 'resume_complete', closes: 'page' });
      await session.page.close().catch(() => {});
    } else {
      logBrowserLifecycle('close_context', { jobId: job.id, source: key, reason: 'resume_complete', closes: 'context' });
      await session.ctx.close().catch(() => {});
    }
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
    // Skipping abandons the human session for this source: release the live
    // view first, then fall through to the unchanged page/context close.
    await this.closeLiveView(session, 'skip_human_verification');
    await this.detachWatch(job.id, key, 'skip_human_verification');
    if ((session.browser as any).__homatchBrowserless) {
      logBrowserLifecycle('close_page', { jobId: job.id, source: key, reason: 'skip_human_verification', closes: 'page' });
      await session.page.close().catch(() => {});
    } else {
      logBrowserLifecycle('close_context', { jobId: job.id, source: key, reason: 'skip_human_verification', closes: 'context' });
      await session.ctx.close().catch(() => {});
    }
    const browser = session.browser;
    this.sessions.delete(jobId);
    this.run(job, job.sourceIndex + 1, browser).catch((e) => {
      job.status = 'FAILED';
      job.error = String(e);
    });
    return { ok: true, source: key };
  }
}
