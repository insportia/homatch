-- Proof for 20261103090000_publishing_workspace.sql on top of the two 2026-10-14 migrations.
\set A '''aaaaaaaa-0000-0000-0000-00000000000a'''
\set B '''bbbbbbbb-0000-0000-0000-00000000000b'''
\set P1 '''11111111-0000-0000-0000-000000000001'''
\set P2 '''11111111-0000-0000-0000-000000000002'''
\set PB '''22222222-0000-0000-0000-000000000001'''
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

-- Dropped: the RPC that inserted a NEW properties row per listing, and the job RPCs.
select pg_temp.ok(to_regprocedure('public.publishing_engine_save(uuid,uuid,integer,jsonb)') is null, 'publishing_engine_save dropped');
select pg_temp.ok(to_regprocedure('public.publishing_engine_start_portal_job(uuid,uuid,integer,text)') is null, 'start_portal_job dropped');

-- Save: version 0 creates, no properties row is added; replays and stale versions conflict.
select public.publishing_listing_save(:A, :P1, 0, '{"title":"t"}', 'DRAFT');
select pg_temp.ok((select count(*) from public.properties) = 3, 'save never inserts a property');
select pg_temp.expect_error(format('select public.publishing_listing_save(%L,%L,0,%L,%L)', :A, :P1, '{}', 'DRAFT'), 'VERSION_CONFLICT');
select public.publishing_listing_save(:A, :P1, 1, '{"title":"t2"}', 'READY');
select pg_temp.ok((select version from public.publishing_engine_listings where id = :P1) = 2, 'version advanced to 2');
select pg_temp.ok((select count(*) from public.publishing_engine_versions where listing_id = :P1) = 2, 'both versions kept');
select pg_temp.expect_error(format('select public.publishing_listing_save(%L,%L,0,%L,%L)', :B, :P1, '{}', 'DRAFT'), 'OWNED_PROPERTY_REQUIRED');
select pg_temp.expect_error(format('select public.publishing_listing_save(%L,%L,0,%L,%L)', :A, :PB, '{}', 'DRAFT'), 'OWNED_PROPERTY_REQUIRED');
select pg_temp.expect_error(format('select public.publishing_listing_save(%L,%L,2,%L,%L)', :A, :P1, '{}', 'PUBLISHED'), 'INVALID_STATUS');

-- Publication: create at revision -1, compare-and-set after, history written in the same transaction.
select public.publishing_publication_write(:A, :P1, 'myhome', -1, '{"status":"HANDOFF_READY","listing_version":2}', '{"kind":"HANDOFF_PREPARED"}');
select pg_temp.expect_error(format('select public.publishing_publication_write(%L,%L,%L,-1,%L,%L)', :A, :P1, 'myhome', '{"status":"HANDOFF_READY"}', '{}'), 'REVISION_CONFLICT');
select public.publishing_publication_write(:A, :P1, 'myhome', 0, '{"status":"VERIFYING","external_id":"25805378","external_url":"https://www.myhome.ge/pr/25805378"}', '{"kind":"EXTERNAL_LISTING_LINKED"}');
select pg_temp.expect_error(format('select public.publishing_publication_write(%L,%L,%L,0,%L,%L)', :A, :P1, 'myhome', '{"status":"PUBLISHED"}', '{}'), 'REVISION_CONFLICT');
select public.publishing_publication_write(:A, :P1, 'myhome', 1, '{"status":"PUBLISHED","published_at":"2026-10-16T00:00:00Z"}', '{"kind":"PUBLICATION_CONFIRMED"}');
select pg_temp.expect_error(format('select public.publishing_publication_write(%L,%L,%L,2,%L,%L)', :A, :P1, 'myhome', '{"status":"LIVE"}', '{}'), 'publishing_engine_jobs_status_check');
select pg_temp.expect_error(format('select public.publishing_publication_write(%L,%L,%L,-1,%L,%L)', :A, :P1, 'zillow', '{"status":"HANDOFF_READY"}', '{}'), 'publishing_engine_jobs_portal_id_check');
select pg_temp.expect_error(format('select public.publishing_publication_write(%L,%L,%L,-1,%L,%L)', :B, :P1, 'ssge', '{"status":"HANDOFF_READY"}', '{}'), 'OWNED_RECORD_REQUIRED');
select pg_temp.ok((select count(*) from public.publishing_engine_events where listing_id = :P1 and publication_id is not null) = 3, 'three publication history rows');
select pg_temp.ok((select from_status || '>' || to_status from public.publishing_engine_events where kind = 'PUBLICATION_CONFIRMED') = 'VERIFYING>PUBLISHED', 'history records the transition');

