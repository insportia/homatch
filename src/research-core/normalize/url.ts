import { normalizeHostname, stripCommonSubdomains } from './domain.ts';

/**
 * URL handling, split into two jobs that must never be confused.
 *
 *   fetchUrl              what we actually send to the network.
 *   canonicalIdentityUrl  what we use as a cache key, a coalescing key and a
 *                         dedupe signal.
 *
 * Canonicalization is lossy on purpose: it strips `www.`, drops tracking
 * parameters, removes the fragment and normalizes the path, so that four
 * spellings of one page collapse to one cache entry. Every one of those steps
 * can change which resource a server returns.
 *
 * `?ref=` and `?source=` are tracking parameters on one site and the entire
 * request on another. `m.example.com` is a mirror on one site and a different
 * document on another. A signed URL loses its signature. So the canonical form
 * is *never* used as the network target: `deriveUrlIdentity` keeps all three
 * forms and the HTTP client fetches `fetchUrl`.
 *
 * Per-source canonicalization policy (`CanonicalizeOptions`) then lets an
 * operator say "on this domain, `?ref=` is meaningful" without affecting how
 * any other source is keyed.
 */

/** Query parameters that never change the content served. */
const TRACKING_PARAMS = [
  /^utm_/i,
  /^ga_/i,
  /^_ga$/i,
  /^gclid$/i,
  /^dclid$/i,
  /^fbclid$/i,
  /^yclid$/i,
  /^msclkid$/i,
  /^mc_(cid|eid)$/i,
  /^igshid$/i,
  /^ref$/i,
  /^referrer$/i,
  /^source$/i,
  /^campaign$/i,
  /^session(_?id)?$/i,
  /^sid$/i,
  /^phpsessid$/i,
];

export interface CanonicalizeOptions {
  /** Keep the fragment. Off by default: `#photos` is the same document. */
  keepFragment?: boolean;
  /** Collapse `www.` / `m.` prefixes. On by default. */
  stripWww?: boolean;
  /** Drop known tracking params. On by default. */
  stripTracking?: boolean;
  /** Additional parameter names to drop. */
  dropParams?: string[];
  /** When set, keep ONLY these params (plus nothing else). */
  keepOnlyParams?: string[];
}

export function canonicalizeUrl(input: string, options: CanonicalizeOptions = {}): string | null {
  const {
    keepFragment = false,
    stripWww = true,
    stripTracking = true,
    dropParams = [],
    keepOnlyParams,
  } = options;

  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  url.protocol = url.protocol.toLowerCase();
  url.hostname = stripWww ? stripCommonSubdomains(url.hostname) : normalizeHostname(url.hostname);
  url.username = '';
  url.password = '';

  // Default ports carry no information.
  if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
    url.port = '';
  }

  url.pathname = normalizePath(url.pathname);

  const params = new URLSearchParams();
  const entries = [...url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [key, value] of entries) {
    if (keepOnlyParams && !keepOnlyParams.includes(key)) continue;
    if (dropParams.includes(key)) continue;
    if (stripTracking && TRACKING_PARAMS.some((re) => re.test(key))) continue;
    params.append(key, value);
  }
  url.search = params.toString() ? `?${params.toString()}` : '';

  if (!keepFragment) url.hash = '';

  return url.toString();
}

function normalizePath(pathname: string): string {
  let path = pathname;
  try {
    // Decode over-encoded but safe characters, then re-encode consistently.
    path = decodeURIComponent(path);
  } catch {
    // Malformed percent-encoding: leave as-is rather than throwing.
  }
  path = path.replace(/\/{2,}/g, '/');
  // Resolve `.` and `..` segments.
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  const rebuilt = '/' + segments.map((s) => encodeURIComponent(s)).join('/');
  // Trailing slash carries no meaning except at the root.
  return rebuilt.length > 1 ? rebuilt.replace(/\/$/, '') : '/';
}

// ---------------------------------------------------------------------------
// Fetch identity
// ---------------------------------------------------------------------------

/**
 * The three forms a URL takes inside the engine.
 *
 * `requestedUrl` is exactly what the caller or the provider handed us, kept for
 * the audit trail. `fetchUrl` is what goes on the wire. `canonicalIdentityUrl`
 * is for keys and comparisons only.
 */
export interface UrlIdentity {
  requestedUrl: string;
  fetchUrl: string;
  canonicalIdentityUrl: string;
}

/**
 * Minimal, semantics-preserving normalization of a network target.
 *
 * Does exactly three things, all of which are safe because they cannot change
 * the bytes a server receives:
 *   - rejects non-http(s) schemes
 *   - lowercases the scheme and host (both are case-insensitive by spec)
 *   - removes the fragment (never transmitted)
 *
 * It deliberately does NOT touch the path, the query, or the subdomain.
 */
export function normalizeFetchUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // The fragment is client-side only and is never sent.
  url.hash = '';
  return url.toString();
}

/**
 * Build all three forms from one input URL.
 *
 * `policy` affects the canonical identity only. Returns null when the input is
 * not a usable http(s) URL.
 */
export function deriveUrlIdentity(
  input: string,
  policy: CanonicalizeOptions = {},
): UrlIdentity | null {
  const fetchUrl = normalizeFetchUrl(input);
  if (!fetchUrl) return null;
  const canonicalIdentityUrl = canonicalizeUrl(fetchUrl, policy) ?? fetchUrl;
  return { requestedUrl: input.trim(), fetchUrl, canonicalIdentityUrl };
}

/**
 * Query parameters that make a URL caller-specific: session tokens, signed
 * links, API keys. A URL carrying one of these is never cached globally and
 * never coalesced across tenants, because the response is not the same resource
 * for a different caller.
 */
export const PRIVATE_QUERY_PARAMS = [
  /^(?:access_)?token$/i,
  /^api[_-]?key$/i,
  /^auth$/i,
  /^authorization$/i,
  /^sig(nature)?$/i,
  /^x-amz-signature$/i,
  /^x-goog-signature$/i,
  /^se$/i,
  /^expires?$/i,
  /^signed[_-]?url$/i,
  /^password$/i,
  /^secret$/i,
];

/**
 * True when a URL looks caller-specific rather than like a public document.
 *
 * Conservative by design: a false positive costs one cache miss, a false
 * negative can serve one tenant's signed document to another.
 */
export function looksCallerSpecific(input: string, extraParams: readonly string[] = []): boolean {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return true;
  }
  if (url.username || url.password) return true;

  const extra = extraParams.map((param) => param.toLowerCase());
  for (const key of url.searchParams.keys()) {
    const lower = key.toLowerCase();
    if (extra.includes(lower)) return true;
    if (PRIVATE_QUERY_PARAMS.some((pattern) => pattern.test(key))) return true;
  }
  return false;
}

/** Resolve a possibly relative href against a base document URL. */
export function resolveUrl(base: string, href: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function withQueryParam(input: string, key: string, value: string | number): string {
  const url = new URL(input);
  url.searchParams.set(key, String(value));
  return url.toString();
}

export function pathSegments(input: string): string[] {
  try {
    return new URL(input).pathname.split('/').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Best-effort stable listing identifier from a URL path: the last numeric or
 * id-shaped segment. Used as a weak dedupe signal, never as a strong one.
 */
export function idFromUrlPath(input: string): string | null {
  const segments = pathSegments(input);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i] as string;
    if (/^[0-9]{3,}$/.test(segment)) return segment;
    const match = segment.match(/(?:^|[-_])([0-9]{4,})$/);
    if (match) return match[1] as string;
  }
  return null;
}
