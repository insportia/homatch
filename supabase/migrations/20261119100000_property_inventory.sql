-- HOMATCH property inventory (owner, 2026-10-19): one row per listing, every portal.
--
-- supply_observations becomes the unified inventory for the marketplace portals too. Until now
-- only the dormant supply-discovery lane (last row 2026-09-25) and paid social campaigns wrote it;
-- the free search kept each search's own copies in discovery_marketplace_listings (5,889 rows for
-- 2,513 listings on 2026-10-19) and nothing knew a listing across searches.
--
--   * ingest_channel = 'MARKETPLACE' marks rows the marketplace workers wrote. supply-matching
--     reads them only when admin_settings.supply_matching_marketplace_inventory is true (default
--     off), so buyer/tenant matching does not change until the owner decides.
--   * upsert_marketplace_inventory: one statement per worker report. A sighting moves last_seen_at;
--     it never writes last_verified_at (only revalidate-supply verifies). Facts come only from a
--     newer sighting and a missing fact never erases a known one. first_seen_at stays frozen
--     (supply_observations_freeze_first_seen). A listing recorded REMOVED that a worker sees again
--     is UNVERIFIED again. Only MARKETPLACE rows are updated: a row another lane wrote for the same
--     listing is left exactly as that lane keeps it (the upsert returns nothing for it).
--   * allhome-ge joins source_registry (every other marketplace source is already there).
--   * Pool index: the shared listing pool reads one source's newest observations
--     (marketplaceSearch.ts serveCachedListings); it was a sequential scan.
--   * The backfill and the revalidate-supply schedule are 20261119100100, applied only after
--     supply-matching (which skips MARKETPLACE rows) is deployed: no window in which the old
--     matcher could read portal listings.

alter table public.supply_observations
  add column if not exists ingest_channel text,
  add column if not exists latitude numeric,
  add column if not exists longitude numeric,
  add column if not exists building_status text,
  add column if not exists renovation_status text,
  add column if not exists amenities text[] not null default '{}',
  add column if not exists snapshot_object_key text;

alter table public.supply_observations
  add constraint supply_observations_ingest_channel_check check (ingest_channel is null or ingest_channel = 'MARKETPLACE');

comment on column public.supply_observations.ingest_channel is 'MARKETPLACE: written by the marketplace workers (upsert_marketplace_inventory). NULL: supply-discovery, community and campaign lanes.';
comment on column public.supply_observations.snapshot_object_key is 'R2 key (storage_objects.object_key) of the newest content snapshot of this listing; never a URL.';

create index if not exists supply_observations_inventory_idx
  on public.supply_observations (adapter_id, last_seen_at desc) where ingest_channel = 'MARKETPLACE';
create index if not exists discovery_marketplace_listings_pool_idx
  on public.discovery_marketplace_listings (source_key, observed_at desc);

insert into public.source_registry (platform, source_type, name, url, country_code, active, access_state, access_finding,
  source_family, priority_tier, lifecycle, adapter_id, description)
select 'WEBSITE', 'WEBSITE', 'allhome.ge', 'https://allhome.ge', 'GE', true, 'PUBLIC', 'PUBLIC_HTML',
  'PROPERTY_PORTAL', 0, 'LIVE_TESTED', 'allhome-ge', 'Marketplace worker (allhome-agent): public sitemap + listing pages.'
where not exists (select 1 from public.source_registry where adapter_id = 'allhome-ge');

create or replace function public.upsert_marketplace_inventory(p_source_key text, p_rows jsonb)
returns table (observation_id uuid, external_id text, outcome text, first_seen_at timestamptz)
language plpgsql
set search_path = public
as $$
#variable_conflict use_column
declare
  v_source uuid;
