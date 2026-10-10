-- PROPERTY CONVERSATIONS — the existing direct messages, grown up.
--
-- Extends public.messages (00026) in place rather than building a second messenger:
-- photos, voice notes (≤ 60 s), verified property cards, replies, sender-approved
-- translations and an idempotency key. Adds a private `dm-media` bucket whose objects
-- only the two participants can read, a translation/transcript cache read only through
-- an RPC, and the participant RPCs the chat needs:
--
--   mark_conversation_seen(conv)                 read receipts with users.id (the old client
--                                                 wrote auth.uid() into message_receipts.user_id)
--   set_conversation_muted(conv, muted)          per-participant mute (in-app stays, push stops)
--   block_conversation_counterpart(conv) / unblock_conversation_counterpart(conv)
--   my_conversation_context(conv)                counterpart first name/nickname + language,
--                                                 the property summary, flags, may-I-send
--   my_message_translations(conv, lang)          cached translations/transcripts, participant-only
--
-- WRITES GO THROUGH send-message ONLY. The 00026 `msg_insert` policy let any participant
-- insert a message row straight through PostgREST — which would skip the rate limit,
-- the duplicate guard, the offer cap, the block check and, now, the server-built
-- property card (a client could post any "verified" listing it liked). No client code
-- inserts messages (send-message does, as service_role), so the policy is dropped and
-- table writes are revoked from anon/authenticated. SELECT (and realtime) is unchanged.
--
-- messages.body stays NOT NULL: a media or property message carries its caption or ''.
-- The HOMATCH Leads CRM triggers on messages (insert, status update) never read the
-- body and keep working unchanged.
--
-- Append-only. The runner owns the transaction. Safe to apply twice.

/* ════════════════════════════════════════════════════════════════════════
 * 1 · messages: kinds, media, cards, replies, translations, idempotency
 * ════════════════════════════════════════════════════════════════════════ */

alter table public.messages
  add column if not exists kind              text not null default 'TEXT',
  add column if not exists media_path        text,
  add column if not exists media_meta        jsonb,
  add column if not exists reply_to_id       uuid references public.messages(id) on delete set null,
  add column if not exists property_card     jsonb,
  add column if not exists original_body     text,
  add column if not exists original_lang     text,
  add column if not exists translated_to     text,
  add column if not exists client_message_id text;

comment on column public.messages.kind is
  'TEXT | PHOTO | VOICE | PROPERTY. Media kinds carry media_path in the private dm-media bucket under {sender}/{conversation}/; VOICE ≤ 60 s by CHECK; PROPERTY carries a server-built property_card snapshot.';
comment on column public.messages.property_card is
  'Snapshot of the SENDER''s own listing at send time, built by send-message from properties/property_facts. Never client-supplied.';
comment on column public.messages.original_body is
  'When the sender approved a translation: what they wrote. body is then the translated text they reviewed and sent.';
comment on column public.messages.client_message_id is
  'Sender-generated idempotency key: a retried send returns the first row instead of a second message.';

alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages add constraint messages_kind_check
  check (kind in ('TEXT', 'PHOTO', 'VOICE', 'PROPERTY'));

-- Media only on media kinds, always present there, and always under the sender's own
-- prefix for THIS conversation — the storage policy enforces the same from the other end.
alter table public.messages drop constraint if exists messages_media_check;
alter table public.messages add constraint messages_media_check check (
  (kind in ('TEXT', 'PROPERTY') and media_path is null)
  or (kind in ('PHOTO', 'VOICE') and media_path is not null
      and media_path like (sender_id::text || '/' || conversation_id::text || '/%'))
);

-- 60 seconds, not one more. CASE so the cast never runs on a non-number.
alter table public.messages drop constraint if exists messages_voice_duration_check;
alter table public.messages add constraint messages_voice_duration_check check (
  case when kind = 'VOICE' then
    coalesce(jsonb_typeof(media_meta -> 'duration_seconds') = 'number'
             and (media_meta ->> 'duration_seconds')::numeric > 0
             and (media_meta ->> 'duration_seconds')::numeric <= 60, false)
  else true end
);

alter table public.messages drop constraint if exists messages_property_card_check;
alter table public.messages add constraint messages_property_card_check check (
  (kind = 'PROPERTY' and property_card is not null and jsonb_typeof(property_card) = 'object')
  or (kind <> 'PROPERTY' and property_card is null)
);

-- A text message says something; a media/property message may carry an empty caption.
-- NOT VALID: historical rows are not re-judged, every new row is.
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages add constraint messages_body_check check (
  char_length(body) <= 4000 and (kind <> 'TEXT' or char_length(btrim(body)) > 0)
) not valid;

