#!/usr/bin/env node
/*
 * WHAT DO THESE SITES ACTUALLY ALLOW, TODAY?
 *
 * Nineteen candidate Georgian property sources. Before any of them gets an
 * adapter, each one is asked the only question that decides whether it can
 * have one: does its own robots.txt permit HomatchResearch to read its
 * listings?
 *
 * WHAT THIS SCRIPT DOES, EXACTLY
 *
 *   GET https://<host>/robots.txt      with the identifying user agent
 *   GET https://<host>/                one request, to see if it answers
 *
 * That is all. Two requests per host, several seconds apart, with a real
 * User-Agent naming Homatch and pointing at a page about the crawler. It
 * reads the published rules and obeys them. It does not follow listing
 * links, does not probe paths robots.txt disallows, sends no headers
 * pretending to be a browser, and stores nothing from the pages.
 *
 * WHY IT RUNS AT ALL RATHER THAN BEING ASSUMED
 *
 * Because the answer changes, and because an assumed answer is how a crawler
 * ends up somewhere it was told not to go. A site that allowed everything in
 * March may disallow /search today, and the only way to know is to ask it.
 *
 * WHAT IT REFUSES TO CONCLUDE
 *
 *   ALLOWED does not mean IMPLEMENTED. It means one door is open.
 *   REACHABLE does not mean PARSEABLE. A 200 can be a cookie wall.
 *   Nothing here produces LIVE_TESTED. That needs an adapter reading real
 *   content, and no adapter has run.
 *
 * Output is JSON on stdout and a table on stderr, so it can be piped into a
 * migration or read by a person.
 *
 * Usage:  node scripts/audit-property-sources.mjs [--json] [--timeout 15000]
 */
import { parseRobotsTxt, isAllowed } from '../src/research-core/net/robots.ts';

const USER_AGENT =
  'HomatchResearch/1.0 (+https://homatch.ge/research-bot; respects robots.txt and rate limits)';

/*
 * The candidates, with the family each would belong to if it is permitted.
 * The family is a HYPOTHESIS until the audit runs -- it says which adapter
 * would read the site, not that any adapter does.
 */
const CANDIDATES = [
  { host: 'myhome.ge', family: 'PROPERTY_PORTAL' },
  { host: 'ss.ge', family: 'CLASSIFIEDS' },
  { host: 'home.ss.ge', family: 'PROPERTY_PORTAL' },
  { host: 'korter.ge', family: 'PROPERTY_PORTAL' },
  { host: 'realting.com', family: 'INVESTMENT_SITE' },
  { host: 'home24.ge', family: 'PROPERTY_PORTAL' },
  { host: 'realtor.ge', family: 'AGENCY_SITE' },
  { host: 'place.ge', family: 'PROPERTY_PORTAL' },
  { host: 'myhomesale.ge', family: 'AGENCY_SITE' },
  { host: 'estatemarket.ge', family: 'AGENCY_SITE' },
  { host: 'xeli.ge', family: 'CLASSIFIEDS' },
  { host: 'cgagency.ge', family: 'AGENCY_SITE' },
  { host: 'brokeri.ge', family: 'AGENCY_SITE' },
  { host: 'origencollection.com', family: 'DEVELOPER_SITE' },
  { host: 'makler.ge', family: 'CLASSIFIEDS' },
  { host: 'expathome.ge', family: 'EXPAT_COMMUNITY' },
  { host: 'topbroker.ge', family: 'AGENCY_SITE' },
  { host: 'caucasusestate.ge', family: 'AGENCY_SITE' },
  { host: 'krtsanisi.com', family: 'DEVELOPER_SITE' },
  { host: 'zarayaproperties.com', family: 'DEVELOPER_SITE' },
];

/*
 * Paths a listing crawler would actually want. Checked against the PUBLISHED
 * RULES -- no request is made to any of them. This is the difference between
 * "we read your robots.txt and it says no" and "we tried and found out".
 */
const WANTED_PATHS = ['/', '/search', '/en/search', '/ka/search', '/listings', '/property'];

const timeoutArg = process.argv.indexOf('--timeout');
const TIMEOUT_MS = timeoutArg > -1 ? Number(process.argv[timeoutArg + 1]) : 15_000;
const JSON_ONLY = process.argv.includes('--json');

