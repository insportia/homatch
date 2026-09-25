#!/usr/bin/env node
/*
 * WHICH OF THE AUDITED SITES CAN ACTUALLY BE READ, AND HOW?
 *
 * The audit established that eighteen sites permit HomatchResearch to read
 * their listing paths. Permission is not parseability, and choosing the first
 * adapter batch by guessing which portals "look modern" is how you spend a
 * week on a site that renders everything from a private API.
 *
 * So this asks each site what it publishes ABOUT ITSELF:
 *
 *   sitemap.xml        does it tell us where its listings are?
 *   JSON-LD            does it emit schema.org structured data?
 *   OpenGraph          does it at least emit og:* on a listing?
 *   listing URL shape  what does a detail page look like?
 *
 * A site with a sitemap and JSON-LD Product/Offer/RealEstateListing can be
 * read by the shared portal framework with a configuration row. A site with
 * neither needs a dedicated extractor, which is real work and should be spent
 * where it pays.
 *
 * WHAT IT DOES, EXACTLY
 *
 * Up to three GETs per host, several seconds apart, with the identifying
 * User-Agent: the sitemap index, one listing-collection URL taken from that
 * sitemap, and nothing else. It follows no pagination, submits no forms,
 * stores no content, and touches nothing robots.txt disallowed — the audit
 * already recorded those and the two BLOCKED hosts are skipped entirely.
 *
 * Usage: node scripts/probe-property-sources.mjs [--json]
 */
const USER_AGENT =
  'HomatchResearch/1.0 (+https://homatch.ge/research-bot; respects robots.txt and rate limits)';

/*
 * The eighteen the audit cleared. myhome.ge and krtsanisi.com are absent on
 * purpose: one refuses an identifying crawler with 403 and the other does not
 * resolve, and both are recorded BLOCKED. Probing them anyway would be
 * exactly the "try again and see" the lifecycle exists to prevent.
 */
const HOSTS = [
  'ss.ge', 'home.ss.ge', 'korter.ge', 'realting.com', 'home24.ge',
  'realtor.ge', 'place.ge', 'myhomesale.ge', 'estatemarket.ge', 'xeli.ge',
  'cgagency.ge', 'brokeri.ge', 'origencollection.com', 'makler.ge',
  'expathome.ge', 'topbroker.ge', 'caucasusestate.ge', 'zarayaproperties.com',
];

const JSON_ONLY = process.argv.includes('--json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xml,text/xml,*/*' },
    });
    const text = await response.text().catch(() => '');
    return { ok: response.ok, status: response.status, url: response.url, text };
  } catch (error) {
    return { ok: false, status: 0, url, text: '', error: String(error?.message ?? error) };
  } finally {
    clearTimeout(timer);
  }
}

/** schema.org types present in any ld+json block. */
function jsonLdTypes(html) {
  const types = new Set();
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        const t = node['@type'];
        if (typeof t === 'string') types.add(t);
        else if (Array.isArray(t)) t.forEach((x) => types.add(String(x)));
        Object.values(node).forEach(walk);
      };
      walk(JSON.parse(m[1].trim()));
    } catch { /* a malformed block is a finding in itself, counted below */ }
  }
  return [...types];
}

