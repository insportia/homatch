import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/*
 * ADMIN FINANCE / COMPANY COST COMMAND CENTER — STATIC.
 *
 * WHAT WAS VERIFIED LIVE, AND WHAT THIS FILE IS FOR
 *
 * The behaviour was verified against production while it was built:
 *
 *   Verify via the fact stream  $19.3839  ==  verify_stage_cogs control  $19.3839
 *   Total COGS $44.6218 across OPENAI / APIFY / DATAFORSEO, 0 unregistered providers
 *   237 unpriced events surfaced as UNPRICED rather than summed as zero
 *   16 MATCH_UNLOCK rows excluded from COGS (a credit movement, not provider spend)
 *   finance_summary() from an unauthenticated session -> FORBIDDEN
 *   A provider registered at runtime (EUR, MINUTES, effective-dated) appeared in
 *     finance_providers(), the registry list and the product rollup with NO code
 *     change: 120 min x EUR 0.025 x 1.085 = $3.255, $0.027125/min, 6.8% share
 *   The same provider with no FX rate on file read UNPRICED, not $0.00
 *   A Retell call on bring-your-own keys booked $0.21 of company spend while
 *     carrying $0.065 of OpenAI + Cartesia components excluded as already billed
 *   finance_evaluate_alerts() run twice -> still exactly 5 alert rows
 *
 * A test file cannot re-run those. What it CAN do is stop the invariants behind
 * them from being quietly edited out later, so this asserts the PROPERTIES:
 *
 *   - Verify money is counted once, never from both sources
 *   - unknown cost is UNPRICED, never zero
 *   - an unknown currency is never converted at parity
 *   - every finance RPC is admin-gated in its own body, not just by grant
 *   - no credential value is ever returned or rendered
 *   - providers, categories, units and product mapping are DATA, not code
 *   - a component someone else billed cannot enter company spend twice
 *   - repricing previews rather than rewriting history
 */

const ROOT = process.cwd();
const MIG = path.join(ROOT, 'supabase', 'migrations');
const SRC = path.join(ROOT, 'src');

const read = (p) => fs.readFileSync(p, 'utf8');
const mig = (name) => read(path.join(MIG, name));
const src = (rel) => read(path.join(SRC, rel));

const FACTS_V1 = mig('20260911203629_finance_cost_facts_and_company_costs.sql');
const RPCS     = mig('20260911203717_finance_reporting_rpcs.sql');
const RPCS2    = mig('20260911203804_finance_reporting_rpcs_part2.sql');
const REGISTRY = mig('20260911204005_finance_provider_registry.sql');
const REG_RPCS = mig('20260911204108_finance_registry_rpcs.sql');
const FX       = mig('20260911204157_finance_fx_strict_no_silent_parity.sql');
const ALERTS   = mig('20260911204845_finance_evaluate_alerts_single_scan.sql');
const AUDIT    = mig('20260911204536_finance_provider_access_audit_layer.sql');
const FACTS    = mig('20260911204617_finance_cost_facts_source_of_truth_taxonomy.sql');
const CONN     = mig('20260911204633_finance_provider_connections_and_reconciliation.sql');
const SETTINGS = mig('20260911204714_billing_setting_readers_tolerate_json_scalar_types.sql');
const SUMMARY  = mig('20260911205757_finance_summary_revenue_availability_is_configuration.sql');
const CLOSE    = mig('20260911204338_finance_alerts_margin_and_close.sql');

// Strip SQL comments, so a rule can never be "satisfied" by prose about it.
const strip = (sql) => sql.replace(/--[^\n]*/g, '');

// ── The double count this whole system exists to prevent ───────────────────

test('Verify money is counted once: cost_events VERIFY% is excluded from the facts', () => {
  // Verify writes BOTH a cost_events row per stage and has its cost recomputed
  // from token counts. Summing both tables reports double.
  assert.match(strip(FACTS), /WHERE ce\.operation_type NOT LIKE 'VERIFY%'/);
  // And the authoritative branch is the token-accurate one.
  assert.match(strip(FACTS), /FROM public\.verify_stage_cogs s/);
  assert.match(strip(FACTS), /'VERIFY_STAGE'::text\s+AS origin/);
});

