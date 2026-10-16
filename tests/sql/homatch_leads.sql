-- Behavioural checks for 20261028090000_homatch_leads_marketplace.sql.
\set ON_ERROR_STOP on
set app.role = 'authenticated';

-- b3 opts out of property offers; b1 shares a phone on unlock, b2 shares nothing.
insert into public.lead_contact_preferences (user_id, accept_property_offers) values ('00000000-0000-0000-0000-0000000000b3', false);
insert into public.lead_contact_preferences (user_id, share_phone_on_unlock) values ('00000000-0000-0000-0000-0000000000b1', true);

do $$
declare
  v jsonb; v2 jsonb; v_item jsonb; v_bal numeric; v_n integer; v_txt text; v_conv uuid; v_err text;
begin
  /* ── prices come from the catalogue ─────────────────────────────── */
  v := public.internal_lead_prices();
  assert (v->>'STANDARD')::numeric = 2.5, 'standard price 2.5: ' || v::text;
  assert (v->>'PREMIUM')::numeric = 6, 'premium price 6: ' || v::text;

  /* ── segment from the member's own budget, configurable ─────────── */
  assert (select segment from public.internal_lead_segment('00000000-0000-0000-0000-0000000000c1')) = 'STANDARD', 'b1 220k → STANDARD';
  assert (select segment from public.internal_lead_segment('00000000-0000-0000-0000-0000000000c2')) = 'PREMIUM', 'b2 450k → PREMIUM';

  /* ── the feed: owner only, eligible members only, nothing identifying ── */
  perform set_config('app.uid', '10000000-0000-0000-0000-0000000000a1', true);
  v := public.internal_leads_feed('00000000-0000-0000-0000-0000000000f1');
  assert (v->>'total')::int = 2, 'two eligible leads (opt-out and inactive excluded): ' || (v->'counts')::text;
  assert (v->'counts'->>'PREMIUM')::int = 1 and (v->'counts'->>'STANDARD')::int = 1, 'one of each segment';
  assert (v->'counts'->>'STRONG')::int = 1 and (v->'counts'->>'POTENTIAL')::int = 1, 'bands from the score only';
  v_item := v->'items'->0;
  assert v_item->>'matchId' = '00000000-0000-0000-0000-0000000000d2', 'best match first (0.91): ' || v_item::text;
  assert v_item->>'segment' = 'PREMIUM' and (v_item->>'score')::int = 91, 'premium keeps the engine score';
  v_txt := v::text;
  assert v_txt not like '%PRIVATE TEXT%' and v_txt not like '%@x.test%' and v_txt not like '%+97%' and v_txt not like '%+79%'
     and v_txt not like '%Layla%' and v_txt not like '%Ivan%'
     and v_txt not like '%0000000000b1%' and v_txt not like '%0000000000b2%', 'no identity before unlock: ' || v_txt;
  assert (v->'items'->1->'contactOptions'->>'phone')::boolean = true, 'b1 phone channel advertised (consent + number)';
  assert (v->'items'->0->'contactOptions'->>'phone')::boolean = false, 'b2 shares no phone';
  assert (v->'counts'->>'FRESH')::int = 1, 'only the 2-day-old match is fresh on a first visit';
  v := public.internal_leads_feed('00000000-0000-0000-0000-0000000000f1', 'PREMIUM');
  assert (v->>'total')::int = 1, 'premium filter';
  v := public.internal_leads_feed('00000000-0000-0000-0000-0000000000f1', 'ALL', 'BUDGET_ASC');
  assert v->'items'->0->>'matchId' = '00000000-0000-0000-0000-0000000000d1', 'budget ascending';

  perform set_config('app.uid', '10000000-0000-0000-0000-0000000000a2', true);
  begin
    perform public.internal_leads_feed('00000000-0000-0000-0000-0000000000f1');
    assert false, 'another seller must not read this feed';
  exception when insufficient_privilege then null;
  end;

  /* ── quote, then unlock as the edge function would (service_role) ── */
  perform set_config('app.uid', '10000000-0000-0000-0000-0000000000a1', true);
  v := public.internal_leads_unlock_quote(array['00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000d3']::uuid[]);
  assert (v->>'totalCredits')::numeric = 8.5 and (v->>'standardCount')::int = 1 and (v->>'premiumCount')::int = 1, 'quote 2.5 + 6, opt-out skipped: ' || v::text;

  perform set_config('app.role', 'authenticated', true);
  begin
    perform public.internal_leads_unlock('00000000-0000-0000-0000-0000000000a1', array['00000000-0000-0000-0000-0000000000d1']::uuid[], 'key-forbidden-1');
    assert false, 'unlock is service_role only';
  exception when others then
    get stacked diagnostics v_err = message_text; assert v_err like '%FORBIDDEN%', v_err;
  end;

  perform set_config('app.role', 'service_role', true);
  -- Standard: exactly 2.5.
  v := public.internal_leads_unlock('00000000-0000-0000-0000-0000000000a1', array['00000000-0000-0000-0000-0000000000d1']::uuid[], 'key-standard-1');
  assert (v->>'chargedCredits')::numeric = 2.5, 'standard charges 2.5: ' || v::text;
  select balance into v_bal from public.credit_accounts where user_id = '00000000-0000-0000-0000-0000000000a1';
  assert v_bal = 17.5, 'balance 20 → 17.5: ' || v_bal;

  -- Same key again: stored result, no charge.
  v := public.internal_leads_unlock('00000000-0000-0000-0000-0000000000a1', array['00000000-0000-0000-0000-0000000000d1']::uuid[], 'key-standard-1');
  assert (v->>'duplicate')::boolean, 'retry returns the stored result';
  select balance into v_bal from public.credit_accounts where user_id = '00000000-0000-0000-0000-0000000000a1';
  assert v_bal = 17.5, 'no double charge on retry: ' || v_bal;

  -- Same member via ANOTHER property (d5) with a NEW key: entitlement reused, 0 charged.
  v := public.internal_leads_unlock('00000000-0000-0000-0000-0000000000a1', array['00000000-0000-0000-0000-0000000000d5']::uuid[], 'key-other-property');
  assert (v->>'chargedCredits')::numeric = 0 and jsonb_array_length(v->'alreadyUnlocked') = 1, 'no charge for an unlocked member on another listing: ' || v::text;

  -- Bulk: premium + the already-unlocked + the opted-out + a foreign match → only premium charged (6).
  v := public.internal_leads_unlock('00000000-0000-0000-0000-0000000000a1',
        array['00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000d1',
              '00000000-0000-0000-0000-0000000000d3','00000000-0000-0000-0000-0000000000d6']::uuid[], 'key-bulk-1');
  assert (v->>'chargedCredits')::numeric = 6, 'bulk charges premium only: ' || v::text;
  assert jsonb_array_length(v->'skipped') = 2, 'opted-out and foreign match skipped: ' || v::text;
  select balance into v_bal from public.credit_accounts where user_id = '00000000-0000-0000-0000-0000000000a1';
  assert v_bal = 11.5, 'balance 17.5 → 11.5: ' || v_bal;

  -- Separate products, separate usage events.
  assert (select count(*) from public.usage_events where product_code = 'INTERNAL_LEAD_STANDARD') = 1, 'one standard usage event';
  assert (select charged_credits from public.usage_events where product_code = 'INTERNAL_LEAD_PREMIUM') = 6, 'premium usage event 6';

  -- A different account unlocks the same member independently (and can't afford premium).
  v := public.internal_leads_unlock('00000000-0000-0000-0000-0000000000a2', array['00000000-0000-0000-0000-0000000000d6']::uuid[], 'key-a2-1');
  assert (v->>'chargedCredits')::numeric = 2.5, 'second account pays its own unlock: ' || v::text;
  assert (select count(*) from public.internal_lead_unlocks where lead_user_id = '00000000-0000-0000-0000-0000000000b1') = 2, 'two independent entitlements';

  -- Insufficient credits: the whole selection rolls back, nothing recorded.
  update public.credit_accounts set balance = 1 where user_id = '00000000-0000-0000-0000-0000000000a1';
  insert into public.supply_matches (id, intent_profile_id, property_id, supply_user_id, demand_user_id, source_kind, compatibility, match_score, agreed)
  select '00000000-0000-0000-0000-0000000000d9', '00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000f2',
         '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b4', 'INTERNAL_HOMATCH', 'COMPATIBLE', 0.8, '{CITY}';
  update public.active_search_subscriptions set is_active = true where user_id = '00000000-0000-0000-0000-0000000000b4';
  begin
    perform public.internal_leads_unlock('00000000-0000-0000-0000-0000000000a1', array['00000000-0000-0000-0000-0000000000d9']::uuid[], 'key-poor-1');
    assert false, 'must refuse without credits';
  exception when others then
    get stacked diagnostics v_err = message_text; assert v_err like '%INSUFFICIENT_CREDITS%', v_err;
  end;
  assert not exists (select 1 from public.internal_lead_unlocks where lead_user_id = '00000000-0000-0000-0000-0000000000b4'), 'nothing recorded on failure';
  assert not exists (select 1 from public.internal_lead_unlock_batches where idempotency_key = 'key-poor-1'), 'no batch on failure';
  update public.credit_accounts set balance = 11.5 where user_id = '00000000-0000-0000-0000-0000000000a1';

  /* ── after unlock: contact exactly as permitted ───────────────────── */
  perform set_config('app.role', 'authenticated', true);
  v := public.internal_lead_contact('00000000-0000-0000-0000-0000000000d1');
  assert v->>'phone' = '+971500000001' and v->>'displayName' = 'Layla' and v->>'email' is null, 'b1: phone shared, email not: ' || v::text;
  assert (select count(*) from public.contact_disclosures where subject_user_id = '00000000-0000-0000-0000-0000000000b1') = 1, 'disclosure logged';
  v := public.internal_lead_contact('00000000-0000-0000-0000-0000000000d2');
  assert v->>'phone' is null and v->>'email' is null and (v->>'canMessage')::boolean, 'b2: message only: ' || v::text;
  begin
    perform public.internal_lead_contact('00000000-0000-0000-0000-0000000000d4');
    assert false, 'contact of a locked lead must be refused';
  exception when insufficient_privilege then null;
  end;

  /* ── feed now shows the unlocked identity only ─────────────────────── */
  v := public.internal_leads_feed('00000000-0000-0000-0000-0000000000f1', 'UNLOCKED');
  assert (v->>'total')::int = 2, 'two unlocked on P1';

  /* ── conversation, CRM trail ──────────────────────────────────────── */
  v_conv := public.internal_lead_open_conversation('00000000-0000-0000-0000-0000000000d1');
  assert v_conv is not null and v_conv = public.internal_lead_open_conversation('00000000-0000-0000-0000-0000000000d1'), 'same conversation on reopen';
  insert into public.messages (conversation_id, sender_id, body) values (v_conv, '00000000-0000-0000-0000-0000000000a1', 'Hello!');
  assert (select status from public.lead_crm_entries where lead_user_id = '00000000-0000-0000-0000-0000000000b1' and owner_user_id = '00000000-0000-0000-0000-0000000000a1') = 'CONTACTED', 'owner message → CONTACTED';
  update public.messages set status = 'DELIVERED' where conversation_id = v_conv;
  assert (select status from public.lead_crm_entries where lead_user_id = '00000000-0000-0000-0000-0000000000b1' and owner_user_id = '00000000-0000-0000-0000-0000000000a1') = 'DELIVERED', 'delivered';
  insert into public.messages (conversation_id, sender_id, body) values (v_conv, '00000000-0000-0000-0000-0000000000b1', 'Interested!');
  assert (select status from public.lead_crm_entries where lead_user_id = '00000000-0000-0000-0000-0000000000b1' and owner_user_id = '00000000-0000-0000-0000-0000000000a1') = 'REPLIED', 'reply → REPLIED, never INTERESTED by inference';

  v := public.crm_list();
  assert (v->>'total')::int = 2 and (v->'counts'->>'REPLIED')::int = 1, 'crm list: ' || v::text;
  v := public.crm_update(((public.crm_list('REPLIED'))->'items'->0->>'entryId')::uuid,
        jsonb_build_object('status', 'VIEWING_SCHEDULED', 'note', 'Viewing Saturday', 'followUpAt', (now() - interval '1 minute')::text));
  assert v->>'status' = 'VIEWING_SCHEDULED' and jsonb_array_length(v->'notes') = 1, 'owner status + note: ' || v::text;
  perform set_config('app.role', 'service_role', true);
  assert public.crm_emit_due_follow_ups() = 1, 'a due follow-up becomes one reminder';
  assert public.crm_emit_due_follow_ups() = 0, 'and only one';
  perform set_config('app.role', 'authenticated', true);

  /* ── blocking: the lead blocks the seller ─────────────────────────── */
  insert into public.conversation_blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1');
  v := public.internal_lead_contact('00000000-0000-0000-0000-0000000000d2');
  assert (v->>'restricted')::boolean and v->>'reason' = 'BLOCKED', 'block restricts contact: ' || v::text;
  v := public.internal_leads_feed('00000000-0000-0000-0000-0000000000f1');
  assert not (v::text like '%0000000000d2%'), 'a member who blocked the seller leaves the feed';

  /* ── withdrawn consent restricts, without a refund-able re-charge ──── */
  update public.lead_contact_preferences set share_phone_on_unlock = false where user_id = '00000000-0000-0000-0000-0000000000b1';
  v := public.internal_lead_contact('00000000-0000-0000-0000-0000000000d1');
  assert v->>'phone' is null, 'withdrawn phone consent applies at once';

  /* ── owner-side MATCH conversation now needs the unlock ───────────── */
  perform set_config('app.uid', '10000000-0000-0000-0000-0000000000a2', true);
  begin
    perform public.open_native_conversation('MATCH', '00000000-0000-0000-0000-0000000000d6');
    -- a2 unlocked b1 above, so this succeeds; now try a member a2 has not unlocked.
  exception when others then assert false, 'unlocked member should open';
  end;
  perform set_config('app.uid', '10000000-0000-0000-0000-0000000000a1', true);
  begin
    perform public.open_native_conversation('MATCH', '00000000-0000-0000-0000-0000000000d9');
    assert false, 'owner must unlock before opening a conversation';
  exception when others then
    get stacked diagnostics v_err = message_text; assert v_err like '%UNLOCK_REQUIRED%', v_err;
  end;
  -- The member looking may still write to the owner (free, unchanged).
  perform set_config('app.uid', '10000000-0000-0000-0000-0000000000b4', true);
  assert public.open_native_conversation('MATCH', '00000000-0000-0000-0000-0000000000d9') is not null, 'seeker side unchanged';

  /* ── fresh matching: a listing change queues the property ─────────── */
  delete from public.native_match_property_queue;
  update public.properties set matching_status = 'ACTIVE' where id = '00000000-0000-0000-0000-0000000000f2';
  insert into public.property_facts (property_id, city, total_price, currency) values ('00000000-0000-0000-0000-0000000000f1', 'Tbilisi', 210000, 'USD');
  assert (select count(*) from public.native_match_property_queue) = 2, 'two properties queued';
  perform set_config('app.role', 'service_role', true);
  assert array_length(public.native_match_claim_properties(10), 1) = 2, 'claimed';
  assert (select count(*) from public.native_match_property_queue) = 0, 'and removed from the queue';

  /* ── saved leads ─────────────────────────────────────────────────── */
  perform set_config('app.role', 'authenticated', true);
  perform set_config('app.uid', '10000000-0000-0000-0000-0000000000a1', true);
  assert public.internal_lead_toggle_saved('00000000-0000-0000-0000-0000000000d1') = true, 'saved';
  v := public.internal_leads_feed('00000000-0000-0000-0000-0000000000f1', 'SAVED');
  assert (v->>'total')::int = 1 and (v->'items'->0->>'saved')::boolean, 'saved filter';
  assert public.internal_lead_toggle_saved('00000000-0000-0000-0000-0000000000d1') = false, 'unsaved';
  perform set_config('app.uid', '10000000-0000-0000-0000-0000000000a2', true);
  begin perform public.internal_lead_toggle_saved('00000000-0000-0000-0000-0000000000d1'); assert false, 'foreign save';
  exception when insufficient_privilege then null; end;

  /* ── seen watermark ───────────────────────────────────────────────── */
  perform set_config('app.role', 'authenticated', true);
  perform set_config('app.uid', '10000000-0000-0000-0000-0000000000a1', true);
  perform public.internal_leads_mark_seen('00000000-0000-0000-0000-0000000000f1');
  v := public.internal_leads_feed('00000000-0000-0000-0000-0000000000f1');
  assert (v->'counts'->>'FRESH')::int = 0, 'nothing fresh right after a visit';

  /* ── admin ─────────────────────────────────────────────────────────── */
  begin
    perform public.admin_internal_leads_overview();
    assert false, 'admin only';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Grants: nothing for anon, unlock only for service_role.
do $$ begin
  assert not has_function_privilege('anon', 'public.internal_leads_feed(uuid, text, text, integer, integer)', 'execute'), 'anon feed';
  assert not has_function_privilege('authenticated', 'public.internal_leads_unlock(uuid, uuid[], text)', 'execute'), 'authenticated unlock';
  assert has_function_privilege('service_role', 'public.internal_leads_unlock(uuid, uuid[], text)', 'execute'), 'service unlock';
  assert not has_table_privilege('authenticated', 'public.internal_lead_unlocks', 'select'), 'entitlements not client-readable';
end $$;
