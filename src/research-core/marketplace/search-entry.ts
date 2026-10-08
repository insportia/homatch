/**
 * Explicit history always opens. A failed/unavailable terminal search never claims the
 * bare Find Property entry. Every usable latest search does: its result catalogue is the
 * customer's property workspace and must remain reachable after hours or days, not expire
 * into the product-selection landing page.
 */
export function shouldResumeSearch(search: { terminal: boolean; unavailable: string | null; createdAt: string }, explicitSearchId: string | null, _now = Date.now()): boolean {
  if (explicitSearchId) return true;
  return !(search.terminal && search.unavailable);
}
