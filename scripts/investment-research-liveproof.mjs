#!/usr/bin/env node
/*
 * LIVE PROOF for the Investment Intelligence market-evidence lane.
 *
 * Runs the REAL lane — the one supabase/functions/investment-research calls —
 * against the REAL portal, over the real network, through the real
 * SSRF/robots/rate-limit/circuit-breaker path in createPortalRuntime. No
 * mock transport, no fixture.
 *
 * It exists because "the edge function parses" and "the unit tests pass" are
 * both true of a lane that cannot actually reach a portal, and the only way
 * to tell the difference is to reach one.
 *
 * Not part of any gate: it touches the public internet and a third party's
 * server, which is not something a CI run should do on every push. Run it by
 * hand:  node scripts/investment-research-liveproof.mjs
 */
import { createPortalRuntime } from '../src/research-core/market/runtime.ts';
import {
  pricePerSqmSummary,
  runInvestmentLane,
  subjectSupportsResearch,
} from '../src/investment/evidence/lane.ts';

const subject = {
  city: 'Tbilisi',
  district: 'Vake',
  areaSqm: 50,
  bedrooms: null,
  rooms: null,
  propertyType: 'APARTMENT',
  projectName: null,
  countryCode: 'GE',
};

console.log('subject supports research:', subjectSupportsResearch(subject));

const runtime = createPortalRuntime();

for (const transaction of ['SALE', 'RENT']) {
  const started = Date.now();
  const lane = await runInvestmentLane(subject, transaction, runtime.registry, runtime.context, {
    budgetMs: 25_000,
  });
  console.log(`\n=== ${transaction} (${Date.now() - started}ms) ===`);
  console.log('refusal            :', lane.refusal);
  console.log('portals            :', JSON.stringify(lane.portals));
  console.log('adverts            :', lane.comparables.length);
  console.log('unique properties  :', lane.uniquePropertyCount);
  console.log('cross-posted       :', lane.crossPostedCount);
  console.log('uncertain dupes    :', lane.uncertainDuplicateCount);
  console.log('price conflicts    :', lane.conflictCount);
  console.log('widened            :', lane.widened);
  console.log('truncated          :', lane.truncatedByDeadline);
  console.log('network requests   :', lane.networkRequests);
  if (lane.range) {
    console.log('RANGE              :', JSON.stringify(lane.range, null, 2));
  } else {
    console.log('RANGE              : none');
  }
  if (transaction === 'SALE') {
    console.log('price per sqm      :', JSON.stringify(pricePerSqmSummary(lane.comparables)));
  }
  for (const advert of lane.comparables.slice(0, 4)) {
    console.log(
      `  · ${advert.price} ${advert.currency ?? ''} | ${advert.areaSqm ?? '?'}m² | ${advert.sourceFamily} | ${advert.url}`,
    );
  }
}

console.log('\nruntime stats:', JSON.stringify(runtime.stats()));