begin
  select r.id into v_source from public.source_registry r
   where r.adapter_id = p_source_key order by r.created_at limit 1;
  if v_source is null then raise exception 'unknown inventory source: %', p_source_key; end if;
  return query
  with input as (
    select * from jsonb_to_recordset(p_rows) as x(external_id text, canonical_url text, transaction text, property_type text, country_code text, city text, district text, sale_amount numeric, sale_currency text, rent_amount numeric, rent_currency text, rent_period text, area_sqm numeric, rooms int, bedrooms int, floor int, total_floors int, year_built int, title text, description text, published_at timestamptz, latitude numeric, longitude numeric, building_status text, renovation_status text, parser_version text, adapter_version text, observed_at timestamptz, expires_at timestamptz, content_fingerprint text, image_urls text[], amenities text[])
  ), d as (
    select distinct on (i.external_id) i.* from input i
     where i.external_id is not null and i.observed_at is not null order by i.external_id, i.observed_at desc
  ), prior as (
    select o.external_id, o.content_fingerprint from public.supply_observations o
     where o.source_id = v_source and o.external_id in (select d.external_id from d)
  ), up as (
    insert into public.supply_observations as o (source_id, adapter_id, external_id, canonical_url, transaction, property_type, country_code, city, district, sale_amount, sale_currency, rent_amount, rent_currency, rent_period, area_sqm, rooms, bedrooms, floor, total_floors, year_built, title, description, published_at, latitude, longitude, building_status, renovation_status, parser_version, adapter_version, content_fingerprint, image_urls, amenities, first_seen_at, last_seen_at, content_changed_at, expires_at, validation_state, ingest_channel)
    select v_source, p_source_key, d.external_id, d.canonical_url, d.transaction, d.property_type, d.country_code, d.city, d.district, d.sale_amount, d.sale_currency, d.rent_amount, d.rent_currency, d.rent_period, d.area_sqm, d.rooms, d.bedrooms, d.floor, d.total_floors, d.year_built, d.title, d.description, d.published_at, d.latitude, d.longitude, d.building_status, d.renovation_status, d.parser_version, d.adapter_version, d.content_fingerprint, coalesce(d.image_urls, '{}'), coalesce(d.amenities, '{}'), d.observed_at, d.observed_at, d.observed_at, d.expires_at, 'UNVERIFIED', 'MARKETPLACE'
      from d
    on conflict (source_id, external_id) do update set
        canonical_url = case when (excluded.last_seen_at >= o.last_seen_at) then coalesce(excluded.canonical_url, o.canonical_url) else o.canonical_url end,
        transaction = case when (excluded.last_seen_at >= o.last_seen_at) then coalesce(excluded.transaction, o.transaction) else o.transaction end,
        property_type = case when (excluded.last_seen_at >= o.last_seen_at) then coalesce(excluded.property_type, o.property_type) else o.property_type end,
        country_code = case when (excluded.last_seen_at >= o.last_seen_at) then coalesce(excluded.country_code, o.country_code) else o.country_code end,
        city = case when (excluded.last_seen_at >= o.last_seen_at) then coalesce(excluded.city, o.city) else o.city end,
        district = case when (excluded.last_seen_at >= o.last_seen_at) then coalesce(excluded.district, o.district) else o.district end,
        sale_amount = case when (excluded.last_seen_at >= o.last_seen_at) then coalesce(excluded.sale_amount, o.sale_amount) else o.sale_amount end,
        sale_currency = case when (excluded.last_seen_at >= o.last_seen_at) then coalesce(excluded.sale_currency, o.sale_currency) else o.sale_currency end,
        rent_amount = case when (excluded.last_seen_at >= o.last_seen_at) then coalesce(excluded.rent_amount, o.rent_amount) else o.rent_amount end,
        rent_currency = case when (excluded.last_seen_at >= o.last_seen_at) then coalesce(excluded.rent_currency, o.rent_currency) else o.rent_currency end,
        rent_period = case when (excluded.last_seen_at >= o.last_seen_at) then coalesce(excluded.rent_period, o.rent_period) else o.rent_period end,
        area_sqm = case when (excluded.last_seen_at >= o.last_seen_at) then coalesce(excluded.area_sqm, o.area_sqm) else o.area_sqm end,
        rooms = case when (excluded.last_seen_at >= o.last_seen_at) then coalesce(excluded.rooms, o.rooms) else o.rooms end,
        bedrooms = case when (excluded.last_seen_at >= o.last_seen_at) then coalesce(excluded.bedrooms, o.bedrooms) else o.bedrooms end,
        floor = case when (excluded.last_seen_at >= o.last_seen_at) then coalesce(excluded.floor, o.floor) else o.floor end,
        total_floors = case when (excluded.last_seen_at >= o.last_seen_at) then coalesce(excluded.total_floors, o.total_floors) else o.total_floors end,
        year_built = case when (excluded.last_seen_at >= o.last_seen_at) then coalesce(excluded.year_built, o.year_built) else o.year_built end,
        title = case when (excluded.last_seen_at >= o.last_seen_at) then coalesce(excluded.title, o.title) else o.title end,
        description = case when (excluded.last_seen_at >= o.last_seen_at) then coalesce(excluded.description, o.description) else o.description end,
        published_at = case when (excluded.last_seen_at >= o.last_seen_at) then coalesce(excluded.published_at, o.published_at) else o.published_at end,
        latitude = case when (excluded.last_seen_at >= o.last_seen_at) then coalesce(excluded.latitude, o.latitude) else o.latitude end,
        longitude = case when (excluded.last_seen_at >= o.last_seen_at) then coalesce(excluded.longitude, o.longitude) else o.longitude end,
        building_status = case when (excluded.last_seen_at >= o.last_seen_at) then coalesce(excluded.building_status, o.building_status) else o.building_status end,
        renovation_status = case when (excluded.last_seen_at >= o.last_seen_at) then coalesce(excluded.renovation_status, o.renovation_status) else o.renovation_status end,
        parser_version = case when (excluded.last_seen_at >= o.last_seen_at) then coalesce(excluded.parser_version, o.parser_version) else o.parser_version end,
        adapter_version = case when (excluded.last_seen_at >= o.last_seen_at) then coalesce(excluded.adapter_version, o.adapter_version) else o.adapter_version end,
        content_fingerprint = case when (excluded.last_seen_at >= o.last_seen_at) then excluded.content_fingerprint else o.content_fingerprint end,
        content_changed_at = case when (excluded.last_seen_at >= o.last_seen_at) and o.content_fingerprint not like 'backfill-v1:%' and o.content_fingerprint is distinct from excluded.content_fingerprint then excluded.last_seen_at else o.content_changed_at end,
        image_urls = case when (excluded.last_seen_at >= o.last_seen_at) and cardinality(excluded.image_urls) > 0 then excluded.image_urls else o.image_urls end,
        amenities = case when (excluded.last_seen_at >= o.last_seen_at) and cardinality(excluded.amenities) > 0 then excluded.amenities else o.amenities end,
        last_seen_at = greatest(o.last_seen_at, excluded.last_seen_at),
        expires_at = greatest(o.expires_at, excluded.expires_at),
        validation_state = case when (excluded.last_seen_at >= o.last_seen_at) and o.validation_state = 'REMOVED' then 'UNVERIFIED' else o.validation_state end,
        last_verified_at = case when (excluded.last_seen_at >= o.last_seen_at) and o.validation_state = 'REMOVED' then null else o.last_verified_at end,
        updated_at = now()
      where o.ingest_channel = 'MARKETPLACE'
    returning o.id, o.external_id, o.first_seen_at, o.content_fingerprint
  )
  select up.id, up.external_id,
         case when p.external_id is null then 'INSERTED'
              when p.content_fingerprint like 'backfill-v1:%' then 'FIRST_SNAPSHOT'
              when p.content_fingerprint is distinct from up.content_fingerprint then 'CHANGED'
              else 'SEEN' end,
         up.first_seen_at
    from up left join prior p on p.external_id = up.external_id;
