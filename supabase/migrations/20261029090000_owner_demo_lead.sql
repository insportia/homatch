-- HOMATCH — the interactive owner demo lead ("Demo Mode" in HOMATCH Leads).
--
-- The owner of a listing, when they are an administrator or a listed demo tester,
-- can walk the whole Leads journey against ONE fictional buyer: a discovered
-- match, a locked lead card, a simulated unlock, a revealed fictional contact,
-- CRM stage and notes, a simulated conversation with a property offer, an Email
-- Studio draft and its preview, and the notifications and activity it produces.
--
-- It is built on the internal-match demo (20261024120000) and shares its
-- isolation: everything lives in demo_buyer_profiles / demo_conversations /
-- demo_messages. Nothing here reads or writes a wallet, credit_transactions,
-- supply_matches, find_buyers_leads, crm_entries, conversations, messages,
-- notifications, email_campaigns or any campaign or provider table, so the demo
-- can never charge, notify, send, or appear in a lead feed, a matching statistic,
-- campaign spending, reporting or an outreach queue.
--
-- WHO SEES IT: the authenticated caller, resolved from their own session
-- (current_homatch_user_id), who OWNS the property and is in the demo audience
-- (internal_match_demo_allowed: is_admin() or a users.id listed in
-- admin_settings 'internal_match_demo_testers'). Never an e-mail address.
--
-- THE FICTIONAL BUYER: "Alex Morgan" is invented. The contact uses the reserved
-- example.com domain (RFC 2606) and a +995 000 number, which no operator issues,
-- so nothing about this profile can reach a real person. Every row says DEMO.
--
-- Append-only and idempotent: columns are added if missing, the seed is keyed on
-- demo_key, and every function is create-or-replace.

/* ── shape ───────────────────────────────────────────────────────────────── */

alter table public.demo_buyer_profiles
  add column if not exists display_name text,
  /* Simulated presentation: score, source, segment, price, explanation, history. */
  add column if not exists demo_details jsonb not null default '{}'::jsonb,
  /* Fictional contact, returned by the RPCs only after the simulated unlock. */
  add column if not exists demo_contact jsonb not null default '{}'::jsonb;

alter table public.demo_conversations
  /* CRM stage, notes, saved flag, offer, email draft, walkthrough — all simulated. */
  add column if not exists demo_state jsonb not null default '{}'::jsonb,
  /* The simulated activity / notification log, newest last, capped. */
  add column if not exists demo_events jsonb not null default '[]'::jsonb;

/* ── the seed: one fictional buyer for HOMATCH 244486 ────────────────────── */

insert into public.demo_buyer_profiles (
  demo_key, property_id, display_label, display_name, intent_type, transaction_type, city,
  districts, property_types, budget_min, budget_max, currency, bedrooms_min, bedrooms_max,
  rooms_min, rooms_max, area_min, area_max, timeline_months, search_criteria, demo_details, demo_contact
)
select 'owner-demo-lead-alex-morgan', p.id, 'DEMO', 'Alex Morgan', 'BUY', 'SALE', 'Tbilisi',
       array['Krtsanisi', 'Ortachala'], array['APARTMENT'], 140000, 180000, 'USD', 2, 2,
       null, null, null, null, 3,
       '{"parking": true}'::jsonb,
       jsonb_build_object(
         'simulated', true,
         'match_score', 92,
         'band', 'STRONG',
         'segment', 'STANDARD',
         'source', 'HOMATCH_DEMO',
         'unlock_credits', 2.5,
         'language', 'en',
         'agreed', jsonb_build_array('TRANSACTION', 'PROPERTY_TYPE', 'CITY', 'DISTRICT', 'BEDROOMS', 'PARKING'),
         'conflicted', jsonb_build_array('PRICE'),
         'request_days_ago', 12,
         'history', jsonb_build_array(
           jsonb_build_object('kind', 'SEARCH_CREATED', 'days_ago', 12),
           jsonb_build_object('kind', 'BUDGET_UPDATED', 'days_ago', 5),
           jsonb_build_object('kind', 'ALERT_ENABLED', 'days_ago', 5),
           jsonb_build_object('kind', 'SEARCH_ACTIVE', 'days_ago', 1))
       ),
       jsonb_build_object(
         'email', 'alex.morgan.demo@example.com',
         'phone', '+995 000 00 00 92',
         'preferred_channel', 'MESSAGE',
         'fictional', true)
  from public.properties p
 where p.id = 'c5c1a6a4-6fed-4764-91c2-3cd7ad090407'
on conflict (demo_key) do nothing;

/* ── who may use it ──────────────────────────────────────────────────────── */

/*
 * The owner-demo profile for this property, when the caller owns the property and is
 * in the demo audience; otherwise null. The single authorisation rule every RPC below
 * goes through.
 */
