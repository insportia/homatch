-- Proof for 20261108090000_publishing_central_accounts.sql, applied after
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

-- ── Backend browser automation: operations, sessions, the submit-once door ──
select public.publishing_account_write(:A, 'ssge', '{"status":"PUBLISHING_RESTRICTED","connection_method":"BROWSER_SESSION","account_label":"homatch@ssge","contact_phone":"+995322000111"}', 'REGISTER');
select pg_temp.expect_error(format('select public.publishing_account_write(%L,%L,%L,%L)', :A, 'ssge', '{"live_submit_approved":true}', 'AUTOMATION'), 'publishing_accounts_live_submit_approval');
select public.publishing_account_write(:A, 'ssge', format('{"automation_enabled":true,"live_submit_approved":true,"live_submit_approved_by":"%s","live_submit_approved_at":"2026-10-16T00:00:00Z"}', 'aaaaaaaa-0000-0000-0000-00000000000a')::jsonb, 'AUTOMATION');
select pg_temp.ok((select automation_enabled and live_submit_approved from public.publishing_accounts where portal_id = 'ssge'), 'automation switches stored and audited');
select pg_temp.ok((select count(*) from public.publishing_account_audit where portal_id = 'ssge' and action = 'AUTOMATION') = 1, 'automation change audited');
select pg_temp.expect_error($$insert into public.publishing_account_sessions(portal_id, envelope) values ('ssge', '{"cookies":[]}')$$, 'publishing_account_sessions_envelope_check');
-- A central publication to operate on (listing P2 was archived above; restore it).
select public.publishing_listing_lifecycle(:A, :P2, 'RESTORE');
select public.publishing_publication_write(:A, :P2, 'ssge', (select revision from public.publishing_engine_jobs where listing_id = :P2 and portal_id = 'ssge'),
  '{"status":"QUEUED","channel":"HOMATCH_ACCOUNT","contact_consent_at":"2026-10-16T00:00:00Z"}', '{"kind":"PUBLISH_REQUESTED"}');
create temp table v as select id as pub from public.publishing_engine_jobs where listing_id = :P2 and portal_id = 'ssge';
select public.publishing_op_enqueue((select pub from v), 'ssge', 'CREATE', 1, '{}', 'k1');
select pg_temp.ok((select id from public.publishing_op_enqueue((select pub from v), 'ssge', 'CREATE', 1, '{}', 'k1')) = (select id from public.publishing_operations where idempotency_key = 'k1'), 'same idempotency key returns the same operation');
select pg_temp.expect_error(format('select public.publishing_op_enqueue(%L,%L,%L,1,%L,%L)', (select pub from v), 'ssge', 'UPDATE', '{}', 'k2'), 'OPERATION_ALREADY_ACTIVE');
select pg_temp.expect_error(format('select public.publishing_op_enqueue(%L,%L,%L,1,%L,%L)', (select pub from v), 'myhome', 'CREATE', '{}', 'k3'), 'PUBLICATION_NOT_FOUND');
-- No session: nothing is claimed.
select pg_temp.ok((select count(*) from public.publishing_op_claim('w1', array['ssge'], 120)) = 0, 'no session, no claim');
insert into public.publishing_account_sessions(portal_id, envelope, status) values ('ssge', '{"v":1,"kid":"k","iv":"i","ct":"c"}', 'VALID');
create temp table c1 as select * from public.publishing_op_claim('w1', array['ssge'], 120);
select pg_temp.ok((select count(*) from c1) = 1 and (select status from c1) = 'RUNNING' and (select attempts from c1) = 1, 'claimed once');
select pg_temp.ok((select count(*) from public.publishing_op_claim('w2', array['ssge'], 120)) = 0, 'one running operation per portal account');
select pg_temp.ok(public.publishing_op_heartbeat((select id from c1), (select lease_token from c1), 'FILLING', 120), 'heartbeat with the lease');
select pg_temp.ok(not public.publishing_op_heartbeat((select id from c1), gen_random_uuid(), 'FILLING', 120), 'a stale token cannot heartbeat');
-- A retryable failure before submit goes back to the queue with backoff.
select public.publishing_op_finish((select id from c1), (select lease_token from c1), 'FAILED', '{}', 'PORTAL_TIMEOUT', true);
select pg_temp.ok((select status = 'QUEUED' and available_at > now() and stage = 'RETRY_WAIT' from public.publishing_operations where idempotency_key = 'k1'), 'retry with backoff');
update public.publishing_operations set available_at = now() where idempotency_key = 'k1';
create temp table c2 as select * from public.publishing_op_claim('w1', array['ssge'], 120);
select pg_temp.ok(public.publishing_op_mark_submitting((select id from c2), (select lease_token from c2)), 'submit door opens once');
select pg_temp.ok(not public.publishing_op_mark_submitting((select id from c2), (select lease_token from c2)), 'and never twice');
-- The worker dies after pressing publish: the lease expires; the operation is NOT re-queued.
update public.publishing_operations set lease_until = now() - interval '1 second' where idempotency_key = 'k1';
select pg_temp.ok((select count(*) from public.publishing_op_claim('w3', array['ssge'], 120)) = 0, 'nothing to claim after a lost submit');
select pg_temp.ok((select status = 'RECONCILIATION_REQUIRED' and last_error = 'LEASE_LOST_AFTER_SUBMIT' from public.publishing_operations where idempotency_key = 'k1'), 'crash after submit needs reconciliation, never a second submit');
select pg_temp.expect_error(format('select public.publishing_op_finish(%L,%L,%L,%L,%L,%L)', (select id from c2), (select lease_token from c2), 'SUCCEEDED', '{}', null, false), 'LEASE_CONFLICT');
-- A failure reported after submit is reconciliation too, even if marked retryable.
select public.publishing_op_enqueue((select pub from v), 'ssge', 'STATUS', 1, '{}', 'k4');
create temp table c3 as select * from public.publishing_op_claim('w1', array['ssge'], 120);
select public.publishing_op_mark_submitting((select id from c3), (select lease_token from c3));
select pg_temp.ok((public.publishing_op_finish((select id from c3), (select lease_token from c3), 'FAILED', '{}', 'NO_RESULT_URL', true)).status = 'RECONCILIATION_REQUIRED', 'failed after submit -> reconciliation');
-- Automation switched off: queued work waits; CHECK_SESSION still runs.
select public.publishing_account_write(:A, 'ssge', '{"automation_enabled":false}', 'AUTOMATION');
select public.publishing_op_enqueue((select pub from v), 'ssge', 'UPDATE', 1, '{}', 'k5');
select public.publishing_op_enqueue(null, 'ssge', 'CHECK_SESSION', null, '{}', 'k6');
create temp table c4 as select * from public.publishing_op_claim('w1', array['ssge'], 120);
select pg_temp.ok((select kind from c4) = 'CHECK_SESSION', 'with automation off only the session check runs');
select pg_temp.expect_error($$select public.publishing_op_claim('w', array['ssge'], 5)$$, 'INVALID_LEASE');
select pg_temp.ok(not has_table_privilege('authenticated', 'public.publishing_operations', 'select'), 'authenticated cannot read operations');
select pg_temp.ok(not has_table_privilege('authenticated', 'public.publishing_account_sessions', 'select'), 'authenticated cannot read sessions');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.publishing_op_claim(text,text[],integer)', 'execute'), 'authenticated cannot claim');
select pg_temp.ok((select not public from storage.buckets where id = 'publishing-artifacts'), 'artifacts bucket is private');
-- Retention: fresh screenshots stay; 30-day-old and orphaned ones (listing deleted) are due.
insert into public.publishing_artifacts(operation_id, kind, stage, path) values
  ((select id from c4), 'SCREENSHOT', 'FRESH', (select id from c4)::text || '/FRESH-1.png'),
  ((select id from c4), 'SCREENSHOT', 'OLD', (select id from c4)::text || '/OLD-1.png');
