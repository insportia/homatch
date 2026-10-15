#!/usr/bin/env node
/*
 * Find Property 2.0 — read-only portal discovery probe.
 *
 * For each candidate portal: robots.txt, homepage and sitemap index, fetched
 * once each with an honest User-Agent, no cookies, no proxy rotation, no
 * CAPTCHA or login handling. It reports what is publicly reachable and which
 * search/listing paths robots.txt allows; it never marks a provider
 * operational. An adapter is built only from what this reports, and only a
 * real page-1/page-2 search validates it.
 *
 *   node scripts/probe-find-property-portals.mjs [--json]
 *
 * Run from a network that can reach .ge hosts (the Claude cloud session
 * cannot). Spends nothing.
 */
// korter.ge is not probed: its terms of service forbid scraping (BLOCKED_BY_TERMS).
const PORTALS = ['www.myhome.ge', 'home.ss.ge', 'www.place.ge', 'home.ge', 'brokeri.ge', 'binebi.ge', 'allhome.ge'];
const UA = 'HOMATCH-portal-probe/1.0 (+https://homatch.live; read-only discovery)';
const TIMEOUT_MS = 15000;

async function get(url) {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xml,text/plain' }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = (await res.text()).slice(0, 400_000);
    return { status: res.status, finalUrl: res.url, ms: Date.now() - started, body, challenge: /captcha|cf-chl|challenge-platform|access denied/i.test(body) };
  } catch (e) {
    return { status: 0, error: String(e?.cause?.code ?? e?.name ?? e), ms: Date.now() - started, body: '' };
  }
}

function robotsRules(text) {
  const rules = { disallow: [], allow: [], sitemaps: [] };
  let applies = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const [k, ...rest] = line.split(':');
    const v = rest.join(':').trim();
    if (/^user-agent$/i.test(k)) applies = v === '*';
    else if (/^sitemap$/i.test(k)) rules.sitemaps.push(v);
    else if (applies && /^disallow$/i.test(k) && v) rules.disallow.push(v);
    else if (applies && /^allow$/i.test(k) && v) rules.allow.push(v);
  }
  return rules;
}

const report = [];
for (const host of PORTALS) {
  const base = `https://${host}`;
  const robots = await get(`${base}/robots.txt`);
  const rules = robots.status === 200 ? robotsRules(robots.body) : { disallow: [], allow: [], sitemaps: [] };
  const home = await get(`${base}/`);
  const links = [...new Set([...home.body.matchAll(/href="([^"#]{2,200})"/g)].map((m) => m[1]))]
    .filter((h) => /search|ყიდვ|იყიდება|sale|rent|qira|iyideba|kvartir|apartment|flat|ბინ|listing|catalog/i.test(h)).slice(0, 15);
  report.push({
    host,
    robots: robots.status, disallowAll: rules.disallow.includes('/'), disallow: rules.disallow.slice(0, 12), sitemaps: rules.sitemaps.slice(0, 5),
    home: home.status, homeError: home.error ?? null, challenge: !!home.challenge, finalUrl: home.finalUrl ?? null,
    candidateSearchLinks: links,
  });
}
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else for (const r of report) {
  console.log(`\n${r.host}: robots ${r.robots}${r.disallowAll ? ' (DISALLOW ALL)' : ''} · home ${r.home}${r.homeError ? ` ${r.homeError}` : ''}${r.challenge ? ' · CHALLENGE PAGE' : ''}`);
  if (r.sitemaps.length) console.log(`  sitemaps: ${r.sitemaps.join(', ')}`);
  if (r.disallow.length) console.log(`  disallow: ${r.disallow.join(' ')}`);
  for (const l of r.candidateSearchLinks) console.log(`  link: ${l}`);
}
