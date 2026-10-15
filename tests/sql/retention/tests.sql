-- Assertions for 20261102090000_storage_retention_lifecycle.sql. Each block
-- raises on failure; run.sh prints RETENTION SQL: PASS only if all ran.
\set ON_ERROR_STOP 1
\set A '''aaaaaaaa-0000-0000-0000-00000000000a'''
\set B '''bbbbbbbb-0000-0000-0000-00000000000b'''
\set ADM '''cccccccc-0000-0000-0000-00000000000c'''

create function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is distinct from true then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;

insert into public.users (auth_id, is_admin) values (:ADM, true), (:A, false), (:B, false);

-- ── 1. One expiry rule: exactly 30 UTC days, whatever the session time zone ──
set timezone = 'America/New_York';  -- crosses a DST change below
select pg_temp.ok(public.retention_expiry('2026-10-20 12:00:00+00') = '2026-11-19 12:00:00+00', 'expiry = +30 UTC days across a DST change');
select pg_temp.ok(public.retention_expiry('2026-10-20 12:00:00+00') - '2026-10-20 12:00:00+00'::timestamptz = interval '720 hours', 'expiry is exactly 720 hours');
reset timezone;

-- ── fixtures: A's reports (one created long ago but completed recently), B's report, contracts ──
insert into public.research_jobs (id, user_id, status, created_at, completed_at, synthesis_state, synthesis_at, title, query, result_json, synthesis_json) values
 ('10000000-0000-0000-0000-000000000001', :A, 'COMPLETE', now() - interval '90 days', now() - interval '40 days', 'READY', now() - interval '40 days', 'Vake flat', 'Tbilisi, Vake str 1',
   '{"market":{"comparables":[
      {"url":"https://www.myhome.ge/pr/111","price":"120000","currency":"usd","area":"80 m²","pricePerSqm":"1500","district":"Vake","rooms":"3","floor":"5","condition":"renovated","propertyType":"RESIDENTIAL","listingStatus":"ACTIVE","comparableType":"MICRO_LOCATION","marketplaceSource":"myhome","address":"Chavchavadze ave 10, apt 4","project":"Some Tower"},
      {"url":"https://www.myhome.ge/pr/111","price":"120000","currency":"USD","area":"80","pricePerSqm":"1500","district":"Vake"},
      {"url":"https://ss.ge/x/222","price":"90000","currency":"USD","area":"80-90","pricePerSqm":"about 1100","district":"Saburtalo 12"},
      {"url":"https://ss.ge/x/333","price":"100000","currency":"USD","area":"100","district":"Saburtalo","condition":"call +995 555 12 34 56"},
      {"price":"50000","currency":"USD","pricePerSqm":"900"},
      {"url":"https://x.ge/444","price":"1","currency":"BTC","pricePerSqm":"1000"}
   ]},"_marketRefresh":{"state":"DONE"}}',
   '{"officialDocuments":[{"files":[{"attachedFileId":"5551","format":"pdf"}]}]}'),
 ('10000000-0000-0000-0000-000000000002', :A, 'COMPLETE', now() - interval '60 days', now() - interval '10 days', 'READY', now() - interval '10 days', null, 'q2',
   '{"market":{"comparables":[]}}', '{"officialDocuments":[{"files":[{"attachedFileId":"5551","format":"pdf"}]}]}'),
 ('10000000-0000-0000-0000-000000000003', :B, 'COMPLETE', now() - interval '50 days', now() - interval '45 days', 'READY', now() - interval '45 days', null, 'q3',
   '{"_marketRefresh":{"state":"RUNNING"}}', '{}'),
 ('10000000-0000-0000-0000-000000000004', :A, 'RUNNING', now(), null, 'NONE', null, null, 'q4', null, null),
 ('10000000-0000-0000-0000-000000000005', :A, 'COMPLETE', now() - interval '40 days', now() - interval '35 days', 'READY', now() - interval '35 days', null, 'q5', '{}', '{}');
