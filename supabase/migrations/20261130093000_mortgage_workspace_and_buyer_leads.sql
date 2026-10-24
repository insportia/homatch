-- HOMI workstream · Mortgage workspace and mortgage-origin buyer leads.
--
-- 1 · mortgage_scenarios.engine_version: which payment engine produced a
--     saved result, so an old snapshot is never silently re-read as new.
--
-- 2 · MORTGAGE BUYER INTENT, BY EXPLICIT CONSENT ONLY.
--     A mortgage calculation is not permission to sell anybody. A person who
--     ticks nothing shares nothing. A person who opts in shares exactly the
--     fields on the opt-in form (area, property type, a budget range they
--     confirmed, rooms, timeframe, which contact channels) and nothing from
--     mortgage_scenarios: no income, debts, credit history, employer, bank,
--     guarantor or co-borrower data. This table never reads the mortgage
--     tables, which keeps the buyer-intelligence rule ("NEVER READ:
--     mortgage_scenarios") intact: the opt-in is a statement the person made,
--     not an inference from their finances.
--
--     One row per HOMATCH account (users.id is the canonical buyer identity,
--     the same identity the internal lead marketplace already uses). Recalculating
--     updates that row; it never creates a second buyer.
--
-- 3 · UNLOCK: 30 US cents per buyer (MORTGAGE_BUYER_LEAD), at the platform's
--     1 credit = 10 cents, i.e. 3 credits. The entitlement is written to the
--     EXISTING internal_lead_unlocks table, whose unique (account_user_id,
--     lead_user_id) is the dedupe for every member-origin lead: a buyer this
--     account already unlocked by any route is never charged again, and the
--     unlock RPC takes the same per-account advisory lock as the internal
--     unlock so the two paths cannot race. Other lead products and prices are
--     untouched.
--
-- Additive and idempotent. No existing row is changed except the internal
-- lead segment check, which gains one allowed value.

/* ════════════════════════════════════════════════════════════════════════
 * 1 · saved scenario engine version
 * ════════════════════════════════════════════════════════════════════════ */

alter table public.mortgage_scenarios
  add column if not exists engine_version text not null default 'mortgage-engine-1';

/* ════════════════════════════════════════════════════════════════════════
 * 2 · consented buyer intent
 * ════════════════════════════════════════════════════════════════════════ */

create table if not exists public.mortgage_buyer_intents (
  user_id          uuid primary key references public.users(id) on delete cascade,
  -- Opaque handle shown to sellers before unlock; rotated on withdrawal so an
  -- old preview can never be followed back to the person.
  public_ref       uuid not null default gen_random_uuid() unique,
  status           text not null check (status in ('ACTIVE', 'WITHDRAWN')),
  consent_version  text not null,
  consented_at     timestamptz not null,
  withdrawn_at     timestamptz,
  city             text check (city is null or length(city) <= 80),
  district         text check (district is null or length(district) <= 80),
  property_types   text[] not null default '{}',
  rooms_min        integer check (rooms_min is null or rooms_min between 1 and 20),
  budget_min       numeric(14,2) check (budget_min is null or budget_min >= 0),
  budget_max       numeric(14,2) check (budget_max is null or budget_max >= 0),
  currency         text check (currency is null or currency ~ '^[A-Z]{3}$'),
  timeframe        text check (timeframe is null or timeframe in ('NOW', 'MONTHS_3', 'MONTHS_6', 'LATER')),
  property_id      uuid references public.properties(id) on delete set null,
  share_phone      boolean not null default false,
  share_email      boolean not null default false,
  signal_count     integer not null default 1 check (signal_count >= 1),
  first_signal_at  timestamptz not null default now(),
  last_signal_at   timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (budget_min is null or budget_max is null or budget_min <= budget_max)
);
create index if not exists mortgage_buyer_intents_active
  on public.mortgage_buyer_intents (lower(city), last_signal_at desc) where status = 'ACTIVE';
alter table public.mortgage_buyer_intents enable row level security;
revoke all on public.mortgage_buyer_intents from anon, authenticated;
drop policy if exists mortgage_buyer_intents_own_read on public.mortgage_buyer_intents;
create policy mortgage_buyer_intents_own_read on public.mortgage_buyer_intents
  for select using (user_id = public.current_homatch_user_id());
grant select on public.mortgage_buyer_intents to authenticated;

-- Every grant, change and withdrawal, for the record a data-protection request needs.
create table if not exists public.mortgage_buyer_consent_events (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id) on delete cascade,
  action           text not null check (action in ('GRANTED', 'UPDATED', 'WITHDRAWN')),
  consent_version  text not null,
  shared           jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists mortgage_buyer_consent_events_user on public.mortgage_buyer_consent_events (user_id, created_at desc);
alter table public.mortgage_buyer_consent_events enable row level security;
revoke all on public.mortgage_buyer_consent_events from anon, authenticated;

create or replace function public.my_mortgage_buyer_intent()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when i.user_id is null then null else jsonb_build_object(
    'status', i.status, 'consentedAt', i.consented_at, 'withdrawnAt', i.withdrawn_at,
    'city', i.city, 'district', i.district, 'propertyTypes', to_jsonb(i.property_types),
    'roomsMin', i.rooms_min, 'budgetMin', i.budget_min, 'budgetMax', i.budget_max, 'currency', i.currency,
    'timeframe', i.timeframe, 'propertyId', i.property_id,
    'sharePhone', i.share_phone, 'shareEmail', i.share_email, 'lastSignalAt', i.last_signal_at) end
    from (select 1) one
    left join public.mortgage_buyer_intents i on i.user_id = public.current_homatch_user_id()
$$;
revoke all on function public.my_mortgage_buyer_intent() from public, anon;
grant execute on function public.my_mortgage_buyer_intent() to authenticated;

/* Opt in, or refresh the stated preferences. Only the listed keys are read. */
create or replace function public.set_my_mortgage_buyer_intent(p jsonb, p_consent_version text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_prev public.mortgage_buyer_intents;
  v_types text[];
  v_shared jsonb;
  v_property uuid;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_consent_version is null or length(p_consent_version) not between 3 and 40 then raise exception 'CONSENT_VERSION_REQUIRED'; end if;
  if not coalesce((p->>'sharePhone')::boolean, false) and not coalesce((p->>'shareEmail')::boolean, false) then
    raise exception 'CHANNEL_REQUIRED';
  end if;
  v_types := coalesce((select array_agg(distinct upper(btrim(x))) from jsonb_array_elements_text(
               case when jsonb_typeof(p->'propertyTypes') = 'array' then p->'propertyTypes' else '[]'::jsonb end) x
             where upper(btrim(x)) in ('APARTMENT','HOUSE','VILLA','COMMERCIAL','LAND','OFFICE','PENTHOUSE','STUDIO','TOWNHOUSE','OTHER')), '{}');
  -- A property reference is kept only if it is a live listing: never a way to probe ids.
  select pr.id into v_property from public.properties pr
   where pr.id = nullif(p->>'propertyId', '')::uuid and not pr.is_deleted;
  select * into v_prev from public.mortgage_buyer_intents where user_id = v_me for update;

  insert into public.mortgage_buyer_intents as i
    (user_id, status, consent_version, consented_at, withdrawn_at, city, district, property_types, rooms_min,
     budget_min, budget_max, currency, timeframe, property_id, share_phone, share_email,
     signal_count, first_signal_at, last_signal_at, updated_at)
  values
    (v_me, 'ACTIVE', p_consent_version, now(), null,
     nullif(left(btrim(coalesce(p->>'city', '')), 80), ''), nullif(left(btrim(coalesce(p->>'district', '')), 80), ''),
     v_types, nullif(p->>'roomsMin', '')::integer,
     round(nullif(p->>'budgetMin', '')::numeric, -3), round(nullif(p->>'budgetMax', '')::numeric, -3),
     nullif(upper(p->>'currency'), ''), nullif(p->>'timeframe', ''), v_property,
     coalesce((p->>'sharePhone')::boolean, false), coalesce((p->>'shareEmail')::boolean, false),
     1, now(), now(), now())
  on conflict (user_id) do update set
    status = 'ACTIVE',
    consent_version = excluded.consent_version,
    consented_at = case when i.status = 'ACTIVE' then i.consented_at else now() end,
    withdrawn_at = null,
    city = excluded.city, district = excluded.district, property_types = excluded.property_types,
    rooms_min = excluded.rooms_min, budget_min = excluded.budget_min, budget_max = excluded.budget_max,
    currency = excluded.currency, timeframe = excluded.timeframe,
    property_id = coalesce(excluded.property_id, i.property_id),
    share_phone = excluded.share_phone, share_email = excluded.share_email,
    signal_count = i.signal_count + 1, last_signal_at = now(), updated_at = now();

  select jsonb_build_object('city', city, 'district', district, 'propertyTypes', to_jsonb(property_types),
           'roomsMin', rooms_min, 'budgetMin', budget_min, 'budgetMax', budget_max, 'currency', currency,
           'timeframe', timeframe, 'propertyId', property_id, 'sharePhone', share_phone, 'shareEmail', share_email)
    into v_shared from public.mortgage_buyer_intents where user_id = v_me;
  insert into public.mortgage_buyer_consent_events (user_id, action, consent_version, shared)
  values (v_me, case when v_prev.user_id is null or v_prev.status = 'WITHDRAWN' then 'GRANTED' else 'UPDATED' end,
          p_consent_version, v_shared);
  return public.my_mortgage_buyer_intent();
end $$;
revoke all on function public.set_my_mortgage_buyer_intent(jsonb, text) from public, anon;
grant execute on function public.set_my_mortgage_buyer_intent(jsonb, text) to authenticated;

/* Withdraw: no new exposure, no new unlocks, and contact reads stop. */
create or replace function public.withdraw_my_mortgage_buyer_intent()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_homatch_user_id(); v_version text;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  update public.mortgage_buyer_intents
     set status = 'WITHDRAWN', withdrawn_at = now(), public_ref = gen_random_uuid(),
         share_phone = false, share_email = false, updated_at = now()
   where user_id = v_me and status = 'ACTIVE'
  returning consent_version into v_version;
  if found then
    insert into public.mortgage_buyer_consent_events (user_id, action, consent_version) values (v_me, 'WITHDRAWN', v_version);
  end if;
  return public.my_mortgage_buyer_intent();
end $$;
revoke all on function public.withdraw_my_mortgage_buyer_intent() from public, anon;
grant execute on function public.withdraw_my_mortgage_buyer_intent() to authenticated;

/* ════════════════════════════════════════════════════════════════════════
 * 3 · price, entitlement, feed, unlock, contact
 * ════════════════════════════════════════════════════════════════════════ */

insert into public.billable_products
  (code, name, billing_mode, requires_reservation, standard_retail_cents,
   reference_landed_cogs_cents, min_gross_margin_bps, estimate_strategy,
   enabled, pricing_active, sort_order, config, min_viable_budget_credits)
values
  ('MORTGAGE_BUYER_LEAD', 'HOMATCH Leads — Mortgage-interested buyer contact unlock', 'FIXED',
   true, 30, 0, 0, 'PER_UNIT', true, true, 95,
   jsonb_build_object('unit', 'INTERNAL_LEAD', 'segment', 'MORTGAGE'), 0)
on conflict (code) do nothing;

alter table public.internal_lead_unlocks drop constraint if exists internal_lead_unlocks_segment_check;
alter table public.internal_lead_unlocks add constraint internal_lead_unlocks_segment_check
  check (segment in ('STANDARD', 'EXACT', 'PREMIUM', 'MORTGAGE'));

create table if not exists public.mortgage_lead_unlock_batches (
  id               uuid primary key default gen_random_uuid(),
  account_user_id  uuid not null references public.users(id) on delete cascade,
  idempotency_key  text not null check (length(idempotency_key) between 8 and 200),
  result           jsonb not null,
  created_at       timestamptz not null default now(),
  unique (account_user_id, idempotency_key)
);
alter table public.mortgage_lead_unlock_batches enable row level security;
revoke all on public.mortgage_lead_unlock_batches from anon, authenticated;

create or replace function public.mortgage_lead_price()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'credits', round(p.standard_retail_cents * public.billing_setting_num('credits_per_usd', 10) / 100.0, 2),
    'cents', p.standard_retail_cents,
    'active', p.enabled and not p.kill_switch and p.pricing_active)
    from public.billable_products p where p.code = 'MORTGAGE_BUYER_LEAD'
$$;
revoke all on function public.mortgage_lead_price() from public, anon;
grant execute on function public.mortgage_lead_price() to authenticated, service_role;

/* The buyers that fit one listing. Internal helper: callers check ownership. */
create or replace function public.mortgage_lead_rows(p_owner uuid, p_property_id uuid)
returns table (lead_user_id uuid, public_ref uuid, property_specific boolean, budget_fit text,
               city text, district text, property_types text[], rooms_min integer,
               budget_min numeric, budget_max numeric, currency text, timeframe text,
               signal_count integer, last_signal_at timestamptz, preferred_language text)
language sql stable security definer set search_path = public as $$
  with prop as (
    select pr.id, pr.property_type::text as ptype, f.city, f.district, f.total_price, upper(f.currency) as currency
      from public.properties pr left join public.property_facts f on f.property_id = pr.id
     where pr.id = p_property_id
  )
  select i.user_id, i.public_ref, (i.property_id = prop.id),
         case when i.budget_max is null or prop.total_price is null then 'UNKNOWN'
              when i.currency is distinct from prop.currency then 'UNKNOWN'
              when prop.total_price <= i.budget_max then 'WITHIN'
              else 'STRETCH' end,
         i.city, i.district, i.property_types, i.rooms_min,
         i.budget_min, i.budget_max, i.currency, i.timeframe, i.signal_count, i.last_signal_at,
         u.preferred_language::text
    from prop
    join public.mortgage_buyer_intents i on i.status = 'ACTIVE'
    join public.users u on u.id = i.user_id and u.suspended_at is null
   where i.user_id <> p_owner
     and i.last_signal_at > now() - interval '180 days'
     and (select pr2.accept_property_offers from public.lead_contact_prefs_of(i.user_id) pr2)
     and not exists (select 1 from public.conversation_blocks b
                      where (b.blocker_id = i.user_id and b.blocked_id = p_owner)
                         or (b.blocker_id = p_owner and b.blocked_id = i.user_id))
     and (i.property_id = prop.id
          or (i.city is not null and prop.city is not null and lower(i.city) = lower(prop.city)
              and (cardinality(i.property_types) = 0 or prop.ptype = any (i.property_types))
              and (i.budget_max is null or prop.total_price is null or i.currency is distinct from prop.currency
                   or prop.total_price <= i.budget_max * 1.15)
              and (i.budget_min is null or prop.total_price is null or i.currency is distinct from prop.currency
                   or prop.total_price >= i.budget_min * 0.7)))
$$;
revoke all on function public.mortgage_lead_rows(uuid, uuid) from public, anon, authenticated;

/* Preview for the listing owner: what the buyer said they want, never who they are or what they earn. */
create or replace function public.mortgage_buyer_leads_feed(p_property_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_price jsonb := public.mortgage_lead_price();
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from public.properties pr where pr.id = p_property_id and pr.user_id = v_me and not pr.is_deleted) then
    raise exception 'not found' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'price', v_price,
    'disabled', public.matching_maintenance_on() or not public.matching_service_on('internal_matching'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ref', r.public_ref,
        'unlocked', u.id is not null,
        'propertySpecific', r.property_specific,
        'budgetFit', r.budget_fit,
        'city', r.city, 'district', r.district,
        'propertyTypes', to_jsonb(r.property_types), 'roomsMin', r.rooms_min,
        'budgetMin', r.budget_min, 'budgetMax', r.budget_max, 'currency', r.currency,
        'timeframe', r.timeframe,
        'research', case when r.signal_count >= 3 then 'REPEATED' else 'SINGLE' end,
        'freshness', case when r.last_signal_at > now() - interval '14 days' then 'RECENT'
                          when r.last_signal_at > now() - interval '60 days' then 'EARLIER' else 'OLDER' end,
        'activeMonth', to_char(date_trunc('month', r.last_signal_at), 'YYYY-MM'),
        'language', case when u.id is not null then r.preferred_language end)
        order by r.property_specific desc, (u.id is not null), r.last_signal_at desc)
        from public.mortgage_lead_rows(v_me, p_property_id) r
        left join public.internal_lead_unlocks u on u.account_user_id = v_me and u.lead_user_id = r.lead_user_id
       where not (public.matching_maintenance_on() or not public.matching_service_on('internal_matching')) or u.id is not null
    ), '[]'::jsonb));
