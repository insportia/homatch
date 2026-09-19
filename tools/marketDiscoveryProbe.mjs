/*
 * THE VILLION MARKET-DISCOVERY PROBE.
 *
 * Runs the real discovery engine — the same runDiscovery() the Verify market
 * lane calls — and prints what it found, what it failed to find, and why. It
 * exists so a claim about discovery breadth can be checked rather than
 * believed.
 *
 * It deliberately does NOT invoke the paid Verify pipeline: no research-agent,
 * no synthesis, no credits, no model. It is the market-discovery path only.
 *
 *   node --experimental-strip-types tools/marketDiscoveryProbe.mjs
 *   node --experimental-strip-types tools/marketDiscoveryProbe.mjs --live
 *
 * ── WHAT --live MEANS, AND WHY IT IS NOT THE DEFAULT ─────────────────
 *
 * --live routes the search lane at supabase/functions/dataforseo-search, which
 * is currently held behind a deliberate kill switch and answers HTTP 423. The
 * probe reports that lock as PROVIDER_LOCKED. It does not bypass it, does not
 * read vendor credentials, and has no override flag.
 *
 * The default runs the engine over `tools/fixtures/krtsanisiHarvest.json` —
 * raw search-engine output recorded on 2026-09-20 across Georgian, English and
 * Russian formulations. The rows are evidence; every piece of discovery,
 * extraction, address resolution, project identity and tiering below is the
 * production code doing the work.
 */
import { readFileSync } from 'node:fs';
import { buildDiscoveryPlan, localQueries } from '../src/research-core/market/discoveryPlan.ts';
import { runDiscovery } from '../src/research-core/market/discoveryRun.ts';
import { harvestProvider } from '../src/research-core/market/searchProviders.ts';
import { dataForSeoProvider } from './providers/dataForSeoSearch.ts';
import { classifyDomain } from '../src/research-core/market/discoverySources.ts';
import { TIER_ORDER, LOCAL_TIERS } from '../src/research-core/market/geoTier.ts';

const LIVE = process.argv.includes('--live');

const SUBJECT = {
  project: 'Villion',
  street: 'კრწანისის ქუჩა',
  streetNumber: '6',
  district: 'კრწანისი',
  city: 'თბილისი',
  developer: 'შპს მილენიო გრუპი',
};

/** The subject as the resolver needs it: names, an address, and coordinates. */
const SUBJECT_GEO = {
  names: ['Villion', 'ვილიონ', 'Вилион'],
  address: 'კრწანისის ქუჩა 6',
  developer: 'შპს მილენიო გრუპი',
  // Published by korter.ge on the building's own page.
  lat: 41.67653101,
  lon: 44.82462376,
  district: 'კრწანისი',
  city: 'თბილისი',
  streetHints: ['Krtsanisi', 'Крцаниси', 'კრწანისი', 'krcanisi', 'krwanisi'],
};

const plan = buildDiscoveryPlan(SUBJECT, { international: true });

console.log('=== DISCOVERY PLAN ===');
console.log('formulations      :', plan.length);
console.log('local (<= micro)  :', localQueries(plan).length);
console.log('languages         :', [...new Set(plan.map((q) => q.language))].join(', '));
console.log('precision bands   :', [...new Set(plan.map((q) => q.precision))].join(', '));
for (const q of plan.slice(0, 6)) console.log(`   [${q.precision}/${q.language}] ${q.text}`);

/* ------------------------------------------------------------------ *
 * The provider                                                        *
 * ------------------------------------------------------------------ */

let provider;
let executedPlan = plan;

if (LIVE) {
  const functionsUrl = process.env.SUPABASE_FUNCTIONS_URL ?? '';
  if (!functionsUrl) {
    console.error('\n--live needs SUPABASE_FUNCTIONS_URL. Refusing to guess a host.');
    process.exit(2);
  }
  provider = dataForSeoProvider({
    functionsUrl,
    authorization: process.env.SUPABASE_ANON_KEY ? `Bearer ${process.env.SUPABASE_ANON_KEY}` : null,
  });
} else {
  const harvest = JSON.parse(
    readFileSync(new URL('./fixtures/krtsanisiHarvest.json', import.meta.url), 'utf8'),
  );
  provider = harvestProvider(harvest.results, 'HARVEST_2026-09-20');
  /*
   * The formulations that were actually executed against the index, in the
   * order they were run. Replaying the full generated plan against a recorded
   * harvest would count queries nobody asked as queries that returned nothing,
   * and NOT_DISCOVERED must mean "asked, and empty".
   */
  executedPlan = harvest.queries;
}

