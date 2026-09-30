// META ADS MASTER — the acceptance scenarios at the logic layer. Deterministic,
// no network: every number below is what the production code computes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, DEFAULT_STRATEGY_PARAMS, strategyParams } from '../strategy.ts';
import { applyTargeting, targetingConstraints, validateTargeting, normalizeIntent } from '../targeting.ts';
import { creativeAdvice, blocksLaunch, creativeQuality } from '../creativeAdvice.ts';
import { fundingPlan, budgetChange, settleServiceFee, effectiveFeePercent, heldFeeFromLedger, LEDGER_LABEL_KEY } from '../billing.ts';
import { kpis, emptyTotals, totalsByCurrency, sumTotals } from '../kpi.ts';
import { planQueries, isValidQuery, normalizeRow, queryString } from '../insights.ts';
import { evidenceOf, leaderOf, classifyCreatives, recommend, health, fatigueSignals, summaryFacts, factsKey } from '../analysis.ts';
import { decide, duplicateLevel, diffState, classifyExternal, isHomatchOrigin, activeStrikeCount, DEFAULT_GUARD_POLICY, adSetState } from '../guard.ts';
import { leadFormPayload, validateLeadFormSpec, mapLeadAnswers, leadFormPreview } from '../leadForms.ts';

const img = (id, w = 1080, h = 1350, quality = null) => ({ id, kind: 'IMAGE', ready: true, width: w, height: h, quality });
const input = (over = {}) => ({
  goal: 'LEADS_ON_META', dailyBudgetCents: 300, durationDays: 7, currency: 'USD',
  specialAdCategories: ['HOUSING'], creatives: [img('a'), img('b'), img('c')],
  destination: { type: 'META_FORM' }, placementsMode: 'RECOMMENDED',
  targeting: { locations: [{ type: 'country', key: 'GE', name: 'Georgia', countryCode: 'GE' }], ageMin: 18, ageMax: 65, gender: 'ALL' },
  ...over,
});
const shape = (p) => `1-${p.adSets.length}-${p.adSets.reduce((n, s) => n + s.creativeIds.length, 0)}`;

/* ── STRATEGY ───────────────────────────────────────────────────────── */

test('$3/day: compact — one ad set, two ads, the rest named as held back', () => {
  const p = buildPlan(input({ dailyBudgetCents: 300 }));
  assert.equal(shape(p), '1-1-2');
  assert.equal(p.strategy.testingCapacity, 1);
  assert.ok(p.strategy.reasonCodes.includes('COMPACT_BUDGET_ONE_AD_SET'));
  assert.ok(p.strategy.reasonCodes.includes('BUDGET_CONCENTRATED_ON_STRONGEST_CREATIVES'));
  assert.deepEqual(p.strategy.heldBackCreativeIds, ['c']);
  assert.equal(p.adSets.reduce((n, s) => n + s.dailyBudgetCents, 0), 300);
});

test('$3/day with one creative is 1-1-1, never padded', () => {
  assert.equal(shape(buildPlan(input({ dailyBudgetCents: 300, creatives: [img('a')] }))), '1-1-1');
});

test('$5/day: still one ad set; two locations are combined, not split into starved cells', () => {
  const p = buildPlan(input({ dailyBudgetCents: 500, creatives: [img('a'), img('b')] }));
  assert.equal(shape(p), '1-1-2');
  const two = buildPlan(input({
    dailyBudgetCents: 500, creatives: [img('a'), img('b')],
    targeting: { locations: [
      { type: 'city', key: '1001', name: 'Tbilisi', countryCode: 'GE' },
      { type: 'city', key: '1002', name: 'Batumi', countryCode: 'GE' }], ageMin: 18, ageMax: 65, gender: 'ALL' },
  }));
  assert.equal(two.adSets.length, 1);
  assert.ok(two.strategy.reasonCodes.includes('LOCATIONS_COMBINED_FOR_BUDGET'));
});

test('higher budget + two places: each place becomes its own funded test (1-2-4)', () => {
  const p = buildPlan(input({
    dailyBudgetCents: 2000, creatives: [img('a'), img('b')],
    targeting: { locations: [
      { type: 'city', key: '1001', name: 'Tbilisi', countryCode: 'GE' },
      { type: 'city', key: '1002', name: 'Batumi', countryCode: 'GE' }], ageMin: 18, ageMax: 65, gender: 'ALL' },
  }));
  assert.equal(shape(p), '1-2-4');
  assert.ok(p.strategy.reasonCodes.includes('LOCATIONS_TESTED_SEPARATELY'));
  assert.deepEqual(p.adSets.map((s) => s.targeting.geo_locations.cities[0].key), ['1001', '1002']);
});

