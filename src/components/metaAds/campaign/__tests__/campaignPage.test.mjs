// The campaign drill-down, by source: write-through success only after the
// awaited call, APPLY gated on actionable + evidence, every mm_ key it (and
// the server) can name has six real translations with matching {{holes}},
// and no "refund" wording reaches a customer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { META_MASTER_CAMPAIGN_STRINGS as S } from '../../../../../scripts/meta-master-campaign-i18n-data.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../../..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const DIR = 'src/components/metaAds/campaign';
const PAGE = 'src/pages/outreach/MetaAdsCampaignPage.tsx';
const SOURCES = [PAGE, ...readdirSync(join(root, DIR)).filter((f) => f.endsWith('.tsx')).map((f) => `${DIR}/${f}`)];
const src = Object.fromEntries(SOURCES.map((f) => [f, read(f)]));
const holes = (s) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort().join(',');

/** The body of `async function name(...) { ... }` (brace-matched). */
function fnBody(text, name) {
  const start = text.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} exists`);
  let i = text.indexOf('{', text.indexOf(')', start));
  const open = i;
  let depth = 0;
  for (; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') { depth -= 1; if (depth === 0) break; }
  }
  return text.slice(open, i + 1);
}

test('pause / resume / end report success only after the awaited write-through call', () => {
  const run = fnBody(src[`${DIR}/ControlsBar.tsx`], 'run');
  const ok = run.indexOf('setStatus({ ok: true');
  assert.ok(ok > 0, 'a success status exists');
  assert.equal(run.indexOf('setStatus({ ok: true'), run.lastIndexOf('setStatus({ ok: true'), 'exactly one success path');
  for (const call of ['await pauseCampaignConfirmed(', 'await resumeCampaignConfirmed(', 'await endCampaign(']) {
    const at = run.indexOf(call);
    assert.ok(at > 0, `${call} is awaited`);
    assert.ok(at < ok, `success is set after ${call}`);
  }
  // Success lives inside try, after the awaits; the catch never reports success.
  const catchAt = run.indexOf('catch');
  assert.ok(ok < catchAt, 'success is inside the try block');
  assert.doesNotMatch(run.slice(catchAt), /ok: true/);
  // The pending state speaks while the promise is in flight.
  assert.match(src[`${DIR}/ControlsBar.tsx`], /aria-live="polite"[\s\S]{0,300}mm_c_waiting_meta/);
});

test('budget / duration commits and recommendation acts also succeed only after the await', () => {
  const commit = fnBody(src[`${DIR}/PlanChangeDialog.tsx`], 'commit');
  const done = commit.indexOf('setDone(t(');
  assert.ok(done > commit.indexOf('await commitBudget(') && done > commit.indexOf('await commitDuration('));
  assert.ok(commit.indexOf('await commitBudget(') > 0 && commit.indexOf('await commitDuration(') > 0);
  assert.match(commit, /preview\.shortfallCents > 0/, 'a shortfall never commits');
  assert.match(src[`${DIR}/PlanChangeDialog.tsx`], /crypto\.randomUUID\(\)/, 'commits carry an idempotency key');
  const act = fnBody(src[`${DIR}/OptimizationSection.tsx`], 'act');
  assert.ok(act.indexOf('ok: true') > act.indexOf('await actOnRecommendation('));
  assert.match(act, /actOnRecommendation\(r\.id, kind, crypto\.randomUUID\(\)/);
});

test('APPLY is gated by actionable AND meaningful evidence — recommend only by default', () => {
  const opt = src[`${DIR}/OptimizationSection.tsx`];
  const gate = fnBody(opt, 'canApply');
  assert.match(gate, /r\.actionable === true/);
  assert.match(gate, /r\.confidence === 'MEANINGFUL_SIGNAL' \|\| r\.confidence === 'HIGH_CONFIDENCE'/);
  assert.doesNotMatch(gate, /EARLY_SIGNAL|INSUFFICIENT_DATA/);
  assert.match(fnBody(opt, 'act'), /if \(kind === 'APPLY' && !canApply\(r\)\) return;/);
  // The APPLY button only renders behind the gate.
  assert.match(opt, /const applicable = canApply\(r\);/);
  assert.match(opt, /\{applicable && \(confirming === r\.id/);
  const applyCalls = [...opt.matchAll(/act\(r, 'APPLY'\)/g)].length;
  assert.equal(applyCalls, 1, 'one APPLY call site, inside the gated confirm');
  // Nothing auto-applies: no act() in an effect.
  assert.doesNotMatch(opt, /useEffect/);
});

test('every mm_ key the drill-down references exists with six translations and matching placeholders', () => {
  const literal = new Set();
  const prefixes = new Set();
  for (const body of Object.values(src)) {
    for (const m of body.matchAll(/['"`](mm_[a-z0-9_A-Z]+)['"`]/g)) literal.add(m[1]);
    for (const m of body.matchAll(/`(mm_[a-zA-Z0-9_]*)\$\{/g)) prefixes.add(m[1]);
  }
  assert.ok(literal.size > 100, `the scan sees the call sites (${literal.size})`);
  for (const k of literal) assert.ok(S[k], `missing key ${k}`);
  for (const p of prefixes) assert.ok(Object.keys(S).some((k) => k.startsWith(p)), `no key for family ${p}*`);
  for (const [k, v] of Object.entries(S)) {
    assert.ok(Array.isArray(v) && v.length === 6, `${k} has six locales`);
    v.forEach((s, i) => assert.ok(typeof s === 'string' && s.trim(), `${k}[${i}] is non-empty`));
    v.forEach((s, i) => assert.equal(holes(s), holes(v[0]), `${k}[${i}] placeholders match English`));
    v.forEach((s, i) => assert.doesNotMatch(s.replace(/\{\{\w+\}\}/g, ''), /\{\w+\}/, `${k}[${i}] has no single-brace hole`));
  }
});

test('every server customer key and analysis code has copy', () => {
  // Timeline keys, straight from the edge function.
  const fnDir = 'supabase/functions/meta-ads-api';
  const server = readdirSync(join(root, fnDir)).filter((f) => f.endsWith('.ts')).map((f) => read(`${fnDir}/${f}`)).join('\n');
  const tl = new Set([...server.matchAll(/'(tl_[a-z_]+)'/g)].map((m) => m[1]));
  assert.ok(tl.size >= 18, `timeline keys found (${tl.size})`);
  for (const k of tl) assert.ok(S[`mm_${k}`], `timeline copy mm_${k}`);
  assert.equal(holes(S.mm_tl_guard_warning_n[0]), 'n,of');
  assert.equal(holes(S.mm_tl_budget_changed[0]), 'from,to');
  assert.equal(holes(S.mm_tl_duration_changed[0]), 'from,to');
  assert.equal(holes(S.mm_tl_recommendation_applied[0]), 'type');
  // Guard incident keys, from decide().
  const guard = read('src/lib/metaAds/guard.ts');
  const gk = new Set([...guard.matchAll(/customerKey: (?:[^']*')?(guard_[a-z_]+)'/g)].map((m) => m[1]));
  for (const m of guard.matchAll(/'(guard_[a-z_]+)'/g)) gk.add(m[1]);
  assert.ok(gk.size >= 6, `guard keys found (${gk.size})`);
  for (const k of gk) assert.ok(S[`mm_${k}`], `guard copy mm_${k}`);
  // Analysis: facts, recommendation types, reasons, health, evidence, classes.
  const analysis = read('src/lib/metaAds/analysis.ts');
  const types = analysis.match(/export type RecommendationType =([\s\S]*?);/)[1].match(/'([A-Z_]+)'/g).map((x) => x.slice(1, -1));
  assert.equal(types.length, 11);
  for (const ty of types) {
    assert.ok(S[`mm_rec_${ty}`], `mm_rec_${ty}`);
    assert.ok(S[`mm_fact_RECOMMEND_${ty}`], `mm_fact_RECOMMEND_${ty}`);
    assert.equal(holes(S[`mm_fact_RECOMMEND_${ty}`][0]), 'affected');
  }
  for (const m of analysis.matchAll(/facts\.push\(\{ code: '([A-Z_]+)', params: \{([^}]*)\}/g)) {
    assert.ok(S[`mm_fact_${m[1]}`], `mm_fact_${m[1]}`);
    const names = [...m[2].matchAll(/(\w+):/g)].map((x) => x[1]).filter((n) => n !== 'currency').sort().join(',');
    assert.equal(holes(S[`mm_fact_${m[1]}`][0]), names, `mm_fact_${m[1]} uses the fact's params`);
  }
  assert.ok(S.mm_fact_STATUS && S.mm_fact_NO_DATA_YET);
  const reasons = new Set([...analysis.matchAll(/reasonCodes: \[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1])));
  for (const m of analysis.matchAll(/signals\.push\('([A-Z_]+)'\)/g)) reasons.add(m[1]);
  // Evidence names appear inside the ternaries that pick a reason; they are not reasons.
  for (const ev of ['INSUFFICIENT_DATA', 'EARLY_SIGNAL', 'MEANINGFUL_SIGNAL', 'HIGH_CONFIDENCE']) reasons.delete(ev);
  assert.ok(reasons.size >= 11, `reason codes found (${reasons.size})`);
  for (const r of reasons) assert.ok(S[`mm_recr_${r}`], `mm_recr_${r}`);
  assert.ok(S.mm_recr_STRONGEST, 'STRONGEST:<ad> has its own copy');
  for (const dim of analysis.match(/export type HealthDimension =([^;]*);/)[1].match(/'([A-Z_]+)'/g)) assert.ok(S[`mm_hdim_${dim.slice(1, -1)}`]);
  for (const st of analysis.match(/export type HealthState =([^;]*);/)[1].match(/'([A-Z_]+)'/g)) assert.ok(S[`mm_hstate_${st.slice(1, -1)}`]);
  for (const ev of analysis.match(/export type Evidence =([^;]*);/)[1].match(/'([A-Z_]+)'/g)) assert.ok(S[`mm_ev_${ev.slice(1, -1)}`]);
  for (const cl of analysis.match(/export type CreativeClass =([^;]*);/)[1].match(/'([A-Z_]+)'/g)) assert.ok(S[`mm_ccls_${cl.slice(1, -1)}`]);
});

