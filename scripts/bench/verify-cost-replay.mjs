#!/usr/bin/env node
/*
 * Verify V2 → V3 offline cost replay (owner, 2026-10-29). Calls NO provider.
 *
 *   node --experimental-strip-types scripts/bench/verify-cost-replay.mjs [--json] [--chars-per-token 2.21]
 *
 * For every saved fixture job it builds the report prompt the way a V2 job
 * and a V3 job build it (same evidence), and reports:
 *   - prompt size (chars, estimated tokens) and the V3 cacheable prefix;
 *   - the V3/V2 input ratio, applied to the MEASURED production report input;
 *   - deterministic checks of the V3 pipeline on a real production model answer
 *     (job 8ba97da9 unit 601, STORED_SYNTHESIS, re-cited to each package):
 *     required blocks present, every citation resolves, every metric is a
 *     code-computed value, Georgian prose present, the gate keeps it (MODEL).
 * Then the per-stage cost table, with three kinds of number kept apart:
 *   MEASURED  production cost_events / research_jobs, read-only, 2026-10-24 (7 V2 jobs);
 *   ESTIMATE  this replay (V3 prompt sizes × provider_price_book prices + stated assumptions);
 *   LIVE V3   not measured yet: Admin → Providers → engine comparison after deploy.
 */
import { buildEvidencePackage } from '../../src/verify/intelligence/evidencePackage.ts';
import { buildIntelligenceBundle } from '../../src/verify/intelligence/bundle.ts';
import { buildIntelligencePrompt } from '../../src/verify/intelligence/prompt.ts';
import { finalizeReport } from '../../src/verify/intelligence/report.ts';
import { codeSectionMetrics } from '../../src/verify/intelligence/codeMetrics.ts';
import { resolveAssetClass } from '../../src/verify/researchPlan.ts';
import { villionV3 } from '../../src/verify/intelligence/__tests__/fixtures/villionV3Fixture.mjs';
import { unit601Result } from '../../src/verify/intelligence/__tests__/fixtures/unit601Fixture.mjs';
import { rawResult601 } from '../../src/verify/__tests__/fixtures/job601Narrative.mjs';
import { rawResultEee } from '../../src/verify/__tests__/fixtures/jobEeeEvolution.mjs';
import { digomiResultJson } from '../../src/verify/__tests__/fixtures/digomiVisualsEeefada9.mjs';
import { resultJson601 } from '../../src/verify/__tests__/fixtures/krtsanisiVisuals601.mjs';
import { RESULT as APARTMENT_8BA97DA9 } from '../../src/verify/__tests__/fixtures/apartment8ba97da9MarketFixture.mjs';
import { RESULT as LAND_61C1C38C } from '../../src/verify/__tests__/fixtures/landPlot61c1c38cFixture.mjs';
import { STORED_SYNTHESIS } from '../../src/verify/__tests__/fixtures/job601Synthesis.mjs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const ratioArg = args.indexOf('--chars-per-token');
/* Measured on production prompts (job 176264ba, VERIFY_V2_RESEARCH_COST.md). */
const CHARS_PER_TOKEN = ratioArg >= 0 ? Number(args[ratioArg + 1]) : 2.21;

/* provider_price_book, OPENAI, effective 2026-07-30 (read-only, 2026-10-29). USD per token. */
const PRICE = {
  'gpt-5.6-luna': { in: 0.20e-6, cached: 0.02e-6, out: 1.20e-6 },
  'gpt-5.6-terra': { in: 2.00e-6, cached: 0.20e-6, out: 12.00e-6 },
};
const SEARCH_USD = 0.01;

/* MEASURED, production, the 7 V2 jobs of 2026-10-24 (cost_events + research_jobs). */
const MEASURED = {
  report: { usd: [0.19, 0.27], model: 'gpt-5.6-terra', inputTokens: [48_000, 51_000], cachedTokens: 0, outputTokens: [7_700, 13_600] },
  identity: { usd: [0.039, 0.049], searches: [3, 4], tokenUsd: 0.009 },
  public_research: { usd: [0.029, 0.053], searches: [2, 4], tokenUsd: [0.009, 0.013] },
  market: { usd: [0.012, 0.039], searches: [1, 3], tokenUsd: 0.009, codeOnlyShare: 2 / 7 },
  official_collection: { usd: [0.0076, 0.0090] },
  developer_ads: { usd: [0.006, 0.05], note: 'APIFY_MEMO23, older jobs (2026-10-23)' },
};