insert into public.verify_billing (job_id, amount) values ('10000000-0000-0000-0000-000000000001', 25);
insert into public.deal_rooms (id, user_id, verify_job_id, verify_snapshot) values
 ('20000000-0000-0000-0000-000000000001', :A, '10000000-0000-0000-0000-000000000001', '{"facts":["copied report facts"]}'),
 ('20000000-0000-0000-0000-000000000002', :B, null, null);
insert into public.deal_room_documents (id, deal_room_id, user_id, doc_key, label, storage_path, size_bytes, uploaded_at, analysis_state, analyzed_at, analysis, extracted_text, original_filename, category, created_at) values
 ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', :A, 'upload:abc', 'Lease.pdf',
   'aaaaaaaa-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001.pdf', 1000,
   now() - interval '50 days', 'DONE', now() - interval '42 days', '{"summary":"private"}', 'full private text', 'Lease.pdf', 'CONTRACT', now() - interval '50 days'),
 ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', :B, 'upload:def', 'Sale.pdf',
   'bbbbbbbb-0000-0000-0000-00000000000b/20000000-0000-0000-0000-000000000002/30000000-0000-0000-0000-000000000002.pdf', 2000,
   now() - interval '5 days', 'DONE', now() - interval '5 days', '{"summary":"b"}', 'b text', 'Sale.pdf', 'CONTRACT', now() - interval '5 days'),
 ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', :A, 'checklist:ownership', 'Ownership', null, null,
   null, 'NONE', null, null, null, null, null, now() - interval '50 days');
insert into public.deal_room_document_findings (document_id, deal_room_id, user_id, finding_type, label, value, severity) values
 ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', :A, 'PENALTY_CLAUSE', 'Penalty', 'GEL 5000 to Giorgi', 'HIGH');
insert into public.deal_room_document_events (document_id, deal_room_id, user_id, event_type, detail) values
 ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', :A, 'UPLOADED', '{"filename":"Lease.pdf"}');
insert into storage.objects (bucket_id, name, metadata) values
 ('deal-room-documents', 'aaaaaaaa-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001.pdf', '{"size":1000}'),
 ('deal-room-documents', 'bbbbbbbb-0000-0000-0000-00000000000b/20000000-0000-0000-0000-000000000002/30000000-0000-0000-0000-000000000002.pdf', '{"size":2000}'),
 ('verify-documents', 'files/5551.pdf', '{"size":5000}');
insert into public.storage_objects (provider, namespace, object_key, byte_size, source_bucket, source_path) values
 ('R2', 'deal-room-documents', 'deal-room-documents/aaaaaaaa-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001.pdf', 1000,
  'deal-room-documents', 'aaaaaaaa-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001.pdf');

-- ── 2. Seeded OFF: registration records nothing as expiring, gates deny nothing ──
select pg_temp.ok((public.retention_config() ->> 'purge_enabled')::boolean = false, 'purge seeded off');
select public.retention_register_due(100);
select pg_temp.ok((select count(*) from public.retention_records) = 6, 'registered 4 complete reports + 2 contract files (not the checklist row, not the running job)');
select pg_temp.ok((select count(*) from public.retention_records where expires_at is not null) = 0, 'policy off: nothing gets an expiry date');
select pg_temp.ok((select count(*) from public.retention_objects where provider = 'R2') = 1, 'R2 copy of the contract file registered');
select public.retention_register_due(100);
select pg_temp.ok((select count(*) from public.retention_records) = 6, 'registration is idempotent');

-- ── 3. Policy effective 45 days ago, no legacy grace: only new records expire; expiry runs from completion, not creation ──
update public.admin_settings set value = value || jsonb_build_object('effective_at', now() - interval '45 days') where key = 'storage_retention';
select public.retention_register_due(100);
select pg_temp.ok((select policy from public.retention_records where source_id = '10000000-0000-0000-0000-000000000002') = 'STANDARD_30D', 'created 60d ago, completed 10d ago -> standard policy');
select pg_temp.ok((select expires_at > now() from public.retention_records where source_id = '10000000-0000-0000-0000-000000000002'), 'and not expired: 30 days run from completion');
select pg_temp.ok((select expires_at < now() from public.retention_records where source_id = '10000000-0000-0000-0000-000000000001'), 'completed 40d ago -> expired');

