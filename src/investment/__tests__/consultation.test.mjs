// The consultation layer: provenance, the patch door, capability selection,
// the AI contract, and the rule that research never overwrites an assumption.
//
// These are the tests that stop the product from lying. The financial ones
// stop it from being wrong; these stop it from being confidently wrong about
// where a number came from, which is harder to notice and worse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPatch,
  isModellable,
  provenanceEntries,
  toInvestmentInput,
} from '../consultant/context.ts';
import {
  capabilityStatuses,
  isCapabilityId,
  nextQuestions,
  readyCapabilities,
} from '../consultant/capabilities.ts';
import {
  buildAnalysisBrief,
  buildContextBrief,
  buildOpenQuestions,
  extractJsonObject,
  parseUnderstandResponse,
} from '../consultant/prompt.ts';
import { compareAssumption, fieldForBasis, offerToPatch } from '../evidence/compare.ts';
import { runInvestmentModel } from '../calculations/index.ts';

const AT = '2026-09-18T10:00:00.000Z';

/* ── The patch door ──────────────────────────────────────────────────── */

test('a value enters the context with the origin the SERVER supplies', () => {
  const { context } = applyPatch({}, { purchasePrice: 100000 }, 'USER', { at: AT });
  assert.equal(context.purchasePrice.value, 100000);
  assert.equal(context.purchasePrice.origin, 'USER');
  assert.equal(context.purchasePrice.at, AT);
});

test('a patch cannot name its own origin — origin is not read from the patch', () => {
  const { context } = applyPatch(
    {},
    { purchasePrice: 100000, origin: 'RESEARCH' },
    'USER',
    { at: AT },
  );
  assert.equal(context.purchasePrice.origin, 'USER');
  assert.equal(context.origin, undefined);
});

test('unknown fields are rejected, with a reason, never written', () => {
  const { context, rejected } = applyPatch({}, { nonsenseField: 3 }, 'USER');
  assert.equal(context.nonsenseField, undefined);
  assert.deepEqual(rejected, [{ field: 'nonsenseField', reason: 'UNKNOWN_FIELD' }]);
});

test('out-of-range values are refused rather than clamped', () => {
  const { context, rejected } = applyPatch(
    {},
    { vacantMonthsPerYear: 40, mortgageTermMonths: 9000, monthlyRent: -5 },
    'USER',
  );
  assert.equal(context.vacantMonthsPerYear, undefined);
  assert.equal(context.mortgageTermMonths, undefined);
  assert.equal(context.monthlyRent, undefined);
  assert.equal(rejected.length, 3);
  assert.ok(rejected.every((r) => r.reason === 'OUT_OF_RANGE'));
});

test('a number written as text with separators is accepted', () => {
  const { context } = applyPatch({}, { purchasePrice: '100,000' }, 'USER');
  assert.equal(context.purchasePrice.value, 100000);
});

test('a non-numeric value in a numeric field is refused', () => {
  const { rejected } = applyPatch({}, { purchasePrice: 'about a hundred grand' }, 'USER');
  assert.deepEqual(rejected, [{ field: 'purchasePrice', reason: 'NOT_A_NUMBER' }]);
});

test('an explicit null clears a field — the investor can take something back', () => {
  const first = applyPatch({}, { renovationCost: 10000 }, 'USER');
  assert.equal(first.context.renovationCost.value, 10000);
  const second = applyPatch(first.context, { renovationCost: null }, 'USER');
  assert.equal(second.context.renovationCost, undefined);
});

test('an unsupported currency is refused rather than passed to Intl', () => {
  const { rejected } = applyPatch({}, { currency: 'XYZ' }, 'USER');
  assert.deepEqual(rejected, [{ field: 'currency', reason: 'OUT_OF_RANGE' }]);
  const ok = applyPatch({}, { currency: 'gel' }, 'USER');
  assert.equal(ok.context.currency.value, 'GEL');
});

test('applyPatch never mutates the context it was given', () => {
  const before = applyPatch({}, { purchasePrice: 100000 }, 'USER').context;
  const snapshot = JSON.stringify(before);
  applyPatch(before, { monthlyRent: 500 }, 'USER');
  assert.equal(JSON.stringify(before), snapshot);
});

/* ── Flattening to the engine input ──────────────────────────────────── */