test('no refund wording, and unused fee is released to the HOMATCH Balance', () => {
  for (const [k, v] of Object.entries(S)) assert.doesNotMatch(v.join(' '), /refund/i, `${k} says refund`);
  for (const [f, body] of Object.entries(src)) assert.doesNotMatch(body, /Refund/, `${f} mentions Refund`);
  assert.match(S.mm_c_billing_disclosure[0], /released to your HOMATCH Balance/);
  assert.match(S.mm_c_pv_release[0], /released to your HOMATCH Balance/);
  // Georgian terminology.
  assert.match(S.mm_c_tab_leads[1], /ლიდ/);
  assert.doesNotMatch(Object.values(S).map((v) => v[1]).join(' '), /შესატყვისი/);
  assert.doesNotMatch(Object.values(S).map((v) => v[0]).join(' '), /confirmed buyer/i);
});

test('deep links the notifications use open the right section', () => {
  const page = src[PAGE];
  for (const tab of ['performance', 'placements', 'audience', 'creatives', 'leads', 'optimization', 'integrity']) {
    assert.match(page, new RegExp(`'${tab}'`), `tab ${tab}`);
    assert.ok(S[`mm_c_tab_${tab}`], `label for ${tab}`);
  }
  assert.match(page, /params\.get\('tab'\)/);
  assert.match(src[`${DIR}/LeadsFunnelSection.tsx`], /\/outreach\/meta\?tab=leads&campaign=\$\{encodeURIComponent\(campaignId\)\}/);
});
