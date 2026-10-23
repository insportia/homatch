// costController.test.mjs — V2 code-first research: market in code, search log, budget ceiling,
// bounded escalation, adaptive report model (src/verify/v2/researchRequest.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  budgetDecision, canonicalModel, escalationModelFor, marketCodeDecision, parseResearchTuning, reportQualityFailures,
  reportRoutingFor, researchSpentUsd, searchLogBrief, searchQueriesOf, stageOutputUsable, v2ResearchRequest,
} from '../researchRequest.ts';

const v2 = (research, extra = {}) => ({ _engine: { version: 'V2', research }, ...extra });
const BASE = 'RULES '.repeat(40);

test('settings: unknown values drop to "as V1"; every new control is validated', () => {
  const t = parseResearchTuning({
    market: { mode: 'AUTO', maxSearches: 1, model: 'gpt-5.6-luna' }, identity: { mode: 'CODE' },
    report: { policy: 'AUTO' }, budget: { preferredUsd: 0.03, ceilingUsd: 0.05 }, escalation: { enabled: true },
  });
  assert.deepEqual(t, { market: { mode: 'AUTO', maxSearches: 1, model: 'gpt-5.6-luna' }, report: { policy: 'AUTO' }, budget: { preferredUsd: 0.03, ceilingUsd: 0.05 }, escalation: { enabled: true } });
  assert.deepEqual(parseResearchTuning({ report: { policy: 'GPT' }, budget: { ceilingUsd: -1 }, escalation: { enabled: 'yes' } }), {});
  assert.equal(parseResearchTuning({ identity: { mode: 'CODE' } }).identity, undefined, 'mode is MARKET-only');
});

test('market runs in code when the gate left a defensible set (AUTO) or always (CODE); otherwise a model', () => {
  assert.deepEqual(marketCodeDecision(v2({ market: { mode: 'AUTO' } }), 3, 3), { code: true, reason: 'ELIGIBLE_COMPARABLES_3' });
  assert.deepEqual(marketCodeDecision(v2({ market: { mode: 'AUTO' } }), 1, 3), { code: false, reason: 'TOO_FEW_COMPARABLES_1' });
  assert.equal(marketCodeDecision(v2({ market: { mode: 'CODE' } }), 0, 3).code, true);
  assert.equal(marketCodeDecision(v2({}), 50, 3).code, false, 'unset = as V1');
  assert.equal(marketCodeDecision({ _engine: { version: 'V1', research: { market: { mode: 'CODE' } } } }, 50, 3).code, false);
});

test('the search log: queries are read from the answer and shown to later stages, never with the tool off', () => {
  const resp = { output: [{ type: 'web_search_call', action: { query: 'Villa Residence developer' } }, { type: 'message' }, { type: 'web_search_call', action: { query: ' ' } }] };
  assert.deepEqual(searchQueriesOf(resp), ['Villa Residence developer']);
  const log = [{ stage: 'identity', query: 'Villa Residence developer' }];
  assert.match(searchLogBrief(log), /\[identity\] Villa Residence developer/);
  assert.equal(searchLogBrief([]), '');
  const r = v2ResearchRequest('PUBLIC_RESEARCH', BASE, BASE, {}, 'gpt-5.6-terra', true, { searchLog: log });
  assert.match(r.input, /SEARCHES ALREADY MADE/);
  const off = v2ResearchRequest('PUBLIC_RESEARCH', BASE, BASE, {}, 'gpt-5.6-terra', true, { searchLog: log, searchesOff: true });
  assert.doesNotMatch(off.input, /SEARCHES ALREADY MADE/);
  assert.equal(off.extra.noTools, true);
  assert.equal(off.extra.tools, undefined);
});

test('the budget: spend is estimated from recorded usage; past the ceiling a stage runs with no paid search', () => {
  const r = v2({ budget: { ceilingUsd: 0.05 } }, {
    _cost: { identity: { input_tokens: 40000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 5000 } },
    _models: { identity: 'gpt-5.6-luna' }, _searches: { identity: 2 },
  });
  // luna: 40k x $0.2/M + 5k x $1.2/M + 2 x $0.01 = 0.008 + 0.006 + 0.02
  assert.equal(researchSpentUsd(r), 0.034);
  assert.equal(budgetDecision(r).searchesOff, false);
  r._searches.identity = 4;
  assert.deepEqual(budgetDecision(r), { searchesOff: true, spentUsd: 0.054, reason: 'CEILING_0.05_REACHED' });
  const { _engine: _e, ...usage } = r;
  assert.equal(budgetDecision(v2({}, usage)).searchesOff, false, 'no ceiling set: never off');
});

