#!/usr/bin/env node
/* Read-only survey of CANDIDATE free portals (not yet adapters): robots.txt, the
 * sitemaps it declares, listing freshness, a few public listing pages and the
 * site's own terms. Same rules as the production loop: honest User-Agent, no
 * cookies, robots.txt honoured, a challenge page stops that host, ~1 request
 * per 2 s per host. Writes nothing anywhere. Needs a network that reaches .ge
 * hosts (a GitHub runner).  node scripts/portals/candidate-probe.mjs [host...] */
import { PORTAL_UA } from '../../official-worker/src/marketplace/portals/acquire.mjs';
import { robotsRules, robotsAllows } from '../../official-worker/src/marketplace/portals/acquire.mjs';

const HOSTS = process.argv.slice(2).length ? process.argv.slice(2) : ['livo.ge', 'makler.ge', 'home24.ge', 'estatemarket.ge', 'realtor.ge', 'ehome.ge'];
const CHALLENGE = /cf-chl|challenge-platform|just a moment\.\.\.|g-recaptcha|hcaptcha/i;
const TERMS_LINK = /href="([^"]*(?:terms|rules|policy|conditions|wesebi|pirobebi|წესები|პირობები)[^"]*)"/gi;
const TERMS_WORDS = /scrap|crawl|robot|automat|parser|harvest|copy|ავტომატ|კოპირ|პარს|სკრეპ|робот|парс|автоматич|копир/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = Date.now();

async function survey(host) {
  const out = { host, steps: [] };
  let origin = `https://${host}`; let rules = []; let blocked = null;
  const get = async (url, accept = 'text/html,application/xhtml+xml,application/xml') => {
    if (blocked) return null;
    if (!robotsAllows(rules, url)) { out.steps.push({ url, skipped: 'ROBOTS_DISALLOWED' }); return null; }
    await sleep(2000);
    const t0 = Date.now();
    try {
      const res = await fetch(url, { headers: { 'user-agent': PORTAL_UA, accept, 'accept-language': 'ka,en;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
      const text = await res.text();
      const step = { url, final: res.url, status: res.status, bytes: text.length, ms: Date.now() - t0, server: res.headers.get('server'), cfRay: !!res.headers.get('cf-ray') };
      if ([401, 403, 429].includes(res.status) || CHALLENGE.test(text.slice(0, 30000))) { step.blocked = CHALLENGE.test(text.slice(0, 30000)) ? 'CHALLENGE' : `HTTP_${res.status}`; blocked = step.blocked; }
      out.steps.push(step);
      return res.ok && !step.blocked ? { text, url: res.url } : null;
    } catch (e) { out.steps.push({ url, error: String(e?.cause?.code ?? e?.message ?? e).slice(0, 160) }); return null; }
  };
  const robots = await get(`${origin}/robots.txt`, 'text/plain');
  if (robots) { rules = robotsRules(robots.text); out.robots = robots.text.slice(0, 2500); origin = new URL(robots.url).origin; }
  const sitemaps = robots ? [...robots.text.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]) : [];
  out.declaredSitemaps = sitemaps;
  const home = await get(`${origin}/`);
  if (home) {
    const h = home.text;
    out.home = { title: (h.match(/<title[^>]*>([^<]{0,160})/i) ?? [])[1] ?? null, jsonLdTypes: [...h.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map((m) => m[1]).slice(0, 20),
      appShell: /<div id="(?:root|app|__next)"[^>]*>\s*<\/div>/.test(h), nextData: h.includes('__NEXT_DATA__'), nuxt: h.includes('__NUXT__'),
      numericLinks: [...new Set([...h.matchAll(/href="([^"]*\d{5,10}[^"]*)"/g)].map((m) => m[1]))].slice(0, 12) };
    const terms = [...new Set([...h.matchAll(TERMS_LINK)].map((m) => new URL(m[1], origin).href))].filter((u) => new URL(u).host.endsWith(host)).slice(0, 2);
    out.terms = [];
    for (const t of terms) {
      const page = await get(t);
      if (!page) continue;
      const plain = page.text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      out.terms.push({ url: t, chars: plain.length, relevant: plain.split(/(?<=[.!?;])\s+/).filter((s) => TERMS_WORDS.test(s)).slice(0, 8).map((s) => s.slice(0, 300)) });
    }
  }
  /* Sitemaps: index → children; count listing-looking URLs and their lastmod freshness. */
  const seen = []; const queue = [...sitemaps];
  let listingUrls = []; const lastmods = [];
  while (queue.length && seen.length < 6) {
    const sm = queue.shift(); seen.push(sm);
    const page = await get(sm, 'application/xml,text/xml');
    if (!page) continue;
    const children = [...page.text.matchAll(/<sitemap>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g)].map((m) => ({ loc: m[1].trim(), lastmod: m[2] ?? null }));
    if (children.length) {
      out.sitemapIndex = [...(out.sitemapIndex ?? []), { sitemap: sm, children: children.length, sample: children.slice(0, 15) }];
      /* listing-ish children first, newest first */
      children.sort((a, b) => (/(ad|listing|propert|statement|product|object|realty|annonce|post)/i.test(b.loc) - /(ad|listing|propert|statement|product|object|realty|annonce|post)/i.test(a.loc)) || String(b.lastmod).localeCompare(String(a.lastmod)));
      queue.push(...children.slice(0, 3).map((c) => c.loc));
      continue;
    }
    const urls = [...page.text.matchAll(/<url>\s*<loc>([^<]+)<\/loc>(?:[\s\S]*?<lastmod>([^<]+)<\/lastmod>)?/g)].map((m) => ({ loc: m[1].trim(), lastmod: m[2] ?? null }));
    const listings = urls.filter((u) => /\d{5,10}/.test(new URL(u.loc).pathname));
    listingUrls.push(...listings.map((u) => u.loc));
    for (const u of listings) if (u.lastmod) lastmods.push(Date.parse(u.lastmod));
    out.sitemaps = [...(out.sitemaps ?? []), { sitemap: sm, urls: urls.length, listingLike: listings.length, sample: listings.slice(0, 4) }];
  }
  const valid = lastmods.filter(Number.isFinite);
  out.freshness = { withLastmod: valid.length, within30d: valid.filter((t) => now - t <= 30 * 864e5).length, within7d: valid.filter((t) => now - t <= 7 * 864e5).length,
    newest: valid.length ? new Date(Math.max(...valid)).toISOString() : null };
  if (!listingUrls.length && out.home?.numericLinks) listingUrls = out.home.numericLinks.map((l) => new URL(l, origin).href);
  out.details = [];
  for (const url of [...new Set(listingUrls)].sort((a, b) => Number((b.match(/\d{5,10}/) ?? [0])[0]) - Number((a.match(/\d{5,10}/) ?? [0])[0])).slice(0, 3)) {
    const page = await get(url);
    if (!page) continue;
    const h = page.text;
    out.details.push({ url, jsonLdTypes: [...new Set([...h.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map((m) => m[1]))].slice(0, 15),
      og: { title: (h.match(/property="og:title" content="([^"]{0,140})/) ?? [])[1] ?? null, image: /property="og:image"/.test(h) },
      priceHint: (h.match(/(?:\$|₾|USD|GEL|ლარი)[^<]{0,30}/) ?? [])[0] ?? null,
      dates: [...new Set([...h.matchAll(/\b(20\d{2}-\d{2}-\d{2}|\d{2}\.\d{2}\.20\d{2})\b/g)].map((m) => m[1]))].slice(0, 6),
      mapCoords: /"latitude"|data-lat|lat=/.test(h), sqm: /მ²|m²|кв\.? ?м|sq\.? ?m/i.test(h) });
  }
  out.blocked = blocked;
  return out;
}

for (const host of HOSTS) {
  const r = await survey(host).catch((e) => ({ host, crash: String(e?.stack ?? e).slice(0, 500) }));
  console.log('PROBE ' + JSON.stringify(r));
}
