-- Behavioural checks for 20261027110000_email_studio.sql.
\set ON_ERROR_STOP on
set app.role = 'authenticated';

-- Consent matrix (a1 unlocked b1, b2, b5, b6):
--   b1 consents + shares email        → eligible
--   b2 shares email, no consent       → NO_MARKETING_CONSENT
--   b5 consents, does not share email → EMAIL_NOT_SHARED
--   b6 consents + shares, but saved notification prefs with marketing off → MARKETING_OPT_OUT
insert into public.lead_contact_preferences (user_id, accept_marketing_email, share_email_on_unlock) values
  ('00000000-0000-0000-0000-0000000000b1', true, true),
  ('00000000-0000-0000-0000-0000000000b2', false, true),
  ('00000000-0000-0000-0000-0000000000b5', true, false),
  ('00000000-0000-0000-0000-0000000000b6', true, true);
insert into public.notification_preferences (user_id, marketing_opt_in) values ('00000000-0000-0000-0000-0000000000b6', false);

/* ── grants: nothing for anon; owner RPCs for authenticated; the send path service_role only ── */
do $$
declare v_fn record; v_owner_rpcs text[] := array['email_studio_my_properties','email_studio_eligible_recipients',
  'email_studio_save_draft','email_studio_set_recipients','email_studio_get_campaign','email_studio_list_campaigns',
  'email_studio_campaign_stats','email_studio_delete_draft','email_studio_review'];
  v_n integer := 0;
begin
  for v_fn in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname like 'email\_studio\_%' loop
    v_n := v_n + 1;
    assert not has_function_privilege('anon', v_fn.oid, 'execute'), 'anon must not execute ' || v_fn.proname;
    assert not has_function_privilege('public', v_fn.oid, 'execute'), 'PUBLIC must not execute ' || v_fn.proname;
    if v_fn.proname = any(v_owner_rpcs) then
      assert has_function_privilege('authenticated', v_fn.oid, 'execute'), 'authenticated should execute ' || v_fn.proname;
      assert not has_function_privilege('service_role', v_fn.oid, 'execute'), 'owner RPC is session-only: ' || v_fn.proname;
    else
      assert not has_function_privilege('authenticated', v_fn.oid, 'execute'), 'authenticated must not execute ' || v_fn.proname;
      assert has_function_privilege('service_role', v_fn.oid, 'execute'), 'service_role should execute ' || v_fn.proname;
    end if;
  end loop;
  assert v_n = 23, 'expected 23 email_studio functions, found ' || v_n;
  assert not has_table_privilege('authenticated', 'public.email_studio_suppressions', 'select'), 'suppressions are server-only';
  assert not has_table_privilege('authenticated', 'public.email_studio_recipients', 'insert'), 'recipients are written by RPC only';
  assert not has_table_privilege('anon', 'public.email_studio_campaigns', 'select'), 'anon reads nothing';
  assert (select count(*) from pg_class where relname like 'email\_studio\_%' and relkind = 'r' and not relrowsecurity) = 0,
    'RLS on every studio table';
  assert (select value from public.admin_settings where key = 'email_studio_sending_enabled') = 'false'::jsonb, 'kill switch off by default';
  assert (select value from public.admin_settings where key = 'email_studio_daily_recipient_cap') = '200'::jsonb, 'cap default 200';
end $$;

do $$
declare
  v jsonb; v_txt text; v_cid uuid; v_cid2 uuid; v_hash text; v_rid uuid; v_n integer; v_err text; v_res text;