/* ASSUMPTIONS of the estimate, stated so the live measurement can confirm or correct them. */
const ASSUME = {
  repairRate: 0.5, // share of V3 reports the gate faults at least once (removed or rejected) → one Luna repair
  escalationRate: 0.15, // share still REJECTED after the repair → one Terra call (removals no longer escalate)
  repairCachedShare: 0.9, // the repair resends the same prefix seconds later: cached
  lunaOutputVsTerra: 1.0, // Luna at low effort writes about as much visible text; reasoning shrinks (not credited)
  reuseHitRate: 0.2, // share of V3 jobs with a same-unit/parcel job inside 7 days (no measurement yet)
  identitySearches: 2, publicSearches: 3, marketSearches: 2,
  searchContextLowTokenFactor: 0.8,
};

const FIXTURES = [
  ['villion 01.18.06.019.055.03.01.503', villionV3],
  ['unit 601 register', unit601Result],
  ['unit 601 narrative', rawResult601],
  ['krtsanisi visuals 601', resultJson601],
  ['digomi eeefada9', digomiResultJson],
  ['evolution eee', rawResultEee],
  ['apartment 8ba97da9 market', () => APARTMENT_8BA97DA9],
  ['land 61c1c38c', () => LAND_61C1C38C],
];

const tokens = (chars) => Math.round(chars / CHARS_PER_TOKEN);
const georgian = (s) => /[ა-ჿ]/.test(String(s ?? ''));

/** The production answer (unit 601), its citations remapped onto this package, as a model reply. */
function productionAnswer(pkg) {
  const ids = pkg.items.map((i) => i.id);
  let k = 0;
  const cite = () => (ids.length ? [ids[k++ % ids.length]] : []);
  const r = STORED_SYNTHESIS.report;
  return JSON.stringify({
    summary: { ...r.summary, highlights: (r.summary.highlights ?? []).map((h) => ({ ...h, cites: cite() })) },
    keyFindings: (r.keyFindings ?? []).map((f) => ({ ...f, cites: cite() })),
    sections: (r.sections ?? []).map((s) => ({ ...s, cites: cite() })),
    propertyStory: r.propertyStory ? { chapters: r.propertyStory.chapters.map((c) => ({ ...c, cites: cite() })) } : undefined,
    attentionPoints: (r.attentionPoints ?? []).map((a) => ({ ...a, cites: cite() })),
    nextSteps: [],
    finalView: r.finalView,
    contractUpload: r.contractUpload,
  });
}

const rows = [];
for (const [name, make] of FIXTURES) {
  const rj = make();
  const assetClass = resolveAssetClass(rj);
  const p2 = buildEvidencePackage(rj, { now: '2026-10-24T12:00:00Z' });
  const p3 = buildEvidencePackage(rj, { now: '2026-10-24T12:00:00Z', developerAds: false });
  const b2 = buildIntelligenceBundle(rj, p2, null);
  const b3 = buildIntelligenceBundle(rj, p3, null);
  const v2 = buildIntelligencePrompt(p2, b2, assetClass);
  const v3 = buildIntelligencePrompt(p3, b3, assetClass, { fieldOwnership: 'CODE' });
  const c2 = v2.system.length + v2.user.length;
  const c3 = v3.system.length + v3.user.length;
  const prefix = v3.system.indexOf('── THIS REPORT');
  // Deterministic checks of the V3 pipeline on the production answer.
  const metrics = codeSectionMetrics(b3);
  const final = finalizeReport(p3, productionAnswer(p3), b3, { fieldOwnership: 'CODE', metrics, advertising: null });
  const known = new Set(p3.items.map((i) => i.id));
  const allCites = [
    ...(final.summary?.highlights ?? []).flatMap((h) => h.cites), ...(final.keyFindings ?? []).flatMap((f) => f.cites),
    ...(final.sections ?? []).flatMap((s) => s.cites), ...(final.propertyStory?.chapters ?? []).flatMap((c) => c.cites),
  ];
  const codeValues = new Set(Object.values(metrics).flat().map((m) => m.value));
  const checks = {
    mode: final.mode,
    requiredBlocks: !!final.summary?.statement && final.sections.length > 0 && !!final.finalView,
    citationsValid: allCites.every((c) => known.has(c)),
    metricsFromCode: final.sections.every((s) => s.metrics.every((m) => codeValues.has(m.value))),
    georgian: georgian(final.summary?.statement) && final.sections.every((s) => georgian(s.body)),
    gateFindings: final.rejectedBecause.length,
  };
  rows.push({
    fixture: name, items: p3.items.length,
    v2: { chars: c2, tokens: tokens(c2) },
    v3: { chars: c3, tokens: tokens(c3), cacheablePrefixChars: prefix > 0 ? prefix : 0 },
    inputRatio: Math.round((c3 / c2) * 1000) / 1000,
    checks,
  });
}