test('the context flattens into exactly the engine input, with nothing invented', () => {
  let ctx = {};
  ctx = applyPatch(ctx, {
    currency: 'USD',
    purchasePrice: 100000,
    monthlyRent: 500,
    city: 'Tbilisi',
    district: 'Vake',
    areaSqm: 50,
  }, 'USER').context;

  const input = toInvestmentInput(ctx);
  assert.equal(input.currency, 'USD');
  assert.equal(input.purchasePrice, 100000);
  assert.equal(input.monthlyRent, 500);
  assert.equal(input.subject.city, 'Tbilisi');
  assert.equal(input.subject.areaSqm, 50);
  // Nothing that was never said:
  assert.equal(input.vacantMonthsPerYear, undefined);
  assert.equal(input.financing, undefined);
  assert.equal(input.operating, undefined);
  assert.equal(input.exitPriceAssumption, undefined);
});

test('a HALF-described mortgage does not become a financing leg', () => {
  // "35% is mine and the rest on a mortgage" tells us the deposit and
  // nothing else. Modelling a loan from that would invent a rate and a term.
  const ctx = applyPatch({}, { purchasePrice: 100000, downPaymentPercent: 35 }, 'USER').context;
  const input = toInvestmentInput(ctx);
  assert.equal(input.financing, undefined);

  const complete = applyPatch(ctx, { mortgageAnnualRatePercent: 12, mortgageTermMonths: 240 }, 'USER').context;
  assert.equal(toInvestmentInput(complete).financing.downPaymentPercent, 35);
});

test('an unmodellable context returns null rather than a stub input', () => {
  assert.equal(isModellable({}), false);
  assert.equal(toInvestmentInput({}), null);
  const ctx = applyPatch({}, { monthlyRent: 500 }, 'USER').context;
  assert.equal(toInvestmentInput(ctx), null);
});

test('provenance survives the whole round trip and is inspectable', () => {
  let ctx = applyPatch({}, { purchasePrice: 100000 }, 'USER', { at: AT, source: 'chat' }).context;
  ctx = applyPatch(ctx, { monthlyRent: 565 }, 'RESEARCH', { at: AT, source: 'ss.ge sweep' }).context;
  const entries = provenanceEntries(ctx);
  const byField = Object.fromEntries(entries.map((e) => [e.field, e]));
  assert.equal(byField.purchasePrice.origin, 'USER');
  assert.equal(byField.monthlyRent.origin, 'RESEARCH');
  assert.equal(byField.monthlyRent.source, 'ss.ge sweep');
});

/* ── Capability selection ────────────────────────────────────────────── */

test('a bare price offers almost nothing as READY, and that is correct', () => {
  const ctx = applyPatch({}, { purchasePrice: 100000 }, 'USER').context;
  const statuses = capabilityStatuses(ctx, null);
  assert.equal(readyCapabilities(statuses).length, 0);
});

test('adding a rent makes the vacancy module ready and yield partial', () => {
  const ctx = applyPatch({}, { purchasePrice: 100000, monthlyRent: 500 }, 'USER').context;
  const statuses = capabilityStatuses(ctx, null);
  const byId = Object.fromEntries(statuses.map((s) => [s.id, s]));
  assert.equal(byId.VACANCY_REALITY.state, 'READY');
  assert.equal(byId.INCOME_AND_YIELD.state, 'PARTIAL');
  assert.ok(byId.INCOME_AND_YIELD.missing.includes('inv_need_operating_costs'));
});

test('market evidence needs more than a city — the Research Core would refuse', () => {
  const cityOnly = applyPatch({}, { purchasePrice: 100000, city: 'Tbilisi' }, 'USER').context;
  const a = capabilityStatuses(cityOnly, null).find((s) => s.id === 'MARKET_EVIDENCE');
  assert.equal(a.state, 'PARTIAL');
  assert.ok(a.missing.includes('inv_need_district_or_area'));

  const narrowed = applyPatch(cityOnly, { district: 'Vake' }, 'USER').context;
  const b = capabilityStatuses(narrowed, null).find((s) => s.id === 'MARKET_EVIDENCE');
  assert.equal(b.state, 'READY');
});

test('the next question is the one that unlocks the most of the product', () => {
  const ctx = applyPatch({}, { purchasePrice: 100000 }, 'USER').context;
  const questions = nextQuestions(capabilityStatuses(ctx, null));
  assert.equal(questions[0], 'inv_need_monthly_rent');
});

