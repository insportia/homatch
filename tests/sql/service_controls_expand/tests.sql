-- Service Control Center EXPANSION: proofs on a throwaway database.
\set ON_ERROR_STOP on
create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if; raise notice 'PASS  %', msg; end $$;
create or replace function pg_temp.as_user(sub text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(sub, ''), false); end $$;
create or replace function pg_temp.raises(stmt text, code text) returns boolean language plpgsql as $$
begin execute stmt; return false; exception when others then return sqlerrm = code; end $$;

-- 1. The original six are exactly as production had them.
select pg_temp.ok((select count(*) = 6 from public._before b join public.service_controls c using (service_key)
  where c.frontend_enabled = b.frontend_enabled and c.backend_enabled = b.backend_enabled and c.version = b.version
    and c.reason is not distinct from b.reason and c.updated_by is not distinct from b.updated_by and c.updated_at = b.updated_at),
  'the six original rows are untouched (switches, version, reason, author, time)');
select pg_temp.ok((select version = 4 and not backend_enabled from public.service_controls where service_key = 'live_chat'), 'live chat keeps the owner''s version 4, OFF');
select pg_temp.ok((select bool_and(not frontend_enabled and not backend_enabled) from public.service_controls
  where service_key in ('publishing','ai_call_center','ai_talk','whatsapp','live_chat','design_studio')), 'the six stay OFF');
select pg_temp.ok((select count(*) = 0 from public.admin_audit_log), 'the migration writes no audit row (it changes no owner decision)');

-- 2. The new live products, seeded ON/ON in their groups.
select pg_temp.ok((select count(*) = 20 from public.service_controls), 'twenty services in one table');
select pg_temp.ok((select count(*) = 14 and bool_and(frontend_enabled and backend_enabled and version = 1) from public.service_controls
  where service_key not in ('publishing','ai_call_center','ai_talk','whatsapp','live_chat','design_studio')), 'fourteen new services, all ON, version 1');
select pg_temp.ok((select jsonb_object_agg(service_key, service_group) from public.service_controls) @> '{
  "publishing":"publishing","design_studio":"design","ai_call_center":"communications","ai_talk":"communications",
  "whatsapp":"communications","live_chat":"communications","find_property":"discovery","find_property_deep":"discovery",
  "find_buyers":"discovery","verify":"intelligence","contracts":"intelligence","mortgage":"intelligence","investment":"intelligence",
  "for_expats":"intelligence","meta_ads":"marketing","email_campaigns":"marketing","ai_assistant":"assistant",
  "brokers_directory":"professionals","broker_desk":"professionals","developers":"professionals"}'::jsonb, 'every service has its group');
select pg_temp.ok(pg_temp.raises($$insert into public.service_controls(service_key) values ('billing')$$, 'new row for relation "service_controls" violates check constraint "service_controls_service_key_check"'), 'a platform component cannot be added');
select pg_temp.ok(pg_temp.raises($$update public.service_controls set service_group = 'everything' where service_key = 'verify'$$, 'new row for relation "service_controls" violates check constraint "service_controls_group_check"'), 'an unknown group cannot be stored');
set role anon;
select pg_temp.ok((select count(*) = 20 from public.service_controls_public()), 'anon reads all twenty visibilities');
select pg_temp.ok((select backend_enabled and frontend_enabled from public.service_controls_public() where service_key = 'verify'), 'anon sees Verify ON');
select pg_temp.ok(pg_temp.raises($$select public.service_control_pause_group('discovery','discovery',null,null)$$, 'permission denied for function service_control_pause_group'), 'anon cannot pause a group');
reset role;

-- 3. "Pause all six" cannot reach a live product.
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
set role authenticated;
select pg_temp.ok((select public.service_control_set('ai_talk', false, true, 1, 'test', 'r1') ->> 'result') = 'CHANGED', 'admin turns AI TALK backend on (to give pause-all something to do)');
select pg_temp.ok((select public.service_control_pause_all('test', 'r2') -> 'changed') = '["ai_talk"]'::jsonb, 'pause all six changes only AI TALK');
reset role;
select pg_temp.ok((select count(*) = 14 from public.service_controls where frontend_enabled and backend_enabled), 'all fourteen live products are still ON after pause-all');