test('escalation: only an unusable cheap answer, once per stage, only when enabled', () => {
  const on = v2({ escalation: { enabled: true } });
  assert.equal(stageOutputUsable('IDENTITY', { entity: {} }), true);
  assert.equal(stageOutputUsable('IDENTITY', {}), false);
  assert.equal(stageOutputUsable('MARKET', { market: {} }), true);
  assert.equal(escalationModelFor(on, 'IDENTITY', 'gpt-5.6-luna-2026-09-01', false), 'gpt-5.6-terra');
  assert.equal(escalationModelFor(on, 'IDENTITY', 'gpt-5.6-luna', true), null, 'usable: kept');
  assert.equal(escalationModelFor(on, 'IDENTITY', 'gpt-5.6-terra-2026-09-01', false), null, 'already strong');
  assert.equal(escalationModelFor({ ...on, _escalations: [{ stage: 'identity' }] }, 'IDENTITY', 'gpt-5.6-luna', false), null, 'once');
  assert.equal(escalationModelFor(v2({}), 'IDENTITY', 'gpt-5.6-luna', false), null, 'off unless enabled');
  assert.equal(canonicalModel('gpt-5.6-luna-2026-09-01'), 'gpt-5.6-luna');
  assert.equal(canonicalModel('gpt-5.6-terra'), 'gpt-5.6-terra');
});

test('the report: AUTO is Luna for every property, complex ones included; Terra is only the fallback', () => {
  const complex = v2({ report: { policy: 'AUTO' } }, {
    materialAdverseFindings: [{}, {}], conflicts: [{ severity: 'MATERIAL' }], rightsAndRestrictions: { status: 'RESTRICTION_IDENTIFIED' },
    legalStatus: { a: { status: 'CONFIRMED_ATTENTION' } },
  });
  assert.deepEqual(reportRoutingFor(complex, 'gpt-5.6-luna'), { model: 'gpt-5.6-luna', policy: 'AUTO', fallbackModel: 'gpt-5.6-terra' });
  assert.deepEqual(reportRoutingFor(v2({ report: { policy: 'LUNA' } }), 'gpt-5.6-luna'), { model: 'gpt-5.6-luna', policy: 'LUNA', fallbackModel: null });
  assert.deepEqual(reportRoutingFor(v2({ report: { policy: 'TERRA' } }), 'gpt-5.6-luna'), { model: 'gpt-5.6-terra', policy: 'TERRA', fallbackModel: null });
  assert.deepEqual(reportRoutingFor({ _engine: { version: 'V1' } }, 'gpt-5.6-luna'), { model: 'gpt-5.6-luna', policy: 'DEFAULT', fallbackModel: null });
});

test('the fallback fires only on an objective gate failure — never on style, never on an empty call', () => {
  assert.deepEqual(reportQualityFailures({ mode: 'MODEL', rejectedBecause: [] }, true), []);
  assert.deepEqual(reportQualityFailures({ mode: 'MODEL', rejectedBecause: ['contradicted by evidence: the plot is 5,000 m²'] }, true), ['contradicted by evidence: the plot is 5,000 m²']);
  assert.deepEqual(reportQualityFailures({ mode: 'DETERMINISTIC', rejectedBecause: ['ungrounded citation E99 in sections', 'provenance phrase "according to" repeated 4 times'] }, true), ['ungrounded citation E99 in sections']);
  assert.deepEqual(reportQualityFailures({ mode: 'DETERMINISTIC', rejectedBecause: ['provenance phrase "according to" repeated 4 times'] }, true), [], 'style alone never pays for a second report');
  assert.deepEqual(reportQualityFailures({ mode: 'DETERMINISTIC', rejectedBecause: ['no summary statement'] }, false), [], 'no answer at all is a transport failure, not a quality one');
});

