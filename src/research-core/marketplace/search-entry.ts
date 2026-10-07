/** Explicit history always opens. Unavailable terminal history never claims the landing. */
export function shouldResumeSearch(search: { terminal: boolean; unavailable: string | null; createdAt: string }, explicitSearchId: string | null, now = Date.now()): boolean {
  if (explicitSearchId) return true;
  if (search.terminal && search.unavailable) return false;
  return !search.terminal || now - Date.parse(search.createdAt) < 6 * 3600_000;
}
