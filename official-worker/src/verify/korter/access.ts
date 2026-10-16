// korter/access.ts — may Verify use Korter (korter.ge) as a market source?
//
// Honest feasibility, not a crawler. In production this fetches exactly two
// public documents with a plain GET and an identifying User-Agent:
//
//   https://korter.ge/robots.txt
//   https://korter.ge/terms-of-service
//
// and classifies what they say. It never requests a listing page, a JSON
// endpoint behind the SPA, or anything else. No stealth, no proxy rotation,
// no anti-bot workaround: an undocumented internal endpoint is not an API.
//
// Research record (2026-10-11, public search; the sandbox cannot resolve
// korter.ge, so this check is the production probe):
//   - korter.ge/terms-of-service: operated by Flatfy OÜ (Estonia). §5.3 bars
//     automated programs unless they identify themselves and obey robots.txt
//     ("Permitted Programs"), and separately states "You must not use any
//     scraping technology on the Site."
//   - No public API, partner data feed or licensing programme was found.
//
// Status, in order of precedence:
//   AUTHORIZED_FEED   a licensed feed is configured (KORTER_FEED_URL + KORTER_FEED_KEY)
//   UNREACHABLE       neither document could be read
//   BLOCKED_BY_TERMS  the terms prohibit scraping / automated extraction
//   BLOCKED_BY_ROBOTS robots.txt disallows the site to our agent
//   NO_DOCUMENTED_API readable, not blocked outright, but no documented API/feed

export type KorterAccessStatus =
  | 'AUTHORIZED_FEED'
  | 'NO_DOCUMENTED_API'
  | 'BLOCKED_BY_TERMS'
  | 'BLOCKED_BY_ROBOTS'
  | 'UNREACHABLE';

export interface KorterAccessEvidence {
  urls: string[];
  fetchedAt: string;
  excerpts: Array<{ url: string; text: string }>;
  /** Per-document HTTP outcome; null status = network failure. */
  fetches: Array<{ url: string; status: number | null; error: string | null; bytes: number }>;
  robots: { rootAllowed: boolean | null; listingsAllowed: boolean | null } | null;
  terms: { scrapingProhibited: boolean; automatedAccessRestricted: boolean; documentedApi: boolean } | null;
  feedConfigured: boolean;
}

export interface KorterAccessResult {
  status: KorterAccessStatus;
  provider: 'KORTER';
  /** Extraction is permitted only through a licensed feed. */
  extractionAllowed: boolean;
  evidence: KorterAccessEvidence;
}

export const KORTER_BASE_URL = 'https://korter.ge';
export const KORTER_ROBOTS_PATH = '/robots.txt';
export const KORTER_TERMS_PATH = '/terms-of-service';
export const KORTER_USER_AGENT = 'HOMATCH-Verify/1.0 (+https://homatch.live; terms and robots access check)';
/** The robots token we identify as. */
const UA_TOKEN = 'homatch-verify';
/** A representative listing path: the kind of page market extraction would need. */
const SAMPLE_LISTING_PATH = '/en/apartments-for-sale-tbilisi';

/* ------------------------------------------------------------------ *
 * robots.txt                                                          *
 * ------------------------------------------------------------------ */

interface RobotsGroup { agents: string[]; rules: Array<{ allow: boolean; path: string }> }

export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let cur: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      lastWasAgent = false;
      if (!cur) continue;
      // An empty Disallow allows everything; it adds no rule.
      if (value) cur.rules.push({ allow: key === 'allow', path: value });
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

