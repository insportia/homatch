-- IS HOMATCH A DISCOVERY NETWORK, OR ONE SOURCE WITH SEVEN DECORATIONS?
--
-- supply_observations is service-only -- anon and authenticated have no grant
-- on it, deliberately, because it is the intelligence customers pay for. So
-- an admin screen cannot read it directly and the concentration question has
-- been answerable only by someone with the service key.
--
-- This is the same SECURITY DEFINER + is_admin shape the other admin
-- functions use. It returns counts and nothing else: no thresholds, no
-- verdicts, no advice. A screen can decide that 0.9 is alarming, where a
-- person can see the number it decided from.
--
-- THERE IS NO COVERAGE PERCENTAGE HERE, and there cannot be one: nobody
-- knows how many properties are for sale in Tbilisi. share_of_held is named
-- so it cannot be misread as a share of a market.

create or replace function public.admin_source_concentration()
returns table (
  adapter_id text,
  source_family text,
  lifecycle text,
  active boolean,
  observations bigint,
  share_of_held numeric,
  with_price bigint,
  with_area bigint,
  cities bigint,
  entities_touched bigint,
  -- Entities NO other source reached. The answer to "what would we lose by
  -- dropping this source", and the only figure here that separates a source
  -- adding intelligence from one adding rows.
  incremental_unique_entities bigint,
  avg_quality numeric,
  last_successful_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.users u
    where u.auth_id = (select auth.uid()) and u.is_admin = true
  ) then
    raise exception 'admin only';
  end if;

  return query
  with obs as (
    select o.adapter_id, o.entity_id, o.city,
           (o.sale_amount is not null or o.rent_amount is not null) as priced,
           (o.area_sqm is not null) as measured,
           coalesce(o.structured_quality, 0) as quality
    from public.supply_observations o
    where o.adapter_id is not null
  ),
  total as (select count(*)::numeric as n from obs),
  -- How many DISTINCT sources reached each entity, so "unique" is a real count.
  entity_reach as (
    select o.entity_id, count(distinct o.adapter_id) as sources
    from obs o where o.entity_id is not null group by o.entity_id
  )
  select
    o.adapter_id::text,
    max(r.source_family)::text,
    max(r.lifecycle)::text,
    bool_or(r.active),
    count(*)::bigint,
    round(count(*)::numeric / nullif((select n from total), 0), 4),
    count(*) filter (where o.priced)::bigint,
    count(*) filter (where o.measured)::bigint,
    count(distinct o.city)::bigint,
    count(distinct o.entity_id) filter (where o.entity_id is not null)::bigint,
    count(distinct o.entity_id) filter (
      where o.entity_id is not null
        and (select er.sources from entity_reach er where er.entity_id = o.entity_id) = 1
    )::bigint,
    round(avg(o.quality), 3),
    max(r.last_successful_at)
  from obs o
  left join public.source_registry r on r.adapter_id = o.adapter_id
  group by o.adapter_id
  order by count(*) desc;
end;
$$;

comment on function public.admin_source_concentration is
  'Per-source supply concentration for the admin area. share_of_held is a '
  'share of the observations Homatch holds, never of a market -- nobody knows '
  'how many properties are for sale, and a coverage percentage would need '
  'that denominator. incremental_unique_entities is what a source would take '
  'with it if it were dropped.';

revoke all on function public.admin_source_concentration() from public, anon;
grant execute on function public.admin_source_concentration() to authenticated;
