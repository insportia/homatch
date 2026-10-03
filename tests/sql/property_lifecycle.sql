-- Behavioural checks for 20261011100000_property_owner_lifecycle.sql.
-- Runs as the owner (authenticated, app.uid set) and as the service role.
-- Run: tests/sql/run-property-lifecycle.sh
\set ON_ERROR_STOP 1

-- Two owners; the legacy property already existed when the migration ran.
insert into public.users (id, auth_id) values
  ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-0000000000b2')
on conflict do nothing;

do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000a1';
  p_direct uuid; p_import uuid; p_other uuid; r jsonb; s text; n int;
begin
  ---------------------------------------------------------------- the rule
  assert public.property_freshness_state(now() - interval '23 days 23 hours') = 'ACTIVE', 'day 23 is ACTIVE';
  assert public.property_freshness_state(now() - interval '24 days') = 'EXPIRING_SOON', 'day 24 is EXPIRING_SOON';
  assert public.property_freshness_state(now() - interval '29 days 23 hours') = 'EXPIRING_SOON', 'day 29 is EXPIRING_SOON';
  assert public.property_freshness_state(now() - interval '30 days') = 'EXPIRED', 'day 30 is EXPIRED';
  assert public.property_freshness_state(now() - interval '400 days') = 'EXPIRED', 'day 400 is EXPIRED';

  ---------------------------------------------------------------- new rows
  insert into public.properties (user_id, source_type, title, matching_status) values (a, 'PRIVATE_LISTING', 'direct', 'ACTIVE') returning id into p_direct;
  insert into public.properties (user_id, source_type, title, matching_status) values (a, 'URL_IMPORT', 'imported', 'ACTIVE') returning id into p_import;
  insert into public.properties (user_id, source_type, title) values ('00000000-0000-0000-0000-0000000000b2', 'PRIVATE_LISTING', 'other') returning id into p_other;
  insert into public.property_facts (property_id) values (p_direct);
  insert into public.property_facts (property_id, source_url, canonical_url, source_listing_id, source_domain)
    values (p_import, 'https://www.myhome.ge/ka/x-25805378/', 'https://www.myhome.ge/ka/x-25805378/', '25805378', 'www.myhome.ge');
  insert into public.matches (property_id) select p_import from generate_series(1, 5);
  perform set_config('t.direct', p_direct::text, false);
  perform set_config('t.import', p_import::text, false);
  perform set_config('t.other', p_other::text, false);

  assert (select imported_at is not null from public.property_facts where property_id = p_import), 'import stamps imported_at';
  assert (select imported_at is null from public.property_facts where property_id = p_direct), 'direct has no imported_at';
  assert (select source_status from public.property_facts where property_id = p_import) = 'UNKNOWN', 'source starts UNKNOWN';
  assert (select public.property_freshness_state(freshness_anchor_at) from public.properties where id = p_direct) = 'ACTIVE', 'new property ACTIVE';
  assert (select owner_confirmed_at is null from public.properties where id = p_direct), 'creation is not a confirmation';
  raise notice 'PROPERTY LIFECYCLE RULE + NEW ROWS: PASS';
end $$;

-------------------------------------------------------------------- legacy backfill
do $$ begin
  assert (select freshness_anchor_at > now() - interval '1 hour' and owner_confirmed_at is null
            from public.properties where title = 'legacy'), 'legacy row: full window from release, no invented confirmation';
  assert (select f.imported_at = p.created_at from public.properties p join public.property_facts f on f.property_id = p.id where p.title = 'legacy'),
    'legacy imported_at backfilled from created_at';
  raise notice 'PROPERTY LIFECYCLE BACKFILL: PASS';
end $$;

-------------------------------------------------------------------- expiry → sweep pauses discovery
update public.properties set freshness_anchor_at = now() - interval '31 days' where title = 'imported';
update public.properties set freshness_anchor_at = now() - interval '25 days' where title = 'direct';
do $$
declare r jsonb; p_import uuid := current_setting('t.import')::uuid; p_direct uuid := current_setting('t.direct')::uuid;
begin
  r := public.property_freshness_sweep();
  assert (r->>'paused')::int = 1, 'one expired ACTIVE property paused: ' || r::text;
  assert (select matching_status::text = 'PAUSED' and freshness_paused_matching from public.properties where id = p_import), 'expired → PAUSED by freshness';
  assert (select matching_status::text = 'ACTIVE' and not freshness_paused_matching from public.properties where id = p_direct), 'expiring-soon keeps discovery';
  assert (select count(*) from public.matches where property_id = p_import) = 5, 'matches preserved on expiry';
  assert (select count(*) from public.notifications_emitted) = 2, 'one notice each (expired, expiring)';
  r := public.property_freshness_sweep();
  assert (select count(*) from public.notifications_emitted) = 2, 'sweep is idempotent for notices';
  raise notice 'PROPERTY LIFECYCLE EXPIRY SWEEP: PASS';
end $$;

-------------------------------------------------------------------- as the owner
set role authenticated;
select set_config('app.uid', '10000000-0000-0000-0000-0000000000a1', false), set_config('app.role', 'authenticated', false);

