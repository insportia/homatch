-- FIND BUYERS: evidence-backed qualification (20261024090000). Rejected leads
-- stay stored (evidence, history) but are never customer results; the job
-- state counts Strong/Potential/Weak only; LinkedIn group search is
-- quarantined; the comment gate moves only from the old default.
\set ON_ERROR_STOP on

do $$
declare v_job uuid; v_prop uuid; v_user uuid; v_state jsonb;
begin
  select id, property_id, user_id into v_job, v_prop, v_user from public.matching_jobs where idempotency_key = 'after-budget_reached';
  insert into public.find_buyers_persons (id, network, person_key) values
    ('00000000-0000-0000-0000-0000000003a1', 'FACEBOOK', 'q-1'), ('00000000-0000-0000-0000-0000000003a2', 'FACEBOOK', 'q-2'),
    ('00000000-0000-0000-0000-0000000003a3', 'FACEBOOK', 'q-3'), ('00000000-0000-0000-0000-0000000003a4', 'FACEBOOK', 'q-4');
  delete from public.find_buyers_leads where matching_job_id = v_job;
  insert into public.find_buyers_leads (matching_job_id, property_id, user_id, person_id, counterpart, source, intent_class, overall_score, strength, signal_at, match_category, rejection_reasons)
  values
    (v_job, v_prop, v_user, '00000000-0000-0000-0000-0000000003a1', 'BUYER', 'FACEBOOK', 'BUYER_HIGH', 82, 'STRONG', now() - interval '1 day', 'STRONG', '{}'),
    (v_job, v_prop, v_user, '00000000-0000-0000-0000-0000000003a2', 'BUYER', 'FACEBOOK', 'BUYER_HIGH', 60, 'GOOD', now() - interval '1 day', 'POTENTIAL', '{}'),
    (v_job, v_prop, v_user, '00000000-0000-0000-0000-0000000003a3', 'BUYER', 'FACEBOOK', 'BUYER_MEDIUM', 45, 'POSSIBLE', now() - interval '1 day', 'WEAK', '{}'),
    (v_job, v_prop, v_user, '00000000-0000-0000-0000-0000000003a4', 'BUYER', 'FACEBOOK', 'BUYER_HIGH', 72, 'GOOD', now() - interval '1 day', 'REJECTED', '{JOB_SEARCH}');
  assert (select count(*) from public.find_buyers_leads where matching_job_id = v_job) = 4, 'rejected rows are kept';
  assert (select count(*) from public.find_buyers_current_leads where matching_job_id = v_job) = 3, 'rejected rows leave the customer view';
  v_state := public.find_buyers_job_state(v_job);
  assert (v_state ->> 'newLeads')::int = 3, format('job state counts non-rejected only: %s', v_state ->> 'newLeads');
  assert (v_state ->> 'strong')::int = 1 and (v_state ->> 'potential')::int = 1 and (v_state ->> 'weak')::int = 1, format('categories: %s', v_state);
  assert v_state ? 'metrics', 'timings are reported';
  begin
    update public.find_buyers_leads set match_category = 'MAYBE' where person_id = '00000000-0000-0000-0000-0000000003a1';
    raise exception 'an unknown category was accepted';
  exception when check_violation then null;
  end;
end $$;

do $$
begin
  if exists (select 1 from public.find_buyers_actor_registry where actor_key = 'LINKEDIN_GROUPS') then
    assert (select not enabled and health = 'DISABLED' from public.find_buyers_actor_registry where actor_key = 'LINKEDIN_GROUPS'), 'LinkedIn group search quarantined';
  end if;
  if exists (select 1 from public.admin_settings where key = 'find_buyers_comment_gate') then
    assert (select value in ('{"skipBelow": 55, "eligibleFrom": 75}'::jsonb) or value <> '{"skipBelow": 70, "eligibleFrom": 85}'::jsonb
              from public.admin_settings where key = 'find_buyers_comment_gate'), 'gate moved from the old default only';
  end if;
end $$;
select 'find_buyers_qualification: ok';