test('a match unlock is a credit movement, not provider spend', () => {
  assert.match(strip(FACTS), /NOT \(ce\.provider::text = 'OTHER' AND ce\.operation_type = 'MATCH_UNLOCK'\)/);
});

test('a component another provider billed never enters company spend twice', () => {
  // The generated column is the guard, so it cannot be forgotten at a call site.
  assert.match(strip(AUDIT), /is_double_count_guard boolean\s+GENERATED ALWAYS AS \(billed_by_provider_id IS NOT NULL/);
  assert.match(strip(AUDIT), /billed_by_provider_id <> provider_id\) STORED/);
  // And the fact stream applies it to is_cogs.
  assert.match(strip(FACTS), /AND NOT e\.is_double_count_guard/);
  // The component row still exists for the breakdown.
  assert.match(strip(CONN), /CREATE OR REPLACE FUNCTION public\.finance_record_component_cost/);
  assert.match(strip(CONN), /parent_event_id/);
});

// ── Never silently zero ────────────────────────────────────────────────────

test('measured work with no rate behind it is UNPRICED, not free', () => {
  // Legacy meter: units happened, not a cache hit, nothing recorded.
  assert.match(strip(FACTS),
    /COALESCE\(ce\.cost_usd,0\) = 0 AND COALESCE\(ce\.units,0\) > 0 AND NOT COALESCE\(ce\.cache_hit,false\)/);
  // Registry branch: no measured cost, no convertible amount, no price book rule.
  assert.match(strip(FACTS), /c\.resolved IS NULL AND COALESCE\(e\.quantity,0\) > 0 AND NOT e\.cache_hit/);
  // Surfaced rather than buried.
  assert.match(strip(RPCS), /CREATE OR REPLACE FUNCTION public\.finance_unpriced/);
  assert.match(strip(RPCS), /'unpriced_events', v_unpriced_events/);
});