test('higher budget stays simple when complexity would not improve the test', () => {
  const p = buildPlan(input({ dailyBudgetCents: 5000, creatives: [img('a'), img('b')] }));
  assert.equal(p.adSets.length, 1, 'one place, one format: no reason to split');
  assert.ok(p.strategy.testingCapacity >= 4);
});

test('strategy considers more than budget: formats, duration, objective', () => {
  const formats = buildPlan(input({ dailyBudgetCents: 2000, creatives: [img('v', 1080, 1920), img('f', 1080, 1080)] }));
  assert.ok(formats.strategy.reasonCodes.includes('FORMATS_TESTED_SEPARATELY'));
  assert.equal(formats.adSets.length, 2);
  const short = buildPlan(input({ dailyBudgetCents: 2000, durationDays: 3, creatives: [img('v', 1080, 1920), img('f', 1080, 1080)] }));
  assert.equal(short.adSets.length, 1);
  assert.ok(short.strategy.reasonCodes.includes('SHORT_DURATION_SIMPLIFIED'));
  const traffic = buildPlan(input({ goal: 'PROMOTE', dailyBudgetCents: 1000 }));
  const leads = buildPlan(input({ goal: 'LEADS_ON_META', dailyBudgetCents: 1000 }));
  assert.ok(traffic.strategy.testingCapacity > leads.strategy.testingCapacity, 'cheaper results fund more cells');
});

test('strongest creatives run first', () => {
  const p = buildPlan(input({ dailyBudgetCents: 300, creatives: [img('weak', 1080, 1350, 0.4), img('best', 1080, 1350, 0.95), img('mid', 1080, 1350, 0.7)] }));
  assert.deepEqual(p.adSets[0].creativeIds, ['best', 'mid']);
});

test('strategy params are server-side and bounded', () => {
  const p = strategyParams({ minAdSetDailyCents: 20, maxAdSets: 99, objectiveCellFactor: { OUTCOME_LEADS: 2 } });
  assert.equal(p.minAdSetDailyCents, DEFAULT_STRATEGY_PARAMS.minAdSetDailyCents, 'out-of-range values fall back');
  assert.equal(p.maxAdSets, DEFAULT_STRATEGY_PARAMS.maxAdSets);
  assert.equal(p.objectiveCellFactor.OUTCOME_LEADS, 2);
});

/* ── TARGETING ──────────────────────────────────────────────────────── */

test('housing ads: age, gender and radius follow Meta rules, and the plan says so', () => {
  const t = applyTargeting({ locations: [{ type: 'city', key: '777', name: 'Vake', countryCode: 'GE', radiusKm: 5 }], ageMin: 30, ageMax: 50, gender: 'FEMALE' }, ['HOUSING']);
  assert.deepEqual(t.effective, { ageMin: 18, ageMax: 65, gender: 'ALL' });
  assert.equal(t.spec.genders, undefined);
  assert.equal(t.spec.geo_locations.cities[0].radius, 25);
  assert.deepEqual(t.adjustments.sort(), ['HOUSING_AGE_ALL_ADULTS', 'HOUSING_ALL_GENDERS', 'HOUSING_RADIUS_WIDENED']);
  assert.equal(targetingConstraints(['HOUSING']).ageLocked, true);
});

test('non-housing ads honour the customer\'s age and gender, as Meta codes', () => {
  const t = applyTargeting({ locations: [{ type: 'country', key: 'TR', name: 'Türkiye', countryCode: 'TR' }], ageMin: 25, ageMax: 44, gender: 'MALE' }, []);
  assert.deepEqual(t.spec, { geo_locations: { countries: ['TR'] }, age_min: 25, age_max: 44, genders: [1] });
});

