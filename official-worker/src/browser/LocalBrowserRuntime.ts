// LocalBrowserRuntime.ts — the Verify browser transport.
//
// MIGRATION 2026-09-08: this replaces BrowserlessRuntime.ts and restores the
// architecture this repository ran BEFORE Browserless was introduced in
// e109bce3 ("Add Browserless real-browser human handoff runtime"). The
// pre-Browserless baseline is ae74a228 ("Fix ENREG CAPTCHA pause and
// same-session resume"), where ResearchOrchestrator ran
//
//     chromium.launch({ headless: false, args: ['--disable-dev-shm-usage', '--no-sandbox'] })
//
// once per job, under `xvfb-run -a npm start` in the image, with each source
// getting its own context/page and the human CAPTCHA flow exposed through
// GET /research/:id/screenshot + POST /research/:id/action against the exact
// live Page. That transport is restored here; everything built since
// (workers, evidence, entity research, verdict, report, UI) is untouched.
//
// ONE DELIBERATE CHANGE from ae74a228: a Chromium extension must always be
// enabled, and extensions can only be loaded into a PERSISTENT context. So a
// job gets one `launchPersistentContext()` with its own throwaway profile
// directory instead of `launch()` + per-source contexts. Ownership is the
// model the current orchestrator already uses and that production has
// exercised: the job owns the context, each source owns only its Page.
import { chromium } from 'playwright';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Bundled, reviewed, in-repository extension. Never a developer profile,
 * never the Chrome Web Store, never a runtime download. */
// Resolved from this module's own location, so it is identical in the repo
// and in the image regardless of the working directory. (path.dirname of the
// module file, not `new URL(...)`: tsconfig.test.json's minimal URL shim
// cannot model the URL constructor.)
export const BUNDLED_EXTENSION_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../extensions/human-assist'
);

/** Structured, secret-free lifecycle diagnostics. Every field is a safe id,
 * count or boolean — never a token, a profile path, a cookie, or extension
 * storage. (Moved verbatim in spirit from BrowserlessRuntime so existing log
 * consumers keep working; the scope name is now transport-neutral.) */
export function logBrowserLifecycle(event: string, fields: Record<string, unknown> = {}): void {
  try {
    console.log(JSON.stringify({ at: new Date().toISOString(), scope: 'browser_lifecycle', event, ...fields }));
  } catch {
    // Diagnostics must never be able to break the research flow.
  }
}

/**
 * Strips credential-bearing fragments out of an arbitrary error message
 * before it reaches a log line. Same rules ResearchOrchestrator applies to
 * job failures: URL query strings (a token can ride on one) and common
 * key/value credential forms.
 */