update public.publishing_artifacts set created_at = now() - interval '31 days' where stage = 'OLD';
select pg_temp.ok((select string_agg(path, ',') from public.publishing_artifacts_due(100)) like '%OLD-1.png' and (select count(*) from public.publishing_artifacts_due(100)) = 1, 'only the 30-day-old screenshot is due');
delete from public.publishing_operations where id = (select id from c4);
select pg_temp.ok((select count(*) from public.publishing_artifacts where operation_id is null) = 2, 'deleting the operation keeps the rows (set null) so their objects can still be removed');
select pg_temp.ok((select count(*) from public.publishing_artifacts_due(100)) = 2, 'orphaned screenshots are due at once');
select pg_temp.ok(public.publishing_artifacts_forget((select array_agg(id) from public.publishing_artifacts_due(100))) = 2, 'forget removes exactly the due rows');
select pg_temp.ok(not exists (select 1 from public.publishing_artifacts), 'nothing left behind');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.publishing_artifacts_due(integer)', 'execute'), 'authenticated cannot list artifacts');

-- Privileges: no browser role touches accounts, their audit or the RPC.
select pg_temp.ok(not has_table_privilege('authenticated', 'public.publishing_accounts', 'select'), 'authenticated cannot read accounts');
select pg_temp.ok(not has_table_privilege('anon', 'public.publishing_accounts', 'select'), 'anon cannot read accounts');
select pg_temp.ok(not has_table_privilege('authenticated', 'public.publishing_account_audit', 'select'), 'authenticated cannot read account audit');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.publishing_account_write(uuid,text,jsonb,text)', 'execute'), 'authenticated cannot write accounts');
select pg_temp.ok(has_function_privilege('service_role', 'public.publishing_account_write(uuid,text,jsonb,text)', 'execute'), 'service_role can write accounts');
select pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.publishing_accounts'::regclass), 'accounts RLS on');
select pg_temp.ok(not exists (select 1 from pg_policies where tablename in ('publishing_accounts', 'publishing_account_audit')), 'no policies: service role only');
\echo 'publishing central accounts migration proof: PASS'
