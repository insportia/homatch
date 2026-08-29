-- Homatch matching pipeline security hardening
-- Version: 20260829000002
-- Target: ptxajsjhobhvsfhmutjn

create or replace function public.auth_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from public.users as u
  where u.auth_id = auth.uid()
  limit 1;
$$;

revoke all on function public.auth_user_id() from public;
revoke all on function public.auth_user_id() from anon;
grant execute on function public.auth_user_id() to authenticated;
grant execute on function public.auth_user_id() to service_role;

create or replace function public.increment_job_signals(
  p_job_id uuid,
  p_count integer
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.matching_jobs
  set signals_collected = signals_collected + p_count,
      updated_at = pg_catalog.now()
  where id = p_job_id;
$$;

revoke all on function public.increment_job_signals(uuid, integer) from public;
revoke all on function public.increment_job_signals(uuid, integer) from anon;
revoke all on function public.increment_job_signals(uuid, integer) from authenticated;
grant execute on function public.increment_job_signals(uuid, integer) to service_role;

create or replace function public.resolve_campaign_for_property(
  p_property_id uuid
)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id
  from public.matching_campaigns as c
  where c.property_id = p_property_id
  order by c.created_at desc
  limit 1;
$$;

revoke all on function public.resolve_campaign_for_property(uuid) from public;
revoke all on function public.resolve_campaign_for_property(uuid) from anon;
grant execute on function public.resolve_campaign_for_property(uuid) to authenticated;
grant execute on function public.resolve_campaign_for_property(uuid) to service_role;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public;
revoke all on function public.set_updated_at() from anon;
revoke all on function public.set_updated_at() from authenticated;

alter table public.query_packs
  drop constraint if exists query_packs_query_hash_key;

alter table public.query_packs
  drop constraint if exists qp_query_hash_unique;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.query_packs'::regclass
      and conname = 'query_packs_job_id_query_hash_key'
  ) then
    alter table public.query_packs
      add constraint query_packs_job_id_query_hash_key
      unique (job_id, query_hash);
  end if;
end
$$;
