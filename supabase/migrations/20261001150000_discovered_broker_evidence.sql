-- /brokers — EVIDENCE FOR A DISCOVERED FIRM.
--
-- A firm in a customer's discovery library is market intelligence, never a
-- registered HOMATCH professional. What makes it trustworthy is where it was
-- seen, so the card links to those pages. This returns them, and only:
--
--   * for firms already in the CALLER's own library (user_broker_discoveries),
--     so no one can enumerate another customer's research or the global
--     broker_intelligence table by id;
--   * http(s) URLs only — anything else is dropped, never rendered as a link;
--   * at most three per firm, most recently seen first.

create or replace function public.list_my_discovered_broker_evidence(p_broker_ids uuid[])
returns table (broker_id uuid, url text, last_seen_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid uuid := public.auth_user_id();
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  return query
    select e.broker_id, e.canonical_url, e.last_seen_at
      from (
        select s.broker_id, s.canonical_url, max(s.last_seen_at) as last_seen_at,
               row_number() over (partition by s.broker_id order by max(s.last_seen_at) desc) as rn
          from public.broker_intelligence_sources s
          join public.user_broker_discoveries d
            on d.broker_id = s.broker_id and d.user_id = v_uid
         where s.broker_id = any ((coalesce(p_broker_ids, '{}'::uuid[]))[1:200])
           and s.canonical_url ~ '^https?://[^\s<>"'']+$'
         group by s.broker_id, s.canonical_url
      ) e
     where e.rn <= 3
     order by e.broker_id, e.last_seen_at desc;
end $$;

revoke all on function public.list_my_discovered_broker_evidence(uuid[]) from public, anon;
grant execute on function public.list_my_discovered_broker_evidence(uuid[]) to authenticated;

comment on function public.list_my_discovered_broker_evidence(uuid[]) is
  'Up to three http(s) pages where each firm in the caller''s own discovery library was seen. Evidence, not registration.';
