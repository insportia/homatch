#!/usr/bin/env node
/*
 * WHAT SHAPE IS THIS SOURCE, AND CAN THE FRAMEWORK READ IT?
 *
 * Writing an adapter needs four facts that only the site can answer:
 *
 *   1. does robots.txt permit the listing paths, and at what rate
 *   2. what does a DETAIL url look like, and where is the listing id in it
 *   3. is there a COLLECTION page that server-renders links to those details
 *   4. what does a detail page publish — schema.org, OpenGraph, or prose
 *
 * Guessing any of them is how an adapter ends up fetching 404s politely, or
 * reading an AGENCY page and reporting three listings with unique ids that
 * are agency ids. Both have happened here.
 *
 * WHAT IT DOES, EXACTLY
 *
 * Per host, at most: robots.txt, sitemap.xml, one child sitemap, one
 * collection candidate, and one detail page — five GETs, spaced, with the
 * identifying User-Agent. It follows no pagination, submits no forms, and
 * never touches a path robots.txt disallows.
 *
 * It is not a crawler and must not become one. No queue, no recursion, run
 * by a person against a named host.
 *
 * WHAT IT DOES NOT DO
 *
 * Decide anything. It prints what it found; a person reads it and writes a
 * configuration, or decides the source needs a hand-written adapter, or
 * records that it cannot be read at all. A source that fails here is a
 * finding, not a failure — brokeri.ge has 4,006 listings in its sitemap and
 * no server-rendered collection page, and knowing that is worth more than
 * another adapter.
 *
 * Usage: node scripts/audit-source-shape.mjs <host> [host ...] [--json]
 */
const USER_AGENT =
  'HomatchResearch/1.0 (+https://homatch.ge/research-bot; respects robots.txt and rate limits)';