function ogKeys(html) {
  return [...new Set(
    [...html.matchAll(/<meta[^>]+property=["']og:([a-z:]+)["']/gi)].map((m) => m[1]),
  )].slice(0, 8);
}

/** Loc entries from a sitemap or sitemap index. */
function sitemapLocs(xml) {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
}

/**
 * A URL that looks like it lists or shows property, from a sitemap.
 *
 * Pattern-based and deliberately generous: this is choosing ONE page to look
 * at, not building an extractor. A wrong guess costs one request and shows up
 * as "no structured data", which is exactly what a human reviewing the table
 * needs to see.
 */
const LISTING_HINT = /(propert|listing|apartment|flat|house|sale|rent|obiekt|gancxadeb|item|ad\/|\/p\/|\/l\/)/i;

async function probe(host) {
  const base = `https://${host}`;
  const out = {
    host, sitemapFound: false, sitemapUrls: 0, listingSample: null,
    jsonLdTypes: [], ogKeys: [], hasMicrodata: false, bytes: 0,
    renderedClientSide: null, notes: [],
  };

  const robots = await get(`${base}/robots.txt`);
  const declared = robots.ok
    ? [...robots.text.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1])
    : [];
  const sitemapUrl = declared[0] ?? `${base}/sitemap.xml`;

  await sleep(2000);
  const sitemap = await get(sitemapUrl);
  if (sitemap.ok && /<(urlset|sitemapindex)/i.test(sitemap.text)) {
    out.sitemapFound = true;
    const locs = sitemapLocs(sitemap.text);
    out.sitemapUrls = locs.length;

    // A sitemap index points at more sitemaps; take one hop, no more.
    let candidates = locs.filter((u) => LISTING_HINT.test(u) && !/\.xml($|\?)/i.test(u));
    if (!candidates.length && /<sitemapindex/i.test(sitemap.text)) {
      const child = locs.find((u) => LISTING_HINT.test(u)) ?? locs[0];
      if (child) {
        await sleep(2500);
        const inner = await get(child);
        if (inner.ok) {
          const innerLocs = sitemapLocs(inner.text);
          out.sitemapUrls += innerLocs.length;
          candidates = innerLocs.filter((u) => !/\.xml($|\?)/i.test(u));
          out.notes.push('listing URLs come from a child sitemap');
        }
      }
    }
    out.listingSample = candidates[0] ?? null;
  } else {
    out.notes.push(sitemap.ok ? 'sitemap URL did not return a sitemap' : `sitemap HTTP ${sitemap.status}`);
  }

  // One listing page. The home page is a poor proxy: portals often emit
  // Organization on the home page and the useful types only on a detail page.
  const pageUrl = out.listingSample ?? base;
  await sleep(2500);
  const page = await get(pageUrl);
  if (page.ok) {
    out.bytes = page.text.length;
    out.jsonLdTypes = jsonLdTypes(page.text);
    out.ogKeys = ogKeys(page.text);
    out.hasMicrodata = /itemtype=["'][^"']*schema\.org/i.test(page.text);
    /*
     * A very small document with a big script bundle is a client-rendered
     * app: the markup a plain fetch sees is a shell. Recorded as a HINT, not
     * a verdict -- confirming it needs a render, which is a browser decision
     * and not this script's to make.
     */
    const textLength = page.text.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').trim().length;
    out.renderedClientSide = textLength < 800 && /<script/i.test(page.text);
    out.probedUrl = page.url;
  } else {
    out.notes.push(`listing page HTTP ${page.status}`);
  }

  return out;
}

async function main() {
  const results = [];
  for (const host of HOSTS) {
    const result = await probe(host);
    results.push(result);
    if (!JSON_ONLY) {
      const structured = result.jsonLdTypes.length
        ? `ld:${result.jsonLdTypes.slice(0, 3).join(',')}`
        : result.hasMicrodata ? 'microdata' : result.ogKeys.length ? `og:${result.ogKeys.length}` : 'none';
      process.stderr.write(
        `${result.host.padEnd(23)} sitemap=${String(result.sitemapFound).padEnd(5)}`
        + ` urls=${String(result.sitemapUrls).padStart(6)}`
        + ` ${structured.padEnd(34)}`
        + ` ${result.renderedClientSide ? 'CLIENT-RENDERED' : 'server-html'}`
        + (result.notes.length ? `  (${result.notes.join('; ')})` : '')
        + '\n',
      );
    }
    await sleep(1500);
  }
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`probe failed: ${error?.message ?? error}\n`);
  process.exit(1);
});
