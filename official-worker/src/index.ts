// index.ts — Express app entrypoint. This is now a thin HTTP layer over
// ResearchOrchestrator.ts; every endpoint's URL/response SHAPE is kept
// identical to the pre-refactor index.js (mandate Section 27: "preserve
// production API compatibility where practical") so the existing frontend
// and research-agent (Supabase) do not break. What changed is everything
// BEHIND these endpoints — see orchestrator/, workflows/, evidence/,
// entities/, documents/, state/.
import express from 'express';
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { ResearchOrchestrator } from './orchestrator/ResearchOrchestrator.js';
import { localBrowserHealth, installProcessCleanup, closeAllJobBrowsers, logBrowserLifecycle, redactSecrets } from './browser/LocalBrowserRuntime.js';
import { challenge, scanCandidateInputs, visible } from './browser/BrowserSession.js';
import { attachSpeechGateway } from './speech/SpeechGateway.js';
import { runSpeechSelfTest } from './speech/SpeechSelfTest.js';
import { lastRecogniserError, speechConfigFromEnv } from './speech/GoogleSpeechStream.js';
import { probeRegions } from './speech/SpeechRegionProbe.js';
import { probeRecognizers } from './speech/SpeechRecognizerProbe.js';
import { probeLanguageConfigs } from './speech/SpeechLanguageProbe.js';

