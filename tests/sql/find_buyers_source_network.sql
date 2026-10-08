-- FIND BUYERS: the source network Admin sees (20261022090000). Discovered,
-- verified, active and read are counted apart; a Telegram community mirrored
-- in source_registry is counted once; the posting directory is never coverage.
\set ON_ERROR_STOP on
insert into public.community_targets (platform, external_id, name, readability, lifecycle, discovery_enabled, items_read, demand_found, last_success_at, created_at, metadata) values
  ('TELEGRAM', 'tbilisikvartiri', 'Тбилиси Квартиры', 'READABLE', 'REACHABLE', true, 14, 1, now() - interval '1 day', now() - interval '20 days', '{}'),
  ('TELEGRAM', 'batumi_re', 'Недвижимость Батуми', 'READABLE', 'AUDITED', false, 0, 0, null, now() - interval '2 days', '{"audit":{"reason":"75% about property, 0 demand in sample"}}'),
  ('TELEGRAM', 'tbilisi_arendaa', 'Тбилиси Аренда Квартир', 'UNVERIFIED', 'DISCOVERED', false, 0, 0, null, now() - interval '2 days', '{"discovered_query":"аренда квартир тбилиси"}'),
  ('TELEGRAM', 'old_chat', 'Old', 'READABLE', 'RETIRED', false, 0, 0, null, now() - interval '90 days', '{}');
insert into public.source_registry (platform, source_type, external_id, name, url, lifecycle, access_state, active, discovered_via, created_at) values
  ('TELEGRAM', 'TELEGRAM_GROUP', 'tbilisikvartiri', 'mirror', 'https://t.me/tbilisikvartiri', 'AUDITED', 'PUBLIC', false, null, now() - interval '20 days'),
  ('FACEBOOK', 'FACEBOOK_GROUP', 'fb1', 'Tbilisi flats', 'https://www.facebook.com/groups/fb1', 'DISCOVERED', 'PUBLIC', false, 'memo23:FB_GROUP_SEARCH', now() - interval '1 day');
insert into public.community_directory (platform, name) values ('FACEBOOK', 'listed group');
insert into public.discovery_query_queue (property_id, platform, language, query, status, result_count, provider, matching_job_id, metadata)
values ('00000000-0000-0000-0000-0000000000b1', 'TELEGRAM', 'multi', 'discover', 'DONE', 3, 'TELEGRAM_SOURCES', '00000000-0000-0000-0000-0000000006a1',
        '{"city":"თბილისი","last_outcome":{"communitiesFound":9,"newlyRegistered":3,"audited":4,"verified":2,"activated":0,"readNow":0,"languagesSearched":["ka","en","ru","ar","he","tr"]}}');

do $$
declare r jsonb; tg jsonb; fb jsonb; c jsonb;
begin
  begin
    perform public.admin_find_buyers_source_network(7);
    assert false, 'a non-admin must be refused';
  exception when others then
    assert sqlerrm = 'FORBIDDEN', 'refused as FORBIDDEN: ' || sqlerrm;
  end;
  perform set_config('app.admin', 'on', true);
  r := public.admin_find_buyers_source_network(7);
  select x into tg from jsonb_array_elements(r -> 'platforms') x where x ->> 'platform' = 'TELEGRAM';
  assert (tg ->> 'discovered')::int = 3 and (tg ->> 'verified')::int = 2 and (tg ->> 'active')::int = 1 and (tg ->> 'read')::int = 1,
    'TG discovered/verified/active/read kept apart, mirror counted once: ' || tg::text;
  assert (tg ->> 'blocked')::int = 1 and (tg ->> 'newInWindow')::int = 2 and (tg ->> 'itemsRead')::int = 14 and (tg ->> 'demandSignals')::int = 1, tg::text;
  select x into fb from jsonb_array_elements(r -> 'platforms') x where x ->> 'platform' = 'FACEBOOK';
  assert (fb ->> 'discovered')::int = 1 and (fb ->> 'verified')::int = 0 and (fb ->> 'read')::int = 0, 'a discovered group is not verified or read: ' || fb::text;
  assert (r ->> 'memo23Discovered')::int = 1, r::text;
  assert r -> 'directory' -> 0 ->> 'listed' = '1', 'directory reported on its own line';
  assert jsonb_array_length(r -> 'telegram') = 4;
  c := r -> 'campaigns' -> 0;
  assert (c ->> 'communitiesFound')::int = 9 and (c ->> 'audited')::int = 4 and jsonb_array_length(c -> 'languages') = 6 and c ->> 'city' = 'თბილისი', c::text;
  assert (r ->> 'autoEnable') = 'false', 'auto-enable reported (absent = false)';
  perform set_config('app.admin', '', true);
  assert not has_function_privilege('anon', 'public.admin_find_buyers_source_network(integer)', 'execute'), 'anon cannot call it';
end $$;

select 'FIND BUYERS SOURCE NETWORK CHECKS PASS';
