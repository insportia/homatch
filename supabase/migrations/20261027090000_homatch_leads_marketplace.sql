-- HOMATCH LEADS — the internal matching marketplace.
--
-- A property owner sees every eligible HOMATCH member whose stated search fits the
-- property (supply_matches, source_kind INTERNAL_HOMATCH, COMPATIBLE), anonymised and
-- free to browse, and pays only to unlock the contacts they choose to approach:
--
--   STANDARD lead  2.5 credits   (billable product INTERNAL_LEAD_STANDARD)
--   PREMIUM  lead  6   credits   (billable product INTERNAL_LEAD_PREMIUM)
--
-- PREMIUM is a pricing segment — a genuinely higher-budget search, judged from the
-- member's own stated budget against configurable rules — and never feeds the match
-- score. The score is the engine's (supply_matches.match_score) and nothing here
-- changes it.
--
-- An unlock is an ENTITLEMENT of the paying account to one canonical lead (the member,
-- users.id): the same member matching another property, another campaign or an updated
-- search is never charged to that account again. Other accounts unlock independently.
-- An unlock is not consent: what is disclosed afterwards is what the member allows
-- (lead_contact_preferences), re-checked on every read, so a withdrawal applies at once.
--
-- Charging goes through the existing wallet (wallet_reserve + wallet_settle in the same
-- transaction, one reservation per segment), so lots, ledger, usage_events and the
-- finance reports carry the two products separately. External research is untouched.
--
-- Also here: the CRM a seller keeps for unlocked leads, the "fresh since your last
-- visit" watermark, and a property-side wake-up so a new or edited listing is matched
-- against existing demand without waiting for the sweep.
--
-- Append-only. The runner owns the transaction. Safe to apply twice.

/* ════════════════════════════════════════════════════════════════════════
 * 1 · what a member allows (the lead side of consent)
 * ════════════════════════════════════════════════════════════════════════ */

create table if not exists public.lead_contact_preferences (
  user_id                uuid primary key references public.users(id) on delete cascade,
  -- Receive property offers from owners whose listing matches my search.
  accept_property_offers boolean not null default true,
  -- After an owner unlocks my contact, may they see my phone / email?
  share_phone_on_unlock  boolean not null default false,
  share_email_on_unlock  boolean not null default false,
  -- Marketing email (Email Studio campaigns). Never implied by an unlock.
  accept_marketing_email boolean not null default false,
  updated_at             timestamptz not null default now()
);
alter table public.lead_contact_preferences enable row level security;
revoke all on public.lead_contact_preferences from anon, authenticated;
grant select, insert, update on public.lead_contact_preferences to authenticated;
drop policy if exists lead_contact_prefs_own on public.lead_contact_preferences;
create policy lead_contact_prefs_own on public.lead_contact_preferences
  for all to authenticated
  using (user_id = public.current_homatch_user_id())
  with check (user_id = public.current_homatch_user_id());

/* The effective preferences of any member: their row, or the defaults. */
create or replace function public.lead_contact_prefs_of(p_user_id uuid)
returns table (accept_property_offers boolean, share_phone_on_unlock boolean,
               share_email_on_unlock boolean, accept_marketing_email boolean)
language sql stable security definer set search_path = public as $$
  select coalesce(p.accept_property_offers, true), coalesce(p.share_phone_on_unlock, false),
         coalesce(p.share_email_on_unlock, false), coalesce(p.accept_marketing_email, false)
    from (select 1) one
    left join public.lead_contact_preferences p on p.user_id = p_user_id
$$;
revoke all on function public.lead_contact_prefs_of(uuid) from public, anon, authenticated;
grant execute on function public.lead_contact_prefs_of(uuid) to service_role;

create or replace function public.my_lead_contact_preferences()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'acceptPropertyOffers', p.accept_property_offers,
    'sharePhoneOnUnlock', p.share_phone_on_unlock,
    'shareEmailOnUnlock', p.share_email_on_unlock,
    'acceptMarketingEmail', p.accept_marketing_email)
    from public.lead_contact_prefs_of(public.current_homatch_user_id()) p
$$;
revoke all on function public.my_lead_contact_preferences() from public, anon;
grant execute on function public.my_lead_contact_preferences() to authenticated;

