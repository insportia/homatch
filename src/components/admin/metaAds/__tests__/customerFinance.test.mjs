// Admin financial control, by source: money only moves through the canonical
// audited ledger function, the fee has one server-side home, and customers
// can never set their own terms.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../../../../${p}`, import.meta.url), 'utf8');
const panel = read('src/components/admin/metaAds/CustomerFinancePanel.tsx');
const page = read('src/pages/admin/AdminMetaAdsPage.tsx');
const sql = read('supabase/migrations/20261002110000_meta_ads_finance_control.sql');
const actions = read('supabase/functions/meta-ads-api/actions.ts');
const index = read('supabase/functions/meta-ads-api/index.ts');
const engine = read('supabase/functions/meta-ads-api/engine.ts');

test('the panel moves money only through the audited ledger adjustment', () => {
  assert.match(panel, /adminAdjustBalance\(/);
  assert.doesNotMatch(panel, /from\('meta_ads_ledger'\)|\.update\(|\.insert\(/, 'no direct table writes');
  assert.doesNotMatch(page, /Amount in cents|action: 'admin_adjust'/, 'the prompt-based adjustment is gone');
  assert.match(index, /userClient\.rpc\('admin_meta_adjust_balance'/, 'adjustments run under the admin\'s own session');
});

test('the adjustment records direction, reason, actor, balance before/after and refuses overdraft', () => {
  const fn = sql.slice(sql.indexOf('function public.admin_meta_adjust_balance'), sql.indexOf('-- ── 4.'));
  for (const col of ['direction', 'reason', 'admin_user_id', 'balance_before_cents', 'balance_after_cents', 'campaign_id']) {
    assert.match(fn, new RegExp(col), `records ${col}`);
  }
  assert.match(fn, /INSUFFICIENT_FUNDS/);
  assert.match(fn, /admin_audit_log/);
  assert.match(fn, /is_admin\(\)/);
  assert.match(sql, /entry_type not in \('RESERVE', 'HOMATCH_FEE', 'ADJUSTMENT', 'WITHDRAWAL'\)/, 'the ledger guard covers adjustment debits');
});

test('one server-side fee: the database function, used by the edge; admin-only policy writes', () => {
  assert.match(engine, /rpc\('meta_effective_fee_percent'/);
  assert.match(actions, /userClient\.rpc\('admin_set_meta_fee_policy'/);
  const set = sql.slice(sql.indexOf('function public.admin_set_meta_fee_policy'), sql.indexOf('-- ── 3.'));
  assert.match(set, /if not public\.is_admin\(\)/);
  assert.match(set, /meta_fee_policy_audit/);
  assert.match(set, /admin_audit_log/);
  assert.match(sql, /revoke insert, update, delete, truncate on public\.meta_fee_policies/);
  assert.match(sql, /revoke insert, update, delete, truncate on public\.meta_ads_ledger from authenticated/);
  assert.doesNotMatch(sql, /tatochachua|@gmail\.com/i, 'no account is hardcoded');
});

test('costs stay visible whatever the policy; release wording, never refund', () => {
  assert.match(sql, /'ai_costs_usd'/);
  assert.match(sql, /'meta_media_spend_cents'/);
  assert.match(panel, /mads_ledger_released_to_balance/);
  assert.doesNotMatch(panel, /Refund/);
});

test('no Meta Ads frontend code carries its own fee percent', async () => {
  const { readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = new URL('../../../../../', import.meta.url).pathname;
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== '__tests__') walk(p); } else if (/\.tsx?$/.test(f)) files.push(p); } };
  for (const d of ['src/components/metaAds', 'src/components/admin/metaAds']) walk(join(root, d));
  files.push(join(root, 'src/pages/outreach/MetaAdsPage.tsx'), join(root, 'src/pages/outreach/MetaAdsCreatePage.tsx'), join(root, 'src/pages/outreach/MetaAdsCampaignPage.tsx'));
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /(fee|pct|percent)\w*\s*(\?\?|\|\|)\s*9\b/i, `${f} falls back to a literal 9%`);
    assert.doesNotMatch(src, /\b0\.09\b/, `${f} uses a literal 9%`);
  }
});
