/*
 * CITATIONS, NOT MARKDOWN.
 *
 * Web research arrives with inline citations the model's search tool wrote:
 *   "… 70 მ-ში ([sivrce.com](https://sivrce.com/…?utm_source=openai))"
 * Job c80f7237 showed exactly that, raw, in Location and People. A customer
 * should read the sentence and see WHERE it came from — a source name — not
 * markdown, not a URL, and never a tracking parameter.
 *
 * splitCitations() returns the sentence without its citations and the
 * sources as host names (with a cleaned URL kept for an evidence drawer).
 * The primary report shows host names only; it renders no outbound link.
 */

export interface Citation {
  /** Host without "www.", e.g. "sivrce.com" — what the reader sees. */
  host: string;
  /** The link with tracking parameters removed. */
  url: string;
}

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|yclid|mc_cid|mc_eid|ref|ref_src)$/i;

export function stripTracking(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    const out = u.toString();
    return out.endsWith('?') ? out.slice(0, -1) : out;
  } catch {
    return url;
  }
}

const hostOf = (url: string): string | null => {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '') : null;
  } catch {
    return null;
  }
};

// "([label](url))", "[label](url)", and bare URLs — in that order.
const PAREN_LINK = /\s*\(\s*\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)\s*\)/g;
const LINK = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
const BARE = /\s*\(?\s*(https?:\/\/[^\s)]+)\s*\)?/g;

export function splitCitations(text: unknown): { text: string; sources: Citation[] } {
  const sources: Citation[] = [];
  const add = (url: string) => {
    const host = hostOf(url);
    if (host && !sources.some((s) => s.host === host)) sources.push({ host, url: stripTracking(url) });
  };
  let t = typeof text === 'string' ? text : '';
  t = t.replace(PAREN_LINK, (_m, _label, url) => (add(url), ''));
  // An inline link keeps its words when they are words, not a domain.
  t = t.replace(LINK, (_m, label: string, url: string) => {
    add(url);
    return /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(label.trim()) ? '' : label;
  });
  t = t.replace(BARE, (_m, url) => (add(url), ' '));
  t = t
    .replace(/\(\s*[),.;:]*\s*\)/g, '')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { text: t, sources };
}

/*
 * A DISTANCE IS A SOURCE'S CLAIM, NOT A MEASUREMENT.
 *
 * "70 მ და 1 წუთი ფეხით" came from a listing site. There is no geocoder in
 * this pipeline, so a figure like that is shown as approximate and
 * attributed, never as HOMATCH's own precision.
 */
export function hasDistance(text: string): boolean {
  return /\d+(?:[.,]\d+)?\s*(?:მ\b|მ\.|მეტრ|კმ|წთ|წუთ|km\b|m\b|min|minutes?|метр|км|мин)/i.test(text);
}
