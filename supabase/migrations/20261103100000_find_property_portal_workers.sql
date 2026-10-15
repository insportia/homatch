-- Find Property: five HTML portal workers on the existing official worker.
--
-- Registration only. Every row is seeded PROVEN + enabled=false and every switch
-- false, exactly as SS.ge was (20261020090000): nothing is dispatched or claimed
-- until the owner enables a portal (admin switch + registry state + the worker's
-- <PREFIX>_MARKETPLACE_ENABLED and token on Railway). No other table changes.
--
-- binebi.ge is not registered: its public pages answer with a Cloudflare
-- challenge, which HOMATCH does not bypass.

insert into public.discovery_marketplace_workers (
  worker_id, source_key, source_name, source_type, execution_mode,
  supported_markets, supported_languages, supported_property_types,
  supported_transaction_types, supported_filters, timeout_ms, max_results, max_concurrency, state, enabled
) values
  ('placege-agent', 'place-ge', 'Place.ge', 'MARKETPLACE', 'HTTP',
   array['GE','Georgia'], array['ka'], array['APARTMENT','HOUSE','LAND','COMMERCIAL'],
   array['BUY','MONTHLY_RENT','DAILY_RENT'], array['PRICE','AREA','ROOMS'], 600000, 120, 1, 'PROVEN', false),
  ('homege-agent', 'home-ge', 'Home.ge', 'MARKETPLACE', 'HTTP',
   array['GE','Georgia'], array['ka'], array['APARTMENT','HOUSE','LAND','COMMERCIAL'],
   array['BUY','MONTHLY_RENT','DAILY_RENT'], array[]::text[], 600000, 120, 1, 'PROVEN', false),
  ('brokeri-agent', 'brokeri-ge', 'Brokeri.ge', 'AGENCY', 'HTTP',
   array['GE','Georgia'], array['ka'], array['APARTMENT','HOUSE','LAND','COMMERCIAL'],
   array['BUY','MONTHLY_RENT'], array['PRICE','AREA','ROOMS'], 600000, 120, 1, 'PROVEN', false),
  ('korter-agent', 'korter-ge', 'Korter.ge', 'MARKETPLACE', 'HTTP',
   array['GE','Georgia'], array['ka'], array['APARTMENT','HOUSE','COMMERCIAL','LAND'],
   array['BUY','MONTHLY_RENT','DAILY_RENT'], array[]::text[], 600000, 120, 1, 'PROVEN', false),
  ('allhome-agent', 'allhome-ge', 'Allhome.ge', 'MARKETPLACE', 'HTTP',
   array['GE','Georgia'], array['ka'], array['APARTMENT','HOUSE','LAND','COMMERCIAL'],
   array['BUY','MONTHLY_RENT','DAILY_RENT'], array[]::text[], 600000, 120, 1, 'PROVEN', false)
on conflict (worker_id) do nothing;

insert into public.admin_settings (key, value, description) values
  ('marketplace_placege_enabled', 'false'::jsonb, 'Allow the Place.ge HTML worker for Find Property only.'),
  ('marketplace_homege_enabled',  'false'::jsonb, 'Allow the Home.ge HTML worker for Find Property only.'),
  ('marketplace_brokeri_enabled', 'false'::jsonb, 'Allow the Brokeri.ge HTML worker for Find Property only.'),
  ('marketplace_korter_enabled',  'false'::jsonb, 'Allow the Korter.ge HTML worker for Find Property only.'),
  ('marketplace_allhome_enabled', 'false'::jsonb, 'Allow the Allhome.ge HTML worker for Find Property only.')
on conflict (key) do nothing;