const ruleMatches = (rule: string, path: string): boolean => {
  const anchored = rule.endsWith('$');
  const body = (anchored ? rule.slice(0, -1) : rule)
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`).test(path);
};

/** RFC 9309: the most specific group for our token, else "*"; longest match wins, Allow on a tie. */
export function robotsAllows(text: string, path: string, token = UA_TOKEN): boolean {
  const groups = parseRobots(text);
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const applicable = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  const rules = applicable.flatMap((g) => g.rules).filter((r) => ruleMatches(r.path, path));
  if (!rules.length) return true;
  rules.sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
  return rules[0].allow;
}

/* ------------------------------------------------------------------ *
 * Terms                                                               *
 * ------------------------------------------------------------------ */

export function htmlToText(html: string): string {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// English, Russian, Ukrainian and Georgian wordings of the same clauses.
const SCRAPING_PROHIBITED = [
  /must\s+not\s+use\s+any\s+scraping/i,
  /(?:prohibit|not\s+permitted|not\s+allowed|may\s+not|must\s+not)[^.]{0,80}(?:scrap|data\s+min|harvest|extract)/i,
  /(?:запрещ|не\s+допуска|не\s+разреша)[^.]{0,80}(?:парс|скрейп|скрап|сбор\s+данн|извлеч)/i,
  /(?:заборон|не\s+дозволя)[^.]{0,80}(?:парс|скрейп|скрап|збір\s+дан)/i,
  /(?:აკრძალ|არ\s+შეიძლება|დაუშვებელ)[^.]{0,80}(?:სკრეიპ|მონაცემების\s+(?:შეგროვ|ამოღ))/u,
];
const AUTOMATED_RESTRICTED = [
  /(?:automated\s+program|spider|web\s+crawler|robot)[^.]{0,160}(?:must\s+not|not\s+permitted|misuse|unless)/i,
  /must\s+not\s+use\s+or\s+attempt\s+to\s+use\s+any\s+automated/i,
  /(?:автоматизирован|робот|паук|краулер)[^.]{0,120}(?:запрещ|не\s+допуска)/i,
  /ავტომატ[^.]{0,120}(?:აკრძალ|დაუშვებ)/u,
];
const DOCUMENTED_API = [
  /\b(?:public|partner|developer)\s+api\b/i,
  /\bdata\s+(?:feed|licen[cs]e|licensing)\b/i,
  /\bapi\s+(?:access|key|documentation)\b/i,
];

const sentenceAround = (text: string, re: RegExp): string | null => {
  const m = re.exec(text);
  if (!m) return null;
  const start = Math.max(0, text.lastIndexOf('.', m.index) + 1);
  const endDot = text.indexOf('.', m.index + m[0].length);
  const end = endDot === -1 ? Math.min(text.length, m.index + 280) : Math.min(endDot + 1, start + 320);
  return text.slice(start, end).trim();
};

export function readTerms(text: string): { scrapingProhibited: boolean; automatedAccessRestricted: boolean; documentedApi: boolean; excerpts: string[] } {
  const excerpts: string[] = [];
  const hit = (res: RegExp[]) => {
    let any = false;
    for (const re of res) {
      const s = sentenceAround(text, re);
      if (s) {
        any = true;
        if (!excerpts.includes(s)) excerpts.push(s);
      }
    }
    return any;
  };
  const scrapingProhibited = hit(SCRAPING_PROHIBITED);
  const automatedAccessRestricted = hit(AUTOMATED_RESTRICTED);
  const documentedApi = hit(DOCUMENTED_API);
  return { scrapingProhibited, automatedAccessRestricted, documentedApi, excerpts: excerpts.slice(0, 6) };
}

/* ------------------------------------------------------------------ *
 * The classifier (pure)                                               *
 * ------------------------------------------------------------------ */

export interface FetchedDoc { url: string; status: number | null; body: string; error: string | null }

export function classifyKorterAccess(input: {
  robots: FetchedDoc;
  terms: FetchedDoc;
  feedConfigured: boolean;
  fetchedAt: string;
}): KorterAccessResult {
  const ok = (d: FetchedDoc) => d.status !== null && d.status >= 200 && d.status < 300 && !!d.body;
  const evidence: KorterAccessEvidence = {
    urls: [input.robots.url, input.terms.url],
    fetchedAt: input.fetchedAt,
    excerpts: [],
    fetches: [input.robots, input.terms].map((d) => ({ url: d.url, status: d.status, error: d.error, bytes: d.body?.length ?? 0 })),
    robots: null,
    terms: null,
    feedConfigured: input.feedConfigured,
  };
  const done = (status: KorterAccessStatus): KorterAccessResult => ({
    status,
    provider: 'KORTER',
    extractionAllowed: status === 'AUTHORIZED_FEED',
    evidence,
  });

  if (ok(input.robots)) {
    const rootAllowed = robotsAllows(input.robots.body, '/');
    const listingsAllowed = robotsAllows(input.robots.body, SAMPLE_LISTING_PATH);
    evidence.robots = { rootAllowed, listingsAllowed };
    const blocking = input.robots.body
      .split(/\r?\n/)
      .filter((l) => /^\s*(user-agent|disallow)\s*:/i.test(l))
      .slice(0, 8)
      .join('\n');
    if (blocking) evidence.excerpts.push({ url: input.robots.url, text: blocking.slice(0, 400) });
  } else if (input.robots.status === 404) {
    // No robots.txt means no robots restriction (RFC 9309 §2.3.1.3).
    evidence.robots = { rootAllowed: true, listingsAllowed: true };
  }
  if (ok(input.terms)) {
    const t = readTerms(htmlToText(input.terms.body));
    evidence.terms = { scrapingProhibited: t.scrapingProhibited, automatedAccessRestricted: t.automatedAccessRestricted, documentedApi: t.documentedApi };
    for (const e of t.excerpts) evidence.excerpts.push({ url: input.terms.url, text: e });
  }

  // A licensed feed is a contract; it is the only authorisation we accept.
  if (input.feedConfigured) return done('AUTHORIZED_FEED');
  if (!evidence.robots && !evidence.terms) return done('UNREACHABLE');
  if (evidence.terms?.scrapingProhibited) return done('BLOCKED_BY_TERMS');
  if (evidence.robots && (evidence.robots.rootAllowed === false || evidence.robots.listingsAllowed === false)) return done('BLOCKED_BY_ROBOTS');
  return done('NO_DOCUMENTED_API');
}

/* ------------------------------------------------------------------ *
 * The production probe                                                *
 * ------------------------------------------------------------------ */

export type FetchLike = (url: string, init?: any) => Promise<{ status: number; text: () => Promise<string> }>;

export function korterFeedConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return !!(env.KORTER_FEED_URL && env.KORTER_FEED_URL.trim() && env.KORTER_FEED_KEY && env.KORTER_FEED_KEY.trim());
}

async function getDoc(fetchImpl: FetchLike, url: string, timeoutMs: number): Promise<FetchedDoc> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': KORTER_USER_AGENT, Accept: 'text/html,text/plain;q=0.9,*/*;q=0.1' },
    });
    const body = (await r.text()).slice(0, 600_000);
    return { url, status: r.status, body, error: null };
  } catch (e) {
    return { url, status: null, body: '', error: String((e as Error)?.message ?? e).slice(0, 160) };
  } finally {
    clearTimeout(timer);
  }
}

/** Two plain GETs, then the pure classifier. Never throws. */
export async function checkKorterAccess(opts: {
  fetchImpl?: FetchLike;
  baseUrl?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  now?: () => Date;
} = {}): Promise<KorterAccessResult> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const base = (opts.baseUrl ?? KORTER_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const [robots, terms] = await Promise.all([
    getDoc(fetchImpl, `${base}${KORTER_ROBOTS_PATH}`, timeoutMs),
    getDoc(fetchImpl, `${base}${KORTER_TERMS_PATH}`, timeoutMs),
  ]);
  return classifyKorterAccess({
    robots,
    terms,
    feedConfigured: korterFeedConfigured(opts.env),
    fetchedAt: (opts.now ?? (() => new Date()))().toISOString(),
  });
}