const app = express();
const ALLOWED_ORIGINS = new Set(['https://homatch.live', 'https://www.homatch.live']);
app.use((req: any, res: any, next: any) => {
  const origin = String(req.headers.origin || '');
  if (origin && (ALLOWED_ORIGINS.has(origin) || /^https:\/\/homatch-[a-z0-9-]+-insportia\.vercel\.app$/i.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'authorization,apikey,content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.WORKER_TOKEN || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';

const orchestrator = new ResearchOrchestrator();

/*
 * Filled in once the gateway is attached, below. A function rather than a
 * value because /health is registered before app.listen runs, and a health
 * endpoint that reported a stale snapshot of its own capabilities would be
 * worse than one that reported none.
 */
let speechStatus: { available: boolean; reason: string | null; model: string | null; language: string | null } =
  { available: false, reason: 'NOT_STARTED', model: null, language: null };
const speechHealth = () => speechStatus;
const debugJobs = new Map<string, any>();

async function auth(req: any, res: any, next: any) {
  const h = String(req.headers.authorization || '');
  if (TOKEN && h === `Bearer ${TOKEN}`) return next();
  if (SUPABASE_URL && h.startsWith('Bearer ')) {
    try {
      const k = String(req.headers.apikey || '');
      if (!k) return res.status(401).json({ error: 'apikey required' });
      if ((await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: h, apikey: k } })).ok) return next();
    } catch {
      /* falls through to 401 */
    }
  }
  return res.status(401).json({ error: 'unauthorized' });
}

app.get('/health', (_q: any, r: any) =>
  r.json({
    ok: true,
    service: 'homatch-official-worker',
    // Deployed is not the same as able. Two Railway services run this image
    // and only one of them holds the Google credential.
    speech: speechHealth(),
    version: '2.1.0',
    playwright: true,
    architecture: 'deterministic-fsm-orchestrator-2026-09-05',
    standaloneEntityEnreg: true,
    pdfExtraction: true,
    onlineViewerReading: true,
    documentIntegrity: 'sha256+title+date',
    historicalComparison: true,
    cadastralParentFallback: true,
    entityDiscovery: true,
    navigationStackTraversal: true,
    humanVerificationSkip: true,
    sourceWorkflows: ['TAS_MAP:TasMapWorker (18-state FSM, tas.ge-opened map popup)', 'tas:TasWorkflow (branch+loop FSM)', 'mygov:MyGovWorkflow (context-gated FSM)', 'enreg:EnregWorkflow (25-state linear FSM)', 'rstax:RsTaxpayerWorker (independent, flat, identifier-only, no name search)', 'debtor:DebtorWorker (independent, flat, identifier-only, no name search)', 'napr/property-enreg:GenericWorkflow (no dedicated FSM — no spec exists for these)'],
    statuses: ['SEARCH_CONFIRMED', 'NO_RESULT_CONFIRMED', 'SUBMITTED_UNCONFIRMED', 'SUBMITTED_UNPARSED', 'SUBMIT_FAILED', 'AUTH_REQUIRED', 'SEARCH_CONTROL_NOT_FOUND', 'BLOCKED', 'WAITING_HUMAN', 'SKIPPED_HUMAN_VERIFICATION', 'WRONG_SEARCH_CONTEXT', 'FAILED'],
    traversalStatuses: ['NOT_STARTED', 'SEARCH_CONFIRMED', 'RESULTS_DISCOVERED', 'RESULTS_TRAVERSED', 'DOCUMENTS_TRAVERSED', 'SOURCE_EXHAUSTED', 'WAITING_HUMAN', 'SKIPPED_HUMAN_VERIFICATION', 'BLOCKED', 'AUTH_REQUIRED', 'SEARCH_CONTROL_NOT_FOUND', 'SUBMIT_FAILED', 'WRONG_SEARCH_CONTEXT', 'FAILED'],
    structuredTraversal: true,
    humanSessionControls: true,
    humanSessionSkip: true,
    // Local Playwright Chromium per job, with the bundled human-assist
    // extension. The human solves any challenge themselves in the real
    // preserved page; this worker neither solves nor bypasses one.
    browserRuntime: 'local-playwright-chromium',
    humanVerificationTransport: 'screenshot+action',
    evidenceValidation: true,
    evidenceLedger: true,
    entityQueue: true,
    hardSynthesisGateInvariants: ['canMarkTasMapExhausted', 'canMarkTasExhausted', 'canMarkMygovExhausted', 'canMarkEnregExhausted'],
    evidenceModel: 'v5-deterministic-fsm-architecture-2026-09-05',
  })
);

/*
 * GET /health/browser — bounded LOCAL Chromium smoke test.
 *
 * Launches Chromium with the exact production configuration (persistent
 * context, throwaway profile, bundled human-assist extension), confirms the
 * extension's MV3 service worker actually registered, opens a page, executes
 * JavaScript, then tears everything down including the profile directory.
 *
 * Returns sanitized booleans only — never a token, cookie, profile path,
 * extension storage or environment value. Unauthenticated like /health (it
 * discloses nothing), and the probe is cached briefly so it cannot be used to
 * spawn Chromium repeatedly.
 *
 * /health/browserless is kept ONLY as a deprecated alias for callers still
 * pointing at the old name. It performs the LOCAL check and never contacts
 * Browserless.
 */
const BROWSER_PROBE_TTL_MS = 60 * 1000;
let browserProbe: { at: number; ok: boolean; body: any } | null = null;

async function browserHealthHandler(_req: any, res: any) {
  if (browserProbe && Date.now() - browserProbe.at < BROWSER_PROBE_TTL_MS) {
    return res.status(browserProbe.ok ? 200 : 503).json({ ...browserProbe.body, cached: true });
  }
  const health = await localBrowserHealth();
  browserProbe = { at: Date.now(), ok: health.ok, body: health };
  return res.status(health.ok ? 200 : 503).json(health);
}

app.get('/health/browser', browserHealthHandler);
app.get('/health/browserless', (req: any, res: any) => {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Link', '</health/browser>; rel="successor-version"');
  return browserHealthHandler(req, res);
});

app.post('/research', auth, (req: any, res: any) => {
  const mode = req.body?.mode === 'property' ? 'property' : 'cadastral';
  const query = mode === 'cadastral' ? String(req.body?.query || '').trim().replace(/\s/g, '') : String(req.body?.query || '').trim();
  if (!query) return res.status(400).json({ error: 'query required' });
  const job = orchestrator.start(query, mode);
  res.status(202).json({ accepted: true, jobId: job.id, status: job.status });
});

app.get('/research/:id', auth, (req: any, res: any) => {
  const j = orchestrator.getJob(req.params.id);
  return j ? res.json(j) : res.status(404).json({ error: 'not found' });
});

// POST /research/enreg-entity — the closed-loop fix for a confirmed gap:
// a legal entity (developer/owner company) discovered by research-agent's
// own web research (OpenAI web_search, not this worker's own browser
// session) has no browser-retrieved document text for EntityQueue to scan,
// so the normal "auto-ENREG once every primary source finishes" path never
// sees it. This lets a caller directly request a single, real, deterministic
// ENREG lookup for a name/idCode found some other way — same EnregWorkflow
// FSM, same CAPTCHA WAITING_HUMAN/resume/skip lifecycle, polled the same way
// via GET /research/:id, as any other job.
app.post('/research/enreg-entity', auth, (req: any, res: any) => {
  const name = String(req.body?.name || '').trim();
  const idCode = req.body?.idCode ? String(req.body.idCode).trim() : null;
  if (!name && !idCode) return res.status(400).json({ error: 'name or idCode required' });
  const job = orchestrator.startEntity(name || idCode!, idCode);
  res.status(202).json({ accepted: true, jobId: job.id, status: job.status });
});

// POST /research/rstax-entity and /research/debtor-entity — the same
// closed-loop shape as /research/enreg-entity above, for the two new
// "FINANCIAL/COMPANY SOURCE EXPANSION" sources (RS Taxpayers Registry,
// MyGov Debtor Registry). Unlike ENREG, NEITHER source exposes a
// name-search field (confirmed live — see workflows/financial/selectors.ts),
// so idCode is REQUIRED here, not merely preferred: a caller with only a
// company/developer NAME and no national/company ID has nothing a real
// search on either registry could use, and must not silently probe a name
// into a TIN-only field. `name` is accepted only for the job's own
// query/display label.
app.post('/research/rstax-entity', auth, (req: any, res: any) => {
  const name = String(req.body?.name || '').trim();
  const idCode = req.body?.idCode ? String(req.body.idCode).trim() : null;
  if (!idCode) return res.status(400).json({ error: 'idCode required — RS Taxpayers Registry has no name-search field' });
  const job = orchestrator.startEntity(name || idCode, idCode, 'rstax');
  res.status(202).json({ accepted: true, jobId: job.id, status: job.status });
});

app.post('/research/debtor-entity', auth, (req: any, res: any) => {
  const name = String(req.body?.name || '').trim();
  const idCode = req.body?.idCode ? String(req.body.idCode).trim() : null;
  if (!idCode) return res.status(400).json({ error: 'idCode required — MyGov Debtor Registry has no name-search field' });
  const job = orchestrator.startEntity(name || idCode, idCode, 'debtor');
  res.status(202).json({ accepted: true, jobId: job.id, status: job.status });
});

// 2026-09-07 Verify mandate ("CAPTCHA UI: remove backend crop-to-bounding-
// box, use full Playwright viewport screenshot"): the previous version
// clipped the screenshot to the challenge element's own bounding box (plus
// a 40px pad), which repeatedly cropped real multi-tile/multi-step
// challenges (see msmap-recording.spec.ts / napr-recording.spec.ts — a real
// human-verification flow can involve a robot checkbox AND several
// subsequent tile-selection screens, not one small isolated widget) and
// forced the frontend to translate every click through an offsetX/offsetY
// correction that only existed because of this crop. Always returning the
// FULL viewport screenshot removes both problems at once: nothing is ever
// cropped out of view, and a click's page-relative coordinates are simply
// its coordinates (offsetX/offsetY stay 0, kept in the response only for
// backward compatibility with the existing frontend contract).
// Both handlers below are wrapped in try/catch (2026-09-07 Verify mandate,
// "hide internal selectors/errors/stack traces" + "a clean interactive
// panel, not a failure state"): Express 4 does not catch a rejected promise
// from an async route handler on its own — without this, a genuine
// Playwright error here (the page closed, navigated away mid-action, etc.)
// would either hang the request until the frontend's own timeout or, worse,
// let a raw error object with selector/call-log text reach the response.
// The customer-facing message is always the same short, generic sentence;
// the real error is logged server-side only, via console.error, for admin
// diagnosis — never forwarded to the client.
app.get('/research/:id/screenshot', auth, async (req: any, res: any) => {
  const s = orchestrator.getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'active human session not found' });
  try {
    const vp = s.page.viewportSize() || { width: 1440, height: 1000 };
    const img = await s.page.screenshot({ type: 'jpeg', quality: 85, fullPage: false });
    // humanAssist is a BOOLEAN capability flag, never a credential: it tells
    // the CAPTCHA UI whether the bundled extension is loaded AND a
    // Homatch-owned speech backend was configured for this job, so the UI
    // never claims assistance that is not actually available (fail-closed).
    res.json({ image: `data:image/jpeg;base64,${img.toString('base64')}`, width: vp.width, height: vp.height, offsetX: 0, offsetY: 0, cropped: false, url: s.page.url(), source: s.step.type === 'entity' ? s.step.source : s.step.key, captcha: true, humanAssist: !!s.jobBrowser?.humanAssistReady });
  } catch (e) {
    console.error(`[screenshot ${req.params.id}] ${String(e)}`);
    res.status(500).json({ error: 'could not load the verification screen right now — try again' });
  }
});

