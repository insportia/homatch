-- BROKER DISCOVERY BECOMES A CUSTOMER FEATURE, AND THE DIRECTORY GROWS A DOOR.
--
-- Four things, one migration:
--
--   1. user_broker_discoveries — the persistent, USER-SPECIFIC library of
--      externally discovered brokers. The global record stays one row in
--      broker_intelligence; this table records that a particular account has
--      already been given that firm, which is the fact that makes "never
--      charge the same user twice for the same broker" enforceable in the
--      database rather than promised in a function.
--
--   2. broker_discovery_deliver — the ONE writer of that table and the one
--      place a discovery charge can happen. Insert-on-conflict-do-nothing is
--      the dedup; only rows the insert actually created are charged, so a
--      retry, a re-run, a second campaign or fresh evidence about a broker
--      the user already holds all cost exactly nothing.
--
--   3. The directory application grows the profile fields a real broker page
--      needs, plus a review vocabulary (APPROVED / NEEDS_CHANGES / REJECTED)
--      between PENDING_REVIEW and the commercial states. The public view's
--      test is unchanged: ACTIVE with a current paid_until, nothing else.
--
--   4. Engagement analytics for public broker profiles — click facts with
--      honest names (a phone CLICK, never a completed call), deduplicated per
--      viewer-hour so a rerender cannot inflate a count.
--
-- Commercial identity lives in billable_products (BROKER_DISCOVERY,
-- BROKER_DIRECTORY_LISTING): one catalogue, admin-controlled, no price in any
-- component. 10 credits = $1 everywhere, so credits = cents / 10.
--
-- (runs inside the migration runner's own transaction)

/* ---------------- enum values (used only at runtime, never in this txn) --- */

ALTER TYPE public.ledger_type ADD VALUE IF NOT EXISTS 'BROKER_DISCOVERY';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'BROKER_APPLICATION';

/* ---------------- 1. the persistent user library ------------------------- */

create table if not exists public.user_broker_discoveries (
  id uuid primary key default gen_random_uuid(),
  -- users.id, the same identity space as matching_campaigns, subscriptions
  -- and the credit ledger.
  user_id uuid not null references public.users (id) on delete cascade,
  broker_id uuid not null references public.broker_intelligence (id) on delete cascade,

  -- Provenance: which discovery context found it FIRST. Later campaigns that
  -- see the same broker do not touch this row — that is the whole point.
  first_campaign_id uuid,
  first_intent text,
  context jsonb not null default '{}'::jsonb,

  -- What this delivery cost, and the ledger row that says so. 0 with a null
  -- ledger id is a delivery made while the product's pricing was off.
  charged_credits numeric(12,4) not null default 0,
  ledger_entry_id uuid references public.credit_ledger (id) on delete set null,

  created_at timestamptz not null default now(),

  -- THE DEDUP CONTRACT. One row per user per broker, forever.
  constraint user_broker_discoveries_identity unique (user_id, broker_id),
  constraint user_broker_discoveries_intent_check
    check (first_intent is null or first_intent in ('SELL', 'RENT_OUT', 'BUY', 'RENT'))
);

comment on table public.user_broker_discoveries is
  'Which discovered brokers a specific account has already been delivered. '
  'Written only by broker_discovery_deliver; the unique key is why the same '
  'user can never be charged twice for the same broker.';

create index if not exists user_broker_discoveries_user_idx
  on public.user_broker_discoveries (user_id, created_at desc);

alter table public.user_broker_discoveries enable row level security;

drop policy if exists ubd_owner_reads on public.user_broker_discoveries;
create policy ubd_owner_reads on public.user_broker_discoveries
  for select using (user_id = public.auth_user_id());
-- No INSERT/UPDATE/DELETE policies: the service-role deliver function is the
-- only writer, and history is never edited.

/* ---------------- the opt-in flags --------------------------------------- */

alter table public.matching_campaigns
  add column if not exists discover_brokers boolean not null default false;
alter table public.active_search_subscriptions
  add column if not exists discover_brokers boolean not null default false;

comment on column public.matching_campaigns.discover_brokers is
  'Owner opted in to broker/agency discovery alongside this campaign. The flag '
  'authorises delivery; charging happens only in broker_discovery_deliver.';

/* ---------------- 2. catalogue rows -------------------------------------- */

insert into public.billable_products
  (code, name, billing_mode, requires_reservation, standard_retail_cents,
   reference_landed_cogs_cents, min_gross_margin_bps, estimate_strategy,
   enabled, pricing_active, sort_order, config)
values
  ('BROKER_DISCOVERY', 'Broker & agency discovery (per new broker)', 'FIXED',
   false, 20, 0, 0, 'PER_UNIT', true, true, 80,
   jsonb_build_object('unit', 'NEW_BROKER')),
  ('BROKER_DIRECTORY_LISTING', 'HOMATCH broker directory listing', 'FIXED',
   false, 2900, 0, 0, 'FIXED', true, true, 81,
   jsonb_build_object('duration_days', 30))
on conflict (code) do nothing;

/* The price a customer is shown BEFORE opting in, read from the catalogue and
   nowhere else. */
create or replace function public.broker_discovery_pricing()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'active', (p.enabled and not p.kill_switch),
    'charging', (p.enabled and not p.kill_switch and p.pricing_active),
    'unitCredits', round(p.standard_retail_cents / 10.0, 2),
    'listingPriceCredits', (select round(l.standard_retail_cents / 10.0, 2)
                              from public.billable_products l
                             where l.code = 'BROKER_DIRECTORY_LISTING'),
    'listingDurationDays', (select coalesce((l.config->>'duration_days')::integer, 30)
                              from public.billable_products l
                             where l.code = 'BROKER_DIRECTORY_LISTING')
  )
  from public.billable_products p
  where p.code = 'BROKER_DISCOVERY';
