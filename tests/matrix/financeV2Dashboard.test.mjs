// Admin → Finance → Services (Finance V2). The dashboard reads one server ledger per service
// and formats it; it never re-implements a pricing formula, never shows an unknown as $0, and
// the money chain it draws is the one the owner set: payment → VAT → net → allocation → COGS → profit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const TAB = read('src/components/admin/finance/FinanceServicesTab.tsx');
const PAGE = read('src/pages/admin/AdminFinancePage.tsx');
const SVC = read('src/services/finance.ts');
const PANEL = read('src/components/admin/DeepSearchEconomicsPanel.tsx');
const SQL = read('supabase/migrations/20261119140000_finance_v2_engine.sql');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('the Services tab is mounted in Admin → Finance and calls only the finance_v2 RPCs', () => {
  assert.match(PAGE, /<TabsTrigger value="services"[^>]*>\{t\('fin_tab_services'\)\}<\/TabsTrigger>/);
  assert.match(PAGE, /<TabsContent value="services"[^>]*>\s*<FinanceServicesTab \/>/);
  for (const fn of ['finance_v2_services', 'finance_v2_service_detail', 'finance_v2_execution', 'finance_v2_quote']) {
    assert.match(SVC, new RegExp(`rpc<[^>]+>\\('${fn}'`), `${fn} wrapper`);
    assert.match(SQL, new RegExp(`create or replace function public\\.${fn}\\(`), `${fn} exists`);
    assert.match(SQL, new RegExp(`function public\\.${fn}\\([\\s\\S]{0,400}?perform public\\.finance_require_admin\\(\\)`), `${fn} is admin-gated`);
  }
  assert.doesNotMatch(TAB, /supabase\.(rpc|from)\(/, 'no direct table or RPC access from the component');
});

test('no money formula in the frontend: no policy constants, no research-core, no arithmetic on amounts', () => {
  for (const src of [TAB, PANEL]) {
    const c = code(src);
    assert.doesNotMatch(c, /research-core|paidDiscoveryPolicy/, 'policy math lives in the server/edge, not the Admin UI');
    assert.doesNotMatch(c, /0\.63|0\.37|1\.18|6300|11800|3700|1800/, 'no split or VAT constants');
  }
  // Every Usd figure is passed straight to <Money>; the only arithmetic is the trend's bar scale.
  const outsideTrend = code(TAB).replace(/function Trend\([\s\S]*?\n}\n/, '');
  assert.doesNotMatch(outsideTrend, /Usd\)?\s*[-+*/]\s*[\w(]|[-+*/]\s*(Number\()?\w+\.\w+Usd\b/, 'no money arithmetic outside the trend scale');
  assert.match(TAB, /getFinanceV2Quote\(policy, Number\(gross\), Number\(cost\)\)/, 'the simulator asks the server');
  assert.match(PANEL, /getFinanceV2Quote\('paid_discovery_37_63_vat_v2'/);
});

test('unknown is never zero: null allocations, unpriced costs and failed loads say so', () => {
  assert.match(TAB, /homatch === null && execution === null \? \([\s\S]{0,200}fin_v2_no_split/);
  assert.match(TAB, /unavailable=\{s\.homatchAllocationUsd === null\}/);
  assert.match(TAB, /unavailable=\{s\.avgCostPerExecutionUsd === null\}/);
  assert.match(TAB, /<Money value=\{l\.cost_usd\} frac=\{6\} \/>/, 'an UNPRICED (null) line renders through Money → Unknown');
  assert.match(TAB, /fin_v2_profit_incomplete/, 'profit with unpriced lines is flagged incomplete');
  assert.match(TAB, /<LoadError message=\{error\}/);
  assert.match(SQL, /'cost_usd is NULL \(never 0\)|cost_usd NULL = UNPRICED, never 0/);
});

test('the chain is drawn in the owner order and shared costs stay out of service profit', () => {
  const order = ['fin_v2_chain_payment', 'fin_v2_chain_vat', 'fin_v2_chain_net', 'fin_v2_homatch_alloc', 'fin_v2_chain_cogs', 'fin_v2_chain_profit', 'fin_v2_unused_exec'];
  const at = order.map((k) => TAB.indexOf(`t('${k}')`));
  assert.ok(at.every((i, n) => i > 0 && (n === 0 || i > at[n - 1])), `chain order ${at.join(',')}`);
  assert.match(TAB, /filter\(\(s\) => s\.pricingKind !== 'SHARED'\)/);
  assert.match(TAB, /filter\(\(s\) => s\.pricingKind === 'SHARED'\)/);
  assert.match(SQL, /'shared_platform', [^\n]*'SHARED'/);
});

test('every fin_v2 key the tab uses exists in all six bundles', () => {
  const I18N = read('src/i18n/translations.ts');
  const keys = [...new Set([...TAB.matchAll(/t\('((?:fin_v2|fin_tab)_[a-z_]+)'/g)].map((m) => m[1]))];
  assert.ok(keys.length > 40);
  for (const key of keys) {
    const hits = I18N.match(new RegExp(`^\\s{2}${key}:`, 'gm')) ?? [];
    assert.equal(hits.length, 6, `${key} in ${hits.length}/6 bundles`);
  }
});

test('V2.1: profit is never shown as final while costs are incomplete', () => {
  assert.match(TAB, /function CoverageNotice\(\{ s \}[\s\S]{0,120}if \(s\.costComplete\) return null;/);
  assert.match(TAB, /<CoverageNotice s=\{s\} \/>/);
  assert.match(TAB, /!s\.costComplete && <> · <span className="text-amber-400">\{t\('fin_v21_not_final'\)\}/);
  assert.match(TAB, /!s\.costComplete && <Pill tone="warn">\{t\('fin_v21_cost_incomplete_short'\)\}/);
  const SQL21 = read('supabase/migrations/20261123090000_finance_v2_1_cost_coverage.sql');
  assert.match(SQL21, /'costComplete', coalesce\(cost\.unpriced_lines, 0\) = 0 and coalesce\(cost\.partial_lines, 0\) = 0/);
});

test('V2.1: shared infrastructure stays apart and an unconfigured cost is never $0', () => {
  assert.match(TAB, /l\.status === 'NOT_CONFIGURED'\s*\? <Pill tone="warn">\{t\('fin_not_configured'\)\}/);
  assert.doesNotMatch(code(TAB).slice(code(TAB).indexOf('function SharedCostsPanel')), /periodUsd\s*[-+*/]/, 'no client-side allocation or sum');
  for (const fn of ['finance_v2_shared_costs', 'finance_v2_price_drift']) assert.match(SVC, new RegExp(`rpc<[^>]+>\\('${fn}'`));
});

test('V2.1: every fin_v21 key the tab uses exists in all six bundles', () => {
  const I18N = read('src/i18n/translations.ts');
  const keys = [...new Set([...TAB.matchAll(/t\('(fin_v21_[a-z_]+)'/g)].map((m) => m[1]))];
  assert.ok(keys.length >= 12, `keys ${keys.length}`);
  for (const key of keys) assert.equal((I18N.match(new RegExp(`^\\s{2}${key}:`, 'gm')) ?? []).length, 6, key);
});