app.post('/research/:id/action', auth, async (req: any, res: any) => {
  const s = orchestrator.getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'active human session not found' });
  try {
    const x = Number(req.body.x) + Number(req.body.offsetX || 0);
    const y = Number(req.body.y) + Number(req.body.offsetY || 0);
    await s.page.mouse.click(x, y);
    await s.page.waitForTimeout(700);
    s.expires = Date.now() + 15 * 60 * 1000;
    res.json({ ok: true, captcha: !!(await challenge(s.page)), url: s.page.url() });
  } catch (e) {
    console.error(`[action ${req.params.id}] ${String(e)}`);
    res.status(500).json({ error: 'that action could not be completed — try refreshing the verification screen' });
  }
});

// NOTE: the Browserless live-view endpoints (POST/GET /research/:id/live)
// were removed with the Browserless runtime. Human CAPTCHA interaction is
// served by GET /research/:id/screenshot + POST /research/:id/action above,
// which drive the EXACT live local Chromium Page the job paused on — the
// same mechanism this repository used before Browserless (ae74a228).

/*
 * IDEMPOTENT HUMAN ACTIONS (production duplicate-skip defect).
 *
 * ONE customer click used to produce TWO calls to these endpoints: the
 * CAPTCHA modal called the worker directly, and the orchestrating
 * research-agent Edge Function then called it again for the same worker job.
 * The second call always lost the race — /skip returned 404 and /resume
 * returned 409 "CAPTCHA not completed" — and research-agent swallowed the
 * 404 with a comment calling it "a normal race".
 *
 * The frontend no longer double-calls (see ResearchCaptchaModal), but a
 * retry must be safe on its own: a network retry, a double click or a late
 * Edge retry now returns the state the FIRST call produced, with
 * `alreadyResolved: true`, instead of an error the customer would see.
 *
 * A genuine precondition failure — the challenge is still on screen — is
 * still a real 409, because that one the customer can actually act on.
 */