-- ── 4. expires_at never moves ──
do $$ begin
  update public.retention_records set expires_at = expires_at + interval '1 day' where source_id = '10000000-0000-0000-0000-000000000001';
  raise exception 'FAIL: expires_at was extended';
exception when check_violation then raise notice 'ok  expires_at is immutable once set';
end $$;

-- ── 5. Access expiry, server-side, per user ──
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-00000000000a', true);
select pg_temp.ok((select count(*) from public.research_jobs where id = '10000000-0000-0000-0000-000000000001') = 0, 'expired report: direct API read denied');
select pg_temp.ok((select count(*) from public.research_jobs where id = '10000000-0000-0000-0000-000000000002') = 1, 'live report still opens during retention');
select pg_temp.ok((select count(*) from public.research_jobs where id = '10000000-0000-0000-0000-000000000003') = 0, 'another user''s report stays invisible');
select pg_temp.ok((select count(*) from public.deal_room_documents where id = '30000000-0000-0000-0000-000000000001') = 0, 'expired contract hidden');
select pg_temp.ok((select count(*) from public.deal_room_documents where id = '30000000-0000-0000-0000-000000000003') = 1, 'checklist row (no file) unaffected');
select pg_temp.ok((select count(*) from public.deal_room_document_findings) = 0, 'expired contract findings hidden');
select pg_temp.ok((select count(*) from storage.objects where bucket_id = 'deal-room-documents') = 0, 'no signed URL for an expired contract file (storage SELECT denied)');
select pg_temp.ok((select count(*) from public.retention_my_records('VERIFY_REPORT') where expired) = 2, 'tombstones listed for the owner');
select pg_temp.ok((select count(*) from public.retention_my_records('VERIFY_REPORT', array['10000000-0000-0000-0000-000000000003'::uuid])) = 0, 'no tombstone of another user');
commit;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-00000000000b', true);
select pg_temp.ok((select count(*) from storage.objects where bucket_id = 'deal-room-documents') = 1, 'B''s live contract file still signable');
select pg_temp.ok((select count(*) from public.deal_room_documents) = 1, 'B''s live contract still readable');
commit;

-- ── 6. Destructive gate off -> nothing claimed ──
select pg_temp.ok((select count(*) from public.retention_claim(10)) = 0, 'purge disabled: claim returns nothing');

-- ── 7. Legal hold + blockers ──
update public.admin_settings set value = value || '{"purge_enabled": true, "legacy_grace_until": "2000-01-01T00:00:00Z"}'::jsonb where key = 'storage_retention';
select public.retention_register_due(100);  -- legacy job 3 now gets an expiry (grace in the past)
select id as hold_id from public.retention_records where source_id = '10000000-0000-0000-0000-000000000005' \gset
set role authenticated;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-00000000000c', false);
select pg_temp.ok(public.retention_admin_set_hold(:'hold_id', true, 'court order 12/2026'), 'admin sets a legal hold with a reason');
reset role;
select set_config('request.jwt.claim.sub', '', false);
-- Verify reports need their document references scanned before they can go.
select public.retention_add_object_refs(id, case when source_id in ('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002')
                                                  then '[{"key":"files/5551.pdf"}]'::jsonb else '[]'::jsonb end)
  from public.retention_records where product = 'VERIFY_REPORT';

-- ── 8. Concurrency: two workers never claim the same record ──
create temp table claim1 as select * from public.retention_claim(1);
create temp table claim2 as select * from public.retention_claim(10);
select pg_temp.ok((select count(*) from claim1 c1 join claim2 c2 using (record_id)) = 0, 'claims are disjoint');
select pg_temp.ok((select count(*) from public.retention_records r join claim2 c on c.record_id = r.id where r.legal_hold) = 0, 'legal hold never claimed');
select pg_temp.ok((select last_error from public.retention_records where source_id = '10000000-0000-0000-0000-000000000003') = 'BLOCKED:ACTIVE_MARKET_REFRESH', 'active market refresh blocks deletion');
select pg_temp.ok((select count(*) from (select * from claim1 union all select * from claim2) c) = 2, 'claimed: expired report 1 and expired contract 1');

