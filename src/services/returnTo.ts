// HOMATCH — the page a visitor was on before they were asked to sign in.
//
// sessionStorage rather than router state, because the Google route leaves the
// app entirely and comes back on a different page; router state does not
// survive that, and this has to work for both ways in. A 24-hour localStorage
// copy covers the e-mail confirmation link, which opens in a new tab.

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
    /* fall through to the durable copy */
  }
  const durable = takeDurable();
  raw = raw ?? durable;
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  return raw;
}

/** Remember the page to come back to, across an OAuth round trip. */
export function rememberPendingPath(path: string): void {
  if (!path.startsWith('/') || path.startsWith('//')) return;
  try {
    sessionStorage.setItem(RETURN_TO_KEY, path);
  } catch {
    /* The journey still works; it just ends on the dashboard. */
  }
  /* A confirmation e-mail opens its link in a NEW tab, which has an empty
     sessionStorage. A short-lived durable copy carries the path across. */
  try {
    localStorage.setItem(RETURN_TO_KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {
    /* as above */
  }
}

const DURABLE_TTL_MS = 24 * 60 * 60 * 1000;

function takeDurable(): string | null {
  try {
    const raw = localStorage.getItem(RETURN_TO_KEY);
    localStorage.removeItem(RETURN_TO_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof parsed.path !== 'string' || typeof parsed.at !== 'number') return null;
    return Date.now() - parsed.at <= DURABLE_TTL_MS ? parsed.path : null;
  } catch {
    return null;
  }
}