-- 4. Group pause: admin only, typed confirmation, one group, audited.
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
set role authenticated;
select pg_temp.ok(pg_temp.raises($$select public.service_control_pause_group('marketing','marketing',null,null)$$, 'FORBIDDEN'), 'a customer cannot pause a group');
reset role;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
set role authenticated;
select pg_temp.ok(pg_temp.raises($$select public.service_control_pause_group('marketing', null, null, null)$$, 'CONFIRMATION_REQUIRED'), 'no typed confirmation, no pause');
select pg_temp.ok(pg_temp.raises($$select public.service_control_pause_group('marketing', 'Marketing!', null, null)$$, 'CONFIRMATION_REQUIRED'), 'a wrong confirmation is refused');
select pg_temp.ok(pg_temp.raises($$select public.service_control_pause_group('other', 'other', null, null)$$, 'GROUP_UNKNOWN'), 'the catch-all group cannot be paused');
select pg_temp.ok(pg_temp.raises($$select public.service_control_pause_group('everything', 'everything', null, null)$$, 'GROUP_UNKNOWN'), 'there is no global group');
select pg_temp.ok((select public.service_control_pause_group('marketing', 'marketing', 'drill', 'r3') -> 'changed') = '["email_campaigns", "meta_ads"]'::jsonb, 'pausing Marketing changes exactly Meta Ads and Email');
select pg_temp.ok((select public.service_control_pause_group('marketing', 'marketing', 'drill', 'r4') ->> 'result') = 'UNCHANGED', 'a second pause of the same group changes nothing');
reset role;
select pg_temp.ok((select count(*) = 12 from public.service_controls where frontend_enabled and backend_enabled), 'the other twelve live products are untouched');
select pg_temp.ok((select count(*) = 2 from public.admin_audit_log where action = 'SERVICE_CONTROL_PAUSE_GROUP' and metadata ->> 'group' = 'marketing' and metadata ->> 'request_id' = 'r3'), 'one audit row per changed service, with group and request id');

-- 5. Single-service writes work for a new key, under the same rules.
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
set role authenticated;
select pg_temp.ok((select public.service_control_set('meta_ads', true, true, 2, 'back on', 'r5') ->> 'result') = 'CHANGED', 'Meta Ads can be turned back on');
select pg_temp.ok((select public.service_control_set('verify', true, true, 1, null, 'r6') ->> 'result') = 'UNCHANGED', 'a no-op write on Verify is UNCHANGED');
select pg_temp.ok((select public.service_control_set('verify', false, false, 7, null, 'r7') ->> 'result') = 'CONFLICT', 'a stale tab cannot pause Verify');
select pg_temp.ok(pg_temp.raises($$select public.service_control_set('verify', true, false, 1, null, null)$$, 'FRONTEND_REQUIRES_BACKEND'), 'visible-but-not-running is refused for a new key too');
reset role;
select pg_temp.ok((select frontend_enabled and backend_enabled from public.service_controls where service_key = 'verify'), 'Verify is still ON');

-- 6. Brokers directory: new paid listings are refused while paused; history stays.
select pg_temp.ok((select count(*) = 1 from public.broker_listing_purchases), 'the existing purchase is there');
insert into public.broker_listing_purchases (listing_id, user_id, credits) values (gen_random_uuid(), 'bbbbbbbb-0000-0000-0000-00000000000b', 10);
select pg_temp.ok((select count(*) = 2 from public.broker_listing_purchases), 'while ON, a new paid listing is written');
update public.service_controls set frontend_enabled = false, backend_enabled = false where service_key = 'brokers_directory';
select pg_temp.ok(pg_temp.raises($$insert into public.broker_listing_purchases (listing_id, user_id, credits) values (gen_random_uuid(), 'bbbbbbbb-0000-0000-0000-00000000000b', 10)$$, 'SERVICE_DISABLED'), 'while OFF, a new paid listing is refused');
select pg_temp.ok((select count(*) = 2 from public.broker_listing_purchases), 'and nothing already bought is touched');
