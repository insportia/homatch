-- ═══════════════════════════════════════════════════════════════════════
-- HOMATCH DESIGN STUDIO — the operations that cost HOMATCH money,
-- REGISTERED AND MEASURED, NOT PRICED.
--
--   DS_FLOORPLAN_READ   an AI reading of a customer's floor plan
--   DS_AI_DESIGN        an AI design plan (intent → structured operations)
--   DS_RECONSTRUCT      reading a customer's pictures of a home into a scene
--
-- Same pattern as AI_CHAT_RESPONSE (20260919152038): nobody knows yet what
-- one of these costs, so each is registered with its measurement ON and its
-- pricing OFF. Every run records a usage_events row with the real model,
-- tokens and landed COGS, billable = false, charged 0 credits.
--
-- Turning either into a price is a later, explicit product decision and a
-- data change: set reference_landed_cogs_cents from the measured
-- distribution, set standard_retail_cents, pricing_active = true, and
-- design_studio_billing_enabled = true. When that happens the product shows
-- the exact cost and asks before running (propose → cost → confirm →
-- reserve → execute → settle / release). Until then nothing is charged.
--
-- Ordinary editing — moving furniture, colours, materials already loaded,
-- camera, walkthrough, undo/redo, opening a project — is not a product and
-- never will be.
-- ═══════════════════════════════════════════════════════════════════════

insert into public.billable_products (
  code, name, billing_mode, requires_reservation,
  standard_retail_cents, reference_landed_cogs_cents, min_gross_margin_bps,
  estimate_strategy, enabled, pricing_active, min_viable_budget_credits,
  sort_order, config
) values
  ('DS_FLOORPLAN_READ', 'Design Studio floor-plan reading', 'VARIABLE', true,
   0, 0, 3000, 'PER_UNIT', true, false, 0, 120,
   jsonb_build_object('estimate_spread_bps', 5000,
     'scope_note', 'Measured before priced. One AI reading of one customer floor plan.')),
  ('DS_AI_DESIGN', 'Design Studio AI design plan', 'VARIABLE', true,
   0, 0, 3000, 'PER_UNIT', true, false, 0, 121,
   jsonb_build_object('estimate_spread_bps', 5000,
     'scope_note', 'Measured before priced. One AI design plan: intent to structured, validated operations.')),
  ('DS_RECONSTRUCT', 'Design Studio reconstruction from images', 'VARIABLE', true,
   0, 0, 3000, 'PER_UNIT', true, false, 0, 122,
   jsonb_build_object('estimate_spread_bps', 5000,
     'scope_note', 'Measured before priced. One reading of up to six pictures of a home into a structured scene.'))
on conflict (code) do nothing;

insert into public.product_plan_entitlements (product_code, plan_code, included_per_period, period, quality_tier)
select pc.code, p.code, 0, 'CALENDAR_MONTH', p.quality_tier
from public.billing_plans p
cross join (values ('DS_FLOORPLAN_READ'), ('DS_AI_DESIGN'), ('DS_RECONSTRUCT')) as pc(code)
on conflict (product_code, plan_code) do nothing;

insert into public.admin_settings (key, value, description) values
  ('design_studio_billing_enabled', 'false'::jsonb,
   'Whether Design Studio AI operations (floor-plan reading, AI design plans) reserve and settle Credits. '
   || 'While false, usage is measured and recorded with billable=false and nothing is charged.')
on conflict (key) do nothing;
