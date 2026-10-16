-- Assertions for 20261105090000_storage_retention_artifacts.sql (object-level
-- retention for an allowlist of disposable storage objects). Runs after the
-- record-level tests, on the same throwaway database. Each block raises on
-- failure; run.sh prints RETENTION ARTIFACTS SQL: PASS only if all ran.
\set ON_ERROR_STOP 1
\set A '''aaaaaaaa-0000-0000-0000-00000000000a'''
\set ADM '''cccccccc-0000-0000-0000-00000000000c'''
\set GHOST '''dddddddd-0000-0000-0000-00000000000d'''

create function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is distinct from true then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;
create function pg_temp.raises(sql text, code text, msg text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if sqlerrm like '%' || code || '%' then raise notice 'ok  %', msg; return; end if;
    raise exception 'FAIL: % (raised "%" instead of %)', msg, sqlerrm, code;
  end;
  raise exception 'FAIL: % (did not raise %)', msg, code;
end $$;

-- Production columns the new functions read (the record-level fixture did not need them).
alter table public.notifications add column if not exists read boolean not null default false,
  add column if not exists pushed_at timestamptz;
alter table public.storage_objects add column if not exists owner_user_id uuid, add column if not exists category text;
-- notify_emit as production behaves for a recipient with no account: no row, null id.
create or replace function public.notify_emit(p_user_id uuid, p_type public.notification_type, p_title text, p_body text default null,
  p_priority text default 'NORMAL', p_deep_link text default null, p_entity_type text default null, p_entity_id uuid default null,
  p_dedupe_key text default null, p_group_key text default null, p_group_window interval default interval '5 minutes',
  p_group_title_template text default null, p_metadata jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer as $$
declare v uuid;
begin
  if not exists (select 1 from public.users where auth_id = p_user_id or id = p_user_id) then return null; end if;
  insert into public.notifications (user_id, type, title, body, dedupe_key, metadata)
  values (p_user_id, p_type, p_title, p_body, p_dedupe_key, p_metadata)
  on conflict (user_id, dedupe_key) do update set title = public.notifications.title returning id into v;
  return v;
end $$;

-- ── 1. The allowlist is the enforcement ──
select pg_temp.ok(public.retention_location_eligible('SUPABASE_STORAGE', 'verify-documents', 'files/123456.pdf'), 'verify-documents cache file is eligible');
select pg_temp.ok(public.retention_location_eligible('R2', 'users', 'users/aaaaaaaa-0000-0000-0000-00000000000a/generated-reports/11111111-0000-0000-0000-000000000001.pdf'), 'a generated report is eligible');
select pg_temp.ok(not public.retention_location_eligible('R2', 'design-studio', 'design-studio/catalog/public/hdri/x/y/lot_1k.hdr'), 'Design Studio catalog is never eligible');
select pg_temp.ok(not public.retention_location_eligible('R2', 'users', 'users/aaaaaaaa-0000-0000-0000-00000000000a/design-studio-thumbnails/x/y.webp'), 'a user''s Design Studio file is never eligible');
select pg_temp.ok(not public.retention_location_eligible('SUPABASE_STORAGE', 'deal-room-documents', 'aaaaaaaa-0000-0000-0000-00000000000a/contract.pdf'), 'Contracts originals are never eligible');
select pg_temp.ok(not public.retention_location_eligible('R2', 'deal-room-documents', 'deal-room-documents/x/ci-contract.pdf'), 'Contracts R2 copies are never eligible');
select pg_temp.ok(not public.retention_location_eligible('SUPABASE_STORAGE', 'verify-evidence', 'sha256/ab/abcdef.txt'), 'Verify evidence is never eligible');
select pg_temp.ok(not public.retention_location_eligible('SUPABASE_STORAGE', 'verify-official-visuals', 'tas/' || repeat('a', 64) || '.jpg'), 'Verify report visuals are never eligible');
select pg_temp.ok(not public.retention_location_eligible('SUPABASE_STORAGE', 'verify-documents', 'files/../evidence.pdf'), 'path traversal is never eligible');
select pg_temp.ok(not public.retention_location_eligible('SUPABASE_STORAGE', 'verify-documents', 'other/123.pdf'), 'other paths in the cache bucket are not eligible');
select pg_temp.ok(not public.retention_location_eligible('R2', 'users', 'users/aaaaaaaa-0000-0000-0000-00000000000a/generated-reports/../x.pdf'), 'traversal under generated-reports is not eligible');

-- ── 2. Categories: seeded safe, scope fixed by migration ──
select pg_temp.ok((select not enabled and active_since is null from public.retention_categories where key = 'verify_document_cache'), 'verify_document_cache starts disabled');
select pg_temp.ok((select not enabled and active_since is null from public.retention_categories where key = 'generated_report'), 'generated_report starts disabled');
select pg_temp.ok((select count(*) = 2 from public.retention_categories where kind = 'SELFTEST' and key_pattern like '^retention-selftest/%'), 'self-test categories only match retention-selftest/ keys');
select pg_temp.ok((public.retention_artifacts_config() ->> 'paused') = 'false' and (public.retention_artifacts_config() ->> 'notifications_enabled') = 'false', 'settings seeded: not paused, notices off');
select pg_temp.raises($$insert into public.retention_categories (key, label, kind, provider, bucket, key_pattern) values ('contracts', 'x', 'TEMPORARY_ARTIFACT', 'SUPABASE_STORAGE', 'deal-room-documents', '^.*$')$$,
  'not an allowlisted location', 'a category cannot point at Contracts originals');
select pg_temp.raises($$insert into public.retention_categories (key, label, kind, provider, bucket, key_pattern) values ('catalog', 'x', 'TEMPORARY_ARTIFACT', 'R2', 'design-studio', '^.*$')$$,
  'not an allowlisted location', 'a category cannot point at the Design Studio catalog');
select pg_temp.raises($$update public.retention_categories set key_pattern = '^.*$' where key = 'verify_document_cache'$$,
  'scope is fixed', 'a category''s scope cannot be widened by an update');
select pg_temp.raises($$insert into public.retention_categories (key, label, kind, provider, bucket, key_pattern, ttl) values ('short', 'x', 'TEMPORARY_ARTIFACT', 'R2', 'users', '^users/x$', interval '1 day')$$,
  'check', 'a real category cannot expire in under 30 days');
select pg_temp.raises($$insert into public.retention_categories (key, label, kind, provider, bucket, key_pattern, ttl) values ('st', 'x', 'SELFTEST', 'R2', 'users', '^users/x$', interval '1 minute')$$,
  'check', 'a self-test category cannot match non-test keys');

-- ── 3. Record-level retention is retired ──
update public.admin_settings set value = value || '{"purge_enabled": true, "effective_at": "2000-01-01T00:00:00Z"}'::jsonb where key = 'storage_retention';
select pg_temp.ok((select count(*) from public.retention_claim(50)) = 0, 'record-level claim never returns a report or document, whatever its settings say');
update public.admin_settings set value = value || '{"purge_enabled": false, "effective_at": null}'::jsonb where key = 'storage_retention';
set request.jwt.claim.sub = :ADM;
select pg_temp.raises($$select public.retention_admin_configure('{"purge_enabled": true}'::jsonb)$$, 'RETENTION_RECORD_LEVEL_RETIRED', 'record-level settings cannot be changed any more');
reset request.jwt.claim.sub;

-- ── 4. Prospective registration of the cache ──
create temp table rec_before as select count(*) n from public.retention_records;
insert into storage.objects (bucket_id, name, metadata, created_at) values
  ('verify-documents', 'files/100001.pdf', '{"size": 1000}', now() - interval '40 days'),   -- legacy
  ('verify-documents', 'files/100002.pdf', '{"size": 1000}', now() - interval '1 day');     -- legacy
select pg_temp.ok(public.retention_register_artifacts(100) = 0, 'nothing registers while the category is disabled');
select public.retention_category_set('verify_document_cache', true, 'test');
select pg_temp.ok(public.retention_register_artifacts(100) = 0, 'enabling registers no historical object');
insert into storage.objects (bucket_id, name, metadata, created_at) values
  ('verify-documents', 'files/100003.pdf', '{"size": 2048}', now() + interval '1 second'),
  ('verify-documents', 'notes/100004.pdf', '{"size": 10}', now() + interval '1 second'),
  ('verify-evidence', 'files/100005.pdf', '{"size": 10}', now() + interval '1 second'),
  ('deal-room-documents', 'files/100006.pdf', '{"size": 10}', now() + interval '1 second');
select pg_temp.ok(public.retention_register_artifacts(100) = 1, 'a new cache file registers; other paths and buckets do not');
select pg_temp.ok((select expires_at = object_created_at + interval '30 days' and byte_size = 2048 and owner_user_id is null
                     from public.retention_artifacts where object_key = 'files/100003.pdf'), 'expiry is creation + 30 days');
select pg_temp.ok(public.retention_register_artifacts(100) = 0, 'registration is idempotent');
select public.retention_category_set('verify_document_cache', false, 'test');
select public.retention_category_set('verify_document_cache', true, 'test');
select pg_temp.ok((select active_since < now() - interval '0 seconds' from public.retention_categories where key = 'verify_document_cache')
                  and public.retention_register_artifacts(100) = 0, 're-enabling never moves active_since back to cover older files');
select pg_temp.raises($$update public.retention_categories set active_since = '2000-01-01' where key = 'verify_document_cache'$$,
  'never moves', 'active_since cannot be moved back');

-- ── 5. Explicit registration for user-visible files ──
insert into public.users (auth_id, is_admin) select :A, false where not exists (select 1 from public.users where auth_id = :A);
select pg_temp.raises(format($$select public.retention_register_artifact('generated_report', 'users/%s/generated-reports/11111111-0000-0000-0000-000000000001.pdf', %L, 10, 'Report', '/verify/history')$$, :A, :A),
  'RETENTION_CATEGORY_DISABLED', 'a disabled category refuses registration');
select public.retention_category_set('generated_report', true, 'test');
select pg_temp.raises(format($$select public.retention_register_artifact('generated_report', 'users/%s/generated-reports/11111111-0000-0000-0000-000000000001.pdf', %L, 10, 'Report', null)$$, :A, :A),
  'RETENTION_NEEDS_OWNER_AND_LINK', 'a user-visible file needs a download path');
select pg_temp.raises(format($$select public.retention_register_artifact('generated_report', 'users/%s/design-studio-thumbnails/x.webp', %L, 10, 'Report', '/x')$$, :A, :A),
  'RETENTION_NOT_ELIGIBLE', 'a protected key cannot be registered');
select pg_temp.raises(format($$select public.retention_register_artifact('generated_report', 'users/%s/generated-reports/11111111-0000-0000-0000-000000000002.pdf', %L, 10, 'Old report', '/x', null, null, now() - interval '1 day')$$, :A, :A),
  'RETENTION_NOT_PROSPECTIVE', 'a file created before the category was enabled cannot be registered');
insert into public.storage_objects (provider, namespace, object_key, byte_size, owner_user_id, category)
values ('R2', 'users', 'users/aaaaaaaa-0000-0000-0000-00000000000a/generated-reports/11111111-0000-0000-0000-000000000001.pdf', 5000, :A, 'generated-reports');
select pg_temp.ok(public.retention_register_artifact('generated_report',
  'users/aaaaaaaa-0000-0000-0000-00000000000a/generated-reports/11111111-0000-0000-0000-000000000001.pdf', :A, 5000, 'Vake report', '/verify/history') is not null,
  'a generated report registers with owner and link');
select pg_temp.ok((select storage_object_id is not null and expires_at > now() + interval '29 days'
                     from public.retention_artifacts where category = 'generated_report'), 'it links the R2 index row and expires in 30 days');
select pg_temp.ok(public.retention_register_artifacts(100) = 0, 'user-visible categories are never discovered without their producer');
select pg_temp.raises($$update public.retention_artifacts set expires_at = expires_at + interval '1 day' where category = 'generated_report'$$,
  'immutable', 'expires_at never moves');

-- ── 6. Notices: only for user-visible files, never twice, retried on failure ──
select pg_temp.ok(public.retention_artifact_notices(100) ->> 'skipped' = 'notifications_disabled', 'no notice while notices are off');
select public.retention_artifacts_configure('{"notifications_enabled": true}'::jsonb, 'test');
select pg_temp.ok((public.retention_artifact_notices(100) ->> 'queued')::int = 0, 'a file 30 days from expiry gets no notice yet');
-- Due-soon fixtures written directly (the registration path guards real ones).
insert into public.retention_artifacts (id, category, provider, bucket, object_key, owner_user_id, label, deep_link, byte_size, object_created_at, expires_at) values
  ('a0000000-0000-0000-0000-000000000001', 'generated_report', 'R2', 'users', 'users/aaaaaaaa-0000-0000-0000-00000000000a/generated-reports/a0000000-0000-0000-0000-000000000001.pdf',
   :A, 'Saburtalo report', '/verify/history', 100, now() - interval '25 days', now() + interval '5 days'),
  ('a0000000-0000-0000-0000-000000000002', 'generated_report', 'R2', 'users', 'users/aaaaaaaa-0000-0000-0000-00000000000a/generated-reports/a0000000-0000-0000-0000-000000000002.pdf',
   :A, 'Vake report', '/verify/history', 100, now() - interval '29 days 12 hours', now() + interval '12 hours'),
  ('a0000000-0000-0000-0000-000000000003', 'generated_report', 'R2', 'users', 'users/dddddddd-0000-0000-0000-00000000000d/generated-reports/a0000000-0000-0000-0000-000000000003.pdf',
   :GHOST, 'Ghost report', '/verify/history', 100, now() - interval '29 days 12 hours', now() + interval '12 hours');
select pg_temp.ok((public.retention_artifact_notices(100) ->> 'queued')::int = 2, 'a 7-day and a 1-day notice are queued');
select pg_temp.ok((select notice_7d_id is not null and notice_1d_id is null from public.retention_artifacts where id = 'a0000000-0000-0000-0000-000000000001'), 'the 5-day file got its 7-day notice');
select pg_temp.ok((select notice_1d_id is not null from public.retention_artifacts where id = 'a0000000-0000-0000-0000-000000000002'), 'the 12-hour file got its final notice');
select pg_temp.ok((select metadata ->> 'kind' = 'RETENTION_ARTIFACT_EXPIRING' and metadata ? 'expires_at' and dedupe_key like 'retention-artifact:%:1d'
                     from public.notifications where id = (select notice_1d_id from public.retention_artifacts where id = 'a0000000-0000-0000-0000-000000000002')),
  'the notice carries kind, exact expiry and a dedupe key');
select pg_temp.ok((select notice_error = 'NOTICE_NOT_QUEUED' and notice_attempts = 1 and notice_next_at > now()
                     from public.retention_artifacts where id = 'a0000000-0000-0000-0000-000000000003'), 'an undeliverable notice is recorded and retried later');
select pg_temp.ok((public.retention_artifact_notices(100) ->> 'queued')::int = 0, 'no notice is sent twice');
select pg_temp.ok((select count(*) from public.notifications where dedupe_key like 'retention-artifact:%') = 2, 'exactly two notification rows exist');

-- ── 7. Claim: kill switch, notice prerequisite, allowlist re-check ──
insert into public.retention_artifacts (id, category, provider, bucket, object_key, byte_size, object_created_at, expires_at) values
  ('b0000000-0000-0000-0000-000000000001', 'verify_document_cache', 'SUPABASE_STORAGE', 'verify-documents', 'files/900001.pdf', 3000, now() - interval '31 days', now() - interval '1 day'),
  ('b0000000-0000-0000-0000-000000000002', 'generated_report', 'R2', 'users', 'users/aaaaaaaa-0000-0000-0000-00000000000a/generated-reports/b0000000-0000-0000-0000-000000000002.pdf', 4000, now() - interval '31 days', now() - interval '1 day'),
  ('b0000000-0000-0000-0000-000000000003', 'generated_report', 'R2', 'users', 'users/aaaaaaaa-0000-0000-0000-00000000000a/design-studio-models/x.glb', 4000, now() - interval '31 days', now() - interval '1 day');
select public.retention_artifacts_configure('{"paused": true}'::jsonb, 'test');
select pg_temp.ok((select count(*) from public.retention_artifacts_claim(50)) = 0, 'paused: nothing is claimed');
select public.retention_artifacts_configure('{"paused": false}'::jsonb, 'test');
create temp table c1 as select * from public.retention_artifacts_claim(50);
select pg_temp.ok((select count(*) from c1) = 1 and (select artifact_id from c1) = 'b0000000-0000-0000-0000-000000000001'
                  and (select regeneration from c1) = 'VERIFY_TAS_DOCUMENT', 'only the due cache file is claimed, with its regeneration check');
select pg_temp.ok((select last_error = 'BLOCKED:AWAITING_NOTICE' and state = 'ACTIVE' from public.retention_artifacts where id = 'b0000000-0000-0000-0000-000000000002'),
  'a user-visible file whose owner was not told is not deleted');
select pg_temp.ok((select state = 'PROTECTED' from public.retention_artifacts where id = 'b0000000-0000-0000-0000-000000000003'),
  'a protected key that reached the registry is refused at claim time');
select pg_temp.ok((select count(*) from public.retention_artifacts_claim(50)) = 0, 'a claimed file is not handed out twice');

-- ── 8. Outcomes ──
select pg_temp.raises($$select public.retention_artifacts_outcome('b0000000-0000-0000-0000-000000000001', gen_random_uuid(), 'VERIFIED_DELETED')$$,
  'lease lost', 'a stale lease cannot report an outcome');
select public.retention_artifacts_outcome(artifact_id, lease_token, 'NOT_REGENERABLE', 'worker 502', '{"status": 502}') from c1;
select pg_temp.ok((select state = 'ACTIVE' and next_attempt_at > now() + interval '23 hours' and last_error like 'NOT_REGENERABLE%'
                     from public.retention_artifacts where id = 'b0000000-0000-0000-0000-000000000001'), 'a cache that cannot be rebuilt is kept and rechecked tomorrow');
update public.retention_artifacts set next_attempt_at = null where id = 'b0000000-0000-0000-0000-000000000001';
create temp table c2 as select * from public.retention_artifacts_claim(50);
select public.retention_artifacts_outcome(artifact_id, lease_token, 'VERIFIED_DELETED', null, '{"regenerable": true}') from c2;
select pg_temp.ok((select state = 'DELETED' and reclaimed_bytes = 3000 and verified_at is not null and regeneration_proof ->> 'regenerable' = 'true'
                     from public.retention_artifacts where id = 'b0000000-0000-0000-0000-000000000001'), 'confirmed deletion is recorded with its proof');
select pg_temp.raises($$update public.retention_artifacts set state = 'ACTIVE' where id = 'b0000000-0000-0000-0000-000000000001'$$,
  'terminal', 'DELETED is terminal');
-- R2 index follows a confirmed R2 deletion; failures back off into the dead letter.
update public.retention_artifacts set notice_1d_id = gen_random_uuid(), next_attempt_at = null, last_error = null
 where id = 'b0000000-0000-0000-0000-000000000002';
insert into public.storage_objects (provider, namespace, object_key, byte_size)
values ('R2', 'users', 'users/aaaaaaaa-0000-0000-0000-00000000000a/generated-reports/b0000000-0000-0000-0000-000000000002.pdf', 4000);
update public.retention_artifacts set storage_object_id = (select id from public.storage_objects where object_key like '%b0000000-0000-0000-0000-000000000002.pdf')
 where id = 'b0000000-0000-0000-0000-000000000002';
do $$
declare c record; i int;
begin
  for i in 1..5 loop
    update public.retention_artifacts set next_attempt_at = null where id = 'b0000000-0000-0000-0000-000000000002';
    select * into c from public.retention_artifacts_claim(50);
    perform public.retention_artifacts_outcome(c.artifact_id, c.lease_token, 'FAILED', 'r2 503');
  end loop;
end $$;
select pg_temp.ok((select state = 'DEAD_LETTER' and attempts = 5 from public.retention_artifacts where id = 'b0000000-0000-0000-0000-000000000002'), 'repeated failures end in the dead letter');
select pg_temp.ok(public.retention_artifacts_requeue('b0000000-0000-0000-0000-000000000002'), 'an admin can retry a dead letter');
create temp table c3 as select * from public.retention_artifacts_claim(50);
select public.retention_artifacts_outcome(artifact_id, lease_token, 'VERIFIED_DELETED') from c3;
select pg_temp.ok((select lifecycle = 'DELETED' from public.storage_objects where object_key like '%b0000000-0000-0000-0000-000000000002.pdf'),
  'the R2 index row is marked deleted only after the confirmed delete');

-- ── 9. Admin views and the automatic run ──
select pg_temp.ok(jsonb_array_length(public.retention_artifacts_status() -> 'categories') = 4
                  and jsonb_array_length(public.retention_artifacts_status() -> 'protected') >= 6, 'status lists categories and protected areas');
select pg_temp.ok((select count(*) from public.retention_artifacts_list('DELETED', 50)) = 2, 'deleted list');
select pg_temp.ok((select count(*) from public.retention_artifacts_list('NOTICES', 50)) >= 3, 'notice history');
select pg_temp.ok((public.retention_artifacts_preview() ->> 'paused') = 'false', 'preview reports the kill switch');
select pg_temp.raises($$select public.retention_artifacts_configure('{"purge_enabled": true}'::jsonb)$$, 'RETENTION_UNKNOWN_SETTING', 'record-level keys are refused here too');
select public.retention_artifacts_configure('{"auto_run": true}'::jsonb, 'test');
select pg_temp.ok((select count(*) = 1 from cron.job where jobname = 'homatch-storage-retention'), 'the automatic run is one cron job');
select public.retention_artifacts_configure('{"auto_run": true}'::jsonb, 'test');
select pg_temp.ok((select count(*) = 1 from cron.job where jobname = 'homatch-storage-retention'), 'switching it on twice never duplicates the job');
select public.retention_artifacts_configure('{"auto_run": false}'::jsonb, 'test');
select pg_temp.ok((select count(*) = 0 from cron.job where jobname = 'homatch-storage-retention'), 'switching it off removes the job');
select pg_temp.ok((select count(*) from public.retention_artifacts_events(200) where event in ('OBJECT_DELETED', 'CLAIMED', 'NOTICE_QUEUED', 'ARTIFACT_CONFIG_CHANGED', 'KEPT_NOT_REGENERABLE', 'DELETE_FAILED')) >= 10,
  'every step is in the audit log');
select pg_temp.ok((select count(*) from public.retention_records) = (select n from rec_before), 'object-level retention never touches the record-level registry');

-- ── 10. Privileges ──
select pg_temp.ok(not has_function_privilege('authenticated', 'public.retention_artifacts_claim(integer,integer)', 'execute')
                  and not has_function_privilege('authenticated', 'public.retention_artifacts_outcome(uuid,uuid,text,text,jsonb)', 'execute')
                  and not has_function_privilege('authenticated', 'public.retention_register_artifact(text,text,uuid,bigint,text,text,text,uuid,timestamptz)', 'execute')
                  and not has_function_privilege('anon', 'public.retention_artifacts_status()', 'execute')
                  and not has_table_privilege('authenticated', 'public.retention_artifacts', 'select'), 'the engine and registry are service-only');