export function redactSecrets(message: unknown, max = 300): string {
  return String((message as any)?.message ?? message ?? '')
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s?#]+)\?[^\s#]*/gi, '$1?[REDACTED]')
    .replace(/\b(token|access_token|api[_-]?key|authorization|bearer|secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, max);
}

export interface BundledExtensionStatus {
  /** The directory exists and holds a readable manifest.json. */
  present: boolean;
  /** manifest_version === 3. */
  manifestV3: boolean;
  name: string | null;
  /** Declared MV3 background service worker, if any. */
  declaresServiceWorker: boolean;
  reason: string;
}

/**
 * Validates the bundled extension as ASSETS ON DISK. Never throws — a broken
 * or absent extension is reported, not fatal, because a research job failing
 * outright would be a far worse regression than running without the
 * human-assist icon. The status is surfaced by /health/browser and logged on
 * every launch, so a missing extension can never be silently ignored.
 */
export async function validateBundledExtension(dir: string = BUNDLED_EXTENSION_DIR): Promise<BundledExtensionStatus> {
  const absent = (reason: string): BundledExtensionStatus => ({
    present: false,
    manifestV3: false,
    name: null,
    declaresServiceWorker: false,
    reason,
  });

  try {
    const dirStat = await stat(dir);
    if (!dirStat.isDirectory()) return absent('not_a_directory');
  } catch {
    return absent('directory_missing');
  }

  let manifest: any;
  try {
    manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
  } catch {
    return absent('manifest_unreadable');
  }

  const manifestV3 = Number(manifest?.manifest_version) === 3;
  const declaresServiceWorker = !!manifest?.background?.service_worker;
  return {
    present: true,
    manifestV3,
    name: typeof manifest?.name === 'string' ? manifest.name : null,
    declaresServiceWorker,
    reason: manifestV3 ? 'ok' : 'manifest_version_not_3',
  };
}

/** The two Chromium switches that load exactly one unpacked extension and
 * forbid every other one. Both must name the same absolute path. */
export function extensionLaunchArgs(dir: string = BUNDLED_EXTENSION_DIR): string[] {
  return [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`];
}

/* ============================================================== *
 * HUMAN-ASSIST BACKEND CONFIGURATION
 *
 * The bundled extension supports several speech backends. The upstream
 * package shipped its author's own default keys inside secrets.txt; that file
 * is deliberately NOT redistributed (see
 * scripts/sanitize-human-assist-extension.mjs), so Homatch configures a
 * backend IT owns instead.
 *
 * The credential is read from the environment server-side, written straight
 * into the extension's own chrome.storage.local for that job's throwaway
 * profile, and never leaves this process: not logged, not serialized into any
 * job document, not returned by /health, not sent to the frontend, never in a
 * URL. The profile - and with it the stored value - is deleted when the job
 * ends.
 *
 * Homatch implements no CAPTCHA solving. It only sets the extension's own
 * supported options; a human must still click the extension's control.
 * ============================================================== */

export type HumanAssistService = 'googleSpeechApi' | 'ibmSpeechApi' | 'microsoftSpeechApi';

export interface HumanAssistConfig {
  configured: boolean;
  service: HumanAssistService | null;
  /** Exactly the keys the extension itself reads. Values are secret. */
  storage: Record<string, string>;
  reason: string;
}

/**
 * Builds the extension's supported storage payload from the environment.
 * Returns configured:false (never throws, never partially applies) when the
 * credential is absent or the selected backend is missing a required field.
 */
export function humanAssistConfig(env: Record<string, string | undefined> = process.env): HumanAssistConfig {
  const key = String(env.HUMAN_ASSIST_SPEECH_API_KEY || '').trim();
  const requested = String(env.HUMAN_ASSIST_SPEECH_SERVICE || 'googleSpeechApi').trim() as HumanAssistService;
  const none = (reason: string): HumanAssistConfig => ({ configured: false, service: null, storage: {}, reason });

  if (!key) return none('missing_api_key');
  if (!['googleSpeechApi', 'ibmSpeechApi', 'microsoftSpeechApi'].includes(requested)) {
    return none('unsupported_service');
  }

  if (requested === 'googleSpeechApi') {
    return { configured: true, service: requested, storage: { speechService: requested, googleSpeechApiKey: key }, reason: 'ok' };
  }
  if (requested === 'microsoftSpeechApi') {
    const region = String(env.HUMAN_ASSIST_SPEECH_REGION || '').trim();
    if (!region) return none('missing_region');
    return {
      configured: true,
      service: requested,
      storage: { speechService: requested, microsoftSpeechApiKey: key, microsoftSpeechApiLoc: region },
      reason: 'ok',
    };
  }
  const url = String(env.HUMAN_ASSIST_SPEECH_URL || '').trim();
  if (!url) return none('missing_service_url');
  return {
    configured: true,
    service: requested,
    storage: { speechService: requested, ibmSpeechApiKey: key, ibmSpeechApiUrl: url },
    reason: 'ok',
  };
}

/**
 * Writes the configuration into the extension's own chrome.storage.local via
 * its service worker, then reads back ONLY the non-secret `speechService`
 * field to confirm it stuck. The credential itself is never read back, never
 * logged, and never returned.
 */
export async function applyHumanAssistConfig(
  context: any,
  config: HumanAssistConfig,
  attempts = 5,
  settleMs = 250
): Promise<boolean> {
  if (!config.configured) return false;
  const settle = () => new Promise((resolve) => setTimeout(resolve, settleMs));

  /*
   * WHY THIS RETRIES, RE-ACQUIRES THE WORKER, AND RE-CONFIRMS.
   *
   * Two real defects were found on 2026-09-08 by the real-Chromium proof in
   * test/chromiumSmoke.test.mjs, both of which made humanAssistReady
   * INTERMITTENT on identical inputs — the boolean the CAPTCHA UI trusts to
   * decide whether to promise the customer assistance:
   *
   *  1. A Manifest V3 service worker is not a stable object. Chromium starts,
   *     stops and recycles it on its own schedule, so `worker.evaluate()` can
   *     legitimately throw ("target closed") at any moment. The previous
   *     implementation held a single worker handle with ONE try/catch around
   *     the whole operation, so a single recycle — routine, not exceptional —
   *     returned false immediately and permanently. That reproduced reliably
   *     as soon as another Chromium had run in the same process just before.
   *     Every attempt therefore re-reads context.serviceWorkers() and catches
   *     its own failure.
   *
   *  2. confirmExtensionRuntime() returns as soon as the worker OBJECT
   *     exists, which is earlier than the extension finishing initialization
   *     of its OWN option storage. Our write could land first and then be
   *     overwritten by the extension's defaults. So each attempt writes, lets
   *     the extension settle, reads back, and then requires the value to
   *     STILL be ours on a second confirmation.
   *
   * Everything is bounded (attempts x 2 x settleMs). A genuine failure
   * returns false rather than throwing: research must still run without the
   * assist icon, and the UI must fail closed rather than promise help that
   * is not there.
   */
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      let workers = context.serviceWorkers?.() || [];
      if (!workers.length) {
        await context.waitForEvent('serviceworker', { timeout: 5000 });
        workers = context.serviceWorkers?.() || [];
      }
      const worker = workers[0];
      if (!worker) {
        await settle();
        continue;
      }

      // Reads back ONLY the non-secret service name. The credential itself is
      // never returned out of the browser, here or anywhere else.
      const readService = () =>
        worker.evaluate(async () => {
          const v = await (globalThis as any).chrome.storage.local.get('speechService');
          return v?.speechService ?? null;
        });

      await worker.evaluate(
        (storage: Record<string, string>) => (globalThis as any).chrome.storage.local.set(storage),
        config.storage
      );
      await settle();
      if ((await readService()) !== config.service) continue;
      // Confirm it STAYS ours: a late initialization would clobber it here.
      await settle();
      if ((await readService()) === config.service) return true;
    } catch {
      // A recycled service worker is normal, not fatal — try again with a
      // freshly acquired handle.
      await settle().catch(() => {});
    }
  }
  return false;
}

/**
 * One Verify job's browser: a persistent Chromium context with its own
 * throwaway profile. `context` is what sources open Pages on; there is no
 * separate Browser object to confuse ownership with.
 */
export interface JobBrowser {
  jobId: string;
  context: any;
  userDataDir: string;
  extension: BundledExtensionStatus;
  /** True once Chromium confirmed an extension service worker — see
   * confirmExtensionRuntime(). Never assumed from the launch flags. */
  extensionRuntimeConfirmed: boolean;
  /** True only when the extension is running AND its backend was configured
   * with a Homatch-owned credential for this job. Drives humanAssistReady. */
  humanAssistReady: boolean;
  closed: boolean;
}

/** Every live job browser, so process signals can never leave a zombie
 * Chromium or an orphaned profile directory behind. */
const OPEN_JOB_BROWSERS = new Set<JobBrowser>();

export function openJobBrowserCount(): number {
  return OPEN_JOB_BROWSERS.size;
}

const HEADED = String(process.env.VERIFY_BROWSER_HEADLESS || '').trim() !== '1';

/**
 * Launches one isolated local Chromium for a job.
 *
 * Headed by default (the image runs `xvfb-run -a npm start`, exactly as the
 * pre-Browserless production did): Chromium loads unpacked extensions
 * reliably in headed mode, and the human CAPTCHA flow drives a real rendered
 * page. VERIFY_BROWSER_HEADLESS=1 exists only for constrained CI.
 */
export async function launchJobBrowser(jobId: string): Promise<JobBrowser> {
  const extension = await validateBundledExtension();
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'homatch-verify-'));

  const args = ['--disable-dev-shm-usage', '--no-sandbox'];
  if (extension.present && extension.manifestV3) {
    args.push(...extensionLaunchArgs());
  } else {
    // Loud and structured: a missing bundled extension must be visible in
    // production logs and in /health/browser, never silently tolerated.
    logBrowserLifecycle('human_assist_extension_unavailable', { jobId, reason: extension.reason });
  }

  let context: any;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: !HEADED,
      args,
      locale: 'ka-GE',
      acceptDownloads: true,
      viewport: { width: 1440, height: 1000 },
    });
  } catch (e) {
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    throw e;
  }

  const jobBrowser: JobBrowser = {
    jobId,
    context,
    userDataDir,
    extension,
    extensionRuntimeConfirmed: false,
    humanAssistReady: false,
    closed: false,
  };
  OPEN_JOB_BROWSERS.add(jobBrowser);

  if (extension.present && extension.manifestV3) {
    jobBrowser.extensionRuntimeConfirmed = await confirmExtensionRuntime(context);
    if (jobBrowser.extensionRuntimeConfirmed) {
      const assist = humanAssistConfig();
      jobBrowser.humanAssistReady = await applyHumanAssistConfig(context, assist);
      // Service name and outcome only - never the credential.
      logBrowserLifecycle('human_assist_configured', {
        jobId,
        ready: jobBrowser.humanAssistReady,
        service: assist.service,
        reason: jobBrowser.humanAssistReady ? 'ok' : assist.reason,
      });
    }
  }

  logBrowserLifecycle('job_browser_launched', {
    jobId,
    headed: HEADED,
    extensionPresent: extension.present,
    extensionManifestV3: extension.manifestV3,
    extensionRuntimeConfirmed: jobBrowser.extensionRuntimeConfirmed,
    humanAssistReady: jobBrowser.humanAssistReady,
    openJobBrowsers: OPEN_JOB_BROWSERS.size,
  });
  return jobBrowser;
}

/**
 * Proves the extension is actually RUNNING, not merely requested on the
 * command line: an MV3 extension registers a service worker in the context.
 * Waits briefly because registration is asynchronous after launch.
 */
export async function confirmExtensionRuntime(context: any, timeoutMs = 5000): Promise<boolean> {
  try {
    if ((context.serviceWorkers?.() || []).length > 0) return true;
    await context.waitForEvent('serviceworker', { timeout: timeoutMs });
    return (context.serviceWorkers?.() || []).length > 0;
  } catch {
    return false;
  }
}

/** The context sources open their Pages on. Kept as a function so every call
 * site reads the same way it did through the previous transport. */
export function jobContext(jobBrowser: JobBrowser): any {
  return jobBrowser.context;
}

/** Whether the job's Chromium is still usable. */
export function isJobBrowserAlive(jobBrowser: JobBrowser | null | undefined): boolean {
  if (!jobBrowser || jobBrowser.closed) return false;
  try {
    const browser = jobBrowser.context.browser?.();
    if (browser && typeof browser.isConnected === 'function' && !browser.isConnected()) return false;
    jobBrowser.context.pages();
    return true;
  } catch {
    return false;
  }
}

/**
 * Terminal cleanup: closes the context exactly once and removes the
 * throwaway profile directory. Idempotent — a TTL sweep, a job-complete path
 * and a process signal may all call it for the same job.
 */
export async function closeJobBrowser(jobBrowser: JobBrowser | null | undefined, reason: string): Promise<void> {
  if (!jobBrowser || jobBrowser.closed) return;
  jobBrowser.closed = true;
  OPEN_JOB_BROWSERS.delete(jobBrowser);

  await jobBrowser.context.close().catch(() => {});
  await rm(jobBrowser.userDataDir, { recursive: true, force: true }).catch(() => {});

  logBrowserLifecycle('job_browser_closed', {
    jobId: jobBrowser.jobId,
    reason,
    profileRemoved: true,
    openJobBrowsers: OPEN_JOB_BROWSERS.size,
  });
}

/** Best-effort teardown of everything still open — process signals only. */
export async function closeAllJobBrowsers(reason: string): Promise<void> {
  for (const jobBrowser of [...OPEN_JOB_BROWSERS]) {
    await closeJobBrowser(jobBrowser, reason);
  }
}

let signalsInstalled = false;
/** Installs SIGINT/SIGTERM handlers so a container stop cannot leave zombie
 * Chromium processes or orphaned profile directories behind. */
export function installProcessCleanup(): void {
  if (signalsInstalled) return;
  signalsInstalled = true;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      closeAllJobBrowsers(`signal_${signal}`)
        .catch(() => {})
        .finally(() => process.exit(0));
    });
  }
}

export interface LocalBrowserHealth {
  ok: boolean;
  headed: boolean;
  extensionPresent: boolean;
  extensionManifestV3: boolean;
  extensionRuntimeConfirmed: boolean;
  /** Fail-closed: false whenever the extension is missing OR no Homatch-owned
   * backend credential is configured. Never accompanied by the credential. */
  humanAssistReady: boolean;
  pageOpened: boolean;
  scriptExecuted: boolean;
  error?: string;
}

/**
 * Bounded local Chromium smoke test for GET /health/browser: launch with the
 * production configuration, load the bundled extension, confirm its runtime,
 * open a page, execute JavaScript, then tear everything down including the
 * profile directory.
 *
 * Returns sanitized booleans only — never a profile path, a cookie, extension
 * storage, an environment value or a credential.
 */
export async function localBrowserHealth(): Promise<LocalBrowserHealth> {
  let jobBrowser: JobBrowser | null = null;
  try {
    jobBrowser = await launchJobBrowser('health');
    const page = await jobBrowser.context.newPage();
    const scriptExecuted = (await page.evaluate(() => 6 * 7)) === 42;
    await page.close().catch(() => {});
    return {
      ok: true,
      headed: HEADED,
      extensionPresent: jobBrowser.extension.present,
      extensionManifestV3: jobBrowser.extension.manifestV3,
      extensionRuntimeConfirmed: jobBrowser.extensionRuntimeConfirmed,
      humanAssistReady: jobBrowser.humanAssistReady,
      pageOpened: true,
      scriptExecuted,
    };
  } catch (e) {
    // Server-side only: the message can name local paths.
    console.error(`[browser-health] ${String(e)}`);
    return {
      ok: false,
      headed: HEADED,
      extensionPresent: false,
      extensionManifestV3: false,
      extensionRuntimeConfirmed: false,
      humanAssistReady: false,
      pageOpened: false,
      scriptExecuted: false,
      error: 'local_browser_unavailable',
    };
  } finally {
    await closeJobBrowser(jobBrowser, 'health_probe');
  }
}