begin
  perform set_config('app.uid', '10000000-0000-0000-0000-0000000000a1', true);

  /* ── properties: own only, premium eligibility from the market segment ── */
  v := public.email_studio_my_properties();
  assert jsonb_array_length(v) = 2, 'a1 owns two listings: ' || v::text;
  assert (select count(*) from jsonb_array_elements(v) e where (e->>'premiumEligible')::boolean) = 1, 'only f2 is PREMIUM';

  /* ── eligibility: reasons, display names only ── */
  v := public.email_studio_eligible_recipients(null);
  assert (v->>'total')::int = 4 and (v->>'eligibleCount')::int = 1, 'four unlocked, one eligible: ' || v::text;
  assert (v->'reasons'->>'NO_MARKETING_CONSENT')::int = 1 and (v->'reasons'->>'EMAIL_NOT_SHARED')::int = 1
     and (v->'reasons'->>'MARKETING_OPT_OUT')::int = 1, 'reason codes: ' || (v->'reasons')::text;
  assert v->'items'->0->>'displayName' = 'Layla' and (v->'items'->0->>'eligible')::boolean, 'eligible first, display name';
  v_txt := v::text;
  assert v_txt not like '%@x.test%' and v_txt not like '%0000000000b1%' and v_txt not like '%+97%', 'no address/id/phone: ' || v_txt;
  v := public.email_studio_eligible_recipients(array['00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000d3']::uuid[]);
  assert (v->>'total')::int = 2 and (v->>'eligibleCount')::int = 1 and (v->'reasons'->>'NOT_UNLOCKED')::int = 1,
    'match handles resolve to unlocked leads only: ' || v::text;
  -- a match handle of ANOTHER seller resolves to nothing for a1
  v := public.email_studio_eligible_recipients(array['00000000-0000-0000-0000-0000000000d6']::uuid[]);
  assert (v->>'eligibleCount')::int = 0 and (v->'reasons'->>'NOT_UNLOCKED')::int = 1, 'foreign match handle: ' || v::text;

  /* ── drafts: own property only; Premium only on a PREMIUM listing ── */
  begin
    perform public.email_studio_save_draft('{"propertyId":"00000000-0000-0000-0000-0000000000f1","templateId":"PREMIUM_PROPERTY"}');
    assert false, 'premium template must be refused for a non-premium listing';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.email_studio_save_draft('{"propertyId":"00000000-0000-0000-0000-0000000000f3"}');
    assert false, 'another seller''s property';
  exception when insufficient_privilege then null;
  end;
  v := public.email_studio_save_draft('{"propertyId":"00000000-0000-0000-0000-0000000000f1","templateId":"PROPERTY_INTRODUCTION","language":"ka","name":"First","content":{"subject":"Hello","blocks":[]}}');
  v_cid := (v->>'campaignId')::uuid;
  assert v->>'status' = 'DRAFT' and v->>'language' = 'ka', 'draft saved: ' || v::text;

  /* ── audience: a2's unlock id is ignored, a1's four are stored ── */
  v := public.email_studio_set_recipients(v_cid, array['00000000-0000-0000-0000-00000000e001','00000000-0000-0000-0000-00000000e002',
        '00000000-0000-0000-0000-00000000e005','00000000-0000-0000-0000-00000000e006','00000000-0000-0000-0000-00000000e101']::uuid[]);
  assert jsonb_array_length(v->'recipients') = 4, 'four recipients (foreign unlock ignored): ' || (v->'recipients')::text;
  assert v::text not like '%@x.test%', 'campaign detail carries no address';

  /* ── review fixes a version ── */
  v := public.email_studio_review(v_cid);
  v_hash := v->>'versionHash';
  assert (v->>'eligible')::int = 1 and (v->>'recipients')::int = 4 and (v->>'costCredits')::int = 0, 'review: ' || v::text;
  assert not (v->>'sendingEnabled')::boolean, 'sending disabled by default';

  /* ── begin_send: hash must match, kill switch respected ── */
  assert public.email_studio_begin_send('00000000-0000-0000-0000-0000000000a1', v_cid, 'deadbeef') = 'VERSION_MISMATCH', 'wrong hash';
  assert public.email_studio_begin_send('00000000-0000-0000-0000-0000000000a1', v_cid, v_hash) = 'SENDING_DISABLED', 'kill switch';
  assert public.email_studio_begin_send('00000000-0000-0000-0000-0000000000a2', v_cid, v_hash) = 'NOT_FOUND', 'other owner';
  update public.admin_settings set value = 'true'::jsonb where key = 'email_studio_sending_enabled';

  -- an edit after review voids it
  perform public.email_studio_save_draft(jsonb_build_object('campaignId', v_cid, 'propertyId', '00000000-0000-0000-0000-0000000000f1',
           'language', 'ka', 'content', '{"subject":"Hello again","blocks":[]}'::jsonb));
  assert public.email_studio_begin_send('00000000-0000-0000-0000-0000000000a1', v_cid, v_hash) = 'NOT_REVIEWED', 'edit voids review';
  v_hash := public.email_studio_review(v_cid)->>'versionHash';
  -- content changed under a review (not via save_draft) → mismatch
  update public.email_studio_campaigns set content = '{"subject":"tampered"}' where id = v_cid;
  assert public.email_studio_begin_send('00000000-0000-0000-0000-0000000000a1', v_cid, v_hash) = 'VERSION_MISMATCH', 'tamper detected';
  update public.email_studio_campaigns set content = '{"subject":"Hello again","blocks":[]}' where id = v_cid;
  assert public.email_studio_begin_send('00000000-0000-0000-0000-0000000000a1', v_cid, v_hash) = 'OK', 'approved send starts';

  /* ── claim: eligibility re-checked, one claim per recipient, ever ── */
  v := public.email_studio_claim_recipients('00000000-0000-0000-0000-0000000000a1', v_cid, 50);
  assert jsonb_array_length(v->'claimed') = 1 and (v->>'skipped')::int = 3, 'one claimed, three skipped: ' || v::text;
  assert v->'claimed'->0->>'email' = 'buyer1@x.test', 'service role gets the address at send time';
  v_rid := (v->'claimed'->0->>'recipientId')::uuid;
  v := public.email_studio_claim_recipients('00000000-0000-0000-0000-0000000000a1', v_cid, 50);
  assert jsonb_array_length(v->'claimed') = 0, 'a retried claim emails nobody twice: ' || v::text;
  assert (select count(*) from public.email_studio_recipients where campaign_id = v_cid
           and lead_user_id = '00000000-0000-0000-0000-0000000000b1') = 1, 'one row per member per campaign';
  assert (select skip_reason from public.email_studio_recipients where campaign_id = v_cid
           and lead_user_id = '00000000-0000-0000-0000-0000000000b2') = 'NO_MARKETING_CONSENT', 'skip reason recorded';
  begin
    insert into public.email_studio_recipients (campaign_id, owner_user_id, lead_user_id, idempotency_key)
    values (v_cid, '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'dup');
    assert false, 'duplicate recipient row must be impossible';
  exception when unique_violation then null;
  end;

  /* ── provider result: once ── */
  assert public.email_studio_mark_sent(v_rid, true, 'RESEND', 'msg-1', null, 0.0005), 'marked sent';
  assert not public.email_studio_mark_sent(v_rid, false, 'RESEND', null, 'late', 0), 'second outcome ignored';
  assert (select status from public.email_studio_recipients where id = v_rid) = 'SENT', 'SENT';
  assert (select status from public.lead_crm_entries where owner_user_id = '00000000-0000-0000-0000-0000000000a1'
           and lead_user_id = '00000000-0000-0000-0000-0000000000b1') = 'CONTACTED', 'CRM moves to CONTACTED';
  assert exists (select 1 from public.lead_crm_events ev join public.lead_crm_entries e on e.id = ev.entry_id
                  where e.lead_user_id = '00000000-0000-0000-0000-0000000000b1' and ev.kind = 'EMAIL_SENT'), 'EMAIL_SENT CRM event';

  /* ── webhook events: deduped, monotonic, opens/clicks counted ── */
  assert public.email_studio_apply_event('msg-unknown', 'DELIVERED', 'evt-x') is null, 'unknown message falls through';
  assert public.email_studio_apply_event('msg-1', 'DELIVERED', 'evt-1') = v_cid, 'delivered applied';
  assert public.email_studio_apply_event('msg-1', 'DELIVERED', 'evt-1') = v_cid, 'duplicate delivery tolerated';
  perform public.email_studio_apply_event('msg-1', 'OPENED', 'evt-2');
  perform public.email_studio_apply_event('msg-1', 'OPENED', 'evt-2');
  perform public.email_studio_apply_event('msg-1', 'OPENED', 'evt-3');
  perform public.email_studio_apply_event('msg-1', 'CLICKED', 'evt-4', '{"link":"https://homatch.live/p/100001"}');
  assert (select open_count from public.email_studio_recipients where id = v_rid) = 2, 'opens deduped per event id';
  assert (select count(*) from public.lead_crm_events ev join public.lead_crm_entries e on e.id = ev.entry_id
           where e.lead_user_id = '00000000-0000-0000-0000-0000000000b1' and ev.kind = 'EMAIL_OPENED') = 1, 'first open only in CRM';
  assert (select status from public.lead_crm_entries where owner_user_id = '00000000-0000-0000-0000-0000000000a1'
           and lead_user_id = '00000000-0000-0000-0000-0000000000b1') = 'DELIVERED', 'CRM DELIVERED';
  assert public.email_studio_finish_send(v_cid) = 'SENT', 'campaign finished';
  v := public.email_studio_campaign_stats(v_cid);
  assert (v->>'sent')::int = 1 and (v->>'delivered')::int = 1 and (v->>'opened')::int = 1 and (v->>'clicked')::int = 1
     and (v->>'skipped')::int = 3 and not (v->>'repliedTracked')::boolean and (v->>'opensApproximate')::boolean, 'stats: ' || v::text;
  assert public.email_studio_begin_send('00000000-0000-0000-0000-0000000000a1', v_cid, v_hash) = 'ALREADY_SENT', 'no resend';
  begin
    perform public.email_studio_set_recipients(v_cid, array[]::uuid[]);
    assert false, 'a sent campaign is frozen';
  exception when invalid_parameter_value then null;
  end;

  /* ── unsubscribe withdraws consent everywhere, idempotently ── */
  v := public.email_studio_unsubscribe(v_rid);
  assert (v->>'ok')::boolean and not (v->>'already')::boolean and v->>'language' = 'ar', 'unsubscribed: ' || v::text;
  v := public.email_studio_unsubscribe(v_rid);
  assert (v->>'already')::boolean, 'second click is already';
  assert not (select accept_marketing_email from public.lead_contact_preferences where user_id = '00000000-0000-0000-0000-0000000000b1'),
    'marketing consent withdrawn';
  assert public.email_studio_lead_eligibility('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1') = 'NO_MARKETING_CONSENT', 'b1 out';
  update public.lead_contact_preferences set accept_marketing_email = true where user_id = '00000000-0000-0000-0000-0000000000b1';
  assert public.email_studio_lead_eligibility('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1') = 'SUPPRESSED',
    'unsubscribe suppresses for every seller';
  assert (public.email_studio_campaign_stats(v_cid)->>'unsubscribed')::int = 1, 'unsubscribed counted';

  /* ── daily cap: a1 already used 1 of the window ── */
  delete from public.notification_preferences where user_id = '00000000-0000-0000-0000-0000000000b6';
  update public.admin_settings set value = '1'::jsonb where key = 'email_studio_daily_recipient_cap';
  v := public.email_studio_save_draft('{"propertyId":"00000000-0000-0000-0000-0000000000f2","templateId":"PREMIUM_PROPERTY","content":{}}');
  v_cid2 := (v->>'campaignId')::uuid;
  perform public.email_studio_set_recipients(v_cid2, array['00000000-0000-0000-0000-00000000e006']::uuid[]);
  v_hash := public.email_studio_review(v_cid2)->>'versionHash';
  assert public.email_studio_begin_send('00000000-0000-0000-0000-0000000000a1', v_cid2, v_hash) = 'OK', 'second campaign';
  v := public.email_studio_claim_recipients('00000000-0000-0000-0000-0000000000a1', v_cid2, 50);
  assert jsonb_array_length(v->'claimed') = 0 and (v->>'capRemaining')::int = 0 and (v->>'remaining')::int = 1, 'cap reached: ' || v::text;
  update public.admin_settings set value = '5'::jsonb where key = 'email_studio_daily_recipient_cap';
  v := public.email_studio_claim_recipients('00000000-0000-0000-0000-0000000000a1', v_cid2, 50);
  assert jsonb_array_length(v->'claimed') = 1, 'cap raised → b6 claimed: ' || v::text;
  v_rid := (v->'claimed'->0->>'recipientId')::uuid;
  perform public.email_studio_mark_sent(v_rid, true, 'RESEND', 'msg-2', null, 0);

  /* ── bounce and complaint suppress ── */
  perform public.email_studio_apply_event('msg-2', 'BOUNCED', 'evt-5', '{"bounceType":"Permanent"}');
  perform public.email_studio_apply_event('msg-2', 'DELIVERED', 'evt-6');
  assert (select status from public.email_studio_recipients where id = v_rid) = 'BOUNCED', 'late delivered does not undo a bounce';
  assert exists (select 1 from public.email_studio_suppressions where user_id = '00000000-0000-0000-0000-0000000000b6' and reason = 'BOUNCED'), 'bounce suppressed';
  perform public.email_studio_apply_event('msg-2', 'COMPLAINED', 'evt-7');
  assert not (select accept_marketing_email from public.lead_contact_preferences where user_id = '00000000-0000-0000-0000-0000000000b6'), 'complaint withdraws consent';
  assert exists (select 1 from public.email_studio_suppressions where user_id = '00000000-0000-0000-0000-0000000000b6' and reason = 'COMPLAINED'), 'complaint suppressed';

  /* ── the seller's own outreach suppression list applies too ── */
  update public.lead_contact_preferences set share_email_on_unlock = true where user_id = '00000000-0000-0000-0000-0000000000b5';
  assert public.email_studio_lead_eligibility('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b5') is null, 'b5 now eligible';
  insert into public.outreach_contacts (owner_id, email, unsubscribed) values ('10000000-0000-0000-0000-0000000000a1', 'BUYER5@x.test', true);
  assert public.email_studio_lead_eligibility('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b5') = 'SUPPRESSED', 'outreach unsubscribe honoured';

  /* ── test sends: 5 per day ── */
  for v_n in 1..5 loop
    assert public.email_studio_record_test('00000000-0000-0000-0000-0000000000a1', v_cid2), 'test ' || v_n;
  end loop;
  assert not public.email_studio_record_test('00000000-0000-0000-0000-0000000000a1', v_cid2), 'sixth test refused';
  assert not public.email_studio_record_test('00000000-0000-0000-0000-0000000000a2', v_cid2), 'test on a foreign campaign refused';

  /* ── isolation: a2 sees none of a1's campaigns ── */
  perform set_config('app.uid', '10000000-0000-0000-0000-0000000000a2', true);
  assert jsonb_array_length(public.email_studio_list_campaigns()) = 0, 'a2 lists nothing';
  begin
    perform public.email_studio_get_campaign(v_cid);
    assert false, 'a2 must not read a1''s campaign';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.email_studio_review(v_cid2);
    assert false, 'a2 must not review a1''s campaign';
  exception when insufficient_privilege then null;
  end;
  assert public.email_studio_delete_draft(v_cid2) = false, 'a2 cannot delete';
  v := public.email_studio_eligible_recipients(null);
  assert (v->>'total')::int = 1, 'a2 sees only its own unlock: ' || v::text;

  /* ── suspended owner cannot send ── */
  update public.users set suspended_at = now() where id = '00000000-0000-0000-0000-0000000000a1';
  update public.email_studio_campaigns set status = 'REVIEWED' where id = v_cid2;
  assert public.email_studio_begin_send('00000000-0000-0000-0000-0000000000a1', v_cid2, v_hash) = 'ACCOUNT_SUSPENDED', 'suspended';
  update public.users set suspended_at = null where id = '00000000-0000-0000-0000-0000000000a1';
end $$;

/* ── RLS as the real role: a2's session reads no a1 rows; a1 reads its own ── */
grant select on public.users to authenticated;
set role authenticated;
set app.uid = '10000000-0000-0000-0000-0000000000a2';
do $$ begin
  assert (select count(*) from public.email_studio_campaigns) = 0, 'RLS: a2 sees no campaigns';
  assert (select count(*) from public.email_studio_recipients) = 0, 'RLS: a2 sees no recipients';
end $$;
set app.uid = '10000000-0000-0000-0000-0000000000a1';
do $$ begin
  assert (select count(*) from public.email_studio_campaigns) = 2, 'RLS: a1 sees its two campaigns';
end $$;
reset role;

/* ── a claim that never reported back is closed, never re-sent ── */
do $$
declare v jsonb; v_cid uuid;
begin
  select id into v_cid from public.email_studio_campaigns where template_id = 'PREMIUM_PROPERTY';
  update public.email_studio_campaigns set status = 'SENDING' where id = v_cid;
  insert into public.email_studio_recipients (campaign_id, owner_user_id, lead_user_id, idempotency_key, status, claimed_at)
  values (v_cid, '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b5', 'stuck', 'SENDING', now() - interval '1 hour');
  v := public.email_studio_claim_recipients('00000000-0000-0000-0000-0000000000a1', v_cid, 50);
  assert jsonb_array_length(v->'claimed') = 0, 'stuck row not re-claimed';
  assert (select status || ':' || error_message from public.email_studio_recipients where idempotency_key = 'stuck') = 'FAILED:UNCONFIRMED', 'stuck → FAILED/UNCONFIRMED';
  assert public.email_studio_finish_send(v_cid) = 'SENT', 'campaign can close';
end $$;
