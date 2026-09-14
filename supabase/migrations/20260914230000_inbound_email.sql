-- ============================================================================
-- HOMATCH — email becomes two-way.
--
-- WHAT WAS ALREADY THERE, AND WHAT WAS NOT
--
-- comm_conversations.channel has allowed 'EMAIL' since the communications hub
-- was written, and comm_record_inbound does not care what channel it is given.
-- So the inbox, the thread, the handoff, the unread count and the whole
-- notification path already worked for email. Nothing needed inventing.
--
-- Two things stopped an email actually arriving:
--
--   comm_channel_accounts allowed WHATSAPP, VOICE and SMS. There was no way to
--   record "this address belongs to this customer", and without that an
--   inbound message has no tenant — which is the one thing a webhook must
--   never guess.
--
--   comm_record_inbound matched a contact by outreach_contacts.phone. Handed
--   an email address it found nobody, so every reply arrived detached from the
--   contact it plainly belongs to.
--
-- WHY WIDENING RATHER THAN A SECOND TABLE
--
-- An email address a customer receives on is a channel account in exactly the
-- sense the table already means: a provider, an identifier at that provider,
-- an owner, a status and an environment. A parallel table would need its own
-- RLS, its own grants, its own resolution path in a second webhook, and would
-- drift. Every value legal before this migration is legal after it.
-- ============================================================================

-- ── 1. An address is a channel account ─────────────────────────────────────
alter table public.comm_channel_accounts drop constraint if exists comm_channel_accounts_channel_check;
alter table public.comm_channel_accounts add constraint comm_channel_accounts_channel_check
  check (channel in ('WHATSAPP', 'VOICE', 'SMS', 'EMAIL'));

alter table public.comm_channel_accounts drop constraint if exists comm_channel_accounts_provider_check;
alter table public.comm_channel_accounts add constraint comm_channel_accounts_provider_check
  check (provider in ('META', 'VAPI', 'TWILIO', 'TELNYX', 'CARTESIA', 'RESEND', 'MOCK'));

comment on column public.comm_channel_accounts.provider_account_id is
  'The identifier at the provider. A WABA id for Meta; for RESEND, the lowercased inbound address itself — that IS the account, and mail to it belongs to owner_id.';

-- Resolving an inbound email is a lookup on the address it arrived at, on
-- every single delivery. Partial, because it is only ever asked about email.
create index if not exists comm_channel_accounts_email_idx
  on public.comm_channel_accounts (provider_account_id)
  where channel = 'EMAIL';

-- ── 2. A contact is matched by the address a reply came from ───────────────
--
-- Same function, one branch. The phone match is untouched; an email channel
-- now looks at the email column, which is where an email address is.
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
RETURNS TABLE(conversation_id uuid, message_id uuid, is_new_conversation boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_conv uuid;
  v_msg uuid;
  v_new boolean := false;
  v_contact uuid;
begin
  /* Which contact this peer IS, if Homatch already knows them. An email
     channel carries an address and a phone match would find nobody, which is
     how a reply ends up detached from the person who sent it. */
  if p_channel = 'EMAIL' then
    select id into v_contact
      from public.outreach_contacts
     where owner_id = p_owner_id and lower(email) = lower(p_peer)
     order by created_at
     limit 1;
  else
    select id into v_contact
      from public.outreach_contacts
     where owner_id = p_owner_id and phone = p_peer
     order by created_at
     limit 1;
  end if;

  insert into public.comm_conversations (
    owner_id, channel, peer_address, peer_name, channel_account_id, contact_id,
    last_message_at, last_inbound_at, service_window_expires_at, last_message_preview, unread_count
  )
  values (
    p_owner_id, p_channel, p_peer, p_peer_name, p_channel_account_id, v_contact,
    coalesce(p_sent_at, now()), coalesce(p_sent_at, now()),
    /* WhatsApp's 24-hour service window. Email has no such rule, and nothing
       reads this for an email thread — it is left set rather than special
       cased, because a NULL here would have to be handled by every reader. */
    coalesce(p_sent_at, now()) + interval '24 hours',
    left(coalesce(p_body, ''), 200), 1
  )
  on conflict (owner_id, channel, peer_address) do update
    set last_message_at = greatest(comm_conversations.last_message_at, excluded.last_message_at),
        last_inbound_at = excluded.last_inbound_at,
        service_window_expires_at = excluded.service_window_expires_at,
        last_message_preview = excluded.last_message_preview,
        unread_count = comm_conversations.unread_count + 1,
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
end $function$;

comment on function public.comm_record_inbound(uuid, text, text, text, uuid, text, text, text, text, text, timestamptz) is
  'Record an inbound message on any channel: finds or opens the conversation with this peer, attaches the contact (by phone, or by email address on the EMAIL channel), and inserts the message once per provider_message_id.';

-- ── 3. Which conversation a reply belongs to ───────────────────────────────
--
-- A reply carries In-Reply-To and References naming the message it answers.
-- When that message is one Homatch sent, the thread is known exactly, and is
-- better than matching on the sender's address alone — the same person may
-- have two threads with the same customer.
--
-- SECURITY DEFINER and owner-scoped: it answers only about messages the given
-- owner sent, so it cannot be used to discover another tenant's threads.
create or replace function public.comm_conversation_for_reply(
  p_owner_id uuid,
  p_message_ids text[]
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  select m.conversation_id
    from public.comm_messages m
   where m.owner_id = p_owner_id
     and m.provider_message_id = any(p_message_ids)
   order by m.created_at desc
   limit 1;
$$;

comment on function public.comm_conversation_for_reply(uuid, text[]) is
  'The conversation a reply belongs to, found from the message ids it answers. Scoped to one owner so it cannot reveal another tenant''s threads.';

revoke all on function public.comm_conversation_for_reply(uuid, text[]) from public, anon, authenticated;
grant execute on function public.comm_conversation_for_reply(uuid, text[]) to service_role;