-- ── 9. Objects: exclusive file deleted, shared official document retained while another report is live ──
create temp table plan_all as
  select c.record_id, c.lease_token, p.* from (select * from claim1 union all select * from claim2) c,
    lateral public.retention_object_plan(c.record_id, c.lease_token) p;
select pg_temp.ok((select action from plan_all where object_key = 'files/5551.pdf') = 'RETAIN', 'shared official document retained (report 2 still live)');
select pg_temp.ok((select count(*) from plan_all where action = 'DELETE') = 2, 'contract file + its R2 copy scheduled for deletion');
do $$ begin
  perform public.retention_purge_payload((select record_id from plan_all where action = 'DELETE' limit 1),
                                         (select lease_token from plan_all where action = 'DELETE' limit 1));
  raise exception 'FAIL: payload purged before its objects';
exception when object_not_in_prerequisite_state then raise notice 'ok  payload is never purged before its objects are tracked as deleted';
end $$;
do $$ begin
  perform public.retention_object_plan((select record_id from plan_all limit 1), gen_random_uuid());
  raise exception 'FAIL: wrong lease accepted';
exception when lock_not_available then raise notice 'ok  a stale/foreign lease is refused';
end $$;

-- partial provider failure, then success on retry
select public.retention_object_outcome(record_id, lease_token, object_id, 'FAILED', 'R2 503') from plan_all where provider = 'R2';
select pg_temp.ok((select state from public.retention_objects where provider = 'R2') = 'FAILED', 'R2 failure recorded, retryable');
select public.retention_record_failed(record_id, lease_token, 'R2 503') from plan_all where provider = 'R2';
select pg_temp.ok((select state from public.retention_records r join plan_all p on p.record_id = r.id where p.provider = 'R2') = 'FAILED', 'record backs off after partial failure');
select pg_temp.ok((select count(*) from storage.objects where bucket_id = 'deal-room-documents') = 2, 'nothing removed by the database itself');
update public.retention_records set next_attempt_at = now() - interval '1 second' where state = 'FAILED';
create temp table claim3 as select * from public.retention_claim(10);
create temp table plan3 as select c.record_id, c.lease_token, p.* from claim3 c, lateral public.retention_object_plan(c.record_id, c.lease_token) p;
-- the engine deletes from the provider, then confirms; here the fixture plays the provider
delete from storage.objects where bucket_id = 'deal-room-documents' and name in (select object_key from plan3 where provider = 'SUPABASE_STORAGE' and action = 'DELETE');
select public.retention_object_outcome(record_id, lease_token, object_id, 'VERIFIED_DELETED')
  from plan3 where action = 'DELETE' and (provider <> 'SUPABASE_STORAGE' or not public.retention_storage_object_exists(bucket, object_key));
select public.retention_purge_payload(record_id, lease_token) from claim3 where product = 'CONTRACT_DOCUMENT';
select pg_temp.ok((select lifecycle from public.storage_objects) = 'DELETED', 'R2 index row marked DELETED after verified deletion');

select public.retention_object_outcome(record_id, lease_token, object_id, 'RETAINED') from plan_all where object_key = 'files/5551.pdf';
select public.retention_purge_payload(record_id, lease_token) from (select * from claim1 union all select * from claim2) c where product = 'VERIFY_REPORT';

-- ── 10. Tombstones: payload physically gone, ledger and identity kept ──
select pg_temp.ok((select result_json is null and synthesis_json is null and query = '' and title is null and lifecycle_state = 'PURGED'
                     and status = 'COMPLETE' and deleted_at is not null
                   from public.research_jobs where id = '10000000-0000-0000-0000-000000000001'), 'Verify payload cleared, status kept, PURGED');