test('a country with a city chosen inside it is sent only as the city', () => {
  const t = applyTargeting({ locations: [
    { type: 'country', key: 'GE', name: 'Georgia', countryCode: 'GE' },
    { type: 'city', key: '555', name: 'Batumi', countryCode: 'GE' },
    { type: 'country', key: 'AM', name: 'Armenia', countryCode: 'AM' }], ageMin: 18, ageMax: 65, gender: 'ALL' }, []);
  assert.deepEqual(t.spec.geo_locations.countries, ['AM']);
  assert.equal(t.spec.geo_locations.cities[0].key, '555');
  assert.deepEqual(t.countries.sort(), ['AM', 'GE']);
});

test('targeting validation refuses what Meta would refuse; defaults never override a choice', () => {
  const codes = validateTargeting({ locations: [], ageMin: 17, ageMax: 70, gender: 'X' }).map((i) => i.code);
  assert.deepEqual(codes.sort(), ['AGE_RANGE_INVALID', 'GENDER_INVALID', 'LOCATION_REQUIRED']);
  assert.equal(normalizeIntent({ locations: [{ type: 'country', key: 'tr', countryCode: 'tr' }] }, ['GE']).locations[0].key, 'TR');
  assert.equal(normalizeIntent(null, ['GE']).locations[0].key, 'GE');
});

/* ── CREATIVES ──────────────────────────────────────────────────────── */

const cr = (id, m, t = {}) => ({ id, media: m ? [m] : [], headline: 'Vake 2BR', primaryText: 'Bright apartment', ...t });

test('a valid but low-resolution creative is amber and never blocks', () => {
  const advice = creativeAdvice([cr('a', { mime: 'image/jpeg', size: 100000, width: 500, height: 500 })], { goal: 'LEADS_ON_META' });
  assert.ok(advice.some((a) => a.code === 'MEDIA_RESOLUTION_LOW' && a.severity === 'RECOMMENDATION'));
  assert.equal(blocksLaunch(advice), false);
});

test('a technically invalid creative is red and blocks', () => {
  const advice = creativeAdvice([cr('a', { mime: 'image/gif', size: 1000, width: 800, height: 800 })], { goal: 'LEADS_ON_META' });
  assert.ok(advice.some((a) => a.severity === 'BLOCKING_ERROR' && a.code === 'MEDIA_FORMAT_UNSUPPORTED'));
  assert.equal(blocksLaunch(advice), true);
  assert.equal(blocksLaunch(creativeAdvice([cr('a', null)], { goal: 'LEADS_ON_META' })), true);
});

test('every media item is checked, not only the first', () => {
  const c = { id: 'x', headline: 'h', primaryText: 't', media: [{ mime: 'image/jpeg', size: 1, width: 1080, height: 1080 }, { mime: 'image/bmp', size: 1, width: 1080, height: 1080 }] };
  assert.ok(creativeAdvice([c], { goal: 'LEADS_ON_META' }).some((a) => a.params?.index === 2 && a.severity === 'BLOCKING_ERROR'));
});

test('creative-count advice follows the plan the budget supports', () => {
  const plan3 = buildPlan(input({ dailyBudgetCents: 300, creatives: [img('a')] }));
  const one = creativeAdvice([cr('a', { mime: 'image/jpeg', size: 1, width: 1080, height: 1350 })], { goal: 'LEADS_ON_META', recommendedCreativeCount: plan3.strategy.recommendedCreativeCount });
  assert.equal(plan3.strategy.recommendedCreativeCount, 2, '$3/day supports two, not eight');
  assert.ok(one.some((a) => a.code === 'ADD_CREATIVE_VARIATION' && a.severity === 'RECOMMENDATION' && a.params.recommended === 2));
  assert.ok(creativeQuality(cr('a', { mime: 'image/jpeg', size: 1, width: 1080, height: 1350 })) > creativeQuality(cr('b', { mime: 'image/jpeg', size: 1, width: 500, height: 500 })));
});

/* ── BILLING ────────────────────────────────────────────────────────── */

test('$100 planned at 9% needs $9 of HOMATCH balance; $4 available → add $5', () => {
  const f = fundingPlan({ dailyBudgetCents: 1000, durationDays: 10, feePercent: 9, availableCents: 400 });
  assert.equal(f.plannedMediaCents, 10000);
  assert.equal(f.requiredCents, 900);
  assert.equal(f.shortfallCents, 500);
});

