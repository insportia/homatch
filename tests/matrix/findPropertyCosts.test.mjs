// Find Property operating cost (owner, 2026-10-19): admin-only, in the existing ledger, never a
// silent $0, and nothing a customer sees or pays changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const SQL = read('supabase/migrations/20261119130000_find_property_costs.sql');
const PAGE = read('src/pages/admin/AdminFindPropertyCostsPage.tsx');

test('pricing: gpt-4o-mini in the price book at the published rates; Find Property operations are FIND_PROPERTY, not VERIFY', () => {
  assert.match(SQL, /\('INPUT_TOKEN', 0\.15::numeric\), \('CACHED_INPUT_TOKEN', 0\.075::numeric\), \('OUTPUT_TOKEN', 0\.60::numeric\)/);
  assert.match(SQL, /select 'MARKETPLACE_%', 'FIND_PROPERTY', 15/);
  assert.match(read('supabase/functions/_shared/providerCost.ts'), /if \(error \|\| data === null \|\| data === undefined \|\| data === ''\) return null;/);
});

test('correlation: results AI carries the search id; the brief call carries brief:<uuid> handed back at start', () => {
  const ms = read('supabase/functions/_shared/marketplaceSearch.ts');
  assert.match(ms, /correlation_id: correlationId, model: r\.model, input_tokens: r\.inputTokens, output_tokens: r\.outputTokens/);
  assert.match(ms, /recordAiUsage\(db, 'RESULTS_INTELLIGENCE', r, searchId\)/);
  const edge = read('supabase/functions/marketplace-search/index.ts');
  assert.match(edge, /await recordAiUsage\(db, 'SEARCH_INTELLIGENCE', r, `brief:\$\{costRef\}`\)/);
  assert.match(edge, /brief_cost_refs: briefRefs/);
  for (const path of ['if (prior) { await linkBriefCosts(prior);', 'if (twin) { await linkBriefCosts(twin);', 'if (recent) { await linkBriefCosts(recent);']) assert.ok(edge.includes(path), path);
  assert.match(read('src/components/findProperty/MarketplaceSearchExperience.tsx'), /startSearch\(brief, idempotency\.current, briefRefs\.current\)/);
});

test('no double counting: a brief ref belongs to the first search that names it; each event appears once', () => {
  assert.match(SQL, /select distinct on \(ref\) ref, s\.id as search_id[\s\S]{0,160}order by ref, s\.created_at/);
});

test('history is corrected only where the record is reliable; a total-only record is a range, never a figure', () => {
  assert.match(SQL, /x\.n_for_row = 1 and x\.n_for_call = 1/, 'one-to-one telemetry match only');
  assert.match(SQL, /c\.units = t\.i \+ t\.o/, 'same token total');
  assert.match(SQL, /pricing_state = 'PARTIAL'/);
  assert.match(SQL, /cost_upper_usd/);
});

test('admin only: every read goes through finance_require_admin; nothing is granted to anon', () => {
  assert.equal((SQL.match(/perform public\.finance_require_admin\(\);/g) ?? []).length, 2);
  assert.match(SQL, /revoke all on function public\.finance_find_property_costs\(timestamptz, timestamptz\) from public, anon;/);
  assert.match(SQL, /revoke all on public\.finance_fp_ai_events from anon, authenticated;/);
  assert.match(read('src/routes.tsx'), /path: '\/admin\/finance\/find-property', element: adminWrap\(<AdminFindPropertyCostsPage \/>\), adminOnly: true/);
  /* No customer surface imports the cost service. */
  assert.doesNotMatch(read('src/components/findProperty/MarketplaceSearchExperience.tsx'), /services\/finance/);
});

test('display: unknown is Unknown, partial is a range — never a misleading $0.00', () => {
  assert.match(PAGE, /if \(state === 'UNKNOWN'\) return <span className="text-red-400">\{t\('fin_unknown'\)\}<\/span>;/);
  assert.match(PAGE, /\{usd\(usdValue, 6\)\} – \{usd\(upper, 6\)\}/);
  assert.doesNotMatch(PAGE, /<Money value=/, "every cost on this page keeps 6 decimals (Money frac={6})");
  assert.match(read('src/services/finance.ts'), /const frac = abs > 0 && abs < 0\.01 \? 6 : maxFrac;/, 'micro-costs keep 6 decimals');
  assert.match(SQL, /'status', case when v_share is null or not v_infra_entered then 'UNKNOWN' else 'ESTIMATED' end/);
});

test('free stays free: no wallet, credit, reservation or customer price is touched; Deep Search not mentioned', () => {
  for (const text of [SQL, PAGE]) assert.doesNotMatch(text, /credit_ledger|wallet|reserve_|charge_credits|find_property_deep|find_property_social_enabled/i);
});
