// Verify V3 (owner, 2026-10-29): a separate engine for the cost round.
//
// Proves, in this order: (1) engine stamping, switching and running-job
// stability; (2) V2 isolation: a V1/V2 job's routing, prompt, report, reuse
// and Developer Advertising are exactly as before; (3) the V3 report: Luna
// routing, the cheap repair, blocking-only escalation, the per-call ledger,
// code-owned fields; (4) V3 parity: the same report sections and blocks a V2
// report has; (5) Developer Advertising off in V3 only, and SYNTHESIS_READY
// never waits on it; (6) public-research reuse and its labelling;
// (7) the migration touches no V1/V2 setting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { engineForNewJob, engineOf, engineVersionOf, isV3, parseEngineSetting } from '../../engine.ts';
import {
  appendReportAttempts, nextReportBuild, parseResearchTuning, priorReportAttempts, reportAttemptTag, reportBlockingFailures,
  reportRepairEnabled, reportRepairFindings, reportRepairPrompt, reportRequestExtras, reportRoutingFor, reportScore,
  reportTuningFor, reuseFreshnessDays, REPORT_DEFAULTS,
} from '../researchRequest.ts';
import { parcelKey, pickReuse, reusableRecord, reusedObservations, withoutOwnerLevel } from '../evidenceReuse.ts';
import { villionV3, COMPLETED_AT } from '../../intelligence/__tests__/fixtures/villionV3Fixture.mjs';
import { buildEvidencePackage } from '../../intelligence/evidencePackage.ts';
import { buildIntelligenceBundle } from '../../intelligence/bundle.ts';
import { buildIntelligencePrompt } from '../../intelligence/prompt.ts';
import { finalizeReport } from '../../intelligence/report.ts';
import { codeSectionMetrics } from '../../intelligence/codeMetrics.ts';
import { withPropertyRegister } from '../../intelligence/registerEnrichment.ts';
import { storyKeptOnRebuild } from '../../intelligence/storyGuard.ts';

const at = '2026-10-29T12:00:00.000Z';
const read = (rel) => readFileSync(fileURLToPath(new URL(`../../../../${rel}`, import.meta.url)), 'utf8');
const RA = read('supabase/functions/research-agent/index.ts');
const VS = read('supabase/functions/verify-synthesis/index.ts');
const MIG = read('supabase/migrations/20261207120000_verify_cost_round.sql');
const fnBody = (src, start, end) => src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start)));

const ADS_VIEW = {
  outcome: 'COMPLETE', verifiedAt: '2026-10-20T10:00:00Z', platformSearched: 'META_AD_LIBRARY', country: 'GE', searchedFor: ['Villion'],
  identity: { developerNames: ['Villion'], legalName: null, projectNames: [], basis: 'WEB' },
  activeCount: 2, historicalCount: 1, unknownStatusCount: 0, platforms: ['facebook'], advertisers: [{ pageName: 'Villion', owner: 'DEVELOPER', url: null, activeAds: 2 }],
  projectsAdvertised: [], themes: [{ theme: 'PRICE', count: 1 }], concentration: 'SINGLE_PLATFORM', examples: [], socialProfiles: [],
  librarySearchUrl: null, otherAdvertiserAds: 0, duplicatesRemoved: 0, limitations: [],
};
const v2Job = (research = {}) => ({ ...villionV3(), developerAds: ADS_VIEW, _engine: { version: 'V2', research } });
const v3Job = (research = {}) => ({ ...villionV3(), _engine: { version: 'V3', research } });

/* ───────────────────────── 1. engine ───────────────────────── */

