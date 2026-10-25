-- Contract Intelligence · one fixed price per analysis.
--
-- Owner decision (2026-10-25): a contract analysis costs a FIXED 3 credits
-- ($0.30; 10 credits = $1). The one included analysis per calendar month that
-- product_plan_entitlements already grants is kept exactly as it is (owner
-- decision, same day): the first analysis of the month is included, every
-- later one is 3 credits.
--
-- WHERE THE PRICE LIVES. billable_products.CONTRACT_INTELLIGENCE, the same row
-- as before: billing_mode FIXED, standard_retail_cents 30. billing_price_quote
-- stays cost-based for every product and is NOT changed; the fixed price is
-- applied by deal-room-document-analyze, which reads this row and
--   * reserves exactly the fixed credits (no estimate spread, no partial
--     budget: a balance below 3 credits is refused, never shrunk), and
--   * settles exactly that amount on success (ActualUsage.priceCredits), or
--     releases the whole hold when the run produced nothing or failed.
-- So an admin can change the price later by editing this row; nothing is
-- hard-coded in the function.
--
-- reference_landed_cogs_cents: observed landed COGS per analysis is
-- 0.76 to 1.55 cents. The reference is set to the top of that range so every
-- cost-based view (pricing simulator, margin reports) reads a realistic,
-- conservative cost instead of the old 18.88 cent placeholder. It must stay
-- above zero: billing_price_quote refuses a product without a reference cost.
--
-- min_viable_budget_credits drops from 4 to 3: a customer holding exactly the
-- price must be able to buy it.
--
-- finance_services follows, so Finance V2 reports the product as FIXED.

update public.billable_products
   set billing_mode = 'FIXED',
       standard_retail_cents = 30,
       reference_landed_cogs_cents = 1.55,
       min_viable_budget_credits = 3,
       config = coalesce(config, '{}'::jsonb)
                || jsonb_build_object('estimate_spread_bps', 0, 'pricing_policy', 'fixed_retail_v1'),
       pricing_version = pricing_version + 1,
       updated_at = now()
 where code = 'CONTRACT_INTELLIGENCE'
   and (billing_mode is distinct from 'FIXED' or standard_retail_cents is distinct from 30);

update public.finance_services
   set policy_id = 'fixed_retail_v1',
       pricing_kind = 'FIXED',
       price_note = 'Fixed 3 credits ($0.30) per analysis, charged on success, released on failure; first analysis each calendar month included (product_plan_entitlements)'
 where service_key = 'contract_intelligence'
   and exists (select 1 from public.finance_commercial_policies where policy_id = 'fixed_retail_v1');

-- The price the Contracts page shows before an upload. standard_retail_cents
-- is deliberately not column-granted to customers (billable_products column
-- grants), so the page asks this function, exactly like verify_fixed_price().
create or replace function public.contract_fixed_price()
returns jsonb
language sql
stable security definer
set search_path to ''
as $$
  select case when p.billing_mode = 'FIXED' and p.standard_retail_cents > 0 then jsonb_build_object(
           'mode', 'FIXED',
           'cents', p.standard_retail_cents,
           'credits', round(p.standard_retail_cents * public.billing_setting_num('credits_per_usd', 10) / 100, 4))
         else jsonb_build_object('mode', 'VARIABLE') end
    from public.billable_products p
   where p.code = 'CONTRACT_INTELLIGENCE'
$$;
revoke all on function public.contract_fixed_price() from public, anon;
grant execute on function public.contract_fixed_price() to authenticated, service_role;
-- The change itself is recorded by billable_products.pricing_version (bumped
-- above) and this migration's place in the ledger; no admin_audit_log row is
-- written, so the migration touches only billing and contracts objects.
