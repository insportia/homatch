-- Exhaustive native matching: durable checkpoints and a leased property queue.
--
-- supply-matching used to compare each demand with at most 500 properties and each
-- changed property with at most 600 searches, then retire every match outside that
-- window. It now scans everything in id order, page by page, and when an invocation
-- runs out of time it stores where it stopped and the next tick resumes there.
-- Matches are retired only after a COMPLETE pass, by "not re-confirmed since the
-- pass started" (upsert_native_match stamps updated_at on every confirmation).
--
-- Additive only: new table, new queue columns (nullable / defaulted), new functions.
-- native_match_claim_properties keeps working for edge code that predates this.
-- Rollback: redeploy the previous supply-matching; the new objects are inert.

create table if not exists public.match_scan_checkpoints (
  scan_key        text primary key check (scan_key ~ '^(sweep:native|sweep:all|demand:[0-9a-f-]{36})$'),
  demand_cursor   text,
  phase           text check (phase is null or phase in ('EXTERNAL', 'NATIVE')),
  supply_cursor   text,
  scan_started_at timestamptz,
  status          text not null default 'RUNNING' check (status in ('RUNNING', 'COMPLETE')),
  pages           bigint not null default 0 check (pages >= 0),
  rows_examined   bigint not null default 0 check (rows_examined >= 0),
  passes          integer not null default 0 check (passes >= 0),
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  completed_at    timestamptz
);
comment on table public.match_scan_checkpoints is
  'supply-matching resume points: sweep:native walks every active search, sweep:all every demand with a city; demand:<id> finishes one targeted demand that ran out of time. Service role only.';
alter table public.match_scan_checkpoints enable row level security;
revoke all on public.match_scan_checkpoints from public, anon, authenticated;
grant select, insert, update, delete on public.match_scan_checkpoints to service_role;
create index if not exists match_scan_checkpoints_running_idx
  on public.match_scan_checkpoints (updated_at) where status = 'RUNNING';

/* The queue keeps a row until its property was matched against ALL active demand. */
alter table public.native_match_property_queue
  add column if not exists leased_until    timestamptz,
  add column if not exists attempts        integer not null default 0,
  add column if not exists demand_cursor   text,
  add column if not exists scan_started_at timestamptz,
  add column if not exists last_error      text;

/* A property that changes again while queued restarts its pass from the beginning. */
create or replace function public.native_match_queue_reset()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.enqueued_at is distinct from old.enqueued_at then
    new.demand_cursor := null;
    new.scan_started_at := null;
    new.attempts := 0;
    new.last_error := null;
  end if;
  return new;
end $$;
drop trigger if exists native_match_queue_reset on public.native_match_property_queue;
create trigger native_match_queue_reset before update on public.native_match_property_queue
  for each row execute function public.native_match_queue_reset();

/* Claim with a lease instead of deleting: a crashed or timed-out run is retried. */
create or replace function public.native_match_lease_properties(p_limit integer default 25, p_lease_seconds integer default 180)
returns table (property_id uuid, enqueued_at timestamptz, demand_cursor text, scan_started_at timestamptz, attempts integer)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with picked as (
    select q.property_id from public.native_match_property_queue q
     where q.leased_until is null or q.leased_until < now()
     order by q.enqueued_at
     limit greatest(1, least(coalesce(p_limit, 25), 200))
     for update skip locked
  )
  update public.native_match_property_queue q
     set leased_until = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 180), 900))),
         attempts = q.attempts + 1
    from picked where q.property_id = picked.property_id
  returning q.property_id, q.enqueued_at, q.demand_cursor, q.scan_started_at, q.attempts;
end $$;
revoke all on function public.native_match_lease_properties(integer, integer) from public, anon, authenticated;
grant execute on function public.native_match_lease_properties(integer, integer) to service_role;

/* Done: remove the row only if the property did not change again meanwhile. */
create or replace function public.native_match_complete_properties(p_items jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  delete from public.native_match_property_queue q
   using jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as i(property_id uuid, enqueued_at timestamptz)
   where q.property_id = i.property_id and q.enqueued_at = i.enqueued_at;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.native_match_complete_properties(jsonb) from public, anon, authenticated;
grant execute on function public.native_match_complete_properties(jsonb) to service_role;

/* Out of time or failed: keep the row, store where the pass stopped, back off on errors. */
create or replace function public.native_match_checkpoint_properties(
  p_items jsonb, p_demand_cursor text, p_scan_started_at timestamptz, p_error text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  update public.native_match_property_queue q
     set demand_cursor = p_demand_cursor,
         scan_started_at = p_scan_started_at,
         last_error = left(p_error, 500),
         attempts = case when p_error is null then 0 else q.attempts end,
         leased_until = case when p_error is null then null
                             else now() + make_interval(mins => least(greatest(q.attempts, 1), 30)) end
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as i(property_id uuid, enqueued_at timestamptz)
   where q.property_id = i.property_id and q.enqueued_at = i.enqueued_at;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.native_match_checkpoint_properties(jsonb, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.native_match_checkpoint_properties(jsonb, text, timestamptz, text) to service_role;

/*
 * Retire after a complete pass: a COMPATIBLE native match of this demand that was not
 * re-confirmed since the pass started no longer fits. p_property_ids limits it to the
 * properties the pass judged (a property-scoped pass leaves every other match alone).
 */
create or replace function public.retire_native_matches_unconfirmed(
  p_intent_profile_id uuid, p_scan_started_at timestamptz, p_property_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if p_scan_started_at is null then raise exception 'SCAN_START_REQUIRED'; end if;
  update public.supply_matches
     set compatibility = 'INCOMPATIBLE', updated_at = now()
   where intent_profile_id = p_intent_profile_id
     and source_kind = 'INTERNAL_HOMATCH'
     and compatibility = 'COMPATIBLE'
     and updated_at < p_scan_started_at
     and (p_property_ids is null or property_id = any (p_property_ids));
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.retire_native_matches_unconfirmed(uuid, timestamptz, uuid[]) from public, anon, authenticated;
grant execute on function public.retire_native_matches_unconfirmed(uuid, timestamptz, uuid[]) to service_role;

/* A property-scoped pass judged exactly these listings for this demand and they no longer fit. */
create or replace function public.retire_native_matches_for_properties(p_intent_profile_id uuid, p_property_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  update public.supply_matches
     set compatibility = 'INCOMPATIBLE', updated_at = now()
   where intent_profile_id = p_intent_profile_id
     and source_kind = 'INTERNAL_HOMATCH'
     and compatibility = 'COMPATIBLE'
     and property_id = any (coalesce(p_property_ids, '{}'));
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.retire_native_matches_for_properties(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.retire_native_matches_for_properties(uuid, uuid[]) to service_role;

/* Indexed keyset walks: active searches by intent, matchable properties by id. */
create index if not exists active_search_subscriptions_active_intent_idx
  on public.active_search_subscriptions (intent_id) where is_active and intent_id is not null;
create index if not exists properties_native_matchable_idx
  on public.properties (id) where is_deleted = false and archived_at is null and matching_status = 'ACTIVE';
create index if not exists supply_matches_native_retire_idx
  on public.supply_matches (intent_profile_id, updated_at)
  where source_kind = 'INTERNAL_HOMATCH' and compatibility = 'COMPATIBLE';
