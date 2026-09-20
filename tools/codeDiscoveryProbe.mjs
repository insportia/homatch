/*
 * THE CODE-ONLY MARKET-DISCOVERY PROBE.
 *
 * Runs the real code discovery path against the real public web: no search
 * API, no model, no credits. Sitemaps, robots.txt, public pages, JSON-LD and
 * DOM parsing — and the same normalization, resolution, deduplication and
 * tiering the Verify market lane uses.
 *
 *   node --experimental-strip-types tools/codeDiscoveryProbe.mjs
 *   node --experimental-strip-types tools/codeDiscoveryProbe.mjs --domains korter.ge,ss.ge
 *
 * It makes ordinary public HTTP requests as an identified bot, obeys
 * robots.txt on every fetch, and bypasses nothing.
 */
import { runCodeDiscovery } from '../src/research-core/market/codeDiscovery.ts';
import { buildCodeDiscoverySeeds } from '../src/research-core/market/codeDiscoveryTargets.ts';
import { SEED_DOMAINS } from '../src/research-core/market/discoverySources.ts';
import { TIER_ORDER, LOCAL_TIERS } from '../src/research-core/market/geoTier.ts';

const UA = 'HomatchResearch/1.0 (+https://homatch.ge/research-bot; respects robots.txt and rate limits)';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const SUBJECT = {
  names: ['Villion', 'ვილიონ', 'Вилион'],
  address: 'კრწანისის ქუჩა 6',
  streetStem: 'კრწანისის',
  streetNumber: '6',
  developer: 'შპს მილენიო გრუპი',
  // Published by korter.ge on the building's own page.
  lat: 41.67653101,
  lon: 44.82462376,
  district: 'კრწანისი',
  city: 'თბილისი',
  countryCode: 'GE',
  streetHints: ['Krtsanisi', 'Крцаниси', 'კრწანისი', 'krcanisi', 'krwanisi'],
};

/* ------------------------------------------------------------------ *
 * A plain, identified, rate-limited HTTP fetcher                      *
 * ------------------------------------------------------------------ */

const MIN_GAP_MS = 700;
const lastAt = new Map();

const fetcher = {
  id: 'PLAIN_HTTP',
  canDriveBrowser: false,
  async fetch(url) {
    // One request at a time per host, with a gap. A comparable sweep is a
    // handful of pages and the source owes us nothing.
    const host = new URL(url).hostname;
    const wait = (lastAt.get(host) ?? 0) + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt.set(host, Date.now());

    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml' },
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return { ok: false, status: res.status, body: '' };
      const type = res.headers.get('content-type') ?? '';
      // A 40 MB sitemap is real; an image is not worth reading.
      if (/image|video|font|octet-stream/i.test(type)) {
        return { ok: false, status: res.status, body: '' };
      }
      return { ok: true, status: res.status, body: await res.text(), contentType: type };
    } catch (e) {
      return { ok: false, status: 0, body: '', error: String(e).slice(0, 80) };
    }
  },
};

/* ------------------------------------------------------------------ *
 * Run                                                                 *
 * ------------------------------------------------------------------ */

const domains = arg('domains', '').trim()
  ? arg('domains', '').split(',').map((d) => d.trim()).filter(Boolean)
  : Object.keys(SEED_DOMAINS);

const seeds = buildCodeDiscoverySeeds(SUBJECT, domains);

console.log('=== CODE-ONLY DISCOVERY ===');
console.log('registered domains :', Object.keys(SEED_DOMAINS).length);
console.log('domains this run   :', domains.length);
console.log('seed targets       :', seeds.length);
console.log('search api         : NONE');

const began = Date.now();
const report = await runCodeDiscovery({
  subject: SUBJECT,
  seeds,
  fetcher,
  userAgent: UA,
  seededDomains: new Set(Object.keys(SEED_DOMAINS)),
  budget: {
    maxPages: Number(arg('maxPages', 80)),
    maxPagesPerDomain: Number(arg('perDomain', 14)),
    maxDepth: 2,
    deadlineMs: Number(arg('deadlineMs', 600_000)),
    enoughLocal: Number(arg('enoughLocal', 25)),
  },
});

const pad = (k) => String(k).padEnd(34);

console.log('\n=== COST ===');
console.log(pad('SEARCH_API_USED'), '= NONE');
console.log(pad('DATAFORSEO_CALLS'), '= 0');
console.log(pad('OPENAI_WEB_SEARCH_CALLS'), '= 0');
console.log(pad('OTHER_PAID_SEARCH_PROVIDER_CALLS'), '= 0');
console.log(pad('SEARCH_API_COST'), '= $0');