const report = await runDiscovery({
  plan: executedPlan,
  subject: SUBJECT_GEO,
  search: provider,
});

/* ------------------------------------------------------------------ *
 * The result                                                          *
 * ------------------------------------------------------------------ */

const pad = (k) => String(k).padEnd(38);

console.log('\n=== DISCOVERY EXECUTION ===');
console.log(pad('PROVIDER'), '=', report.provider);
console.log(pad('PROVIDER_STATUS'), '=', report.providerStatus);
console.log(pad('QUERIES_PLANNED'), '=', plan.length);
console.log(pad('QUERIES_EXECUTED'), '=', report.queriesExecuted);
console.log(pad('QUERIES_WITH_RESULTS'), '=', report.queriesWithResults);
console.log(pad('LANGUAGES_SEARCHED'), '=', report.languages.join(', ') || 'none');

console.log('\n=== DOMAINS ===');
console.log(pad('RAW_URLS_DISCOVERED'), '=', report.rawUrlsDiscovered);
console.log(pad('DOMAINS_DISCOVERED'), '=', report.domainsDiscovered.length);
console.log(pad('DOMAINS_NEW_UNSEEDED'), '=', report.domainsNew.length,
  report.domainsNew.length ? `(${report.domainsNew.join(', ')})` : '');
console.log(pad('DOMAINS_PRODUCING_EVIDENCE'), '=', report.domainsProducingEvidence.length);
console.log('\nper domain:');
for (const d of report.perDomain) {
  console.log(
    `  ${d.domain.padEnd(22)} ${String(classifyDomain(d.domain)).padEnd(24)}`
    + ` urls=${String(d.urlsSeen).padEnd(3)} extracted=${String(d.extracted).padEnd(3)}`
    + ` failed=${String(d.failed).padEnd(3)} local=${d.localResults}`,
  );
}

console.log('\n=== WHY EACH URL DID OR DID NOT BECOME EVIDENCE ===');
for (const [outcome, n] of Object.entries(report.outcomes)) {
  if (n) console.log(pad(outcome), '=', n);
}

console.log('\n=== GEOGRAPHIC TIERS (never merged) ===');
console.log('   located   = records this run placed on the street or in the building');
console.log('   measurable = of those, the ones stating an area or a price');
for (const t of TIER_ORDER) {
  console.log(`${pad(t)} = ${report.tierCounts[t]} located, ${report.tierCountsMeasurable[t]} measurable`);
}
const local = LOCAL_TIERS.reduce((n, t) => n + report.tierCounts[t], 0);
const localMeasurable = LOCAL_TIERS.reduce((n, t) => n + report.tierCountsMeasurable[t], 0);
console.log(pad('LOCAL_TOTAL (tiers 1-3)'), '=', local, `(${localMeasurable} measurable)`);
console.log(pad('UNIQUE_LISTINGS'), '=', report.listings.length);
console.log(pad('DUPLICATES_REMOVED'), '=', report.duplicatesRemoved);

console.log('\nper-tier statistics:');
for (const s of report.tierStats) {
  console.log(`  ${s.tier.padEnd(30)} n=${String(s.sample).padEnd(3)} median=${s.median} range=${s.min}-${s.max}`);
}
console.log(pad('HEADLINE_TIER'), '=',
  report.headline ? `${report.headline.tier} (n=${report.headline.sample})`
    : 'none - no local tier has enough priced observations, and the city may not stand in');

console.log('\n=== LOCAL EVIDENCE, ITEMISED ===');
for (const l of report.listings.filter((x) => LOCAL_TIERS.includes(x.tier))) {
  console.log(
    `  ${l.measurable ? '[listing] ' : '[locator] '}[${l.tier}] ${l.sourceDomain.padEnd(15)}`
    + ` ${String(l.area ?? '-').padEnd(6)}m2 ${String(l.rooms ?? '-')} rooms`
    + `  ${String(l.pricePerSqm ?? '-').padEnd(6)}/m2  ${l.address ?? ''}`,
  );
}

console.log('\n=== ACCEPTANCE ===');
console.log(pad('KNOWN_PUBLIC_LOCAL_EVIDENCE_DISCOVERED'), '=',
  report.knownPublicLocalEvidenceDiscovered ? 'YES' : 'NO');
const subjectFlat = report.listings.find((l) => l.area === 97.2);
console.log(pad('SUBJECT_BUILDING_LISTING'), '=',
  subjectFlat
    ? `${subjectFlat.area} m2, ${subjectFlat.rooms} rooms, ${subjectFlat.address} [${subjectFlat.tier}]`
    : 'not recovered');
