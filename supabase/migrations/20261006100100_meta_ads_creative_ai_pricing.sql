-- META ADS — HOMATCH AI CREATIVE INTELLIGENCE: pricing (data only).
--
-- 1. Billing — product META_AD_IMAGE_GEN, PER_UNIT (one generated image),
--    through the canonical wallet (_shared/billing.ts: quote → explicit
--    confirmation → wallet_reserve → generate → validate → wallet_settle on
--    the measured cost, or wallet_release). Its reference figures are the
--    published provider cost, not a guess: OpenAI gpt-image-1 medium quality
--    1024×1536 ≈ 1 584 output tokens × $40/M = $0.063, plus ≈ 1 000 input
--    tokens (the source image and the prompt) × $10/M = $0.010; landed with
--    HOMATCH's 18 % COGS tax (billing_cogs_tax_bps) ≈ 8.6 ¢ → reference 9 ¢.
--    Retail = reference ÷ (1 − 30 %), HOMATCH's minimum gross margin
--    (billing_min_gross_margin_bps) → 13 ¢ = 1.3 Credits per image. The
--    settled price always comes from the run's MEASURED tokens × the price
--    book below, scaled by retail/reference and floored at the minimum margin
--    (billing_price_quote). Admin-editable in billable_products. No plan
--    includes it (PAYG only).
--
-- 2. provider_price_book — gpt-image-1 rates as OpenAI publishes them:
--    image output $40 / 1M tokens; input $10 / 1M tokens (the image-input
--    rate, applied to all input — text input costs less, so never undercounted).
--
-- 3. admin_settings meta_ads_ai_creative_enabled — the kill switch.
--
-- Data only; idempotent; no row changes meaning.

insert into public.billable_products (
  code, name, billing_mode, requires_reservation,
  standard_retail_cents, reference_landed_cogs_cents, min_gross_margin_bps,
  estimate_strategy, enabled, pricing_active, min_viable_budget_credits,
  sort_order, config
) values (
  'META_AD_IMAGE_GEN', 'Meta Ads — HOMATCH AI image variation', 'VARIABLE', true,
  13, 9, 3000, 'PER_UNIT', true, true, 0, 130,
  jsonb_build_object('estimate_spread_bps', 2500,
    'scope_note', 'One AI-generated advertising image (gpt-image-1, medium, up to 1536 px). Priced from measured tokens × provider_price_book.')
)
on conflict (code) do nothing;

insert into public.product_plan_entitlements (product_code, plan_code, included_per_period, period, quality_tier)
select 'META_AD_IMAGE_GEN', p.code, 0, 'CALENDAR_MONTH', p.quality_tier
from public.billing_plans p
on conflict (product_code, plan_code) do nothing;

insert into public.provider_price_book (provider, model, unit, rate, per_units, currency, effective_from)
select v.provider, v.model, v.unit, v.rate, 1000000, 'USD', '2026-10-01 00:00:00+00'::timestamptz
from (values
  ('OPENAI', 'gpt-image-1', 'INPUT_TOKEN', 10.00::numeric),
  ('OPENAI', 'gpt-image-1', 'OUTPUT_TOKEN', 40.00::numeric)
) as v(provider, model, unit, rate)
where not exists (
  select 1 from public.provider_price_book b
  where b.provider = v.provider and b.model = v.model and b.unit = v.unit and b.effective_to is null
);

insert into public.admin_settings (key, value, description) values
  ('meta_ads_ai_creative_enabled', 'true'::jsonb,
   'HOMATCH AI creative analysis and paid image generation in the Meta Ads builder. Off = the buttons explain it is unavailable; nothing runs or is charged.')
on conflict (key) do nothing;
