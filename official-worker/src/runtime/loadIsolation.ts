// LOAD ISOLATION — AI TALK speech shares this process and its event loop with Verify's browser
// lanes, portal parsing and document parsing (one Railway replica). Two small guards:
//
//   1. While any speech session is open, the verify queue claims at most
//      VERIFY_QUEUE_BROWSER_SLOTS_DURING_SPEECH (default 1) NEW Chromium tasks. Running tasks are
//      never interrupted; the cap only lowers how many new ones start, and lifts when speech ends.
//   2. Event-loop delay is measured continuously (perf_hooks), so /health and every speech session
//      log can show whether background work delayed the speech hot path.
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';

let speechSessions = 0;
export const speechSessionOpened = (): void => { speechSessions++; };
export const speechSessionClosed = (): void => { speechSessions = Math.max(0, speechSessions - 1); };
export const speechSessionsOpen = (): number => speechSessions;

/** New browser tasks a lane may hold while speech is active (null = no cap). */
export function browserCapDuringSpeech(env: Record<string, string | undefined> = process.env): number {
  const n = Math.trunc(Number(env.VERIFY_QUEUE_BROWSER_SLOTS_DURING_SPEECH ?? '1'));
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

/** The slot count a lane may fill right now. */
export function laneSlotsNow(lane: string, slots: number, speechOpen = speechSessions, cap = browserCapDuringSpeech()): number {
  return lane === 'BROWSER' && speechOpen > 0 ? Math.min(slots, cap) : slots;
}

const MS = 1e6;
let histogram: IntervalHistogram | null = null;
let windowStartedAt = Date.now();
let lastWindow: { p50Ms: number; p99Ms: number; maxMs: number; windowS: number } | null = null;

function ensure(): IntervalHistogram {
  if (!histogram) { histogram = monitorEventLoopDelay({ resolution: 20 }); histogram.enable(); windowStartedAt = Date.now(); }
  return histogram;
}

/** Event-loop delay since the window began (and the previous full minute), in ms. */
export function eventLoopDelay(): { current: { p50Ms: number; p99Ms: number; maxMs: number; windowS: number }; lastMinute: typeof lastWindow } {
  const h = ensure();
  const current = {
    p50Ms: +(h.percentile(50) / MS).toFixed(1), p99Ms: +(h.percentile(99) / MS).toFixed(1), maxMs: +(h.max / MS).toFixed(1),
    windowS: Math.round((Date.now() - windowStartedAt) / 1000),
  };
  if (current.windowS >= 60) { lastWindow = current; h.reset(); windowStartedAt = Date.now(); }
  return { current, lastMinute: lastWindow };
}

ensure();