alter table public.messages drop constraint if exists messages_translation_check;
alter table public.messages add constraint messages_translation_check check (
  original_body is null
  or (kind = 'TEXT' and char_length(original_body) <= 4000
      and original_lang in ('en', 'ka', 'ru', 'tr', 'ar', 'he')
      and translated_to in ('en', 'ka', 'ru', 'tr', 'ar', 'he')
      and original_lang <> translated_to)
);

alter table public.messages drop constraint if exists messages_client_message_id_check;
alter table public.messages add constraint messages_client_message_id_check check (
  client_message_id is null or client_message_id ~ '^[A-Za-z0-9_-]{8,80}$'
);

create unique index if not exists messages_sender_client_message_id
  on public.messages (sender_id, client_message_id) where client_message_id is not null;
-- The send path's duplicate / offer-cap reads: one sender's recent rows in one conversation.
create index if not exists messages_conversation_sender_created
  on public.messages (conversation_id, sender_id, created_at desc);

/* A reply quotes a message of the SAME conversation, never somebody else's. */
create or replace function public.messages_reply_same_conversation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.reply_to_id is not null and not exists (
    select 1 from public.messages m where m.id = new.reply_to_id and m.conversation_id = new.conversation_id
  ) then
    raise exception 'reply_to_id must reference a message in the same conversation' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.messages_reply_same_conversation() from public, anon, authenticated;

drop trigger if exists messages_reply_same_conversation on public.messages;
create trigger messages_reply_same_conversation before insert or update of reply_to_id on public.messages
  for each row execute function public.messages_reply_same_conversation();

/* Writes through send-message only (see header). Reads unchanged. */
drop policy if exists "msg_insert" on public.messages;
revoke insert, update, delete on public.messages from anon, authenticated;

/* ════════════════════════════════════════════════════════════════════════
 * 2 · message_translations — the translation / transcript cache
 * ════════════════════════════════════════════════════════════════════════ */

create table if not exists public.message_translations (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null references public.messages(id) on delete cascade,
  kind          text not null check (kind in ('TRANSLATION', 'TRANSCRIPT')),
  -- '' for a transcript (it is in the language it was spoken in).
  target_lang   text not null default '' check (target_lang in ('', 'en', 'ka', 'ru', 'tr', 'ar', 'he')),
  source_lang   text,
  content_hash  text,
  text          text not null check (char_length(text) <= 8000),
  model         text,
  cost_usd      numeric(12,6),
  pricing_state text check (pricing_state in ('ACTUAL', 'ESTIMATED', 'PARTIAL', 'UNPRICED', 'ZERO_REAL')),
  created_at    timestamptz not null default now(),
  unique (message_id, kind, target_lang),
  check ((kind = 'TRANSCRIPT' and target_lang = '') or (kind = 'TRANSLATION' and target_lang <> ''))
);
create index if not exists message_translations_message on public.message_translations (message_id);
alter table public.message_translations enable row level security;
-- No policies: the service role writes (send-message), participants read through
-- my_message_translations() below.
revoke all on public.message_translations from anon, authenticated;

