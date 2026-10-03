-- HOMATCH global pricing policy: 55% gross margin for cost-based products.
-- billing_price_quote() already enforces max(product minimum, global minimum),
-- so this setting is the single global floor for every COST_BASED product.
-- FREE products do not enter paid settlement. CUSTOM commercial models retain
-- their own pricing logic. VAT/tax remains separate from gross-margin policy.

insert into public.admin_settings (key, value, description)
values (
  'billing_min_gross_margin_bps',
  '5500'::jsonb,
  'Global minimum gross margin for COST_BASED HOMATCH products. 5500 = 55%. Change this single setting to change the global cost-based margin floor. FREE and CUSTOM pricing policies are excluded from this rule.'
)
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = now();

update public.billable_products
set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('pricing_policy', 'COST_BASED')
where code in (
  'VERIFY','CONTRACT_INTELLIGENCE','FIND_CLIENTS','FIND_PROPERTY',
  'AI_CHAT_RESPONSE','AI_CALL','EMAIL_CAMPAIGN',
  'DS_AI_DESIGN','DS_FLOORPLAN_READ','DS_MASTER_RENDER','DS_RECONSTRUCT',
  'DS_RENDER_EDIT','DS_ROOM_RENDER','META_AD_IMAGE_GEN'
);

update public.billable_products
set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('pricing_policy', 'FREE')
where code = 'AI_TALK';

update public.billable_products
set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('pricing_policy', 'INACTIVE')
where code = 'WHATSAPP';

update public.billable_products
set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('pricing_policy', 'CUSTOM')
where code in ('BROKER_DIRECTORY_LISTING', 'BROKER_DISCOVERY');

update public.admin_settings
set value = to_jsonb((coalesce((value #>> '{}')::integer, 1) + 1)),
    updated_at = now()
where key = 'billing_pricing_version';
