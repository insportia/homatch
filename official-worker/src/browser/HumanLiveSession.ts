// HumanLiveSession.ts — the WAITING_HUMAN interactive live-browser lifecycle.
//
// GAP THIS CLOSES: BrowserlessRuntime.ts has exported createHumanLiveURL()
// (Browserless.liveURL, interactable: true) and closeHumanLiveURL() all
// along, but a whole-source search proved neither had ANY production call
// site. A job could therefore reach WAITING_HUMAN, preserve a perfectly good
// browser/context/page, and still give the human no way to actually reach
// that page — the CAPTCHA could only ever be looked at through the
// screenshot/click endpoints, never interacted with directly in the real
// Browserless session.
//
// HARD INVARIANTS, in order of importance:
//  1. The live view is opened on the EXACT page it is handed. This module
//     never launches a browser, never creates a context, never opens a page,
//     and never reconnects — it has no imports capable of doing so. That is
//     what keeps the human's cookies/session/challenge state intact, and it
//     is why the reconnect fix (BrowserlessRecovery.ts) is untouched here.
//  2. It solves nothing. Browserless.liveURL streams the real page to the
//     real human, who completes the challenge themselves. No solver, no
//     bypass, no automated interaction with the challenge.
//  3. It is best-effort in BOTH directions. A live view that cannot be
//     created, or cannot be closed, must never take the preserved human
//     session down with it, and must never turn into evidence about the
//     property — the job simply stays WAITING_HUMAN with interactive:false.
import {
  createHumanLiveURL,
  closeHumanLiveURL,
  classifyLiveURLExposure,
  logBrowserLifecycle,
} from './BrowserlessRuntime.js';

/** Internal state, held next to the preserved page in the orchestrator's
 * SessionState. `liveURL`/`liveURLId` are SERVER-SIDE ONLY — see
 * humanLiveFields() for the only shape that is allowed out over HTTP. */
export interface HumanLiveSessionState {
  liveURL: string;
  liveURLId: string | null;
  safeToExpose: boolean;
  exposureReason: string;
  createdAt: number;
}

/** The complete set of live-view fields that may cross the HTTP boundary.
 * Deliberately has no liveURLId, no page/context/browser handle, no CDP URL,
 * no token — see the exposure analysis in BrowserlessRuntime.ts. */
export interface HumanLiveFields {
  interactive: boolean;
  liveURL?: string;
  liveBrowserEndpoint?: string;
  interactiveUnavailableReason?: string;
}

export interface HumanLiveOpenResult {
  session: HumanLiveSessionState | null;
  error: string | null;
}

/**
 * Opens an interactable live view on `page` — the exact preserved page, never
 * a new one.
 *
 * `previous` is closed first when present, so a source that hits WAITING_HUMAN
 * repeatedly (a second CAPTCHA deeper into the same flow) can never
 * accumulate orphaned Browserless live-view handles against the same page.
 *
 * Never throws: a failure is returned as { session: null, error }, leaving the
 * caller's preserved browser/context/page completely untouched.
 */
export async function openHumanLiveSession(
  page: any,
  previous: HumanLiveSessionState | null | undefined,
  opts: { jobId: string; source: string; timeoutMs?: number }
): Promise<HumanLiveOpenResult> {
  if (previous) {
    await closeHumanLiveSession(page, previous, { jobId: opts.jobId, source: opts.source, reason: 'superseded' });
  }

  try {
    const { liveURL, liveURLId } = await createHumanLiveURL(page, opts.timeoutMs);
    const exposure = classifyLiveURLExposure(liveURL);
    // The URL itself is NEVER logged — only whether it is exposable and why.
    logBrowserLifecycle('human_live_url_created', {
      jobId: opts.jobId,
      source: opts.source,
      safeToExpose: exposure.safe,
      exposureReason: exposure.reason,
      hasLiveURLId: !!liveURLId,
    });
    return {
      session: {
        liveURL,
        liveURLId,
        safeToExpose: exposure.safe,
        exposureReason: exposure.reason,
        createdAt: Date.now(),
      },
      error: null,
    };
  } catch (e) {
    // The human session survives this. The customer keeps the screenshot/
    // click fallback, the job stays WAITING_HUMAN, and the client can ask
    // again via the /research/:id/live endpoint.
    logBrowserLifecycle('human_live_url_failed', {
      jobId: opts.jobId,
      source: opts.source,
      error: String(e).slice(0, 200),
    });
    return { session: null, error: 'live_view_unavailable' };
  }
}

/** Best-effort teardown of a live view. Never throws, never touches the page
 * itself — closing the VIEW must never close the human's SESSION. */
export async function closeHumanLiveSession(
  page: any,
  session: HumanLiveSessionState | null | undefined,
  opts: { jobId: string; source: string; reason: string }
): Promise<void> {
  if (!session?.liveURLId) return;
  try {
    await closeHumanLiveURL(page, session.liveURLId);
  } catch {
    // closeHumanLiveURL is already best-effort internally; this is the
    // belt-and-braces guarantee that cleanup can never break resume/skip/TTL.
  }
  logBrowserLifecycle('human_live_url_closed', { jobId: opts.jobId, source: opts.source, reason: opts.reason });
}

/** The ONLY function that decides what leaves the process about a live view.
 *
 *  - safe URL      -> returned inline, so the client can open it immediately.
 *  - unsafe URL    -> withheld; the client is pointed at the authenticated
 *                     worker endpoint (POST/GET /research/:id/live — the same
 *                     path ResearchCaptchaModal.tsx already calls), which
 *                     hands the URL only to a caller that authenticated for
 *                     this job.
 *  - no live view  -> interactive: false plus a short, non-sensitive reason.
 *
 * liveURLId is never included in any branch: it is a Browserless-side handle
 * this worker owns and closes, and the client has no use for it. */
export function humanLiveFields(
  jobId: string,
  session: HumanLiveSessionState | null | undefined,
  error?: string | null
): HumanLiveFields {
  if (session?.liveURL && session.safeToExpose) {
    return { interactive: true, liveURL: session.liveURL };
  }
  if (session?.liveURL) {
    return { interactive: true, liveBrowserEndpoint: `/research/${jobId}/live` };
  }
  return { interactive: false, interactiveUnavailableReason: error || 'live_view_unavailable' };
}