test('V3 is stamped only while enabled; off sends admins to V2 and customers to V1', () => {
  assert.deepEqual(engineForNewJob({ active: 'V1', adminPreview: 'V3', v3Enabled: true }, at, false, { isAdmin: true }), { version: 'V3', audience: 'admin_preview', selectedAt: at });
  assert.deepEqual(engineForNewJob({ active: 'V1', adminPreview: 'V3' }, at, false, { isAdmin: true }), { version: 'V2', requested: 'V3', audience: 'admin_preview', selectedAt: at });
  assert.deepEqual(engineForNewJob({ active: 'V3', v3Enabled: true }, at, false), { version: 'V3', selectedAt: at });
  assert.deepEqual(engineForNewJob({ active: 'V3' }, at, false), { version: 'V1', requested: 'V3', selectedAt: at });
  // V2 selection is exactly as before.
  assert.deepEqual(engineForNewJob({ active: 'V1', adminPreview: 'V2', v3Enabled: true }, at, false, { isAdmin: true }), { version: 'V2', audience: 'admin_preview', selectedAt: at });
  assert.deepEqual(engineForNewJob({ active: 'V2', v3Enabled: true }, at, false), { version: 'V1', requested: 'V2', selectedAt: at });
  assert.equal(parseEngineSetting({ active: 'V3', v3Enabled: true }).v3Enabled, true);
});

test('a running job keeps the engine stamped at its start; V3 runs the V2 pipeline', () => {
  const job = { _engine: { version: 'V3', selectedAt: at } };
  assert.equal(engineVersionOf(job), 'V3');
  assert.equal(engineOf(job), 'V2', 'V3 runs every V2 pipeline step');
  assert.equal(isV3(job), true);
  // Nothing outside the stamp is read: a later setting change cannot move it.
  assert.equal(engineVersionOf({ ...job, verify_engine: { active: 'V2' } }), 'V3');
  assert.equal(isV3({ _engine: { version: 'V2' } }), false);
  assert.equal(engineVersionOf(null), 'V1');
  // research-agent stamps V3 with ITS OWN routing setting; V2 keeps verify_v2_research.
  assert.match(RA, /: engine\.version === 'V3' \? \{ \.\.\.engine, research: parseResearchTuning\(await adminSettingJson\(sb, VERIFY_V3_RESEARCH_SETTING_KEY\)\) \}/);
});

/* ───────────────────────── 2. V2 isolation ───────────────────────── */

test('V2 report routing: the stamp alone, as before; a live V3 setting is ignored', () => {
  assert.deepEqual(reportRoutingFor(v2Job({ report: { policy: 'TERRA' } }), 'gpt-5.6-luna', { report: { policy: 'AUTO' } }), { model: 'gpt-5.6-terra', policy: 'TERRA', fallbackModel: null });
  assert.deepEqual(reportRoutingFor(v2Job({}), 'gpt-5.6-luna'), { model: 'gpt-5.6-luna', policy: 'DEFAULT', fallbackModel: null });
  assert.deepEqual(reportRoutingFor({ _engine: { version: 'V1' } }, 'gpt-5.6-luna', { report: { policy: 'AUTO' } }), { model: 'gpt-5.6-luna', policy: 'DEFAULT', fallbackModel: null });
  assert.deepEqual(reportTuningFor(v2Job({ report: { policy: 'TERRA' } }), { report: { policy: 'AUTO', repair: false } }), { policy: 'TERRA' });
  assert.equal(reuseFreshnessDays(v2Job({ reuse: { freshnessDays: 7 } })), 0, 'V2 never reuses');
  assert.equal(reuseFreshnessDays({ _engine: { version: 'V1' } }), 0);
});