test('budget $100 → $200 needs $9 more; $200 → $100 releases $9 to the balance', () => {
  const up = budgetChange({ newDailyBudgetCents: 2000, newDurationDays: 10, feePercent: 9, heldFeeCents: 900, spentMediaCents: 0 });
  assert.deepEqual([up.requiredFeeCents, up.additionalCents, up.releaseCents], [1800, 900, 0]);
  const down = budgetChange({ newDailyBudgetCents: 1000, newDurationDays: 10, feePercent: 9, heldFeeCents: 1800, spentMediaCents: 0 });
  assert.deepEqual([down.additionalCents, down.releaseCents], [0, 900]);
});

test('a release never gives back the fee on money Meta already spent', () => {
  const d = budgetChange({ newDailyBudgetCents: 200, newDurationDays: 10, feePercent: 9, heldFeeCents: 1800, spentMediaCents: 15000 });
  assert.equal(d.releaseCents, 1800 - 1350);
});

test('stop immediately: nothing to cash, the unused fee is released to the HOMATCH balance', () => {
  const s = settleServiceFee({ heldFeeCents: 900, plannedMediaCents: 10000, spentMediaCents: 0, feePercent: 9 });
  assert.deepEqual([s.consumedCents, s.releaseCents], [0, 900]);
  assert.equal(LEDGER_LABEL_KEY.FEE_RELEASE, 'mads_ledger_released_to_balance');
  assert.equal(LEDGER_LABEL_KEY.REFUND, 'mads_ledger_released_to_balance', 'never labelled refunded');
  assert.equal(heldFeeFromLedger([{ entry_type: 'HOMATCH_FEE', amount_cents: -900 }, { entry_type: 'FEE_RELEASE', amount_cents: 300 }]), 600);
});

test('fee policies: standard, exempt, custom — resolved server-side', () => {
  assert.equal(effectiveFeePercent(null, 9), 9);
  assert.equal(effectiveFeePercent({ kind: 'FEE_EXEMPT' }, 9), 0);
  assert.equal(effectiveFeePercent({ kind: 'CUSTOM_PERCENT', percent: 5 }, 9), 5);
});

/* ── KPI + INSIGHTS ─────────────────────────────────────────────────── */

const T = (o) => ({ ...emptyTotals('USD'), ...o });

test('one KPI definition: zero denominators are null, never 0 or Infinity', () => {
  const k = kpis('LEADS_ON_META', T({ spendMinor: 1840, impressions: 4000, reach: 2000, linkClicks: 80, leads: 6 }), { qualifiedLeads: 4 });
  assert.equal(k.costPerResultMinor, 1840 / 6);
  assert.equal(k.ctr, 80 / 4000);
  assert.equal(k.cpmMinor, 460);
  assert.equal(k.frequency, 2);
  assert.equal(k.cpqlMinor, 460);
  const z = kpis('LEADS_ON_META', T({}));
  assert.equal(z.ctr, null); assert.equal(z.cplMinor, null); assert.equal(z.cpmMinor, null);
});

test('no false combined totals across currencies', () => {
  const by = totalsByCurrency([T({ spendMinor: 100 }), { ...T({ spendMinor: 50 }), currency: 'GEL' }]);
  assert.deepEqual(Object.keys(by).sort(), ['GEL', 'USD']);
  assert.throws(() => sumTotals([T({}), { ...T({}), currency: 'EUR' }]), /MIXED_CURRENCY/);
});

test('the insights planner never sends a combination Meta refuses', () => {
  for (const q of planQueries({ hasRegions: true })) assert.ok(isValidQuery(q));
  assert.equal(isValidQuery({ level: 'campaign', breakdown: 'hour', timeIncrement: 'all_days', fields: ['reach'] }), false);
  const qs = queryString(planQueries({ hasRegions: false }).find((q) => q.breakdown === 'placement'), '2026-09-01', '2026-09-30');
  assert.match(qs, /breakdowns=publisher_platform%2Cplatform_position/);
});

test('Meta actions become leads without double counting one event', () => {
  const q = { level: 'ad', breakdown: 'none', timeIncrement: 1, fields: [] };
  const row = normalizeRow({ ad_id: '9', date_start: '2026-09-29', spend: '3.07', impressions: '900', actions: [{ action_type: 'lead', value: '2' }, { action_type: 'onsite_conversion.lead_grouped', value: '2' }] }, q);
  assert.equal(row.totals.leads, 2);
  assert.equal(row.totals.spendMinor, 307);
});

