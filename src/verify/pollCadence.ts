/*
 * HOW OFTEN THE VERIFY PAGE ASKS FOR STATUS.
 *
 * Every status poll is a research-agent invocation that reads the job row
 * (and may advance it). At a fixed 2.2 s, one open tab made ~330 calls over a
 * typical 12-minute run — on top of the background driver, which keeps the
 * job moving whether or not anyone is watching. So the page's cadence only
 * decides how fresh the screen is, and it can follow the work:
 *
 *   - quick (2.2 s) for the first 20 s of a run and for 20 s after any stage
 *     change, when something visible is likely to follow;
 *   - relaxed (4.5 s) while the job sits in a known long wait (the official
 *     browser, a financial lookup, a model stage);
 *   - slow (10 s) while the tab is hidden — nobody is looking.
 */
export const POLL_FAST_MS = 2200;
export const POLL_LONG_WAIT_MS = 4500;
export const POLL_HIDDEN_MS = 10_000;
const FRESH_WINDOW_MS = 20_000;

const LONG_WAIT = /^(BROWSER_WAITING|FINANCIAL_ENTITY_WAITING|(IDENTITY|OFFICIAL_COLLECTION|PUBLIC_RESEARCH|MARKET|SYNTHESIS)_WAITING)$/;

export function pollDelayMs(args: { stage?: string | null; msSinceStageChange: number; msSinceStart: number; hidden: boolean }): number {
  if (args.hidden) return POLL_HIDDEN_MS;
  if (args.msSinceStart < FRESH_WINDOW_MS || args.msSinceStageChange < FRESH_WINDOW_MS) return POLL_FAST_MS;
  return LONG_WAIT.test(String(args.stage ?? '')) ? POLL_LONG_WAIT_MS : POLL_FAST_MS;
}
