-- ONE ASSISTANT RESPONSE, REGISTERED AS A PRODUCT.
--
-- WHY IT IS REGISTERED BEFORE IT IS PRICED
--
-- Nobody knows what a Homatch chat answer costs. Not roughly, not
-- within an order of magnitude: the input side is dominated by a large
-- system prompt and whatever internal data the customer's account
-- pulls in, the output side by how long the answer runs, and a single
-- web search costs more than a hundred short replies. Picking a price
-- from any of that today would be picking a number.
--
-- So this registers the product with its measurement switched on and
-- its pricing switched off. Every authenticated response writes a
-- usage_events row with the real model, the real token counts, the
-- real search count and the landed COGS those imply — billable false,
-- charged zero. That is a real distribution, gathered in production,
-- from real conversations.
--
-- Turning it into a price is then a data change, not a deploy:
--   1. read the distribution out of usage_events
--   2. set reference_landed_cogs_cents to a representative response
--   3. set standard_retail_cents, whose RATIO to that reference is the
--      markup (see billing_price_quote: v_multiple)
--   4. pricing_active = true, and ai_chat_billing_enabled = true
--
-- WHY NO INCLUDED ALLOWANCE
--
-- Because there is none today. Proven, not assumed: billing_entitlements
-- returns products from product_plan_entitlements, AI chat has never had
-- a row there, and what limited it was ai_chat_daily_limit_* — a fair-use
-- ceiling, not a contractual allowance. included_per_period is therefore
-- 0 on every plan, which changes nothing anybody was promised. The rows
-- exist at all because beginExecution looks the product up in that list
-- and a product missing from it is NOT_FOUND.

insert into public.billable_products (
  code, name, billing_mode, requires_reservation,
  standard_retail_cents, reference_landed_cogs_cents, min_gross_margin_bps,
  estimate_strategy, enabled, pricing_active, min_viable_budget_credits,
  sort_order, config
) values (
  'AI_CHAT_RESPONSE', 'AI Chat', 'VARIABLE', true,
  0, 0, 3000,
  'PER_UNIT', true, false, 0,
  90,
  jsonb_build_object(
    'estimate_spread_bps', 5000,
    'scope_note', 'Measured in production before it is priced. Every authenticated '
               || 'response records tokens, search calls and landed COGS with '
               || 'billable=false until reference_landed_cogs_cents and '
               || 'standard_retail_cents are set from that distribution.'
  )
)
on conflict (code) do nothing;

-- Visible to the gateway on every plan, with nothing included on any of them.
insert into public.product_plan_entitlements (product_code, plan_code, included_per_period, period, quality_tier)
select 'AI_CHAT_RESPONSE', p.code, 0, 'CALENDAR_MONTH', p.quality_tier
from public.billing_plans p
on conflict (product_code, plan_code) do nothing;

-- The switch that decides whether a response reaches the wallet at all.
-- Off at launch: metering first, money second.
insert into public.admin_settings (key, value, description) values
  ('ai_chat_billing_enabled', 'false'::jsonb,
   'Whether an authenticated AI Chat response reserves and settles Credits. '
   || 'While false, usage is still measured and recorded with billable=false.')
on conflict (key) do nothing;