/* ════════════════════════════════════════════════════════════════════════
 * 3 · dm-media — private, participant-scoped
 * ════════════════════════════════════════════════════════════════════════ */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dm-media', 'dm-media', false, 8388608,
        array['image/jpeg', 'image/png', 'image/webp',
              'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/*
 * The one rule for an object name `{sender}/{conversation}/{file}`:
 *   write  the caller IS {sender}, takes part in {conversation}, and may still send there
 *   read   the caller takes part in {conversation} and {sender} is one of its two people
 * Parsed defensively (a malformed name is simply refused, never an error) — which is why
 * it is a function and not a policy expression with casts in it.
 */
create or replace function public.dm_media_object_allowed(p_name text, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_parts text[];
  v_sender uuid;
  v_conv record;
  v_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if v_me is null or p_name is null then return false; end if;
  v_parts := string_to_array(p_name, '/');
  if array_length(v_parts, 1) <> 3 or v_parts[1] !~ v_re or v_parts[2] !~ v_re or coalesce(v_parts[3], '') = '' then
    return false;
  end if;
  v_sender := v_parts[1]::uuid;
  select id, initiator_id, recipient_id, status::text as status into v_conv
    from public.conversations where id = v_parts[2]::uuid;
  if not found or v_me not in (v_conv.initiator_id, v_conv.recipient_id)
     or v_sender not in (v_conv.initiator_id, v_conv.recipient_id) then
    return false;
  end if;
  if not p_write then return true; end if;
  if v_sender <> v_me or v_conv.status in ('BLOCKED', 'ARCHIVED') then return false; end if;
  return not exists (
    select 1 from public.conversation_blocks b
     where (b.blocker_id = v_conv.initiator_id and b.blocked_id = v_conv.recipient_id)
        or (b.blocker_id = v_conv.recipient_id and b.blocked_id = v_conv.initiator_id));
end $$;
revoke all on function public.dm_media_object_allowed(text, boolean) from public, anon;
grant execute on function public.dm_media_object_allowed(text, boolean) to authenticated, service_role;

drop policy if exists dm_media_upload on storage.objects;
create policy dm_media_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'dm-media' and public.dm_media_object_allowed(name, true));

drop policy if exists dm_media_read on storage.objects;
create policy dm_media_read on storage.objects
  for select to authenticated
  using (bucket_id = 'dm-media' and public.dm_media_object_allowed(name, false));
-- No client update/delete: a sent attachment is part of the record.

/* ════════════════════════════════════════════════════════════════════════
 * 4 · participant RPCs
 * ════════════════════════════════════════════════════════════════════════ */

/* The caller's conversation row, or an insufficient_privilege error. */
create or replace function public.conversation_for_participant(p_conversation_id uuid)
returns public.conversations language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_conv public.conversations;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_conv from public.conversations c
   where c.id = p_conversation_id and (c.initiator_id = v_me or c.recipient_id = v_me);
  if not found then raise exception 'not a participant' using errcode = '42501'; end if;
  return v_conv;
end $$;
revoke all on function public.conversation_for_participant(uuid) from public, anon, authenticated;

/*
 * Read receipts, correctly. The other person's SENT/DELIVERED messages become SEEN and
 * the caller's receipt row is keyed by users.id (message_receipts.user_id references
 * users). Returns how many messages were marked.
 */
create or replace function public.mark_conversation_seen(p_conversation_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_conv public.conversations;
  v_n integer;
begin
  v_conv := public.conversation_for_participant(p_conversation_id);
  with marked as (
    update public.messages m
       set status = 'SEEN', seen_at = coalesce(m.seen_at, now()),
           delivered_at = coalesce(m.delivered_at, now())
     where m.conversation_id = v_conv.id and m.sender_id <> v_me and m.status in ('SENT', 'DELIVERED')
    returning m.id
  )
  insert into public.message_receipts (message_id, user_id, status, updated_at)
  select id, v_me, 'SEEN', now() from marked
  on conflict (message_id, user_id) do update set status = 'SEEN', updated_at = now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.mark_conversation_seen(uuid) from public, anon;
grant execute on function public.mark_conversation_seen(uuid) to authenticated;

/* Mute this conversation for ME only. In-app rows still arrive; push does not. */
create or replace function public.set_conversation_muted(p_conversation_id uuid, p_muted boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_conv public.conversations;
  v_muted boolean := coalesce(p_muted, false);
begin
  v_conv := public.conversation_for_participant(p_conversation_id);
  update public.conversations
     set initiator_muted = case when initiator_id = v_me then v_muted else initiator_muted end,
         recipient_muted = case when recipient_id = v_me then v_muted else recipient_muted end
   where id = v_conv.id;
  return v_muted;
end $$;
revoke all on function public.set_conversation_muted(uuid, boolean) from public, anon;
grant execute on function public.set_conversation_muted(uuid, boolean) to authenticated;

/* Block the other person (pair-wide, as send-message checks it) and close this thread. */
create or replace function public.block_conversation_counterpart(p_conversation_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_conv public.conversations;
  v_other uuid;
begin
  v_conv := public.conversation_for_participant(p_conversation_id);
  v_other := case when v_conv.initiator_id = v_me then v_conv.recipient_id else v_conv.initiator_id end;
  insert into public.conversation_blocks (blocker_id, blocked_id, reason)
  values (v_me, v_other, 'CONVERSATION')
  on conflict (blocker_id, blocked_id) do nothing;
  update public.conversations set status = 'BLOCKED' where id = v_conv.id;
  return true;
end $$;
revoke all on function public.block_conversation_counterpart(uuid) from public, anon;
grant execute on function public.block_conversation_counterpart(uuid) to authenticated;

/* Lift MY block. The thread reopens only if neither side still blocks the other. */
create or replace function public.unblock_conversation_counterpart(p_conversation_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_conv public.conversations;
  v_other uuid;
begin
  v_conv := public.conversation_for_participant(p_conversation_id);
  v_other := case when v_conv.initiator_id = v_me then v_conv.recipient_id else v_conv.initiator_id end;
  delete from public.conversation_blocks where blocker_id = v_me and blocked_id = v_other;
  if not exists (select 1 from public.conversation_blocks b
                  where (b.blocker_id = v_me and b.blocked_id = v_other)
                     or (b.blocker_id = v_other and b.blocked_id = v_me)) then
    update public.conversations set status = 'ACTIVE' where id = v_conv.id and status::text = 'BLOCKED';
    return true;
  end if;
  return false;
end $$;
revoke all on function public.unblock_conversation_counterpart(uuid) from public, anon;
grant execute on function public.unblock_conversation_counterpart(uuid) to authenticated;

/*
 * What the thread header needs, decided on the server.
 *
 * The counterpart is a nickname or a FIRST name — never a surname, email or phone. The
 * property is the conversation's own listing (location to district level, no address).
 * canSend mirrors what send-message will enforce, so the composer does not invite a
 * message the server will refuse.
 */
create or replace function public.my_conversation_context(p_conversation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_conv public.conversations;
  v_other uuid;
  v_u jsonb;
  v_me_u jsonb;
  v_prop record;
  v_blocked_by_me boolean;
  v_blocked_by_them boolean;
  v_mine integer;
  v_theirs integer;
  v_owner boolean := false;
  v_property jsonb := null;
begin
  v_conv := public.conversation_for_participant(p_conversation_id);
  v_other := case when v_conv.initiator_id = v_me then v_conv.recipient_id else v_conv.initiator_id end;
  select to_jsonb(u) into v_u from public.users u where u.id = v_other;
  select to_jsonb(u) into v_me_u from public.users u where u.id = v_me;
  v_blocked_by_me := exists (select 1 from public.conversation_blocks where blocker_id = v_me and blocked_id = v_other);
  v_blocked_by_them := exists (select 1 from public.conversation_blocks where blocker_id = v_other and blocked_id = v_me);
  select count(*) filter (where sender_id = v_me), count(*) filter (where sender_id = v_other)
    into v_mine, v_theirs from public.messages where conversation_id = v_conv.id;

  if v_conv.property_id is not null then
    select p.id, p.user_id, p.homatch_id, p.title, p.cover_photo_url, p.is_deleted,
           f.city, f.district, f.total_price, f.currency, f.bedrooms, f.area, f.photo_visibility::text as photo_visibility
      into v_prop
      from public.properties p
      left join lateral (select * from public.property_facts pf where pf.property_id = p.id limit 1) f on true
     where p.id = v_conv.property_id;
    if found and not coalesce(v_prop.is_deleted, false) then
      v_owner := v_prop.user_id = v_me;
      v_property := jsonb_build_object(
        'id', v_prop.id, 'homatchId', v_prop.homatch_id, 'title', v_prop.title,
        'city', v_prop.city, 'district', v_prop.district,
        'price', v_prop.total_price, 'currency', v_prop.currency,
        'bedrooms', v_prop.bedrooms, 'area', v_prop.area,
        'cover', case when coalesce(v_prop.photo_visibility, 'PUBLIC') = 'PUBLIC' then v_prop.cover_photo_url end,
        'isMine', v_owner);
    end if;
  end if;

  return jsonb_build_object(
    'conversationId', v_conv.id,
    'status', v_conv.status::text,
    'counterpart', jsonb_build_object(
      'id', v_other,
      'displayName', coalesce(nullif(btrim(v_u ->> 'nickname'), ''),
                              nullif(split_part(btrim(coalesce(v_u ->> 'full_name', '')), ' ', 1), '')),
      'avatarUrl', v_u ->> 'avatar_url',
      'preferredLanguage', nullif(v_u ->> 'preferred_language', '')),
    'myLanguage', nullif(v_me_u ->> 'preferred_language', ''),
    'property', v_property,
    'mutedByMe', case when v_conv.initiator_id = v_me then v_conv.initiator_muted else v_conv.recipient_muted end,
    'blockedByMe', v_blocked_by_me,
    'blockedByThem', v_blocked_by_them,
    'canSend', not v_blocked_by_me and not v_blocked_by_them and v_conv.status::text not in ('BLOCKED', 'ARCHIVED')
               and (not v_owner or v_theirs > 0 or v_mine < 3),
    'awaitingFirstReply', v_owner and v_theirs = 0,
    'offerMessagesRemaining', case when v_owner and v_theirs = 0 then greatest(0, 3 - v_mine) end);
end $$;
revoke all on function public.my_conversation_context(uuid) from public, anon;
grant execute on function public.my_conversation_context(uuid) to authenticated;

/* Cached translations (into p_target_lang) and transcripts of this conversation's messages. */
create or replace function public.my_message_translations(p_conversation_id uuid, p_target_lang text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_conv public.conversations;
begin
  v_conv := public.conversation_for_participant(p_conversation_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'messageId', t.message_id, 'kind', t.kind, 'targetLang', nullif(t.target_lang, ''),
             'sourceLang', t.source_lang, 'text', t.text) order by t.created_at)
      from public.message_translations t
      join public.messages m on m.id = t.message_id
     where m.conversation_id = v_conv.id
       and (t.kind = 'TRANSCRIPT' or t.target_lang = coalesce(p_target_lang, ''))
  ), '[]'::jsonb);
end $$;
revoke all on function public.my_message_translations(uuid, text) from public, anon;
grant execute on function public.my_message_translations(uuid, text) to authenticated;
