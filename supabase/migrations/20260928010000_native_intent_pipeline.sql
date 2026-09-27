-- NATIVE INTENT, CONNECTED END TO END.
--
-- The canonical intent layer (20260927160000..180000) was written and not reachable:
--
--   1. intent_signals_source_key is an EXPRESSION index — coalesce(dimension, '') — and an
--      upsert from PostgREST can only name plain columns as its conflict target. Every
--      recordIntent() call therefore raised "no unique or exclusion constraint matching the
--      ON CONFLICT specification", which the writer caught and returned as a refusal. Zero
--      signals in production is that bug, not an absence of intent.
--   2. An edited message kept its id, so re-reading it produced the same identity as the
--      reading it replaced — and that row had just been withdrawn. The identity now carries
--      the revision it was read from.
--   3. supply_matches_native_key is PARTIAL, which PostgREST cannot target either. Native
--      match writes go through a SQL function that names the predicate.
--   4. Nothing scheduled the workers and nothing woke them when a message arrived.
--
-- Also here, because each is the other half of something above:
--
--   rooms_min / rooms_max on intent_profiles — "3 ოთახიანი" is three rooms, not three
--   bedrooms, and a demand has to be able to say which it meant.
--
--   native_property_relationships — how a person stands towards one specific property,
--   from a private message or a viewing request. Not a match: nobody's requirements were
--   compared with anything. A person asked about, or asked to see, a flat.
--
--   One conversation per pair and property, enforced by the database, and the two customer
--   actions a genuine native relationship offers — open the conversation, reveal the
--   contact number — as functions that decide authorisation on the server.

/* ════════════════════════════════════════════════════════════════════════
 * 1 · intent_signals identity
 * ════════════════════════════════════════════════════════════════════════ */

alter table public.intent_signals
  add column if not exists source_revision text not null default '';

comment on column public.intent_signals.source_revision is
  'Which version of the source event this reading is of. Empty for the original; the edit timestamp for a re-read after an edit. An edited message is read again and its new reading stands beside the withdrawn old one rather than overwriting it.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'intent_signals' and column_name = 'dimension_key'
  ) then
    alter table public.intent_signals
      add column dimension_key text generated always as (coalesce(dimension, '')) stored;
  end if;
end $$;

comment on column public.intent_signals.dimension_key is
  'dimension with null folded to the empty string, so the identity can be a plain-column unique index an upsert can name.';

drop index if exists public.intent_signals_source_key;
create unique index if not exists intent_signals_identity_key
  on public.intent_signals (source_surface, source_event_id, source_revision, side, act, dimension_key);

create index if not exists intent_signals_source_idx
  on public.intent_signals (source_surface, source_event_id);

/* ════════════════════════════════════════════════════════════════════════
 * 2 · rooms are not bedrooms
 * ════════════════════════════════════════════════════════════════════════ */

alter table public.intent_profiles
  add column if not exists rooms_min integer,
  add column if not exists rooms_max integer;

comment on column public.intent_profiles.rooms_min is
  'Rooms counted the way the living room is counted (ოთახიანი, комнатная, חדרים). Distinct from bedrooms; the matcher compares each with its own kind.';

/* ════════════════════════════════════════════════════════════════════════
 * 3 · how a person stands towards one property
 * ════════════════════════════════════════════════════════════════════════ */

create table if not exists public.native_property_relationships (
  id                uuid primary key default gen_random_uuid(),
  property_id       uuid not null references public.properties(id) on delete cascade,
  /* The person asking. Resolved from the source row under the service role. */
  demand_user_id    uuid not null references public.users(id) on delete cascade,
  /* The owner. Resolved from properties.user_id; never from a client. */
  supply_user_id    uuid not null references public.users(id) on delete cascade,
  /* INTERESTED, ENQUIRED or REJECTED — the effective reading of what they said. */
  state             text not null,
  /* A live viewing request exists (PENDING / ACCEPTED / RESCHEDULE_PROPOSED / COMPLETED). */
  viewing_requested boolean not null default false,
  /* Dimensions they complained about. Recorded, and not a rejection. */
  objections        text[] not null default '{}',
  /* Which surfaces contributed: PRIVATE_MESSAGE, VIEWING_REQUEST, LIVE_CHAT. */
  surfaces          text[] not null default '{}',
  /* Signal ids, newest first. Provenance, never a copy of anything anybody wrote. */
  evidence          uuid[] not null default '{}',
  conversation_id   uuid references public.conversations(id) on delete set null,
  last_event_at     timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint native_property_relationships_state check (state in ('INTERESTED', 'ENQUIRED', 'REJECTED')),
  constraint native_property_relationships_not_self check (demand_user_id <> supply_user_id),
  constraint native_property_relationships_pair unique (demand_user_id, property_id)
);

