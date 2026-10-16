-- Proof for 20261105090000_publishing_providers.sql, applied after tests.sql left
-- publications in place (P2: HANDOFF_READY on myhome, VERIFYING on ssge).
\set A '''aaaaaaaa-0000-0000-0000-00000000000a'''
\set P1 '''11111111-0000-0000-0000-000000000001'''
\set P2 '''11111111-0000-0000-0000-000000000002'''
create function pg_temp.expect_error(sql text, code text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if sqlerrm = code or position(code in sqlerrm) > 0 then raise notice 'PASS  % -> %', left(sql, 60), code; return; end if;
    raise exception 'FAIL  % raised % (wanted %)', sql, sqlerrm, code;
  end;
  raise exception 'FAIL  % succeeded (wanted %)', sql, code;
end $$;
create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin if not cond then raise exception 'FAIL  %', label; end if; raise notice 'PASS  %', label; end $$;

-- Registry seeded with the eight providers and the code defaults.
select pg_temp.ok((select count(*) from public.publishing_providers) = 8, 'eight providers seeded');
select pg_temp.ok((select string_agg(id, ',' order by sort) from public.publishing_providers) = 'myhome,ssge,placege,homege,brokeri,korter,binebi,allhome', 'display order');
select pg_temp.ok((select max_photos = 16 and required_fields = '{description.ka}' from public.publishing_providers where id = 'myhome'), 'myhome keeps its photo cap and Georgian rule');
select pg_temp.ok((select count(*) from public.publishing_providers where verification = 'OWNER_CONFIRMED') = 2, 'korter + binebi owner-confirmed');
select pg_temp.ok((select bool_and(enabled) from public.publishing_providers), 'all enabled by default');

-- Existing publications survived the constraint swap.
select pg_temp.ok((select string_agg(portal_id || ':' || status, ',' order by portal_id) from public.publishing_engine_jobs) = 'myhome:HANDOFF_READY,ssge:VERIFYING', 'existing publications kept');

-- portal_id is now a foreign key: new providers accepted, unknown refused.
select public.publishing_publication_write(:A, :P2, 'placege', -1, '{"status":"HANDOFF_READY"}', '{"kind":"HANDOFF_PREPARED"}');
select pg_temp.expect_error(format('select public.publishing_publication_write(%L,%L,%L,-1,%L,%L)', :A, :P2, 'zillow', '{"status":"HANDOFF_READY"}', '{}'), 'publishing_engine_jobs_portal_fk');

-- OWNER_CONFIRMED is a valid status and counts as live.
select public.publishing_publication_write(:A, :P2, 'korter', -1, '{"status":"HANDOFF_READY"}', '{}');
select public.publishing_publication_write(:A, :P2, 'korter', 0, '{"status":"OWNER_CONFIRMED","external_id":"4521","external_url":"https://korter.ge/x/4521"}', '{"kind":"PUBLICATION_ATTESTED_BY_OWNER"}');
select pg_temp.ok((select status from public.publishing_engine_jobs where listing_id = :P2 and portal_id = 'korter') = 'OWNER_CONFIRMED', 'owner-confirmed stored');
update public.publishing_engine_jobs set status = 'UNPUBLISHED' where listing_id = :P2 and portal_id = 'ssge';
select pg_temp.expect_error(format('select public.publishing_listing_lifecycle(%L,%L,%L)', :A, :P2, 'ARCHIVE'), 'LIVE_PUBLICATIONS_EXIST');
select pg_temp.expect_error(format('select public.publishing_publication_write(%L,%L,%L,1,%L,%L)', :A, :P2, 'korter', '{"status":"CONFIRMED"}', '{}'), 'publishing_engine_jobs_status_check');

-- Provider updates: whitelisted columns only, audited, atomic.
select public.publishing_provider_update(:A, 'placege', '{"enabled":false,"create_url":"https://place.ge/ge/ads/add","required_fields":["area","photos"]}', 'UPDATE');
select pg_temp.ok((select not enabled and create_url = 'https://place.ge/ge/ads/add' and required_fields = '{area,photos}' and updated_by = :A from public.publishing_providers where id = 'placege'), 'update applied');
select pg_temp.ok((select count(*) from public.publishing_provider_audit where provider_id = 'placege' and action = 'UPDATE' and (before->>'enabled')::boolean and not (after->>'enabled')::boolean) = 1, 'audit has before and after');
select pg_temp.expect_error(format('select public.publishing_provider_update(%L,%L,%L,%L)', :A, 'placege', '{"id":"evil"}', 'UPDATE'), 'FIELD_NOT_EDITABLE');
select pg_temp.expect_error(format('select public.publishing_provider_update(%L,%L,%L,%L)', :A, 'placege', '{"health_status":"OK"}', 'UPDATE'), 'FIELD_NOT_EDITABLE');
select pg_temp.expect_error(format('select public.publishing_provider_update(%L,%L,%L,%L)', :A, 'placege', '{"enabled":true}', 'RECHECK'), 'FIELD_NOT_EDITABLE');
select pg_temp.expect_error(format('select public.publishing_provider_update(%L,%L,%L,%L)', :A, 'nope', '{"enabled":true}', 'UPDATE'), 'PORTAL_UNKNOWN');
select pg_temp.expect_error(format('select public.publishing_provider_update(%L,%L,%L,%L)', :A, 'placege', '{"logo_url":"http://x"}', 'UPDATE'), 'publishing_providers_logo_url_check');
select pg_temp.ok((select count(*) from public.publishing_provider_audit) = 1, 'a refused update leaves no audit row');
select public.publishing_provider_update(:A, 'homege', '{"health_status":"REACHABLE","health_detail":"HTTP_200","health_checked_at":"2026-10-16T00:00:00Z"}', 'RECHECK');
select pg_temp.ok((select health_status = 'REACHABLE' and updated_by is null from public.publishing_providers where id = 'homege'), 're-check writes health only');

-- Privileges: no browser role can read or write the registry, its audit, or the RPC.
select pg_temp.ok(not has_table_privilege('authenticated', 'public.publishing_providers', 'select'), 'authenticated cannot read providers');
select pg_temp.ok(not has_table_privilege('anon', 'public.publishing_providers', 'update'), 'anon cannot update providers');
select pg_temp.ok(not has_table_privilege('authenticated', 'public.publishing_provider_audit', 'select'), 'authenticated cannot read audit');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.publishing_provider_update(uuid,text,jsonb,text)', 'execute'), 'authenticated cannot update via RPC');
select pg_temp.ok(not has_function_privilege('anon', 'public.publishing_listing_lifecycle(uuid,uuid,text)', 'execute'), 'lifecycle still service-only');
select pg_temp.ok(has_function_privilege('service_role', 'public.publishing_provider_update(uuid,text,jsonb,text)', 'execute'), 'service_role can update');
\echo 'publishing providers migration proof: PASS'
