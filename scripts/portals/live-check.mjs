#!/usr/bin/env node
/* Live end-to-end check for the Find Property HTML portals: every adapter in
 * PORTAL_ADAPTERS, real public pages, the production acquisition loop, every report
 * through the platform's own contract validator. Read-only; robots.txt honoured by
 * the loop; nothing is written anywhere. Needs a network that reaches the .ge sites
 * (a GitHub runner does; the cloud dev sandbox does not).
 *   node scripts/portals/live-check.mjs     → one LIVECHECK JSON line per portal × case */
import { acquirePortal } from '../../official-worker/src/marketplace/portals/acquire.mjs';
import { PORTAL_ADAPTERS } from '../../official-worker/src/marketplace/portals/adapters.mjs';
import { validateWorkerReport } from '../../src/research-core/marketplace/worker-contract.ts';
import { processSearch } from '../../src/research-core/marketplace/pipeline.ts';
// Counting only: GEL→USD at an approximate rate; production uses its own current NBG table.
const converter = { name: 'live-check', convert: (amount, from, to) => (from === 'GEL' && to === 'USD' ? { amount: amount * 0.37, rate: 0.37 } : null) };

const base = { contract: 'marketplace-worker-1', searchPlanId: '33333333-3333-4333-8333-333333333333', market: 'GE', country: 'GE', city: 'Tbilisi', districts: [],
  priceMinUsd: 0, areaMinSqm: null, areaMaxSqm: null, bedrooms: null, bathrooms: null, buildingStatuses: [], renovationPreferences: [], furnished: null, parking: null,
  mustHave: [], niceToHave: [], exclusions: [], searchLanguages: ['ka'] };
const CASES = [
  { name: 'A: Tbilisi BUY flat $80k–$200k, 50–120 m²', transactionType: 'BUY', propertyType: 'APARTMENT', priceMinUsd: 80000, priceMaxUsd: 200000, collectPriceMaxUsd: 220000, areaMinSqm: 50, areaMaxSqm: 120, rooms: null },
  { name: 'B: Tbilisi RENT flat $300–$1,500/month', transactionType: 'MONTHLY_RENT', propertyType: 'APARTMENT', priceMinUsd: 300, priceMaxUsd: 1500, collectPriceMaxUsd: 1650, rooms: null },
  { name: 'C1: Krtsanisi BUY flat', transactionType: 'BUY', propertyType: 'APARTMENT', priceMaxUsd: 1000000, collectPriceMaxUsd: 1100000, rooms: null, districts: ['Krtsanisi'] },
  { name: 'C2: Krtsanisi or Ortachala BUY flat', transactionType: 'BUY', propertyType: 'APARTMENT', priceMaxUsd: 1000000, collectPriceMaxUsd: 1100000, rooms: null, districts: ['კრწანისი', 'Ortachala'] },
];
async function one(adapter, c, i) {
  const request = { ...base, ...c, searchId: `00000000-0000-4000-8000-00000000000${i}`, requestedAt: new Date().toISOString() };
  const reports = []; const t0 = Date.now();
  const outcome = await acquirePortal(adapter, request, { deadlineAt: new Date(Date.now() + 600000).toISOString(), report: async (r) => { reports.push(r); } });
  const valid = reports.map((r) => validateWorkerReport(r, adapter.sourceId));
  const listings = valid.flatMap((v) => (v.ok ? v.report.listings : []));
  const byPage = {}; for (const r of reports) for (const l of r.listings) byPage[l.retrievalMetadata.page] = (byPage[l.retrievalMetadata.page] ?? 0) + 1;
  const last = reports.at(-1);
  const pipeline = processSearch({ request, candidates: listings.map((candidate) => ({ workerId: adapter.workerId, candidate })), converter });
  return { portal: adapter.sourceName, case: c.name, outcome: outcome.status, code: outcome.code ?? null, reports: reports.length, contractValid: valid.every((v) => v.ok), invalid: valid.filter((v) => !v.ok).map((v) => v.reason),
    listings: listings.length, distinctIds: new Set(listings.map((l) => l.sourceListingId)).size, byPage, pagesVisited: last?.metrics.pagesVisited, actions: last?.metrics.actions,
    withPrice: listings.filter((l) => l.price != null).length, withImages: listings.filter((l) => l.images.length).length, withPhone: listings.filter((l) => l.seller?.publicPhone).length,
    wrongDeal: listings.filter((l) => l.transactionType && l.transactionType !== c.transactionType).length, completedAt: last?.completedAt, ms: Date.now() - t0,
    pipelineAccepted: pipeline.stats.validated, pipelineRejected: pipeline.stats.rejected, uniqueProperties: pipeline.stats.uniqueProperties, duplicatesCollapsed: pipeline.stats.duplicatesCollapsed,
    excludedByFilter: pipeline.stats.excludedByFilter, excludedReasons: pipeline.excluded.reduce((m, e) => ({ ...m, [e.reason]: (m[e.reason] ?? 0) + 1 }), {}), shown: pipeline.properties.length, inBudget: pipeline.stats.inBudget, errors: last?.errors, queryApplied: last?.queryApplied,
        districts: listings.reduce((m, l) => ({ ...m, [l.district ?? '—']: (m[l.district ?? '—'] ?? 0) + 1 }), {}),
    priceRange: listings.filter((l) => l.currency === 'USD').map((l) => l.price).sort((a, b) => a - b).filter((_, i, a) => i === 0 || i === a.length - 1),
    areaRange: listings.map((l) => l.areaSqm).filter((v) => v != null).sort((a, b) => a - b).filter((_, i, a) => i === 0 || i === a.length - 1),
    startedAt: new Date(t0).toISOString(), env: `GitHub Actions ${process.env.RUNNER_OS ?? 'local'} ${process.env.GITHUB_RUN_ID ?? ''}`.trim(),
    sample: listings.slice(0, 3).map((l) => ({ id: l.sourceListingId, url: l.exactUrl, price: l.price, currency: l.currency, rooms: l.rooms, area: l.areaSqm, district: l.district, published: l.publishedAt })) };
}
const out = await Promise.all(PORTAL_ADAPTERS.map(async (adapter) => { const rows = []; for (const [i, c] of CASES.entries()) rows.push(await one(adapter, c, i).catch((e) => ({ portal: adapter.sourceName, case: c.name, crash: String(e?.stack ?? e) }))); return rows; }));
for (const row of out.flat()) console.log('LIVECHECK ' + JSON.stringify(row));