const ratio = rows.reduce((n, r) => n + r.inputRatio, 0) / rows.length;
const callUsd = (model, input, cached, output) => (input - cached) * PRICE[model].in + cached * PRICE[model].cached + output * PRICE[model].out;
const mid = (x) => (Array.isArray(x) ? (x[0] + x[1]) / 2 : x);
const inV3 = Math.round(mid(MEASURED.report.inputTokens) * ratio);
const out = mid(MEASURED.report.outputTokens) * ASSUME.lunaOutputVsTerra;
const first = callUsd('gpt-5.6-luna', inV3, 0, out);
const repair = callUsd('gpt-5.6-luna', inV3 + out, Math.round(inV3 * ASSUME.repairCachedShare), out);
const escalate = callUsd('gpt-5.6-terra', inV3, 0, mid(MEASURED.report.outputTokens));
const reportV3 = first + ASSUME.repairRate * repair + ASSUME.escalationRate * escalate;

const identityV3 = (1 - ASSUME.reuseHitRate) * (MEASURED.identity.tokenUsd * ASSUME.searchContextLowTokenFactor + ASSUME.identitySearches * SEARCH_USD);
const publicV3 = (1 - ASSUME.reuseHitRate) * (mid(MEASURED.public_research.tokenUsd) + ASSUME.publicSearches * SEARCH_USD);
const marketV3 = (1 - MEASURED.market.codeOnlyShare) * (MEASURED.market.tokenUsd * ASSUME.searchContextLowTokenFactor + ASSUME.marketSearches * SEARCH_USD);
const officialV3 = mid(MEASURED.official_collection.usd);

const stages = [
  ['report', MEASURED.report.usd, reportV3],
  ['identity', MEASURED.identity.usd, identityV3],
  ['public_research', MEASURED.public_research.usd, publicV3],
  ['market', MEASURED.market.usd, marketV3],
  ['official_collection', MEASURED.official_collection.usd, officialV3],
  ['developer_ads', MEASURED.developer_ads.usd, 0],
];
const r4 = (n) => Math.round(n * 10_000) / 10_000;
const summary = {
  pricing: 'provider_price_book OPENAI 2026-07-30',
  charsPerToken: CHARS_PER_TOKEN,
  meanV3InputRatio: r4(ratio),
  reportCalls: { firstUsd: r4(first), repairUsd: r4(repair), escalationUsd: r4(escalate), expectedUsd: r4(reportV3), assumptions: ASSUME },
  stages: stages.map(([stage, before, after]) => ({ stage, measuredV2Usd: before, estimatedV3Usd: r4(after) })),
  totalMeasuredV2Usd: [0.33, 0.42],
  totalEstimatedV3Usd: r4(stages.reduce((n, s) => n + s[2], 0)),
  liveV3: 'not measured yet (Admin → Providers → engine comparison after deploy)',
};

if (asJson) {
  console.log(JSON.stringify({ fixtures: rows, summary }, null, 2));
} else {
  console.log('fixture | V2 tokens | V3 tokens | V3/V2 | V3 cacheable prefix | mode | blocks | cites | metrics | ka | gate');
  for (const r of rows) {
    const c = r.checks;
    console.log(`${r.fixture} | ${r.v2.tokens} | ${r.v3.tokens} | ${r.inputRatio} | ${tokens(r.v3.cacheablePrefixChars)} | ${c.mode} | ${c.requiredBlocks} | ${c.citationsValid} | ${c.metricsFromCode} | ${c.georgian} | ${c.gateFindings}`);
  }
  console.log('\nstage | MEASURED V2 (2026-10-24) | ESTIMATE V3');
  for (const s of summary.stages) console.log(`${s.stage} | ${Array.isArray(s.measuredV2Usd) ? s.measuredV2Usd.join('–') : s.measuredV2Usd} | ${s.estimatedV3Usd}`);
  console.log(`total | 0.33–0.42 | ${summary.totalEstimatedV3Usd}`);
  console.log(`report calls: first ${summary.reportCalls.firstUsd}, repair ${summary.reportCalls.repairUsd}, escalation ${summary.reportCalls.escalationUsd}, expected ${summary.reportCalls.expectedUsd}`);
  console.log(`LIVE V3: ${summary.liveV3}`);
}