end $$;
revoke all on function public.mortgage_buyer_leads_feed(uuid) from public, anon;
grant execute on function public.mortgage_buyer_leads_feed(uuid) to authenticated;

/*
 * Unlock, exactly once per (purchasing account, buyer):
 *   · service role only (called by atomic-unlock after auth);
 *   · the SAME advisory lock as internal_leads_unlock, so concurrent clicks on
 *     either path serialise;
 *   · a repeated idempotency key returns the stored result and charges nothing;
 *   · a buyer already in internal_lead_unlocks for this account, by any route,
 *     is reported as already unlocked and not charged;
 *   · the charge is n × the current price and refused if it exceeds what the
 *     person confirmed (PRICE_CHANGED);
 *   · any failure (INSUFFICIENT_CREDITS) rolls the whole selection back.
 */
create or replace function public.mortgage_leads_unlock(p_user_id uuid, p_property_id uuid, p_refs uuid[],
                                                        p_idempotency_key text, p_expected_credits numeric)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing jsonb;
  v_price jsonb;
  v_unit numeric;
  v_batch uuid := gen_random_uuid();
  v_n integer;
  v_total numeric;
  v_res uuid;
  v_unlocked jsonb := '[]'::jsonb;
  v_already jsonb := '[]'::jsonb;
  v_granted integer;
  v_balance numeric;
  v_result jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_user_id is null or p_property_id is null then raise exception 'INVALID_ARGUMENT'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if coalesce(array_length(p_refs, 1), 0) = 0 then raise exception 'NOTHING_SELECTED'; end if;
  if array_length(p_refs, 1) > 100 then raise exception 'TOO_MANY_SELECTED'; end if;

  perform pg_advisory_xact_lock(hashtextextended('internal_lead_unlock:' || p_user_id::text, 0));

  select b.result into v_existing from public.mortgage_lead_unlock_batches b
   where b.account_user_id = p_user_id and b.idempotency_key = p_idempotency_key;
  if found then return v_existing || jsonb_build_object('duplicate', true); end if;

  if not exists (select 1 from public.properties pr where pr.id = p_property_id and pr.user_id = p_user_id and not pr.is_deleted) then
    raise exception 'NOT_FOUND';
  end if;
  v_price := public.mortgage_lead_price();
  if v_price is null or not coalesce((v_price->>'active')::boolean, false) then raise exception 'PRODUCT_DISABLED'; end if;
  v_unit := (v_price->>'credits')::numeric;

  create temporary table if not exists pg_temp.mlu_pick (ref uuid, lead_user_id uuid, already boolean) on commit drop;
  truncate pg_temp.mlu_pick;
  insert into pg_temp.mlu_pick
  select distinct on (r.lead_user_id) r.public_ref, r.lead_user_id,
         exists (select 1 from public.internal_lead_unlocks u where u.account_user_id = p_user_id and u.lead_user_id = r.lead_user_id)
    from public.mortgage_lead_rows(p_user_id, p_property_id) r
   where r.public_ref = any (p_refs);

  select coalesce(jsonb_agg(ref), '[]'::jsonb) into v_already from pg_temp.mlu_pick where already;
  select count(*) into v_n from pg_temp.mlu_pick where not already;
  v_total := round(v_unit * v_n, 4);
  if p_expected_credits is null or v_total > p_expected_credits then raise exception 'PRICE_CHANGED'; end if;

  if v_total > 0 then
    select r.reservation_id into v_res
      from public.wallet_reserve(p_user_id, 'MORTGAGE_BUYER_LEAD', v_total,
                                 'mortgage-leads:' || p_user_id::text || ':' || p_idempotency_key,
                                 v_total, v_total, 'mortgage-leads:' || v_batch::text,
                                 jsonb_build_object('units', v_n, 'unit_credits', v_unit, 'segment', 'MORTGAGE',
                                                    'batch_id', v_batch)) r;
    perform public.wallet_settle(v_res, v_total,
                                 jsonb_build_object('units', v_n, 'unit_credits', v_unit,
                                                    'landed_cogs_cents', 0, 'segment', 'MORTGAGE'), 'SUCCESS');
  end if;

  with ins as (
    insert into public.internal_lead_unlocks
      (account_user_id, lead_user_id, first_match_id, first_property_id, segment,
       unit_price_credits, credits_charged, reservation_id, batch_id)
    select p_user_id, k.lead_user_id, null, p_property_id, 'MORTGAGE', v_unit, v_unit, v_res, v_batch
      from pg_temp.mlu_pick k where not k.already
    on conflict (account_user_id, lead_user_id) do nothing
    returning lead_user_id
  )
  select count(*), coalesce(jsonb_agg(k.ref), '[]'::jsonb) into v_granted, v_unlocked
    from ins join pg_temp.mlu_pick k on k.lead_user_id = ins.lead_user_id;
  if v_granted <> v_n then raise exception 'UNLOCK_MISMATCH'; end if;

  select ca.balance into v_balance from public.credit_accounts ca where ca.user_id = p_user_id;
  v_result := jsonb_build_object(
    'batchId', v_batch,
    'unlocked', v_unlocked,
    'alreadyUnlocked', v_already,
    'skipped', (select coalesce(jsonb_agg(x), '[]'::jsonb) from unnest(p_refs) x
                 where x not in (select ref from pg_temp.mlu_pick)),
    'chargedCredits', v_total,
    'unitCredits', v_unit,
    'balanceAfter', v_balance,
    'duplicate', false);
  insert into public.mortgage_lead_unlock_batches (id, account_user_id, idempotency_key, result)
  values (v_batch, p_user_id, p_idempotency_key, v_result);
  return v_result;