select pg_temp.ok((select count(*) from public.verify_billing where job_id = '10000000-0000-0000-0000-000000000001') = 1, 'billing row intact');
select pg_temp.ok((select verify_snapshot is null from public.deal_rooms where id = '20000000-0000-0000-0000-000000000001'), 'duplicated report snapshot in the deal room cleared');
select pg_temp.ok((select analysis is null and extracted_text is null and storage_path is null and original_filename is null and doc_key like 'expired:%'
                   from public.deal_room_documents where id = '30000000-0000-0000-0000-000000000001'), 'contract tombstone: no analysis, file, filename; doc_key freed');
select pg_temp.ok((select count(*) from public.deal_room_document_findings where document_id = '30000000-0000-0000-0000-000000000001') = 0, 'findings deleted');
select pg_temp.ok((select detail = '{}'::jsonb from public.deal_room_document_events where document_id = '30000000-0000-0000-0000-000000000001'), 'event detail stripped');
select pg_temp.ok((select count(*) from storage.objects where bucket_id = 'verify-documents') = 1, 'shared official document still present');
select pg_temp.ok((select count(*) from public.retention_records where state = 'PURGED') = 2, 'two records purged and verified');
select pg_temp.ok((select reclaimed_bytes > 0 from public.retention_records where source_id = '30000000-0000-0000-0000-000000000001'), 'reclaimed bytes measured');
-- the same file can be uploaded into the same room again
insert into public.deal_room_documents (deal_room_id, user_id, doc_key, label) values ('20000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'upload:abc', 'Lease.pdf');
do $$ begin
  update public.retention_records set state = 'ACTIVE' where state = 'PURGED';
  raise exception 'FAIL: PURGED was revived';
exception when check_violation then raise notice 'ok  PURGED is terminal';
end $$;

-- ── 11. Retry exhaustion -> dead letter ──
update public.admin_settings set value = value || '{"max_attempts": 2}'::jsonb where key = 'storage_retention';
-- report 3's market refresh has finished: it becomes claimable, and its provider keeps failing
update public.research_jobs set result_json = '{"_marketRefresh":{"state":"FOLDED"}}' where id = '10000000-0000-0000-0000-000000000003';
update public.retention_records set next_attempt_at = null where state in ('FAILED', 'ACTIVE');
do $$ declare c record; begin
  for i in 1..3 loop
    for c in select * from public.retention_claim(10) loop
      perform public.retention_record_failed(c.record_id, c.lease_token, 'provider down');
    end loop;
    update public.retention_records set next_attempt_at = null where state = 'FAILED';
  end loop;
end $$;
select pg_temp.ok((select count(*) from public.retention_records where state = 'DEAD_LETTER') >= 1, 'repeated failure ends in DEAD_LETTER (manual review)');
select pg_temp.ok((select count(*) from public.retention_claim(10) c join public.retention_records r on r.id = c.record_id where r.state = 'DEAD_LETTER') = 0, 'dead letters are not auto-claimed');

-- ── 12. Knowledge: compact, deduplicated, no personal data, asking only ──
update public.admin_settings set value = value || '{"knowledge_enabled": true}'::jsonb where key = 'storage_retention';
select public.knowledge_extract_verify('10000000-0000-0000-0000-000000000002');  -- no comparables: 0
insert into public.research_jobs (id, user_id, status, completed_at, synthesis_state, result_json)
  select '10000000-0000-0000-0000-000000000009', user_id, 'COMPLETE', now(), 'READY',
         '{"market":{"comparables":[
            {"url":"https://www.myhome.ge/pr/111","price":"120000","currency":"usd","area":"80 m²","pricePerSqm":"1500","district":"Vake","rooms":"3","floor":"5","condition":"renovated","propertyType":"RESIDENTIAL","listingStatus":"SOLD","comparableType":"MICRO_LOCATION","marketplaceSource":"myhome","address":"Chavchavadze ave 10, apt 4","project":"Some Tower"},
            {"url":"https://www.myhome.ge/pr/111","price":"120000","currency":"USD","area":"80","pricePerSqm":"1500","district":"Vake"},
            {"url":"https://ss.ge/x/222","price":"90000","currency":"USD","area":"80-90","pricePerSqm":"about 1100","district":"Saburtalo 12"},
            {"url":"https://ss.ge/x/333","price":"100000","currency":"USD","area":"100","district":"Saburtalo","condition":"call +995 555 12 34 56"},
            {"price":"50000","currency":"USD","pricePerSqm":"900"},
            {"url":"https://x.ge/444","price":"1","currency":"BTC","pricePerSqm":"1000"},
            "not an object"
         ]}}'::jsonb
    from public.research_jobs where id = '10000000-0000-0000-0000-000000000002';