/* ── ANALYSIS ───────────────────────────────────────────────────────── */

test('weak evidence says INSUFFICIENT DATA and recommends nothing that changes money', () => {
  assert.equal(evidenceOf(1, 300), 'INSUFFICIENT_DATA');
  const r = recommend({ goal: 'LEADS_ON_META', status: 'ACTIVE', dailyBudgetMinor: 500, window: { current: 'w', previous: null },
    campaign: { current: T({ spendMinor: 300, impressions: 300, leads: 1 }), previous: null, outcomes: {} }, ads: [], recentlyChanged: [] });
  assert.deepEqual(r.map((x) => x.type), ['COLLECT_DATA']);
  assert.equal(r[0].actionable, false);
});

test('one cheap lead never crowns a winner', () => {
  const l = leaderOf('LEADS_ON_META', [
    { key: 'a', totals: T({ spendMinor: 100, impressions: 400, leads: 1 }) },
    { key: 'b', totals: T({ spendMinor: 5000, impressions: 9000, leads: 12 }) }]);
  assert.equal(l.leader, null);
});

test('cheap leads vs valuable leads: judged on cost per QUALIFIED lead when HOMATCH knows it', () => {
  const l = leaderOf('LEADS_ON_META', [
    { key: 'A', totals: T({ spendMinor: 30000, impressions: 30000, leads: 100 }), outcomes: { qualifiedLeads: 15 } },
    { key: 'B', totals: T({ spendMinor: 30000, impressions: 30000, leads: 60 }), outcomes: { qualifiedLeads: 36 } }]);
  assert.equal(l.basis, 'QUALIFIED');
  assert.equal(l.leader.key, 'B', 'A has the cheaper lead, B the cheaper qualified lead');
});

test('fatigue needs two independent signals', () => {
  const day = (d, imp, clicks, leads, spend, reach) => ({ date: `2026-09-${String(d).padStart(2, '0')}`, totals: T({ impressions: imp, linkClicks: clicks, leads, spendMinor: spend, reach }) });
  const fresh = [1, 2, 3].map((d) => day(d, 2000, 60, 6, 1000, 1500));
  const tired = [4, 5, 6].map((d) => day(d, 2000, 30, 3, 1000, 600));
  const f = fatigueSignals('LEADS_ON_META', [...fresh, ...tired]);
  assert.equal(f.fatigued, true);
  assert.ok(f.signals.includes('CTR_DECLINING') && f.signals.includes('COST_RISING'));
  const steady = fatigueSignals('LEADS_ON_META', [...fresh, ...[4, 5, 6].map((d) => day(d, 2000, 60, 6, 1000, 1500))]);
  assert.equal(steady.fatigued, false);
});

test('meaningful evidence produces a structured, actionable reallocation', () => {
  const ads = [
    { key: 'ad1', totals: T({ spendMinor: 20000, impressions: 20000, leads: 40 }) },
    { key: 'ad2', totals: T({ spendMinor: 20000, impressions: 20000, leads: 12 }) }];
  const cls = classifyCreatives('LEADS_ON_META', ads);
  assert.deepEqual(cls.map((c) => c.cls), ['STRONGEST_SIGNAL', 'UNDERPERFORMING']);
  const r = recommend({ goal: 'LEADS_ON_META', status: 'ACTIVE', dailyBudgetMinor: 5000, window: { current: 'w2', previous: 'w1' },
    campaign: { current: T({ spendMinor: 40000, impressions: 40000, leads: 52 }), previous: null, outcomes: {} }, ads, recentlyChanged: [] });
  const re = r.find((x) => x.type === 'REALLOCATE');
  assert.equal(re.affected, 'ad:ad2');
  assert.ok(['MEANINGFUL_SIGNAL', 'HIGH_CONFIDENCE'].includes(re.confidence));
  assert.ok(re.reasonCodes.length > 0 && re.baseline != null && re.candidate != null);
  const facts = summaryFacts({ goal: 'LEADS_ON_META', status: 'ACTIVE', currency: 'USD', totals: T({ spendMinor: 40000, leads: 52 }), outcomes: {}, recommendations: r });
  assert.ok(facts.some((f) => f.code === 'RECOMMEND_REALLOCATE'));
  assert.equal(factsKey(facts), factsKey(JSON.parse(JSON.stringify(facts))));
});

