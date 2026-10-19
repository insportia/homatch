-- HOMATCH property inventory, part 2 (owner, 2026-10-19): backfill + freshness schedule.
--
-- RELEASE ORDER: after 20261119100000 AND after the supply-matching edge deploy that skips
-- ingest_channel = 'MARKETPLACE' rows (otherwise the deployed matcher would read them).

-- Backfill: every listing the shared pool already holds (discovery_marketplace_listings), once,
-- with its first and last HOMATCH sighting. content_fingerprint (NOT NULL) holds a marker,
-- 'backfill-v1:<source>:<listing id>', unique per row so text dedupe never pairs two backfilled rows;
-- the first worker sighting replaces it and writes the first snapshot (FIRST_SNAPSHOT) without
-- calling it a change. Rows another lane already wrote are left as they are.
with latest as (
  select distinct on (l.source_key, l.source_listing_id) l.source_key, l.source_listing_id, l.exact_url, l.raw,
         min(l.observed_at) over (partition by l.source_key, l.source_listing_id) as first_seen,
         max(l.observed_at) over (partition by l.source_key, l.source_listing_id) as last_seen
    from public.discovery_marketplace_listings l
   where l.observed_at is not null and l.source_listing_id is not null
     and coalesce(l.raw->'retrievalMetadata'->>'observationLevel', '') <> 'CACHED'
   order by l.source_key, l.source_listing_id, l.observed_at desc
), mapped as (
  select r.id as source_id, x.source_key, x.source_listing_id, x.first_seen, x.last_seen, x.raw,
         coalesce(nullif(x.raw->>'canonicalUrl', ''), x.exact_url) as canonical_url,
         case x.raw->>'transactionType' when 'BUY' then 'SALE' when 'MONTHLY_RENT' then 'RENT' when 'DAILY_RENT' then 'SHORT_STAY' end as tx
    from latest x
    join lateral (select sr.id from public.source_registry sr where sr.adapter_id = x.source_key order by sr.created_at limit 1) r on true
)
insert into public.supply_observations (source_id, adapter_id, external_id, canonical_url, transaction, property_type, country_code,
  city, district, sale_amount, sale_currency, rent_amount, rent_currency, rent_period, area_sqm, rooms, bedrooms, floor, total_floors,
  year_built, title, description, published_at, latitude, longitude, building_status, renovation_status, image_urls, amenities,
  content_fingerprint, first_seen_at, last_seen_at, expires_at, validation_state, ingest_channel, parser_version, adapter_version)