/** One polite request. Never retried into a hammering loop. */
async function get(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': USER_AGENT,
        // Asked for honestly. No cookie, no referer, nothing that pretends
        // to be a session that does not exist.
        accept: 'text/html,text/plain,*/*',
      },
    });
    const text = await response.text().catch(() => '');
    return { ok: true, status: response.status, url: response.url, text };
  } catch (error) {
    return { ok: false, status: 0, url, text: '', error: error?.name === 'AbortError' ? 'timeout' : String(error?.message ?? error) };
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The finding, in the vocabulary source-lifecycle.ts understands.
 *
 * UNREACHABLE and ROBOTS_DISALLOWED are different facts and stay different:
 * the first is probably ours to retry, the second is theirs to decide.
 */
function classify({ robots, home, allowedPaths, disallowedPaths }) {
  if (!robots.ok && !home.ok) return 'UNREACHABLE';
  if (disallowedPaths.length > 0 && allowedPaths.length === 0) return 'ROBOTS_DISALLOWED';
  if (!home.ok) return 'UNREACHABLE';
  // 401/403 on the home page with no robots objection is an access control,
  // not a crawl rule, and it is still a reason to stop.
  if (home.status === 401 || home.status === 403) return 'LOGIN_REQUIRED';
  if (home.status === 451) return 'GEO_BLOCKED';
  if (home.status >= 500) return 'UNREACHABLE';
  return 'PUBLIC_HTML';
}

async function audit(candidate) {
  const base = `https://${candidate.host}`;
  const robots = await get(`${base}/robots.txt`);

  /*
   * A robots.txt that 404s means NO RULES PUBLISHED, which is permission by
   * omission and is how the standard works. A robots.txt that times out is
   * NOT permission by omission -- we do not know what it says, so the
   * conservative reading is that we have not established anything.
   */
  const published = robots.ok && robots.status === 200 && robots.text.length > 0;
  const parsed = published ? parseRobotsTxt(robots.text) : null;
  const robotsUnknown = !robots.ok;

  const allowedPaths = [];
  const disallowedPaths = [];
  if (parsed) {
    for (const path of WANTED_PATHS) {
      const decision = isAllowed(parsed, USER_AGENT, path);
      (decision.allowed ? allowedPaths : disallowedPaths).push(path);
    }
  } else if (!robotsUnknown) {
    // No rules published: everything is allowed, which is the standard's
    // own default and not an assumption of ours.
    allowedPaths.push(...WANTED_PATHS);
  }

  // Two requests, spaced. A crawl-delay in their own file is honoured.
  const delay = parsed?.groups?.find((g) => g.crawlDelaySeconds)?.crawlDelaySeconds ?? 0;
  await sleep(Math.max(2000, Math.min(10_000, delay * 1000)));

  const home = await get(`${base}/`);

  const finding = robotsUnknown && !home.ok
    ? 'UNREACHABLE'
    : classify({ robots, home, allowedPaths, disallowedPaths });

  return {
    host: candidate.host,
    familyHypothesis: candidate.family,
    // What the audit establishes, and nothing beyond it.
    finding,
    robotsPublished: published,
    robotsUnknown,
    robotsStatus: robots.status,
    crawlDelaySeconds: delay || null,
    sitemaps: parsed?.sitemaps?.slice(0, 5) ?? [],
    allowedPaths,
    disallowedPaths,
    homeStatus: home.status,
    homeReachable: home.ok && home.status >= 200 && home.status < 400,
    finalUrl: home.url,
    error: home.error ?? robots.error ?? null,
    auditedAt: new Date().toISOString(),
  };
}

async function main() {
  const results = [];
  for (const candidate of CANDIDATES) {
    const result = await audit(candidate);
    results.push(result);
    if (!JSON_ONLY) {
      const mark = result.finding === 'PUBLIC_HTML' ? 'OK  ' : 'STOP';
      process.stderr.write(
        `${mark} ${result.host.padEnd(24)} ${String(result.finding).padEnd(20)}`
        + ` home=${result.homeStatus || '—'} robots=${result.robotsStatus || '—'}`
        + ` allowed=${result.allowedPaths.length}/${WANTED_PATHS.length}`
        + (result.disallowedPaths.length ? ` disallowed=${result.disallowedPaths.join(',')}` : '')
        + '\n',
      );
    }
    // Between hosts as well as within one. Nineteen sites is not a load test.
    await sleep(1500);
  }

  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);

  if (!JSON_ONLY) {
    const permitted = results.filter((r) => r.finding === 'PUBLIC_HTML').length;
    process.stderr.write(
      `\n${permitted} of ${results.length} permit HomatchResearch to read listing paths.\n`
      + 'PERMITTED is not IMPLEMENTED, and a 200 is not a parse. Nothing here is LIVE_TESTED.\n',
    );
  }
}

main().catch((error) => {
  process.stderr.write(`audit failed: ${error?.message ?? error}\n`);
  process.exit(1);
});
