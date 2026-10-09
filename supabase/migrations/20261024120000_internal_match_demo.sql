-- ============================================================================
-- HOMATCH INTERNAL MATCHES — ONE DEMO BUYER, AND A SIMULATED PRIVATE CHANNEL.
--
-- WHAT THIS IS
--
-- An administrator (or a named tester) needs to see the internal-match product
-- end to end on a real property — card, buyer profile, private message, reply —
-- before real members produce real matches. This migration adds exactly ONE
-- demo buyer, tied to one existing property (HOMATCH 244486), and a messaging
-- channel that only simulates the other side.
--
-- WHAT THIS IS NOT, AND HOW THAT IS ENFORCED
--
--   * not a HOMATCH user: no public.users row, no auth.users row. The demo buyer
--     is a row in demo_buyer_profiles and nothing else. "Never fabricate a
--     HOMATCH user" holds because nothing here can create one.
--   * not a match: nothing is written to supply_matches, matches,
--     find_buyers_leads or any campaign table, so no count, campaign statistic
--     or admin aggregate can include it.
--   * not a conversation: demo_conversations / demo_messages are separate
--     tables. public.conversations and public.messages are never touched, so
--     send-message, notify(), push-send and message_receipts never see a demo
--     message.
--   * not billed: the simulated "unlock" records demo_unlocked_at and nothing
--     else — no credit read, no reservation, no ledger row.
--
-- WHO MAY SEE IT
--
--   public.internal_match_demo_allowed(): public.is_admin(), or a users.id
--   listed in admin_settings 'internal_match_demo_testers' (a jsonb array).
--   Every RPC and every RLS policy below checks it. Everybody else gets nothing
--   — the RPC returns null, the tables return no rows.
--
-- The match SCORE is not stored here. The client computes it at runtime with
-- the same engine and the same mapping the supply-matching worker uses
-- (src/research-core/match/native-pair.ts → assessMatch), against the
-- property's CURRENT property_facts, which demo_internal_match_for_property
-- returns alongside the profile.
--
-- Idempotent: safe to apply twice (tests/sql/run-internal-match-demo.sh does).
-- ============================================================================

/* ── who may see the demo ───────────────────────────────────────────────── */

insert into public.admin_settings (key, value, description)
values ('internal_match_demo_testers', '[]'::jsonb,
        'users.id values (jsonb array) who may see the internal-match DEMO buyer besides administrators.')
on conflict (key) do nothing;

create or replace function public.internal_match_demo_allowed()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.is_admin(), false)
      or exists (
        select 1
          from public.admin_settings s
         where s.key = 'internal_match_demo_testers'
           and jsonb_typeof(s.value) = 'array'
           and s.value ? (public.current_homatch_user_id())::text
      )
$$;

revoke all on function public.internal_match_demo_allowed() from public, anon;
grant execute on function public.internal_match_demo_allowed() to authenticated;

/* ── the demo buyer: requirements only, never an account ─────────────────── */