create index if not exists native_property_relationships_supply_idx
  on public.native_property_relationships (supply_user_id, last_event_at desc);
create index if not exists native_property_relationships_property_idx
  on public.native_property_relationships (property_id, last_event_at desc);

alter table public.native_property_relationships enable row level security;
/* No policies: every customer read goes through a function that decides what to disclose,
   the same authorisation model as supply_matches. */
revoke all on public.native_property_relationships from anon, authenticated;

/* ════════════════════════════════════════════════════════════════════════
 * 4 · one conversation per pair and property
 * ════════════════════════════════════════════════════════════════════════ */

/*
 * (initiator, recipient, property) was unique, which let A→B and B→A be two conversations
 * about the same flat, and let any number of property-less conversations exist between two
 * people because null is not equal to null. The canonical pair is the unordered pair.
 */
create unique index if not exists conversations_canonical_pair_key
  on public.conversations (
    least(initiator_id, recipient_id),
    greatest(initiator_id, recipient_id),
    coalesce(property_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

/*
 * THE ONE WAY A CONVERSATION COMES INTO EXISTENCE.
 *
 * Insert-or-return, atomically. send-message used to select, find nothing, then insert —
 * two taps at once produced two conversations. Service role only: the callers decide who
 * may talk to whom and this only guarantees there is one place for them to do it.
 */
create or replace function public.ensure_conversation(
  p_initiator uuid,
  p_recipient uuid,
  p_property  uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_initiator is null or p_recipient is null or p_initiator = p_recipient then
    raise exception 'a conversation needs two different people';
  end if;

  select id into v_id from public.conversations
   where least(initiator_id, recipient_id) = least(p_initiator, p_recipient)
     and greatest(initiator_id, recipient_id) = greatest(p_initiator, p_recipient)
     and coalesce(property_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_property, '00000000-0000-0000-0000-000000000000'::uuid);
  if v_id is not null then return v_id; end if;

  insert into public.conversations (initiator_id, recipient_id, property_id, status)
  values (p_initiator, p_recipient, p_property, 'ACTIVE')
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.conversations
     where least(initiator_id, recipient_id) = least(p_initiator, p_recipient)
       and greatest(initiator_id, recipient_id) = greatest(p_initiator, p_recipient)
       and coalesce(property_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce(p_property, '00000000-0000-0000-0000-000000000000'::uuid);
  end if;
  return v_id;
end $$;

revoke all on function public.ensure_conversation(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.ensure_conversation(uuid, uuid, uuid) to service_role;

/* ════════════════════════════════════════════════════════════════════════
 * 5 · native writes, with the predicate named
 * ════════════════════════════════════════════════════════════════════════ */

create or replace function public.upsert_native_match(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.supply_matches (
    intent_profile_id, property_id, supply_user_id, demand_user_id, source_kind, campaign_id,
    compatibility, match_score, demand_role, supply_role, deal_kind, agreed, conflicted,
    preference_misses, unknown_dimensions, flexible_dimensions, rationale, dimensions, updated_at
  ) values (
    (p->>'intent_profile_id')::uuid,
    (p->>'property_id')::uuid,
    (p->>'supply_user_id')::uuid,
    (p->>'demand_user_id')::uuid,
    'INTERNAL_HOMATCH',
    nullif(p->>'campaign_id', '')::uuid,
    p->>'compatibility',
    coalesce((p->>'match_score')::numeric, 0),
    p->>'demand_role',
    p->>'supply_role',
    p->>'deal_kind',
    coalesce(array(select jsonb_array_elements_text(p->'agreed')), '{}'),
    coalesce(array(select jsonb_array_elements_text(p->'conflicted')), '{}'),
    coalesce(array(select jsonb_array_elements_text(p->'preference_misses')), '{}'),
    coalesce(array(select jsonb_array_elements_text(p->'unknown_dimensions')), '{}'),
    coalesce(array(select jsonb_array_elements_text(p->'flexible_dimensions')), '{}'),
    coalesce(p->>'rationale', ''),
    coalesce(p->'dimensions', '{}'::jsonb),
    now()
  )
  on conflict (intent_profile_id, property_id) where property_id is not null
  do update set
    compatibility       = excluded.compatibility,
    match_score         = excluded.match_score,
    demand_role         = excluded.demand_role,
    supply_role         = excluded.supply_role,
    deal_kind           = excluded.deal_kind,
    agreed              = excluded.agreed,
    conflicted          = excluded.conflicted,
    preference_misses   = excluded.preference_misses,
    unknown_dimensions  = excluded.unknown_dimensions,
    flexible_dimensions = excluded.flexible_dimensions,
    rationale           = excluded.rationale,
    dimensions          = excluded.dimensions,
    updated_at          = now()
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.upsert_native_match(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_native_match(jsonb) to service_role;

/*
 * A native match whose demand no longer holds is no longer shown.
 *
 * Deleting would lose the history an operator needs; marking it INCOMPATIBLE is what it
 * now is — the requirement it was compared against changed. Rows for demands that were
 * deactivated are retired the same way.
 */
create or replace function public.retire_native_matches(p_intent_profile_id uuid, p_keep uuid[] default '{}')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.supply_matches
     set compatibility = 'INCOMPATIBLE', updated_at = now()
   where intent_profile_id = p_intent_profile_id
     and source_kind = 'INTERNAL_HOMATCH'
     and compatibility = 'COMPATIBLE'
     and not (property_id = any (coalesce(p_keep, '{}')));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.retire_native_matches(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.retire_native_matches(uuid, uuid[]) to service_role;

create or replace function public.upsert_property_relationship(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_owner uuid;
begin
  select user_id into v_owner from public.properties where id = (p->>'property_id')::uuid;
  /* Nobody has a relationship with their own property. */
  if v_owner is null or v_owner = (p->>'demand_user_id')::uuid then return null; end if;

  insert into public.native_property_relationships (
    property_id, demand_user_id, supply_user_id, state, viewing_requested, objections,
    surfaces, evidence, conversation_id, last_event_at, updated_at
  ) values (
    (p->>'property_id')::uuid,
    (p->>'demand_user_id')::uuid,
    v_owner,
    p->>'state',
    coalesce((p->>'viewing_requested')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(p->'objections')), '{}'),
    coalesce(array(select jsonb_array_elements_text(p->'surfaces')), '{}'),
    coalesce(array(select (jsonb_array_elements_text(p->'evidence'))::uuid), '{}'),
    nullif(p->>'conversation_id', '')::uuid,
    coalesce((p->>'last_event_at')::timestamptz, now()),
    now()
  )
  on conflict (demand_user_id, property_id)
  do update set
    state             = excluded.state,
    viewing_requested = excluded.viewing_requested,
    objections        = excluded.objections,
    surfaces          = excluded.surfaces,
    evidence          = excluded.evidence,
    conversation_id   = coalesce(excluded.conversation_id, native_property_relationships.conversation_id),
    last_event_at     = greatest(native_property_relationships.last_event_at, excluded.last_event_at),
    updated_at        = now()
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.upsert_property_relationship(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_property_relationship(jsonb) to service_role;

/* ════════════════════════════════════════════════════════════════════════
 * 6 · what a customer may do with a genuine native relationship
 * ════════════════════════════════════════════════════════════════════════ */

/* The calling account's Homatch id, or null. */
create or replace function public.current_homatch_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.users where auth_id = auth.uid() limit 1
$$;

revoke all on function public.current_homatch_user_id() from public, anon;
grant execute on function public.current_homatch_user_id() to authenticated, service_role;

/*
 * MESSAGE — open the conversation a native relationship is about, or the existing one.
 *
 * p_kind is 'MATCH' (supply_matches, INTERNAL_HOMATCH, COMPATIBLE) or 'RELATIONSHIP'
 * (native_property_relationships). The caller must be one of the two accounts the row
 * names; the counterparty and the property come from the row, never from the request.
 * Repeated calls return the same conversation.
 */
create or replace function public.open_native_conversation(p_kind text, p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_supply uuid;
  v_demand uuid;
  v_property uuid;
  v_other uuid;
  v_conversation uuid;
  v_blocked boolean;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;

  if p_kind = 'MATCH' then
    select supply_user_id, demand_user_id, property_id
      into v_supply, v_demand, v_property
      from public.supply_matches
     where id = p_id
       and source_kind = 'INTERNAL_HOMATCH'
       and compatibility = 'COMPATIBLE';
  elsif p_kind = 'RELATIONSHIP' then
    select supply_user_id, demand_user_id, property_id
      into v_supply, v_demand, v_property
      from public.native_property_relationships
     where id = p_id
       and state <> 'REJECTED';
  else
    raise exception 'unknown relationship kind' using errcode = '22023';
  end if;

  if v_supply is null or v_demand is null or v_me not in (v_supply, v_demand) then
    raise exception 'not found' using errcode = '42501';
  end if;

  v_other := case when v_me = v_supply then v_demand else v_supply end;

  select exists (
    select 1 from public.conversation_blocks
     where (blocker_id = v_me and blocked_id = v_other)
        or (blocker_id = v_other and blocked_id = v_me)
  ) into v_blocked;
  if v_blocked then raise exception 'not available' using errcode = '42501'; end if;

  v_conversation := public.ensure_conversation(v_me, v_other, v_property);

  if p_kind = 'RELATIONSHIP' then
    update public.native_property_relationships
       set conversation_id = coalesce(conversation_id, v_conversation), updated_at = now()
     where id = p_id;
  end if;
  return v_conversation;
end $$;

revoke all on function public.open_native_conversation(text, uuid) from public, anon;
grant execute on function public.open_native_conversation(text, uuid) to authenticated;

/* Every disclosure of a contact number, for the person whose number it was. */
create table if not exists public.contact_disclosures (
  id              uuid primary key default gen_random_uuid(),
  viewer_user_id  uuid not null references public.users(id) on delete cascade,
  subject_user_id uuid not null references public.users(id) on delete cascade,
  property_id     uuid references public.properties(id) on delete set null,
  relationship_kind text not null,
  relationship_id uuid not null,
  created_at      timestamptz not null default now()
);
create index if not exists contact_disclosures_subject_idx
  on public.contact_disclosures (subject_user_id, created_at desc);
alter table public.contact_disclosures enable row level security;
revoke all on public.contact_disclosures from anon, authenticated;

/*
 * CALL — the number to call, when the relationship entitles the caller to one.
 *
 *   the person looking     -> the property's contact number, which its owner entered for
 *                             exactly this purpose. Private by default: only a counterparty
 *                             of a genuine native relationship reaches it, and each reveal
 *                             is recorded.
 *   the owner              -> the other person's number only if that person shared it in
 *                             their conversation. A search or a viewing request is not
 *                             consent to be phoned.
 *
 * Returns { phone, reason }. reason is NOT_SHARED / NO_NUMBER when phone is null.
 */
create or replace function public.reveal_native_contact(p_kind text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_supply uuid;
  v_demand uuid;
  v_property uuid;
  v_phone text;
  v_conversation uuid;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;

  if p_kind = 'MATCH' then
    select supply_user_id, demand_user_id, property_id
      into v_supply, v_demand, v_property
      from public.supply_matches
     where id = p_id and source_kind = 'INTERNAL_HOMATCH' and compatibility = 'COMPATIBLE';
  elsif p_kind = 'RELATIONSHIP' then
    select supply_user_id, demand_user_id, property_id, conversation_id
      into v_supply, v_demand, v_property, v_conversation
      from public.native_property_relationships
     where id = p_id and state <> 'REJECTED';
  else
    raise exception 'unknown relationship kind' using errcode = '22023';
  end if;

  if v_supply is null or v_demand is null or v_me not in (v_supply, v_demand) then
    raise exception 'not found' using errcode = '42501';
  end if;

  if v_me = v_demand then
    select contact_phone_e164 into v_phone
      from public.properties
     where id = v_property and is_deleted = false and archived_at is null;
    if v_phone is null then return jsonb_build_object('phone', null, 'reason', 'NO_NUMBER'); end if;
    insert into public.contact_disclosures (viewer_user_id, subject_user_id, property_id, relationship_kind, relationship_id)
    values (v_me, v_supply, v_property, p_kind, p_id);
    return jsonb_build_object('phone', v_phone, 'reason', null);
  end if;

  /* The owner asking for the other person's number: only what that person shared. */
  select s.phone into v_phone
    from public.conversation_contact_shares s
    join public.conversations c on c.id = s.conversation_id
   where s.sharer_id = v_demand
     and least(c.initiator_id, c.recipient_id) = least(v_supply, v_demand)
     and greatest(c.initiator_id, c.recipient_id) = greatest(v_supply, v_demand)
     and s.phone is not null
   order by s.created_at desc
   limit 1;
  if v_phone is null then return jsonb_build_object('phone', null, 'reason', 'NOT_SHARED'); end if;
  insert into public.contact_disclosures (viewer_user_id, subject_user_id, property_id, relationship_kind, relationship_id)
  values (v_me, v_demand, v_property, p_kind, p_id);
  return jsonb_build_object('phone', v_phone, 'reason', null);
end $$;

revoke all on function public.reveal_native_contact(text, uuid) from public, anon;
grant execute on function public.reveal_native_contact(text, uuid) to authenticated;

/*
 * WHAT A CUSTOMER SEES OF THEIR NATIVE RELATIONSHIPS.
 *
 * Structured fields only. The counterparty is shown by the name they chose to show
 * (nickname, else first name) — never an email, never a phone, never anything they wrote.
 * An owner sees INTERESTED relationships and viewing requests; an ENQUIRED-only row is a
 * question they have already been sent as a message, and a REJECTED one is not theirs to
 * see as interest.
 */
create or replace function public.my_native_matches(p_property_id uuid default null)
returns table (
  kind              text,
  id                uuid,
  role              text,
  property_id       uuid,
  homatch_id        integer,
  property_title    text,
  counterparty_name text,
  match_score       numeric,
  agreed            text[],
  preference_misses text[],
  deal_kind         text,
  state             text,
  viewing_requested boolean,
  has_conversation  boolean,
  updated_at        timestamptz,
  /* The listing as a counterparty may see it: facts, never the address or a contact. */
  city              text,
  district          text,
  property_type     text,
  transaction_type  text,
  price             numeric,
  currency          text,
  area              numeric,
  rooms             integer,
  bedrooms          integer
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select public.current_homatch_user_id() as uid)
  select 'MATCH'::text, m.id,
         case when m.supply_user_id = me.uid then 'OWNER' else 'SEEKER' end,
         m.property_id, p.homatch_id, p.title,
         coalesce(nullif(other.nickname, ''), nullif(split_part(coalesce(other.full_name, ''), ' ', 1), '')),
         m.match_score, m.agreed, m.preference_misses, m.deal_kind,
         'MATCHED'::text, false,
         exists (
           select 1 from public.conversations c
            where least(c.initiator_id, c.recipient_id) = least(m.supply_user_id, m.demand_user_id)
              and greatest(c.initiator_id, c.recipient_id) = greatest(m.supply_user_id, m.demand_user_id)
              and c.property_id = m.property_id
         ),
         m.updated_at,
         f.city, f.district, p.property_type::text, p.transaction_type::text,
         f.total_price, f.currency, f.area, f.rooms, f.bedrooms
    from public.supply_matches m
    cross join me
    join public.properties p on p.id = m.property_id and p.is_deleted = false
    left join lateral (
      select city, district, total_price, currency, area, rooms, bedrooms
        from public.property_facts where property_id = p.id order by updated_at desc limit 1
    ) f on true
    join public.users other on other.id = case when m.supply_user_id = me.uid then m.demand_user_id else m.supply_user_id end
   where m.source_kind = 'INTERNAL_HOMATCH'
     and m.compatibility = 'COMPATIBLE'
     and me.uid in (m.supply_user_id, m.demand_user_id)
     and (p_property_id is null or m.property_id = p_property_id)
  union all
  select 'RELATIONSHIP'::text, r.id,
         case when r.supply_user_id = me.uid then 'OWNER' else 'SEEKER' end,
         r.property_id, p.homatch_id, p.title,
         coalesce(nullif(other.nickname, ''), nullif(split_part(coalesce(other.full_name, ''), ' ', 1), '')),
         null::numeric, '{}'::text[], '{}'::text[], null::text,
         r.state, r.viewing_requested, r.conversation_id is not null, r.updated_at,
         f.city, f.district, p.property_type::text, p.transaction_type::text,
         f.total_price, f.currency, f.area, f.rooms, f.bedrooms
    from public.native_property_relationships r
    cross join me
    join public.properties p on p.id = r.property_id and p.is_deleted = false
    left join lateral (
      select city, district, total_price, currency, area, rooms, bedrooms
        from public.property_facts where property_id = p.id order by updated_at desc limit 1
    ) f on true
    join public.users other on other.id = case when r.supply_user_id = me.uid then r.demand_user_id else r.supply_user_id end
   where me.uid in (r.supply_user_id, r.demand_user_id)
     and (r.state = 'INTERESTED' or r.viewing_requested)
     and (p_property_id is null or r.property_id = p_property_id)
  order by 15 desc
  limit 200
$$;

revoke all on function public.my_native_matches(uuid) from public, anon;
grant execute on function public.my_native_matches(uuid) to authenticated;

/* ════════════════════════════════════════════════════════════════════════
 * 7 · waking the workers
 * ════════════════════════════════════════════════════════════════════════ */

/* Private tokens for the two workers, in the same place as every other worker's. */
insert into public.admin_settings (key, value)
values ('ingest_live_chat_token', to_jsonb(encode(extensions.gen_random_bytes(24), 'hex')))
on conflict (key) do nothing;
insert into public.admin_settings (key, value)
values ('supply_matching_token', to_jsonb(encode(extensions.gen_random_bytes(24), 'hex')))
on conflict (key) do nothing;

/*
 * A committed message wakes the reader.
 *
 * Asynchronous (pg_net queues the request after commit), so a slow worker never slows a
 * message down, and a failed wake-up is caught by the minute schedule below. The reader
 * is incremental on its own cursors: a wake-up is a hint, not a payload, so it carries
 * nothing anybody wrote.
 */
create or replace function public.wake_native_intent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  select value #>> '{}' into v_token from public.admin_settings where key = 'ingest_live_chat_token';
  if v_token is null then return null; end if;
  perform net.http_post(
    url := 'https://ptxajsjhobhvsfhmutjn.supabase.co/functions/v1/ingest-live-chat',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-token', v_token),
    body := jsonb_build_object('source', tg_table_name),
    timeout_milliseconds := 20000
  );
  return null;
exception when others then
  /* Waking the reader must never fail the message. */
  return null;
end $$;

revoke all on function public.wake_native_intent() from public, anon, authenticated;

drop trigger if exists live_chat_messages_wake_native_intent on public.live_chat_messages;
create trigger live_chat_messages_wake_native_intent
  after insert or update of body, edited_at, deleted_at on public.live_chat_messages
  for each statement execute function public.wake_native_intent();

drop trigger if exists ai_messages_wake_native_intent on public.ai_messages;
create trigger ai_messages_wake_native_intent
  after insert on public.ai_messages
  for each statement execute function public.wake_native_intent();

/* The safety net: every minute for the reader, every fifteen for the matcher. */
do $$
begin
  if exists (select 1 from cron.job where jobname = 'homatch-native-intent') then
    perform cron.unschedule('homatch-native-intent');
  end if;
  perform cron.schedule(
    'homatch-native-intent',
    '* * * * *',
    $cron$
    select net.http_post(
      url := 'https://ptxajsjhobhvsfhmutjn.supabase.co/functions/v1/ingest-live-chat',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-cron-token', (select value #>> '{}' from public.admin_settings where key = 'ingest_live_chat_token')),
      body := '{"source":"cron"}'::jsonb,
      timeout_milliseconds := 30000
    );
    $cron$
  );

  if exists (select 1 from cron.job where jobname = 'homatch-supply-matching') then
    perform cron.unschedule('homatch-supply-matching');
  end if;
  perform cron.schedule(
    'homatch-supply-matching',
    '*/15 * * * *',
    $cron$
    select net.http_post(
      url := 'https://ptxajsjhobhvsfhmutjn.supabase.co/functions/v1/supply-matching',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-cron-token', (select value #>> '{}' from public.admin_settings where key = 'supply_matching_token')),
      body := '{"maxDemand":200,"nativeOnly":true}'::jsonb,
      timeout_milliseconds := 55000
    );
    $cron$
  );
end $$;
