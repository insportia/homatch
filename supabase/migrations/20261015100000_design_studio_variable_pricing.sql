-- ═══════════════════════════════════════════════════════════════════════
-- HOMATCH DESIGN STUDIO — VARIABLE PRICING FROM MEASURED COST (data + one
-- backward-compatible pricing option). Billing stays OFF.
--
-- The owner approved the formula (2026-10-04):
--
--   CUSTOMER PRICE = LANDED COGS / (1 − 0.55)        1 credit = $0.10
--   LANDED COGS    = measured provider/compute cost × (1 + billing_cogs_tax_bps)
--
-- and the operating model ESTIMATE → RESERVE → EXECUTE → SETTLE → RELEASE:
-- the quote shows a minimum, an estimate and a maximum; the maximum is
-- reserved; after the work the MEASURED landed COGS is priced again through
-- billing_price_quote and settled, clamped to the reserved maximum; the rest
-- is released. Nothing here is a permanent constant: the reference figures
-- below only drive the quote; the charge is always the measured cost priced.
--
-- REFERENCE FIGURES (landed cents per run, production telemetry 2026-09-30 →
-- 2026-10-04: usage_events, ds_renders.timings.ai, ds_walkthroughs.cost; ×1.18
-- applied). "max" = observed maximum + 10 % safety, the reservation ceiling.
--
--   operation                    min    est    max(+10 %)   what it is made of
--   first design (master)        24.6   25.8   31.0         reading + spec + gpt-image-2 + object map
--   new variant (master, VARIANT) 23.8  24.9   28.5         spec + gpt-image-2 + object map
--   room from selected render    23.7   24.4   27.3         spec + gpt-image-2 + object map
--   render edit                  21.0   24.0   33.2         gpt-image-2 edit
--   3D walkthrough               0.2    2.1    12.1         scene plan (+ reference QA / replan) + RunPod GPU
--
-- standard_retail_cents = reference_landed_cogs_cents / 0.45, so the markup
-- multiple is exactly the 55 % margin (and the global 5500 floor agrees with
-- it). Every DS product's own floor is raised from 3000 to 5500.
--
-- 0.1-CREDIT PRECISION. billing_price_quote rounded every product with the
-- global billing_credit_rounding_dp (2). A product may now carry its own
-- config.credit_rounding_dp; the floor check that follows still rounds UP
-- whenever rounding fell below the margin floor, so the 55 % is never lost.
-- No other product carries the key: their prices are unchanged.
--
-- DS_WALKTHROUGH is registered (it had no product: its AI cost was recorded
-- under DS_AI_DESIGN and its GPU cost nowhere in usage_events).
--
-- design_studio_billing_enabled is NOT touched: it stays false, so no
-- Design Studio quote is charged and nothing is reserved.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. A product's own credit precision ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.billing_price_quote(p_product_code text, p_plan_code text, p_landed_cogs_cents numeric DEFAULT NULL::numeric)
 RETURNS TABLE(product_code text, plan_code text, landed_cogs_cents numeric, standard_price_cents numeric, base_profit_pool_cents numeric, plan_price_before_floor_cents numeric, floor_price_cents numeric, floor_applied boolean, final_price_cents numeric, gross_profit_cents numeric, gross_margin_bps integer, markup_bps integer, credits numeric, pricing_version integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_p record;
  v_plan record;
  v_cogs numeric;
  v_multiple numeric;
  v_standard numeric;
  v_pool numeric;
  v_plan_price numeric;
  v_floor numeric;
  v_min_bps numeric;
  v_final numeric;
  v_credits numeric;
  v_dp integer := public.billing_setting_num('billing_credit_rounding_dp', 2)::integer;
begin
  select * into v_p from public.billable_products where code = p_product_code;
  if not found then raise exception 'UNKNOWN_PRODUCT: %', p_product_code; end if;
  if not v_p.pricing_active then
    raise exception 'PRODUCT_PRICING_INACTIVE: % is registered but has no approved pricing', p_product_code;
  end if;
  -- A product's own precision (e.g. Design Studio: 0.1 credit), else the global one.
  if (v_p.config ? 'credit_rounding_dp') and (v_p.config->>'credit_rounding_dp') ~ '^[0-4]$' then
    v_dp := (v_p.config->>'credit_rounding_dp')::integer;
  end if;

  select * into v_plan from public.billing_plans where code = p_plan_code;
  if not found then raise exception 'UNKNOWN_PLAN: %', p_plan_code; end if;

  v_cogs := round(COALESCE(p_landed_cogs_cents, v_p.reference_landed_cogs_cents), 4);
  if v_cogs < 0 then raise exception 'NEGATIVE_COGS'; end if;
  if v_p.reference_landed_cogs_cents <= 0 then
    raise exception 'PRODUCT_HAS_NO_REFERENCE_COGS: % cannot be priced', p_product_code;
  end if;

  v_multiple := v_p.standard_retail_cents::numeric / v_p.reference_landed_cogs_cents;
  v_standard := round(v_cogs * v_multiple, 4);
  v_pool     := v_standard - v_cogs;
  v_plan_price := round(v_cogs + v_pool * (1 - v_plan.profit_share_to_customer_bps / 10000.0), 4);

  v_min_bps := greatest(COALESCE(v_p.min_gross_margin_bps, 3000), 0);
  v_min_bps := greatest(v_min_bps, public.billing_setting_num('billing_min_gross_margin_bps', 3000));
  if v_min_bps >= 10000 then raise exception 'INVALID_MIN_MARGIN'; end if;

  v_floor := round(v_cogs / (1 - v_min_bps/10000.0), 4);
  v_final := greatest(v_plan_price, v_floor);

  v_credits := round(public.billing_cents_to_credits(v_final), v_dp);
  if public.billing_credits_to_cents(v_credits) < v_floor then
    v_credits := round(v_credits + power(10, -v_dp)::numeric, v_dp);
  end if;
  v_final := public.billing_credits_to_cents(v_credits);

  return query select
    p_product_code, p_plan_code, v_cogs, v_standard, v_pool, v_plan_price,
    v_floor, (v_floor > v_plan_price), v_final,
    round(v_final - v_cogs, 4),
    case when v_final > 0 then round((v_final - v_cogs) / v_final * 10000)::integer else 0 end,
    case when v_cogs  > 0 then round((v_final - v_cogs) / v_cogs  * 10000)::integer else 0 end,
    v_credits,
    public.billing_setting_num('billing_pricing_version', 1)::integer;
end;
$function$;

-- ── 2. The 3D walkthrough is a product ─────────────────────────────────
insert into public.billable_products (
  code, name, billing_mode, requires_reservation,
  standard_retail_cents, reference_landed_cogs_cents, min_gross_margin_bps,
  estimate_strategy, enabled, pricing_active, min_viable_budget_credits,
  sort_order, config
) values (
  'DS_WALKTHROUGH', 'Design Studio 3D walkthrough', 'VARIABLE', true,
  0, 0, 5500, 'PER_UNIT', true, false, 0, 126,
  jsonb_build_object('scope_note', 'One walkable 3D scene reconstructed from the selected design: AI scene plan (and reference QA / replan) + GPU build.')
)
on conflict (code) do nothing;

insert into public.product_plan_entitlements (product_code, plan_code, included_per_period, period, quality_tier)
select 'DS_WALKTHROUGH', p.code, 0, 'CALENDAR_MONTH', p.quality_tier
from public.billing_plans p
on conflict (product_code, plan_code) do nothing;

-- ── 3. Every Design Studio product: the 55 % floor ─────────────────────
update public.billable_products
   set min_gross_margin_bps = 5500, updated_at = now()
 where code like 'DS\_%' and min_gross_margin_bps <> 5500;

-- ── 4. The priced operations: reference figures, 0.1 credit, pricing approved ──
-- config.reference: landed cents per unit {min, est, max}; config.modes: a mode
-- with its own figures (a variant has no plan reading). The estimate is also
-- the reference_landed_cogs_cents the canonical quote reads.
update public.billable_products as bp
   set reference_landed_cogs_cents = v.est,
       standard_retail_cents = round(v.est / 0.45, 4),
       pricing_active = true,
       config = coalesce(bp.config, '{}'::jsonb) || jsonb_build_object(
         'credit_rounding_dp', 1,
         'reference', jsonb_build_object('min', v.min, 'est', v.est, 'max', v.max),
         'reference_basis', 'production telemetry 2026-09-30..2026-10-04, landed (x1.18), max = observed max + 10%',
         'target_margin_bps', 5500
       ) || coalesce(v.modes, '{}'::jsonb),
       updated_at = now()
  from (values
    ('DS_MASTER_RENDER', 24.6, 25.8, 31.0, jsonb_build_object('modes', jsonb_build_object('VARIANT', jsonb_build_object('min', 23.8, 'est', 24.9, 'max', 28.5)))),
    ('DS_ROOM_RENDER',   23.7, 24.4, 27.3, null::jsonb),
    ('DS_RENDER_EDIT',   21.0, 24.0, 33.2, null::jsonb),
    ('DS_WALKTHROUGH',    0.2,  2.1, 12.1, null::jsonb)
  ) as v(code, min, est, max, modes)
 where bp.code = v.code;

-- ── 5. A walkthrough carries its reservation ───────────────────────────
-- { state: NOT_CHARGED | RESERVED | SETTLED | RELEASED, reservationId, credits (the reserved maximum), min, est,
--   productCode, planCode, pricingVersion, metered, chargedCredits, releasedCredits }. Server-written only (the
-- browser reads walkthroughs through publicOf, which never returns it).
alter table public.ds_walkthroughs add column if not exists billing jsonb not null default '{}'::jsonb;
comment on column public.ds_walkthroughs.billing is
  'The walkthrough''s DS_WALKTHROUGH reservation and settlement (quote → reserve max → settle measured AI + GPU → release). Server-written only.';
