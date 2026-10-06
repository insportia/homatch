-- MyHome Find Property acquisition only. Credentials and activation are runtime
-- configuration after the reviewed release; this migration never stores tokens.
insert into public.discovery_marketplace_workers (
  worker_id, source_key, source_name, source_type, execution_mode,
  supported_markets, supported_languages, supported_property_types,
  supported_transaction_types, supported_filters, timeout_ms, max_results,
  state, enabled
) values (
  'myhome-agent', 'myhome-ge', 'MyHome', 'MARKETPLACE', 'API',
  array['GE','Georgia'], array['ka','en','ru'], array['APARTMENT','HOUSE','LAND','COMMERCIAL'],
  array['BUY','MONTHLY_RENT','DAILY_RENT'],
  array['PRICE','AREA','ROOMS','BEDROOMS','BATHROOMS','DISTRICT','BUILDING_STATUS','RENOVATION','FURNISHED','PARKING','FLOOR'],
  900000, 2000, 'PROVEN', false
) on conflict (worker_id) do update set
  source_key = excluded.source_key, source_name = excluded.source_name,
  execution_mode = excluded.execution_mode, supported_markets = excluded.supported_markets,
  supported_languages = excluded.supported_languages,
  supported_property_types = excluded.supported_property_types,
  supported_transaction_types = excluded.supported_transaction_types,
  supported_filters = excluded.supported_filters, timeout_ms = excluded.timeout_ms,
  max_results = excluded.max_results, updated_at = now();

-- Reuse the audited MyHome source instead of creating a duplicate. Find Buyers
-- compatibility/provider/cursors remain unchanged. LIVE_TESTED is not PRODUCTIVE.
update public.source_registry set adapter_id = 'myhome-ge',
  access_finding = 'API_AVAILABLE', lifecycle = 'LIVE_TESTED',
  lifecycle_changed_at = now(), updated_at = now()
where url in ('https://myhome.ge','https://www.myhome.ge','https://myhome.ge/','https://www.myhome.ge/');

-- This allows MyHome marketplace execution independently of the global provider
-- kill switch. Other providers and Find Buyers keep their existing switch.
insert into public.admin_settings (key,value,description)
values ('marketplace_myhome_enabled','false'::jsonb,'Allow the verified MyHome API adapter for Find Property only.')
on conflict (key) do nothing;
