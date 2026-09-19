/*
 * THE VILLION MARKET-DISCOVERY PROBE.
 *
 * Runs the discovery plan against the sources that were technically verified,
 * over real HTTP, and reports what actually came back. It exists so that a
 * claim about discovery breadth can be checked rather than believed.
 *
 * It deliberately does NOT invoke the paid Verify pipeline: no research-agent,
 * no synthesis, no credits. It is the market-discovery path only.
 *
 * Run: node --experimental-strip-types tools/marketDiscoveryProbe.mjs
 */
import { buildDiscoveryPlan, localQueries } from '../src/research-core/market/discoveryPlan.ts';
import {
  classifyTier, dedupeSyndicated, statsByTier, headlineTier, TIER_ORDER,
} from '../src/research-core/market/geoTier.ts';

const UA = 'Mozilla/5.0 (compatible; HomatchResearch/1.0; +https://homatch.live)';
const TIMEOUT_MS = 20_000;

const SUBJECT = {
  project: 'Villion',
  street: 'კრწანისის',
  streetNumber: '6',
  district: 'კრწანისი',
  city: 'თბილისი',
  developer: 'შპს მილენიო გრუპი',
};

const SUBJECT_LOCATION = {
  project: 'Villion',
  street: 'კრწანისის ქუჩა',
  streetNumber: '6',
  district: 'კრწანისი',
  city: 'თბილისი',
  adjacentStreets: ['გორგასლის ქუჩა', 'ორთაჭალის ქუჩა'],
};

async function get(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: ctl.signal });
    if (!res.ok) return { ok: false, status: res.status, body: '' };
    return { ok: true, status: res.status, body: await res.text() };
  } catch (e) {
    return { ok: false, status: 0, body: '', error: String(e).slice(0, 80) };
  } finally {
    clearTimeout(t);
  }
}

/*
 * realting.com — verified server-rendered.
 *
 * robots.txt disallows `/*?`, so only clean paths may be fetched; the listing
 * cards carry data-object-id and data-price-USD attributes.
 */
function parseRealting(html, sourceLabel) {
  const out = [];
  const seen = new Set();
  const re = /data-object-id="(\d+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const around = html.slice(Math.max(0, m.index - 4000), m.index + 2500);
    const price = around.match(/data-price-USD="\$?\s*([0-9\s, ]+)"/);
    const area = around.match(/([0-9]+(?:[.,][0-9]+)?)\s*(?:m²|м²|кв\.м)/);
    const addr = around.match(/>\s*([^<>{}]{8,90}(?:Tbilisi|Тбилиси|თბილისი)[^<>{}]{0,40})\s*</i);
    const priceNum = price ? Number(price[1].replace(/[\s, ]/g, '')) : null;
    const areaNum = area ? Number(area[1].replace(',', '.')) : null;
    out.push({
      source: sourceLabel,
      url: `https://realting.com/#${id}`,
      address: addr ? addr[1].trim() : null,
      title: null,
      price: Number.isFinite(priceNum) && priceNum > 0 ? priceNum : null,
      area: Number.isFinite(areaNum) && areaNum > 0 ? areaNum : null,
      pricePerSqm: Number.isFinite(priceNum) && Number.isFinite(areaNum) && areaNum > 0
        ? Math.round(priceNum / areaNum) : null,
      rooms: null, floor: null, condition: null, sellerType: 'UNKNOWN',
    });
  }
  return out;
}

/* Sources reachable over plain HTTP with a clean path. */
const SOURCES = [
  { id: 'realting.com', lang: 'en', url: 'https://realting.com/property-for-sale/georgia/tbilisi', parse: parseRealting },
];

const plan = buildDiscoveryPlan(SUBJECT, { international: true });

console.log('=== DISCOVERY PLAN ===');
console.log('formulations      :', plan.length);
console.log('local (<= micro)  :', localQueries(plan).length);
console.log('languages         :', [...new Set(plan.map((q) => q.language))].join(', '));
console.log('precision bands   :', [...new Set(plan.map((q) => q.precision))].join(', '));
console.log('first five        :');
for (const q of plan.slice(0, 5)) console.log(`   [${q.precision}/${q.language}] ${q.text}`);

console.log('\n=== SOURCE FETCH ===');
let raw = [];
let queried = 0;
let withResults = 0;
for (const src of SOURCES) {
  queried += 1;
  const res = await get(src.url);
  const items = res.ok ? src.parse(res.body, src.id) : [];
  if (items.length) withResults += 1;
  console.log(
    `${src.id.padEnd(18)} http=${String(res.status).padEnd(4)} listings=${String(items.length).padEnd(4)}`
    + (res.error ? ` (${res.error})` : '')
  );
  raw = raw.concat(items);
}

const { unique, duplicatesRemoved } = dedupeSyndicated(raw);
const tiered = unique.map((l) => ({ ...l, tier: classifyTier(l, SUBJECT_LOCATION) }));
const counts = Object.fromEntries(TIER_ORDER.map((t) => [t, 0]));
for (const l of tiered) counts[l.tier] += 1;
const seller = { OWNER: 0, BROKER: 0, DEVELOPER: 0, UNKNOWN: 0 };
for (const l of tiered) seller[l.sellerType ?? 'UNKNOWN'] += 1;

const stats = statsByTier(tiered, (l) => l.tier);
const head = headlineTier(stats);

console.log('\n=== VILLION / KRTSANISI RESULT ===');
console.log('TOTAL_RAW_RESULTS      =', raw.length);
console.log('TOTAL_UNIQUE_RESULTS   =', unique.length);
console.log('DUPLICATES_REMOVED     =', duplicatesRemoved);
console.log('SOURCES_QUERIED        =', queried);
console.log('SOURCES_WITH_RESULTS   =', withResults);
console.log('LANGUAGES_QUERIED      =', [...new Set(plan.map((q) => q.language))].length);
for (const t of TIER_ORDER) console.log(`${t.padEnd(30)} =`, counts[t]);
console.log('OWNER / BROKER / DEV / UNKNOWN =',
  seller.OWNER, '/', seller.BROKER, '/', seller.DEVELOPER, '/', seller.UNKNOWN);
console.log('\nPER-TIER STATS (never merged):');
for (const s of stats) {
  console.log(`  ${s.tier.padEnd(30)} n=${String(s.sample).padEnd(4)} median=${s.median} range=${s.min}-${s.max}`);
}
console.log('HEADLINE_TIER          =', head ? head.tier : 'none (no local tier qualifies)');