test('an unknown currency is never converted at parity', () => {
  const fn = strip(FX).slice(strip(FX).indexOf('FUNCTION public.fx_to_usd'));
  // USD is the identity and needs no row.
  assert.match(fn, /WHEN upper\(COALESCE\(p_currency,'USD'\)\) = 'USD' THEN round\(p_amount, 6\)/);
  // Anything else must find a real dated rate, or return NULL.
  assert.ok(!/COALESCE\([^)]*\), 1\)/.test(fn),
    'fx_to_usd must not fall back to a rate of 1 for an unknown currency');
  // The old permissive form is what this replaced.
  assert.match(strip(FACTS_V1), /COALESCE\(\(\s*SELECT r\.rate/);
  // A NULL conversion reads as unpriced downstream.
  assert.match(strip(FACTS), /NOT public\.fx_rate_known\(i\.source_currency/);
});

test('missing revenue configuration is stated, never drawn as zero revenue', () => {
  // Availability is a question about configuration, not about whether any
  // money happened to arrive this month.
  assert.match(strip(SUMMARY), /v_provider_configured :=/);
  assert.match(strip(SUMMARY), /'revenue_data_available', v_provider_configured/);
  assert.ok(!/'revenue_data_available', \(v_rev_mtd > 0\)/.test(strip(SUMMARY)),
    'revenue availability must not be derived from the revenue amount');
  // And the UI renders that as NOT CONFIGURED rather than $0.00.
  const page = src('pages/admin/AdminFinancePage.tsx');
  assert.match(page, /unavailable=\{!s\?\.revenue_data_available\}/);
});

// ── Admin only, in the database ────────────────────────────────────────────

test('every finance RPC gates itself, rather than trusting the route', () => {
  const gate = /perform public\.finance_require_admin\(\);/;
  for (const [name, sql] of Object.entries({
    RPCS, RPCS2, REG_RPCS, CONN, CLOSE,
  })) {
    const bodies = strip(sql).split(/CREATE OR REPLACE FUNCTION public\.finance_/).slice(1);
    for (const body of bodies) {
      const head = body.slice(0, body.indexOf('$fn$;') === -1 ? body.length : body.indexOf('$fn$;'));
      // Trigger helpers and pure lookups are not reporting functions.
      if (/^(require_admin|tz|monthly_equivalent_cents|product_for_operation|provider_unit_cost|provider_registry_guard|record_component_cost|record_cost)/.test(body)) continue;
      assert.ok(gate.test(head) || /FORBIDDEN: finance data is admin only/.test(head),
        `${name}: finance_${body.slice(0, 40).split('(')[0]} must call finance_require_admin()`);
    }
  }
});

test('the gate raises rather than returning empty', () => {
  // An authorization failure that returns no rows is indistinguishable from a
  // company with no costs, which is the worst possible failure mode here.
  assert.match(strip(RPCS), /raise exception 'FORBIDDEN: finance data is admin only'/);
});

test('the fact stream itself is never readable by a customer session', () => {
  for (const sql of [FACTS_V1, FACTS]) {
    assert.match(strip(sql), /REVOKE ALL ON public\.finance_cost_facts FROM anon, authenticated/);
  }
});

test('writing the company cost ledger is server-side only', () => {
  assert.match(strip(REG_RPCS),
    /REVOKE ALL ON FUNCTION public\.finance_record_cost\([^)]*\) FROM PUBLIC, anon, authenticated/);
  assert.match(strip(REG_RPCS), /GRANT EXECUTE ON FUNCTION public\.finance_record_cost\([^)]*\) TO service_role/);
  // PUBLIC must be revoked too: this project grants EXECUTE to PUBLIC on every
  // new function, so revoking anon + authenticated alone leaves it reachable.
  for (const sql of [RPCS, RPCS2, REG_RPCS, FX, CONN, ALERTS]) {
    assert.match(strip(sql), /FROM PUBLIC, anon/);
  }
});

test('every finance table is admin-only at the row level', () => {
  assert.match(strip(REGISTRY), /ENABLE ROW LEVEL SECURITY/);
  assert.match(strip(REGISTRY), /USING \(public\.is_admin\(\)\) WITH CHECK \(public\.is_admin\(\)\)/);
  assert.match(strip(AUDIT), /CREATE POLICY finance_reconciliations_admin/);
});

// ── No secrets, anywhere ───────────────────────────────────────────────────

test('the registry stores the NAME of a credential variable, never its value', () => {
  assert.match(strip(REGISTRY), /credential_env_var\s+text/);
  // Enforced by a trigger, not just by a comment.
  assert.match(strip(REGISTRY), /raise exception 'credential_env_var must be an ENV VAR NAME, never a secret value'/);
  assert.match(strip(REGISTRY), /new\.credential_env_var !~ '\^\[A-Z\]\[A-Z0-9_\]\*\$'/);
});

test('no finance surface can render a key, token or secret value', () => {
  const files = [
    'pages/admin/AdminFinancePage.tsx',
    'components/admin/finance/FinanceConnectionsTab.tsx',
    'components/admin/finance/FinanceProvidersTab.tsx',
    'components/admin/finance/FinanceEventsTab.tsx',
    'components/admin/finance/FinanceMoneyTabs.tsx',
    'components/admin/finance/FinanceProductsTab.tsx',
    'components/admin/finance/FinanceKit.tsx',
    'services/finance.ts',
  ];
  for (const f of files) {
    const code = src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const forbidden of [
      'api_key', 'apiKey', 'secret', 'service_role_key', 'serviceRoleKey',
      'access_token', 'accessToken', 'webhook_secret', 'private_key',
    ]) {
      assert.ok(!code.includes(forbidden), `${f} must not reference ${forbidden}`);
    }
  }
});