test('V2 report call in verify-synthesis: no extras, no repair, the earlier escalation and one cost row', () => {
  assert.match(VS, /const requestExtras = v3 \? reportRequestExtras\(/);
  assert.match(VS, /if \(v3 && callReport && raw && repairFindings\.length && reportRepairEnabled\(reportTuning\)\) \{/);
  assert.match(VS, /const failures = v3 \? reportBlockingFailures\(final, !!raw, reportTuning\) : reportQualityFailures\(final, !!raw\);/);
  assert.match(VS, /: !!second\.raw && failures2\.length < failures\.length;/);
  assert.match(VS, /if \(!v3\) await recordReportCost\(writer, jobId, usage, job\.synthesis_at \?\? null\);/);
  assert.match(VS, /const finalizeOpts = v3\n\s+\? \{ fieldOwnership: 'CODE' as const,[^\n]*\n\s+: \{\};/);
  assert.match(VS, /\.\.\.\(v3 \? \{ fieldOwnership: 'CODE' as const, skipStory, reusedResearch: reusedObservations\(rj\) \} : \{\}\),/);
  assert.match(VS, /const adsVisible = !v3;/);
  assert.match(VS, /const live = v3 \? await liveV3Settings\(writer\) : \{ research: undefined \};/);
  assert.match(VS, /\.\.\.\(v3 \? \{ _reportAttempts: reportAttempts, developerAdsHidden: true \} : \{\}\),/);
});

test('V2 prompt: byte-identical with or without the new options; ads digest and code-owned fields still asked', () => {
  const r = v2Job();
  const pkg = buildEvidencePackage(r, { now: COMPLETED_AT });
  const bundle = buildIntelligenceBundle(r, pkg, null);
  const plain = buildIntelligencePrompt(pkg, bundle, 'APARTMENT_IN_PROJECT');
  const withUnset = buildIntelligencePrompt(pkg, bundle, 'APARTMENT_IN_PROJECT', { fieldOwnership: undefined, skipStory: undefined, reusedResearch: undefined });
  assert.equal(withUnset.system, plain.system);
  assert.equal(withUnset.user, plain.user);
  assert.match(plain.system, /"currentStatus": \{/);
  assert.match(plain.system, /"visualCaptions": \[/);
  assert.match(plain.system, /"advertisingAssessment": \{/);
  assert.match(plain.system, /"metrics": \[/);
  assert.doesNotMatch(plain.system, /FIELDS WRITTEN BY CODE/);
  assert.ok(JSON.parse(plain.user).developerAdvertising, 'V2 still hands the model the advertising digest');
});

test('V2 finalize: the model fields are kept exactly as before', () => {
  const r = v2Job();
  const pkg = buildEvidencePackage(r, { now: COMPLETED_AT });
  const raw = JSON.stringify(modelReport(pkg));
  const a = finalizeReport(pkg, raw, null);
  const b = finalizeReport(pkg, raw, null, {});
  assert.deepEqual(b, a);
  assert.equal(a.mode, 'MODEL');
  assert.equal(a.sections[0].metrics[0].value, '99 მ²', 'V2 keeps the model metric');
  assert.ok(a.advertisingAssessment, 'V2 keeps the model advertising assessment');
});

test('V2 research-agent: the ads stage, its policy read and the identity prompt are untouched', () => {
  const ads = fnBody(RA, 'async function advanceDeveloperAds(', 'async function recordDeveloperAdsCost(');
  const early = ads.indexOf("if (isV3(p)) return finishDeveloperAds(p, 'DISABLED'");
  assert.ok(early > 0 && early < ads.indexOf('await developerAdsPolicyFor(sb)'), 'only V3 returns before the policy read');
  assert.match(RA, /const text = prompt\(s, j, j\.result_json \|\| \{\}, l, \{ adsEnabled: isV3\(j\.result_json\) \? false : undefined \}\);/);
  // Inside prompt(): the ONLY V3 difference is the Facebook-page ask, which fed the ads stage alone.
  const p = fnBody(RA, 'function prompt(s: Stage', 'async function reusableStageFor(');
  assert.equal((p.match(/adsEnabled === false/g) ?? []).length, 1);
  assert.doesNotMatch(p, /\bv3\b|isV3/, 'no other engine branch in any research prompt');
  const identity = fnBody(p, "if (s === 'IDENTITY')", "if (s === 'OFFICIAL_COLLECTION')");
  assert.match(identity, /\(opts\.adsEnabled === false \? '' : `BRAND AND SOCIAL PAGES:/);
  const official = fnBody(p, "if (s === 'OFFICIAL_COLLECTION')", "if (s === 'PUBLIC_RESEARCH')");
  const publicResearch = fnBody(p, "if (s === 'PUBLIC_RESEARCH')", "if (s === 'MARKET')");
  const market = fnBody(p, "if (s === 'MARKET')", "if (s === 'SYNTHESIS')");
  for (const part of [official, publicResearch, market]) {
    assert.doesNotMatch(part, /adsEnabled|isV3|\bv3\b/, 'official collection, public research and market prompts are identical for V2 and V3');
  }
  // Public research keeps its location topics and nearbyPlaces exactly as V2 (owner: research quality is not reduced).
  assert.ok(publicResearch.includes("this exact project/property/company: ${scope.targets.join(', ')}."));
  assert.ok(publicResearch.includes(',"nearbyPlaces":{"category":"SCHOOL|KINDERGARTEN'));
  assert.match(publicResearch, /\n\s+`nearbyPlaces: the few genuinely NEAREST places/);
});

/* ───────────────────────── 3. the V3 report ───────────────────────── */

test('V3 routing: Luna first with Terra as the gate fallback; the live V3 setting decides at build time', () => {
  assert.deepEqual(reportRoutingFor(v3Job({}), 'gpt-5.6-luna'), { model: 'gpt-5.6-luna', policy: 'AUTO', fallbackModel: 'gpt-5.6-terra' });
  assert.deepEqual(reportRoutingFor(v3Job({ report: { policy: 'AUTO' } }), 'gpt-5.6-luna', { report: { policy: 'TERRA' } }), { model: 'gpt-5.6-terra', policy: 'TERRA', fallbackModel: null });
  const tuning = parseResearchTuning({ report: { policy: 'AUTO', reasoningEffort: 'medium', maxOutputTokens: 30000, repair: false, bogus: 1 } }).report;
  assert.deepEqual(tuning, { policy: 'AUTO', reasoningEffort: 'medium', maxOutputTokens: 30000, repair: false });
  assert.deepEqual(reportRequestExtras({}, 'LAND'), { reasoning: { effort: 'low' }, max_output_tokens: REPORT_DEFAULTS.maxOutputTokens, prompt_cache_key: 'homatch-verify-report:land' });
  assert.equal(reportRequestExtras(tuning, null).reasoning.effort, 'medium', 'effort can be raised by setting');
  assert.equal(reportRepairEnabled({}), true);
  assert.equal(reportRepairEnabled({ repair: false }), false);
  assert.equal(parseResearchTuning({ report: { maxOutputTokens: 999 } }).report, undefined, 'out of range is dropped');
});

test('V3 gate: repair on any finding; Terra only for a rejected report, never for style or removed sentences', () => {
  const removed = { mode: 'MODEL', rejectedBecause: ['contradicts deterministic valuation (INSUFFICIENT_EVIDENCE): …'], summary: { statement: 'ok' } };
  assert.deepEqual(reportBlockingFailures(removed, true), [], 'the sentence is already gone: no Terra');
  assert.equal(reportRepairFindings(removed, true).length, 1, 'but Luna repairs it');
  assert.equal(reportBlockingFailures(removed, true, { escalateOnRemovals: true }).length, 1, 'owner switch restores the old rule');
  const rejected = { mode: 'DETERMINISTIC', rejectedBecause: ['ungrounded citation e99 in section MARKET'] };
  assert.deepEqual(reportBlockingFailures(rejected, true), ['ungrounded citation e99 in section MARKET']);
  const style = { mode: 'DETERMINISTIC', rejectedBecause: ['provenance phrase "x" repeated 4 times'] };
  assert.deepEqual(reportBlockingFailures(style, true), [], 'style never pays for Terra');
  assert.deepEqual(reportRepairFindings(style, true), ['provenance phrase "x" repeated 4 times'], 'style is repaired cheaply');
  assert.deepEqual(reportBlockingFailures({ mode: 'MODEL', rejectedBecause: [], summary: { statement: '' } }, true), ['no summary statement left after the gate']);
  assert.deepEqual(reportBlockingFailures(rejected, false), [], 'no answer is a transport failure');
  assert.ok(reportScore({ mode: 'MODEL', rejectedBecause: ['a', 'b'] }, true) < reportScore({ mode: 'DETERMINISTIC', rejectedBecause: [] }, true));
  const prompt = reportRepairPrompt(['ungrounded citation e99'], false);
  assert.match(prompt, /- ungrounded citation e99/);
  assert.match(prompt, /COMPLETE report again as strict JSON/);
});

test('V3 cost ledger: every paid call once, across rebuilds, with unique cost tags; legacy usage seeded once', () => {
  const legacy = priorReportAttempts({ _usage: { model: 'gpt-5.6-terra', inputTokens: 50000, outputTokens: 9000, cachedTokens: 0 }, _usageFirstAttempt: { model: 'gpt-5.6-luna', inputTokens: 50000, outputTokens: 8000 } });
  assert.deepEqual(legacy.map((a) => [a.kind, a.model]), [['legacy', 'gpt-5.6-luna'], ['legacy', 'gpt-5.6-terra']]);
  assert.equal(nextReportBuild([]), 1);
  assert.equal(nextReportBuild(legacy), 2);
  const call = (kind, build) => ({ kind, model: 'gpt-5.6-luna', inputTokens: 1, cachedTokens: 0, outputTokens: 1, build, at });
  const b1 = appendReportAttempts([], [call('first', 1), call('repair', 1), call('escalation', 1)]);
  const b2 = appendReportAttempts(priorReportAttempts({ _reportAttempts: b1 }), [call('first', 2)]);
  assert.equal(b2.length, 4, 'a rebuild adds to the ledger, never replaces it');
  assert.ok(b2.every((a) => a.kept === false || a.build === 2));
  const tags = b1.map((a, i) => reportAttemptTag(a, i));
  assert.deepEqual(tags, ['b1:1:first', 'b1:2:repair', 'b1:3:escalation']);
  // The view prices the ledger instead of _usage, never both.
  assert.match(MIG, /and jsonb_typeof\(j\.synthesis_json->'_reportAttempts'\) is distinct from 'array'/);
  assert.match(MIG, /cross join lateral jsonb_array_elements\(j\.synthesis_json->'_reportAttempts'\) with ordinality as a\(call, ord\)/);
});

test('V3 prompt: code-owned fields leave, static rules first, per-job lines last, story skipped on a kept rebuild', () => {
  const r = v3Job();
  const pkg = buildEvidencePackage(r, { now: COMPLETED_AT, developerAds: false });
  const bundle = buildIntelligenceBundle(r, pkg, null);
  const v3 = buildIntelligencePrompt(pkg, bundle, 'APARTMENT_IN_PROJECT', { fieldOwnership: 'CODE' });
  for (const field of ['"currentStatus": {', '"visualCaptions": [', '"visualExplanations": [', '"advertisingAssessment": {', '"metrics": [']) {
    assert.ok(!v3.system.includes(field), field);
  }
  assert.match(v3.system, /FIELDS WRITTEN BY CODE/);
  assert.match(v3.system, /"propertyStory": \{/);
  const tail = v3.system.slice(v3.system.indexOf('── THIS REPORT'));
  assert.match(tail, /sections\.key: only /);
  assert.equal(JSON.parse(v3.user).developerAdvertising, undefined);
  // The static prefix is the same for two jobs of the same study with different evidence richness.
  const sparse = buildIntelligencePrompt({ ...pkg, items: pkg.items.slice(0, 2), tierCounts: { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0 } }, bundle, 'APARTMENT_IN_PROJECT', { fieldOwnership: 'CODE' });
  const cut = (s) => s.slice(0, s.indexOf('── THIS REPORT'));
  assert.equal(cut(sparse.system), cut(v3.system), 'cacheable prefix is identical');
  const kept = buildIntelligencePrompt(pkg, bundle, 'APARTMENT_IN_PROJECT', { fieldOwnership: 'CODE', skipStory: true, reusedResearch: [{ stage: 'public_research', observedOn: '2026-10-25' }] });
  assert.ok(!kept.system.includes('"propertyStory": {'));
  assert.match(kept.system, /propertyStory: do NOT return it/);
  assert.match(kept.system, /observed on 2026-10-25/);
  assert.equal(storyKeptOnRebuild({ _logicVersion: 8, report: { propertyStory: { chapters: [] } } }, { autoUpgrade: true }), false);
});

test('V3 finalize: status, captions, metrics and advertising come from code; the model prose stays', () => {
  const r = v3Job();
  const pkg = buildEvidencePackage(r, { now: COMPLETED_AT, developerAds: false });
  const bundle = buildIntelligenceBundle(r, pkg, null);
  const raw = JSON.stringify(modelReport(pkg));
  const metrics = codeSectionMetrics(bundle);
  const out = finalizeReport(pkg, raw, null, { fieldOwnership: 'CODE', metrics, advertising: null });
  assert.equal(out.mode, 'MODEL');
  assert.equal(out.advertisingAssessment, undefined, 'never the model assessment');
  assert.ok(!out.sections.some((s) => s.metrics.some((m) => m.value === '99 მ²')), 'model metric values are never shown');
  assert.notEqual(out.currentStatus?.statement, 'MODEL STATUS', 'currentStatus is code-written');
  assert.equal(out.summary.statement, modelReport(pkg).summary.statement, 'prose is the model\'s');
});

test('code metrics: the valuation contract holds (no price for INSUFFICIENT_EVIDENCE)', () => {
  const base = { snapshot: { area: '74.3', floor: '5', amenities: [] }, register: null, livingDensity: { units: 120, buildings: 2, floorsPerBuilding: 12, unitsPerFloor: 4, landPerUnitSqm: 21.4, plotAreaSqm: 2568, boutique: true } };
  const est = codeSectionMetrics({ ...base, market: { valuation: { state: 'ESTIMATE', pricePerSqm: { median: 1700, min: 1500, max: 1900 }, currency: 'USD', priceBasis: 'ASKING' } } });
  assert.deepEqual(est.MARKET, [{ label: 'მოთხოვნილი ფასი მ²-ზე', value: '$1 500–1 900' }]);
  assert.deepEqual(est.SNAPSHOT.map((m) => m.value), ['74.3 მ²', '5']);
  assert.equal(est.PROJECT[0].value, '120');
  const none = codeSectionMetrics({ ...base, market: { valuation: { state: 'INSUFFICIENT_EVIDENCE', pricePerSqm: null, currency: 'USD' } } });
  assert.equal(none.MARKET, undefined);
});

/* ───────────────────────── 4. parity ───────────────────────── */

test('V3 parity: the same report blocks and section keys as V2, for the same evidence', () => {
  const r2 = v2Job();
  const r3 = v3Job();
  const p2 = buildEvidencePackage(r2, { now: COMPLETED_AT });
  const p3 = buildEvidencePackage(r3, { now: COMPLETED_AT, developerAds: false });
  const v2 = finalizeReport(p2, JSON.stringify(modelReport(p2)), null);
  const v3 = finalizeReport(p3, JSON.stringify(modelReport(p3)), null, { fieldOwnership: 'CODE', metrics: codeSectionMetrics(buildIntelligenceBundle(r3, p3, null)), advertising: null });
  const blocks = (x) => Object.keys(x).filter((k) => k !== 'advertisingAssessment' && x[k] !== undefined).sort();
  assert.deepEqual(blocks(v3), blocks(v2));
  assert.deepEqual(v3.sections.map((s) => s.key), v2.sections.map((s) => s.key));
  // One renderer for every engine (the printed PDF is the same page): its only engine-aware line is the ads guard.
  const page = read('src/components/verify/VerifyReport.tsx');
  assert.doesNotMatch(page, /isV3|engineVersionOf|_engine/);
  assert.match(page, /const adsShown = !!synthesis\.developerAds && synthesis\.developerAdsHidden !== true;/);
});

/* ───────────────────────── 5. Developer Advertising ───────────────────────── */

test('V3: no memo23 run, no wait at SYNTHESIS_READY, no ads in the evidence, prompt, report or read', () => {
  // SYNTHESIS_READY: advanceDeveloperAds returns false at once for V3, so the report follows in the same tick.
  const ready = fnBody(RA, "if (j.status === 'CREATED' && j.stage === 'SYNTHESIS_READY') {", "return await launch(sb, k, m, j, 'SYNTHESIS', l);");
  assert.match(ready, /const waiting = await advanceDeveloperAds\(sb, j\);[\s\S]*if \(waiting\) return;[\s\S]*if \(engineOf\(j\.result_json\) === 'V2'\) return await finish\(sb, j, 'SYNTHESIS', null, l, true\);/);
  const ads = fnBody(RA, 'async function advanceDeveloperAds(', 'async function recordDeveloperAdsCost(');
  assert.ok(ads.indexOf("if (isV3(p)) return finishDeveloperAds(p, 'DISABLED', { reason: 'ENGINE_V3' });") < ads.indexOf('apifyStartRun('));
  // Evidence: a stored view never reaches a V3 package.
  const withAds = { ...villionV3(), developerAds: ADS_VIEW };
  assert.ok(buildEvidencePackage(withAds, { now: COMPLETED_AT }).developerAds, 'V2 package keeps it');
  const off = buildEvidencePackage(withAds, { now: COMPLETED_AT, developerAds: false });
  assert.equal(off.developerAds, undefined);
  assert.ok(!off.items.some((i) => i.source === 'Meta Ad Library'));
  // Read path: a V3 report is marked; enrichment and forCustomer drop the section, V2 reads are unchanged.
  const stored = { report: { summary: {}, advertisingAssessment: { statement: 'x', points: [], cites: [] } }, developerAds: ADS_VIEW, developerAdsHidden: true };
  const hidden = withPropertyRegister(stored, withAds, { adsHidden: true });
  assert.equal(hidden.developerAds, undefined);
  assert.equal(hidden.report.advertisingAssessment, undefined);
  const v2read = withPropertyRegister({ ...stored, developerAdsHidden: undefined }, withAds, {});
  assert.ok(v2read.developerAds && v2read.report.advertisingAssessment);
  assert.match(VS, /const adsHidden = job\?\.synthesis_json\?\.developerAdsHidden === true;/);
  assert.match(VS, /if \(rest\.developerAdsHidden === true\) \{\n\s+delete rest\.developerAds;/);
});

/* ───────────────────────── 6. reuse ───────────────────────── */

test('reuse: identity for the exact unit, public research for the parcel, inside the window, owner data never', () => {
  const now = Date.parse('2026-10-29T12:00:00Z');
  const rec = (output, observedAt) => reusableRecord(output, observedAt);
  const cands = [
    { id: 'a', query: '01.18.06.019.055.03.01.503', completedAt: '2026-10-27T00:00:00Z', reusable: { identity: rec({ entity: { name: 'Villion' }, owners: ['ნ. ბ.'] }, '2026-10-27T00:00:00Z'), public_research: rec({ facts: ['f'], developerReputation: 'ok', mortgages: ['m'] }, '2026-10-27T00:00:00Z') } },
    { id: 'old', query: '01.18.06.019.055.03.01.601', completedAt: '2026-10-28T00:00:00Z', reusable: { public_research: rec({ facts: ['older chain'] }, '2026-10-10T00:00:00Z') } },
    { id: 'other', query: '01.18.06.019.056', completedAt: '2026-10-28T00:00:00Z', reusable: { public_research: rec({ facts: ['x'] }, '2026-10-28T00:00:00Z') } },
  ];
  const id = pickReuse('identity', '01.18.06.019.055.03.01.503', cands, { now, freshnessDays: 7 });
  assert.equal(id.fromJobId, 'a');
  assert.equal(id.output.owners, undefined, 'owner-level data never travels');
  assert.equal(pickReuse('identity', '01.18.06.019.055.03.01.601', cands, { now, freshnessDays: 7 }), null, 'identity needs the exact code');
  const pr = pickReuse('public_research', '01.18.06.019.055.03.01.601', cands, { now, freshnessDays: 7 });
  assert.equal(pr.fromJobId, 'a', 'the reused-then-reused finding is past the window by its OBSERVED date');
  assert.equal(pr.output.mortgages, undefined);
  assert.equal(pr.observedAt, '2026-10-27T00:00:00.000Z');
  assert.equal(pickReuse('public_research', '01.18.06.019.055.03.01.601', cands, { now, freshnessDays: 0 }), null, '0 switches it off');
  assert.equal(parcelKey('01.18.06.019.055.03.01.601'), '01.18.06.019.055');
  assert.deepEqual(withoutOwnerLevel({ a: { registeredOwners: [1], keep: 2 } }), { a: { keep: 2 } });
  assert.equal(reuseFreshnessDays(v3Job({})), 7);
  assert.equal(reuseFreshnessDays(v3Job({ reuse: { freshnessDays: 3 } })), 3);
});

test('reuse labelling: every reused public finding carries its observed day; V2 evidence is undated as before', () => {
  const base = villionV3();
  const fresh = buildEvidencePackage(base, { now: COMPLETED_AT });
  const reused = buildEvidencePackage({ ...base, publicResearch: { ...(base.publicResearch ?? {}), facts: ['პროექტს ორი კორპუსი აქვს.'], observedAt: '2026-10-25T08:00:00Z' } }, { now: COMPLETED_AT });
  const item = reused.items.find((i) => i.claim === 'პროექტს ორი კორპუსი აქვს.');
  assert.equal(item.date, '2026-10-25');
  assert.equal(item.observedEarlier, true);
  assert.ok(!fresh.items.some((i) => i.observedEarlier));
  assert.deepEqual(reusedObservations({ _reusedStages: { public_research: { observedAt: '2026-10-25T08:00:00Z' } } }), [{ stage: 'public_research', observedOn: '2026-10-25' }]);
  // research-agent: only V3 reuses or stores reusable outputs; V2 rows gain no keys.
  assert.match(RA, /if \(!isV3\(p\) \|\| j\.mode !== 'cadastral'\) return null;/);
  assert.match(RA, /if \(\(s === 'IDENTITY' \|\| s === 'PUBLIC_RESEARCH'\) && isV3\(prior\)\) rememberReusable\(prior, s, z, reused\);/);
  assert.match(RA, /\.\.\.\(prior\._reusable \? \{ _reusable: prior\._reusable \} : \{\}\),/);
});

/* ───────────────────────── 7. migration ───────────────────────── */

test('the migration changes no V1/V2 setting and only seeds V3', () => {
  assert.doesNotMatch(MIG, /update public\.admin_settings/i);
  assert.match(MIG, /'verify_v3_research',[\s\S]*on conflict \(key\) do nothing;/);
  assert.ok(MIG.indexOf('create unique index if not exists cost_events_verify_once_per_attempt') < MIG.indexOf('drop index if exists public.cost_events_verify_once_per_stage'));
  assert.match(MIG, /if not public\.is_admin\(\) then raise exception 'FORBIDDEN'/);
  assert.match(MIG, /revoke all on function public\.admin_verify_engine_stats\(integer\) from public, anon;/);
});

/** A grounded model answer for a package, with every field a V2 model writes. */
function modelReport(pkg) {
  const e = pkg.items.slice(0, 3).map((i) => i.id);
  return {
    summary: { label: 'BALANCED', statement: 'საერთო სურათი დაბალანსებულია.', highlights: [{ dimension: 'PROJECT_QUALITY', sentiment: 'BALANCED', headline: 'პროექტი', detail: 'დეტალი.', cites: [e[0]] }] },
    keyFindings: [{ finding: 'ფაქტი.', whyItMatters: 'მნიშვნელობა.', sentiment: 'BALANCED', cites: [e[0]] }],
    sections: [
      { key: 'SNAPSHOT', title: 'მიმოხილვა', body: 'მოკლე აღწერა.', metrics: [{ label: 'ფართი', value: '99 მ²' }], cites: [e[0]] },
      { key: 'PROJECT', title: 'პროექტი', body: 'პროექტის აღწერა.', metrics: [], cites: [e[1] ?? e[0]] },
    ],
    currentStatus: { statement: 'MODEL STATUS', items: [{ label: 'სტატუსი', value: 'x', date: '', cites: [e[0]] }] },
    advertisingAssessment: { statement: 'რეკლამა ჩანს.', points: ['ერთი.'], cites: [e[0]] },
    attentionPoints: [],
    nextSteps: [],
    finalView: 'დასკვნა.',
    contractUpload: { recommend: true, text: 'ატვირთეთ ხელშეკრულება.' },
  };
}
