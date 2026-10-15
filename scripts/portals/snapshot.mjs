#!/usr/bin/env node
/*
 * Find Property portal snapshot — read-only structure dump for adapter work.
 *
 * Fetches a handful of public pages per portal with an honest User-Agent,
 * honours robots.txt Disallow rules for '*', never sends cookies, never retries
 * past a refusal, and prints structure (link patterns, forms, embedded data
 * blobs, API paths) — not whole pages. No CAPTCHA, login or challenge handling.
 *
 *   node scripts/portals/snapshot.mjs [--urls url1,url2] [--portal host]
 */
const UA = 'HOMATCH-portal-snapshot/1.0 (+https://homatch.live; read-only adapter research)';
const PORTALS = {
  'place.ge': 'https://place.ge/', 'home.ge': 'https://www.home.ge/', 'brokeri.ge': 'https://brokeri.ge/',
  'binebi.ge': 'https://binebi.ge/', 'korter.ge': 'https://korter.ge/', 'allhome.ge': 'https://allhome.ge/',
};
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const robotsCache = new Map();
async function get(url) {
  const t = Date.now();
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'accept-language': 'ka,en;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const body = await res.text();
    return { status: res.status, url: res.url, ms: Date.now() - t, type: res.headers.get('content-type'), server: res.headers.get('server'), body };
  } catch (e) { return { status: 0, url, ms: Date.now() - t, error: String(e?.cause?.code ?? e?.name ?? e), body: '' }; }
}
async function allowed(url) {
  const u = new URL(url);
  if (!robotsCache.has(u.host)) {
    const r = await get(`${u.origin}/robots.txt`);
    const dis = []; let applies = false;
    for (const line of (r.status === 200 ? r.body : '').split(/\r?\n/)) {
      const [k, ...v] = line.replace(/#.*/, '').split(':'); const val = v.join(':').trim();
      if (/^user-agent$/i.test(k.trim())) applies = val === '*';
      else if (applies && /^disallow$/i.test(k.trim()) && val) dis.push(val);
    }
    robotsCache.set(u.host, { status: r.status, dis });
    console.log(`  robots ${u.host}: ${r.status} disallow=${JSON.stringify(dis.slice(0, 25))}`);
  }
  const { dis } = robotsCache.get(u.host);
  return !dis.some((d) => (u.pathname + u.search).startsWith(d.replace(/\*.*$/, '')));
}
function structure(page, origin) {
  const b = page.body;
  const title = (b.match(/<title[^>]*>([^<]{0,160})/i) ?? [])[1];
  const links = [...b.matchAll(/href="([^"#]{2,300})"/g)].map((m) => m[1]).map((h) => { try { return new URL(h, origin); } catch { return null; } }).filter((u) => u && u.host.replace(/^www\./, '') === new URL(origin).host.replace(/^www\./, ''));
  const shape = new Map();
  for (const u of links) { const k = u.pathname.replace(/\d{3,}/g, 'N').replace(/\/+$/, '') || '/'; shape.set(k, (shape.get(k) ?? 0) + 1); }
  const top = [...shape.entries()].sort((a, b) => b[1] - a[1]).slice(0, 45);
  const samples = [...new Set(links.filter((u) => /\d{4,}/.test(u.pathname)).map((u) => u.pathname + u.search))].slice(0, 8);
  const forms = [...b.matchAll(/<form[^>]*action="([^"]*)"[^>]*>([\s\S]{0,3000}?)<\/form>/gi)].slice(0, 4).map((m) => ({ action: m[1], inputs: [...m[2].matchAll(/name="([^"]+)"/g)].map((x) => x[1]).slice(0, 30) }));
  const blobs = ['__NEXT_DATA__', '__NUXT__', '__INITIAL_STATE__', '__APOLLO_STATE__', 'application/ld+json', '__PRELOADED_STATE__', 'window.__data'].filter((k) => b.includes(k));
  const apis = [...new Set([...b.matchAll(/["'`](https?:\/\/[a-z0-9.-]*(?:api|gateway|graphql)[a-z0-9.-]*[^"'`\s]{0,80}|\/api\/[^"'`\s]{2,80})["'`]/gi)].map((m) => m[1]))].slice(0, 20);
  const next = b.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]{0,1800})/);
  return { title, bytes: b.length, top, samples, forms, blobs, apis, next: next ? next[1].slice(0, 1500) : null };
}
async function inspect(url) {
  if (!(await allowed(url))) { console.log(`  SKIP (robots) ${url}`); return null; }
  const p = await get(url);
  const challenge = /cf-chl|challenge-platform|captcha|just a moment/i.test(p.body.slice(0, 20000));
  console.log(`\n### ${url}\n  status=${p.status} final=${p.url} ${p.ms}ms type=${p.type} server=${p.server}${p.error ? ' error=' + p.error : ''}${challenge ? ' CHALLENGE' : ''}`);
  if (p.status !== 200 || challenge) return p;
  const s = structure(p, p.url);
  console.log(`  title=${JSON.stringify(s.title)} bytes=${s.bytes} blobs=${s.blobs.join(',') || '-'}`);
  console.log(`  forms=${JSON.stringify(s.forms)}`);
  console.log(`  apis=${JSON.stringify(s.apis)}`);
  console.log(`  listing-like samples=${JSON.stringify(s.samples)}`);
  for (const [k, n] of s.top) console.log(`    ${String(n).padStart(4)}  ${k}`);
  if (s.next) console.log(`  NEXT_DATA: ${s.next}`);
  return p;
}
const only = arg('--portal');
const urls = arg('--urls');
if (urls) { for (const u of urls.split(',')) { await inspect(u); await new Promise((r) => setTimeout(r, 1500)); } }
else for (const [host, home] of Object.entries(PORTALS)) {
  if (only && only !== host) continue;
  console.log(`\n================ ${host}`);
  await inspect(home);
  await new Promise((r) => setTimeout(r, 1500));
}