const args = process.argv.slice(2);
const JSON_ONLY = args.includes('--json');
const HOSTS = args.filter((a) => !a.startsWith('--'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, accept = 'text/html,*/*') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT, accept },
    });
    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      text: await response.text(),
    };
  } catch (error) {
    return { ok: false, status: 0, url, text: '', error: String(error?.message ?? error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The rules that apply to US, not to Googlebot.
 *
 * A site that grants Crawl-delay: 0 to facebookexternalhit and says nothing
 * to `*` has not given us a rate — so the adapter picks a conservative one
 * and the policy says it was ours.
 */
function robotsFor(text) {
  const groups = [];
  let current = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [keyRaw, ...rest] = line.split(':');
    const key = keyRaw.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      if (!current || current.started) { current = { agents: [], disallow: [], allow: [], delay: null, started: false }; groups.push(current); }
      current.agents.push(value.toLowerCase());
    } else if (current) {
      current.started = true;
      if (key === 'disallow' && value) current.disallow.push(value);
      if (key === 'allow' && value) current.allow.push(value);
      if (key === 'crawl-delay') current.delay = Number(value);
    }
  }
  const star = groups.find((g) => g.agents.includes('*'));
  return {
    groupCount: groups.length,
    appliesToUs: star
      ? { disallow: star.disallow, allow: star.allow, crawlDelay: star.delay }
      : null,
    /* Named agents get their own rules; ours is not among them, but seeing
       that a site grants one crawler a delay of 0 and us nothing is useful. */
    namedAgents: groups.filter((g) => !g.agents.includes('*')).map((g) => g.agents.join(',')),
  };
}

const locs = (xml) => [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);

/** A path with every id-looking run replaced, so shapes can be counted. */
function shapeOf(url) {
  try {
    return new URL(url).pathname
      .replace(/\d{3,}/g, '<id>')
      .replace(/\/[^/]{30,}/g, '/<slug>');
  } catch { return url; }
}

/** Absolute, de-duplicated hrefs in document order. */
function links(html, base) {
  const out = [];
  const seen = new Set();
  for (const m of String(html).matchAll(/href=["']([^"'#\s]+)["']/gi)) {
    try {
      const absolute = new URL(m[1], base).toString();
      if (!seen.has(absolute)) { seen.add(absolute); out.push(absolute); }
    } catch { /* a malformed href is not worth a stack trace */ }
  }
  return out;
}

/** What a page publishes about itself. */
function publishes(html) {
  const types = new Set();
  for (const m of String(html).matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const t of m[1].matchAll(/"@type"\s*:\s*"([^"]+)"/g)) types.add(t[1]);
  }
  const og = [...String(html).matchAll(/property=["']og:([a-z:]+)["']/gi)].map((m) => m[1]);
  return {
    jsonLdTypes: [...types].sort(),
    ogKeys: [...new Set(og)].sort(),
    microdata: (String(html).match(/itemprop=/g) ?? []).length,
    /* A shell that renders client-side has almost no text for its size. */
    bytes: String(html).length,
    visibleTextLength: String(html)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim().length,
  };
}

async function audit(host) {
  const result = { host, robots: null, sitemap: null, detailShapes: [], collection: null, detail: null, notes: [] };

  const robots = await get(`https://${host}/robots.txt`, 'text/plain');
  result.robots = robots.ok
    ? { status: robots.status, ...robotsFor(robots.text) }
    : { status: robots.status, error: robots.error ?? 'no robots.txt' };
  await sleep(2000);

  const index = await get(`https://${host}/sitemap.xml`, 'application/xml,text/xml,*/*');
  if (!index.ok) {
    result.sitemap = { status: index.status, urls: 0 };
    result.notes.push('no sitemap.xml; a collection page must be found by hand');
  } else {
    const children = locs(index.text).filter((u) => /\.xml/i.test(u));
    let urls = locs(index.text).filter((u) => !/\.xml/i.test(u));
    if (children.length > 0) {
      /*
       * WHICH CHILD SITEMAP HOLDS THE LISTINGS.
       *
       * Picking children[0] landed on an agency sitemap once and reported
       * agency URLs as the listing shape; a name-match on "categor" landed
       * on makler.ge's category index and a WordPress post-sitemap gave
       * caucasusestate.ge's blog. So there are two rules now, and the
       * REJECT list does most of the work: a site's sitemap index is mostly
       * things that are not listings.
       */
      const REJECT = /(categor|post|page|blog|author|tag|news|misc|image|video|static|brand)/i;
      const PREFER = /(propert|listing|object|estate|realt|sale|rent|flat|apart|ads?[-_.]|catalog|item|offer)/i;
      const ranked = [
        ...children.filter((u) => PREFER.test(u) && !REJECT.test(u)),
        ...children.filter((u) => !PREFER.test(u) && !REJECT.test(u)),
        ...children.filter((u) => PREFER.test(u) && REJECT.test(u)),
      ];
      const preferred = ranked[0] ?? children[0];
      result.notes.push(`followed child sitemap ${preferred}`);
      /* Every child, so a bad pick is visible rather than invisible. */
      result.childSitemapNames = children.slice(0, 25).map((u) => u.split('/').pop());
      await sleep(2000);
      const child = await get(preferred, 'application/xml,text/xml,*/*');
      if (child.ok) urls = locs(child.text);
      else result.notes.push(`child sitemap answered ${child.status}`);
    }
    const counts = new Map();
    for (const u of urls) counts.set(shapeOf(u), (counts.get(shapeOf(u)) ?? 0) + 1);
    result.sitemap = { status: index.status, childSitemaps: children.length, urls: urls.length };
    result.detailShapes = [...counts.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([shape, n]) => ({ shape, n }));
    /* A URL with a numeric run is the one most likely to carry an id. */
    const sample = urls.find((u) => /\d{3,}/.test(u)) ?? urls[0];
    if (sample) {
      await sleep(2000);
      const detail = await get(sample);
      result.detail = detail.ok
        ? { url: detail.url, status: detail.status, ...publishes(detail.text) }
        : { url: sample, status: detail.status, error: detail.error };
    }
  }

  return result;
}

const results = [];
for (const host of HOSTS) {
  results.push(await audit(host));
  await sleep(3000);
}

if (JSON_ONLY) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const r of results) {
    console.log(`\n=== ${r.host} ===`);
    const rb = r.robots ?? {};
    console.log(`  robots ${rb.status}${rb.error ? ` (${rb.error})` : ''}`
      + (rb.appliesToUs
        ? ` | for *: ${rb.appliesToUs.disallow.length} disallow, crawl-delay ${rb.appliesToUs.crawlDelay ?? 'none stated'}`
        : ' | no group for *'));
    if (rb.appliesToUs?.disallow?.length) {
      console.log(`    disallow: ${rb.appliesToUs.disallow.slice(0, 8).join(' ')}`);
    }
    console.log(`  sitemap ${r.sitemap?.status ?? '-'} | ${r.sitemap?.urls ?? 0} url(s), ${r.sitemap?.childSitemaps ?? 0} child sitemap(s)`);
    for (const s of r.detailShapes) console.log(`    ${String(s.n).padStart(6)}  ${s.shape}`);
    if (r.detail) {
      console.log(`  detail ${r.detail.status} ${r.detail.url}`);
      if (r.detail.error) console.log(`    ${r.detail.error}`);
      else {
        console.log(`    json-ld: ${r.detail.jsonLdTypes.join(', ') || 'none'}`);
        console.log(`    og: ${r.detail.ogKeys.join(', ') || 'none'} | microdata ${r.detail.microdata}`);
        console.log(`    ${r.detail.bytes} bytes, ${r.detail.visibleTextLength} of visible text`
          + (r.detail.visibleTextLength < 1500 ? '  <-- likely a client-rendered shell' : ''));
      }
    }
    if (r.childSitemapNames?.length) {
      console.log(`  child sitemaps: ${r.childSitemapNames.join(' ')}`);
    }
    for (const n of r.notes) console.log(`  note: ${n}`);
  }
  console.log('\nThis script decides nothing. A shape here is a finding to read, not a source to enable.');
}