test('a complete scenario asks nothing further', () => {
  const ctx = applyPatch({}, {
    currency: 'USD',
    purchasePrice: 100000,
    monthlyRent: 500,
    vacantMonthsPerYear: 1,
    maintenanceAnnual: 600,
    acquisitionCosts: 3000,
    downPaymentPercent: 35,
    mortgageAnnualRatePercent: 12,
    mortgageTermMonths: 240,
    exitPriceAssumption: 110000,
    sellingCostPercent: 3,
    benchmarkYieldPercent: 6,
    areaSqm: 50,
    city: 'Tbilisi',
    district: 'Vake',
  }, 'USER').context;
  const statuses = capabilityStatuses(ctx, runInvestmentModel(toInvestmentInput(ctx)));
  // Every capability the investor is actually doing is ready. Renovate-and-
  // sell is not, and must not be: this is a buy-and-hold rental with no
  // renovation, and the product should not ask about one.
  const notReady = statuses.filter((s) => s.state !== 'READY');
  assert.deepEqual(notReady.map((s) => s.id), ['RENOVATE_AND_SELL']);
  assert.equal(notReady[0].optIn, true);
  assert.deepEqual(nextQuestions(statuses), []);
});

test('an opt-in capability never becomes a question the Consultant asks', () => {
  const ctx = applyPatch({}, { purchasePrice: 100000, monthlyRent: 500 }, 'USER').context;
  const questions = nextQuestions(capabilityStatuses(ctx, null), 20);
  assert.ok(!questions.includes('inv_need_renovation'));
});

test('mentioning a renovation is what turns the flip module on', () => {
  const ctx = applyPatch(
    {},
    { purchasePrice: 100000, renovationCost: 20000, exitPriceAssumption: 140000 },
    'USER',
  ).context;
  const flip = capabilityStatuses(ctx, null).find((s) => s.id === 'RENOVATE_AND_SELL');
  assert.equal(flip.state, 'READY');
});

test('only real capability ids are accepted', () => {
  assert.ok(isCapabilityId('MONEY_BACK'));
  assert.ok(!isCapabilityId('MAKE_ME_RICH'));
  assert.ok(!isCapabilityId(42));
});

/* ── The AI contract ─────────────────────────────────────────────────── */

test('a fenced JSON response is parsed, not rejected', () => {
  const raw = 'Sure, here you go:\n```json\n{"patch":{"purchasePrice":100000},"focus":["MONEY_BACK"],"clear":[]}\n```';
  const result = parseUnderstandResponse(raw);
  assert.equal(result.patch.purchasePrice, 100000);
  assert.deepEqual(result.focus, ['MONEY_BACK']);
});

test('extractJsonObject counts braces rather than matching a pattern', () => {
  const raw = 'text {"a":{"b":1},"c":"}"} trailing';
  assert.equal(extractJsonObject(raw), '{"a":{"b":1},"c":"}"}');
});

test('an unparseable response degrades to an empty patch, not an error', () => {
  const result = parseUnderstandResponse('I cannot help with that.');
  assert.deepEqual(result, { patch: {}, focus: [], clear: [] });
});

test('the extractor cannot invent fields or capabilities', () => {
  const raw = JSON.stringify({
    patch: { purchasePrice: 100000, marketValue: 133333, __proto__: 'x' },
    focus: ['MONEY_BACK', 'BUY_SIGNAL'],
    clear: ['monthlyRent', 'nonsense'],
  });
  const result = parseUnderstandResponse(raw);
  assert.equal(result.patch.purchasePrice, 100000);
  assert.equal(result.patch.marketValue, undefined);
  assert.deepEqual(result.focus, ['MONEY_BACK']);
  assert.deepEqual(result.clear, ['monthlyRent']);
});

test('the analysis brief contains every figure the model may state', () => {
  const model = runInvestmentModel({
    currency: 'USD',
    purchasePrice: 100000,
    monthlyRent: 500,
    operating: { maintenanceAnnual: 600 },
    financing: { downPaymentPercent: 35, annualRatePercent: 12, termMonths: 240 },
    holdMonths: 12,
    exitPriceAssumption: 110000,
    sellingCostPercent: 3,
    benchmarkYieldPercent: 6,
  });
  const brief = buildAnalysisBrief(model);
  for (const needle of [
    'gross yield on purchase price',
    'net operating income',
    'property payback',
    'investor cash payback',
    'loan amount',
    'interest paid over the hold',
    'principal repaid over the hold',
    'debt still owed at exit',
    'net sale proceeds',
    'return on invested cash',
    'break-even exit price',
    'INCOME-IMPLIED VALUE',
  ]) {
    assert.ok(brief.includes(needle), `the brief must carry "${needle}"`);
  }
  // And it must label the exit as the investor's own scenario.
  assert.ok(brief.includes("INVESTOR'S OWN SCENARIO"));
});

test('an unavailable figure appears in the brief as NOT ESTABLISHED, never as zero', () => {
  const model = runInvestmentModel({ currency: 'USD', purchasePrice: 100000, monthlyRent: 500 });
  const brief = buildAnalysisBrief(model);
  assert.ok(brief.includes('net operating income: NOT ESTABLISHED'));
  assert.ok(brief.includes('operating costs: NONE SUPPLIED'));
});

