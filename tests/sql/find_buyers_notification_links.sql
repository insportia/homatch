-- FIND BUYERS notifications open THE search (20261112090000). Run after the lifecycle checks.
\set ON_ERROR_STOP on
update public.users set preferred_language = 'ka';
-- Its own property: one active search per property, and b1's may still be running.
insert into public.properties (id) values ('00000000-0000-0000-0000-0000000000b9') on conflict do nothing;
update public.properties set user_id = '00000000-0000-0000-0000-0000000000a1', transaction_type = 'SALE' where id = '00000000-0000-0000-0000-0000000000b9';
insert into public.matching_jobs (id, user_id, property_id, idempotency_key, status)
values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b9', 'k-f1', 'queued');
update public.matching_jobs set status = 'searching_sources' where id = '00000000-0000-0000-0000-0000000000f1';
do $$
declare n record;
begin
  select * into n from public.notifications where dedupe_key = 'matching-job-started:00000000-0000-0000-0000-0000000000f1';
  assert n.deep_link = '/property/00000000-0000-0000-0000-0000000000b9/buyers/external?job=00000000-0000-0000-0000-0000000000f1',
    'started notice opens this search: ' || coalesce(n.deep_link, 'null');
  assert n.entity_type = 'matching_jobs' and n.entity_id = '00000000-0000-0000-0000-0000000000f1', 'entity kept';
  assert n.property_id = '00000000-0000-0000-0000-0000000000b9', 'property_id filled';
  assert public.find_buyers_notice_text('ka', 'done_results', false, 3) = array['ძებნა დასრულდა — ახალი შედეგები: 3', 'გახსენით ძებნა მათ სანახავად.'],
    'KA finished copy says results';
  assert public.find_buyers_notice_text('en', 'done_results', false, 1) = array['Search finished: 1 new result', 'Open the search to review them.'];
  assert (select bool_and(not (t ~ 'შესაბამისობ')) from unnest(
    public.find_buyers_notice_text('ka', 'first', false) || public.find_buyers_notice_text('ka', 'done_results', false, 2)) t),
    'no შესაბამისობა in the Georgian notices';
end $$;
select 'FIND BUYERS NOTIFICATION LINK CHECKS PASS';