create or replace function public.set_my_lead_contact_preferences(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_homatch_user_id();
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  insert into public.lead_contact_preferences as l
    (user_id, accept_property_offers, share_phone_on_unlock, share_email_on_unlock, accept_marketing_email, updated_at)
  values (v_me,
          coalesce((p->>'acceptPropertyOffers')::boolean, true),
          coalesce((p->>'sharePhoneOnUnlock')::boolean, false),
          coalesce((p->>'shareEmailOnUnlock')::boolean, false),
          coalesce((p->>'acceptMarketingEmail')::boolean, false),
          now())
  on conflict (user_id) do update set
    accept_property_offers = coalesce((p->>'acceptPropertyOffers')::boolean, l.accept_property_offers),
    share_phone_on_unlock  = coalesce((p->>'sharePhoneOnUnlock')::boolean, l.share_phone_on_unlock),
    share_email_on_unlock  = coalesce((p->>'shareEmailOnUnlock')::boolean, l.share_email_on_unlock),
    accept_marketing_email = coalesce((p->>'acceptMarketingEmail')::boolean, l.accept_marketing_email),
    updated_at = now();
  return public.my_lead_contact_preferences();
end $$;
revoke all on function public.set_my_lead_contact_preferences(jsonb) from public, anon;
grant execute on function public.set_my_lead_contact_preferences(jsonb) to authenticated;

/* ════════════════════════════════════════════════════════════════════════
 * 2 · Standard / Premium — configurable, never a score
 * ════════════════════════════════════════════════════════════════════════ */

/*
 * A lead is PREMIUM when the member's stated budget (the top of their range, in USD at
 * today's rate) reaches the threshold of the most specific active rule for their search:
 * transaction × property type × country × city, NULL meaning "any". No stated budget →
 * STANDARD. Thresholds are owner configuration, not code.
 */
create table if not exists public.internal_lead_premium_rules (
  id                 uuid primary key default gen_random_uuid(),
  transaction_type   text not null check (transaction_type in ('SALE', 'RENT')),
  property_type      text,
  country            text,
  city               text,
  min_budget_usd     numeric not null check (min_budget_usd > 0),
  active             boolean not null default true,
  note               text,
  updated_by         uuid references public.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists internal_lead_premium_rules_scope
  on public.internal_lead_premium_rules (transaction_type, coalesce(property_type, ''),
                                         coalesce(country, ''), coalesce(lower(city), ''))
  where active;
alter table public.internal_lead_premium_rules enable row level security;
revoke all on public.internal_lead_premium_rules from anon, authenticated;

insert into public.internal_lead_premium_rules (transaction_type, country, min_budget_usd, note)
select v.t, 'GE', v.m, 'Initial default — owner adjustable in Admin'
  from (values ('SALE', 250000::numeric), ('RENT', 2000::numeric)) v(t, m)
 where not exists (select 1 from public.internal_lead_premium_rules r
                    where r.transaction_type = v.t and r.property_type is null
                      and r.country = 'GE' and r.city is null);

create or replace function public.internal_lead_segment(p_intent_profile_id uuid)
returns table (segment text, budget_usd numeric, rule_id uuid, threshold_usd numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_ip record;
  v_rule record;
  v_tx text;
  v_usd numeric;
begin
  select * into v_ip from public.intent_profiles where id = p_intent_profile_id;
  if not found then return query select 'STANDARD'::text, null::numeric, null::uuid, null::numeric; return; end if;
  v_tx := case when upper(coalesce(v_ip.transaction_type, '')) in ('RENT', 'LEASE', 'RENTAL') then 'RENT' else 'SALE' end;
  if v_ip.budget_max is not null and v_ip.budget_max > 0 and v_ip.currency is not null then
    begin
      v_usd := public.fx_to_usd(v_ip.budget_max, v_ip.currency, now());
    exception when others then v_usd := null;
    end;
  end if;
  select r.* into v_rule
    from public.internal_lead_premium_rules r
   where r.active and r.transaction_type = v_tx
     and (r.property_type is null or r.property_type = any (coalesce(v_ip.property_types, '{}'::text[])))
     and (r.country is null or upper(r.country) = upper(coalesce(v_ip.country, 'GE')))
     and (r.city is null or lower(r.city) = lower(coalesce(v_ip.city, '')))
   order by (r.city is not null)::int + (r.country is not null)::int + (r.property_type is not null)::int desc,
            r.updated_at desc
   limit 1;
  if v_usd is not null and v_rule.id is not null and v_usd >= v_rule.min_budget_usd then
    return query select 'PREMIUM'::text, round(v_usd), v_rule.id, v_rule.min_budget_usd;
  else
    return query select 'STANDARD'::text, round(v_usd), v_rule.id, v_rule.min_budget_usd;
  end if;
end $$;
revoke all on function public.internal_lead_segment(uuid) from public, anon, authenticated;
grant execute on function public.internal_lead_segment(uuid) to service_role;

/* The two products, priced in the catalogue (10 credits = $1 → 25¢ = 2.5 credits). */
insert into public.billable_products
  (code, name, billing_mode, requires_reservation, standard_retail_cents,
   reference_landed_cogs_cents, min_gross_margin_bps, estimate_strategy,
   enabled, pricing_active, sort_order, config, min_viable_budget_credits)
values
  ('INTERNAL_LEAD_STANDARD', 'HOMATCH Leads — Standard contact unlock', 'FIXED',
   true, 25, 0, 0, 'PER_UNIT', true, true, 90,
   jsonb_build_object('unit', 'INTERNAL_LEAD', 'segment', 'STANDARD'), 0),
  ('INTERNAL_LEAD_PREMIUM', 'HOMATCH Leads — Premium contact unlock', 'FIXED',
   true, 60, 0, 0, 'PER_UNIT', true, true, 91,
   jsonb_build_object('unit', 'INTERNAL_LEAD', 'segment', 'PREMIUM'), 0)
on conflict (code) do nothing;

create or replace function public.internal_lead_prices()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'STANDARD', (select round(p.standard_retail_cents * public.billing_setting_num('credits_per_usd', 10) / 100.0, 2)
                   from public.billable_products p where p.code = 'INTERNAL_LEAD_STANDARD'),
    'PREMIUM',  (select round(p.standard_retail_cents * public.billing_setting_num('credits_per_usd', 10) / 100.0, 2)
                   from public.billable_products p where p.code = 'INTERNAL_LEAD_PREMIUM'),
    'active', coalesce((select bool_and(p.enabled and not p.kill_switch and p.pricing_active)
                          from public.billable_products p
                         where p.code in ('INTERNAL_LEAD_STANDARD', 'INTERNAL_LEAD_PREMIUM')), false))
$$;
revoke all on function public.internal_lead_prices() from public, anon;
grant execute on function public.internal_lead_prices() to authenticated, service_role;

/* ════════════════════════════════════════════════════════════════════════
 * 3 · entitlements, batches, the "seen" watermark
 * ════════════════════════════════════════════════════════════════════════ */

create table if not exists public.internal_lead_unlocks (
  id                  uuid primary key default gen_random_uuid(),
  account_user_id     uuid not null references public.users(id) on delete cascade,
  lead_user_id        uuid not null references public.users(id) on delete cascade,
  first_match_id      uuid,
  first_property_id   uuid references public.properties(id) on delete set null,
  segment             text not null check (segment in ('STANDARD', 'PREMIUM')),
  unit_price_credits  numeric(12,4) not null check (unit_price_credits >= 0),
  credits_charged     numeric(12,4) not null check (credits_charged >= 0),
  reservation_id      uuid references public.usage_reservations(id) on delete set null,
  batch_id            uuid,
  created_at          timestamptz not null default now()
);
-- THE dedupe: one entitlement per account per member, whatever surfaced them.
create unique index if not exists internal_lead_unlocks_account_lead
  on public.internal_lead_unlocks (account_user_id, lead_user_id);
create index if not exists internal_lead_unlocks_lead on public.internal_lead_unlocks (lead_user_id);
alter table public.internal_lead_unlocks enable row level security;
revoke all on public.internal_lead_unlocks from anon, authenticated;

create table if not exists public.internal_lead_unlock_batches (
  id               uuid primary key default gen_random_uuid(),
  account_user_id  uuid not null references public.users(id) on delete cascade,
  idempotency_key  text not null,
  result           jsonb not null,
  created_at       timestamptz not null default now(),
  unique (account_user_id, idempotency_key)
);
alter table public.internal_lead_unlock_batches enable row level security;
revoke all on public.internal_lead_unlock_batches from anon, authenticated;

create table if not exists public.internal_lead_seen (
  account_user_id uuid not null references public.users(id) on delete cascade,
  property_id     uuid not null references public.properties(id) on delete cascade,
  seen_at         timestamptz not null default now(),
  primary key (account_user_id, property_id)
);
alter table public.internal_lead_seen enable row level security;
revoke all on public.internal_lead_seen from anon, authenticated;

/* ════════════════════════════════════════════════════════════════════════
 * 4 · the CRM a seller keeps for unlocked leads
 * ════════════════════════════════════════════════════════════════════════ */

create table if not exists public.lead_crm_entries (
  id                uuid primary key default gen_random_uuid(),
  owner_user_id     uuid not null references public.users(id) on delete cascade,
  lead_user_id      uuid not null references public.users(id) on delete cascade,
  unlock_id         uuid references public.internal_lead_unlocks(id) on delete set null,
  property_id       uuid references public.properties(id) on delete set null,
  status            text not null default 'UNLOCKED' check (status in
                      ('UNLOCKED', 'CONTACTED', 'DELIVERED', 'REPLIED', 'INTERESTED',
                       'VIEWING_SCHEDULED', 'CLOSED', 'NOT_INTERESTED')),
  status_set_by     text not null default 'SYSTEM' check (status_set_by in ('SYSTEM', 'OWNER')),
  follow_up_at      timestamptz,
  follow_up_note    text,
  follow_up_notified_at timestamptz,
  last_activity_at  timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (owner_user_id, lead_user_id)
);
create index if not exists lead_crm_entries_owner_status on public.lead_crm_entries (owner_user_id, status, last_activity_at desc);
create index if not exists lead_crm_entries_follow_up on public.lead_crm_entries (follow_up_at)
  where follow_up_at is not null and follow_up_notified_at is null;
alter table public.lead_crm_entries enable row level security;
revoke all on public.lead_crm_entries from anon, authenticated;

create table if not exists public.lead_crm_notes (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid not null references public.lead_crm_entries(id) on delete cascade,
  body        text not null check (length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index if not exists lead_crm_notes_entry on public.lead_crm_notes (entry_id, created_at desc);
alter table public.lead_crm_notes enable row level security;
revoke all on public.lead_crm_notes from anon, authenticated;

create table if not exists public.lead_crm_events (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid not null references public.lead_crm_entries(id) on delete cascade,
  kind        text not null,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists lead_crm_events_entry on public.lead_crm_events (entry_id, created_at desc);
alter table public.lead_crm_events enable row level security;
revoke all on public.lead_crm_events from anon, authenticated;

/* ════════════════════════════════════════════════════════════════════════
 * 5 · the feed — anonymised, owner-only, paginated server-side
 * ════════════════════════════════════════════════════════════════════════ */

/*
 * The eligible leads for one property: genuine HOMATCH members (demand_user_id is a
 * users row — an external signal never appears here) on an INTERNAL_HOMATCH COMPATIBLE
 * match, whose search is still active, who accept property offers, who are not
 * suspended and have not blocked the owner. One row per member (their best match for
 * this property). Internal helper; the owner check is done by the callers.
 */
create or replace function public.internal_lead_rows(p_owner uuid, p_property_id uuid)
returns table (
  match_id uuid, lead_user_id uuid, intent_profile_id uuid, match_score numeric,
  agreed text[], conflicted text[], unknown_dimensions text[], preference_misses text[],
  matched_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select distinct on (m.demand_user_id)
         m.id, m.demand_user_id, m.intent_profile_id, m.match_score,
         coalesce(m.agreed, '{}'), coalesce(m.conflicted, '{}'),
         coalesce(m.unknown_dimensions, '{}'), coalesce(m.preference_misses, '{}'),
         m.created_at, m.updated_at
    from public.supply_matches m
    join public.users u on u.id = m.demand_user_id and u.suspended_at is null
   where m.property_id = p_property_id
     and m.supply_user_id = p_owner
     and m.source_kind = 'INTERNAL_HOMATCH'
     and m.compatibility = 'COMPATIBLE'
     and m.demand_user_id is not null
     and m.demand_user_id <> p_owner
     and exists (select 1 from public.active_search_subscriptions s
                  where s.user_id = m.demand_user_id and s.intent_id = m.intent_profile_id and s.is_active)
     and (select p.accept_property_offers from public.lead_contact_prefs_of(m.demand_user_id) p)
     and not exists (select 1 from public.conversation_blocks b
                      where (b.blocker_id = m.demand_user_id and b.blocked_id = p_owner)
                         or (b.blocker_id = p_owner and b.blocked_id = m.demand_user_id))
   order by m.demand_user_id, m.match_score desc, m.updated_at desc
$$;
revoke all on function public.internal_lead_rows(uuid, uuid) from public, anon, authenticated;
grant execute on function public.internal_lead_rows(uuid, uuid) to service_role;

/* A stated budget, rounded so the band is useful without being a fingerprint. */
create or replace function public.internal_lead_round_budget(p_amount numeric, p_tx text)
returns numeric language sql immutable as $$
  select case when p_amount is null or p_amount <= 0 then null
              when p_tx = 'RENT' then round(p_amount / 50.0) * 50
              else round(p_amount / 1000.0) * 1000 end
$$;
revoke all on function public.internal_lead_round_budget(numeric, text) from public, anon, authenticated;
grant execute on function public.internal_lead_round_budget(numeric, text) to service_role;

/*
 * internal_leads_feed(property, filter, sort, limit, offset)
 *
 *   filter: ALL | STRONG | POTENTIAL | STANDARD | PREMIUM | FRESH | UNLOCKED | CONTACTED
 *   sort:   BEST | NEWEST | UPDATED | BUDGET_DESC | BUDGET_ASC
 *
 * Returns { total, counts{…}, prices{…}, lastSeenAt, items[…] }. Before an unlock an
 * item carries NO identifier of the member: no name, id, phone, email or free text —
 * only the requirements they stated, the engine's agreement and the channels that would
 * exist after an unlock. matchId is the opaque handle every other call takes.
 */
create or replace function public.internal_leads_feed(
  p_property_id uuid, p_filter text default 'ALL', p_sort text default 'BEST',
  p_limit integer default 24, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_seen timestamptz;
  v_limit integer := greatest(1, least(coalesce(p_limit, 24), 60));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_result jsonb;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from public.properties p where p.id = p_property_id and p.user_id = v_me and not p.is_deleted) then
    raise exception 'not found' using errcode = '42501';
  end if;
  select s.seen_at into v_seen from public.internal_lead_seen s
   where s.account_user_id = v_me and s.property_id = p_property_id;

  with base as (
    select r.*, ip.transaction_type, ip.intent_type::text as intent_type, ip.property_types,
           ip.country, ip.city, ip.district, ip.neighborhoods,
           ip.budget_min, ip.budget_max, ip.currency,
           ip.bedrooms_min, ip.bedrooms_max, ip.rooms_min, ip.rooms_max, ip.area_min, ip.area_max,
           ip.timeline, ip.created_at as demand_at,
           seg.segment, seg.budget_usd,
           case when upper(coalesce(ip.transaction_type, '')) in ('RENT', 'LEASE', 'RENTAL') then 'RENT' else 'SALE' end as tx,
           case when r.match_score >= 0.8 then 'STRONG' when r.match_score >= 0.5 then 'POTENTIAL' else 'WEAK' end as band,
           (u.id is not null) as unlocked,
           u.id as unlock_id,
           c.status as crm_status,
           (c.status is not null and c.status <> 'UNLOCKED') as contacted,
           ((v_seen is null and r.matched_at > now() - interval '7 days') or (v_seen is not null and r.matched_at > v_seen)) as fresh,
           prefs.share_phone_on_unlock, prefs.share_email_on_unlock,
           usr.phone is not null and length(usr.phone) > 4 as has_phone,
           usr.nickname, usr.full_name, usr.preferred_language
      from public.internal_lead_rows(v_me, p_property_id) r
      join public.intent_profiles ip on ip.id = r.intent_profile_id
      join public.users usr on usr.id = r.lead_user_id
      cross join lateral public.internal_lead_segment(r.intent_profile_id) seg
      cross join lateral public.lead_contact_prefs_of(r.lead_user_id) prefs
      left join public.internal_lead_unlocks u on u.account_user_id = v_me and u.lead_user_id = r.lead_user_id
      left join public.lead_crm_entries c on c.owner_user_id = v_me and c.lead_user_id = r.lead_user_id
  ), filtered as (
    select * from base b
     where case upper(coalesce(p_filter, 'ALL'))
             when 'STRONG' then b.band = 'STRONG'
             when 'POTENTIAL' then b.band = 'POTENTIAL'
             when 'STANDARD' then b.segment = 'STANDARD'
             when 'PREMIUM' then b.segment = 'PREMIUM'
             when 'FRESH' then b.fresh
             when 'UNLOCKED' then b.unlocked
             when 'CONTACTED' then b.contacted
             else true end
  ), page as (
    select f.*, row_number() over (order by
       case when upper(coalesce(p_sort, 'BEST')) = 'BEST' then f.match_score end desc nulls last,
       case when upper(p_sort) = 'NEWEST' then f.demand_at end desc nulls last,
       case when upper(p_sort) = 'UPDATED' then f.updated_at end desc nulls last,
       case when upper(p_sort) = 'BUDGET_DESC' then f.budget_usd end desc nulls last,
       case when upper(p_sort) = 'BUDGET_ASC' then f.budget_usd end asc nulls last,
       f.match_score desc, f.match_id) as rn
      from filtered f
     order by
       case when upper(coalesce(p_sort, 'BEST')) = 'BEST' then f.match_score end desc nulls last,
       case when upper(p_sort) = 'NEWEST' then f.demand_at end desc nulls last,
       case when upper(p_sort) = 'UPDATED' then f.updated_at end desc nulls last,
       case when upper(p_sort) = 'BUDGET_DESC' then f.budget_usd end desc nulls last,
       case when upper(p_sort) = 'BUDGET_ASC' then f.budget_usd end asc nulls last,
       f.match_score desc, f.match_id
     limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'counts', (select jsonb_build_object(
        'ALL', count(*),
        'STRONG', count(*) filter (where band = 'STRONG'),
        'POTENTIAL', count(*) filter (where band = 'POTENTIAL'),
        'STANDARD', count(*) filter (where segment = 'STANDARD'),
        'PREMIUM', count(*) filter (where segment = 'PREMIUM'),
        'FRESH', count(*) filter (where fresh),
        'UNLOCKED', count(*) filter (where unlocked),
        'CONTACTED', count(*) filter (where contacted)) from base),
    'prices', public.internal_lead_prices(),
    'lastSeenAt', v_seen,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'matchId', p.match_id,
        'score', round(p.match_score * 100),
        'band', p.band,
        'segment', p.segment,
        'priceCredits', (public.internal_lead_prices() ->> p.segment)::numeric,
        'unlocked', p.unlocked,
        'contacted', p.contacted,
        'crmStatus', p.crm_status,
        'fresh', p.fresh,
        'transaction', p.tx,
        'intentType', p.intent_type,
        'propertyTypes', to_jsonb(coalesce(p.property_types, '{}'::text[])),
        'locations', jsonb_build_object('city', p.city, 'district', p.district,
                                        'neighborhoods', to_jsonb(coalesce(p.neighborhoods, '{}'::text[]))),
        'budget', case when p.budget_min is null and p.budget_max is null then null else jsonb_build_object(
                    'min', public.internal_lead_round_budget(p.budget_min, p.tx),
                    'max', public.internal_lead_round_budget(p.budget_max, p.tx),
                    'currency', p.currency) end,
        'requirements', jsonb_strip_nulls(jsonb_build_object(
                    'bedroomsMin', p.bedrooms_min, 'bedroomsMax', p.bedrooms_max,
                    'roomsMin', p.rooms_min, 'roomsMax', p.rooms_max,
                    'areaMin', p.area_min, 'areaMax', p.area_max)),
        'agreed', to_jsonb(p.agreed),
        'conflicted', to_jsonb(p.conflicted),
        'unknown', to_jsonb(p.unknown_dimensions),
        'demandAt', p.demand_at,
        'matchedAt', p.matched_at,
        'updatedAt', p.updated_at,
        'contactOptions', jsonb_build_object(
            'message', true,
            'phone', p.share_phone_on_unlock and p.has_phone,
            'email', p.share_email_on_unlock),
        -- Only once unlocked: how the member chose to be called. Never before.
        'displayName', case when p.unlocked then coalesce(nullif(p.nickname, ''),
                         nullif(split_part(coalesce(p.full_name, ''), ' ', 1), '')) end,
        'language', case when p.unlocked then p.preferred_language::text end
      ) order by p.rn) from page p), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.internal_leads_feed(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.internal_leads_feed(uuid, text, text, integer, integer) to authenticated;

create or replace function public.internal_leads_mark_seen(p_property_id uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_homatch_user_id(); v_at timestamptz := now();
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from public.properties p where p.id = p_property_id and p.user_id = v_me) then
    raise exception 'not found' using errcode = '42501';
  end if;
  insert into public.internal_lead_seen (account_user_id, property_id, seen_at) values (v_me, p_property_id, v_at)
  on conflict (account_user_id, property_id) do update set seen_at = excluded.seen_at;
  return v_at;
end $$;
revoke all on function public.internal_leads_mark_seen(uuid) from public, anon;
grant execute on function public.internal_leads_mark_seen(uuid) to authenticated;

/* ════════════════════════════════════════════════════════════════════════
 * 6 · quote and unlock
 * ════════════════════════════════════════════════════════════════════════ */

/* What the selection would cost the caller, before anything is charged. */
create or replace function public.internal_leads_unlock_quote_for(p_user_id uuid, p_match_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_prices jsonb := public.internal_lead_prices();
  v_out jsonb;
begin
  with picked as (
    select distinct on (m.demand_user_id) m.id as match_id, m.demand_user_id, m.intent_profile_id, m.property_id
      from public.supply_matches m
     where m.id = any (coalesce(p_match_ids, '{}'::uuid[]))
       and m.supply_user_id = p_user_id
       and m.source_kind = 'INTERNAL_HOMATCH' and m.compatibility = 'COMPATIBLE'
       and exists (select 1 from public.internal_lead_rows(p_user_id, m.property_id) r where r.match_id = m.id)
     order by m.demand_user_id, m.match_score desc
  ), priced as (
    select p.*, seg.segment,
           (exists (select 1 from public.internal_lead_unlocks u
                     where u.account_user_id = p_user_id and u.lead_user_id = p.demand_user_id)) as already
      from picked p cross join lateral public.internal_lead_segment(p.intent_profile_id) seg
  )
  select jsonb_build_object(
    'requested', coalesce(array_length(p_match_ids, 1), 0),
    'eligible', count(*),
    'alreadyUnlocked', count(*) filter (where already),
    'standardCount', count(*) filter (where not already and segment = 'STANDARD'),
    'premiumCount', count(*) filter (where not already and segment = 'PREMIUM'),
    'standardCredits', coalesce(sum((v_prices->>'STANDARD')::numeric) filter (where not already and segment = 'STANDARD'), 0),
    'premiumCredits', coalesce(sum((v_prices->>'PREMIUM')::numeric) filter (where not already and segment = 'PREMIUM'), 0),
    'totalCredits', coalesce(sum((v_prices->>segment)::numeric) filter (where not already), 0),
    'balance', (select ca.balance from public.credit_accounts ca where ca.user_id = p_user_id),
    'prices', v_prices)
    into v_out from priced;
  return v_out;
end $$;
revoke all on function public.internal_leads_unlock_quote_for(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.internal_leads_unlock_quote_for(uuid, uuid[]) to service_role;

create or replace function public.internal_leads_unlock_quote(p_match_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public.current_homatch_user_id();
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  return public.internal_leads_unlock_quote_for(v_me, p_match_ids);
end $$;
revoke all on function public.internal_leads_unlock_quote(uuid[]) from public, anon;
grant execute on function public.internal_leads_unlock_quote(uuid[]) to authenticated;

/*
 * internal_leads_unlock(user, match ids, idempotency key) — service_role (the
 * internal-leads edge function, which authenticates the caller).
 *
 * One transaction, all-or-nothing:
 *   · serialised per account (advisory lock), so parallel clicks cannot both charge;
 *   · a repeated idempotency key returns the stored result and charges nothing;
 *   · members the account already unlocked are excluded from the charge;
 *   · the same member twice in one selection is one unlock;
 *   · one wallet reservation per segment, settled at once for exactly n × unit price;
 *   · INSUFFICIENT_CREDITS (or any failure) rolls the whole selection back.
 */
create or replace function public.internal_leads_unlock(p_user_id uuid, p_match_ids uuid[], p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing jsonb;
  v_prices jsonb;
  v_batch uuid := gen_random_uuid();
  v_seg text;
  v_n integer;
  v_unit numeric;
  v_total numeric;
  v_res uuid;
  v_res_ids jsonb := '{}'::jsonb;
  v_unlocked jsonb := '[]'::jsonb;
  v_already jsonb := '[]'::jsonb;
  v_charged numeric := 0;
  v_balance numeric;
  v_row record;
  v_unlock_id uuid;
  v_result jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_user_id is null then raise exception 'INVALID_ARGUMENT'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if coalesce(array_length(p_match_ids, 1), 0) = 0 then raise exception 'NOTHING_SELECTED'; end if;
  if array_length(p_match_ids, 1) > 200 then raise exception 'TOO_MANY_SELECTED'; end if;

  perform pg_advisory_xact_lock(hashtextextended('internal_lead_unlock:' || p_user_id::text, 0));

  select b.result into v_existing from public.internal_lead_unlock_batches b
   where b.account_user_id = p_user_id and b.idempotency_key = p_idempotency_key;
  if found then return v_existing || jsonb_build_object('duplicate', true); end if;

  v_prices := public.internal_lead_prices();
  if not coalesce((v_prices->>'active')::boolean, false) then raise exception 'PRODUCT_DISABLED'; end if;

  create temporary table if not exists pg_temp.ilu_pick (
    match_id uuid, lead_user_id uuid, intent_profile_id uuid, property_id uuid, segment text, already boolean
  ) on commit drop;
  truncate pg_temp.ilu_pick;

  insert into pg_temp.ilu_pick
  select distinct on (m.demand_user_id) m.id, m.demand_user_id, m.intent_profile_id, m.property_id, null, false
    from public.supply_matches m
   where m.id = any (p_match_ids)
     and m.supply_user_id = p_user_id
     and m.source_kind = 'INTERNAL_HOMATCH' and m.compatibility = 'COMPATIBLE'
     and exists (select 1 from public.internal_lead_rows(p_user_id, m.property_id) r where r.match_id = m.id)
   order by m.demand_user_id, m.match_score desc;

  update pg_temp.ilu_pick p set segment = (select s.segment from public.internal_lead_segment(p.intent_profile_id) s),
                                already = exists (select 1 from public.internal_lead_unlocks u
                                                   where u.account_user_id = p_user_id and u.lead_user_id = p.lead_user_id);

  select coalesce(jsonb_agg(match_id), '[]'::jsonb) into v_already from pg_temp.ilu_pick where already;

  foreach v_seg in array array['STANDARD', 'PREMIUM'] loop
    select count(*) into v_n from pg_temp.ilu_pick where not already and segment = v_seg;
    continue when v_n = 0;
    v_unit := (v_prices->>v_seg)::numeric;
    v_total := round(v_unit * v_n, 4);
    v_res := null;
    if v_total > 0 then
      select r.reservation_id into v_res
        from public.wallet_reserve(p_user_id, 'INTERNAL_LEAD_' || v_seg, v_total,
                                   'internal-leads:' || p_user_id::text || ':' || p_idempotency_key || ':' || v_seg,
                                   v_total, v_total, 'internal-leads:' || v_batch::text,
                                   jsonb_build_object('units', v_n, 'unit_credits', v_unit, 'segment', v_seg,
                                                      'batch_id', v_batch)) r;
      perform public.wallet_settle(v_res, v_total,
                                   jsonb_build_object('units', v_n, 'unit_credits', v_unit,
                                                      'landed_cogs_cents', 0, 'segment', v_seg), 'SUCCESS');
      v_res_ids := v_res_ids || jsonb_build_object(v_seg, v_res);
    end if;
    v_charged := v_charged + v_total;

    for v_row in select * from pg_temp.ilu_pick where not already and segment = v_seg loop
      insert into public.internal_lead_unlocks
        (account_user_id, lead_user_id, first_match_id, first_property_id, segment,
         unit_price_credits, credits_charged, reservation_id, batch_id)
      values (p_user_id, v_row.lead_user_id, v_row.match_id, v_row.property_id, v_seg,
              v_unit, v_unit, v_res, v_batch)
      returning id into v_unlock_id;

      insert into public.lead_crm_entries (owner_user_id, lead_user_id, unlock_id, property_id, status)
      values (p_user_id, v_row.lead_user_id, v_unlock_id, v_row.property_id, 'UNLOCKED')
      on conflict (owner_user_id, lead_user_id) do update
        set unlock_id = coalesce(lead_crm_entries.unlock_id, excluded.unlock_id), updated_at = now();

      insert into public.lead_crm_events (entry_id, kind, detail)
      select e.id, 'UNLOCKED', jsonb_build_object('segment', v_seg, 'credits', v_unit, 'property_id', v_row.property_id)
        from public.lead_crm_entries e where e.owner_user_id = p_user_id and e.lead_user_id = v_row.lead_user_id;

      v_unlocked := v_unlocked || to_jsonb(v_row.match_id);
    end loop;
  end loop;

  select ca.balance into v_balance from public.credit_accounts ca where ca.user_id = p_user_id;

  v_result := jsonb_build_object(
    'batchId', v_batch,
    'unlocked', v_unlocked,
    'alreadyUnlocked', v_already,
    'skipped', (select coalesce(jsonb_agg(x), '[]'::jsonb) from unnest(p_match_ids) x
                 where x not in (select match_id from pg_temp.ilu_pick)),
    'chargedCredits', v_charged,
    'reservations', v_res_ids,
    'balanceAfter', v_balance,
    'duplicate', false);

  insert into public.internal_lead_unlock_batches (id, account_user_id, idempotency_key, result)
  values (v_batch, p_user_id, p_idempotency_key, v_result);
  return v_result;
end $$;
revoke all on function public.internal_leads_unlock(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.internal_leads_unlock(uuid, uuid[], text) to service_role;

/* ════════════════════════════════════════════════════════════════════════
 * 7 · after an unlock: what may be disclosed, and the conversation
 * ════════════════════════════════════════════════════════════════════════ */

/* Resolve a match handle to the lead the CALLER has unlocked; null otherwise. */
create or replace function public.internal_lead_entitled(p_me uuid, p_match_id uuid)
returns table (lead_user_id uuid, property_id uuid, unlock_id uuid)
language sql stable security definer set search_path = public as $$
  select m.demand_user_id, m.property_id, u.id
    from public.supply_matches m
    join public.internal_lead_unlocks u on u.account_user_id = p_me and u.lead_user_id = m.demand_user_id
   where m.id = p_match_id and m.supply_user_id = p_me and m.source_kind = 'INTERNAL_HOMATCH'
$$;
revoke all on function public.internal_lead_entitled(uuid, uuid) from public, anon, authenticated;
grant execute on function public.internal_lead_entitled(uuid, uuid) to service_role;

/*
 * The contact an unlock entitles the caller to — exactly what the member allows today.
 * A withdrawn permission, a block, a suspended or deleted account restricts it again;
 * the entitlement itself is kept (no second charge if access returns).
 */
create or replace function public.internal_lead_contact(p_match_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_ent record;
  v_user record;
  v_prefs record;
  v_blocked boolean;
  v_phone text;
  v_email text;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_ent from public.internal_lead_entitled(v_me, p_match_id);
  if v_ent.lead_user_id is null then raise exception 'not unlocked' using errcode = '42501'; end if;
  select * into v_user from public.users where id = v_ent.lead_user_id;
  if not found or v_user.suspended_at is not null then
    return jsonb_build_object('restricted', true, 'reason', 'UNAVAILABLE');
  end if;
  select * into v_prefs from public.lead_contact_prefs_of(v_ent.lead_user_id);
  select exists (select 1 from public.conversation_blocks b
                  where (b.blocker_id = v_ent.lead_user_id and b.blocked_id = v_me)
                     or (b.blocker_id = v_me and b.blocked_id = v_ent.lead_user_id)) into v_blocked;
  if v_blocked then return jsonb_build_object('restricted', true, 'reason', 'BLOCKED'); end if;
  if not v_prefs.accept_property_offers then
    return jsonb_build_object('restricted', true, 'reason', 'NOT_ACCEPTING_OFFERS');
  end if;
  if v_prefs.share_phone_on_unlock and v_user.phone is not null and length(v_user.phone) > 4 then
    v_phone := v_user.phone;
    insert into public.contact_disclosures (viewer_user_id, subject_user_id, property_id, relationship_kind, relationship_id)
    values (v_me, v_ent.lead_user_id, v_ent.property_id, 'INTERNAL_LEAD_UNLOCK', v_ent.unlock_id);
  end if;
  if v_prefs.share_email_on_unlock then v_email := v_user.email; end if;
  return jsonb_build_object(
    'restricted', false,
    'displayName', coalesce(nullif(v_user.nickname, ''), nullif(split_part(coalesce(v_user.full_name, ''), ' ', 1), '')),
    'language', v_user.preferred_language::text,
    'canMessage', true,
    'phone', v_phone,
    'email', v_email,
    'marketingEmail', v_prefs.accept_marketing_email and v_email is not null);
end $$;
revoke all on function public.internal_lead_contact(uuid) from public, anon;
grant execute on function public.internal_lead_contact(uuid) to authenticated;

/*
 * Open (or return) the property conversation with an unlocked lead. Anti-flood: at most
 * internal_lead_daily_new_conversations NEW lead conversations per owner per 24 hours;
 * an existing conversation always reopens.
 */
create or replace function public.internal_lead_open_conversation(p_match_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_ent record;
  v_existing uuid;
  v_recent integer;
  v_cap integer := coalesce(public.billing_setting_num('internal_lead_daily_new_conversations', 40), 40)::integer;
  v_conversation uuid;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_ent from public.internal_lead_entitled(v_me, p_match_id);
  if v_ent.lead_user_id is null then raise exception 'not unlocked' using errcode = '42501'; end if;
  if exists (select 1 from public.conversation_blocks b
              where (b.blocker_id = v_ent.lead_user_id and b.blocked_id = v_me)
                 or (b.blocker_id = v_me and b.blocked_id = v_ent.lead_user_id)) then
    raise exception 'not available' using errcode = '42501';
  end if;
  if not (select p.accept_property_offers from public.lead_contact_prefs_of(v_ent.lead_user_id) p) then
    raise exception 'not accepting offers' using errcode = '42501';
  end if;

  select c.id into v_existing from public.conversations c
   where least(c.initiator_id, c.recipient_id) = least(v_me, v_ent.lead_user_id)
     and greatest(c.initiator_id, c.recipient_id) = greatest(v_me, v_ent.lead_user_id)
     and coalesce(c.property_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(v_ent.property_id, '00000000-0000-0000-0000-000000000000'::uuid);
  if v_existing is not null then return v_existing; end if;

  select count(*) into v_recent from public.conversations c
    join public.internal_lead_unlocks u on u.account_user_id = v_me and u.lead_user_id = c.recipient_id
   where c.initiator_id = v_me and c.created_at > now() - interval '24 hours';
  if v_recent >= v_cap then raise exception 'RATE_LIMITED' using errcode = 'P0001'; end if;

  v_conversation := public.ensure_conversation(v_me, v_ent.lead_user_id, v_ent.property_id);
  insert into public.lead_crm_events (entry_id, kind, detail)
  select e.id, 'CONVERSATION_OPENED', jsonb_build_object('conversation_id', v_conversation)
    from public.lead_crm_entries e where e.owner_user_id = v_me and e.lead_user_id = v_ent.lead_user_id;
  return v_conversation;
end $$;
revoke all on function public.internal_lead_open_conversation(uuid) from public, anon;
grant execute on function public.internal_lead_open_conversation(uuid) to authenticated;

/*
 * open_native_conversation — the owner side of a MATCH now goes through an unlock.
 * A member who is LOOKING may still open a conversation with the owner of a property
 * that fits (free, as before); an owner opens one with a matched member only after
 * unlocking them, or reopens a conversation that already exists. RELATIONSHIP rows
 * (the member already wrote, asked for a viewing…) are unchanged.
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

  if p_kind = 'MATCH' and v_me = v_supply then
    select c.id into v_conversation from public.conversations c
     where least(c.initiator_id, c.recipient_id) = least(v_me, v_other)
       and greatest(c.initiator_id, c.recipient_id) = greatest(v_me, v_other)
       and coalesce(c.property_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce(v_property, '00000000-0000-0000-0000-000000000000'::uuid);
    if v_conversation is not null then return v_conversation; end if;
    if not exists (select 1 from public.internal_lead_unlocks u
                    where u.account_user_id = v_me and u.lead_user_id = v_other) then
      raise exception 'UNLOCK_REQUIRED' using errcode = '42501';
    end if;
    return public.internal_lead_open_conversation(p_id);
  end if;

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

/* ════════════════════════════════════════════════════════════════════════
 * 8 · CRM — reads and owner actions
 * ════════════════════════════════════════════════════════════════════════ */

create or replace function public.crm_conversation_of(p_owner uuid, p_lead uuid, p_property uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select c.id from public.conversations c
   where least(c.initiator_id, c.recipient_id) = least(p_owner, p_lead)
     and greatest(c.initiator_id, c.recipient_id) = greatest(p_owner, p_lead)
   order by (coalesce(c.property_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = coalesce(p_property, '00000000-0000-0000-0000-000000000000'::uuid)) desc,
            c.last_message_at desc nulls last
   limit 1
$$;
revoke all on function public.crm_conversation_of(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.crm_conversation_of(uuid, uuid, uuid) to service_role;

create or replace function public.crm_list(p_status text default null, p_search text default null,
                                           p_limit integer default 30, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_limit integer := greatest(1, least(coalesce(p_limit, 30), 100));
  v_q text := nullif(trim(coalesce(p_search, '')), '');
  v_out jsonb;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  with rows as (
    select e.*, u.nickname, u.full_name, u.preferred_language,
           pr.title as property_title, pr.homatch_id,
           public.crm_conversation_of(v_me, e.lead_user_id, e.property_id) as conversation_id,
           (select count(*) from public.lead_crm_notes n where n.entry_id = e.id) as note_count
      from public.lead_crm_entries e
      join public.users u on u.id = e.lead_user_id
      left join public.properties pr on pr.id = e.property_id
     where e.owner_user_id = v_me
       and (p_status is null or upper(p_status) = 'ALL' or e.status = upper(p_status))
       and (v_q is null or coalesce(u.nickname, '') ilike '%' || v_q || '%'
                       or coalesce(u.full_name, '') ilike '%' || v_q || '%'
                       or coalesce(pr.title, '') ilike '%' || v_q || '%'
                       or coalesce(pr.homatch_id::text, '') = v_q)
  )
  select jsonb_build_object(
    'total', (select count(*) from rows),
    'counts', (select jsonb_object_agg(s, (select count(*) from public.lead_crm_entries x where x.owner_user_id = v_me and x.status = s))
                 from unnest(array['UNLOCKED','CONTACTED','DELIVERED','REPLIED','INTERESTED','VIEWING_SCHEDULED','CLOSED','NOT_INTERESTED']) s),
    'dueFollowUps', (select count(*) from public.lead_crm_entries x where x.owner_user_id = v_me and x.follow_up_at <= now()),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'entryId', r.id,
        'displayName', coalesce(nullif(r.nickname, ''), nullif(split_part(coalesce(r.full_name, ''), ' ', 1), '')),
        'language', r.preferred_language::text,
        'status', r.status,
        'propertyId', r.property_id,
        'propertyTitle', r.property_title,
        'homatchId', r.homatch_id,
        'conversationId', r.conversation_id,
        'followUpAt', r.follow_up_at,
        'followUpNote', r.follow_up_note,
        'noteCount', r.note_count,
        'lastActivityAt', r.last_activity_at,
        'createdAt', r.created_at) order by r.last_activity_at desc)
        from (select * from rows order by last_activity_at desc limit v_limit offset greatest(0, coalesce(p_offset, 0))) r), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.crm_list(text, text, integer, integer) from public, anon;
grant execute on function public.crm_list(text, text, integer, integer) to authenticated;

create or replace function public.crm_entry_detail(p_entry_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_e record;
  v_conv uuid;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_e from public.lead_crm_entries where id = p_entry_id and owner_user_id = v_me;
  if not found then raise exception 'not found' using errcode = '42501'; end if;
  v_conv := public.crm_conversation_of(v_me, v_e.lead_user_id, v_e.property_id);
  return jsonb_build_object(
    'entryId', v_e.id, 'status', v_e.status, 'followUpAt', v_e.follow_up_at, 'followUpNote', v_e.follow_up_note,
    'propertyId', v_e.property_id, 'conversationId', v_conv,
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'createdAt', n.created_at)
                                        order by n.created_at desc)
                         from public.lead_crm_notes n where n.entry_id = v_e.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', ev.kind, 'detail', ev.detail, 'createdAt', ev.created_at)
                                         order by ev.created_at desc)
                          from (select * from public.lead_crm_events where entry_id = v_e.id
                                 order by created_at desc limit 100) ev), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'mine', m.sender_id = v_me,
                                             'body', left(m.body, 280), 'status', m.status::text, 'createdAt', m.created_at)
                                           order by m.created_at desc)
                            from (select * from public.messages where conversation_id = v_conv
                                   order by created_at desc limit 20) m), '[]'::jsonb));
end $$;
revoke all on function public.crm_entry_detail(uuid) from public, anon;
grant execute on function public.crm_entry_detail(uuid) to authenticated;

create or replace function public.crm_update(p_entry_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_e record;
  v_status text := upper(nullif(p->>'status', ''));
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_e from public.lead_crm_entries where id = p_entry_id and owner_user_id = v_me for update;
  if not found then raise exception 'not found' using errcode = '42501'; end if;

  if v_status is not null and v_status <> v_e.status then
    if v_status not in ('UNLOCKED','CONTACTED','DELIVERED','REPLIED','INTERESTED','VIEWING_SCHEDULED','CLOSED','NOT_INTERESTED') then
      raise exception 'invalid status' using errcode = '22023';
    end if;
    update public.lead_crm_entries set status = v_status, status_set_by = 'OWNER', last_activity_at = now(), updated_at = now()
     where id = p_entry_id;
    insert into public.lead_crm_events (entry_id, kind, detail)
    values (p_entry_id, 'STATUS_CHANGED', jsonb_build_object('from', v_e.status, 'to', v_status, 'by', 'OWNER'));
  end if;

  if p ? 'note' and length(trim(coalesce(p->>'note', ''))) > 0 then
    insert into public.lead_crm_notes (entry_id, body) values (p_entry_id, left(trim(p->>'note'), 4000));
    insert into public.lead_crm_events (entry_id, kind) values (p_entry_id, 'NOTE_ADDED');
    update public.lead_crm_entries set last_activity_at = now(), updated_at = now() where id = p_entry_id;
  end if;

  if p ? 'followUpAt' then
    update public.lead_crm_entries
       set follow_up_at = nullif(p->>'followUpAt', '')::timestamptz,
           follow_up_note = left(nullif(trim(coalesce(p->>'followUpNote', '')), ''), 500),
           follow_up_notified_at = null, updated_at = now()
     where id = p_entry_id;
    insert into public.lead_crm_events (entry_id, kind, detail)
    values (p_entry_id, case when nullif(p->>'followUpAt', '') is null then 'FOLLOW_UP_CLEARED' else 'FOLLOW_UP_SCHEDULED' end,
            jsonb_build_object('at', nullif(p->>'followUpAt', '')));
  end if;
  return public.crm_entry_detail(p_entry_id);
end $$;
revoke all on function public.crm_update(uuid, jsonb) from public, anon;
grant execute on function public.crm_update(uuid, jsonb) to authenticated;

/*
 * Message activity moves the CRM status forward — never backwards, and never past what
 * the facts show: an owner's message is CONTACTED, its delivery DELIVERED, the member's
 * reply REPLIED. Interest is the owner's call (crm_update), never inferred.
 */
create or replace function public.lead_crm_on_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_conv record;
  v_e record;
  v_rank_old integer;
  v_target text;
  v_rank_new integer;
begin
  select * into v_conv from public.conversations where id = new.conversation_id;
  if not found then return new; end if;
  select * into v_e from public.lead_crm_entries e
   where (e.owner_user_id = v_conv.initiator_id and e.lead_user_id = v_conv.recipient_id)
      or (e.owner_user_id = v_conv.recipient_id and e.lead_user_id = v_conv.initiator_id)
   limit 1;
  if not found then return new; end if;

  if tg_op = 'INSERT' then
    v_target := case when new.sender_id = v_e.owner_user_id then 'CONTACTED' else 'REPLIED' end;
  elsif new.sender_id = v_e.owner_user_id and new.status::text in ('DELIVERED', 'SEEN') then
    v_target := 'DELIVERED';
  else
    return new;
  end if;

  v_rank_old := array_position(array['UNLOCKED','CONTACTED','DELIVERED','REPLIED'], v_e.status);
  v_rank_new := array_position(array['UNLOCKED','CONTACTED','DELIVERED','REPLIED'], v_target);
  if v_rank_old is not null and v_rank_new > v_rank_old then
    update public.lead_crm_entries set status = v_target, status_set_by = 'SYSTEM', last_activity_at = now(), updated_at = now()
     where id = v_e.id;
    insert into public.lead_crm_events (entry_id, kind, detail)
    values (v_e.id, 'STATUS_CHANGED', jsonb_build_object('from', v_e.status, 'to', v_target, 'by', 'SYSTEM', 'message_id', new.id));
  else
    update public.lead_crm_entries set last_activity_at = now(), updated_at = now() where id = v_e.id;
  end if;
  return new;
end $$;
revoke all on function public.lead_crm_on_message() from public, anon, authenticated;

drop trigger if exists lead_crm_on_message_insert on public.messages;
create trigger lead_crm_on_message_insert after insert on public.messages
  for each row execute function public.lead_crm_on_message();
drop trigger if exists lead_crm_on_message_status on public.messages;
create trigger lead_crm_on_message_status after update of status on public.messages
  for each row when (old.status is distinct from new.status) execute function public.lead_crm_on_message();

/* Due follow-ups become one in-app reminder each (called by the cron below). */
create or replace function public.crm_emit_due_follow_ups(p_limit integer default 200)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer := 0; v_e record;
begin
  for v_e in
    select * from public.lead_crm_entries
     where follow_up_at is not null and follow_up_at <= now() and follow_up_notified_at is null
     order by follow_up_at limit greatest(1, least(coalesce(p_limit, 200), 1000))
     for update skip locked
  loop
    insert into public.notifications (user_id, type, title, body, priority, deep_link, entity_type, entity_id, dedupe_key, metadata)
    values (v_e.owner_user_id, 'PROPERTY_ACTION_REQUIRED', 'Follow-up due',
            coalesce(v_e.follow_up_note, 'A follow-up you scheduled is due.'), 'NORMAL',
            '/leads?entry=' || v_e.id, 'lead_crm_entry', v_e.id,
            'crm-follow-up:' || v_e.id || ':' || extract(epoch from v_e.follow_up_at)::bigint,
            jsonb_build_object('kind', 'CRM_FOLLOW_UP_DUE'))
    on conflict do nothing;
    update public.lead_crm_entries set follow_up_notified_at = now() where id = v_e.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.crm_emit_due_follow_ups(integer) from public, anon, authenticated;
grant execute on function public.crm_emit_due_follow_ups(integer) to service_role;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'homatch-crm-follow-ups';
    perform cron.schedule('homatch-crm-follow-ups', '*/10 * * * *', $c$ select public.crm_emit_due_follow_ups(); $c$);
  end if;
end $$;

/* ════════════════════════════════════════════════════════════════════════
 * 9 · fresh matching — a listing change wakes the matcher
 * ════════════════════════════════════════════════════════════════════════ */

/*
 * The native matcher was demand-woken only (a search change), so a new or edited
 * listing waited for the 15-minute sweep, and a sweep only reaches the newest demand.
 * A matching-relevant change to a listing now queues the property; supply-matching
 * drains the queue (propertyIds mode) and evaluates that property against the whole
 * eligible demand set, incrementally.
 */
create table if not exists public.native_match_property_queue (
  property_id  uuid primary key references public.properties(id) on delete cascade,
  reason       text not null default 'CHANGED',
  enqueued_at  timestamptz not null default now()
);
alter table public.native_match_property_queue enable row level security;
revoke all on public.native_match_property_queue from anon, authenticated;

create or replace function public.native_match_enqueue_property()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := case when tg_table_name = 'properties' then new.id else (to_jsonb(new)->>'property_id')::uuid end;
  if v_pid is null then return new; end if;
  insert into public.native_match_property_queue (property_id, reason, enqueued_at)
  values (v_pid, upper(tg_table_name) || '_' || tg_op, now())
  on conflict (property_id) do update set reason = excluded.reason, enqueued_at = excluded.enqueued_at;
  return new;
end $$;
revoke all on function public.native_match_enqueue_property() from public, anon, authenticated;

drop trigger if exists native_match_enqueue_property_row on public.properties;
create trigger native_match_enqueue_property_row
  after insert or update of matching_status, transaction_type, property_type, is_deleted, archived_at
  on public.properties for each row execute function public.native_match_enqueue_property();

drop trigger if exists native_match_enqueue_property_facts on public.property_facts;
create trigger native_match_enqueue_property_facts
  after insert or update of total_price, currency, city, district, area, rooms, bedrooms
  on public.property_facts for each row execute function public.native_match_enqueue_property();

/* Claim up to n queued properties (oldest first) for one matcher run. */
create or replace function public.native_match_claim_properties(p_limit integer default 25)
returns uuid[] language plpgsql security definer set search_path = public as $$
declare v_ids uuid[];
begin
  with picked as (
    select property_id from public.native_match_property_queue
     order by enqueued_at limit greatest(1, least(coalesce(p_limit, 25), 200))
     for update skip locked
  ), gone as (
    delete from public.native_match_property_queue q using picked
     where q.property_id = picked.property_id returning q.property_id
  )
  select coalesce(array_agg(property_id), '{}') into v_ids from gone;
  return v_ids;
end $$;
revoke all on function public.native_match_claim_properties(integer) from public, anon, authenticated;
grant execute on function public.native_match_claim_properties(integer) to service_role;

/* Drain the queue every two minutes: a listing change reaches matching demand promptly. */
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') and exists (select 1 from pg_namespace where nspname = 'net') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'homatch-native-property-queue';
    perform cron.schedule(
      'homatch-native-property-queue',
      '*/2 * * * *',
      $cron$
      select net.http_post(
        url := 'https://ptxajsjhobhvsfhmutjn.supabase.co/functions/v1/supply-matching',
        headers := jsonb_build_object('Content-Type', 'application/json',
          'x-cron-token', (select value #>> '{}' from public.admin_settings where key = 'supply_matching_token')),
        body := '{"drainPropertyQueue":true}'::jsonb,
        timeout_milliseconds := 60000
      )
      where exists (select 1 from public.native_match_property_queue);
      $cron$
    );
  end if;
end $$;

/* A campaign launch (or the owner opening HOMATCH Leads) asks for a full re-evaluation. */
create or replace function public.internal_leads_request_matching(p_property_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_homatch_user_id();
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from public.properties p where p.id = p_property_id and p.user_id = v_me and not p.is_deleted) then
    raise exception 'not found' using errcode = '42501';
  end if;
  insert into public.native_match_property_queue (property_id, reason, enqueued_at)
  values (p_property_id, 'OWNER_REQUEST', now())
  on conflict (property_id) do update set reason = excluded.reason, enqueued_at = excluded.enqueued_at;
  return true;
end $$;
revoke all on function public.internal_leads_request_matching(uuid) from public, anon;
grant execute on function public.internal_leads_request_matching(uuid) to authenticated;

/* ════════════════════════════════════════════════════════════════════════
 * 10 · admin — segment rules and the marketplace ledger, read and edit
 * ════════════════════════════════════════════════════════════════════════ */

create or replace function public.admin_internal_leads_overview(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return jsonb_build_object(
    'prices', public.internal_lead_prices(),
    'rules', coalesce((select jsonb_agg(to_jsonb(r) order by r.transaction_type, r.updated_at desc)
                         from public.internal_lead_premium_rules r), '[]'::jsonb),
    'unlocks', (select jsonb_build_object(
                  'standard', count(*) filter (where segment = 'STANDARD'),
                  'premium', count(*) filter (where segment = 'PREMIUM'),
                  'standardCredits', coalesce(sum(credits_charged) filter (where segment = 'STANDARD'), 0),
                  'premiumCredits', coalesce(sum(credits_charged) filter (where segment = 'PREMIUM'), 0),
                  'accounts', count(distinct account_user_id),
                  'leads', count(distinct lead_user_id))
                  from public.internal_lead_unlocks
                 where created_at > now() - make_interval(days => greatest(1, coalesce(p_days, 30)))),
    'crm', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
              from (select status, count(*) n from public.lead_crm_entries group by status) s));
end $$;
revoke all on function public.admin_internal_leads_overview(integer) from public, anon;
grant execute on function public.admin_internal_leads_overview(integer) to authenticated;

create or replace function public.admin_internal_lead_rule_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_admin uuid := public.current_homatch_user_id();
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if (p->>'transactionType') not in ('SALE', 'RENT') then raise exception 'invalid transaction' using errcode = '22023'; end if;
  if coalesce((p->>'minBudgetUsd')::numeric, 0) <= 0 then raise exception 'invalid threshold' using errcode = '22023'; end if;
  if nullif(p->>'id', '') is not null then
    update public.internal_lead_premium_rules
       set min_budget_usd = (p->>'minBudgetUsd')::numeric,
           active = coalesce((p->>'active')::boolean, active),
           note = coalesce(p->>'note', note), updated_by = v_admin, updated_at = now()
     where id = (p->>'id')::uuid returning id into v_id;
  else
    update public.internal_lead_premium_rules set active = false, updated_at = now()
     where active and transaction_type = p->>'transactionType'
       and coalesce(property_type, '') = coalesce(nullif(p->>'propertyType', ''), '')
       and coalesce(country, '') = coalesce(nullif(p->>'country', ''), '')
       and coalesce(lower(city), '') = coalesce(lower(nullif(p->>'city', '')), '');
    insert into public.internal_lead_premium_rules (transaction_type, property_type, country, city, min_budget_usd, note, updated_by)
    values (p->>'transactionType', nullif(p->>'propertyType', ''), nullif(p->>'country', ''), nullif(p->>'city', ''),
            (p->>'minBudgetUsd')::numeric, p->>'note', v_admin)
    returning id into v_id;
  end if;
  return jsonb_build_object('id', v_id);
end $$;
revoke all on function public.admin_internal_lead_rule_save(jsonb) from public, anon;
grant execute on function public.admin_internal_lead_rule_save(jsonb) to authenticated;
