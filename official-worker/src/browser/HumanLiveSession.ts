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
  classifyLiveCapabilityExposure,
  logBrowserLifecycle,
  type LiveCapability,
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
  /** The TRUSTED capability object minted by BrowserlessRuntime for this
   * exact live view (provenance, allowed origin, deadline). The authenticated
   * /research/:id/live endpoint validates THIS — never the bare `liveURL`
   * string above, which no other code path may expose. */
  capability: LiveCapability;
}

/** The complete set of live-view fields that may cross the HTTP boundary.
 * Deliberately has no liveURL, no liveURLId, no page/context/browser handle,
 * no CDP URL, no token.
 *
 * The raw live URL is NOT part of this shape at all — not even a "safe" one.
 * The job document is polled continuously and stored and logged downstream,
 * so the URL is reachable ONLY through the authenticated
 * /research/:id/live endpoint, which validates the trusted capability at the
 * moment of the request (see BrowserlessRuntime.exposableLiveURL). Making
 * the field structurally absent is what guarantees requirement "the raw
 * liveURL must remain non-serialized in the normal job response". */
export interface HumanLiveFields {
  interactive: boolean;
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
    const { liveURL, liveURLId, capability } = await createHumanLiveURL(page, opts.timeoutMs);
    const exposure = classifyLiveCapabilityExposure(capability);
    // Neither the URL nor the Browserless capability parameter is ever
    // logged — only booleans and a short reason code.
    logBrowserLifecycle('human_live_url_created', {
      jobId: opts.jobId,
      source: opts.source,
      trustedCapability: true,
      safeToExpose: exposure.safe,
      exposureReason: exposure.reason,
      hasLiveURLId: !!liveURLId,
      carriesCredentialParam: capability.carriesCredentialParam,
    });
    return {
      session: {
        liveURL,
        liveURLId,
        safeToExpose: exposure.safe,
        exposureReason: exposure.reason,
        createdAt: Date.now(),
        capability,
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

/** What the JOB DOCUMENT says about a live view — and it never says the URL.
 *
 *  - a live view exists -> interactive: true plus the authenticated endpoint
 *                          to fetch it from (POST/GET /research/:id/live —
 *                          the path ResearchCaptchaModal.tsx already calls).
 *  - no live view       -> interactive: false plus a short, non-sensitive
 *                          reason.
 *
 * Neither branch can carry the URL, the Browserless capability parameter, the
 * liveURLId or any handle: the shape has no field for them. Exposure happens
 * once, at request time, behind auth. */
export function humanLiveFields(
  jobId: string,
  session: HumanLiveSessionState | null | undefined,
  error?: string | null
): HumanLiveFields {
  if (session?.liveURL) {
    return { interactive: true, liveBrowserEndpoint: `/research/${jobId}/live` };
  }
  return { interactive: false, interactiveUnavailableReason: error || 'live_view_unavailable' };
}
