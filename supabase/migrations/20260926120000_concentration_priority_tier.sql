-- WHICH OF THESE SOURCES THE BUSINESS ACTUALLY DEPENDS ON.
--
-- admin_source_concentration answers "how much of what we hold came from
-- here", which is a measurement. It said nothing about whether anybody had
-- decided the source was worth a customer's budget, so an operator reading
-- the page could see that a developer site contributed 6.7% of observations
-- and had no way to tell that it is a P2 while ss.ge beside it is a P0.
--
-- priority_tier is now the axis the entitlement planner gates on -- a FREE
-- plan reaches P0 only, VIP reaches P1 -- so a source's tier decides who can
-- see it at all. That belongs on the screen next to its yield.
--
-- Adds one column. The admin-only guard, the pinned search_path and every
-- existing column are unchanged.
--
-- THE GRANTS HAVE TO BE RESTATED, and that is not tidiness. Changing the
-- return type means DROP then CREATE, and a freshly created function gets
-- PostgreSQL's default ACL: EXECUTE to PUBLIC, which includes anon. Applying
-- this migration without the revokes below widened the grant from
-- {postgres, authenticated, service_role} to {PUBLIC, anon, ...} — caught by
-- reading proacl afterwards. The guard inside still refused them, so nothing
-- leaked, but an anonymous role should not reach an admin function at all.

drop function if exists public.admin_source_concentration();

create or replace function public.admin_source_concentration()
returns table(
  adapter_id text, source_family text, lifecycle text, active boolean,
  priority_tier smallint,
  observations bigint, share_of_held numeric, with_price bigint,
  with_area bigint, cities bigint, entities_touched bigint,
  incremental_unique_entities bigint, avg_quality numeric,
  last_successful_at timestamp with time zone
)
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  entity_reach as (
    select o.entity_id, count(distinct o.adapter_id) as sources
    from obs o where o.entity_id is not null group by o.entity_id
  )
  select
    o.adapter_id::text,
    max(r.source_family)::text,
    max(r.lifecycle)::text,
    bool_or(r.active),
    max(r.priority_tier)::smallint,
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
  -- Importance first, then volume: the page is for deciding what to keep.
  order by max(r.priority_tier) nulls last, count(*) desc;
end;
$function$;

-- The ACL this function had before the rewrite, restated exactly.
revoke execute on function public.admin_source_concentration() from public;
revoke execute on function public.admin_source_concentration() from anon;
grant execute on function public.admin_source_concentration() to authenticated, service_role;