function humanActionResponse(res: any, jobId: string, r: any, extra: Record<string, unknown> = {}) {
  if (r.code === 'NOT_FOUND') return res.status(404).json({ error: r.error });
  if (r.code === 'NOT_READY' || (!r.ok && r.code !== 'ALREADY_RESOLVED')) {
    return res.status(409).json({ error: r.error });
  }
  return res.status(202).json({
    accepted: true,
    jobId,
    status: r.status || 'RUNNING',
    alreadyResolved: !!r.alreadyResolved,
    ...extra,
  });
}

app.post('/research/:id/resume', auth, async (req: any, res: any) => {
  const r = await orchestrator.resume(req.params.id);
  return humanActionResponse(res, req.params.id, r);
});

app.post('/research/:id/skip', auth, async (req: any, res: any) => {
  const r = await orchestrator.skip(req.params.id);
  return humanActionResponse(res, req.params.id, r, { skipped: r.source });
});

// ── MSMAP diagnostic capability — kept from the pre-refactor architecture
// for troubleshooting (this sandbox has never been able to reach ms.gov.ge
// itself, so this endpoint run on the DEPLOYED worker remains the only way
// to actually inspect that SPA's real DOM/network behavior when the
// production FSM reports an unexpected stop-state). Not part of the FSM —
// a raw diagnostic dump, unchanged in spirit from the original.
const ASSET_EXT = /\.(png|jpe?g|svg|gif|woff2?|ttf|css|ico|mp4)(\?|$)/i;
app.post('/debug/msmap', auth, async (req: any, res: any) => {
  const q = String(req.body?.query || '01.18.06.019.055.03.01.501').trim();
  let browser: any = null;
  try {
    browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--no-sandbox'] });
    const ctx = await browser.newContext({ locale: 'ka-GE', viewport: { width: 1440, height: 1000 } });
    const p = await ctx.newPage();
    await p.goto('https://ms.gov.ge/msmap/#C=44.7433554-41.7850526@Z=19', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await p.waitForTimeout(2500);
    try {
      await p.waitForLoadState('networkidle', { timeout: 8000 });
    } catch {
      /* SPA can take longer than networkidle allows */
    }
    const beforeShot = (await p.screenshot({ type: 'png' })).toString('base64');
    const candidates = await scanCandidateInputs(p);
    let searchAttempt: any = { attempted: false };
    const target = p.locator('input[name="searchText"]').first();
    if (await visible(target)) {
      await target.fill(q);
      await p.waitForTimeout(300);
      const filledVal = ((await target.inputValue().catch(() => '')) as string).trim();
      let clickedSel: string | null = null;
      for (const sel of ['button[class*="search" i]', '[class*="search-icon" i]', 'i[class*="search" i]', '[aria-label*="ძებნა" i]', '[title*="ძებნა" i]', '[aria-label*="search" i]']) {
        const icon = p.locator(sel).first();
        if (await visible(icon)) {
          try {
            await icon.click({ timeout: 3000 });
            clickedSel = sel;
            break;
          } catch {
            /* try the next candidate icon */
          }
        }
      }
      if (!clickedSel) await target.press('Enter').catch(() => {});
      await p.waitForTimeout(3500);
      searchAttempt = { attempted: true, filledValueVerified: filledVal.replace(/\s/g, '') === q.replace(/\s/g, ''), submitMethod: clickedSel ? `CLICK ${clickedSel}` : 'ENTER_KEY' };
    }
    const afterShot = (await p.screenshot({ type: 'png' })).toString('base64');
    await ctx.close();
    const id = randomUUID();
    debugJobs.set(id, { beforeShot, afterShot, createdAt: new Date().toISOString() });
    res.json({ id, query: q, candidates, searchAttempt, screenshotUrls: { before: `/debug/${id}/screenshot?which=before`, after: `/debug/${id}/screenshot?which=after` } });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  } finally {
    await browser?.close().catch(() => {});
  }
});

app.get('/debug/:id/screenshot', auth, (req: any, res: any) => {
  const d = debugJobs.get(req.params.id);
  if (!d) return res.status(404).json({ error: 'not found' });
  const which = req.query.which;
  const b64 = which === 'after' ? d.afterShot : d.beforeShot;
  if (!b64) return res.status(404).json({ error: 'no screenshot for that stage on this job' });
  res.setHeader('Content-Type', 'image/png');
  res.send(Buffer.from(b64, 'base64'));
});

installProcessCleanup();

/*
 * CRASH VISIBILITY — production incident 2026-09-08.
 *
 * Deployments from 1ac14835 onward produced containers that printed NOTHING:
 * Railway logged "Starting Container" and then nothing at all while the
 * healthcheck failed for its full window. A worker must always be able to say
 * why it died, so both fatal paths are made loud here.
 *
 * The two handlers deliberately behave DIFFERENTLY:
 *
 *   - unhandledRejection is logged and SURVIVED. A rejected promise from one
 *     Verify job (a government site that vanished mid-navigation, a closed
 *     page) must never take the whole worker — and with it every other
 *     customer's in-flight job — down. This is the specific reason the
 *     short-lived src/boot.ts shim (which called process.exit(1) here) is not
 *     the production startup path.
 *   - uncaughtException leaves the process in an undefined state, so the
 *     browsers and their throwaway profiles are torn down and the process
 *     exits for Railway to restart. Exiting without that cleanup would leak a
 *     Chromium process and a profile directory per in-flight job.
 *
 * Messages are redacted before logging: an error thrown from deep in a
 * workflow can carry a URL with a query string.
 */
process.on('unhandledRejection', (reason: unknown) => {
  logBrowserLifecycle('unhandled_rejection', { error: redactSecrets(reason) });
});
process.on('uncaughtException', (error: unknown) => {
  logBrowserLifecycle('uncaught_exception', {
    name: String((error as any)?.name || 'Error').slice(0, 80),
    error: redactSecrets(error),
  });
  closeAllJobBrowsers('uncaught_exception')
    .catch(() => {})
    .finally(() => process.exit(1));
});

/*
 * GEORGIAN RECOGNITION RIDES ON THIS SERVER, NOT A SECOND ONE.
 *
 * app.listen returns the http.Server, which is what a WebSocket upgrade
 * needs. Standing up another service for one socket would mean a second
 * deployment, a second health check and a second place for the Google
 * credential to live, for no gain — the worker is already here, already
 * deployed from this repository, and already holds the credential.
 *
 * The gateway reports whether it can actually serve rather than whether it
 * was deployed: this image runs as two Railway services and only one of them
 * has Google credentials. /health says which.
 */
/**
 * Prove the whole speech chain, against the deployed thing, on demand.
 *
 * WHY THIS IS NOT BEHIND THE WORKER SECRET
 *
 * Everything that authorises this already lives inside the process. The
 * request carries no input: no audio, no language, no configuration. It plays
 * a fixed six-second clip that is checked into the repository and returns a
 * transcript of a sentence whose text is also checked into the repository.
 * There is nothing here an anonymous caller learns that they could not learn
 * by reading the source.
 *
 * What an anonymous caller could do is spend money, so that is what is
 * bounded: one run at a time, and not more than one a minute, process-wide.
 * At Google's streaming rate a minute's worth of six-second clips is a
 * rounding error, and the ceiling does not move if somebody holds the button
 * down.
 *
 * It is a GET because it is a diagnostic an operator should be able to reach
 * from a browser address bar at three in the morning.
 */
/**
 * Which regions will serve the configured model, asked rather than assumed.
 *
 * Separate from the self-test above and deliberately weaker: this proves a
 * configuration is IMPLEMENTED somewhere, not that recognition works. The
 * difference is the whole reason the previous green light was wrong.
 *
 * Same rate limit and same reasoning: no input is accepted beyond an optional
 * model name, the region list is an allow-list in source, and each entry costs
 * one short connection with no audio.
 */
/**
 * The shape of the speech configuration, without any of its values.
 *
 * Every region answered "Invalid resource field value in the request" for a
 * recognizer path built as projects/<id>/locations/<region>/recognizers/_.
 * Three things go into that path and only one of them was ever visible
 * anywhere, so this reports the other two the way a diagnostic should: by
 * shape and by agreement, never by value.
 *
 * The commonest cause of this error is the oldest one -- the project the
 * service account belongs to is not the project the request names -- and that
 * is answerable without printing either, by comparing them.
 */
app.get('/health/speech-config', (_q: any, r: any) => {
  const declared = (process.env.GOOGLE_SPEECH_PROJECT_ID || '').trim();
  let credentialProject = '';
  let credentialEmailDomain = '';
  let parsed = false;
  try {
    const c = JSON.parse(process.env.GOOGLE_SPEECH_CREDENTIALS_JSON || '{}');
    parsed = true;
    credentialProject = String(c.project_id ?? '');
    // The domain only: it names the project, which is the thing in question.
    // The local part identifies the account and is not needed to answer this.
    credentialEmailDomain = String(c.client_email ?? '').split('@')[1] ?? '';
  } catch { /* reported as parsed:false */ }

  return r.json({
    credentialsParse: parsed,
    // Shapes, not values.
    declaredProjectIdLength: declared.length,
    declaredLooksLikeProjectId: /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(declared),
    declaredLooksLikeProjectNumber: /^[0-9]{6,20}$/.test(declared),
    credentialProjectIdLength: credentialProject.length,
    // The one comparison that matters, as a yes or a no.
    declaredMatchesCredential: Boolean(declared) && declared === credentialProject,
    credentialEmailDomain,
    region: (process.env.GOOGLE_SPEECH_REGION || '').trim().toLowerCase(),
    model: process.env.GOOGLE_SPEECH_MODEL || 'chirp_3',
    language: process.env.GOOGLE_SPEECH_LANGUAGE || 'ka-GE',
    recognizerPathShape: `projects/<${declared.length} chars>/locations/${(process.env.GOOGLE_SPEECH_REGION || '').trim().toLowerCase()}/recognizers/_`,
  });
});

/**
 * Which recognizer path StreamingRecognize will take, asked three ways.
 *
 * Same ceiling and same reasoning as the other two probes: no input, a fixed
 * one-second slice of the checked-in fixture for the unary attempt, and
 * nothing created in anybody's cloud project. What to create, if anything, is
 * a decision for whoever reads the answer.
 */
let recognizerProbeLastAt = 0;

app.get('/health/speech-recognizer', async (_q: any, r: any) => {
  const since = Date.now() - recognizerProbeLastAt;
  if (since < SELFTEST_MIN_GAP_MS) {
    return r.status(429).json({ ok: false, reason: 'RATE_LIMITED', retryAfterMs: SELFTEST_MIN_GAP_MS - since });
  }
  recognizerProbeLastAt = Date.now();

  const projectId = (process.env.GOOGLE_SPEECH_PROJECT_ID || '').trim();
  const credsRaw = process.env.GOOGLE_SPEECH_CREDENTIALS_JSON || '';
  if (!projectId || !credsRaw) return r.status(503).json({ ok: false, reason: 'GOOGLE_SPEECH_NOT_CONFIGURED' });

  let credentials: Record<string, unknown>;
  try { credentials = JSON.parse(credsRaw); } catch { return r.status(503).json({ ok: false, reason: 'CREDENTIALS_UNPARSEABLE' }); }

  const sampleRate = Number(process.env.GOOGLE_SPEECH_SAMPLE_RATE || 16000);
  let audio: Buffer;
  try {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const path = fileURLToPath(new URL('./speech/fixtures/ka-selftest.pcm', import.meta.url));
    // One second is plenty to find out whether the request is accepted.
    audio = readFileSync(path).subarray(0, sampleRate * 2);
  } catch {
    return r.status(503).json({ ok: false, reason: 'FIXTURE_MISSING' });
  }

  const out = await probeRecognizers({
    projectId, credentials,
    region: (process.env.GOOGLE_SPEECH_REGION || '').trim().toLowerCase(),
    model: process.env.GOOGLE_SPEECH_MODEL || 'chirp_3',
    language: process.env.GOOGLE_SPEECH_LANGUAGE || 'ka-GE',
    sampleRate, audio,
  });
  console.log(JSON.stringify({ at: new Date().toISOString(), service: 'speech', event: 'recognizer_probe', attempts: out.attempts.map((a) => ({ name: a.name, ok: a.ok, code: a.code })) }));
  return r.json(out);
});

/**
 * Which language configurations this project can actually stream with.
 *
 * Same ceiling and same reasoning as the other probes: no caller input, a
 * fixed second of the checked-in clip, and nothing created anywhere. It
 * answers the one question that has been answered wrong four times on this
 * integration by reasoning instead of asking.
 */
let languageProbeLastAt = 0;

app.get('/health/speech-languages', async (_q: any, r: any) => {
  const since = Date.now() - languageProbeLastAt;
  if (since < SELFTEST_MIN_GAP_MS) {
    return r.status(429).json({ ok: false, reason: 'RATE_LIMITED', retryAfterMs: SELFTEST_MIN_GAP_MS - since });
  }
  languageProbeLastAt = Date.now();

  const cfg = speechConfigFromEnv();
  const credsRaw = process.env.GOOGLE_SPEECH_CREDENTIALS_JSON || '';
  if (!cfg || !credsRaw) return r.status(503).json({ ok: false, reason: 'GOOGLE_SPEECH_NOT_CONFIGURED' });

  let credentials: Record<string, unknown>;
  try { credentials = JSON.parse(credsRaw); } catch { return r.status(503).json({ ok: false, reason: 'CREDENTIALS_UNPARSEABLE' }); }

  let audio: Buffer;
  try {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    audio = readFileSync(fileURLToPath(new URL('./speech/fixtures/ka-selftest.pcm', import.meta.url)))
      .subarray(0, cfg.sampleRate * 2);
  } catch {
    return r.status(503).json({ ok: false, reason: 'FIXTURE_MISSING' });
  }

  const out = await probeLanguageConfigs({
    projectId: cfg.projectId, credentials, region: cfg.region,
    sampleRate: cfg.sampleRate, audio,
    primary: cfg.languageCode, candidates: cfg.languageCodes,
  });
  console.log(JSON.stringify({
    at: new Date().toISOString(), service: 'speech', event: 'language_probe',
    multiLanguageModel: out.multiLanguageModel,
    accepted: out.attempts.filter((a) => a.accepted).map((a) => a.name),
  }));
  return r.json(out);
});

let regionProbeLastAt = 0;

app.get('/health/speech-regions', async (q: any, r: any) => {
  const since = Date.now() - regionProbeLastAt;
  if (since < SELFTEST_MIN_GAP_MS) {
    return r.status(429).json({ ok: false, reason: 'RATE_LIMITED', retryAfterMs: SELFTEST_MIN_GAP_MS - since });
  }
  regionProbeLastAt = Date.now();

  const projectId = process.env.GOOGLE_SPEECH_PROJECT_ID || '';
  const credentialsJson = process.env.GOOGLE_SPEECH_CREDENTIALS_JSON || '';
  if (!projectId || !credentialsJson) {
    return r.status(503).json({ ok: false, reason: 'GOOGLE_SPEECH_NOT_CONFIGURED' });
  }

  // A model name only, bounded and pattern-checked. Everything else about the
  // request is fixed in source.
  const asked = String(q.query?.model ?? '').slice(0, 40);
  const model = /^[a-z0-9_]+$/.test(asked) ? asked : (process.env.GOOGLE_SPEECH_MODEL || 'chirp_3');

  const sampleRate = Number(process.env.GOOGLE_SPEECH_SAMPLE_RATE || 16000);
  let audio: Buffer;
  try {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    // A second of the checked-in Georgian, enough for a region to answer.
    audio = readFileSync(fileURLToPath(new URL('./speech/fixtures/ka-selftest.pcm', import.meta.url)))
      .subarray(0, sampleRate * 2);
  } catch {
    return r.status(503).json({ ok: false, reason: 'FIXTURE_MISSING' });
  }

  const out = await probeRegions({
    projectId, credentialsJson, model,
    language: process.env.GOOGLE_SPEECH_LANGUAGE || 'ka-GE',
    sampleRate, audio,
  });
  console.log(JSON.stringify({
    at: new Date().toISOString(), service: 'speech', event: 'region_probe',
    model: out.model, firstWorking: out.firstWorking,
  }));
  return r.json(out);
});

const SELFTEST_MIN_GAP_MS = 60_000;
let selfTestLastAt = 0;
let selfTestRunning = false;

app.get('/health/speech-selftest', async (_q: any, r: any) => {
  if (selfTestRunning) {
    return r.status(429).json({ ok: false, reason: 'ALREADY_RUNNING' });
  }
  const since = Date.now() - selfTestLastAt;
  if (since < SELFTEST_MIN_GAP_MS) {
    return r.status(429).json({
      ok: false, reason: 'RATE_LIMITED',
      retryAfterMs: SELFTEST_MIN_GAP_MS - since,
    });
  }

  selfTestRunning = true;
  selfTestLastAt = Date.now();
  try {
    const report = await runSpeechSelfTest(PORT, { token: TOKEN });
    // What the provider actually said, beside what the chain actually did.
    // The first run of this returned a bucketed word and the real answer was
    // only ever in a log stream that would not come back.
    const cfg = speechConfigFromEnv();
    const enriched = {
      ...report,
      providerError: lastRecogniserError(),
      config: cfg ? { region: cfg.region, model: cfg.model, sampleRate: cfg.sampleRate, language: cfg.languageCode } : null,
    };
    console.log(JSON.stringify({
      at: new Date().toISOString(), service: 'speech', event: 'selftest',
      ok: report.ok, reason: report.reason,
      interims: report.interimCount, timings: report.timings,
      // The transcript is the assistant's own scripted line, not a visitor's
      // speech, so it is safe to log and is the only thing worth reading here.
      final: report.finalText,
    }));
    return r.json(enriched);
  } catch (e: any) {
    return r.status(500).json({ ok: false, reason: 'SELFTEST_THREW', detail: String(e?.message ?? e).slice(0, 200) });
  } finally {
    selfTestRunning = false;
  }
});

const server = app.listen(PORT, '0.0.0.0', () =>
  console.log(`homatch-official-worker 2.0.0 (deterministic FSM architecture) listening on ${PORT}`));

speechStatus = attachSpeechGateway(server, { token: TOKEN });
export const speech = speechStatus;
console.log(JSON.stringify({
  at: new Date().toISOString(), service: 'speech', event: 'gateway',
  available: speech.available, reason: speech.reason,
  model: speech.model, language: speech.language,
}));
