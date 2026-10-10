-- Behavioural checks for 20261027100000_property_conversations.sql.
\set ON_ERROR_STOP on
set app.role = 'authenticated';

do $$
declare
  a1 constant uuid := '00000000-0000-0000-0000-0000000000a1';
  a2 constant uuid := '00000000-0000-0000-0000-0000000000a2';
  b1 constant uuid := '00000000-0000-0000-0000-0000000000b1';
  a1_auth constant text := '10000000-0000-0000-0000-0000000000a1';
  a2_auth constant text := '10000000-0000-0000-0000-0000000000a2';
  b1_auth constant text := '10000000-0000-0000-0000-0000000000b1';
  v_conv uuid; v_other_conv uuid; v_m1 uuid; v_m2 uuid; v_n integer; v jsonb; v_txt text; v_ok boolean;
begin
  /* ── grants: callable by members, never anonymously; internals by nobody ───── */
  foreach v_txt in array array['public.mark_conversation_seen(uuid)', 'public.set_conversation_muted(uuid, boolean)',
      'public.block_conversation_counterpart(uuid)', 'public.unblock_conversation_counterpart(uuid)',
      'public.my_conversation_context(uuid)', 'public.my_message_translations(uuid, text)',
      'public.dm_media_object_allowed(text, boolean)'] loop
    assert not has_function_privilege('anon', v_txt, 'execute'), v_txt || ' is callable by anon';
    assert has_function_privilege('authenticated', v_txt, 'execute'), v_txt || ' is not callable by members';
  end loop;
  foreach v_txt in array array['public.conversation_for_participant(uuid)', 'public.messages_reply_same_conversation()'] loop
    assert not has_function_privilege('anon', v_txt, 'execute'), v_txt || ' is callable by anon';
    assert not has_function_privilege('authenticated', v_txt, 'execute'), v_txt || ' is callable by members';
  end loop;
  assert not has_table_privilege('authenticated', 'public.message_translations', 'select'), 'translations readable directly';
  assert not has_table_privilege('authenticated', 'public.messages', 'insert'), 'members can still insert messages directly';
  assert not has_table_privilege('authenticated', 'public.messages', 'update'), 'members can update messages directly';
  assert has_table_privilege('authenticated', 'public.messages', 'select'), 'members lost read access to messages';
  assert not exists (select 1 from pg_policies where tablename = 'messages' and policyname = 'msg_insert'), 'msg_insert survived';
  assert (select public from storage.buckets where id = 'dm-media') = false, 'dm-media must be private';
  assert (select file_size_limit from storage.buckets where id = 'dm-media') = 8388608, 'dm-media 8 MB';

  /* ── a conversation about f1 between owner a1 and member b1, CRM entry present ── */
  v_conv := public.ensure_conversation(a1, b1, '00000000-0000-0000-0000-0000000000f1');
  v_other_conv := public.ensure_conversation(a2, b1, '00000000-0000-0000-0000-0000000000f3');
  insert into public.lead_crm_entries (owner_user_id, lead_user_id, property_id) values (a1, b1, '00000000-0000-0000-0000-0000000000f1');

  insert into public.messages (conversation_id, sender_id, body, status, client_message_id)
  values (v_conv, a1, 'Hello from the owner', 'DELIVERED', 'c_first_message_1') returning id into v_m1;
  assert (select kind from public.messages where id = v_m1) = 'TEXT', 'kind defaults to TEXT';
  assert (select status from public.lead_crm_entries where owner_user_id = a1 and lead_user_id = b1) = 'CONTACTED',
    'CRM insert trigger still runs';

  /* ── CHECK constraints ─────────────────────────────────────────────────────── */
  begin
    insert into public.messages (conversation_id, sender_id, body, client_message_id) values (v_conv, a1, 'again', 'c_first_message_1');
    assert false, 'duplicate client_message_id accepted';
  exception when unique_violation then null; end;
  begin
    insert into public.messages (conversation_id, sender_id, body) values (v_conv, a1, '   ');
    assert false, 'empty TEXT accepted';
  exception when check_violation then null; end;
  begin
    insert into public.messages (conversation_id, sender_id, body, kind, media_path, media_meta)
    values (v_conv, a1, '', 'VOICE', a1 || '/' || v_conv || '/00000000-0000-0000-0000-000000000001.webm', '{"duration_seconds": 61}');
    assert false, '61 s voice accepted';
  exception when check_violation then null; end;
  begin
    insert into public.messages (conversation_id, sender_id, body, kind, media_path, media_meta)
    values (v_conv, a1, '', 'VOICE', a1 || '/' || v_conv || '/00000000-0000-0000-0000-000000000001.webm', '{"duration_seconds": "long"}');
    assert false, 'non-numeric voice duration accepted';
  exception when check_violation then null; end;
  begin
    insert into public.messages (conversation_id, sender_id, body, kind, media_path)
    values (v_conv, a1, '', 'PHOTO', b1 || '/' || v_conv || '/00000000-0000-0000-0000-000000000001.jpg');
    assert false, 'photo under somebody else''s prefix accepted';
  exception when check_violation then null; end;
  begin
    insert into public.messages (conversation_id, sender_id, body, kind, media_path)
    values (v_conv, a1, '', 'PHOTO', a1 || '/' || v_other_conv || '/00000000-0000-0000-0000-000000000001.jpg');
    assert false, 'photo from another conversation''s folder accepted';
  exception when check_violation then null; end;
  begin
    insert into public.messages (conversation_id, sender_id, body, kind) values (v_conv, a1, '', 'PROPERTY');
    assert false, 'PROPERTY without a card accepted';
  exception when check_violation then null; end;
  begin
    insert into public.messages (conversation_id, sender_id, body, property_card) values (v_conv, a1, 'x', '{"id": 1}');
    assert false, 'card on a TEXT message accepted';
  exception when check_violation then null; end;
  begin
    insert into public.messages (conversation_id, sender_id, body, original_body, original_lang, translated_to)
    values (v_conv, a1, 'Hello', 'გამარჯობა', 'ka', 'ka');
    assert false, 'translation into its own language accepted';
  exception when check_violation then null; end;
  begin
    insert into public.messages (conversation_id, sender_id, body, kind) values (v_conv, a1, 'x', 'STICKER');
    assert false, 'unknown kind accepted';
  exception when check_violation then null; end;
  begin
    insert into public.messages (conversation_id, sender_id, body, reply_to_id) values (v_other_conv, a2, 'quoting', v_m1);
    assert false, 'reply to another conversation''s message accepted';
  exception when check_violation then null; end;

  -- Valid rows of every kind.
  insert into public.messages (conversation_id, sender_id, body, kind, media_path, media_meta, reply_to_id)
  values (v_conv, a1, '', 'VOICE', a1 || '/' || v_conv || '/00000000-0000-0000-0000-000000000002.webm',
          '{"duration_seconds": 60, "mime": "audio/webm", "size": 1000}', v_m1) returning id into v_m2;
  insert into public.messages (conversation_id, sender_id, body, kind, media_path, media_meta)
  values (v_conv, a1, 'the kitchen', 'PHOTO', a1 || '/' || v_conv || '/00000000-0000-0000-0000-000000000003.jpg', '{"mime": "image/jpeg", "size": 2000}');
  insert into public.messages (conversation_id, sender_id, body, kind, property_card)
  values (v_conv, a1, '', 'PROPERTY', '{"id": "00000000-0000-0000-0000-0000000000f1", "homatch_id": 100001}');
  insert into public.messages (conversation_id, sender_id, body, original_body, original_lang, translated_to)
  values (v_conv, b1, 'Hello, is it available?', 'გამარჯობა, ხელმისაწვდომია?', 'ka', 'en');
  assert (select status from public.lead_crm_entries where owner_user_id = a1 and lead_user_id = b1) = 'REPLIED',
    'CRM reply recorded';

  /* ── mark_conversation_seen: users.id receipts, only the other side's messages ── */
  perform set_config('app.uid', b1_auth, true);
  v_n := public.mark_conversation_seen(v_conv);
  assert v_n = 4, 'b1 marks a1''s four messages seen, not their own: ' || v_n;
  assert (select count(*) from public.messages where conversation_id = v_conv and sender_id = a1 and status = 'SEEN') = 4, 'a1 messages SEEN';
  assert (select status from public.messages where conversation_id = v_conv and sender_id = b1) = 'SENT', 'own message untouched';
  assert (select count(*) from public.message_receipts where user_id = b1 and status = 'SEEN') = 4, 'receipts keyed by users.id';
  assert not exists (select 1 from public.message_receipts where user_id::text = b1_auth), 'no auth uid in receipts';
  assert public.mark_conversation_seen(v_conv) = 0, 'second call marks nothing';
  perform set_config('app.uid', a2_auth, true);
  begin
    perform public.mark_conversation_seen(v_conv);
    assert false, 'a non-participant marked messages seen';
  exception when insufficient_privilege then null; end;

  /* ── my_conversation_context: first name / nickname, never identity ─────────── */
  perform set_config('app.uid', a1_auth, true);
  v := public.my_conversation_context(v_conv);
  assert v->'counterpart'->>'displayName' = 'Layla', 'nickname first: ' || v::text;
  assert v->'counterpart'->>'preferredLanguage' = 'ar', 'counterpart language';
  assert v->'property'->>'homatchId' = '100001' and v->'property'->>'district' = 'Krtsanisi', 'property summary: ' || v::text;
  assert (v->'property'->>'isMine')::boolean, 'owner sees isMine';
  assert (v->>'canSend')::boolean and not (v->>'awaitingFirstReply')::boolean, 'b1 replied, so a1 may send';
  v_txt := v::text;
  assert v_txt not like '%Buyer%' and v_txt not like '%@x.test%' and v_txt not like '%+971%', 'no surname/email/phone: ' || v_txt;
  perform set_config('app.uid', b1_auth, true);
  v := public.my_conversation_context(v_conv);
  assert v->'counterpart'->>'displayName' = 'Nino', 'first name only for a1: ' || v::text;
  assert v::text not like '%Seller%' and v::text not like '%+995%', 'no surname/phone for a1';
  assert not (v->'property'->>'isMine')::boolean, 'member is not the owner';

  -- Offer cap mirror: a2 → b1, member never replied, three messages sent.
  insert into public.messages (conversation_id, sender_id, body) values
    (v_other_conv, a2, 'one'), (v_other_conv, a2, 'two');
  perform set_config('app.uid', a2_auth, true);
  v := public.my_conversation_context(v_other_conv);
  assert (v->>'canSend')::boolean and (v->>'offerMessagesRemaining')::int = 1, 'one offer message left: ' || v::text;
  insert into public.messages (conversation_id, sender_id, body) values (v_other_conv, a2, 'three');
  v := public.my_conversation_context(v_other_conv);
  assert not (v->>'canSend')::boolean and (v->>'offerMessagesRemaining')::int = 0, 'cap reached: ' || v::text;

  /* ── mute: mine only ───────────────────────────────────────────────────────── */
  perform set_config('app.uid', b1_auth, true);
  assert public.set_conversation_muted(v_conv, true), 'mute returns the new state';
  assert (select recipient_muted and not initiator_muted from public.conversations where id = v_conv), 'only b1 muted';
  assert (public.my_conversation_context(v_conv)->>'mutedByMe')::boolean, 'context shows muted';
  assert not public.set_conversation_muted(v_conv, false), 'unmute';
  assert (select not recipient_muted from public.conversations where id = v_conv), 'b1 unmuted';

  /* ── block / unblock ───────────────────────────────────────────────────────── */
  assert public.block_conversation_counterpart(v_conv), 'block';
  assert public.block_conversation_counterpart(v_conv), 'block is idempotent';
  assert (select count(*) from public.conversation_blocks where blocker_id = b1 and blocked_id = a1) = 1, 'one block row';
  assert (select status from public.conversations where id = v_conv) = 'BLOCKED', 'thread closed';
  v := public.my_conversation_context(v_conv);
  assert (v->>'blockedByMe')::boolean and not (v->>'canSend')::boolean, 'blocker cannot send';
  perform set_config('app.uid', a1_auth, true);
  v := public.my_conversation_context(v_conv);
  assert (v->>'blockedByThem')::boolean and not (v->>'canSend')::boolean, 'blocked side cannot send';
  begin
    perform public.unblock_conversation_counterpart(v_conv);
    -- a1 never blocked anybody: nothing to lift, b1's block remains.
    assert (select status from public.conversations where id = v_conv) = 'BLOCKED', 'a1 cannot lift b1''s block';
  end;
  perform set_config('app.uid', b1_auth, true);
  assert public.unblock_conversation_counterpart(v_conv), 'unblock reopens';
  assert (select status from public.conversations where id = v_conv) = 'ACTIVE', 'thread active again';
  assert not exists (select 1 from public.conversation_blocks where blocker_id = b1 and blocked_id = a1), 'block row gone';

  /* ── translation cache: participants only, through the RPC ─────────────────── */
  insert into public.message_translations (message_id, kind, target_lang, source_lang, text, model, pricing_state)
  values (v_m1, 'TRANSLATION', 'ar', 'en', 'مرحبًا من المالك', 'test-model', 'UNPRICED'),
         (v_m2, 'TRANSCRIPT', '', 'en', 'spoken words', 'whisper', 'UNPRICED'),
         (v_m1, 'TRANSLATION', 'ru', 'en', 'Привет', 'test-model', 'UNPRICED');
  v := public.my_message_translations(v_conv, 'ar');
  assert jsonb_array_length(v) = 2, 'arabic translation + transcript: ' || v::text;
  begin
    insert into public.message_translations (message_id, kind, target_lang, text) values (v_m1, 'TRANSLATION', '', 'x');
    assert false, 'translation without a target accepted';
  exception when check_violation then null; end;
  perform set_config('app.uid', a2_auth, true);
  begin
    perform public.my_message_translations(v_conv, 'ar');
    assert false, 'a non-participant read translations';
  exception when insufficient_privilege then null; end;

  /* ── dm-media object rule ──────────────────────────────────────────────────── */
  perform set_config('app.uid', a1_auth, true);
  assert public.dm_media_object_allowed(a1 || '/' || v_conv || '/x.jpg', true), 'a1 writes under own prefix';
  assert not public.dm_media_object_allowed(b1 || '/' || v_conv || '/x.jpg', true), 'a1 cannot write under b1';
  assert not public.dm_media_object_allowed(a1 || '/' || v_other_conv || '/x.jpg', true), 'a1 cannot write into a foreign conversation';
  assert not public.dm_media_object_allowed('../etc/passwd', false), 'malformed name refused';
  assert not public.dm_media_object_allowed(a1 || '/not-a-uuid/x.jpg', false), 'malformed conversation refused';
  assert public.dm_media_object_allowed(b1 || '/' || v_conv || '/x.jpg', false), 'a1 reads b1''s upload in their conversation';
  perform set_config('app.uid', a2_auth, true);
  assert not public.dm_media_object_allowed(a1 || '/' || v_conv || '/x.jpg', false), 'outsider cannot read';
