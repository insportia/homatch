// The Meta Ads workspace, checked by reading its sources: money stays per
// currency, the service-balance disclosure is always rendered, the whole lead
// pipeline is selectable, and every workspace copy key exists in six
// languages with matching placeholders and no "Refund" wording.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { META_MASTER_WORKSPACE_STRINGS as W } from '../../../../../scripts/meta-master-workspace-i18n-data.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../../../../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** Source without comments, so prose never satisfies or fails an assertion. */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const DIR = 'src/components/metaAds/workspace';
const FILES = [
  'src/pages/outreach/MetaAdsPage.tsx',
  ...fs.readdirSync(path.join(ROOT, DIR)).filter(f => /\.tsx?$/.test(f)).map(f => `${DIR}/${f}`),
];
const translations = read('src/i18n/translations.ts');
const holes = (s) => (s.match(/\{\{\s*\w+\s*\}\}/g) ?? []).map(h => h.replace(/\s/g, '')).sort().join(',');

test('dashboard: money is formatted per currency and never summed across currencies', () => {
  const src = code(`${DIR}/GlobalDashboard.tsx`);
  const calls = [...src.matchAll(/moneyIn\(([^,]+),\s*([^,]+),\s*lang\)/g)];
  assert.ok(calls.length >= 6, 'summary and campaign money go through moneyIn');
  for (const [, , cur] of calls) {
    assert.ok(/^(cur|r\.currency)$/.test(cur.trim()), `moneyIn currency must come from the row/card, got ${cur}`);
  }
  assert.doesNotMatch(src, /\.reduce\(/, 'no client-side totals across rows');
  assert.doesNotMatch(src, /\bmoney\(/, 'no USD-default money() in the dashboard');
  assert.match(src, /data\.summary\.map\(s => <CurrencySummaryCard key=\{s\.currency\}/, 'one card per currency');
  // The service balance card too: one block per currency row, no sum.
  const bal = code(`${DIR}/ServiceBalanceCard.tsx`);
  assert.doesNotMatch(bal, /\.reduce\(/);
  for (const [, , cur] of bal.matchAll(/moneyIn\(([^,]+),\s*([^,]+),\s*lang\)/g)) assert.equal(cur.trim(), 'r.currency');
});

test('balance card: the non-refundable disclosure is rendered', () => {
  const bal = code(`${DIR}/ServiceBalanceCard.tsx`);
  assert.match(bal, /\{t\('mm_w_bal_disclosure'\)\}/);
  assert.equal(W.mm_w_bal_disclosure[0],
    'HOMATCH service balance is non-refundable to cash, but it stays in your HOMATCH balance and can be reused for future campaigns. Unused service fee is Released to HOMATCH Balance.');
  for (const k of ['mm_w_bal_deposited', 'mm_w_bal_available', 'mm_w_bal_reserved', 'mm_w_bal_consumed', 'mm_w_bal_released']) {
    assert.match(bal, new RegExp(`t\\('${k}'\\)`), `${k} rendered`);
  }
  assert.match(bal, /MIN_DEPOSIT_CENTS = 500/);
  assert.match(bal, /depositCheckout\(cents\)/);
});

test('leads: all seven pipeline statuses are selectable', () => {
  const svc = read('src/services/metaAds.ts');
  const m = svc.match(/LEAD_STATUSES = \[([^\]]+)\]/);
  assert.ok(m);
  const statuses = [...m[1].matchAll(/'([A-Z_]+)'/g)].map(x => x[1]);
  assert.deepEqual(statuses, ['NEW', 'CONTACTED', 'QUALIFIED', 'VIEWING', 'NEGOTIATING', 'WON', 'LOST']);
  const sel = code(`${DIR}/LeadStatusSelect.tsx`);
  assert.match(sel, /LEAD_STATUSES\.map\(s => <option key=\{s\} value=\{s\}>\{t\(`mm_w_lead_status_\$\{s\}`\)\}<\/option>\)/);
  for (const s of statuses) assert.ok(W[`mm_w_lead_status_${s}`], `mm_w_lead_status_${s} defined`);
  // The shown status moves only after the update resolved.
  const center = code(`${DIR}/LeadsCenter.tsx`);
  assert.match(center, /await updateMetaLead\(lead\.id, \{ status \}\);\s*setLeads\(/);
  assert.match(center, /params\.get\('campaign'\)/, 'campaign filter reads ?campaign=');
  assert.match(center, /exportLeadsCsv\(/);
});

test('lead contact details stay inside the drawer, never in a URL or title', () => {
  const center = code(`${DIR}/LeadsCenter.tsx`);
  assert.doesNotMatch(center, /phone|email/i, 'the list shows no contact details');
  const drawer = code(`${DIR}/LeadRecordDrawer.tsx`);
  assert.doesNotMatch(drawer, /document\.title|setParams|navigate\(/);
});

test('every mm_w_ / mads_ledger_ key referenced exists in six languages with matching placeholders', () => {
  const referenced = new Set();
  for (const f of FILES) {
    const src = code(f);
    for (const [k] of src.matchAll(/\b(?:mm_w|mads_ledger)_[A-Za-z0-9_]+\b/g)) referenced.add(k);
    if (/mm_w_lead_status_\$\{/.test(src)) ['NEW', 'CONTACTED', 'QUALIFIED', 'VIEWING', 'NEGOTIATING', 'WON', 'LOST'].forEach(s => referenced.add(`mm_w_lead_status_${s}`));
    if (/mm_w_answer_\$\{/.test(src)) ['buy_or_rent', 'budget', 'preferred_location', 'property_type', 'bedrooms', 'timeframe', 'agent_contact'].forEach(a => referenced.add(`mm_w_answer_${a}`));
  }
  // The ledger vocabulary the server hands back as labelKey.
  const billing = read('src/lib/metaAds/billing.ts');
  for (const [, k] of billing.matchAll(/'(mads_ledger_[a-z_]+)'/g)) referenced.add(k);
  referenced.delete('mm_w_lead_status_'); referenced.delete('mm_w_answer_');

  assert.ok(referenced.size > 40);
  for (const key of referenced) {
    const values = W[key];
    if (!values) {
      assert.match(translations, new RegExp(`\\b${key}\\s*:`), `${key} is neither in the data file nor translations.ts`);
      continue;
    }
    assert.equal(values.length, 6, `${key} has six entries`);
    for (const v of values) assert.ok(typeof v === 'string' && v.trim(), `${key} has an empty entry`);
    for (const v of values) assert.equal(holes(v), holes(values[0]), `${key} placeholders differ: ${v}`);
  }
  for (const k of ['mads_ledger_deposit', 'mads_ledger_service_reserved', 'mads_ledger_released_to_balance',
    'mads_ledger_budget_reserved', 'mads_ledger_meta_spend', 'mads_ledger_adjustment']) {
    assert.ok(W[k], `${k} defined`);
  }
  assert.equal(W.mads_ledger_released_to_balance[0], 'Released to HOMATCH Balance');
});

test('customer copy: no "Refund", no "confirmed buyer", Georgian terminology', () => {
  for (const [key, values] of Object.entries(W)) {
    assert.equal(values.length, 6, key);
    for (const v of values) {
      assert.doesNotMatch(v, /Refund/, `${key}: ${v}`);
      assert.doesNotMatch(v, /confirmed buyer/i, `${key}: ${v}`);
    }
    assert.doesNotMatch(values[1], /შესატყვისი/, key);
  }
  for (const f of FILES) assert.doesNotMatch(code(f), /['"`][^'"`]*Refund[^'"`]*['"`]/, `${f} has no Refund literal`);
  assert.match(W.mm_w_kpi_leads[1], /ლიდ/);
});
