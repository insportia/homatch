// Native matching throughput: the real assessMatch over 500 / 5k / 10k / 100k
// synthetic properties through the exhaustive keyset scan. Run: node scripts/bench/nativeMatching.mjs
import { assessMatch } from '../../src/research-core/match/compatibility.ts';
import { supplySideFromProperty, demandSideFromIntentProfile, strengthFromCriteria, NATIVE_MIN_AGREEMENTS } from '../../src/research-core/match/native-pair.ts';
import { scanAll } from '../../src/research-core/match/exhaustiveScan.ts';
const districts = ['Saburtalo','Vake','Krtsanisi','Ortachala','Isani','Gldani'];
const mk = (i) => ({ id: `p${String(i).padStart(7,'0')}`, transaction_type: i%3? 'sale':'rent', property_type: 'apartment', listed_by_role: null,
  facts: { city: i%5 ? 'Tbilisi' : 'Batumi', district: districts[i%6], total_price: 40000 + (i%200)*1000, currency: 'USD', area: 40 + i%80, rooms: 1+i%5, bedrooms: i%4 } });
const demand = demandSideFromIntentProfile({ intent_type: 'BUYER', transaction_type: 'SALE', city: 'Tbilisi', district: 'Krtsanisi', property_types: ['apartment'], budget_min: 60000, budget_max: 150000, currency: 'USD', area_min: 50, area_max: 100, bedrooms_min: 1, bedrooms_max: 3 }, strengthFromCriteria({}));
for (const n of [500, 5_000, 10_000, 100_000]) {
  const rows = Array.from({ length: n }, (_, i) => mk(i));
  let compatible = 0; const t0 = performance.now(); const mem0 = process.memoryUsage().heapUsed;
  const r = await scanAll({ pageSize: 500, keyOf: (x) => x.id,
    fetchPage: async (after, size) => { let lo = after ? rows.findIndex((x) => x.id > after) : 0; if (lo < 0) return []; return rows.slice(lo, lo + size); },
    onPage: (page) => { for (const p of page) { const a = assessMatch(demand, supplySideFromProperty(p, p.facts), { minAgreements: NATIVE_MIN_AGREEMENTS }); if (a.compatibility === 'COMPATIBLE') compatible++; } } });
  console.log(JSON.stringify({ properties: n, ms: Math.round(performance.now() - t0), perPairUs: +((performance.now() - t0) * 1000 / n).toFixed(1), compatible, complete: r.complete, pages: r.pages, maxPage: r.maxPageRows }));
}
