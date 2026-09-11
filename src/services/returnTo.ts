// HOMATCH — the page a visitor was on before they were asked to sign in.
//
// sessionStorage rather than router state, because the Google route leaves the
// app entirely and comes back on a different page; router state does not
// survive that, and this has to work for both ways in.

const RETURN_TO_KEY = 'homatch_return_to';

/**
 * Where to go after signing in, when a page asked to be returned to.
 *
 * Only ever a path within this app: the value is read back out of storage and
 * navigated to, so anything that could name another origin — an absolute URL,
 * a protocol-relative "//evil.example" — is refused rather than sanitised.
 * A redirect a stranger can choose is an open redirect, and this one would
 * fire on a freshly authenticated session.
 *
 * Consumed once, whether or not it was usable.
 */
export function takePendingPath(): string | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(RETURN_TO_KEY);
    sessionStorage.removeItem(RETURN_TO_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  return raw;
}

/** Remember the page to come back to, across an OAuth round trip. */
export function rememberPendingPath(path: string): void {
  try {
    if (path.startsWith('/') && !path.startsWith('//')) sessionStorage.setItem(RETURN_TO_KEY, path);
  } catch {
    /* The journey still works; it just ends on the dashboard. */
  }
}
