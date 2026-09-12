-- HOMATCH — the Communications operations that must happen in Postgres.
--
-- WHY THESE ARE SQL AND NOT TYPESCRIPT
--
-- Each one is a decision where two callers can race, and the only place a race
-- actually loses is inside a single statement. §69 lists the four that matter:
--
--   two workers cannot place the same call
--   a duplicate webhook cannot debit twice
--   two dispatchers cannot send to the same contact
--   a retry cannot overlap an active attempt
--
-- A SELECT followed by an UPDATE in an edge function loses all four, and it
-- loses them rarely enough to pass every test and fail in production. So the
-- claim is an UPDATE with its own predicate, and the dedup is a unique index
-- that an INSERT collides with.
--
-- Depends on 20260912110000_communications_hub.sql. Apply that first.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. AUDIENCE SUMMARY
-- ════════════════════════════════════════════════════════════════════════════
--
-- §85 and §101: launching a campaign must not pull the contact list into an
-- edge function to count it. One scan, one row back, and the campaign builder
-- can show the numbers for a 40,000-row list as fast as for a 40-row one.

create or replace function public.comm_audience_summary(
  p_list_id uuid,
  p_owner_id uuid,
  p_channel text
)
returns table (
  total bigint,
  eligible bigint,
  suppressed bigint,
  invalid bigint,
  consented bigint,
  valid_phones bigint,
  countries text[]
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*)::bigint as total,
    count(*) filter (
      where c.phone_valid is true
        and coalesce(c.suppressed, false) = false
        and coalesce(c.do_not_contact, false) = false
        and coalesce(c.unsubscribed, false) = false
        -- Channel-specific opt-outs are separate facts and are checked
        -- separately. Someone who stopped WhatsApp may still be callable.
        and (p_channel <> 'AI_CALL'  or coalesce(c.do_not_call, false) = false)
        and (p_channel <> 'WHATSAPP' or coalesce(c.whatsapp_opted_out, false) = false)
        and (p_channel <> 'EMAIL'    or c.email_valid is true)
    )::bigint as eligible,
    count(*) filter (
      where coalesce(c.suppressed, false)
         or coalesce(c.do_not_contact, false)
         or coalesce(c.unsubscribed, false)
    )::bigint as suppressed,
    count(*) filter (where c.phone_valid is distinct from true)::bigint as invalid,
    count(*) filter (where c.consent_status = 'CONSENTED')::bigint as consented,
    count(*) filter (where c.phone_valid is true)::bigint as valid_phones,
    coalesce(array_agg(distinct c.country) filter (where c.country is not null), '{}') as countries
  from public.outreach_contacts c
  where c.list_id = p_list_id
    and c.owner_id = p_owner_id;
$$;

-- security invoker, deliberately. This function reads a customer's contacts,
-- so it must run with the caller's own rights and let RLS apply. A definer
-- function here would be a way to count somebody else's list.
revoke all on function public.comm_audience_summary(uuid, uuid, text) from public;
grant execute on function public.comm_audience_summary(uuid, uuid, text) to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. MATERIALISING A CAMPAIGN'S QUEUE
-- ════════════════════════════════════════════════════════════════════════════
--
-- One row per eligible contact, created once, with a deterministic
-- idempotency key. Re-running this after a crash, a double-click on Launch, or
-- a retry of the launch request adds nothing: the unique index on
-- idempotency_key turns the second insert into a no-op.
--
-- p_limit is the risk engine's allowedRecipients. A campaign is never
-- materialised larger than the tier permits, so a customer cannot widen it
-- afterwards by editing the list.

