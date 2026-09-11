-- Homatch — the COGS columns on usage_events are not one policy edit away from
-- a customer.
--
-- WHAT WAS FOUND
--
-- usage_events is RLS-protected and its only SELECT policy is is_admin(), so a
-- customer reads zero rows today. But the table-level SELECT grant to
-- `authenticated` is still there, which means the columns
--
--   raw_provider_cost_cents   ai_cost_cents
--   tax_cents                 fee_cents
--   landed_cogs_cents
--
-- are protected by exactly one predicate. "Let a customer see their own usage
-- history" is an obviously reasonable future request, and the natural way to
-- implement it -- add `OR user_id = auth_user_id()` to that policy -- would
-- silently publish our provider costs and margin on every row.
--
-- Column grants make that mistake impossible instead of merely unlikely: the
-- future policy can be added safely, and the COGS columns still will not come
-- back. Same argument, same shape, as
-- 20260911170000_properties_column_grants.sql.
--
-- Grants only. The RLS policy is unchanged and admins are unaffected -- they
-- read through is_admin() or the service role, and admin surfaces query it
-- server-side.

REVOKE SELECT ON public.usage_events FROM anon, authenticated;
GRANT SELECT (id, user_id, reservation_id, product_code, plan_code, quality_tier,
              pricing_version, provider, provider_operation, model,
              search_count, provider_units, enrichment_units, duration_ms,
              charged_credits, reserved_credits, released_credits,
              allowance_funded, billable, outcome, failure_reason, job_ref, created_at)
  ON public.usage_events TO authenticated;

-- Same reasoning for the reservation snapshot: provider_budget_ceiling_cents is
-- an operational budget, and usage_reservations DOES have a read-own policy
-- today, so this one is not hypothetical.
REVOKE SELECT ON public.usage_reservations FROM anon, authenticated;
GRANT SELECT (id, user_id, product_code, status, plan_code_snapshot,
              quality_tier_snapshot, pricing_version_snapshot, result_ceiling_snapshot,
              estimate_min_credits, estimate_max_credits, authorized_max_credits,
              reserved_credits, settled_credits, released_credits,
              allowance_consumption_id, job_ref, failure_reason,
              expires_at, created_at, updated_at, settled_at)
  ON public.usage_reservations TO authenticated;

COMMENT ON COLUMN public.usage_events.landed_cogs_cents IS
  'INTERNAL. Not granted to anon/authenticated at the column level, so no future RLS policy can expose it by accident.';