end $$;

revoke all on function public.upsert_marketplace_inventory(text, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_marketplace_inventory(text, jsonb) to service_role;

-- Per source and state, for Admin and the release report. One state per row, exactly as
-- research-core/marketplace/inventory.ts inventoryFreshness() decides it. Reads through the caller's RLS.
create or replace view public.property_inventory_status with (security_invoker = true) as
with s as (
  select o.adapter_id, o.snapshot_object_key, o.last_seen_at, o.last_verified_at,
         case
           when o.validation_state = 'REMOVED' then 'REMOVED'
           when o.validation_state in ('INVALID', 'UNVERIFIABLE')
             then case when o.last_seen_at >= now() - interval '72 hours' then 'RECENTLY_OBSERVED' else 'UNAVAILABLE' end
           when o.validation_state = 'VALID'
            and o.last_verified_at >= now() - case when o.transaction = 'SALE' then interval '7 days' else interval '3 days' end
             then 'VERIFIED_ACTIVE'
           when o.last_seen_at is null then 'UNVERIFIED'
           when o.last_seen_at >= now() - interval '72 hours' then 'RECENTLY_OBSERVED'
           else 'STALE'
         end as state
    from public.supply_observations o
   where o.ingest_channel = 'MARKETPLACE'
)
select s.adapter_id,
       count(*) as listings,
       count(*) filter (where s.state = 'VERIFIED_ACTIVE') as verified_active,
       count(*) filter (where s.state = 'RECENTLY_OBSERVED') as recently_observed,
       count(*) filter (where s.state = 'STALE') as stale,
       count(*) filter (where s.state = 'UNVERIFIED') as unverified,
       count(*) filter (where s.state = 'UNAVAILABLE') as unavailable,
       count(*) filter (where s.state = 'REMOVED') as removed,
       count(*) filter (where s.snapshot_object_key is not null) as with_snapshot,
       max(s.last_seen_at) as last_seen_at,
       max(s.last_verified_at) as last_verified_at
  from s
 group by s.adapter_id;

revoke all on public.property_inventory_status from anon, authenticated;
grant select on public.property_inventory_status to service_role;