create or replace function public.owner_demo_lead_profile(p_property_id uuid)
returns public.demo_buyer_profiles
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_me   uuid := public.current_homatch_user_id();
  v_prof public.demo_buyer_profiles;
begin
  if v_me is null or p_property_id is null or not public.internal_match_demo_allowed() then return null; end if;
  if not exists (select 1 from public.properties
                  where id = p_property_id and user_id = v_me and is_deleted = false) then
    return null;
  end if;
  select * into v_prof from public.demo_buyer_profiles
   where property_id = p_property_id and demo_key = 'owner-demo-lead-alex-morgan';
  if not found then return null; end if;
  return v_prof;
end $$;

revoke all on function public.owner_demo_lead_profile(uuid) from public, anon, authenticated;

/* Whether to show the Demo Mode entry. Never creates anything. */
create or replace function public.owner_demo_lead_available(p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (public.owner_demo_lead_profile(p_property_id)).id is not null
$$;

revoke all on function public.owner_demo_lead_available(uuid) from public, anon;
grant execute on function public.owner_demo_lead_available(uuid) to authenticated;

/* ── the payload ─────────────────────────────────────────────────────────── */

create or replace function public.owner_demo_lead_payload(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_conv  public.demo_conversations;
  v_prof  public.demo_buyer_profiles;
  v_prop  record;
  v_facts jsonb;
  v_msgs  jsonb;
  v_open  boolean;
begin
  select * into v_conv from public.demo_conversations where id = p_conversation_id;
  if not found then return null; end if;
  select * into v_prof from public.demo_buyer_profiles where id = v_conv.demo_buyer_id;
  select id, homatch_id, title into v_prop from public.properties where id = v_conv.property_id;
  select to_jsonb(f) into v_facts from (
    select city, district, total_price, currency, area, rooms, bedrooms
      from public.property_facts where property_id = v_conv.property_id
     order by updated_at desc limit 1
  ) f;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'seq', m.seq, 'sender', m.sender, 'body', m.body, 'is_simulated', m.is_simulated,
           'language', m.language, 'sent_at', m.sent_at, 'delivered_at', m.delivered_at,
           'seen_at', m.seen_at, 'created_at', m.created_at) order by m.seq), '[]'::jsonb)
    into v_msgs
    from public.demo_messages m where m.conversation_id = v_conv.id;
  v_open := v_conv.demo_unlocked_at is not null;

  return jsonb_build_object(
    'is_demo', true,
    'conversation_id', v_conv.id,
    'property', jsonb_build_object('id', v_prop.id, 'homatch_id', v_prop.homatch_id, 'title', v_prop.title),
    'facts', v_facts,
    'profile', jsonb_build_object(
      'id', v_prof.id,
      'display_label', v_prof.display_label,
      /* Like the real feed: who the member is only after the unlock. */
      'display_name', case when v_open then v_prof.display_name end,
      'transaction_type', v_prof.transaction_type,
      'property_types', to_jsonb(v_prof.property_types),
      'city', v_prof.city,
      'districts', to_jsonb(v_prof.districts),
      'budget_min', v_prof.budget_min, 'budget_max', v_prof.budget_max, 'currency', v_prof.currency,
      'bedrooms_min', v_prof.bedrooms_min, 'bedrooms_max', v_prof.bedrooms_max,
      'timeline_months', v_prof.timeline_months,
      'search_criteria', v_prof.search_criteria,
      'details', v_prof.demo_details),
    'contact', case when v_open then v_prof.demo_contact end,
    'unlocked_at', v_conv.demo_unlocked_at,
    'state', v_conv.demo_state,
    'events', v_conv.demo_events,
    'messages', v_msgs,
    'opened_at', v_conv.created_at
  );
end $$;

revoke all on function public.owner_demo_lead_payload(uuid) from public, anon, authenticated;

/* One simulated activity event, appended and capped at the newest 200. */
create or replace function public.owner_demo_lead_event(p_events jsonb, p_kind text, p_detail jsonb default '{}'::jsonb)
returns jsonb
language sql
volatile
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(e order by ord), '[]'::jsonb)
    from (
      select e, ord from jsonb_array_elements(
               coalesce(p_events, '[]'::jsonb)
               || jsonb_build_array(jsonb_build_object('kind', p_kind, 'detail', coalesce(p_detail, '{}'::jsonb),
                                                       'at', clock_timestamp(), 'simulated', true)))
             with ordinality as x(e, ord)
       order by ord desc limit 200
    ) kept
$$;

revoke all on function public.owner_demo_lead_event(jsonb, text, jsonb) from public, anon, authenticated;

/* ── open / act / reset ──────────────────────────────────────────────────── */

