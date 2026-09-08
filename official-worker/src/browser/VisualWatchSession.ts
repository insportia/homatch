// VisualWatchSession.ts — opt-in VISUAL WATCH / DEBUG MODE.
//
// WHAT THIS IS: a way for an authenticated operator to WATCH the real
// production research browser, live, from the very first page — TAS_MAP
// navigation, TAS, document reading, MyGov, ENREG, RS taxpayer, debtor, any
// dynamically queued entity source, a CAPTCHA appearing naturally, the human
// solving it in that same visible page, resume, and on to completion.
//
// WHAT THIS IS NOT:
//  - not a second browser, not a mirror, not a replay, not screenshots
//    dressed up as a live view. The stream is minted with
//    Browserless.liveURL on the EXACT page ResearchOrchestrator just created
//    and is about to drive (see attachVisualWatch's `page` argument — this
//    module has no way to create a browser, context or page: it imports
//    none).
//  - not CAPTCHA automation. When the watched page reaches a challenge, the
//    same already-streaming page becomes the human's interactive session.
//    No solver, no bypass.
//
// PAGE SCOPING — what is PROVEN vs what is ASSUMED:
//   PROVEN from this repo's own code: BrowserlessRuntime.createHumanLiveURL()
//   mints the URL through `ctx.newCDPSession(page)` — a CDP session bound to
//   ONE page target — and closeHumanLiveURL() closes it through a CDP session
//   on that same page. Every live handle this worker owns is therefore
//   created against a specific page target.
//   NOT PROVEN: whether the Browserless-served view then follows the browser
//   to other targets on its own. That is server-side behaviour, no sample of
//   it exists in this repository, and no live call was made to check.
//   Therefore this module does NOT rely on either answer: it explicitly
//   re-attaches on every new active page and publishes a monotonically
//   increasing `generation`, which is correct whether or not the old URL
//   would also have followed. The watcher re-opens whenever `generation`
//   changes.
//
// RECONNECT: a Browserless session that dies takes its live view with it —
// there is no way around that and this module does not pretend otherwise.
// The orchestrator's per-source recovery (BrowserlessRecovery.ts) launches a
// fresh browser and a fresh page; attachVisualWatch() is called for that new
// page exactly as for any other, so the watch follows the REAL new worker
// browser and `generation` increments to tell the watcher its old URL is
// dead.
import {
  openHumanLiveSession,
  closeHumanLiveSession,
  humanLiveFields,
  type HumanLiveSessionState,
  type HumanLiveFields,
} from './HumanLiveSession.js';
import { logBrowserLifecycle } from './BrowserlessRuntime.js';

export interface VisualWatchState {
  /** Opt-in, set once at job start from POST /research's `visualWatch`. When
   * false this module is inert: every function below returns immediately, so
   * an ordinary production job behaves exactly as it did before. */
  enabled: boolean;
  /** Increments on every successful attach — a new page, or a new browser
   * after a Browserless reconnect. The watcher re-opens when this changes.
   * Never incremented by a failed attach: no new URL, no new generation. */
  generation: number;
  /** Source key whose page is currently streamed, for display/logs only. */
  source: string | null;
  live: HumanLiveSessionState | null;
  /** Last non-sensitive reason streaming is unavailable, or null. */
  error: string | null;
  /** SERVER-SIDE ONLY reference to the page currently being streamed. Used to
   * close the handle on the right target and to prove the CAPTCHA page is the
   * page already on screen. NEVER serialized — visualWatchFields() cannot
   * emit it. */
  watchedPage: any | null;
}

/** The complete set of visual-watch fields that may cross the HTTP boundary:
 * the same fail-closed liveURL exposure decision every other live view goes
 * through (humanLiveFields), plus enabled/generation/source. No page, no
 * context, no browser, no liveURLId, no CDP URL, no token. */
export interface VisualWatchFields extends HumanLiveFields {
  enabled: boolean;
  generation: number;
  source: string | null;
}

