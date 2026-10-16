-- Proof for 20261107090000_publishing_central_accounts.sql, applied after
-- providers.sql left publications in place on listing P2.
\set A '''aaaaaaaa-0000-0000-0000-00000000000a'''
\set B '''bbbbbbbb-0000-0000-0000-00000000000b'''
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

-- Eight accounts, all unconfigured; existing publications kept, channel defaulted.
select pg_temp.ok((select count(*) from public.publishing_accounts where status = 'NOT_CONFIGURED') = 8, 'eight unconfigured accounts');
select pg_temp.ok((select bool_and(channel = 'OWNER_HANDOFF') from public.publishing_engine_jobs), 'existing publications are owner handoffs');
select pg_temp.ok((select count(*) from public.publishing_engine_jobs) >= 3, 'existing publications kept');

-- Register: identity + phone, never a verified status.
select public.publishing_account_write(:A, 'myhome', '{"status":"PUBLISHING_RESTRICTED","connection_method":"MANUAL","account_label":"homatch@myhome","contact_phone":"+995322000111"}', 'REGISTER');
select pg_temp.ok((select status = 'PUBLISHING_RESTRICTED' and updated_by = :A from public.publishing_accounts where portal_id = 'myhome'), 'registered');
select pg_temp.expect_error(format('select public.publishing_account_write(%L,%L,%L,%L)', :A, 'myhome', '{"status":"CONNECTED"}', 'UPDATE'), 'VERIFICATION_REQUIRED');
select pg_temp.expect_error(format('select public.publishing_account_write(%L,%L,%L,%L)', :A, 'myhome', '{"status":"PUBLISHING_AVAILABLE"}', 'TEST'), 'publishing_accounts_verified_status');
select pg_temp.expect_error(format('select public.publishing_account_write(%L,%L,%L,%L)', :A, 'ssge', '{"status":"PUBLISHING_RESTRICTED"}', 'REGISTER'), 'publishing_accounts_configured_identity');
select pg_temp.expect_error(format('select public.publishing_account_write(%L,%L,%L,%L)', :A, 'myhome', '{"contact_phone":"599123"}', 'UPDATE'), 'publishing_accounts_contact_phone_check');
select pg_temp.expect_error(format('select public.publishing_account_write(%L,%L,%L,%L)', :A, 'myhome', '{"credential":{"ct":"x","iv":"y"}}', 'UPDATE'), 'FIELD_NOT_EDITABLE');
select pg_temp.expect_error(format('select public.publishing_account_write(%L,%L,%L,%L)', :A, 'myhome', '{"credential":{"secret":"hunter2","ct":"x","iv":"y"}}', 'CREDENTIAL_SET'), 'publishing_accounts_credential_check');
select pg_temp.expect_error(format('select public.publishing_account_write(%L,%L,%L,%L)', :A, 'myhome', '{"failure_count":1}', 'NOPE'), 'INVALID_ACTION');
-- A verified status with a verification timestamp, from a TEST, is storable.
select public.publishing_account_write(:A, 'myhome', '{"status":"CONNECTED","verified_at":"2026-10-16T00:00:00Z","verification_result":"OK"}', 'TEST');
select pg_temp.ok((select status from public.publishing_accounts where portal_id = 'myhome') = 'CONNECTED', 'verified test stored');
-- The credential never reaches the audit or the RPC's answer.
select pg_temp.ok((public.publishing_account_write(:A, 'myhome', '{"credential":{"v":1,"kid":"k","ct":"CIPHER","iv":"IV"},"credential_set_at":"2026-10-16T00:00:00Z"}', 'CREDENTIAL_SET') ? 'credential') = false, 'RPC answer has no credential');
select pg_temp.ok((select count(*) from public.publishing_account_audit where before::text like '%CIPHER%' or after::text like '%CIPHER%') = 0, 'audit has no credential');
select pg_temp.ok((select count(*) from public.publishing_account_audit where portal_id = 'myhome') = 3, 'every change audited');
select public.publishing_account_write(:A, 'myhome', '{"last_published_at":"2026-10-16T00:00:00Z"}', 'ACTIVITY');
select pg_temp.ok((select count(*) from public.publishing_account_audit where portal_id = 'myhome') = 3, 'activity is not audited');
select public.publishing_account_write(:A, 'myhome', '{"status":"NOT_CONFIGURED","connection_method":null,"account_label":null,"contact_phone":null,"credential":null,"credential_set_at":null,"verified_at":null}', 'DISCONNECT');
select pg_temp.ok((select status = 'NOT_CONFIGURED' and credential is null and account_label is null from public.publishing_accounts where portal_id = 'myhome'), 'disconnect clears identity and credential');

