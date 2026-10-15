#!/usr/bin/env node
/* Read-only page dump for adapter fixtures: robots-checked GETs, gzip+base64 in log chunks. */
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { PORTAL_ADAPTERS } from '../../official-worker/src/marketplace/portals/adapters.mjs';
import { assignedJson } from '../../official-worker/src/marketplace/portals/html.mjs';
const UA = 'Mozilla/5.0 (compatible; HOMATCH-FindProperty/1.0; +https://homatch.live)';
const robots = new Map();
async function allowed(url) {
  const u = new URL(url);
  if (!robots.has(u.host)) {
    const r = await fetch(`${u.origin}/robots.txt`, { headers: { 'user-agent': UA } }).then((x) => x.ok ? x.text() : '').catch(() => '');
    const rules = []; let on = false;
    for (const raw of r.split(/\r?\n/)) { const l = raw.replace(/#.*/, '').trim(); const i = l.indexOf(':'); if (i < 0) continue; const k = l.slice(0, i).trim().toLowerCase(), v = l.slice(i + 1).trim();
      if (k === 'user-agent') on = v === '*'; else if (on && k === 'disallow' && v) rules.push(new RegExp('^' + v.replace(/^https?:\/\/[^/]+/, '').replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'))); }
    robots.set(u.host, rules);
  }
  return !robots.get(u.host).some((re) => re.test(u.pathname + u.search));
}
const lines = readFileSync(new URL('./dump-targets.txt', import.meta.url), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
for (const line of lines) {
  const [name, url, parser] = line.split(/\s+/);
  if (!(await allowed(url))) { console.log(`DUMPSKIP ${name} robots ${url}`); continue; }
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html', 'accept-language': 'ka,en;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(25000) }).catch((e) => ({ status: 0, url, text: async () => String(e) }));
  const html = await res.text();
  if (parser) { const a = PORTAL_ADAPTERS.find((x) => x.sourceId === parser); const items = a.parseList(html, url, {});
    const f = assignedJson(html, 'window.INITIAL_STATE')?.filtersStore?.filters;
    console.log(`PROBE ${name} status=${res.status} n=${items.length} ` + JSON.stringify({ filters: f ? { price: f.price, roomCounts: f.roomCounts, area: f.area } : undefined, rows: items.map((i) => [i.sourceListingId, i.price, i.currency, i.rooms, i.areaSqm]) }));
    await new Promise((r) => setTimeout(r, 1500)); continue; }
  if (/^\s*<\?xml/.test(html)) { const locs = [...html.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]); console.log(`XMLSUMMARY ${name} status=${res.status} locs=${locs.length}`); for (const l of locs.slice(0, 60)) console.log(`XMLLOC ${name} ${l}`); continue; }
  const b64 = gzipSync(Buffer.from(html)).toString('base64');
  console.log(`DUMPHEAD ${name} status=${res.status} final=${res.url} bytes=${html.length} chunks=${Math.ceil(b64.length / 6000)}`);
  for (let i = 0; i < b64.length; i += 6000) console.log(`DUMP ${name} ${i / 6000} ${b64.slice(i, i + 6000)}`);
  await new Promise((r) => setTimeout(r, 1500));
}