$$;

revoke all on function public.broker_discovery_pricing() from public, anon;
grant execute on function public.broker_discovery_pricing() to authenticated;

/* ---------------- admin control of the two broker products --------------- */

create or replace function public.admin_configure_broker_product(
  p_code text,
  p_standard_retail_cents integer default null,
  p_enabled boolean default null,
  p_pricing_active boolean default null,
  p_config jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid;
  v_old public.billable_products%rowtype;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;
  -- Scoped to the broker products on purpose: this is broker commercial
  -- control, not a general catalogue backdoor.
  if p_code not in ('BROKER_DISCOVERY', 'BROKER_DIRECTORY_LISTING') then
    raise exception 'NOT_A_BROKER_PRODUCT';
  end if;
  if p_standard_retail_cents is not null
     and (p_standard_retail_cents < 0 or p_standard_retail_cents > 1000000) then
    raise exception 'PRICE_OUT_OF_RANGE';
  end if;

  select * into v_old from public.billable_products where code = p_code for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;

  update public.billable_products
     set standard_retail_cents = coalesce(p_standard_retail_cents, standard_retail_cents),
         enabled = coalesce(p_enabled, enabled),
         pricing_active = coalesce(p_pricing_active, pricing_active),
         config = coalesce(p_config, config),
         pricing_version = pricing_version + 1,
         updated_at = now()
   where code = p_code;

  select u.id into v_admin from public.users u where u.auth_id = auth.uid();
  insert into public.admin_audit_log (admin_id, target_id, action, entity_type, entity_id, metadata)
  values (
    coalesce(v_admin, '00000000-0000-0000-0000-000000000000'::uuid),
    null,
    'BROKER_PRODUCT_CONFIGURED',
    'billable_products',
    p_code,
    jsonb_build_object(
      'old_cents', v_old.standard_retail_cents, 'new_cents', coalesce(p_standard_retail_cents, v_old.standard_retail_cents),
      'old_enabled', v_old.enabled, 'new_enabled', coalesce(p_enabled, v_old.enabled),
      'old_pricing_active', v_old.pricing_active, 'new_pricing_active', coalesce(p_pricing_active, v_old.pricing_active),
      'config', coalesce(p_config, v_old.config)
    )
  );

  return (select jsonb_build_object(
    'code', code, 'standard_retail_cents', standard_retail_cents,
    'enabled', enabled, 'pricing_active', pricing_active, 'config', config)
    from public.billable_products where code = p_code);
end $$;

revoke all on function public.admin_configure_broker_product(text, integer, boolean, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.admin_configure_broker_product(text, integer, boolean, boolean, jsonb) to authenticated;

/* ---------------- 3. the deliver-and-charge function --------------------- */

create or replace function public.broker_discovery_deliver(
  p_user_id uuid,
  p_broker_ids uuid[],
  p_campaign_id uuid default null,
  p_intent text default null,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product public.billable_products%rowtype;
  v_unit numeric;
  v_before numeric;
  v_after numeric;
  v_ledger uuid;
  v_new uuid[] := '{}';
  v_id uuid;
  v_broker uuid;
  v_affordable integer;
  v_skipped_balance integer := 0;
begin
  -- Money moves here, so only the backend may call it. Campaign execution
  -- runs as service_role; there is no client path.
  if auth.role() <> 'service_role' then
    raise exception 'FORBIDDEN';
  end if;
  if p_user_id is null then raise exception 'INVALID_ARGUMENT'; end if;
  if p_intent is not null and p_intent not in ('SELL', 'RENT_OUT', 'BUY', 'RENT') then
    raise exception 'INVALID_INTENT';
  end if;

  select * into v_product from public.billable_products where code = 'BROKER_DISCOVERY';
  if not found or not v_product.enabled or v_product.kill_switch then
    return jsonb_build_object('delivered', 0, 'charged_credits', 0, 'skipped', 'PRODUCT_DISABLED');
  end if;
  -- pricing_active=false is "registered but must never charge": deliveries
  -- record honestly at zero rather than inventing a price.
  v_unit := case when v_product.pricing_active
                 then round(v_product.standard_retail_cents / 10.0, 2)
                 else 0 end;

  -- The account row is locked for the whole delivery, so two concurrent
  -- sweeps for the same user serialize instead of double-spending.
  select ca.balance into v_before
    from public.credit_accounts ca where ca.user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('delivered', 0, 'charged_credits', 0, 'skipped', 'NO_CREDIT_ACCOUNT');
  end if;

  v_affordable := case when v_unit > 0 then floor(v_before / v_unit)::integer else 2147483647 end;

  foreach v_broker in array coalesce(p_broker_ids, '{}'::uuid[]) loop
    continue when v_broker is null;
    -- Deliver only brokers that exist and are broker-shaped; a bad id is
    -- skipped rather than half-charged.
    perform 1 from public.broker_intelligence b where b.id = v_broker;
    continue when not found;

    if coalesce(array_length(v_new, 1), 0) >= v_affordable then
      -- Balance exhausted at the current unit price: stop delivering rather
      -- than going negative. Nothing was inserted for this broker, so a later
      -- run (after a top-up) delivers and charges it normally.
      v_skipped_balance := v_skipped_balance + 1;
      continue;
    end if;

    -- THE DEDUP. An existing row means this user already has this broker:
    -- no insert, no charge, regardless of which campaign or evidence
    -- surfaced it this time.
    insert into public.user_broker_discoveries
      (user_id, broker_id, first_campaign_id, first_intent, context, charged_credits)
    values (p_user_id, v_broker, p_campaign_id, p_intent, coalesce(p_context, '{}'::jsonb), v_unit)
    on conflict (user_id, broker_id) do nothing
    returning id into v_id;

    if v_id is not null then
      v_new := v_new || v_broker;
    end if;
  end loop;

  if coalesce(array_length(v_new, 1), 0) > 0 and v_unit > 0 then
    v_after := v_before - v_unit * array_length(v_new, 1);
    update public.credit_accounts
       set balance = v_after, updated_at = now()
     where user_id = p_user_id;
    insert into public.credit_ledger (user_id, amount, balance_before, balance_after, type, reference)
    values (
      p_user_id,
      -(v_unit * array_length(v_new, 1)),
      v_before,
      v_after,
      'BROKER_DISCOVERY'::public.ledger_type,
      'broker-discovery:' || coalesce(p_campaign_id::text, 'search') || ':new=' || array_length(v_new, 1)
    )
    returning id into v_ledger;
    update public.user_broker_discoveries
       set ledger_entry_id = v_ledger
     where user_id = p_user_id and broker_id = any (v_new) and ledger_entry_id is null;
  else
    v_after := v_before;
    -- Free deliveries (pricing off) still record 0 explicitly.
    if coalesce(array_length(v_new, 1), 0) > 0 and v_unit = 0 then
      update public.user_broker_discoveries
         set charged_credits = 0
       where user_id = p_user_id and broker_id = any (v_new);
    end if;
  end if;

  return jsonb_build_object(
    'delivered', coalesce(array_length(v_new, 1), 0),
    'newBrokerIds', to_jsonb(v_new),
    'unitCredits', v_unit,
    'charged_credits', v_unit * coalesce(array_length(v_new, 1), 0),
    'balance_after', v_after,
    'skippedForBalance', v_skipped_balance
  );
end $$;

comment on function public.broker_discovery_deliver(uuid, uuid[], uuid, text, jsonb) is
  'The only writer of user_broker_discoveries and the only place a broker-discovery '
  'charge exists. ON CONFLICT DO NOTHING is the cross-campaign dedup: a broker the '
  'user already holds is never re-delivered and never re-charged, whatever found it '
  'again. Service role only; idempotent under retries by construction.';

revoke all on function public.broker_discovery_deliver(uuid, uuid[], uuid, text, jsonb) from public, anon, authenticated;

/* ---------------- the customer read of their own library ------------------ */

create or replace function public.list_my_discovered_brokers(p_limit integer default 200)
returns table (
  id uuid,
  broker_id uuid,
  role text,
  display_name text,
  key_kind text,
  country_code text,
  cities text[],
  languages text[],
  deal_kinds text[],
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  validation_state text,
  observation_count integer,
  source_count integer,
  first_intent text,
  first_campaign_id uuid,
  context jsonb,
  discovered_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := public.auth_user_id();
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  return query
    select d.id, b.id, b.role, b.display_name, b.key_kind,
           b.country_code, b.cities, b.languages, b.deal_kinds,
           b.first_seen_at, b.last_seen_at, b.validation_state,
           b.observation_count, b.source_count,
           d.first_intent, d.first_campaign_id, d.context, d.created_at
      from public.user_broker_discoveries d
      join public.broker_intelligence b on b.id = d.broker_id
     where d.user_id = v_uid
     order by d.created_at desc
     limit greatest(1, least(coalesce(p_limit, 200), 1000));
end $$;

comment on function public.list_my_discovered_brokers(integer) is
  'The signed-in user''s own Found-for-You library, and nobody else''s: the user '
  'id comes from auth, never from an argument, so no id can be manipulated.';

revoke all on function public.list_my_discovered_brokers(integer) from public, anon;
grant execute on function public.list_my_discovered_brokers(integer) to authenticated;

/* ---------------- 4. richer directory applications ----------------------- */

alter table public.broker_directory_listings
  add column if not exists about text,
  add column if not exists contact_person text,
  add column if not exists logo_url text,
  add column if not exists property_types text[] not null default '{}',
  add column if not exists deal_kinds text[] not null default '{}',
  add column if not exists districts text[] not null default '{}',
  add column if not exists experience_years integer,
  add column if not exists review_note text;

comment on column public.broker_directory_listings.review_note is
  'Admin''s message to the applicant on NEEDS_CHANGES / REJECTED. Visible to the owner.';

-- The review vocabulary between an application and the commercial states.
alter table public.broker_directory_listings
  drop constraint if exists broker_directory_listings_status_check;
alter table public.broker_directory_listings
  add constraint broker_directory_listings_status_check
  check (status in ('PENDING_REVIEW', 'APPROVED', 'NEEDS_CHANGES', 'REJECTED',
                    'ACTIVE', 'SUSPENDED', 'EXPIRED'));

-- The public view gains the new PUBLIC fields. Its test does not change.
create or replace view public.broker_directory_public
with (security_invoker = true) as
select
  l.id,
  l.broker_id,
  l.display_name,
  l.role,
  l.country_code,
  l.cities,
  l.languages,
  l.contact_phone,
  l.contact_email,
  l.website,
  l.paid_until,
  l.about,
  l.contact_person,
  l.logo_url,
  l.property_types,
  l.deal_kinds,
  l.districts,
  l.experience_years
from public.broker_directory_listings l
where l.status = 'ACTIVE'
  and l.paid_until is not null
  and l.paid_until > now();

grant select on public.broker_directory_public to anon, authenticated;

/* Apply, richer: same shape of guarantees as before — the caller cannot name
   a status, a paid_until or a broker link. A NEEDS_CHANGES or REJECTED
   application resubmits IN PLACE, back to PENDING_REVIEW, keeping its id and
   history. */
drop function if exists public.broker_directory_apply(text, text, text[], text[], text, text, text);

create or replace function public.broker_directory_apply(
  p_display_name  text,
  p_role          text,
  p_cities        text[] default '{}',
  p_languages     text[] default '{}',
  p_contact_phone text default null,
  p_contact_email text default null,
  p_website       text default null,
  p_about         text default null,
  p_contact_person text default null,
  p_property_types text[] default '{}',
  p_deal_kinds    text[] default '{}',
  p_districts     text[] default '{}',
  p_experience_years integer default null,
  p_logo_url      text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_name  text := btrim(coalesce(p_display_name, ''));
  v_phone text := nullif(btrim(coalesce(p_contact_phone, '')), '');
  v_email text := nullif(btrim(coalesce(p_contact_email, '')), '');
  v_web   text := nullif(btrim(coalesce(p_website, '')), '');
  v_about text := nullif(btrim(coalesce(p_about, '')), '');
  v_person text := nullif(btrim(coalesce(p_contact_person, '')), '');
  v_logo  text := nullif(btrim(coalesce(p_logo_url, '')), '');
  v_id    uuid;
  v_admin record;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if length(v_name) < 2 or length(v_name) > 120 then raise exception 'INVALID_NAME'; end if;
  if p_role is null or p_role not in ('AGENCY', 'BROKER') then raise exception 'INVALID_ROLE'; end if;
  if v_phone is null and v_email is null and v_web is null then raise exception 'CONTACT_REQUIRED'; end if;
  if coalesce(array_length(p_cities, 1), 0) > 20
     or coalesce(array_length(p_languages, 1), 0) > 12
     or coalesce(array_length(p_property_types, 1), 0) > 12
     or coalesce(array_length(p_deal_kinds, 1), 0) > 4
     or coalesce(array_length(p_districts, 1), 0) > 40 then
    raise exception 'TOO_MANY_VALUES';
  end if;
  if length(coalesce(v_phone, '')) > 40 or length(coalesce(v_email, '')) > 200
     or length(coalesce(v_web, '')) > 300 or length(coalesce(v_about, '')) > 4000
     or length(coalesce(v_person, '')) > 120 or length(coalesce(v_logo, '')) > 500 then
    raise exception 'VALUE_TOO_LONG';
  end if;
  if p_experience_years is not null and (p_experience_years < 0 or p_experience_years > 80) then
    raise exception 'INVALID_EXPERIENCE';
  end if;
  if exists (
    select 1 from public.broker_directory_listings l
     where l.owner_user_id = v_uid and l.status = 'PENDING_REVIEW'
  ) then
    raise exception 'ALREADY_PENDING';
  end if;

  -- Resubmission: a NEEDS_CHANGES or REJECTED application is edited in place
  -- and goes back into review. Commercial fields are untouched.
  select l.id into v_id
    from public.broker_directory_listings l
   where l.owner_user_id = v_uid and l.status in ('NEEDS_CHANGES', 'REJECTED')
   order by l.updated_at desc limit 1;

  if v_id is not null then
    update public.broker_directory_listings
       set display_name = v_name, role = p_role,
           cities = coalesce(array(select btrim(c) from unnest(p_cities) c where btrim(c) <> ''), '{}'),
           languages = coalesce(array(select lower(btrim(l2)) from unnest(p_languages) l2 where btrim(l2) <> ''), '{}'),
           contact_phone = v_phone, contact_email = v_email, website = v_web,
           about = v_about, contact_person = v_person, logo_url = v_logo,
           property_types = coalesce(array(select upper(btrim(pt)) from unnest(p_property_types) pt where btrim(pt) <> ''), '{}'),
           deal_kinds = coalesce(array(select upper(btrim(dk)) from unnest(p_deal_kinds) dk where btrim(dk) <> ''), '{}'),
           districts = coalesce(array(select btrim(d) from unnest(p_districts) d where btrim(d) <> ''), '{}'),
           experience_years = p_experience_years,
           status = 'PENDING_REVIEW', review_note = null, updated_at = now()
     where id = v_id;
  else
    insert into public.broker_directory_listings (
      owner_user_id, broker_id, display_name, role, country_code,
      cities, languages, contact_phone, contact_email, website,
      about, contact_person, logo_url, property_types, deal_kinds, districts,
      experience_years, status, paid_until
    ) values (
      v_uid, null, v_name, p_role, 'GE',
      coalesce(array(select btrim(c) from unnest(p_cities) c where btrim(c) <> ''), '{}'),
      coalesce(array(select lower(btrim(l2)) from unnest(p_languages) l2 where btrim(l2) <> ''), '{}'),
      v_phone, v_email, v_web,
      v_about, v_person, v_logo,
      coalesce(array(select upper(btrim(pt)) from unnest(p_property_types) pt where btrim(pt) <> ''), '{}'),
      coalesce(array(select upper(btrim(dk)) from unnest(p_deal_kinds) dk where btrim(dk) <> ''), '{}'),
      coalesce(array(select btrim(d) from unnest(p_districts) d where btrim(d) <> ''), '{}'),
      p_experience_years, 'PENDING_REVIEW', null
    ) returning id into v_id;
  end if;

  -- Every admin hears about it once, in the notification centre they already
  -- have. Email stays with the operational tooling; there is no transactional
  -- mail seam to reuse here and this migration does not invent one.
  for v_admin in select u.id from public.users u where u.is_admin loop
    perform public.notify_emit(
      v_admin.id,
      'BROKER_APPLICATION'::public.notification_type,
      'Broker application: ' || v_name,
      'A ' || lower(p_role) || ' applied for the HOMATCH broker directory.',
      'NORMAL',
      '/admin/brokers',
      'broker_directory_listings',
      v_id,
      'broker-application:' || v_id::text
    );
  end loop;

  return v_id;
end $$;

comment on function public.broker_directory_apply(text, text, text[], text[], text, text, text, text, text, text[], text[], text[], integer, text) is
  'Broker/agency application or resubmission. Always lands in PENDING_REVIEW; the '
  'signature still has no status, paid_until or broker_id, so it cannot be talked '
  'into granting anything.';

revoke all on function public.broker_directory_apply(text, text, text[], text[], text, text, text, text, text, text[], text[], text[], integer, text) from public, anon, authenticated;
grant execute on function public.broker_directory_apply(text, text, text[], text[], text, text, text, text, text, text[], text[], text[], integer, text) to authenticated;

/* The owner reads their own full application (RLS policy broker_directory_owner_reads
   already grants this) — but review_note travels with it, so nothing new needed. */

/* Admin status changes: the review verbs join the commercial ones. */
create or replace function public.admin_set_broker_listing_status(
  p_listing_id uuid,
  p_status     text,
  p_paid_until timestamptz default null,
  p_reason     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin  uuid;
  v_old    public.broker_directory_listings%rowtype;
  v_paid   timestamptz;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select u.id into v_admin from public.users u where u.auth_id = auth.uid();

  if p_listing_id is null or p_status is null
     or p_status not in ('APPROVED', 'NEEDS_CHANGES', 'REJECTED', 'ACTIVE', 'SUSPENDED', 'EXPIRED') then
    raise exception 'INVALID_ARGUMENT';
  end if;

  select * into v_old from public.broker_directory_listings where id = p_listing_id for update;
  if not found then raise exception 'LISTING_NOT_FOUND'; end if;

  v_paid := v_old.paid_until;

  if p_status = 'ACTIVE' then
    if p_paid_until is null or p_paid_until <= now() then
      raise exception 'PAID_UNTIL_REQUIRED_IN_FUTURE';
    end if;
    if v_reason is null then
      raise exception 'PAYMENT_BASIS_REQUIRED';
    end if;
    v_paid := p_paid_until;
  elsif p_paid_until is not null then
    raise exception 'PAID_UNTIL_ONLY_WITH_ACTIVE';
  end if;

  -- NEEDS_CHANGES and REJECTED carry the reviewer's words to the applicant.
  if p_status in ('NEEDS_CHANGES', 'REJECTED') and v_reason is null then
    raise exception 'REVIEW_NOTE_REQUIRED';
  end if;

  update public.broker_directory_listings
     set status = p_status,
         paid_until = v_paid,
         review_note = case when p_status in ('NEEDS_CHANGES', 'REJECTED') then v_reason
                            when p_status in ('APPROVED', 'ACTIVE') then null
                            else review_note end,
         updated_at = now()
   where id = p_listing_id;

  insert into public.admin_audit_log (admin_id, target_id, action, entity_type, entity_id, metadata)
  values (
    coalesce(v_admin, '00000000-0000-0000-0000-000000000000'::uuid),
    v_old.owner_user_id,
    'BROKER_LISTING_' || p_status,
    'broker_directory_listings',
    p_listing_id::text,
    jsonb_build_object(
      'old_status', v_old.status, 'new_status', p_status,
      'old_paid_until', v_old.paid_until, 'new_paid_until', v_paid,
      'reason', v_reason,
      'payment_basis', case when p_status = 'ACTIVE' then 'ADMIN_ASSERTED' else null end
    )
  );

  -- The applicant hears the outcome in their own notification centre.
  perform public.notify_emit(
    v_old.owner_user_id,
    'BROKER_APPLICATION'::public.notification_type,
    case p_status
      when 'APPROVED' then 'Broker application approved'
      when 'ACTIVE' then 'Broker listing is live'
      when 'NEEDS_CHANGES' then 'Broker application needs changes'
      when 'REJECTED' then 'Broker application declined'
      when 'SUSPENDED' then 'Broker listing suspended'
      else 'Broker listing expired'
    end,
    v_reason,
    'NORMAL',
    '/broker',
    'broker_directory_listings',
    p_listing_id,
    'broker-status:' || p_listing_id::text || ':' || p_status
  );

  return jsonb_build_object(
    'id', p_listing_id, 'status', p_status, 'paid_until', v_paid,
    'is_public', (p_status = 'ACTIVE' and v_paid is not null and v_paid > now())
  );
end $$;

/* ---------------- 5. profile engagement analytics ------------------------ */

create table if not exists public.broker_profile_events (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.broker_directory_listings (id) on delete cascade,
  -- What actually happened, named as what was MEASURED. There is no
  -- CALL_COMPLETED here because the platform cannot measure one.
  event_type text not null,
  surface text,
  -- An opaque per-viewer key (client-derived, no PII) used only for dedup.
  viewer_key text not null,
  -- The dedup window: one row per viewer per event per hour.
  bucket text not null,
  occurred_at timestamptz not null default now(),

  constraint broker_profile_events_type_check
    check (event_type in ('IMPRESSION', 'PROFILE_OPEN', 'PHONE_CLICK', 'EMAIL_CLICK',
                          'WHATSAPP_CLICK', 'WEBSITE_CLICK', 'MESSAGE_CLICK')),
  constraint broker_profile_events_dedup
    unique (listing_id, event_type, viewer_key, bucket)
);

comment on table public.broker_profile_events is
  'Broker profile engagement facts. Every name says what was measured: a '
  'PHONE_CLICK is a click on a phone link, never a completed call. The unique '
  'key absorbs rerenders and refresh loops.';

create index if not exists broker_profile_events_listing_idx
  on public.broker_profile_events (listing_id, occurred_at desc);

alter table public.broker_profile_events enable row level security;
-- No direct policies: recorded through the RPC below, read through the stats RPC.

create or replace function public.record_broker_profile_event(
  p_listing_id uuid,
  p_event text,
  p_surface text default null,
  p_viewer_key text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := coalesce(nullif(btrim(coalesce(p_viewer_key, '')), ''), 'anon');
begin
  if p_listing_id is null
     or p_event is null
     or p_event not in ('IMPRESSION', 'PROFILE_OPEN', 'PHONE_CLICK', 'EMAIL_CLICK',
                        'WHATSAPP_CLICK', 'WEBSITE_CLICK', 'MESSAGE_CLICK') then
    return false;
  end if;
  if length(v_key) > 80 then v_key := left(v_key, 80); end if;

  -- Only publicly visible listings accumulate public engagement. A pending or
  -- lapsed profile is not on display, so nothing should count against it.
  perform 1 from public.broker_directory_listings l
   where l.id = p_listing_id
     and l.status = 'ACTIVE' and l.paid_until is not null and l.paid_until > now();
  if not found then return false; end if;

  insert into public.broker_profile_events (listing_id, event_type, surface, viewer_key, bucket)
  values (
    p_listing_id, p_event,
    left(coalesce(nullif(btrim(coalesce(p_surface, '')), ''), 'unknown'), 40),
    v_key,
    to_char(now(), 'YYYY-MM-DD-HH24')
  )
  on conflict (listing_id, event_type, viewer_key, bucket) do nothing;
  return true;
end $$;

revoke all on function public.record_broker_profile_event(uuid, text, text, text) from public;
grant execute on function public.record_broker_profile_event(uuid, text, text, text) to anon, authenticated;

/* The broker's own numbers: totals and a daily trend, owner or admin only. */
create or replace function public.broker_profile_event_stats(
  p_listing_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_days integer := greatest(1, least(coalesce(p_days, 30), 180));
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 180)));
begin
  select l.owner_user_id into v_owner
    from public.broker_directory_listings l where l.id = p_listing_id;
  if v_owner is null then raise exception 'LISTING_NOT_FOUND'; end if;
  if v_owner <> auth.uid() and not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  return jsonb_build_object(
    'days', v_days,
    'totals', coalesce((
      select jsonb_object_agg(t.event_type, t.n)
        from (select e.event_type, count(*)::integer as n
                from public.broker_profile_events e
               where e.listing_id = p_listing_id and e.occurred_at >= v_since
               group by e.event_type) t
    ), '{}'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'views', d.views, 'contacts', d.contacts) order by d.day)
        from (select to_char(e.occurred_at, 'YYYY-MM-DD') as day,
                     count(*) filter (where e.event_type in ('IMPRESSION', 'PROFILE_OPEN'))::integer as views,
                     count(*) filter (where e.event_type not in ('IMPRESSION', 'PROFILE_OPEN'))::integer as contacts
                from public.broker_profile_events e
               where e.listing_id = p_listing_id and e.occurred_at >= v_since
               group by 1) d
    ), '[]'::jsonb)
  );
end $$;

revoke all on function public.broker_profile_event_stats(uuid, integer) from public, anon;
grant execute on function public.broker_profile_event_stats(uuid, integer) to authenticated;

/* ---------------- admin list gains the new columns ------------------------ */

drop function if exists public.admin_list_broker_directory();
create or replace function public.admin_list_broker_directory()
returns table (
  id uuid,
  owner_user_id uuid,
  owner_email text,
  owner_name text,
  display_name text,
  role text,
  cities text[],
  languages text[],
  contact_phone text,
  contact_email text,
  website text,
  about text,
  contact_person text,
  logo_url text,
  property_types text[],
  deal_kinds text[],
  districts text[],
  experience_years integer,
  review_note text,
  status text,
  paid_until timestamptz,
  is_public boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  return query
    select l.id, l.owner_user_id, u.email, u.full_name,
           l.display_name, l.role, l.cities, l.languages,
           l.contact_phone, l.contact_email, l.website,
           l.about, l.contact_person, l.logo_url,
           l.property_types, l.deal_kinds, l.districts, l.experience_years,
           l.review_note,
           l.status, l.paid_until,
           (l.status = 'ACTIVE' and l.paid_until is not null and l.paid_until > now()),
           l.created_at, l.updated_at
      from public.broker_directory_listings l
      left join public.users u on u.auth_id = l.owner_user_id
     order by (l.status = 'PENDING_REVIEW') desc, l.created_at desc;
end $$;

revoke all on function public.admin_list_broker_directory() from public, anon, authenticated;
grant execute on function public.admin_list_broker_directory() to authenticated;

-- (committed by the migration runner)