-- Central publications: consent required, new statuses, central columns written.
select pg_temp.expect_error(format('select public.publishing_publication_write(%L,%L,%L,-1,%L,%L)', :A, :P2, 'homege', '{"status":"ADMIN_ACTION_REQUIRED","channel":"HOMATCH_ACCOUNT"}', '{}'), 'publishing_engine_jobs_central_consent');
select public.publishing_publication_write(:A, :P2, 'homege', -1, '{"status":"ADMIN_ACTION_REQUIRED","channel":"HOMATCH_ACCOUNT","contact_consent_at":"2026-10-16T00:00:00Z","listing_version":1}', '{"kind":"PUBLISH_REQUESTED"}');
select public.publishing_publication_write(:A, :P2, 'homege', 0, format('{"status":"PUBLISHING","admin_claimed_by":"%s","admin_claimed_at":"2026-10-16T00:01:00Z"}', 'bbbbbbbb-0000-0000-0000-00000000000b')::jsonb, '{"kind":"ADMIN_CLAIMED"}');
select pg_temp.ok((select status = 'PUBLISHING' and admin_claimed_by = :B and channel = 'HOMATCH_ACCOUNT' from public.publishing_engine_jobs where listing_id = :P2 and portal_id = 'homege'), 'claim recorded');
select public.publishing_publication_write(:A, :P2, 'homege', 1, '{"status":"REJECTED","status_reason":"photos"}', '{"kind":"PORTAL_REJECTED"}');
select pg_temp.ok((select status_reason from public.publishing_engine_jobs where listing_id = :P2 and portal_id = 'homege') = 'photos', 'rejection reason stored');
select pg_temp.expect_error(format('select public.publishing_publication_write(%L,%L,%L,2,%L,%L)', :A, :P2, 'homege', '{"status":"DONE"}', '{}'), 'publishing_engine_jobs_status_check');
-- A queued central publication blocks archiving.
select public.publishing_publication_write(:A, :P2, 'homege', 2, '{"status":"QUEUED"}', '{}');
update public.publishing_engine_jobs set status = 'UNPUBLISHED' where listing_id = :P2 and portal_id <> 'homege';
select pg_temp.expect_error(format('select public.publishing_listing_lifecycle(%L,%L,%L)', :A, :P2, 'ARCHIVE'), 'LIVE_PUBLICATIONS_EXIST');
update public.publishing_engine_jobs set status = 'UNPUBLISHED' where listing_id = :P2;
select pg_temp.ok((public.publishing_listing_lifecycle(:A, :P2, 'ARCHIVE')->>'archived_at') is not null, 'archive once nothing is pending');

-- Privileges: no browser role touches accounts, their audit or the RPC.
select pg_temp.ok(not has_table_privilege('authenticated', 'public.publishing_accounts', 'select'), 'authenticated cannot read accounts');
select pg_temp.ok(not has_table_privilege('anon', 'public.publishing_accounts', 'select'), 'anon cannot read accounts');
select pg_temp.ok(not has_table_privilege('authenticated', 'public.publishing_account_audit', 'select'), 'authenticated cannot read account audit');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.publishing_account_write(uuid,text,jsonb,text)', 'execute'), 'authenticated cannot write accounts');
select pg_temp.ok(has_function_privilege('service_role', 'public.publishing_account_write(uuid,text,jsonb,text)', 'execute'), 'service_role can write accounts');
select pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.publishing_accounts'::regclass), 'accounts RLS on');
select pg_temp.ok(not exists (select 1 from pg_policies where tablename in ('publishing_accounts', 'publishing_account_audit')), 'no policies: service role only');
\echo 'publishing central accounts migration proof: PASS'
