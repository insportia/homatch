/**
 * robots.txt parsing and enforcement.
 *
 * This exists because the previous version of this package described itself as
 * respecting robots.txt in its User-Agent string while doing nothing of the
 * kind. Either implement it or stop claiming it; this is the implementation.
 *
 * Scope, stated honestly:
 *   - Implements the Robots Exclusion Protocol as standardised in RFC 9309:
 *     user-agent group selection, Allow/Disallow, `*` and `$` wildcards,
 *     longest-match-wins with Allow breaking ties, Crawl-delay, Sitemap.
 *   - Enforced only for sources whose `SourcePolicy.robots` is `RESPECT`.
 *   - A robots.txt that cannot be fetched is treated as "allow" (per RFC 9309,
 *     a 4xx means unrestricted); a 5xx is treated as "disallow" for a while,
 *     which is the conservative reading.
 *   - It is an access *policy*, not an access *control*. Nothing here bypasses
 *     authentication, and it is not a substitute for having permission.
 */

export interface RobotsRule {
  type: 'ALLOW' | 'DISALLOW';
  /** Raw path pattern, possibly containing `*` and a trailing `$`. */
  pattern: string;
  /** Match specificity, used for longest-match-wins. */
  length: number;
}

export interface RobotsGroup {
  userAgents: string[];
  rules: RobotsRule[];
  crawlDelaySeconds: number | null;
}

export interface RobotsFile {
  groups: RobotsGroup[];
  sitemaps: string[];
  /** True when the file was fetched and parsed, false when we assumed a default. */
  parsed: boolean;
}

export const EMPTY_ROBOTS: RobotsFile = { groups: [], sitemaps: [], parsed: false };

export function parseRobotsTxt(text: string): RobotsFile {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];

  let current: RobotsGroup | null = null;
  // Consecutive User-agent lines form one group; a rule line closes the header.
  let acceptingAgents = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]?.trim() ?? '';
    if (!line) continue;

    const separator = line.indexOf(':');
    if (separator < 0) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    switch (field) {
      case 'user-agent': {
        if (!current || !acceptingAgents) {
          current = { userAgents: [], rules: [], crawlDelaySeconds: null };
          groups.push(current);
          acceptingAgents = true;
        }
        current.userAgents.push(value.toLowerCase());
        break;
      }
      case 'allow':
      case 'disallow': {
        if (!current) {
          // Rules before any User-agent line apply to everyone.
          current = { userAgents: ['*'], rules: [], crawlDelaySeconds: null };
          groups.push(current);
        }
        acceptingAgents = false;
        // "Disallow:" with an empty value means allow everything.
        if (field === 'disallow' && value === '') break;
        current.rules.push({
          type: field === 'allow' ? 'ALLOW' : 'DISALLOW',
          pattern: value,
          length: value.length,
        });
        break;
      }
      case 'crawl-delay': {
        if (current) {
          const delay = Number.parseFloat(value);
          if (Number.isFinite(delay) && delay >= 0) current.crawlDelaySeconds = delay;
          acceptingAgents = false;
        }
        break;
      }
      case 'sitemap': {
        if (value) sitemaps.push(value);
        break;
      }
      default:
        break;
    }
  }

  return { groups, sitemaps, parsed: true };
}

/**
 * Pick the group for a user agent.
 *
 * RFC 9309: the most specific matching product token wins; `*` is the fallback
 * and is used only when no specific group matches.
 */
export function selectGroup(robots: RobotsFile, userAgent: string): RobotsGroup | null {
  const agent = userAgent.toLowerCase();
  let best: { group: RobotsGroup; score: number } | null = null;

  for (const group of robots.groups) {
    for (const candidate of group.userAgents) {
      if (candidate === '*') {
        if (!best) best = { group, score: 0 };
        continue;
      }
      if (agent.includes(candidate) && candidate.length > (best?.score ?? 0)) {
        best = { group, score: candidate.length };
      }
    }
  }
  return best?.group ?? null;
}

export interface RobotsDecision {
  allowed: boolean;
  /** The rule that decided it, for the audit trail. */
  rule: RobotsRule | null;
  crawlDelaySeconds: number | null;
}

export function isAllowed(robots: RobotsFile, userAgent: string, pathWithQuery: string): RobotsDecision {
  const group = selectGroup(robots, userAgent);
  if (!group) return { allowed: true, rule: null, crawlDelaySeconds: null };

  let winner: RobotsRule | null = null;
  for (const rule of group.rules) {
    if (!matchesPattern(rule.pattern, pathWithQuery)) continue;
    if (
      !winner ||
      rule.length > winner.length ||
      // Equal specificity: Allow wins, per the standard.
      (rule.length === winner.length && rule.type === 'ALLOW')
    ) {
      winner = rule;
    }
  }

  return {
    allowed: winner === null || winner.type === 'ALLOW',
    rule: winner,
    crawlDelaySeconds: group.crawlDelaySeconds,
  };
}