/* Enter Demo Mode: the caller's demo conversation for this property (same row every time). */
create or replace function public.owner_demo_lead_open(p_property_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me   uuid := public.current_homatch_user_id();
  v_prof public.demo_buyer_profiles := public.owner_demo_lead_profile(p_property_id);
  v_id   uuid;
begin
  if v_prof.id is null then raise exception 'DEMO_NOT_ALLOWED' using errcode = '42501'; end if;
  insert into public.demo_conversations (demo_buyer_id, property_id, owner_user_id, demo_events)
  values (v_prof.id, p_property_id, v_me,
          public.owner_demo_lead_event('[]'::jsonb, 'MATCH_DISCOVERED', jsonb_build_object('score', v_prof.demo_details->'match_score')))
  on conflict (demo_buyer_id, property_id, owner_user_id) do update set updated_at = public.demo_conversations.updated_at
  returning id into v_id;
  return public.owner_demo_lead_payload(v_id);
end $$;

revoke all on function public.owner_demo_lead_open(uuid) from public, anon;
grant execute on function public.owner_demo_lead_open(uuid) to authenticated;

/* The caller's owner-demo conversation, re-checked against the same rule as open. */
create or replace function public.owner_demo_lead_guard(p_conversation_id uuid)
returns public.demo_conversations
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_conv public.demo_conversations;
begin
  v_conv := public.demo_conversation_guard(p_conversation_id);
  if (public.owner_demo_lead_profile(v_conv.property_id)).id is distinct from v_conv.demo_buyer_id then
    raise exception 'DEMO_NOT_ALLOWED' using errcode = '42501';
  end if;
  return v_conv;
end $$;

revoke all on function public.owner_demo_lead_guard(uuid) from public, anon, authenticated;

/*
 * One simulated action. Validates its input, records it in demo_state and as an
 * activity event, and returns the whole payload. No credits, no messages to anybody.
 */
create or replace function public.owner_demo_lead_act(p_conversation_id uuid, p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conv   public.demo_conversations;
  v_state  jsonb;
  v_events jsonb;
  v_now    timestamptz := clock_timestamp();
  v_p      jsonb := coalesce(p_payload, '{}'::jsonb);
  v_text   text;
  v_stage  text;
  v_lang   text := case when v_p->>'lang' in ('ka', 'en', 'ru', 'tr', 'ar', 'he') then v_p->>'lang' else 'en' end;
  v_unlocked timestamptz;
begin
  v_conv := public.owner_demo_lead_guard(p_conversation_id);
  v_state := coalesce(v_conv.demo_state, '{}'::jsonb);
  v_events := coalesce(v_conv.demo_events, '[]'::jsonb);
  v_unlocked := v_conv.demo_unlocked_at;

  case upper(coalesce(p_action, ''))
    when 'VIEW_DETAILS' then
      if v_state->>'details_viewed_at' is null then
        v_state := v_state || jsonb_build_object('details_viewed_at', v_now);
      end if;
    when 'UNLOCK' then
      if v_unlocked is null then
        v_unlocked := v_now;
        v_events := public.owner_demo_lead_event(v_events, 'UNLOCKED', jsonb_build_object('credits', 2.5, 'charged_credits', 0));
      end if;
    when 'TOGGLE_SAVED' then
      v_state := v_state || jsonb_build_object('saved', not coalesce((v_state->>'saved')::boolean, false));
    when 'SAVE_CRM' then
      if v_unlocked is null then raise exception 'DEMO_LOCKED' using errcode = '22023'; end if;
      if v_state->>'crm_saved_at' is null then
        v_state := v_state || jsonb_build_object('crm_saved_at', v_now, 'crm_stage', 'UNLOCKED');
        v_events := public.owner_demo_lead_event(v_events, 'CRM_SAVED', '{}'::jsonb);
      end if;
    when 'SET_STAGE' then
      v_stage := upper(coalesce(v_p->>'stage', ''));
      if v_state->>'crm_saved_at' is null then raise exception 'DEMO_NOT_IN_CRM' using errcode = '22023'; end if;
      if v_stage not in ('UNLOCKED', 'CONTACTED', 'DELIVERED', 'REPLIED', 'INTERESTED', 'VIEWING_SCHEDULED', 'CLOSED', 'NOT_INTERESTED') then
        raise exception 'DEMO_INVALID_STAGE' using errcode = '22023';
      end if;
      if v_state->>'crm_stage' is distinct from v_stage then
        v_events := public.owner_demo_lead_event(v_events, 'CRM_STAGE', jsonb_build_object('from', v_state->>'crm_stage', 'to', v_stage));
        v_state := v_state || jsonb_build_object('crm_stage', v_stage);
      end if;
    when 'ADD_NOTE' then
      v_text := btrim(coalesce(v_p->>'body', ''));
      if v_state->>'crm_saved_at' is null then raise exception 'DEMO_NOT_IN_CRM' using errcode = '22023'; end if;
      if char_length(v_text) = 0 or char_length(v_text) > 1000 then raise exception 'DEMO_INVALID_BODY' using errcode = '22023'; end if;
      if jsonb_array_length(coalesce(v_state->'notes', '[]'::jsonb)) >= 50 then raise exception 'DEMO_TOO_MANY_NOTES' using errcode = '22023'; end if;
      v_state := v_state || jsonb_build_object('notes',
        coalesce(v_state->'notes', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'body', v_text, 'at', v_now)));
      v_events := public.owner_demo_lead_event(v_events, 'CRM_NOTE', '{}'::jsonb);
    when 'OPEN_CHAT' then
      if v_unlocked is null then raise exception 'DEMO_LOCKED' using errcode = '22023'; end if;
      if v_state->>'chat_opened_at' is null then
        v_state := v_state || jsonb_build_object('chat_opened_at', v_now);
        v_events := public.owner_demo_lead_event(v_events, 'CHAT_OPENED', '{}'::jsonb);
      end if;
    when 'ATTACH_OFFER' then
      if v_unlocked is null then raise exception 'DEMO_LOCKED' using errcode = '22023'; end if;
      v_text := btrim(coalesce(v_p->>'body', ''));
      /* The offer goes into the SIMULATED thread, with the simulated reply. */
      perform public.demo_send_message(v_conv.id, v_text, v_lang);
      v_state := v_state || jsonb_build_object('offer_attached_at', v_now,
                                              'chat_opened_at', coalesce(v_state->'chat_opened_at', to_jsonb(v_now)));
      v_events := public.owner_demo_lead_event(v_events, 'OFFER_SENT', '{}'::jsonb);
    when 'SAVE_EMAIL_DRAFT' then
      if v_unlocked is null then raise exception 'DEMO_LOCKED' using errcode = '22023'; end if;
      v_text := btrim(coalesce(v_p->>'subject', ''));
      if char_length(v_text) = 0 or char_length(v_text) > 200 then raise exception 'DEMO_INVALID_BODY' using errcode = '22023'; end if;
      if coalesce(v_p->>'template_id', '') not in ('PROPERTY_INTRODUCTION', 'MODERN_RESIDENCE', 'PERSONAL_FOLLOW_UP') then
        raise exception 'DEMO_INVALID_TEMPLATE' using errcode = '22023';
      end if;
      v_state := v_state || jsonb_build_object('email_draft', jsonb_build_object(
        'subject', v_text, 'template_id', v_p->>'template_id', 'language', v_lang, 'saved_at', v_now));
      v_events := public.owner_demo_lead_event(v_events, 'EMAIL_DRAFT', '{}'::jsonb);
    when 'NOTIFICATIONS_READ' then
      v_state := v_state || jsonb_build_object('notifications_read_at', v_now);
    when 'WALKTHROUGH_DONE' then
      v_state := v_state || jsonb_build_object('walkthrough_done_at', v_now);
    else
      raise exception 'DEMO_INVALID_ACTION' using errcode = '22023';
  end case;

  update public.demo_conversations
     set demo_state = v_state, demo_events = v_events, demo_unlocked_at = v_unlocked, updated_at = v_now
   where id = v_conv.id;
  return public.owner_demo_lead_payload(v_conv.id);
end $$;

revoke all on function public.owner_demo_lead_act(uuid, text, jsonb) from public, anon;
grant execute on function public.owner_demo_lead_act(uuid, text, jsonb) to authenticated;

/* Reset Demo: back to a freshly discovered, locked match. Keeps only "guide seen". */
create or replace function public.owner_demo_lead_reset(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conv public.demo_conversations;
  v_prof public.demo_buyer_profiles;
begin
  v_conv := public.owner_demo_lead_guard(p_conversation_id);
  select * into v_prof from public.demo_buyer_profiles where id = v_conv.demo_buyer_id;
  delete from public.demo_messages where conversation_id = v_conv.id;
  update public.demo_conversations
     set demo_unlocked_at = null,
         demo_state = case when demo_state ? 'walkthrough_done_at'
                           then jsonb_build_object('walkthrough_done_at', demo_state->'walkthrough_done_at')
                           else '{}'::jsonb end,
         demo_events = public.owner_demo_lead_event('[]'::jsonb, 'MATCH_DISCOVERED',
                         jsonb_build_object('score', v_prof.demo_details->'match_score')),
         updated_at = clock_timestamp()
   where id = v_conv.id;
  return public.owner_demo_lead_payload(v_conv.id);
end $$;

revoke all on function public.owner_demo_lead_reset(uuid) from public, anon;
grant execute on function public.owner_demo_lead_reset(uuid) to authenticated;

/*
 * Chat in the owner demo reuses demo_send_message / demo_list_messages (their guard
 * already limits a conversation to its viewer). Read the thread through the payload.
 */