test('verify-synthesis: Luna first, the gate, ONE fallback call, the better report kept, both calls costed', () => {
  const vs = readFileSync(fileURLToPath(new URL('../../../../supabase/functions/verify-synthesis/index.ts', import.meta.url)), 'utf8');
  assert.match(vs, /const first = await callReport\(reportModel\);/);
  assert.match(vs, /const failures = reportQualityFailures\(final, !!raw\);\n\s+if \(callReport && reportRouting\.fallbackModel && failures\.length\) \{/);
  assert.match(vs, /const keepSecond = !!second\.raw && failures2\.length < failures\.length;/);
  assert.match(vs, /\.\.\.\(usageFirstAttempt \? \{ _usageFirstAttempt: usageFirstAttempt \} : \{\}\),/);
  // Internal, never sent to the customer.
  assert.match(vs, /_usageFirstAttempt: _droppedFirst, _reportRouting: _droppedRouting/);
  const mig = readFileSync(fileURLToPath(new URL('../../../../supabase/migrations/20261128090000_verify_report_first_attempt_cogs.sql', import.meta.url)), 'utf8');
  assert.match(mig, /'report_first_attempt'::text/);
  assert.match(mig, /where jsonb_typeof\(j\.synthesis_json->'_usageFirstAttempt'\) = 'object'/);
  // The existing branches are kept verbatim.
  const prev = readFileSync(fileURLToPath(new URL('../../../../supabase/migrations/20261120090100_verify_cogs_attribution.sql', import.meta.url)), 'utf8');
  const body = (sql) => sql.slice(sql.indexOf('create or replace view public.verify_stage_cogs as'), sql.indexOf("  where jsonb_typeof(j.synthesis_json->'_usage') = 'object'"));
  assert.equal(body(mig), body(prev));
});

test('research-agent and verify-synthesis wire every control for V2 jobs only', () => {
  const ra = readFileSync(fileURLToPath(new URL('../../../../supabase/functions/research-agent/index.ts', import.meta.url)), 'utf8');
  assert.match(ra, /const d = marketCodeDecision\(j\.result_json, eligible, MIN_ELIGIBLE_FOR_RANGE\);[\s\S]{0,400}if \(d\.code\) return await finish\(sb, j, 'MARKET', null, l, true\);/);
  assert.match(ra, /if \(engineOf\(j\.result_json\) === 'V2'\) \{\n\s+const eligible = /);
  assert.match(ra, /const budget = v2on && tools \? budgetDecision\(p0\) : null;/);
  assert.match(ra, /searchLog: p0\._searchLog/);
  assert.match(ra, /if \(engineOf\(prior\) === 'V2'\) \{\n\s+const queries = searchQueriesOf\(p\)/);
  assert.match(ra, /const esc = escalationModelFor\(j\.result_json, a\[1\], String\(p\?\.model \?\? ''\), usable\);/);
  assert.match(ra, /return await launch\(sb, k, m, \{ \.\.\.j, result_json: prior \}, a\[1\] as Stage, l, \{ modelOverride: esc, persist: true \}\);/);
  assert.match(ra, /if \(noTools\) delete b\.tools;/);
  const vs = readFileSync(fileURLToPath(new URL('../../../../supabase/functions/verify-synthesis/index.ts', import.meta.url)), 'utf8');
  assert.match(vs, /const reportRouting = reportRoutingFor\(rj, MODEL\);\n[\s\S]{0,120}let reportModel = reportRouting\.model;/);
  assert.match(vs, /_reportRouting: \{ \.\.\.reportRouting, model: reportModel, escalation \},/);
});

test('the Admin card stores exactly what the server reads back, audited with a reason, beside the engine card', () => {
  const card = readFileSync(fileURLToPath(new URL('../../../components/admin/VerifyV2ResearchCard.tsx', import.meta.url)), 'utf8');
  assert.match(card, /const value = parseResearchTuning\(tuning\);\n\s+await updateAdminSetting\(VERIFY_V2_RESEARCH_SETTING_KEY, value, reason\.trim\(\)\);/);
  assert.match(card, /disabled=\{saving \|\| reason\.trim\(\)\.length < 3\}/);
  const page = readFileSync(fileURLToPath(new URL('../../../pages/admin/AdminProvidersPage.tsx', import.meta.url)), 'utf8');
  assert.match(page, /<VerifyEngineCard \/>\n\s+<VerifyV2ResearchCard \/>/);
});