/** robots.txt globbing: `*` matches any run of characters, `$` anchors the end. */
export function matchesPattern(pattern: string, path: string): boolean {
  if (pattern === '') return false;
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;

  const escaped = body
    .split('*')
    .map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');

  return new RegExp(`^${escaped}${anchored ? '$' : ''}`).test(path);
}

// ---------------------------------------------------------------------------
// Fetching and caching
// ---------------------------------------------------------------------------

export interface RobotsFetcher {
  /** Returns the body, or null when the file is absent (4xx) or unusable. */
  fetch(robotsUrl: string): Promise<{ status: number; body: string } | null>;
}

interface CachedRobots {
  file: RobotsFile;
  expiresAt: number;
  /** True when a 5xx made us fail closed. */
  failedClosed: boolean;
}

export interface RobotsCheckerOptions {
  userAgent: string;
  fetcher: RobotsFetcher;
  ttlMs?: number;
  /** How long a 5xx keeps the host disallowed. */
  serverErrorTtlMs?: number;
  now?: () => number;
}

/**
 * Caches robots.txt per origin and answers allow/deny.
 *
 * The cache is not an optimisation, it is a requirement: without it, every
 * fetch would double the request count on every source we are trying to be
 * polite to.
 */
export class RobotsChecker {
  private readonly cache = new Map<string, CachedRobots>();
  private readonly inflight = new Map<string, Promise<CachedRobots>>();
  private readonly now: () => number;

  private readonly options: RobotsCheckerOptions;

  constructor(options: RobotsCheckerOptions) {
    this.options = options;

    this.now = options.now ?? (() => Date.now());
  }

  async check(url: string): Promise<RobotsDecision> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { allowed: false, rule: null, crawlDelaySeconds: null };
    }

    const origin = parsed.origin;
    const entry = await this.load(origin);

    if (entry.failedClosed) {
      return { allowed: false, rule: null, crawlDelaySeconds: null };
    }

    return isAllowed(entry.file, this.options.userAgent, parsed.pathname + parsed.search);
  }

  private async load(origin: string): Promise<CachedRobots> {
    const cached = this.cache.get(origin);
    if (cached && this.now() < cached.expiresAt) return cached;

    // Single-flight: a burst of tasks against one host must not each fetch it.
    const existing = this.inflight.get(origin);
    if (existing) return existing;

    const promise = this.fetchAndParse(origin).finally(() => this.inflight.delete(origin));
    this.inflight.set(origin, promise);
    return promise;
  }

  private async fetchAndParse(origin: string): Promise<CachedRobots> {
    const ttl = this.options.ttlMs ?? 6 * 60 * 60 * 1000;
    const errorTtl = this.options.serverErrorTtlMs ?? 5 * 60 * 1000;

    let entry: CachedRobots;
    try {
      const response = await this.options.fetcher.fetch(`${origin}/robots.txt`);

      if (!response || response.status === 404 || (response.status >= 400 && response.status < 500)) {
        // RFC 9309: unavailable means unrestricted.
        entry = { file: { groups: [], sitemaps: [], parsed: true }, expiresAt: this.now() + ttl, failedClosed: false };
      } else if (response.status >= 500) {
        // Unreachable means we do not know. Fail closed, briefly.
        entry = { file: EMPTY_ROBOTS, expiresAt: this.now() + errorTtl, failedClosed: true };
      } else {
        entry = { file: parseRobotsTxt(response.body), expiresAt: this.now() + ttl, failedClosed: false };
      }
    } catch {
      entry = { file: EMPTY_ROBOTS, expiresAt: this.now() + errorTtl, failedClosed: true };
    }

    this.cache.set(origin, entry);
    return entry;
  }

  /** Test/ops hook: seed a known robots.txt without a network round trip. */
  seed(origin: string, text: string, ttlMs = 3_600_000): void {
    this.cache.set(origin, {
      file: parseRobotsTxt(text),
      expiresAt: this.now() + ttlMs,
      failedClosed: false,
    });
  }

  clear(): void {
    this.cache.clear();
  }
}

export class RobotsDisallowedError extends Error {
  constructor(url: string, rule: RobotsRule | null) {
    super(`robots.txt disallows ${url}${rule ? ` (rule: ${rule.type} ${rule.pattern})` : ''}`);
    this.name = 'RobotsDisallowedError';
  }
}
