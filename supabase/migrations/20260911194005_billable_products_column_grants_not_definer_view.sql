-- Homatch — a customer may see which products exist, not what they cost us.
--
-- WHAT WAS FOUND
--
-- billable_products_public was created WITH (security_invoker = false) so that
-- a customer could read it while the base table stayed admin-only under RLS.
-- Supabase's linter flags that as an ERROR, and it is right to: a SECURITY
-- DEFINER view runs with the creator's rights, so its correctness rests
-- entirely on nobody ever adding a column to the SELECT list by mistake. The
-- protection is a convention, not a permission.
--
-- COLUMN GRANTS ARE THE ACTUAL TOOL
--
-- RLS decides WHICH ROWS. The problem here is WHICH COLUMNS:
--
--   reference_landed_cogs_cents   what a provider charges us
--   standard_retail_cents         the pre-discount list price
--   min_gross_margin_bps          our loss floor
--   config                        provider budget shape
--
-- None of those may reach a customer. So the grant is stated per column, the
-- view becomes an ordinary security_invoker view, and the RLS policy that lets
-- a customer read enabled rows can be added without also handing over the
-- economics. Direct table access and view access now give exactly the same
-- answer, which is the property the SECURITY DEFINER version did not have.
--
-- Same shape as 20260911170000_properties_column_grants.sql.

DROP VIEW IF EXISTS public.billable_products_public;

CREATE VIEW public.billable_products_public
WITH (security_invoker = true) AS
  SELECT code, name, billing_mode, requires_reservation, estimate_strategy,
         enabled, pricing_active, kill_switch, sort_order
  FROM public.billable_products
  WHERE enabled = true;
COMMENT ON VIEW public.billable_products_public IS
  'Customer-safe projection of billable_products. security_invoker, so the reader''s own RLS and column grants apply and this view can never widen them.';

-- Rows: a customer may see enabled products.
DROP POLICY IF EXISTS billable_products_read_enabled ON public.billable_products;
CREATE POLICY billable_products_read_enabled ON public.billable_products
  FOR SELECT TO anon, authenticated USING (enabled = true);

-- Columns: only the ones with no commercial information in them.
REVOKE SELECT ON public.billable_products FROM anon, authenticated;
GRANT SELECT (code, name, billing_mode, requires_reservation, estimate_strategy,
              enabled, pricing_active, kill_switch, sort_order, created_at, updated_at)
  ON public.billable_products TO anon, authenticated;
GRANT SELECT ON public.billable_products_public TO anon, authenticated;

-- product_plan_entitlements has the same shape of problem, one column deep:
-- provider_budget_ceiling_cents is an operational spend budget and reveals the
-- relative cost of each tier. Everything else on that table is the plan
-- comparison the pricing page is built from and is meant to be public.
REVOKE SELECT ON public.product_plan_entitlements FROM anon, authenticated;
GRANT SELECT (product_code, plan_code, included_per_period, period, quality_tier,
              result_ceiling, priority_level, created_at, updated_at)
  ON public.product_plan_entitlements TO anon, authenticated;

-- billing_plans.profit_share_to_customer_bps is the internal margin lever.
-- The rest is the price card.
REVOKE SELECT ON public.billing_plans FROM anon, authenticated;
GRANT SELECT (code, name, monthly_price_cents, membership_credits_grant,
              membership_rollover_cap, quality_tier, badge_key, priority_level,
              marketing_label_key, sort_order, enabled, created_at, updated_at)
  ON public.billing_plans TO anon, authenticated;

-- promotions.bonus_match_bps / max_bonus_credits are needed to render the
-- activation offer honestly, so they stay readable. Nothing there is internal.

-- The two unit converters were granted to authenticated in 20260911193358 for a
-- frontend that ended up getting credits_per_usd from billing_my_entitlements()
-- instead. Nothing calls them from the client, so the RPC endpoints come back
-- off.
REVOKE ALL ON FUNCTION public.billing_cents_to_credits(numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_cents_to_credits(numeric) TO service_role;
REVOKE ALL ON FUNCTION public.billing_credits_to_cents(numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_credits_to_cents(numeric) TO service_role;
