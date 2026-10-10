-- OWNER DEMO LEAD (20261029090000): one fictional buyer, visible only to the owner of
-- the property who is also in the demo audience; every action is simulated and lives
-- only in the demo tables.
\set ON_ERROR_STOP on

/* ── seed and privileges ─────────────────────────────────────────────────── */
do $$
declare n integer;
begin
  select count(*) into n from public.demo_buyer_profiles where demo_key = 'owner-demo-lead-alex-morgan';
  assert n = 1, 'exactly one owner-demo buyer after two applies, got ' || n;
  select count(*) into n from public.demo_buyer_profiles
   where demo_key = 'owner-demo-lead-alex-morgan' and display_name = 'Alex Morgan' and is_demo and display_label = 'DEMO'
     and budget_min = 140000 and budget_max = 180000 and bedrooms_min = 2 and bedrooms_max = 2
     and districts = array['Krtsanisi', 'Ortachala'] and (search_criteria->>'parking')::boolean
     and (demo_details->>'match_score')::int = 92 and (demo_details->>'simulated')::boolean
     and demo_details->>'source' = 'HOMATCH_DEMO' and (demo_details->>'unlock_credits')::numeric = 2.5;
  assert n = 1, 'Alex Morgan carries the specified, simulated profile';
  assert (select demo_contact->>'email' from public.demo_buyer_profiles where demo_key = 'owner-demo-lead-alex-morgan') like '%@example.com',
    'the fictional email is on the reserved example.com domain';
  assert (select demo_contact->>'phone' from public.demo_buyer_profiles where demo_key = 'owner-demo-lead-alex-morgan') like '+995 000%',
    'the fictional phone is in an unissued range';
  assert (select count(*) from public.demo_buyer_profiles where demo_key = 'internal-match-demo-244486') = 1,
    'the internal-match demo buyer is untouched';

  assert not has_function_privilege('anon', 'public.owner_demo_lead_open(uuid)', 'execute'), 'anon cannot open';
  assert not has_function_privilege('anon', 'public.owner_demo_lead_available(uuid)', 'execute'), 'anon cannot probe';
  assert not has_function_privilege('anon', 'public.owner_demo_lead_act(uuid, text, jsonb)', 'execute'), 'anon cannot act';
  assert not has_function_privilege('anon', 'public.owner_demo_lead_reset(uuid)', 'execute'), 'anon cannot reset';
  assert not has_function_privilege('authenticated', 'public.owner_demo_lead_profile(uuid)', 'execute'), 'profile rule is internal';
  assert not has_function_privilege('authenticated', 'public.owner_demo_lead_payload(uuid)', 'execute'), 'payload is internal';
  assert not has_function_privilege('authenticated', 'public.owner_demo_lead_guard(uuid)', 'execute'), 'guard is internal';
  assert not has_function_privilege('authenticated', 'public.owner_demo_lead_event(jsonb, text, jsonb)', 'execute'), 'event helper is internal';
  assert not has_table_privilege('authenticated', 'public.demo_conversations', 'update'), 'no direct writes';
end $$;

/* An administrator who does NOT own the property. */
insert into public.users (id, auth_id, is_admin)
values ('00000000-0000-0000-0000-0000000000a4', '10000000-0000-0000-0000-0000000000a4', true);

/* ── nobody but the owner in the demo audience ───────────────────────────── */
select set_config('app.uid', '10000000-0000-0000-0000-0000000000a2', false);
set role authenticated;
do $$
declare ok boolean := false;
begin
  assert not public.owner_demo_lead_available('c5c1a6a4-6fed-4764-91c2-3cd7ad090407'), 'hidden from an ordinary member';
  begin perform public.owner_demo_lead_open('c5c1a6a4-6fed-4764-91c2-3cd7ad090407'); exception when others then ok := true; end;
  assert ok, 'an ordinary member cannot open it';
end $$;
reset role;

