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

test('balance card copy: $100 → $9 at 9%, 0% needs no top-up, Non-refundable, no broken interpolation, mobile-safe dialog', async () => {
  const bal = code(`${DIR}/ServiceBalanceCard.tsx`);
  // The example fee is computed from the server percent on a $100 budget, never a literal.
  assert.match(bal, /const fee = \(100 \* pct \/ 100\)/);
  assert.doesNotMatch(bal, /exampleFee|\$\\\$\{|\?\?\s*9\b/, 'no hand-escaped template or 9% fallback in the card');
  const fill = (s, vars) => s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(vars[k]));
  for (const key of ['mm_w_bal_std_card', 'mm_w_bal_std_dialog']) {
    for (const [i, s] of W[key].entries()) {
      const out = fill(s, { pct: 9, fee: 9 });
      assert.match(out, /\$100/, `${key}[${i}] names the $100 budget`);
      assert.match(out, /\$9(?!\d)/, `${key}[${i}] renders the $9 fee`);
      assert.doesNotMatch(out, /exampleFee|\$\{|\{\{|\}\}|undefined|NaN/, `${key}[${i}] has no broken interpolation`);
    }
  }
  const ka = (k) => W[k][1];
  assert.equal(ka('mm_w_bal_std_fee'), 'HOMATCH-ის მომსახურების საკომისიო: {{pct}}%');
  for (const k of ['mm_w_bal_disclosure', 'mm_w_bal_std_dialog']) assert.match(ka(k), /Non-refundable/, `${k} ka says Non-refundable`);
  for (const [k, v] of Object.entries(W)) {
    for (const s of v) assert.doesNotMatch(s, /ნაღდ ფულად ვერ გაიტანთ/, `${k}: wording the owner rejected`);
  }
  // The balance is the fee only: Meta bills the ad budget to the connected ad account.
  assert.match(W.mm_w_bal_std_dialog[0], /Meta charges the \$100 ad budget directly to your connected ad account/);
  assert.match(ka('mm_w_bal_std_dialog'), /სხვა ან მომავალი კამპანიების/);
  // 0%: no top-up and no fee example.
  assert.match(W.mm_w_bal_zero_dialog[0], /0%, so no HOMATCH service-balance top-up is required/);
  const { launchCharge } = await import('../../../../lib/metaAds/payload.ts');
  assert.deepEqual(launchCharge({ mediaCents: 10000, feeCents: 0 }, 'CUSTOMER_AD_ACCOUNT'), { reserveCents: 0, feeCents: 0, requiredCents: 0 });
  // Mobile: the dialog fits the viewport, its body scrolls, the actions stay on screen.
  assert.match(bal, /<DialogContent className="[^"]*max-h-\[calc\(100dvh-2rem\)\][^"]*flex-col[^"]*overflow-hidden/);
  assert.match(bal, /className="min-h-0 flex-1 overflow-y-auto overscroll-contain/);
  assert.match(bal, /<DialogFooter className="shrink-0/);
});
