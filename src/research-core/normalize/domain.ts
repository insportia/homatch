/**
 * Domain normalization.
 *
 * A full Public Suffix List is overkill here and would add a dependency plus a
 * data-refresh problem. This is a curated multi-part-suffix table covering the
 * suffixes we actually care about, with a documented fallback. Swap in `psl`
 * later if the source set grows beyond it.
 */

const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk',
  'com.ge', 'org.ge', 'net.ge', 'edu.ge', 'gov.ge', 'pvt.ge', 'school.ge',
  'com.tr', 'org.tr', 'net.tr', 'gov.tr',
  'com.au', 'net.au', 'org.au',
  'co.nz', 'com.br', 'com.cn', 'com.mx', 'co.jp', 'co.il', 'co.in', 'com.ua',
  'com.ru', 'org.ru', 'net.ru',
  'co.za', 'com.sg', 'com.hk', 'com.pl', 'com.es',
]);

export function normalizeHostname(hostname: string): string {
  let host = hostname.trim().toLowerCase();
  host = host.replace(/\.$/, '');
  // Strip credentials and port if a raw authority was passed in.
  host = host.replace(/^.*@/, '').replace(/:\d+$/, '');
  return host;
}

/** Strip a leading `www.` (and `www2.`, `m.`) so mirrors collapse together. */
export function stripCommonSubdomains(hostname: string): string {
  return normalizeHostname(hostname).replace(/^(?:www\d?|m|mobile)\./, '');
}

/** eTLD+1, e.g. `listings.example-portal.ge` -> `example-portal.ge`. */
export function registrableDomain(hostname: string): string {
  const host = normalizeHostname(hostname);
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;

  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_PART_SUFFIXES.has(lastTwo)) {
    return parts.slice(-3).join('.');
  }
  return lastTwo;
}

export function isSameRegistrableDomain(a: string, b: string): boolean {
  return registrableDomain(a) === registrableDomain(b);
}

export function hostnameOf(url: string): string | null {
  try {
    return normalizeHostname(new URL(url).hostname);
  } catch {
    return null;
  }
}

export function registrableDomainOf(url: string): string | null {
  const host = hostnameOf(url);
  return host ? registrableDomain(host) : null;
}
