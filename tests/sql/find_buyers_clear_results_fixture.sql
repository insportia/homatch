-- Fixture for 20261112100000_find_buyers_clear_results: one owner's property with a
-- finished search (2 visible leads, 1 rejected), a running search (1 lead), legacy
-- matches (NEW, UNLOCKED, REJECTED), and a stranger's property.
alter table public.properties add column if not exists is_deleted boolean default false;
/* matches.status as production has it: the match_status enum, NOT NULL (20260827205525). Earlier
   suites' placeholder 'LOCKED' rows become NEW; they have already run. */
do $$ begin
  if not exists (select 1 from pg_type where typname = 'match_status' and typnamespace = 'public'::regnamespace) then
    create type public.match_status as enum ('NEW', 'PREVIEWED', 'UNLOCKED', 'ARCHIVED', 'REJECTED');
  end if;
end $$;
alter table public.matches alter column status drop default;
alter table public.matches alter column status type public.match_status
  using (case when status::text in ('NEW', 'PREVIEWED', 'UNLOCKED', 'ARCHIVED', 'REJECTED') then status::text else 'NEW' end)::public.match_status;
alter table public.matches alter column status set default 'NEW', alter column status set not null;
do $$
declare
  owner uuid := '11111111-1111-1111-1111-111111111111';
  stranger uuid := '22222222-2222-2222-2222-222222222222';
  prop uuid := 'aaaaaaaa-0000-0000-0000-00000000c1ea';
  prop2 uuid := 'aaaaaaaa-0000-0000-0000-00000000c1eb';
  done_job uuid := 'bbbbbbbb-0000-0000-0000-00000000d0e1';
  run_job uuid := 'bbbbbbbb-0000-0000-0000-00000000d0e2';
  p1 uuid; p2 uuid; p3 uuid; p4 uuid;
begin
  insert into public.properties (id, user_id, transaction_type) values (prop, owner, 'SALE'), (prop2, stranger, 'SALE') on conflict do nothing;
  insert into public.matching_jobs (id, user_id, property_id, idempotency_key, status) values
    (done_job, owner, prop, 'clear-fx-done', 'completed'), (run_job, owner, prop, 'clear-fx-run', 'searching_sources') on conflict do nothing;
  insert into public.find_buyers_campaigns (matching_job_id, property_id, user_id, transaction, credits_committed, credits_per_usd, customer_value_micros, provider_budget_micros) values
    (done_job, prop, owner, 'SALE', 100, 10, 10000000, 6300000), (run_job, prop, owner, 'SALE', 100, 10, 10000000, 6300000) on conflict do nothing;
  insert into public.find_buyers_persons (network, person_key) values ('FACEBOOK', 'clear-fx-1') returning id into p1;
  insert into public.find_buyers_persons (network, person_key) values ('FACEBOOK', 'clear-fx-2') returning id into p2;
  insert into public.find_buyers_persons (network, person_key) values ('FACEBOOK', 'clear-fx-3') returning id into p3;
  insert into public.find_buyers_persons (network, person_key) values ('FACEBOOK', 'clear-fx-4') returning id into p4;
  insert into public.find_buyers_leads (matching_job_id, property_id, user_id, person_id, counterpart, source, intent_class, overall_score, strength, signal_at, match_category) values
    (done_job, prop, owner, p1, 'BUYER', 'FACEBOOK', 'BUYER_MEDIUM', 60, 'POSSIBLE', now() - interval '2 days', 'WEAK'),
    (done_job, prop, owner, p2, 'BUYER', 'FACEBOOK', 'BUYER_MEDIUM', 70, 'GOOD', now() - interval '2 days', 'POTENTIAL'),
    (done_job, prop, owner, p3, 'BUYER', 'FACEBOOK', 'NOISE', 10, 'POSSIBLE', now() - interval '2 days', 'REJECTED'),
    (done_job, prop, owner, p4, 'BUYER', 'FACEBOOK', 'BUYER_MEDIUM', 70, 'GOOD', now() - interval '40 days', 'POTENTIAL'),
    (run_job, prop, owner, p1, 'BUYER', 'FACEBOOK', 'BUYER_MEDIUM', 60, 'POSSIBLE', now() - interval '1 hour', 'WEAK');
  insert into public.matches (property_id, status) values (prop, 'NEW'), (prop, 'UNLOCKED'), (prop, 'REJECTED'), (prop2, 'NEW');
  /* a legacy match of the running search: never cleared while it runs */
  insert into public.matches (property_id, job_id, status) values (prop, run_job, 'NEW');
end $$;
