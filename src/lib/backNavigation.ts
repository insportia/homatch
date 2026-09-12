/**
 * BACK NAVIGATION, WITHOUT THE TRAP.
 *
 * Split out of SmartBack.tsx with no React and no JSX, so node:test can load
 * it directly — the same reason uploadValidation.ts is separate from the
 * service that uses it. The rules below are the part that can be wrong in a
 * way a customer notices, so they are the part that gets tested.
 *
 * WHY NOT navigate(-1)
 *
 * `navigate(-1)` walks the BROWSER's history, which is not the app's. Someone
 * who opened a verification case from an email, a shared link or a search
 * result has no Homatch screen behind them, so "Back" would throw them out of
 * the product entirely. That is worse than having no back button, because it
 * is a trap that springs only for the people who did not arrive through the
 * front door.
 *
 * So: count the route changes this tab has actually made. Above zero, there
 * is a real Homatch screen behind us and history is the honest answer — it
 * keeps scroll position and the customer's own path. At zero, fall back to
 * the screen that CONTAINS this one.
 */

/* Module-level rather than React context: the count is a property of the tab
   and every consumer wants the same number. A full reload resets it, which is
   correct — a reload really does leave nothing of ours behind. */
let inAppNavigations = 0;

/** Called from the router on each real route change. */
export function noteInAppNavigation(): void {
  inAppNavigations += 1;
}

export function canGoBackInApp(): boolean {
  return inAppNavigations > 0;
}

/** Test seam: exercising the counter should not require real navigation. */
export function __resetNavigationCountForTests(): void {
  inAppNavigations = 0;
}

/**
 * Where a screen sits in the product, for when history cannot help.
 *
 * Ordered: the first match wins, so `/property/:id/matches` is listed above
 * `/property/:id` and does not fall through to the dashboard.
 */
const PARENTS: ReadonlyArray<readonly [RegExp, string | ((m: RegExpMatchArray) => string)]> = [
  [/^\/verify\/[^/]+$/, '/verify'],
  [/^\/property\/([^/]+)\/matches$/, (m) => `/property/${m[1]}`],
  [/^\/property\/(?:add|import|create)$/, '/dashboard'],
  [/^\/property\/[^/]+$/, '/dashboard'],
  [/^\/deal-rooms\/[^/]+$/, '/deal-rooms'],
  [/^\/outreach\/[^/]+$/, '/outreach'],
  [/^\/developer\/[^/]+$/, '/dashboard'],
  /* A single-level product screen belongs to the dashboard. Listed after the
     nested patterns so /outreach/email is not caught by /outreach. */
  [/^\/(?:ai|chat|live-chat|activity|notifications|credits|profile|viewings|active-search|outreach|deal-rooms)$/, '/dashboard'],
];

/**
 * The containing screen for a path, or null when there is no obvious one.
 *
 * Null is deliberate rather than a guessed default: the component decides
 * once, in one place, that "nowhere obvious" means home. Inventing a parent
 * per route here would scatter that judgement across a table.
 */
export function parentRouteFor(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  for (const [pattern, target] of PARENTS) {
    const match = path.match(pattern);
    if (match) return typeof target === 'function' ? target(match) : target;
  }
  return null;
}