test('health: a delivering campaign with too little data says INSUFFICIENT DATA, not a verdict', () => {
  const h = health({ goal: 'LEADS_ON_META', status: 'ACTIVE', daysRunning: 1, dailyBudgetMinor: 500, last3Days: T({ impressions: 300 }),
    current: T({ impressions: 300, leads: 1 }), previous: null, outcomes: {}, leads: 1, creativeClasses: ['NEEDS_MORE_DATA'], lastSyncMinutes: 4, connectionOk: true });
  assert.equal(h.COST_EFFICIENCY.state, 'INSUFFICIENT_DATA');
  assert.equal(h.LEAD_QUALITY.state, 'INSUFFICIENT_DATA');
  assert.equal(h.DELIVERY.state, 'HEALTHY');
  assert.equal(h.DATA_HEALTH.state, 'HEALTHY');
});

/* ── GUARD ──────────────────────────────────────────────────────────── */

const now = Date.parse('2026-09-30T12:00:00Z');
const ago = (h) => new Date(now - h * 3600_000).toISOString();

test('one accidental pause in Meta is a NOTICE, never a strike or suspension', () => {
  const d = decide({ action: 'MANUAL_PAUSE', history: [], activeStrikes: 0, now });
  assert.equal(d.level, 'NOTICE');
  assert.equal(d.suspend, false);
  assert.equal(d.action, 'NONE');
});

test('repeated interference escalates NOTICE → WARNING → STRIKE over the rolling window', () => {
  const hist = [];
  const levels = [];
  for (const [i, action] of ['MANUAL_PAUSE', 'MANUAL_RESUME', 'MATERIAL_EDIT', 'MANUAL_PAUSE', 'MANUAL_RESUME', 'MATERIAL_EDIT'].entries()) {
    const d = decide({ action, history: hist, activeStrikes: 0, now: now + i * 60_000 });
    levels.push(d.level);
    hist.push({ action, level: d.level, at: new Date(now + i * 60_000).toISOString() });
  }
  assert.deepEqual(levels, ['NOTICE', 'NOTICE', 'WARNING', 'WARNING', 'WARNING', 'STRIKE']);
  const old = decide({ action: 'MANUAL_PAUSE', history: [{ action: 'MATERIAL_EDIT', level: 'WARNING', at: ago(24 * 30) }], activeStrikes: 0, now });
  assert.equal(old.level, 'NOTICE', 'events outside the window do not count');
});

test('HOMATCH\'s own writes are never flagged as external', () => {
  const item = { field: 'status', object: 'c1', from: 'ACTIVE', to: 'PAUSED', severity: 'STATUS' };
  assert.equal(isHomatchOrigin(item, [{ object: 'c1', field: 'status', expected: 'PAUSED', requestedAt: ago(0.1) }], now), true);
  assert.equal(isHomatchOrigin(item, [{ object: 'c1', field: 'status', expected: 'ACTIVE', requestedAt: ago(0.1) }], now), false);
  assert.equal(isHomatchOrigin(item, [], now), false);
});

test('drift is normalized: the same values in Meta\'s formatting are not drift', () => {
  const a = adSetState({ id: 's', status: 'ACTIVE', daily_budget: '500', end_time: '2026-10-07T10:00:00+0000', targeting: { geo_locations: { countries: ['GE'] }, age_min: 18, age_max: 65 } });
  const b = adSetState({ id: 's', status: 'ACTIVE', daily_budget: 500, end_time: '2026-10-07T10:00:30.000Z', targeting: { geo_locations: { countries: ['GE'] }, age_max: 65, age_min: 18 } });
  const base = { campaignStatus: 'ACTIVE', ads: [], pageId: 'p', instagramId: null, leadFormId: null };
  assert.deepEqual(diffState({ ...base, adSets: [a] }, { ...base, adSets: [b] }), []);
  const raised = diffState({ ...base, adSets: [a] }, { ...base, adSets: [{ ...a, dailyBudget: 900 }] });
  assert.equal(raised[0].severity, 'HIGH');
  assert.equal(classifyExternal(raised)[0].action, 'MATERIAL_EDIT');
});

