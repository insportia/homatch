-- Additive Find Property registration only; no other source registry or product changes.
-- Accepted standalone HTTP implementation; activation and production proof are separate.
insert into public.discovery_marketplace_workers (
  worker_id, source_key, source_name, source_type, execution_mode,
  supported_markets, supported_languages, supported_property_types,
  supported_transaction_types, supported_filters, timeout_ms, max_results, state, enabled
) values (
  'ssge-agent', 'ss-ge', 'SS.ge', 'MARKETPLACE', 'API',
  array['GE','Georgia'], array['ka'], array['APARTMENT','HOUSE','LAND','COMMERCIAL'],
  array['BUY','MONTHLY_RENT','DAILY_RENT'], array['PRICE','AREA','ROOMS','BEDROOMS','DISTRICT','FURNISHED'],
  900000, 2000, 'PROVEN', false
) on conflict (worker_id) do nothing;

insert into public.admin_settings (key,value,description)
values ('marketplace_ssge_enabled','false'::jsonb,'Allow the accepted SS.ge standalone adapter for Find Property only.')
on conflict (key) do nothing;