create table if not exists public.demo_buyer_profiles (
  id               uuid primary key default gen_random_uuid(),
  /* The fixed key the seed is idempotent on. One demo buyer, not a generator. */
  demo_key         text not null unique,
  property_id      uuid not null references public.properties(id) on delete cascade,
  is_demo          boolean not null default true check (is_demo),
  display_label    text not null default 'DEMO',
  /* What the buyer made available for matching — intent_profiles' shape. */
  intent_type      text,
  transaction_type text,
  city             text,
  districts        text[],
  property_types   text[],
  budget_min       numeric,
  budget_max       numeric,
  currency         text,
  bedrooms_min     integer,
  bedrooms_max     integer,
  rooms_min        integer,
  rooms_max        integer,
  area_min         numeric,
  area_max         numeric,
  timeline_months  integer,
  /* active_search_subscriptions.search_criteria's shape: the stated strengths. */
  search_criteria  jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create table if not exists public.demo_conversations (
  id               uuid primary key default gen_random_uuid(),
  demo_buyer_id    uuid not null references public.demo_buyer_profiles(id) on delete cascade,
  property_id      uuid not null references public.properties(id) on delete cascade,
  /* The admin/tester who opened it. A real users row — the VIEWER, never the buyer. */
  owner_user_id    uuid not null references public.users(id) on delete cascade,
  is_demo          boolean not null default true check (is_demo),
  demo_unlocked_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (demo_buyer_id, property_id, owner_user_id)
);

create table if not exists public.demo_messages (
  id               uuid primary key default gen_random_uuid(),
  /* Order of writing. The simulated reply's clock runs a few seconds ahead of the
     message it answers, so timestamps alone could interleave a fast second message. */
  seq              bigint generated always as identity,
  conversation_id  uuid not null references public.demo_conversations(id) on delete cascade,
  sender           text not null check (sender in ('OWNER', 'DEMO_BUYER')),
  body             text not null check (char_length(body) between 1 and 2000),
  /* Every DEMO_BUYER row is simulated; an OWNER row is what the viewer typed. */
  is_simulated     boolean not null default false,
  language         text,
  sent_at          timestamptz not null default now(),
  delivered_at     timestamptz,
  seen_at          timestamptz,
  created_at       timestamptz not null default now(),
  check (sender = 'OWNER' or is_simulated)
);

create index if not exists demo_messages_conversation_idx
  on public.demo_messages (conversation_id, seq);

alter table public.demo_buyer_profiles enable row level security;
alter table public.demo_conversations  enable row level security;
alter table public.demo_messages       enable row level security;

/* Reads only, and only for the demo audience; every write goes through the RPCs. */
revoke all on table public.demo_buyer_profiles from anon, authenticated;
revoke all on table public.demo_conversations  from anon, authenticated;
revoke all on table public.demo_messages       from anon, authenticated;
grant select on table public.demo_buyer_profiles to authenticated;
grant select on table public.demo_conversations  to authenticated;
grant select on table public.demo_messages       to authenticated;

drop policy if exists demo_buyer_profiles_read on public.demo_buyer_profiles;
create policy demo_buyer_profiles_read on public.demo_buyer_profiles
  for select to authenticated using (public.internal_match_demo_allowed());

drop policy if exists demo_conversations_read on public.demo_conversations;
create policy demo_conversations_read on public.demo_conversations
  for select to authenticated using (
    public.internal_match_demo_allowed()
    and owner_user_id = public.current_homatch_user_id()
  );

drop policy if exists demo_messages_read on public.demo_messages;
create policy demo_messages_read on public.demo_messages
  for select to authenticated using (
    public.internal_match_demo_allowed()
    and exists (
      select 1 from public.demo_conversations c
       where c.id = demo_messages.conversation_id
         and c.owner_user_id = public.current_homatch_user_id()
    )
  );

/* ── the seed: exactly one demo buyer, for HOMATCH 244486 ─────────────────── */

/*
 * Only where the property exists (a fresh database has no such row, and the FK
 * must not fail the migration there). The property's facts are NOT copied: the
 * profile states what the buyer wants, and the comparison reads the listing as
 * it is when the page is opened.
 */
insert into public.demo_buyer_profiles (
  demo_key, property_id, intent_type, transaction_type, city, districts, property_types,
  budget_min, budget_max, currency, bedrooms_min, bedrooms_max, rooms_min, rooms_max,
  area_min, area_max, timeline_months, search_criteria
)
select 'internal-match-demo-244486', p.id, 'BUY', 'SALE', 'Tbilisi',
       array['Krtsanisi', 'Ortachala'], array['APARTMENT'],
       190000, 235000, 'USD', 2, 2, null, null,
       85, 115, 3, '{}'::jsonb
  from public.properties p
 where p.id = 'c5c1a6a4-6fed-4764-91c2-3cd7ad090407'
on conflict (demo_key) do nothing;

/* ── RPCs ─────────────────────────────────────────────────────────────────── */

/*
 * The demo buyer for this property, with the property's CURRENT facts, or null.
 * Null for anybody outside the demo audience, and for a tester who neither owns
 * the property nor is an administrator.
 */
create or replace function public.demo_internal_match_for_property(p_property_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_me    uuid := public.current_homatch_user_id();
  v_prop  record;
  v_facts jsonb;
  v_prof  public.demo_buyer_profiles;
  v_conv  public.demo_conversations;
begin
  if v_me is null or not public.internal_match_demo_allowed() then return null; end if;
  select id, user_id, transaction_type::text as transaction_type, property_type::text as property_type,
         listed_by_role::text as listed_by_role, homatch_id
    into v_prop
    from public.properties where id = p_property_id and is_deleted = false;
  if not found then return null; end if;
  if v_prop.user_id is distinct from v_me and not coalesce(public.is_admin(), false) then return null; end if;

  select * into v_prof from public.demo_buyer_profiles
   where property_id = p_property_id order by created_at limit 1;
  if not found then return null; end if;

  select to_jsonb(f) into v_facts from (
    select city, district, total_price, currency, area, rooms, bedrooms
      from public.property_facts where property_id = p_property_id
     order by updated_at desc limit 1
  ) f;

  select * into v_conv from public.demo_conversations
   where demo_buyer_id = v_prof.id and property_id = p_property_id and owner_user_id = v_me;

  return jsonb_build_object(
    'is_demo', true,
    'profile', to_jsonb(v_prof),
    'property', jsonb_build_object(
      'id', v_prop.id, 'homatch_id', v_prop.homatch_id,
      'transaction_type', v_prop.transaction_type, 'property_type', v_prop.property_type,
      'listed_by_role', v_prop.listed_by_role),
    'facts', v_facts,
    'conversation_id', v_conv.id,
    'demo_unlocked_at', v_conv.demo_unlocked_at
  );
end $$;

revoke all on function public.demo_internal_match_for_property(uuid) from public, anon;
grant execute on function public.demo_internal_match_for_property(uuid) to authenticated;

/* The caller's demo conversation with the demo buyer about this property. Same id every time. */
create or replace function public.demo_open_conversation(p_demo_buyer_id uuid, p_property_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me    uuid := public.current_homatch_user_id();
  v_owner uuid;
  v_id    uuid;
begin
  if v_me is null or not public.internal_match_demo_allowed() then
    raise exception 'DEMO_NOT_ALLOWED' using errcode = '42501';
  end if;
  select user_id into v_owner from public.properties where id = p_property_id and is_deleted = false;
  if not found or (v_owner is distinct from v_me and not coalesce(public.is_admin(), false)) then
    raise exception 'DEMO_NOT_ALLOWED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.demo_buyer_profiles where id = p_demo_buyer_id and property_id = p_property_id) then
    raise exception 'DEMO_NOT_FOUND' using errcode = 'P0002';
  end if;
  insert into public.demo_conversations (demo_buyer_id, property_id, owner_user_id)
  values (p_demo_buyer_id, p_property_id, v_me)
  on conflict (demo_buyer_id, property_id, owner_user_id) do update set updated_at = public.demo_conversations.updated_at
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.demo_open_conversation(uuid, uuid) from public, anon;
grant execute on function public.demo_open_conversation(uuid, uuid) to authenticated;

/* The conversation, if it is the caller's and the caller is in the demo audience. */
create or replace function public.demo_conversation_guard(p_conversation_id uuid)
returns public.demo_conversations
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_conv public.demo_conversations;
begin
  if public.current_homatch_user_id() is null or not public.internal_match_demo_allowed() then
    raise exception 'DEMO_NOT_ALLOWED' using errcode = '42501';
  end if;
  select * into v_conv from public.demo_conversations
   where id = p_conversation_id and owner_user_id = public.current_homatch_user_id();
  if not found then raise exception 'DEMO_NOT_FOUND' using errcode = 'P0002'; end if;
  return v_conv;
end $$;

revoke all on function public.demo_conversation_guard(uuid) from public, anon, authenticated;

/*
 * The simulated buyer's reply: a fixed template, chosen by how many messages the
 * viewer has sent so far and by the viewer's UI language. Deterministic — the same
 * conversation produces the same replies — and never generated, so it can never
 * say anything a template does not.
 */
create or replace function public.demo_reply_template(p_index integer, p_lang text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select (case coalesce(p_lang, 'en')
    when 'ka' then array[
      'გამარჯობა, მადლობა შეტყობინებისთვის. თქვენი ბინა ზუსტად ის არის, რასაც ვეძებ — ისევ ხელმისაწვდომია?',
      'შემიძლია ამ კვირაში ვნახო? სამუშაო დღეებში საღამოს მირჩევნია.',
      'მადლობა. ფასზე საუბარი შესაძლებელია ჩემი ბიუჯეტის ფარგლებში?',
      'გასაგებია, მადლობა. დავფიქრდები და მალე გიპასუხებთ.']
    when 'ru' then array[
      'Здравствуйте, спасибо за сообщение. Ваша квартира подходит под то, что я ищу — она ещё доступна?',
      'Можно посмотреть её на этой неделе? Мне удобнее в будние дни вечером.',
      'Спасибо. Возможно ли обсудить цену в рамках бюджета, который я указал?',
      'Понятно, спасибо. Я подумаю и скоро отвечу.']
    when 'tr' then array[
      'Merhaba, mesajınız için teşekkürler. Daireniz aradığıma uyuyor — hâlâ müsait mi?',
      'Bu hafta görmeye gelebilir miyim? Hafta içi akşamlar bana daha uygun.',
      'Teşekkürler. Paylaştığım bütçe dahilinde fiyat konuşulabilir mi?',
      'Anladım, teşekkürler. Düşünüp kısa süre içinde döneceğim.']
    when 'ar' then array[
      'مرحبًا، شكرًا على رسالتك. شقتك تناسب ما أبحث عنه — هل ما زالت متاحة؟',
      'هل يمكنني معاينتها هذا الأسبوع؟ تناسبني أمسيات أيام العمل.',
      'شكرًا. هل يمكن مناقشة السعر ضمن الميزانية التي ذكرتها؟',
      'مفهوم، شكرًا. سأفكر في الأمر وأرد قريبًا.']
    when 'he' then array[
      'שלום, תודה על ההודעה. הדירה שלך מתאימה למה שאני מחפש — היא עדיין זמינה?',
      'אפשר לבוא לראות אותה השבוע? ערבים באמצע השבוע הכי נוחים לי.',
      'תודה. אפשר לדבר על המחיר במסגרת התקציב שציינתי?',
      'הבנתי, תודה. אחשוב על זה ואחזור אליך בקרוב.']
    else array[
      'Hello, thank you for your message. Your apartment fits what I am looking for — is it still available?',
      'Could I come to see it this week? Weekday evenings suit me best.',
      'Thank you. Is the price open to discussion within the budget I shared?',
      'Understood, thank you. I will think it over and reply soon.']
  end)[1 + (greatest(p_index, 0) % 4)]
$$;

revoke all on function public.demo_reply_template(integer, text) from public, anon, authenticated;

/*
 * Store the viewer's message and the simulated reply. Both rows carry their
 * delivery clock: the viewer's message is SENT now, DELIVERED a second later and
 * SEEN when the simulated buyer "reads" it; the reply follows. Nothing here calls
 * notify(), touches public.messages or reads a wallet.
 */
create or replace function public.demo_send_message(p_conversation_id uuid, p_body text, p_lang text default 'en')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conv  public.demo_conversations;
  v_body  text := btrim(coalesce(p_body, ''));
  v_lang  text := case when p_lang in ('ka', 'en', 'ru', 'tr', 'ar', 'he') then p_lang else 'en' end;
  v_sent  integer;
  v_now   timestamptz := clock_timestamp();
  v_mine  public.demo_messages;
  v_reply public.demo_messages;
begin
  v_conv := public.demo_conversation_guard(p_conversation_id);
  if char_length(v_body) = 0 or char_length(v_body) > 2000 then
    raise exception 'DEMO_INVALID_BODY' using errcode = '22023';
  end if;
  select count(*) into v_sent from public.demo_messages
   where conversation_id = v_conv.id and sender = 'OWNER';

  insert into public.demo_messages (conversation_id, sender, body, is_simulated, language, sent_at, delivered_at, seen_at, created_at)
  values (v_conv.id, 'OWNER', v_body, false, v_lang, v_now, v_now + interval '1 second', v_now + interval '2 seconds', v_now)
  returning * into v_mine;

  insert into public.demo_messages (conversation_id, sender, body, is_simulated, language, sent_at, delivered_at, seen_at, created_at)
  values (v_conv.id, 'DEMO_BUYER', public.demo_reply_template(v_sent, v_lang), true, v_lang,
          v_now + interval '3 seconds', v_now + interval '3 seconds', v_now + interval '3 seconds', v_now + interval '3 seconds')
  returning * into v_reply;

  update public.demo_conversations set updated_at = v_now where id = v_conv.id;
  return jsonb_build_object('message', to_jsonb(v_mine), 'reply', to_jsonb(v_reply));
end $$;

revoke all on function public.demo_send_message(uuid, text, text) from public, anon;
grant execute on function public.demo_send_message(uuid, text, text) to authenticated;

/* The conversation's history, oldest first, with its context. */
create or replace function public.demo_list_messages(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_conv public.demo_conversations;
begin
  v_conv := public.demo_conversation_guard(p_conversation_id);
  return jsonb_build_object(
    'conversation', jsonb_build_object(
      'id', v_conv.id, 'demo_buyer_id', v_conv.demo_buyer_id, 'property_id', v_conv.property_id,
      'demo_unlocked_at', v_conv.demo_unlocked_at, 'is_demo', true),
    'messages', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.seq)
        from public.demo_messages m where m.conversation_id = v_conv.id
    ), '[]'::jsonb)
  );
end $$;

revoke all on function public.demo_list_messages(uuid) from public, anon;
grant execute on function public.demo_list_messages(uuid) to authenticated;

/* The simulated contact "unlock": records the moment, charges nothing, reveals nothing. */
create or replace function public.demo_unlock_contact(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conv public.demo_conversations;
  v_at   timestamptz;
begin
  v_conv := public.demo_conversation_guard(p_conversation_id);
  update public.demo_conversations
     set demo_unlocked_at = coalesce(demo_unlocked_at, clock_timestamp())
   where id = v_conv.id
  returning demo_unlocked_at into v_at;
  return jsonb_build_object('demo_unlocked_at', v_at, 'simulated', true, 'charged_credits', 0, 'phone', null);
end $$;

revoke all on function public.demo_unlock_contact(uuid) from public, anon;
grant execute on function public.demo_unlock_contact(uuid) to authenticated;

/* ── one person, one card ─────────────────────────────────────────────────── */

/*
 * my_native_matches can return the same member twice for one property: a
 * requirements MATCH and a RELATIONSHIP (they also asked about it, or asked to
 * see it). Counting rows would count that person twice. This returns, for each
 * of the caller's rows, an OPAQUE key per (property, counterparty) — an md5, never
 * the user id — so the owner's page groups by person without learning who they
 * are. Read-only; the same membership test as my_native_matches.
 */
create or replace function public.my_native_match_counterparts(p_property_id uuid default null)
returns table (kind text, id uuid, counterpart_key text)
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  /* A per-call random salt: the key de-duplicates one person within this
     result only and can never be matched against a known user id. */
  with me as materialized (select public.current_homatch_user_id() as uid, gen_random_uuid()::text as salt)
  select 'MATCH'::text, m.id,
         md5(me.salt || ':' || m.property_id::text || ':' || (case when m.supply_user_id = me.uid then m.demand_user_id else m.supply_user_id end)::text)
    from public.supply_matches m cross join me
   where m.source_kind = 'INTERNAL_HOMATCH'
     and me.uid in (m.supply_user_id, m.demand_user_id)
     and (p_property_id is null or m.property_id = p_property_id)
  union all
  select 'RELATIONSHIP'::text, r.id,
         md5(me.salt || ':' || r.property_id::text || ':' || (case when r.supply_user_id = me.uid then r.demand_user_id else r.supply_user_id end)::text)
    from public.native_property_relationships r cross join me
   where me.uid in (r.supply_user_id, r.demand_user_id)
     and (p_property_id is null or r.property_id = p_property_id)
  limit 400
$$;

revoke all on function public.my_native_match_counterparts(uuid) from public, anon;
grant execute on function public.my_native_match_counterparts(uuid) to authenticated;