test('the brief names the cost categories nobody supplied', () => {
  const model = runInvestmentModel({
    currency: 'USD',
    purchasePrice: 100000,
    monthlyRent: 500,
    operating: { maintenanceAnnual: 600 },
  });
  const brief = buildAnalysisBrief(model);
  assert.ok(brief.includes('COST CATEGORIES NOBODY HAS SUPPLIED'));
  assert.ok(brief.includes('propertyTax'));
});

test('open questions come from the engine, not from the model', () => {
  const model = runInvestmentModel({ currency: 'USD', purchasePrice: 100000 });
  const questions = buildOpenQuestions(model);
  assert.ok(questions.includes('monthly rent'));
  assert.ok(questions.includes('exit price'));
});

test('the context brief tells the model which values are researched', () => {
  let ctx = applyPatch({}, { purchasePrice: 100000 }, 'USER').context;
  ctx = applyPatch(ctx, { monthlyRent: 565 }, 'RESEARCH').context;
  const brief = buildContextBrief(ctx);
  assert.ok(brief.includes('purchasePrice = 100000 (USER)'));
  assert.ok(brief.includes('monthlyRent = 565 (RESEARCH)'));
});

/* ── Evidence never overwrites an assumption ─────────────────────────── */

const rentEvidence = (over = {}) => ({
  field: 'monthlyRent',
  basis: 'ASKING_RENT',
  currency: 'USD',
  low: 540,
  median: 565,
  high: 590,
  evidenceLevel: 'MICRO_LOCATION',
  observationCount: 9,
  independentSourceCount: 2,
  uniquePropertyCount: 7,
  conflictCount: 0,
  retrievedAt: AT,
  ...over,
});

test('an assumption below the observed range is reported, not corrected', () => {
  const ctx = applyPatch({}, { purchasePrice: 100000, monthlyRent: 500 }, 'USER').context;
  const comparison = compareAssumption(ctx, rentEvidence());
  assert.equal(comparison.assumption, 500);
  assert.equal(comparison.assumptionOrigin, 'USER');
  assert.equal(comparison.verdict, 'BELOW_EVIDENCE');
  assert.equal(comparison.differenceVsMedian, -65);
  // The context is untouched.
  assert.equal(ctx.monthlyRent.value, 500);
  assert.equal(ctx.monthlyRent.origin, 'USER');
});

test('applying an offer is an explicit act that stamps RESEARCH', () => {
  const ctx = applyPatch({}, { purchasePrice: 100000, monthlyRent: 500 }, 'USER').context;
  const comparison = compareAssumption(ctx, rentEvidence());
  const patch = offerToPatch(comparison, 'MEDIAN');
  assert.deepEqual(patch, { monthlyRent: 565 });
  const applied = applyPatch(ctx, patch, 'RESEARCH', { source: 'ss.ge sweep' }).context;
  assert.equal(applied.monthlyRent.value, 565);
  assert.equal(applied.monthlyRent.origin, 'RESEARCH');
});

test('"keep my assumption" produces no patch at all', () => {
  const ctx = applyPatch({}, { purchasePrice: 100000, monthlyRent: 500 }, 'USER').context;
  const comparison = compareAssumption(ctx, rentEvidence());
  assert.equal(offerToPatch(comparison, 'KEEP_MINE'), null);
});

test('thin evidence is marked thin rather than withheld or promoted', () => {
  const single = compareAssumption({}, rentEvidence({ independentSourceCount: 1, observationCount: 2 }));
  assert.equal(single.thin, true);
  assert.equal(single.verdict, 'NO_ASSUMPTION');
  const solid = compareAssumption({}, rentEvidence());
  assert.equal(solid.thin, false);
});

test('a price basis only speaks to the field it can speak to', () => {
  assert.equal(fieldForBasis('ASKING_RENT'), 'monthlyRent');
  assert.equal(fieldForBasis('ASKING_SALE_PRICE'), 'askingPrice');
  assert.equal(fieldForBasis('UNKNOWN'), null);
  // An asking sale price must never be allowed to write the monthly rent.
  assert.notEqual(fieldForBasis('ASKING_SALE_PRICE'), 'monthlyRent');
});

test('an assumption inside the range is CONSISTENT, not "no finding"', () => {
  const ctx = applyPatch({}, { purchasePrice: 100000, monthlyRent: 560 }, 'USER').context;
  assert.equal(compareAssumption(ctx, rentEvidence()).verdict, 'CONSISTENT');
});