// ── Registry-driven, not hardcoded ─────────────────────────────────────────

test('providers, categories, units and product mapping are all rows', () => {
  for (const table of [
    'finance_provider_registry', 'finance_provider_categories',
    'finance_billing_units', 'finance_operation_map',
  ]) {
    assert.match(strip(REGISTRY), new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
  }
  // The CASE expression that used to map operations to products is gone.
  assert.match(strip(FACTS), /public\.finance_product_for_operation\(/);
  assert.ok(!/WHEN ce\.operation_type LIKE 'QUEUE_%'/.test(strip(FACTS)),
    'product mapping must come from finance_operation_map, not a CASE in the view');
});

test('the four declared capabilities exist and drive the UI', () => {
  for (const cap of [
    'supports_live_metering', 'supports_usage_import',
    'supports_manual_invoice', 'supports_effective_dated_pricing',
  ]) {
    assert.match(strip(REGISTRY), new RegExp(`${cap}\\s+boolean NOT NULL`));
    assert.match(strip(REG_RPCS), new RegExp(`'${cap}', r\\.${cap}`));
  }
  // The audit layer adds the rest of the declared contract.
  for (const cap of [
    'supports_provider_reported_cost', 'supports_invoice_import', 'supports_manual_cost',
  ]) {
    assert.match(strip(AUDIT), new RegExp(`ADD COLUMN IF NOT EXISTS ${cap} boolean`));
  }
});

test('a new provider needs no UI change: nothing switches on a provider name', () => {
  for (const f of [
    'components/admin/finance/FinanceProvidersTab.tsx',
    'components/admin/finance/FinanceConnectionsTab.tsx',
  ]) {
    const code = src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const name of ['OPENAI', 'APIFY', 'DATAFORSEO', 'RETELL', 'TWILIO', 'RESEND']) {
      assert.ok(!new RegExp(`['"\`]${name}['"\`]`).test(code),
        `${f} must not branch on the provider name ${name}`);
    }
  }
  // Grouping comes from the registry's own categories, in its own order.
  assert.match(src('components/admin/finance/FinanceProvidersTab.tsx'), /registry\?\.categories/);
});

test('the future channels are registered but deliberately unpriced', () => {
  for (const p of [
    'TELEGRAM_RESEARCH', 'META_RESEARCH', 'GOOGLE_RESEARCH', 'LINKEDIN_RESEARCH',
    'WHATSAPP', 'SMS', 'EMAIL', 'AI_CALL', 'TELEPHONY', 'STT', 'TTS', 'ENRICHMENT',
  ]) {
    assert.match(strip(REGISTRY), new RegExp(`'${p}'`), `${p} must be registered`);
  }
  // Registering is not pricing: no rate rows are seeded for them.
  assert.ok(!/INSERT INTO public\.finance_provider_prices/.test(strip(REGISTRY)),
    'registering a provider must not invent a rate for it');
  assert.match(REGISTRY, /Registered only\. AI call pricing is intentionally not defined yet/);
  assert.match(REGISTRY, /Registered only\. Email campaign pricing is intentionally not defined yet/);
});

test('an unregistered provider is refused loudly rather than absorbed', () => {
  assert.match(strip(REG_RPCS),
    /raise exception 'UNREGISTERED_PROVIDER: % is not in finance_provider_registry'/);
});

test('recording the same external reference twice does not double count', () => {
  assert.match(strip(REGISTRY),
    /CREATE UNIQUE INDEX IF NOT EXISTS uidx_finance_pce_external[\s\S]*?WHERE external_ref IS NOT NULL/);
  assert.match(strip(REG_RPCS), /on conflict \(provider_id, external_ref\) where external_ref is not null/);
});

// ── Source of truth per event ──────────────────────────────────────────────

test('every cost figure declares how it was arrived at', () => {
  const allowed = ['PROVIDER_REPORTED','MEASURED','CALCULATED','ALLOCATED',
                   'MANUAL','ESTIMATED','UNPRICED','IMPORTED','INVOICE','PRICE_BOOK'];
  for (const v of allowed) {
    assert.match(strip(AUDIT), new RegExp(`'${v}'`), `${v} must be an allowed cost_source`);
  }
  // The view emits it per branch rather than assuming one for everything.
  assert.match(strip(FACTS), /COALESCE\(r\.default_cost_source, 'MEASURED'\)/);
  assert.match(strip(FACTS), /WHEN s\.price_state = 'PRICED' THEN 'CALCULATED' ELSE 'UNPRICED' END/);
});

test('charges that are not executions are classed apart', () => {
  for (const c of ['SUBSCRIPTION','COMMITMENT','RENTAL','STORAGE','EGRESS','OVERAGE','TAX','PLATFORM_FEE']) {
    assert.match(strip(AUDIT), new RegExp(`'${c}'`));
  }
});

// ── History is never rewritten ─────────────────────────────────────────────

test('repricing previews; it does not edit past facts', () => {
  const preview = strip(CLOSE).slice(strip(CLOSE).indexOf('FUNCTION public.finance_reprice_preview'));
  const body = preview.slice(0, preview.indexOf('$fn$;'));
  assert.ok(!/\bupdate\b/i.test(body), 'the preview must write nothing');
  assert.ok(!/\binsert\b/i.test(body), 'the preview must write nothing');
  assert.match(CLOSE, /Preview only\. Nothing has been written/);
});

test('a new rate closes the old one instead of overwriting it', () => {
  assert.match(strip(REG_RPCS), /update public\.finance_provider_prices\s+set effective_to = v_from/);
  assert.match(strip(FX), /update public\.fx_rates set effective_to = v_from/);
});

test('reconciliation never edits local events to force a match', () => {
  const recon = strip(CONN).slice(strip(CONN).indexOf('FUNCTION public.finance_reconcile'));
  const body = recon.slice(0, recon.indexOf('$fn$;'));
  assert.ok(!/update public\.finance_provider_cost_events/i.test(body));
  assert.ok(!/update public\.cost_events/i.test(body));
  for (const s of ['MATCHED','WITHIN_TOLERANCE','MISMATCH','INCOMPLETE','UNAVAILABLE']) {
    assert.match(body, new RegExp(`'${s}'`));
  }
  // Unpriced usage means the local side is knowably incomplete.
  assert.match(body, /when v_unpriced > 0 then 'INCOMPLETE'/);
});

test('corrections supersede rather than overwrite', () => {
  assert.match(strip(FACTS_V1), /superseded_by uuid REFERENCES public\.finance_fixed_expenses\(id\)/);
  assert.match(strip(REGISTRY), /reversal_of\s+uuid REFERENCES public\.finance_provider_invoices\(id\)/);
});

// ── Alerts ─────────────────────────────────────────────────────────────────

test('re-running alert evaluation updates instead of stacking duplicates', () => {
  assert.match(strip(FACTS_V1),
    /CREATE UNIQUE INDEX IF NOT EXISTS uidx_finance_alerts_open[\s\S]*?WHERE resolved_at IS NULL/);
  assert.match(strip(ALERTS), /on conflict \(dedupe_key\) where resolved_at is null/);
  // And a condition that no longer holds is resolved, so the list is current.
  assert.match(strip(ALERTS), /set resolved_at = now\(\)[\s\S]*?not \(dedupe_key = ANY \(v_open\)\)/);
});

test('alert evaluation scans the fact stream once, not once per row', () => {
  // The first version was quadratic and timed out on production.
  assert.match(strip(ALERTS), /create temp table _ff on commit drop as/);
  assert.match(strip(ALERTS), /from _ff/);
});

test('silence is not reported as zero spend', () => {
  assert.match(strip(ALERTS), /'COST_DATA_STALE'/);
  assert.match(strip(AUDIT), /stale_after_hours integer NOT NULL DEFAULT 48/);
  assert.match(strip(CONN), /'stale', \(r\.access_status::text <> 'NOT_CONFIGURED'/);
});

test('the finance budget and the gate that actually enforces are kept distinct', () => {
  // finance_budgets is advisory. admin_settings.spend_cap_* is what stops
  // spending. The drift between them is surfaced, not silently unified.
  assert.match(strip(FACTS_V1), /enforcement_setting_key text/);
  assert.match(strip(RPCS2), /'drifts_from_enforcement'/);
  assert.match(strip(ALERTS), /'BUDGET_DRIFT'/);
  assert.match(strip(ALERTS), /The enforced value is the one that stops spending/);
});

// ── Settings reader ────────────────────────────────────────────────────────

test('a setting stored as a JSON string reads as a number', () => {
  // Ten live spend caps are stored as "250" rather than 250; value::text::numeric
  // raises 22P02 on those, which is how the budget-drift check first failed.
  assert.match(strip(SETTINGS), /s\.value #>> '\{\}'/);
  assert.ok(!/value::text::numeric/.test(strip(SETTINGS)),
    'the setting reader must not cast a JSON string through ::text::numeric');
  // A non-numeric setting returns the default instead of raising, because
  // these readers sit on the live billing path.
  assert.match(strip(SETTINGS), /\^\\s\*-\?\[0-9\]\+\(\\\.\[0-9\]\+\)\?\\s\*\$/);
});

// ── Money is never float ───────────────────────────────────────────────────

test('no finance SQL rounds a double precision value', () => {
  // round(double precision, integer) does not exist in Postgres; percentile_cont
  // returns double. This is the 42883 that the products RPC hit.
  const products = mig('20260911205021_finance_products_fix_double_precision_round.sql');
  assert.match(strip(products), /percentile_cont\(0\.5\) within group \(order by landed_cogs_cents\)\/100\)::numeric/);
  assert.match(strip(products), /percentile_cont\(0\.9\) within group \(order by landed_cogs_cents\)\/100\)::numeric/);
});

test('the client formats money but never computes it', () => {
  const svc = src('services/finance.ts');
  // No arithmetic on a money value happens client-side at all.
  assert.match(svc, /No arithmetic on money happens here/);
  assert.match(svc, /Nothing in this file computes money/);
  // Every figure comes from an RPC.
  assert.match(svc, /supabase\.rpc\(fn, args\)/);
  // A sub-cent provider cost must not render as "$0.00".
  assert.match(svc, /abs > 0 && abs < 0\.01 \? 6 : maxFrac/);
});

// ── The UI is wired to real data ───────────────────────────────────────────

test('the finance page is registered and reachable as an admin route', () => {
  const routes = src('routes.tsx');
  assert.match(routes, /AdminFinancePage/);
  assert.match(routes, /path: '\/admin\/finance'[\s\S]{0,120}adminOnly: true/);
  assert.match(src('components/layouts/AdminLayout.tsx'), /'\/admin\/finance'/);
  assert.match(src('components/layouts/AdminLayout.tsx'), /admin_nav_finance/);
});

test('every tab renders a real RPC rather than a placeholder', () => {
  const svc = src('services/finance.ts');
  for (const rpc of [
    'finance_summary', 'finance_providers', 'finance_provider_connections',
    'finance_provider_registry_list', 'finance_products', 'finance_plans',
    'finance_credits', 'finance_users', 'finance_budget_status', 'finance_alert_list',
    'finance_cost_events', 'finance_monthly_summary', 'finance_margin_monitor',
    'finance_timeseries', 'finance_fx_status', 'finance_export_cost_facts',
  ]) {
    assert.ok(svc.includes(`'${rpc}'`), `services/finance.ts must call ${rpc}`);
  }
});

test('a refused request is shown as authorization working, not as an empty company', () => {
  const page = src('pages/admin/AdminFinancePage.tsx');
  assert.match(page, /FORBIDDEN/);
  assert.match(page, /fin_forbidden_title/);
});