select pg_temp.ok(public.knowledge_extract_verify('10000000-0000-0000-0000-000000000009') = 3, 'three usable listing observations');
select pg_temp.ok((select count(*) from public.market_observations) = 2, 'same listing at same price stored once');
select pg_temp.ok((select seen_count from public.market_observations where district = 'Vake') = 2, 'duplicate counted, not duplicated');
select pg_temp.ok((select price_per_m2 = 1000 and confidence = 'DERIVED' and condition is null
                   from public.market_observations where district = 'Saburtalo'), 'price/m2 derived from price/area; free-text condition with a phone dropped');
select pg_temp.ok((select count(*) from public.market_observations where price_kind <> 'ASKING') = 0, 'every price is labelled ASKING, even a SOLD listing');
select pg_temp.ok(not exists (select 1 from public.market_observations m
                               where row_to_json(m)::text ~* '(chavchavadze|apt|tower|myhome\.ge|ss\.ge|\+995|aaaaaaaa)'), 'no address, project, URL, phone or user id stored');
select pg_temp.ok((select max(pg_column_size(m.*)) < 400 from public.market_observations m), 'observation rows are a few hundred bytes');
select id as obs_id from public.market_observations where district = 'Saburtalo' \gset
set role authenticated;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-00000000000c', false);
select pg_temp.ok(public.knowledge_withdraw_observation(:obs_id, 'correction request'), 'admin can withdraw an observation');
reset role;
do $$ begin
  perform public.knowledge_extract_verify('10000000-0000-0000-0000-00000000dead');
  raise notice 'ok  extraction of a missing job is a no-op';
end $$;
select pg_temp.ok(public.knowledge_extract_contract('30000000-0000-0000-0000-000000000002') = 0, 'contract without findings adds nothing');

-- ── 13. Reminders: queued once per threshold, through notify_emit ──
update public.admin_settings set value = value || '{"reminders_enabled": true}'::jsonb where key = 'storage_retention';
update public.research_jobs set completed_at = now() - interval '25 days', synthesis_at = now() - interval '25 days' where id = '10000000-0000-0000-0000-000000000009';
select public.retention_register_due(100);
select public.retention_emit_reminders(100);
select public.retention_emit_reminders(100);
select pg_temp.ok((select count(*) from public.notifications where type = 'RETENTION_EXPIRING') = 1, 'one 7-day reminder, not repeated');
select pg_temp.ok((select reminder_7d_notification is not null from public.retention_records where source_id = '10000000-0000-0000-0000-000000000009'), 'reminder records the inbox notification id');

-- ── 14. Dry run is read-only and admin-only ──
create temp table before_counts as select (select count(*) from public.retention_records) r, (select count(*) from public.research_jobs) j,
  (select count(*) from storage.objects) o, (select sum(pg_column_size(result_json)) from public.research_jobs) b;
select public.retention_admin_dry_run(now(), null);
select pg_temp.ok((select r = (select count(*) from public.retention_records) and j = (select count(*) from public.research_jobs)
                     and o = (select count(*) from storage.objects) and b = (select sum(pg_column_size(result_json)) from public.research_jobs)
                   from before_counts), 'dry run mutates nothing');
set role authenticator;
do $$ begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-00000000000a', true);
  perform public.retention_admin_summary();
  raise exception 'FAIL: non-admin read the summary';
exception when insufficient_privilege then raise notice 'ok  admin summary refuses a non-admin';
end $$;
reset role;
select pg_temp.ok((select (public.retention_admin_dry_run(now(), null) -> 'verify' ->> 'would_expire')::int >= 1), 'dry run reports what would expire');

\o
\echo RETENTION SQL: PASS