export function createVisualWatch(enabled: boolean): VisualWatchState {
  return { enabled: !!enabled, generation: 0, source: null, live: null, error: null, watchedPage: null };
}

/**
 * Points the watch at `page` — the exact page the orchestrator just created
 * for this source and is about to drive.
 *
 * Any previous handle is closed first, on the page it was opened against, so
 * source transitions and reconnects cannot accumulate orphaned Browserless
 * live views.
 *
 * Never throws and never touches the page beyond minting the stream: a
 * failure here leaves `live` null with a short reason, and research carries
 * on completely unaffected.
 */
export async function attachVisualWatch(
  state: VisualWatchState,
  page: any,
  opts: { jobId: string; source: string; reason: string; timeoutMs?: number }
): Promise<VisualWatchState> {
  if (!state.enabled) return state;

  if (state.live && state.watchedPage) {
    await closeHumanLiveSession(state.watchedPage, state.live, {
      jobId: opts.jobId,
      source: state.source || opts.source,
      reason: `visual_watch_${opts.reason}`,
    });
  }
  state.live = null;
  state.watchedPage = null;

  const opened = await openHumanLiveSession(page, null, {
    jobId: opts.jobId,
    source: opts.source,
    timeoutMs: opts.timeoutMs,
  });

  state.source = opts.source;
  if (!opened.session) {
    state.error = opened.error;
    // Visual watching is a debugging convenience. Losing it is never allowed
    // to affect the research itself — the caller ignores this outcome.
    logBrowserLifecycle('visual_watch_unavailable', {
      jobId: opts.jobId,
      source: opts.source,
      reason: opts.reason,
      generation: state.generation,
      error: opened.error,
    });
    return state;
  }

  state.live = opened.session;
  state.error = null;
  state.watchedPage = page;
  state.generation += 1;
  // Never the URL itself — only that a new generation exists and why.
  logBrowserLifecycle('visual_watch_attached', {
    jobId: opts.jobId,
    source: opts.source,
    reason: opts.reason,
    generation: state.generation,
    safeToExpose: opened.session.safeToExpose,
  });
  return state;
}

/** Best-effort release of the current handle — on source completion, resume,
 * skip, job end or TTL sweep. Never closes the page itself. */
export async function detachVisualWatch(
  state: VisualWatchState | undefined | null,
  opts: { jobId: string; source: string; reason: string }
): Promise<void> {
  if (!state?.enabled || !state.live || !state.watchedPage) return;
  await closeHumanLiveSession(state.watchedPage, state.live, {
    jobId: opts.jobId,
    source: state.source || opts.source,
    reason: `visual_watch_${opts.reason}`,
  });
  state.live = null;
  state.watchedPage = null;
  logBrowserLifecycle('visual_watch_detached', {
    jobId: opts.jobId,
    source: state.source || opts.source,
    reason: opts.reason,
    generation: state.generation,
  });
}

/** True when the watch is already streaming this exact page — the proof that
 * a CAPTCHA reached on the watched page needs no second live view and no
 * second browser: the human simply interacts with what is already on screen. */
export function isWatchingPage(state: VisualWatchState | undefined | null, page: any): boolean {
  return !!(state?.enabled && state.live && page && state.watchedPage === page);
}

/**
 * The job document's `visualWatch` block. Returns undefined when watching is
 * off, so an ordinary job's serialized shape is byte-for-byte what it was
 * before this feature existed.
 *
 * `live`/`error` may be overridden with the WAITING_HUMAN session's own
 * handle, for the case where an ordinary (non-watch) live view is the one
 * currently streaming.
 */
export function visualWatchFields(
  jobId: string,
  state: VisualWatchState | undefined | null,
  live?: HumanLiveSessionState | null,
  error?: string | null
): VisualWatchFields | undefined {
  if (!state?.enabled) return undefined;
  const effectiveLive = live === undefined ? state.live : live;
  const effectiveError = error === undefined ? state.error : error;
  return {
    enabled: true,
    generation: state.generation,
    source: state.source,
    ...humanLiveFields(jobId, effectiveLive, effectiveError),
  };
}