select l.source_id, l.source_key, l.source_listing_id, l.canonical_url, l.tx, nullif(l.raw->>'propertyType', ''),
  case when upper(l.raw->>'country') ~ '^[A-Z]{2}$' then upper(l.raw->>'country') else 'GE' end,
  nullif(left(btrim(l.raw->>'city'), 120), ''), nullif(left(btrim(l.raw->>'district'), 160), ''),
  case when l.tx = 'SALE' then case when jsonb_typeof(l.raw->'price') = 'number' then (l.raw->>'price')::numeric end end,
  case when l.tx = 'SALE' and case when jsonb_typeof(l.raw->'price') = 'number' then (l.raw->>'price')::numeric end is not null then nullif(left(btrim(l.raw->>'currency'), 8), '') end,
  case when l.tx in ('RENT', 'SHORT_STAY') then case when jsonb_typeof(l.raw->'price') = 'number' then (l.raw->>'price')::numeric end end,
  case when l.tx in ('RENT', 'SHORT_STAY') and case when jsonb_typeof(l.raw->'price') = 'number' then (l.raw->>'price')::numeric end is not null then nullif(left(btrim(l.raw->>'currency'), 8), '') end,
  case l.tx when 'RENT' then 'MONTH' when 'SHORT_STAY' then 'DAY' end,
  case when jsonb_typeof(l.raw->'areaSqm') = 'number' then (l.raw->>'areaSqm')::numeric end, case when jsonb_typeof(l.raw->'rooms') = 'number' and (l.raw->>'rooms')::numeric between -1000 and 3000 then round((l.raw->>'rooms')::numeric)::int end, case when jsonb_typeof(l.raw->'bedrooms') = 'number' and (l.raw->>'bedrooms')::numeric between -1000 and 3000 then round((l.raw->>'bedrooms')::numeric)::int end, case when jsonb_typeof(l.raw->'floor') = 'number' and (l.raw->>'floor')::numeric between -1000 and 3000 then round((l.raw->>'floor')::numeric)::int end, case when jsonb_typeof(l.raw->'totalFloors') = 'number' and (l.raw->>'totalFloors')::numeric between -1000 and 3000 then round((l.raw->>'totalFloors')::numeric)::int end, case when jsonb_typeof(l.raw->'constructionYear') = 'number' and (l.raw->>'constructionYear')::numeric between -1000 and 3000 then round((l.raw->>'constructionYear')::numeric)::int end,
  nullif(left(btrim(l.raw->>'title'), 500), ''), nullif(left(btrim(l.raw->>'description'), 8000), ''),
  case when pg_input_is_valid(l.raw->>'publishedAt', 'timestamptz') then (l.raw->>'publishedAt')::timestamptz end,
  case when case when jsonb_typeof(l.raw->'latitude') = 'number' then (l.raw->>'latitude')::numeric end between -90 and 90 and case when jsonb_typeof(l.raw->'latitude') = 'number' then (l.raw->>'latitude')::numeric end <> 0 then case when jsonb_typeof(l.raw->'latitude') = 'number' then (l.raw->>'latitude')::numeric end end,
  case when case when jsonb_typeof(l.raw->'longitude') = 'number' then (l.raw->>'longitude')::numeric end between -180 and 180 and case when jsonb_typeof(l.raw->'longitude') = 'number' then (l.raw->>'longitude')::numeric end <> 0 then case when jsonb_typeof(l.raw->'longitude') = 'number' then (l.raw->>'longitude')::numeric end end,
  nullif(left(btrim(l.raw->>'buildingStatus'), 40), ''), nullif(left(btrim(l.raw->>'renovationStatus'), 40), ''),
  coalesce(array(select u from jsonb_array_elements_text(case when jsonb_typeof(l.raw->'images') = 'array' then l.raw->'images' else '[]'::jsonb end) u where u like 'https://%' limit 20), '{}'),
  coalesce(array(select a from jsonb_array_elements_text(case when jsonb_typeof(l.raw->'amenities') = 'array' then l.raw->'amenities' else '[]'::jsonb end) a limit 40), '{}'),
  'backfill-v1:' || l.source_key || ':' || l.source_listing_id,
  l.first_seen, l.last_seen, l.last_seen + case when l.tx = 'SALE' then interval '7 days' else interval '3 days' end,
  'UNVERIFIED', 'MARKETPLACE', 'marketplace-worker-1', nullif(left(l.raw->'retrievalMetadata'->>'acquisition', 80), '')
  from mapped l
on conflict (source_id, external_id) do nothing;

-- Freshness: revalidate-supply has had no schedule since it was written. Hourly, bounded by the
-- function (SUPPLY_REVALIDATION_POLICY.MAX_PER_RUN = 25), worker-only sources excluded there.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'homatch-revalidate-supply') then
    perform cron.unschedule('homatch-revalidate-supply');
  end if;
  if not exists (select 1 from public.admin_settings
                  where key = 'revalidation_worker_token' and length(coalesce(value #>> '{}', '')) >= 16) then
    raise notice 'revalidation_worker_token missing: homatch-revalidate-supply not scheduled';
    return;
  end if;
  perform cron.schedule('homatch-revalidate-supply', '41 * * * *', $cron$
    select net.http_post(
      url := 'https://ptxajsjhobhvsfhmutjn.supabase.co/functions/v1/revalidate-supply',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-cron-token', (select value #>> '{}' from public.admin_settings where key = 'revalidation_worker_token')),
      body := '{"limit":25}'::jsonb,
      timeout_milliseconds := 55000);
  $cron$);
end $$;