console.log('\n=== CRAWL ===');
console.log(pad('CODE_DISCOVERY_REQUESTS'), '=', report.codeDiscoveryRequests);
console.log(pad('PAGES_FETCHED'), '=', report.pagesFetched);
console.log(pad('BROWSER_PAGES_FETCHED'), '=', report.browserPagesFetched);
console.log(pad('SITEMAPS_USED'), '=', report.sitemapsUsed);
console.log(pad('CATEGORY_PAGES_USED'), '=', report.categoryPagesUsed);
console.log(pad('ROBOTS_DISALLOWED'), '=', report.robotsDisallowed);
console.log(pad('FETCH_FAILURES'), '=', report.fetchFailures);
console.log(pad('TRUNCATED_BY_DEADLINE'), '=', report.truncatedByDeadline);
console.log(pad('ELAPSED_S'), '=', Math.round((Date.now() - began) / 1000));

console.log('\n=== DOMAINS ===');
console.log(pad('DOMAINS_VISITED'), '=', report.domainsVisited.length);
console.log(pad('NEW_DOMAINS_DISCOVERED'), '=', report.newDomainsDiscovered.length);
console.log(pad('NEW_DOMAINS_ACCEPTED'), '=', report.newDomainsAccepted.length,
  report.newDomainsAccepted.join(', '));
console.log(pad('NEW_DOMAINS_REJECTED'), '=', report.newDomainsRejected.length);
console.log('\nper domain:');
for (const d of report.perDomain) {
  if (!d.pagesFetched && !d.localResults) continue;
  console.log(
    `  ${d.domain.padEnd(22)} ${d.seeded ? 'seed' : 'NEW '} pages=${String(d.pagesFetched).padEnd(3)}`
    + ` extracted=${String(d.extracted).padEnd(3)} local=${String(d.localResults).padEnd(3)}`
    + ` caps=[${d.capabilities.join(',')}]`,
  );
}

console.log('\n=== OUTCOMES ===');
for (const [k, v] of Object.entries(report.outcomes)) if (v) console.log(pad(k), '=', v);

console.log('\n=== DATASET ===');
console.log(pad('RAW_LISTINGS'), '=', report.rawListings);
console.log(pad('NORMALIZED_LISTINGS'), '=', report.listings.length);
console.log(pad('DUPLICATES_REMOVED'), '=', report.duplicatesRemoved);

console.log('\n=== GEOGRAPHIC TIERS (never merged) ===');
for (const t of TIER_ORDER) {
  console.log(`${pad(t)} = ${report.tierCounts[t]} located, ${report.tierCountsMeasurable[t]} priced`);
}

console.log('\nper-tier statistics (code-computed):');
for (const s of report.tierStats) {
  console.log(`  ${s.tier.padEnd(30)} n=${String(s.sample).padEnd(3)} median=${s.median} range=${s.min}-${s.max}`);
}
console.log(pad('HEADLINE_TIER'), '=',
  report.headline ? `${report.headline.tier} n=${report.headline.sample} median=${report.headline.median}` : 'none');

console.log('\n=== LOCAL EVIDENCE, AND THE PATH THAT FOUND EACH ===');
for (const l of report.listings.filter((x) => LOCAL_TIERS.includes(x.tier))) {
  const row = report.ledger.find((r) => r.url === l.url);
  console.log(
    `  [${l.tier}] ${l.sourceDomain}\n`
    + `      area=${l.area ?? '-'} rooms=${l.rooms ?? '-'} price/m2=${l.pricePerSqm ?? '-'}`
    + ` project=${l.project ?? '-'} addr=${l.address ?? '-'}\n`
    + `      via=${row?.path ?? '?'} depth=${row?.depth ?? '?'} url=${l.url}`,
  );
}

console.log('\n=== ACCEPTANCE ===');
console.log(pad('KNOWN_PUBLIC_LOCAL_EVIDENCE_DISCOVERED'), '=',
  report.knownPublicLocalEvidenceDiscovered ? 'YES' : 'NO');
const villion = report.listings.find((l) => /villion/i.test(l.project ?? ''));
console.log(pad('SUBJECT_PROJECT_PAGE'), '=',
  villion ? `${villion.project} / ${villion.developer ?? '-'} / ${villion.address ?? '-'}` : 'not recovered');
