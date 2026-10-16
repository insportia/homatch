-- INTERNAL MATCH DEMO (20261024120000): one demo buyer, visible only to admins and
-- listed testers, with a simulated channel that never touches a real table.
\set ON_ERROR_STOP on

/* ── seed: exactly one demo buyer, even after applying the migration twice ── */
do $$
declare n integer;
begin
  select count(*) into n from public.demo_buyer_profiles;
  assert n = 1, 'exactly one demo buyer, got ' || n;
  select count(*) into n from public.demo_buyer_profiles
   where demo_key = 'internal-match-demo-244486' and property_id = 'c5c1a6a4-6fed-4764-91c2-3cd7ad090407' and is_demo;
  assert n = 1, 'the demo buyer is tied to HOMATCH 244486';
  assert (select count(*) from public.admin_settings where key = 'internal_match_demo_testers') = 1, 'testers setting seeded once';
  assert not has_function_privilege('anon', 'public.demo_send_message(uuid, text, text)', 'execute'), 'anon cannot send';
  assert not has_function_privilege('anon', 'public.demo_internal_match_for_property(uuid)', 'execute'), 'anon cannot read';
  assert not has_function_privilege('authenticated', 'public.demo_reply_template(integer, text)', 'execute'), 'template is internal';
  assert not has_function_privilege('authenticated', 'public.demo_conversation_guard(uuid)', 'execute'), 'guard is internal';
  assert not has_table_privilege('authenticated', 'public.demo_messages', 'insert'), 'no direct writes';
end $$;

/* ── a member who is neither admin nor tester sees nothing ───────────────── */
select set_config('app.uid', '10000000-0000-0000-0000-0000000000a2', false);
set role authenticated;
do $$
declare ok boolean := false;
begin
  assert public.demo_internal_match_for_property('c5c1a6a4-6fed-4764-91c2-3cd7ad090407') is null, 'hidden from an ordinary member';
  assert (select count(*) from public.demo_buyer_profiles) = 0, 'RLS hides the profile';
  begin
    perform public.demo_open_conversation((select id from public.demo_buyer_profiles limit 1), 'c5c1a6a4-6fed-4764-91c2-3cd7ad090407');
  exception when others then ok := true;
  end;
  assert ok, 'an ordinary member cannot open a demo conversation';
end $$;
reset role;

/* ── a listed tester who does not own the property still sees nothing for it ── */
update public.admin_settings set value = '["00000000-0000-0000-0000-0000000000a3"]'::jsonb where key = 'internal_match_demo_testers';
select set_config('app.uid', '10000000-0000-0000-0000-0000000000a3', false);
set role authenticated;
do $$
begin
  assert public.internal_match_demo_allowed(), 'a listed tester is in the demo audience';
  assert public.demo_internal_match_for_property('c5c1a6a4-6fed-4764-91c2-3cd7ad090407') is null,
    'a tester who neither owns the property nor is admin sees no demo for it';
  assert (select count(*) from public.demo_buyer_profiles) = 1, 'RLS lets the tester read the profile row';
end $$;
reset role;

/* ── the administrator who owns the property: the whole flow ─────────────── */
select set_config('app.uid', '10000000-0000-0000-0000-0000000000a1', false);
set role authenticated;
do $$
declare
  v jsonb; v_conv uuid; v_again uuid; v_sent jsonb; v_list jsonb; v_unlock jsonb; v_prof uuid;