select set_config('app.uid', '10000000-0000-0000-0000-0000000000a4', false);
set role authenticated;
do $$
declare ok boolean := false;
begin
  assert not public.owner_demo_lead_available('c5c1a6a4-6fed-4764-91c2-3cd7ad090407'), 'an admin who is not the owner sees no entry';
  begin perform public.owner_demo_lead_open('c5c1a6a4-6fed-4764-91c2-3cd7ad090407'); exception when others then ok := true; end;
  assert ok, 'an admin who is not the owner cannot open it';
end $$;
reset role;

/* ── the owner (an administrator): the whole journey ────────────────────── */
select set_config('app.uid', '10000000-0000-0000-0000-0000000000a1', false);
set role authenticated;
do $$
declare
  v jsonb; v2 jsonb; c uuid; ok boolean;
begin
  assert public.owner_demo_lead_available('c5c1a6a4-6fed-4764-91c2-3cd7ad090407'), 'the owner sees the entry';
  assert not public.owner_demo_lead_available('00000000-0000-0000-0000-0000000000b3'), 'no demo on a property with no demo buyer';

  v := public.owner_demo_lead_open('c5c1a6a4-6fed-4764-91c2-3cd7ad090407');
  c := (v->>'conversation_id')::uuid;
  assert (v->>'is_demo')::boolean, v::text;
  assert v->'profile'->'display_name' = 'null'::jsonb and v->'contact' = 'null'::jsonb, 'locked: no name, no contact';
  assert (v->'profile'->'details'->>'match_score')::int = 92, 'simulated score';
  assert v->'events'->0->>'kind' = 'MATCH_DISCOVERED' and (v->'events'->0->>'simulated')::boolean, 'discovered match recorded';
  assert (v->'facts'->>'total_price')::numeric = 213840 and (v->'property'->>'homatch_id')::int = 244486, 'the real listing, read-only';
  v2 := public.owner_demo_lead_open('c5c1a6a4-6fed-4764-91c2-3cd7ad090407');
  assert (v2->>'conversation_id')::uuid = c and jsonb_array_length(v2->'events') = 1, 'reopen reuses the same row';

  ok := false;
  begin perform public.owner_demo_lead_act(c, 'SAVE_CRM', '{}'); exception when others then ok := sqlerrm = 'DEMO_LOCKED'; end;
  assert ok, 'CRM before unlock is refused';

  v := public.owner_demo_lead_act(c, 'VIEW_DETAILS', '{}');
  assert v->'state'->>'details_viewed_at' is not null, 'details viewed';
  v := public.owner_demo_lead_act(c, 'UNLOCK', '{}');
  assert v->>'unlocked_at' is not null, 'unlocked';
  assert v->'profile'->>'display_name' = 'Alex Morgan', 'name revealed after unlock';
  assert v->'contact'->>'email' = 'alex.morgan.demo@example.com', 'fictional contact revealed after unlock';
  assert (v->'events'->-1->'detail'->>'charged_credits')::int = 0, 'nothing charged';
  v := public.owner_demo_lead_act(c, 'UNLOCK', '{}');
  assert jsonb_array_length(v->'events') = 2, 'a second unlock records nothing new';

  v := public.owner_demo_lead_act(c, 'SAVE_CRM', '{}');
  assert v->'state'->>'crm_stage' = 'UNLOCKED', 'saved to CRM';
  v := public.owner_demo_lead_act(c, 'SET_STAGE', '{"stage":"INTERESTED"}');
  assert v->'state'->>'crm_stage' = 'INTERESTED' and v->'events'->-1->'detail'->>'to' = 'INTERESTED', 'stage changed';
  ok := false;
  begin perform public.owner_demo_lead_act(c, 'SET_STAGE', '{"stage":"PAID"}'); exception when others then ok := sqlerrm = 'DEMO_INVALID_STAGE'; end;
  assert ok, 'unknown stage refused';
  v := public.owner_demo_lead_act(c, 'ADD_NOTE', '{"body":"Wants a viewing on Thursday"}');
  assert v->'state'->'notes'->0->>'body' = 'Wants a viewing on Thursday', 'note stored';
  ok := false;
  begin perform public.owner_demo_lead_act(c, 'ADD_NOTE', '{"body":"   "}'); exception when others then ok := sqlerrm = 'DEMO_INVALID_BODY'; end;
  assert ok, 'empty note refused';

  v := public.owner_demo_lead_act(c, 'OPEN_CHAT', '{}');
  assert v->'state'->>'chat_opened_at' is not null, 'chat opened';
  perform public.demo_send_message(c, 'Hello Alex', 'en');
  v := public.owner_demo_lead_act(c, 'ATTACH_OFFER', '{"body":"Property offer: HOMATCH 244486","lang":"en"}');
  assert jsonb_array_length(v->'messages') = 4, 'message + reply, offer + reply: ' || (v->'messages')::text;
  assert v->'messages'->2->>'body' = 'Property offer: HOMATCH 244486' and v->'messages'->3->>'sender' = 'DEMO_BUYER'
     and (v->'messages'->3->>'is_simulated')::boolean, 'offer in the simulated thread';

  v := public.owner_demo_lead_act(c, 'SAVE_EMAIL_DRAFT', '{"subject":"Your apartment in Krtsanisi","template_id":"PERSONAL_FOLLOW_UP","lang":"ka"}');
  assert v->'state'->'email_draft'->>'template_id' = 'PERSONAL_FOLLOW_UP' and v->'state'->'email_draft'->>'language' = 'ka', 'draft saved';
  ok := false;
  begin perform public.owner_demo_lead_act(c, 'SAVE_EMAIL_DRAFT', '{"subject":"x","template_id":"PREMIUM_PROPERTY"}'); exception when others then ok := sqlerrm = 'DEMO_INVALID_TEMPLATE'; end;
  assert ok, 'a Standard listing gets no premium template';

  v := public.owner_demo_lead_act(c, 'NOTIFICATIONS_READ', '{}');
  v := public.owner_demo_lead_act(c, 'WALKTHROUGH_DONE', '{}');
  v := public.owner_demo_lead_act(c, 'TOGGLE_SAVED', '{}');
  assert (v->'state'->>'saved')::boolean and v->'state'->>'notifications_read_at' is not null, 'saved + read';
  ok := false;
  begin perform public.owner_demo_lead_act(c, 'CHARGE', '{}'); exception when others then ok := sqlerrm = 'DEMO_INVALID_ACTION'; end;
  assert ok, 'unknown action refused';

  v := public.owner_demo_lead_reset(c);
  assert v->>'unlocked_at' is null and v->'contact' = 'null'::jsonb and v->'profile'->'display_name' = 'null'::jsonb, 'reset relocks';
  assert jsonb_array_length(v->'messages') = 0 and jsonb_array_length(v->'events') = 1, 'reset clears thread and activity';
  assert v->'state'->>'walkthrough_done_at' is not null and v->'state'->'crm_stage' is null, 'reset keeps only "guide seen"';
end $$;
reset role;

/* ── another admin cannot act on the owner's demo conversation ───────────── */
select set_config('app.uid', '10000000-0000-0000-0000-0000000000a4', false);
set role authenticated;
do $$
declare ok boolean := false; c uuid;
begin
  reset role;
  select id into c from public.demo_conversations
   where demo_buyer_id = (select id from public.demo_buyer_profiles where demo_key = 'owner-demo-lead-alex-morgan');
  set role authenticated;
  begin perform public.owner_demo_lead_act(c, 'UNLOCK', '{}'); exception when others then ok := true; end;
  assert ok, 'acting on another viewer''s demo is refused';
  ok := false;
  begin perform public.owner_demo_lead_reset(c); exception when others then ok := true; end;
  assert ok, 'resetting another viewer''s demo is refused';
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
  assert (select count(*) from public.notifications) = 0, 'no notification';
  assert (select count(*) from public.credit_transactions) = 0, 'no credit movement';
  assert (select count(*) from public.matching_campaigns) = 0, 'no campaign row';
  assert (select count(*) from public.users) = 4, 'no user was created for the demo buyer';
end $$;