const fp = (o = {}) => ({ id: 'X', name: 'HOMATCH LEADS', createdTime: ago(1), sourceCampaignId: null, sourceAdIds: [], imageHashes: [], videoIds: [], texts: [], leadFormIds: [], pageIds: [], countries: [], ...o });
const managed = { ...fp({ id: 'M', imageHashes: ['h1', 'h2'], texts: ['vake 2br', 'bright apartment'], leadFormIds: ['F'], pageIds: ['P'], countries: ['GE'] }), adIds: ['A1'], launchedAt: ago(48) };

test('same name only is NOT a duplicate', () => {
  assert.equal(duplicateLevel(managed, fp({ name: managed.name })).level, 'NONE');
});

test('a similar campaign is only POSSIBLE_RELATED → admin review, no strike, no action', () => {
  const d = duplicateLevel(managed, fp({ imageHashes: ['h1'], pageIds: ['P'] }));
  assert.equal(d.level, 'POSSIBLE_RELATED');
  const g = decide({ action: 'POSSIBLE_DUPLICATE', duplicate: d.level, history: [], activeStrikes: 0, now });
  assert.equal(g.level, 'REVIEW_REQUIRED');
  assert.equal(g.action, 'NONE');
  assert.equal(g.strikesAfter, 0);
});

test('Meta copy provenance or strong multi-signal evidence confirms a duplicate → strike + pause the copy', () => {
  assert.equal(duplicateLevel(managed, fp({ sourceCampaignId: 'M' })).level, 'CONFIRMED_DUPLICATE');
  assert.equal(duplicateLevel(managed, fp({ sourceAdIds: ['A1'] })).level, 'CONFIRMED_DUPLICATE');
  const copy = duplicateLevel(managed, fp({ imageHashes: ['h1', 'h2'], texts: ['Vake 2BR', 'Bright  apartment'], leadFormIds: ['F'], pageIds: ['P'], countries: ['GE'] }));
  assert.equal(copy.level, 'HIGH_CONFIDENCE_COPY');
  const g = decide({ action: 'CONFIRMED_DUPLICATE', history: [], activeStrikes: 1, now });
  assert.deepEqual([g.level, g.action, g.strikesAfter], ['STRIKE', 'PAUSE_DUPLICATE', 2]);
  assert.equal(duplicateLevel(managed, fp({ id: 'M' })).level, 'NONE', 'the managed campaign itself is never its own duplicate');
});

test('the fifth active strike suspends Meta Ads for that ad account; cleared or expired strikes do not count', () => {
  const g = decide({ action: 'CONFIRMED_DUPLICATE', history: [], activeStrikes: DEFAULT_GUARD_POLICY.maxStrikes - 1, now });
  assert.equal(g.suspend, true);
  const incidents = [
    ...[1, 2, 3].map(() => ({ level: 'STRIKE', status: 'ACTIVE', created_at: ago(24) })),
    { level: 'STRIKE', status: 'CLEARED', created_at: ago(24) },
    { level: 'STRIKE', status: 'ACTIVE', created_at: ago(24 * 400) },
    { level: 'WARNING', status: 'ACTIVE', created_at: ago(1) }];
  assert.equal(activeStrikeCount(incidents, now), 3);
});

/* ── LEAD FORMS ─────────────────────────────────────────────────────── */

test('lead form: chosen questions only, in the customer\'s language, Meta-shaped', () => {
  const spec = { name: 'Vake 2BR', headline: 'Tell us what you need', contactFields: ['FULL_NAME', 'PHONE'], questions: ['buy_or_rent', 'budget'], privacyPolicyUrl: 'https://homatch.live/privacy', locale: 'ka' };
  assert.deepEqual(validateLeadFormSpec(spec), []);
  const p = leadFormPayload(spec);
  const qs = JSON.parse(p.questions);
  assert.deepEqual(qs.map((q) => q.type), ['FULL_NAME', 'PHONE', 'CUSTOM', 'CUSTOM']);
  assert.equal(qs[2].label, 'ყიდვა გსურთ თუ ქირაობა?');
  assert.equal(p.locale, 'ka_GE');
  assert.equal(leadFormPreview(spec).questions.length, 2);
  assert.ok(validateLeadFormSpec({ ...spec, contactFields: ['FULL_NAME'], privacyPolicyUrl: 'http://x' }).length >= 2);
  assert.deepEqual(mapLeadAnswers([{ name: 'full_name', values: ['Nino'] }, { name: 'buy_or_rent', values: ['Buy'] }]), { name: 'Nino', buy_or_rent: 'Buy' });
});
