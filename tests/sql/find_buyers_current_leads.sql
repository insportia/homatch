-- FIND BUYERS: the 30-day rule at read time and one active search per
-- property (20261017090000). Run after find_buyers_lifecycle.sql, with every
-- earlier test job closed (find_buyers_current_leads_fixture.sql).
\set ON_ERROR_STOP on

-- ── ONE ACTIVE SEARCH PER PROPERTY ──────────────────────────────────────────
insert into public.matching_jobs (id, user_id, property_id, idempotency_key, status)
values ('00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'race-1', 'queued');
do $$
declare v_status text;
begin
  -- a second start for the same property, with a different request id, in every active state
  foreach v_status in array array['queued','analysing_property','generating_queries','searching_sources','collecting_results',
                                  'normalizing','deduplicating','classifying','ranking','paused'] loop
    update public.matching_jobs set status = v_status::public.matching_job_status where id = '00000000-0000-0000-0000-0000000001a1';
    begin
      insert into public.matching_jobs (user_id, property_id, idempotency_key, status)
      values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'race-2', 'queued');
      raise exception 'a second active search was accepted while the first is %', v_status;
    exception when unique_violation then null;
    end;
  end loop;
  -- the same request id replayed is refused too (request-level idempotency)
  begin
    insert into public.matching_jobs (user_id, property_id, idempotency_key, status)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'race-1', 'queued');
    raise exception 'a replayed request id was accepted';
  exception when unique_violation then null;
  end;
  -- finished searches never block the next one
  foreach v_status in array array['completed','partially_completed','failed','cancelled','budget_reached'] loop
    update public.matching_jobs set status = v_status::public.matching_job_status where property_id = '00000000-0000-0000-0000-0000000000b1';
    insert into public.matching_jobs (user_id, property_id, idempotency_key, status)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'after-' || v_status, 'queued');
  end loop;
  assert (select count(*) from public.matching_jobs where property_id = '00000000-0000-0000-0000-0000000000b1'
           and status not in ('completed','partially_completed','failed','cancelled','budget_reached')) = 1, 'exactly one active search';
end $$;

-- ── THE 30-DAY RULE AT READ TIME ────────────────────────────────────────────
-- One transaction: now() is fixed, so the 30-day boundary is exact.
begin;
update public.matching_jobs set status = 'ranking' where idempotency_key = 'after-budget_reached';
insert into public.find_buyers_campaigns (matching_job_id, property_id, user_id, transaction, credits_committed, credits_per_usd, customer_value_micros, provider_budget_micros)
select id, property_id, user_id, 'SALE', 100, 10, 10000000, 5000000 from public.matching_jobs where idempotency_key = 'after-budget_reached';
insert into public.find_buyers_persons (id, network, person_key) values
  ('00000000-0000-0000-0000-0000000002a1', 'REDDIT', 'cl-1'), ('00000000-0000-0000-0000-0000000002a2', 'REDDIT', 'cl-2'),
  ('00000000-0000-0000-0000-0000000002a3', 'REDDIT', 'cl-3'), ('00000000-0000-0000-0000-0000000002a4', 'REDDIT', 'cl-4'),
  ('00000000-0000-0000-0000-0000000002a5', 'REDDIT', 'cl-5'), ('00000000-0000-0000-0000-0000000002a6', 'REDDIT', 'cl-6');
insert into public.find_buyers_leads (matching_job_id, property_id, user_id, person_id, counterpart, source, intent_class, overall_score, strength, signal_at, created_at)
select j.id, j.property_id, j.user_id, p.id, 'BUYER', 'REDDIT', 'BUYER_HIGH', 80, v.strength, v.signal_at, now()
  from public.matching_jobs j,
       (values ('00000000-0000-0000-0000-0000000002a1'::uuid, now() - interval '29 days', 'STRONG'),        -- visible
               ('00000000-0000-0000-0000-0000000002a2'::uuid, now() - interval '30 days', 'GOOD'),     -- boundary: visible
               ('00000000-0000-0000-0000-0000000002a3'::uuid, now() - interval '31 days', 'STRONG'),        -- expired
               ('00000000-0000-0000-0000-0000000002a4'::uuid, now() - interval '90 days', 'GOOD'),     -- old post observed today
               ('00000000-0000-0000-0000-0000000002a5'::uuid, null::timestamptz, 'GOOD'),             -- unknown publication date
               ('00000000-0000-0000-0000-0000000002a6'::uuid, now() + interval '3 days', 'GOOD')       -- impossible future date
       ) as v(person, signal_at, strength)
  join public.find_buyers_persons p on p.id = v.person
 where j.idempotency_key = 'after-budget_reached';

do $$
declare s jsonb; v_job uuid := (select id from public.matching_jobs where idempotency_key = 'after-budget_reached');
begin
  assert public.find_buyers_signal_is_current(now() - interval '29 days'), '29 days is current';
  assert public.find_buyers_signal_is_current(now() - interval '30 days'), '30 days is the inclusive boundary';
  assert not public.find_buyers_signal_is_current(now() - interval '30 days 1 second'), 'past 30 days is expired';
  assert not public.find_buyers_signal_is_current(now() - interval '31 days'), '31 days is expired';
  assert not public.find_buyers_signal_is_current(null), 'unknown publication date is never current';
  assert (select count(*) from public.find_buyers_leads where matching_job_id = v_job) = 6, 'history is kept';
  assert (select count(*) from public.find_buyers_current_leads where matching_job_id = v_job) = 2, 'only the 29- and 30-day leads are visible';
  assert not exists (select 1 from public.find_buyers_current_leads where matching_job_id = v_job and person_id in
    ('00000000-0000-0000-0000-0000000002a3', '00000000-0000-0000-0000-0000000002a4', '00000000-0000-0000-0000-0000000002a5', '00000000-0000-0000-0000-0000000002a6')),
    'expired, old-but-observed-today, undated and future leads are hidden';
  s := public.find_buyers_job_state(v_job);
  assert (s->>'newLeads')::int = 2 and (s->>'newResults')::int = 2 and (s->>'strong')::int = 1,
    'the campaign count agrees with the visible list: ' || s::text;
  assert s->>'state' = 'PARTIAL_RESULTS', 'current leads drive the state: ' || s::text;

  -- the 29-day lead ages past 30 days: it leaves the list AND the count together
  update public.find_buyers_leads set signal_at = now() - interval '31 days' where person_id = '00000000-0000-0000-0000-0000000002a1';
  s := public.find_buyers_job_state(v_job);
  assert (select count(*) from public.find_buyers_current_leads where matching_job_id = v_job) = 1 and (s->>'newLeads')::int = 1
     and (s->>'strong')::int = 0, 'aged-out lead leaves list and count: ' || s::text;
  update public.find_buyers_leads set signal_at = now() - interval '45 days' where person_id = '00000000-0000-0000-0000-0000000002a2';
  s := public.find_buyers_job_state(v_job);
  assert (s->>'newResults')::int = 0 and s->>'state' = 'SEARCHING', 'no current demand → no results claimed: ' || s::text;
end $$;

commit;

select 'FIND BUYERS CURRENT LEADS / ONE ACTIVE SEARCH CHECKS PASS';