-- Duplicate external listing: a second listing cannot claim the same portal id.
select public.publishing_listing_save(:A, :P2, 0, '{}', 'READY');
select public.publishing_publication_write(:A, :P2, 'myhome', -1, '{"status":"HANDOFF_READY"}', '{}');
select pg_temp.expect_error(format('select public.publishing_publication_write(%L,%L,%L,0,%L,%L)', :A, :P2, 'myhome', '{"status":"VERIFYING","external_id":"25805378"}', '{}'), 'EXTERNAL_LISTING_ALREADY_LINKED');
-- ... but the same id on ANOTHER portal is a different listing.
select public.publishing_publication_write(:A, :P2, 'ssge', -1, '{"status":"HANDOFF_READY"}', '{}');
select public.publishing_publication_write(:A, :P2, 'ssge', 0, '{"status":"VERIFYING","external_id":"25805378"}', '{}');

-- Archive / delete refuse while a copy may be live, and never touch the property.
select pg_temp.expect_error(format('select public.publishing_listing_lifecycle(%L,%L,%L)', :A, :P1, 'DELETE'), 'LIVE_PUBLICATIONS_EXIST');
select pg_temp.expect_error(format('select public.publishing_listing_lifecycle(%L,%L,%L)', :A, :P1, 'ARCHIVE'), 'LIVE_PUBLICATIONS_EXIST');
select pg_temp.expect_error(format('select public.publishing_listing_lifecycle(%L,%L,%L)', :B, :P1, 'DELETE'), 'OWNED_RECORD_REQUIRED');
select public.publishing_publication_write(:A, :P1, 'myhome', 2, '{"status":"UNPUBLISHED"}', '{"kind":"UNPUBLISH_CONFIRMED"}');
select public.publishing_listing_lifecycle(:A, :P1, 'ARCHIVE');
select pg_temp.expect_error(format('select public.publishing_listing_save(%L,%L,2,%L,%L)', :A, :P1, '{}', 'DRAFT'), 'LISTING_ARCHIVED');
select public.publishing_listing_lifecycle(:A, :P1, 'RESTORE');
select public.publishing_listing_lifecycle(:A, :P1, 'DELETE');
select pg_temp.ok(not exists (select 1 from public.publishing_engine_listings where id = :P1), 'listing deleted');
select pg_temp.ok(not exists (select 1 from public.publishing_engine_events where listing_id = :P1), 'its history deleted');
select pg_temp.ok((select count(*) from public.properties where id = :P1 and not is_deleted) = 1, 'the property is untouched');

-- Privileges: browsers cannot call the RPCs; RLS shows owners only their own rows.
select pg_temp.ok(not has_function_privilege('authenticated', 'public.publishing_listing_save(uuid,uuid,integer,jsonb,text)', 'execute'), 'authenticated cannot save');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.publishing_publication_write(uuid,uuid,text,integer,jsonb,jsonb)', 'execute'), 'authenticated cannot write publications');
select pg_temp.ok(not has_function_privilege('anon', 'public.publishing_listing_lifecycle(uuid,uuid,text)', 'execute'), 'anon cannot run lifecycle');
select pg_temp.ok(has_function_privilege('service_role', 'public.publishing_publication_write(uuid,uuid,text,integer,jsonb,jsonb)', 'execute'), 'service_role can write');
select pg_temp.ok(not has_table_privilege('authenticated', 'public.publishing_engine_events', 'insert'), 'authenticated cannot insert history');
select pg_temp.ok(not has_table_privilege('authenticated', 'public.publishing_engine_jobs', 'update'), 'authenticated cannot update publications');
select pg_temp.ok(not has_table_privilege('anon', 'public.publishing_engine_events', 'select'), 'anon cannot read history');
set role authenticated;
select set_config('app.uid', :B, false);
select pg_temp.ok((select count(*) from public.publishing_engine_events) = 0 and (select count(*) from public.publishing_engine_jobs) = 0 and (select count(*) from public.publishing_engine_listings) = 0, 'another owner sees nothing');
select set_config('app.uid', :A, false);
select pg_temp.ok((select count(*) from public.publishing_engine_listings) = 1 and (select count(*) from public.publishing_engine_events) > 0, 'the owner sees their own rows');
reset role;
\echo 'publishing migration proof: PASS'