begin
  v := public.demo_internal_match_for_property('c5c1a6a4-6fed-4764-91c2-3cd7ad090407');
  assert v is not null and (v->>'is_demo')::boolean, 'admin sees the demo';
  assert v->'facts'->>'district' = 'Krtsanisi' and (v->'facts'->>'total_price')::numeric = 213840,
    'the property facts come from property_facts at runtime: ' || v::text;
  assert v->'property'->>'transaction_type' = 'SALE' and v->'profile'->>'transaction_type' = 'SALE', v::text;
  assert v->'conversation_id' = 'null'::jsonb, 'no conversation yet';
  v_prof := (v->'profile'->>'id')::uuid;

  v_conv := public.demo_open_conversation(v_prof, 'c5c1a6a4-6fed-4764-91c2-3cd7ad090407');
  v_again := public.demo_open_conversation(v_prof, 'c5c1a6a4-6fed-4764-91c2-3cd7ad090407');
  assert v_conv = v_again, 'one conversation per viewer, reused';

  v_sent := public.demo_send_message(v_conv, 'გამარჯობა, ბინა ისევ იყიდება.', 'ka');
  assert v_sent->'message'->>'sender' = 'OWNER' and not (v_sent->'message'->>'is_simulated')::boolean, v_sent::text;
  assert v_sent->'message'->>'delivered_at' is not null and v_sent->'message'->>'seen_at' is not null, 'SENT → DELIVERED → SEEN recorded';
  assert v_sent->'reply'->>'sender' = 'DEMO_BUYER' and (v_sent->'reply'->>'is_simulated')::boolean, v_sent::text;
  assert v_sent->'reply'->>'body' like 'გამარჯობა%', 'Georgian reply for a Georgian sender: ' || (v_sent->'reply'->>'body');

  v_sent := public.demo_send_message(v_conv, 'Shalom', 'he');
  assert v_sent->'reply'->>'body' like 'אפשר לבוא%', 'second template, in Hebrew: ' || (v_sent->'reply'->>'body');
  v_sent := public.demo_send_message(v_conv, 'x', 'zz');
  assert v_sent->'reply'->>'body' like 'Thank you. Is the price%', 'unknown language falls back to English';

  v_list := public.demo_list_messages(v_conv);
  assert jsonb_array_length(v_list->'messages') = 6, 'history keeps all six: ' || v_list::text;
  assert v_list->'messages'->0->>'sender' = 'OWNER' and v_list->'messages'->1->>'sender' = 'DEMO_BUYER', 'ordered';

  v_unlock := public.demo_unlock_contact(v_conv);
  assert (v_unlock->>'simulated')::boolean and (v_unlock->>'charged_credits')::int = 0 and v_unlock->'phone' = 'null'::jsonb, v_unlock::text;
  assert (public.demo_internal_match_for_property('c5c1a6a4-6fed-4764-91c2-3cd7ad090407')->>'demo_unlocked_at') is not null, 'unlock recorded';
end $$;
reset role;

/* ── another viewer cannot read the admin's conversation ─────────────────── */
select set_config('app.uid', '10000000-0000-0000-0000-0000000000a3', false);
set role authenticated;
do $$
declare ok boolean := false;
begin
  assert (select count(*) from public.demo_conversations) = 0, 'RLS: a tester never sees another viewer''s conversation';
  assert (select count(*) from public.demo_messages) = 0, 'RLS: nor its messages';
  begin
    perform public.demo_list_messages((select id from public.demo_conversations limit 1));
  exception when others then ok := true;
  end;
  assert ok, 'listing someone else''s demo conversation is refused';
end $$;
reset role;

/* ── isolation: nothing real was written ─────────────────────────────────── */
do $$
begin
  assert (select count(*) from public.supply_matches) = 0, 'no supply_matches row';
  assert (select count(*) from public.matches) = 0, 'no matches row';
  assert (select count(*) from public.find_buyers_leads) = 0, 'no find_buyers_leads row';
  assert (select count(*) from public.conversations) = 0, 'no real conversation';
  assert (select count(*) from public.messages) = 0, 'no real message';
  assert (select count(*) from public.message_receipts) = 0, 'no receipt';
  assert (select count(*) from public.notifications) = 0, 'no notification';
  assert (select count(*) from public.credit_transactions) = 0, 'no credit movement';
  assert (select count(*) from public.matching_campaigns) = 0, 'no campaign row';
  assert (select count(*) from public.users) = 3, 'no user was created for the demo buyer';
  assert (select count(*) from public.demo_messages) = 6, 'the demo rows live only in demo tables';
end $$;

/* ── one person, one card: MATCH + RELATIONSHIP for the same member share a key ── */
insert into public.supply_matches (id, property_id, source_kind, supply_user_id, demand_user_id) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b3', 'INTERNAL_HOMATCH',
   '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a2');
insert into public.native_property_relationships (id, property_id, supply_user_id, demand_user_id) values
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000b3',
   '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a2');
select set_config('app.uid', '10000000-0000-0000-0000-0000000000a3', false);
set role authenticated;
do $$
declare n integer; k text;
begin
  select count(*), count(distinct counterpart_key), min(counterpart_key) into n, n, k
    from public.my_native_match_counterparts('00000000-0000-0000-0000-0000000000b3');
  assert n = 1, 'the same member is one person, not two';
  assert (select count(*) from public.my_native_match_counterparts('00000000-0000-0000-0000-0000000000b3')) = 2, 'both rows keyed';
  assert k <> '00000000-0000-0000-0000-0000000000a2' and position('00000000' in k) = 0, 'the key is opaque, never the user id';
end $$;
reset role;
select set_config('app.uid', '10000000-0000-0000-0000-0000000000a1', false);
set role authenticated;
do $$
begin
  assert (select count(*) from public.my_native_match_counterparts('00000000-0000-0000-0000-0000000000b3')) = 0, 'not a party → nothing';
end $$;
reset role;