end $$;
revoke all on function public.mortgage_leads_unlock(uuid, uuid, uuid[], text, numeric) from public, anon, authenticated;
grant execute on function public.mortgage_leads_unlock(uuid, uuid, uuid[], text, numeric) to service_role;

/* Contact after unlock: re-checked on every read; withdrawal or a block ends it. */
create or replace function public.mortgage_lead_contact(p_ref uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_i public.mortgage_buyer_intents;
  v_unlock public.internal_lead_unlocks;
  v_user record;
  v_phone text;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_i from public.mortgage_buyer_intents where public_ref = p_ref;
  if not found or v_i.status <> 'ACTIVE' then
    return jsonb_build_object('restricted', true, 'reason', 'WITHDRAWN');
  end if;
  select * into v_unlock from public.internal_lead_unlocks where account_user_id = v_me and lead_user_id = v_i.user_id;
  if not found then raise exception 'not unlocked' using errcode = '42501'; end if;
  select id, nickname, full_name, phone, email, preferred_language, suspended_at into v_user from public.users where id = v_i.user_id;
  if v_user.suspended_at is not null then return jsonb_build_object('restricted', true, 'reason', 'UNAVAILABLE'); end if;
  if exists (select 1 from public.conversation_blocks b
              where (b.blocker_id = v_i.user_id and b.blocked_id = v_me) or (b.blocker_id = v_me and b.blocked_id = v_i.user_id)) then
    return jsonb_build_object('restricted', true, 'reason', 'BLOCKED');
  end if;
  if v_i.share_phone and v_user.phone is not null and length(v_user.phone) > 4 then
    v_phone := v_user.phone;
    insert into public.contact_disclosures (viewer_user_id, subject_user_id, property_id, relationship_kind, relationship_id)
    values (v_me, v_i.user_id, v_unlock.first_property_id, 'MORTGAGE_LEAD_UNLOCK', v_unlock.id);
  end if;
  return jsonb_build_object(
    'restricted', false,
    'displayName', coalesce(nullif(v_user.nickname, ''), nullif(split_part(coalesce(v_user.full_name, ''), ' ', 1), '')),
    'language', v_user.preferred_language::text,
    'phone', v_phone,
    'email', case when v_i.share_email then v_user.email end,
    'unlockedAt', v_unlock.created_at,
    'creditsCharged', v_unlock.credits_charged);
end $$;
revoke all on function public.mortgage_lead_contact(uuid) from public, anon;
grant execute on function public.mortgage_lead_contact(uuid) to authenticated;

/* Admin: the conversion funnel, from counts only. */
create or replace function public.admin_mortgage_lead_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return jsonb_build_object(
    'savedScenarios', (select count(*) from public.mortgage_scenarios),
    'scenarioOwners', (select count(distinct user_id) from public.mortgage_scenarios),
    'consentedActive', (select count(*) from public.mortgage_buyer_intents where status = 'ACTIVE'),
    'withdrawn', (select count(*) from public.mortgage_buyer_intents where status = 'WITHDRAWN'),
    'uniqueUnlocks', (select count(*) from public.internal_lead_unlocks where segment = 'MORTGAGE'),
    'unlockCredits', (select coalesce(sum(credits_charged), 0) from public.internal_lead_unlocks where segment = 'MORTGAGE'),
    'repeatChargesPrevented', (select coalesce(sum(jsonb_array_length(result->'alreadyUnlocked')), 0) from public.mortgage_lead_unlock_batches),
    'price', public.mortgage_lead_price());
end $$;
revoke all on function public.admin_mortgage_lead_stats() from public, anon;
grant execute on function public.admin_mortgage_lead_stats() to authenticated;