do $$
declare r jsonb; ok boolean; p_import uuid := current_setting('t.import')::uuid; p_other uuid := current_setting('t.other')::uuid; l record;
begin
  -- server-authoritative state for the owner
  select * into l from public.my_property_lifecycle(array[p_import]);
  assert l.freshness_state = 'EXPIRED' and not l.discovery_eligible and l.days_left = 0, 'lifecycle: expired, not eligible';
  assert (select count(*) from public.my_property_lifecycle(array[p_other])) = 0, 'another owner''s property is invisible';

  -- the guard: an expired property cannot be switched back on
  ok := false;
  begin
    update public.properties set matching_status = 'ACTIVE' where id = p_import;
  exception when others then ok := sqlerrm = 'PROPERTY_EXPIRED';
  end;
  assert ok, 'activation of an expired property is refused';

  -- provenance survives an owner edit
  update public.property_facts set source_url = 'https://evil.example/', source_listing_id = 'x', source_status = 'AVAILABLE',
         description = 'edited by owner' where property_id = p_import;
  assert (select source_url = 'https://www.myhome.ge/ka/x-25805378/' and source_listing_id = '25805378'
            and source_status = 'UNKNOWN' and description = 'edited by owner'
            from public.property_facts where property_id = p_import), 'provenance kept, owner edit applied';

  -- free renewal restores the SAME property and its discovery
  r := public.renew_property(p_import);
  assert (r->>'renewed')::boolean and (r->>'matching_resumed')::boolean, 'renewed and resumed: ' || r::text;
  assert (select public.property_freshness_state(freshness_anchor_at) = 'ACTIVE' and matching_status::text = 'ACTIVE'
            and not freshness_paused_matching and owner_confirmed_at is not null from public.properties where id = p_import), 'ACTIVE again';
  -- double click
  r := public.renew_property(p_import);
  assert not (r->>'renewed')::boolean and r->>'reason' = 'ALREADY_RENEWED', 'second click is a no-op: ' || r::text;
  assert (select count(*) from public.properties where title = 'imported') = 1, 'never duplicated';
  assert (select count(*) from public.matches where property_id = p_import) = 5, 'matches preserved on renewal';

  -- another owner's property: refused
  ok := false;
  begin perform public.renew_property(p_other); exception when others then ok := sqlerrm = 'PROPERTY_NOT_FOUND'; end;
  assert ok, 'cannot renew someone else''s property';
  ok := false;
  begin perform public.set_property_availability(p_other, false); exception when others then ok := sqlerrm = 'PROPERTY_NOT_FOUND'; end;
  assert ok, 'cannot change someone else''s availability';

  -- the archive grant defect: direct column update is refused, the RPC works
  ok := false;
  begin update public.properties set archived_at = now() where id = p_import; exception when insufficient_privilege then ok := true; end;
  assert ok, 'fixture reproduces the missing archived_at grant';
  r := public.set_property_availability(p_import, false);
  assert (select archived_at is not null and matching_status::text = 'PAUSED' from public.properties where id = p_import), 'no longer available';
  r := public.renew_property(p_import);
  assert r->>'reason' = 'NOT_AVAILABLE', 'archived property is not renewed';
  r := public.set_property_availability(p_import, true);
  assert (select archived_at is null and matching_status::text = 'PAUSED' from public.properties where id = p_import), 'available again; matching stays paused';
  assert (select count(*) from public.matches where property_id = p_import) = 5, 'matches preserved on availability changes';

  -- the owner cannot record source health
  ok := false;
  begin perform public.record_property_source_check(p_import, 'AVAILABLE'); exception when insufficient_privilege then ok := true; end;
  assert ok, 'source checks are service-only';
  raise notice 'PROPERTY LIFECYCLE OWNER ACTIONS: PASS';
end $$;

reset role;
select set_config('app.uid', '', false), set_config('app.role', '', false);

-------------------------------------------------------------------- source health
do $$
declare p_import uuid := current_setting('t.import')::uuid; s text;
begin
  s := public.record_property_source_check(p_import, 'UNREACHABLE');
  assert s = 'TEMPORARILY_UNREACHABLE', 'outage is temporary: ' || s;
  s := public.record_property_source_check(p_import, 'NOT_FOUND');
  assert s = 'TEMPORARILY_UNREACHABLE', 'one not-found is not a verdict: ' || s;
  s := public.record_property_source_check(p_import, 'NOT_FOUND');
  assert s = 'LISTING_NOT_FOUND', 'two consecutive not-found: ' || s;
  s := public.record_property_source_check(p_import, 'UNREACHABLE');
  assert s = 'LISTING_NOT_FOUND', 'an outage does not resurrect or re-judge';
  s := public.record_property_source_check(p_import, 'AVAILABLE', true);
  assert s = 'AVAILABLE' and (select media_last_ok_at is not null and source_failed_checks = 0 from public.property_facts where property_id = p_import), 'recovered';
  s := public.record_property_source_check(p_import, 'MEDIA_UNAVAILABLE');
  assert s = 'MEDIA_UNAVAILABLE';
  -- source health never touches freshness, and renewal never touches source
  assert (select public.property_freshness_state(freshness_anchor_at) from public.properties where id = p_import) = 'ACTIVE', 'source ≠ freshness';
  assert public.record_property_source_check(current_setting('t.direct')::uuid, 'AVAILABLE') is null, 'a direct property has no source health';
  raise notice 'PROPERTY LIFECYCLE SOURCE HEALTH: PASS';
end $$;