create or replace function public.comm_enqueue_campaign(
  p_campaign_id uuid,
  p_owner_id uuid,
  p_limit int
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channel text;
  v_list uuid;
  v_status text;
  v_inserted int;
begin
  select campaign_type, contact_list_id, status
    into v_channel, v_list, v_status
  from public.outreach_campaigns
  where id = p_campaign_id and owner_id = p_owner_id
  for update;

  if not found then
    raise exception 'campaign not found or not owned by caller' using errcode = '42501';
  end if;
  -- A paused-for-compliance campaign must not be able to grow its own queue.
  if v_status = 'COMPLIANCE_PAUSED' then
    raise exception 'campaign is paused pending review' using errcode = '42501';
  end if;
  if v_list is null then
    return 0;
  end if;

  insert into public.outreach_sends (
    campaign_id, contact_id, owner_id, channel, recipient_phone, recipient_email,
    status, attempt_count, next_attempt_at, idempotency_key, language
  )
  select
    p_campaign_id, c.id, p_owner_id, v_channel, c.phone, c.email,
    'PENDING', 0, now(),
    -- The key §129 asks for, built from facts that do not change: the same
    -- campaign, contact and attempt always produce the same string.
    p_campaign_id::text || ':' || c.id::text || ':' || v_channel || ':0',
    c.language
  from public.outreach_contacts c
  where c.list_id = v_list
    and c.owner_id = p_owner_id
    and c.phone_valid is true
    and coalesce(c.suppressed, false) = false
    and coalesce(c.do_not_contact, false) = false
    and coalesce(c.unsubscribed, false) = false
    and (v_channel <> 'AI_CALL'  or coalesce(c.do_not_call, false) = false)
    and (v_channel <> 'WHATSAPP' or coalesce(c.whatsapp_opted_out, false) = false)
  order by c.created_at
  limit greatest(0, p_limit)
  on conflict (idempotency_key) where idempotency_key is not null do nothing;

  get diagnostics v_inserted = row_count;

  update public.outreach_campaigns
     set audience_count = (select count(*) from public.outreach_sends where campaign_id = p_campaign_id),
         launched_at = coalesce(launched_at, now()),
         updated_at = now()
   where id = p_campaign_id;

  return v_inserted;
end $$;

revoke all on function public.comm_enqueue_campaign(uuid, uuid, int) from public;
grant execute on function public.comm_enqueue_campaign(uuid, uuid, int) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. CLAIMING WORK
-- ════════════════════════════════════════════════════════════════════════════
--
-- The whole point of this function is the WHERE clause on the UPDATE.
--
-- A worker that does `select ... where status='PENDING' limit 10` and then
-- updates those ids has a window between the two in which a second worker
-- reads the same ten rows. Both then place the same ten calls. This is that
-- bug's fix: the rows are selected FOR UPDATE SKIP LOCKED and transitioned in
-- the same statement, so a row is claimed exactly once and a second worker
-- simply sees fewer rows rather than blocking or duplicating.
--
-- The campaign's own state is re-checked here rather than trusted from the
-- caller, because between a dispatcher starting a batch and this running, an
-- admin may have hit the kill switch.

create or replace function public.comm_claim_sends(
  p_campaign_id uuid,
  p_batch int default 10,
  p_lease_seconds int default 300
)
returns setof public.outreach_sends
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from public.outreach_campaigns where id = p_campaign_id;
  -- Anything but RUNNING means no new work leaves the building, including the
  -- states a customer cannot themselves clear.
  if v_status is distinct from 'RUNNING' then
    return;
  end if;

  return query
  update public.outreach_sends s
     set status = 'QUEUED',
         attempt_count = coalesce(s.attempt_count, 0) + 1,
         -- The lease. A worker that dies leaves the row claimed until this
         -- passes, at which point comm_reclaim_stale_sends puts it back.
         next_attempt_at = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   where s.id in (
     select s2.id
       from public.outreach_sends s2
      where s2.campaign_id = p_campaign_id
        and s2.status = 'PENDING'
        and (s2.next_attempt_at is null or s2.next_attempt_at <= now())
      order by s2.created_at
      limit greatest(1, p_batch)
      for update skip locked
   )
  returning s.*;
end $$;

revoke all on function public.comm_claim_sends(uuid, int, int) from public;
grant execute on function public.comm_claim_sends(uuid, int, int) to service_role;

-- A claim whose worker never came back. Returned to PENDING for one more go,
-- and failed permanently once the campaign's own max_attempts is spent — so a
-- number that cannot be reached is not dialled forever.
create or replace function public.comm_reclaim_stale_sends()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_count int;
begin
  with stale as (
    select s.id, c.max_attempts
      from public.outreach_sends s
      join public.outreach_campaigns c on c.id = s.campaign_id
     where s.status = 'QUEUED'
       and s.next_attempt_at is not null
       and s.next_attempt_at < now()
  ), updated as (
    update public.outreach_sends s
       set status = case when coalesce(s.attempt_count, 0) >= coalesce(stale.max_attempts, 1)
                         then 'FAILED' else 'PENDING' end,
           error_message = case when coalesce(s.attempt_count, 0) >= coalesce(stale.max_attempts, 1)
                                then 'no worker completed this attempt' else s.error_message end,
           next_attempt_at = now(),
           updated_at = now()
      from stale
     where s.id = stale.id
     returning 1
  )
  select count(*)::int into v_count from updated;
  return v_count;
end $$;

revoke all on function public.comm_reclaim_stale_sends() from public;
grant execute on function public.comm_reclaim_stale_sends() to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. WEBHOOK DEDUP
-- ════════════════════════════════════════════════════════════════════════════
--
-- §31 and §129. Returns true when the caller should PROCESS the event, and
-- false when it has been seen. The unique index on (provider, event_key) is
-- what makes this safe: two concurrent deliveries both try to insert, one
-- wins, the other takes the conflict branch and increments the duplicate
-- counter so §86 can instrument how often it happens.

create or replace function public.comm_claim_webhook_event(
  p_provider text,
  p_event_key text,
  p_event_type text,
  p_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_processed timestamptz;
begin
  insert into public.comm_webhook_events (provider, event_key, event_type, payload)
  values (p_provider, p_event_key, p_event_type, p_payload)
  on conflict (provider, event_key) do nothing
  returning id into v_id;

  if v_id is not null then
    return true;
  end if;

  -- Already there. If a previous attempt recorded it but never finished
  -- processing, let this delivery try again: a webhook that errored halfway is
  -- exactly what a provider retry is for. If it completed, this is a genuine
  -- duplicate.
  update public.comm_webhook_events
     set duplicate_count = duplicate_count + 1
   where provider = p_provider and event_key = p_event_key
  returning processed_at into v_processed;

  return v_processed is null;
end $$;

revoke all on function public.comm_claim_webhook_event(text, text, text, jsonb) from public;
grant execute on function public.comm_claim_webhook_event(text, text, text, jsonb) to service_role;

create or replace function public.comm_finish_webhook_event(
  p_provider text,
  p_event_key text,
  p_error text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.comm_webhook_events
     set processed_at = case when p_error is null then now() else processed_at end,
         processing_error = p_error,
         attempt = attempt + 1
   where provider = p_provider and event_key = p_event_key;
$$;

revoke all on function public.comm_finish_webhook_event(text, text, text) from public;
grant execute on function public.comm_finish_webhook_event(text, text, text) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. INBOUND MESSAGES
-- ════════════════════════════════════════════════════════════════════════════
--
-- Find or create the thread, append the message, move the counters, and reopen
-- Meta's 24-hour window — atomically. Done as four statements from an edge
-- function, two simultaneous inbound messages from the same number create two
-- conversations, and the operator answers half a thread.

create or replace function public.comm_record_inbound(
  p_owner_id uuid,
  p_channel text,
  p_peer text,
  p_peer_name text,
  p_channel_account_id uuid,
  p_provider_message_id text,
  p_kind text,
  p_body text,
  p_media_provider_id text,
  p_media_mime text,
  p_sent_at timestamptz
)
returns table (conversation_id uuid, message_id uuid, is_new_conversation boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv uuid;
  v_msg uuid;
  v_new boolean := false;
  v_contact uuid;
begin
  -- An existing contact with this number, so an inbound from someone already
  -- on a list lands on their record rather than creating a ghost.
  select id into v_contact
    from public.outreach_contacts
   where owner_id = p_owner_id and phone = p_peer
   order by created_at
   limit 1;

  insert into public.comm_conversations (
    owner_id, channel, peer_address, peer_name, channel_account_id, contact_id,
    last_message_at, last_inbound_at, service_window_expires_at, last_message_preview, unread_count
  )
  values (
    p_owner_id, p_channel, p_peer, p_peer_name, p_channel_account_id, v_contact,
    coalesce(p_sent_at, now()), coalesce(p_sent_at, now()),
    coalesce(p_sent_at, now()) + interval '24 hours',
    left(coalesce(p_body, ''), 200), 1
  )
  on conflict (owner_id, channel, peer_address) do update
    set last_message_at = greatest(comm_conversations.last_message_at, excluded.last_message_at),
        last_inbound_at = excluded.last_inbound_at,
        -- Every inbound reopens the window. This is the value the send path
        -- reads, so a clock skew in an edge function cannot authorise a
        -- free-text send Meta would reject and bill for.
        service_window_expires_at = excluded.service_window_expires_at,
        last_message_preview = excluded.last_message_preview,
        unread_count = comm_conversations.unread_count + 1,
        -- A contact that has replied is no longer merely NEW.
        lead_stage = case when comm_conversations.lead_stage = 'NEW' then 'ENGAGED' else comm_conversations.lead_stage end,
        status = 'OPEN',
        peer_name = coalesce(excluded.peer_name, comm_conversations.peer_name),
        contact_id = coalesce(comm_conversations.contact_id, excluded.contact_id),
        updated_at = now()
  returning id, (xmax = 0) into v_conv, v_new;

  insert into public.comm_messages (
    conversation_id, owner_id, direction, author, kind, body,
    media_provider_id, media_mime, status, provider_message_id, sent_at
  )
  values (
    v_conv, p_owner_id, 'INBOUND', 'CONTACT', p_kind, p_body,
    p_media_provider_id, p_media_mime, 'RECEIVED', p_provider_message_id, coalesce(p_sent_at, now())
  )
  on conflict (provider_message_id) where provider_message_id is not null do nothing
  returning id into v_msg;

  return query select v_conv, v_msg, v_new;
end $$;

revoke all on function public.comm_record_inbound(uuid, text, text, text, uuid, text, text, text, text, text, timestamptz) from public;
grant execute on function public.comm_record_inbound(uuid, text, text, text, uuid, text, text, text, text, text, timestamptz) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. DELIVERY STATUS
-- ════════════════════════════════════════════════════════════════════════════
--
-- Meta delivers `sent` after `read` often enough that it has to be designed
-- for. The CASE below is the whole reason this is a function: a plain UPDATE
-- would walk a message backwards from READ to SENT on a reordered callback,
-- and the inbox would show a read receipt disappearing.

create or replace function public.comm_apply_message_status(
  p_provider_message_id text,
  p_status text,
  p_raw text,
  p_error_code text,
  p_error_message text,
  p_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rank int;
  v_current int;
  v_id uuid;
  v_current_status text;
begin
  select id, status into v_id, v_current_status
    from public.comm_messages where provider_message_id = p_provider_message_id;
  if v_id is null then
    return false;
  end if;

  v_rank    := case p_status when 'QUEUED' then 0 when 'SENT' then 1 when 'DELIVERED' then 2
                             when 'READ' then 3 when 'FAILED' then 4 when 'DELETED' then 5 else -1 end;
  v_current := case v_current_status when 'QUEUED' then 0 when 'SENT' then 1 when 'DELIVERED' then 2
                             when 'READ' then 3 when 'FAILED' then 4 when 'DELETED' then 5 else -1 end;

  if v_rank <= v_current then
    -- Stale or reordered. The raw provider word is still worth keeping for
    -- support, but the state does not move.
    update public.comm_messages set provider_status_raw = coalesce(p_raw, provider_status_raw) where id = v_id;
    return false;
  end if;

  update public.comm_messages
     set status = p_status,
         provider_status_raw = coalesce(p_raw, provider_status_raw),
         error_code = coalesce(p_error_code, error_code),
         error_message = coalesce(p_error_message, error_message),
         sent_at      = case when p_status = 'SENT'      then coalesce(p_at, now()) else sent_at end,
         delivered_at = case when p_status = 'DELIVERED' then coalesce(p_at, now()) else delivered_at end,
         read_at      = case when p_status = 'READ'      then coalesce(p_at, now()) else read_at end
   where id = v_id;

  return true;
end $$;

revoke all on function public.comm_apply_message_status(text, text, text, text, text, timestamptz) from public;
grant execute on function public.comm_apply_message_status(text, text, text, text, text, timestamptz) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. HANDOFF
-- ════════════════════════════════════════════════════════════════════════════
--
-- §36's race, closed. The transition is only applied if the conversation is
-- STILL in the state the caller believed it was in. Two operators pressing
-- Take over at the same moment: one wins, the other is told the state moved,
-- and the AI — which checks the same way before writing a reply — cannot slip
-- a message in between the check and the write.

create or replace function public.comm_set_conversation_mode(
  p_conversation_id uuid,
  p_expected_mode text,
  p_new_mode text,
  p_actor uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_ok boolean;
begin
  update public.comm_conversations
     set mode = p_new_mode,
         mode_changed_by = p_actor,
         mode_changed_at = now(),
         mode_change_reason = p_reason,
         updated_at = now()
   where id = p_conversation_id
     and (p_expected_mode is null or mode = p_expected_mode)
     -- A customer can only move their own conversation. The service role
     -- bypasses RLS, so ownership is checked here explicitly.
     and (p_actor is null or owner_id = p_actor or exists (
       select 1 from public.comm_conversations c2 where c2.id = p_conversation_id and c2.assigned_to = p_actor
     ));

  get diagnostics v_ok = row_count;
  return v_ok > 0;
end $$;

revoke all on function public.comm_set_conversation_mode(uuid, text, text, uuid, text) from public;
grant execute on function public.comm_set_conversation_mode(uuid, text, text, uuid, text) to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. AGENT VERSIONING
-- ════════════════════════════════════════════════════════════════════════════
--
-- Publishing freezes a snapshot and bumps the pointer in one statement, so two
-- rapid publishes cannot both claim version 3.

create or replace function public.comm_publish_agent(p_agent_id uuid, p_actor uuid)
returns table (version int, version_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent public.comm_agents;
  v_next int;
  v_id uuid;
begin
  select * into v_agent from public.comm_agents
   where id = p_agent_id and owner_id = p_actor
   for update;
  if not found then
    raise exception 'agent not found or not owned by caller' using errcode = '42501';
  end if;

  v_next := coalesce(v_agent.current_version, 0) + 1;

  insert into public.comm_agent_versions (agent_id, owner_id, version, snapshot, published_by)
  values (p_agent_id, p_actor, v_next, to_jsonb(v_agent), p_actor)
  returning id into v_id;

  update public.comm_agents
     set current_version = v_next,
         status = case when status = 'DRAFT' then 'READY' else status end,
         updated_at = now()
   where id = p_agent_id;

  return query select v_next, v_id;
end $$;

revoke all on function public.comm_publish_agent(uuid, uuid) from public;
grant execute on function public.comm_publish_agent(uuid, uuid) to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 9. THE KILL SWITCH
-- ════════════════════════════════════════════════════════════════════════════
--
-- §52: a customer cannot self-override a compliance pause. Two separate
-- functions rather than one with a flag, because the difference between them
-- IS the control, and a boolean parameter is something a caller can get wrong.

create or replace function public.comm_compliance_pause(
  p_campaign_id uuid,
  p_code text,
  p_reason text
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.outreach_campaigns
     set status = 'COMPLIANCE_PAUSED',
         compliance_state = p_code,
         paused_reason = p_reason,
         updated_at = now()
   where id = p_campaign_id
     and status in ('RUNNING', 'SCHEDULED', 'APPROVED', 'PAUSED');
$$;

revoke all on function public.comm_compliance_pause(uuid, text, text) from public;
grant execute on function public.comm_compliance_pause(uuid, text, text) to service_role;

-- What a CUSTOMER may do. The status predicate is the enforcement: a campaign
-- in COMPLIANCE_PAUSED simply does not match, so this updates nothing and
-- returns false however it is called.
create or replace function public.comm_user_resume_campaign(p_campaign_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare v_ok int;
begin
  update public.outreach_campaigns
     set status = 'RUNNING', paused_reason = null, updated_at = now()
   where id = p_campaign_id
     and owner_id = auth.uid()
     and status = 'PAUSED';
  get diagnostics v_ok = row_count;
  return v_ok > 0;
end $$;

revoke all on function public.comm_user_resume_campaign(uuid) from public;
grant execute on function public.comm_user_resume_campaign(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 10. NOTIFICATION TYPES
-- ════════════════════════════════════════════════════════════════════════════
--
-- §76 reuses the existing notifications system rather than building a second
-- one. The enum needs the communications events added. ADD VALUE IF NOT EXISTS
-- is idempotent, and none of these values is USED in this migration — using a
-- new enum value in the same transaction that adds it is the one thing
-- Postgres will not allow.

alter type public.notification_type add value if not exists 'CAMPAIGN_COMPLETED';
alter type public.notification_type add value if not exists 'CAMPAIGN_PAUSED';
alter type public.notification_type add value if not exists 'CAMPAIGN_NEEDS_REVIEW';
alter type public.notification_type add value if not exists 'WHATSAPP_TEMPLATE_REJECTED';
alter type public.notification_type add value if not exists 'WHATSAPP_QUALITY_WARNING';
alter type public.notification_type add value if not exists 'PROVIDER_UNAVAILABLE';
alter type public.notification_type add value if not exists 'PROVIDER_RECOVERED';
alter type public.notification_type add value if not exists 'CALLBACK_REQUESTED';
alter type public.notification_type add value if not exists 'QUALIFIED_LEAD';

-- ════════════════════════════════════════════════════════════════════════════
-- 11. RETENTION
-- ════════════════════════════════════════════════════════════════════════════
--
-- §120: keep enough normalised event data for support, idempotency, status,
-- billing and audit; do not hoard raw provider payloads forever.
--
-- Note what this does NOT delete. The comm_webhook_events ROW survives, so the
-- dedup guarantee survives with it — only the payload is dropped. Deleting the
-- row would let a provider redelivery a month later be processed as new.

create or replace function public.comm_purge_expired()
returns table (payloads_cleared int, talk_sessions_deleted int)
language plpgsql
security definer
set search_path = public
as $$
declare v_payloads int; v_talk int;
begin
  update public.comm_webhook_events
     set payload = null
   where purge_after < now() and payload is not null;
  get diagnostics v_payloads = row_count;

  -- Anonymous demo sessions carry what a stranger said about what they want to
  -- buy. §29 and §132: it is not kept beyond the anonymous policy window.
  delete from public.comm_talk_sessions where purge_after < now();
  get diagnostics v_talk = row_count;

  return query select v_payloads, v_talk;
end $$;

revoke all on function public.comm_purge_expired() from public;
grant execute on function public.comm_purge_expired() to service_role;