end $$;

/* Storage policies as the authenticated role, through RLS itself. */
begin;
select set_config('app.uid', '10000000-0000-0000-0000-0000000000a1', true);
create temp table conv_ids as
  select id from public.conversations
   where initiator_id = '00000000-0000-0000-0000-0000000000a1' and recipient_id = '00000000-0000-0000-0000-0000000000b1';
grant select on conv_ids to authenticated;
set local role authenticated;
insert into storage.objects (bucket_id, name)
  select 'dm-media', '00000000-0000-0000-0000-0000000000a1/' || id || '/11111111-1111-1111-1111-111111111111.jpg' from conv_ids;
do $$ begin
  begin
    insert into storage.objects (bucket_id, name)
      select 'dm-media', '00000000-0000-0000-0000-0000000000b1/' || id || '/22222222-2222-2222-2222-222222222222.jpg' from conv_ids;
    assert false, 'upload under somebody else''s prefix passed RLS';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('app.uid', '10000000-0000-0000-0000-0000000000b1', true);
do $$ begin
  assert (select count(*) from storage.objects where bucket_id = 'dm-media') = 1, 'the recipient can read the photo';
end $$;
select set_config('app.uid', '10000000-0000-0000-0000-0000000000a2', true);
do $$ begin
  assert (select count(*) from storage.objects where bucket_id = 'dm-media') = 0, 'an outsider sees nothing';
end $$;
-- And members cannot write messages directly any more.
select set_config('app.uid', '10000000-0000-0000-0000-0000000000a1', true);
do $$ begin
  begin
    insert into public.messages (conversation_id, sender_id, body)
      select id, '00000000-0000-0000-0000-0000000000a1', 'direct' from conv_ids;
    assert false, 'a member inserted a message without send-message';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
