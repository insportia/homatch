\set ON_ERROR_STOP on
-- 20261107092700_exhaustive_native_matching.sql: a leased queue that keeps a property
-- until it was matched against ALL demand, resumable cursors, and retirement only of
-- what a complete pass did not re-confirm.
do $$
declare
  v_owner uuid; v_prop uuid; v_prop2 uuid; v_intent uuid := gen_random_uuid();
  r record; v_n int; v_enq timestamptz; v_err text;
begin
  select id into v_owner from public.users limit 1;
  insert into public.properties (user_id, title) values (v_owner, 'scan A') returning id into v_prop;
  insert into public.properties (user_id, title) values (v_owner, 'scan B') returning id into v_prop2;
  delete from public.native_match_property_queue;
  insert into public.native_match_property_queue (property_id, reason) values (v_prop, 'TEST'), (v_prop2, 'TEST');

  -- Lease: rows stay in the queue (no delete) and cannot be leased twice.
  select count(*) into v_n from public.native_match_lease_properties(10, 60);
  assert v_n = 2, 'both leased: ' || v_n;
  assert (select count(*) from public.native_match_property_queue) = 2, 'leasing keeps the rows';
  select count(*) into v_n from public.native_match_lease_properties(10, 60);
  assert v_n = 0, 'a leased row is not leased again';

  -- Out of time: the cursor is stored and the lease released for the next tick.
  select enqueued_at into v_enq from public.native_match_property_queue where property_id = v_prop;
  v_n := public.native_match_checkpoint_properties(jsonb_build_array(jsonb_build_object('property_id', v_prop, 'enqueued_at', v_enq)), 'cursor-7', null, null);
  assert v_n = 1;
  select * into r from public.native_match_lease_properties(10, 60);
  assert r.property_id = v_prop and r.demand_cursor = 'cursor-7', 'resumes from its cursor';

  -- Changed again while queued: the pass restarts and completion with the old stamp keeps the row.
  update public.native_match_property_queue set enqueued_at = now() + interval '1 second' where property_id = v_prop;
  assert (select demand_cursor from public.native_match_property_queue where property_id = v_prop) is null, 'cursor reset on change';
  v_n := public.native_match_complete_properties(jsonb_build_array(jsonb_build_object('property_id', v_prop, 'enqueued_at', v_enq)));
  assert v_n = 0, 'a newer change is not completed by an older pass';
  select enqueued_at into v_enq from public.native_match_property_queue where property_id = v_prop;
  v_n := public.native_match_complete_properties(jsonb_build_array(jsonb_build_object('property_id', v_prop, 'enqueued_at', v_enq)));
  assert v_n = 1 and not exists (select 1 from public.native_match_property_queue where property_id = v_prop), 'complete removes it';

  -- Errors back off instead of dropping the row.
  select enqueued_at into v_enq from public.native_match_property_queue where property_id = v_prop2;
  perform public.native_match_checkpoint_properties(jsonb_build_array(jsonb_build_object('property_id', v_prop2, 'enqueued_at', v_enq)), null, null, 'boom');
  select * into r from public.native_match_property_queue where property_id = v_prop2;
  assert r.last_error = 'boom' and r.leased_until > now(), 'backed off with the error kept';

  -- Retirement after a complete pass: only matches not re-confirmed since it started.
  insert into public.supply_matches (intent_profile_id, property_id, source_kind, compatibility, updated_at) values
    (v_intent, v_prop,  'INTERNAL_HOMATCH', 'COMPATIBLE', now() - interval '1 hour'),
    (v_intent, v_prop2, 'INTERNAL_HOMATCH', 'COMPATIBLE', now());
  v_n := public.retire_native_matches_unconfirmed(v_intent, now() - interval '10 minutes', null);
  assert v_n = 1, 'one stale match retired: ' || v_n;
  assert (select compatibility from public.supply_matches where intent_profile_id = v_intent and property_id = v_prop2) = 'COMPATIBLE', 're-confirmed match kept';
  begin
    perform public.retire_native_matches_unconfirmed(v_intent, null, null);
    assert false, 'a pass without a start time retires nothing';
  exception when others then get stacked diagnostics v_err = message_text; assert v_err like '%SCAN_START_REQUIRED%', v_err; end;

  -- A property-scoped pass retires exactly the listings it judged and found unfit.
  v_n := public.retire_native_matches_for_properties(v_intent, array[v_prop2]);
  assert v_n = 1;
  assert (select count(*) from public.supply_matches where intent_profile_id = v_intent and compatibility = 'COMPATIBLE') = 0;

  -- Checkpoint keys are constrained; RLS is on.
  insert into public.match_scan_checkpoints (scan_key, demand_cursor) values ('sweep:native', 'x');
  begin
    insert into public.match_scan_checkpoints (scan_key) values ('anything');
    assert false, 'bad key';
  exception when check_violation then null; end;
  assert (select relrowsecurity from pg_class where relname = 'match_scan_checkpoints'), 'RLS on';
  assert not has_table_privilege('authenticated', 'public.match_scan_checkpoints', 'select'), 'not readable by customers';
  assert not has_function_privilege('authenticated', 'public.native_match_lease_properties(integer, integer)', 'execute'), 'service only';
end $$;
