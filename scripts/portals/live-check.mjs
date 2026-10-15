#!/usr/bin/env node
/* TEMPORARY live end-to-end check (PR #210): every portal adapter, real public pages,
 * the production acquisition loop, every report through the platform's own contract
 * validator. Read-only; robots.txt honoured by the loop; nothing is written anywhere. */
import { acquirePortal } from '../../official-worker/src/marketplace/portals/acquire.mjs';
import { PORTAL_ADAPTERS } from '../../official-worker/src/marketplace/portals/adapters.mjs';
import { validateWorkerReport } from '../../src/research-core/marketplace/worker-contract.ts';

const base = { contract: 'marketplace-worker-1', searchPlanId: '33333333-3333-4333-8333-333333333333', market: 'GE', country: 'GE', city: 'Tbilisi', districts: [],
  priceMinUsd: 0, areaMinSqm: null, areaMaxSqm: null, bedrooms: null, bathrooms: null, buildingStatuses: [], renovationPreferences: [], furnished: null, parking: null,
  mustHave: [], niceToHave: [], exclusions: [], searchLanguages: ['ka'] };
const CASES = [
  { name: 'BUY flat 2-3r ≤$250k', transactionType: 'BUY', propertyType: 'APARTMENT', priceMaxUsd: 250000, collectPriceMaxUsd: 275000, rooms: { min: 2, max: 3 } },
  { name: 'RENT flat ≤$1500', transactionType: 'MONTHLY_RENT', propertyType: 'APARTMENT', priceMaxUsd: 1500, collectPriceMaxUsd: 1650, rooms: null },
];
async function one(adapter, c, i) {
  const request = { ...base, ...c, searchId: `00000000-0000-4000-8000-00000000000${i}`, requestedAt: new Date().toISOString() };
  const reports = []; const t0 = Date.now();
  const outcome = await acquirePortal(adapter, request, { deadlineAt: new Date(Date.now() + 600000).toISOString(), report: async (r) => { reports.push(r); } });
  const valid = reports.map((r) => validateWorkerReport(r, adapter.sourceId));
  const listings = valid.flatMap((v) => (v.ok ? v.report.listings : []));
  const byPage = {}; for (const r of reports) for (const l of r.listings) byPage[l.retrievalMetadata.page] = (byPage[l.retrievalMetadata.page] ?? 0) + 1;
  const last = reports.at(-1);
  return { portal: adapter.sourceName, case: c.name, outcome: outcome.status, code: outcome.code ?? null, reports: reports.length, contractValid: valid.every((v) => v.ok), invalid: valid.filter((v) => !v.ok).map((v) => v.reason),
    listings: listings.length, distinctIds: new Set(listings.map((l) => l.sourceListingId)).size, byPage, pagesVisited: last?.metrics.pagesVisited, actions: last?.metrics.actions,
    withPrice: listings.filter((l) => l.price != null).length, withImages: listings.filter((l) => l.images.length).length, withPhone: listings.filter((l) => l.seller?.publicPhone).length,
    wrongDeal: listings.filter((l) => l.transactionType && l.transactionType !== c.transactionType).length, completedAt: last?.completedAt, ms: Date.now() - t0,
    errors: last?.errors, queryApplied: last?.queryApplied,
    sample: listings.slice(0, 3).map((l) => ({ id: l.sourceListingId, url: l.exactUrl, price: l.price, currency: l.currency, rooms: l.rooms, area: l.areaSqm, district: l.district, published: l.publishedAt })) };
}
const out = await Promise.all(PORTAL_ADAPTERS.map(async (adapter) => { const rows = []; for (const [i, c] of CASES.entries()) rows.push(await one(adapter, c, i).catch((e) => ({ portal: adapter.sourceName, case: c.name, crash: String(e?.stack ?? e) }))); return rows; }));
for (const row of out.flat()) console.log('LIVECHECK ' + JSON.stringify(row));
