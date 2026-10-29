-- ============================================================================
-- HOMATCH SUBSCRIPTIONS (owner decision 2026-10-29) — core data model.
--
-- Monthly plans in GEL, VAT inclusive: STANDARD 9.90, VIP 29, UNLIMITED 99.
-- Per billing period: Verify 5 / 15 / unlimited, Contract Analysis 10 / 30 /
-- unlimited. Every plan: unlimited HOMI (text and voice), unlimited internal
-- search and matching, free internal lead unlock. Every number is a row an
-- admin edits through an audited RPC, never a constant in code.
--
-- WHY NEW TABLES AND NOT user_subscriptions / product_plan_entitlements
--
-- The dormant billing-v2 machinery is still LIVE CODE for every PAYG product:
-- beginExecution -> billing_entitlements -> billing_current_plan reads
-- user_subscriptions, and billing_price_quote applies the plan's
-- profit_share_to_customer_bps. An ACTIVE row there on plan STANDARD would make
-- every beginExecution product (Find Buyers, HOMI voice, Design Studio...)
-- answer NOT_FOUND (no product_plan_entitlements rows for STANDARD), and a VIP
-- row would silently discount every PAYG price by 25 %. So the subscription
-- truth lives in saas_* tables that nothing old reads, and billing_current_plan
-- keeps answering FREE: the legacy wallet path stays exactly as it was.
--
-- Plan CODES are shared: STANDARD and UNLIMITED are added to billing_plans
-- (enabled = false, so the dormant catalogue never renders them) and
-- saas_plans.code references billing_plans(code). Existing codes are never
-- deleted (usage_reservations.plan_code_snapshot and others reference them).
-- VIP's dormant billing_plans row is NOT changed (its USD price still feeds the
-- dormant catalogue); VIP's subscription price lives in saas_plans.
--
-- FUNDING ORDER for a gated operation (saas_usage_begin):
--   first-use trial (once per account per feature, verified account)
--   -> plan allowance of the live subscription period
--   -> legacy credit balance (only when the account still has one)
--   -> refusal SUBSCRIPTION_REQUIRED / ALLOWANCE_EXHAUSTED.
-- Usage is success-only: RESERVED at start, COMMITTED on delivery, RELEASED on
-- failure / cancel / timeout. Reserved + committed both count, under an
-- advisory lock per (user, feature), so concurrent starts cannot exceed it.
-- ============================================================================

alter type notification_type add value if not exists 'SUBSCRIPTION_ACTIVATED';
alter type notification_type add value if not exists 'SUBSCRIPTION_RENEWED';
alter type notification_type add value if not exists 'SUBSCRIPTION_ENDED';
alter type notification_type add value if not exists 'PAYMENT_FAILED';
alter type notification_type add value if not exists 'TRIAL_USED';
alter type notification_type add value if not exists 'SUBSCRIPTION_PAYMENT_DUE';

-- ── 1. Plan codes (shared with the dormant catalogue, never rendered there) ──
insert into public.billing_plans (code, name, monthly_price_cents, quality_tier, sort_order, enabled, config)
values ('STANDARD', 'Standard', 0, 'STANDARD', 10, false, '{"saas": true}'::jsonb),
       ('UNLIMITED', 'Unlimited', 0, 'MAXIMUM', 12, false, '{"saas": true}'::jsonb)
on conflict (code) do nothing;

-- ── 2. Subscription plans ────────────────────────────────────────────────────
create table if not exists public.saas_plans (
  code text primary key references public.billing_plans(code),
  name text not null,
  price_gel_tetri integer not null check (price_gel_tetri > 0 and price_gel_tetri <= 10000000),
  currency text not null default 'GEL' check (currency = 'GEL'),
  vat_inclusive boolean not null default true,
  -- Higher = better. Decides upgrade (immediate) vs downgrade (period end) and queue priority.
  priority_tier integer not null check (priority_tier between 1 and 100),
  enabled boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
comment on table public.saas_plans is
  'Subscription plans (owner 2026-10-29). Price in GEL tetri, VAT inclusive. Edited only through admin_saas_set_plan (audited).';

insert into public.saas_plans (code, name, price_gel_tetri, priority_tier, sort_order)
values ('STANDARD', 'Standard', 990, 10, 1),
       ('VIP', 'VIP', 2900, 20, 2),
       ('UNLIMITED', 'Unlimited', 9900, 30, 3)
on conflict (code) do nothing;

-- ── 3. Features, trials and per-plan entitlements ───────────────────────────
create table if not exists public.saas_features (
  feature text primary key check (feature ~ '^[A-Z][A-Z0-9_]{1,40}$'),
  kind text not null check (kind in ('QUOTA', 'BOOLEAN')),
  trial_enabled boolean not null default false,
  -- How long a started use may stay RESERVED before the sweeper returns it.
  reservation_ttl_minutes integer not null default 60 check (reservation_ttl_minutes between 5 and 10080),
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.saas_features (feature, kind, trial_enabled, reservation_ttl_minutes, sort_order)
values ('VERIFY', 'QUOTA', true, 2880, 1),
       ('CONTRACT_ANALYSIS', 'QUOTA', true, 60, 2),
       -- First eligible premium discovery: the trial row exists and is admin-switchable;
       -- the Find Property workstream wires its execution path.
       ('PREMIUM_DISCOVERY', 'QUOTA', true, 240, 3),
       ('HOMI_UNLIMITED', 'BOOLEAN', false, 60, 10),
       ('INTERNAL_SEARCH', 'BOOLEAN', false, 60, 11),
       ('INTERNAL_MATCHING', 'BOOLEAN', false, 60, 12),
       ('INTERNAL_UNLOCK_FREE', 'BOOLEAN', false, 60, 13)
on conflict (feature) do nothing;

create table if not exists public.saas_plan_entitlements (
  plan_code text not null references public.saas_plans(code),
  feature text not null references public.saas_features(feature),
  enabled boolean not null default true,
  -- QUOTA only: uses per billing period. NULL with unlimited = true.
  limit_per_period integer check (limit_per_period is null or limit_per_period between 0 and 100000),
  unlimited boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (plan_code, feature),
  constraint saas_plan_entitlements_quota_shape check (unlimited or limit_per_period is not null)
);

insert into public.saas_plan_entitlements (plan_code, feature, enabled, limit_per_period, unlimited)
values ('STANDARD', 'VERIFY', true, 5, false),
       ('VIP', 'VERIFY', true, 15, false),
       ('UNLIMITED', 'VERIFY', true, null, true),
       ('STANDARD', 'CONTRACT_ANALYSIS', true, 10, false),
       ('VIP', 'CONTRACT_ANALYSIS', true, 30, false),
       ('UNLIMITED', 'CONTRACT_ANALYSIS', true, null, true),
       ('STANDARD', 'PREMIUM_DISCOVERY', false, 0, false),
       ('VIP', 'PREMIUM_DISCOVERY', false, 0, false),
       ('UNLIMITED', 'PREMIUM_DISCOVERY', false, 0, false)
on conflict (plan_code, feature) do nothing;

insert into public.saas_plan_entitlements (plan_code, feature, enabled, limit_per_period, unlimited)
select p.code, f.feature, true, null, true
  from public.saas_plans p
 cross join (values ('HOMI_UNLIMITED'), ('INTERNAL_SEARCH'), ('INTERNAL_MATCHING'), ('INTERNAL_UNLOCK_FREE')) f(feature)
on conflict (plan_code, feature) do nothing;

-- Settings (admin_settings, read through billing_setting_num/bool).
insert into public.admin_settings (key, value)
values ('saas_past_due_grace_days', '3'::jsonb),
       ('saas_renewal_window_days', '3'::jsonb),
       -- SANDBOX payments: OFF. Even on, the edge also needs SAAS_SANDBOX_SECRET and an admin payer.
       ('saas_sandbox_payments_enabled', 'false'::jsonb),
       -- The LIVE provider customers pay with. NONE until a bank is contracted: the pricing page then
       -- shows "payments are not yet connected" and no checkout can start.
       ('saas_default_payment_provider', '"NONE"'::jsonb),
       -- New credits are no longer sold (credits-topup answers CREDIT_SALES_CLOSED). Owner switch.
       ('credit_topups_enabled', 'false'::jsonb)
on conflict (key) do nothing;

-- ── 4. Subscriptions and their audit trail ──────────────────────────────────
create table if not exists public.saas_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  plan_code text not null references public.saas_plans(code),
  status text not null check (status in ('ACTIVE', 'PAST_DUE', 'EXPIRED')),
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  -- Downgrade: applied at the next period boundary.
  pending_plan_code text references public.saas_plans(code),
  -- A renewal paid before the boundary: the tick rolls into it.
  next_period_paid boolean not null default false,
  next_period_plan_code text references public.saas_plans(code),
  grace_until timestamptz,
  provider text,
  provider_subscription_ref text,
  recurring boolean not null default false,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saas_subscriptions_period check (current_period_end > current_period_start)
);
create unique index if not exists uidx_saas_subscriptions_one_live
  on public.saas_subscriptions(user_id) where status in ('ACTIVE', 'PAST_DUE');
create index if not exists idx_saas_subscriptions_due
  on public.saas_subscriptions(current_period_end) where status in ('ACTIVE', 'PAST_DUE');

create table if not exists public.saas_subscription_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  subscription_id uuid references public.saas_subscriptions(id) on delete set null,
  event_type text not null check (event_type in (
    'ACTIVATED', 'RENEWED', 'RENEWAL_PAID', 'UPGRADED', 'DOWNGRADE_SCHEDULED', 'DOWNGRADE_CANCELLED', 'DOWNGRADED',
    'CANCEL_REQUESTED', 'CANCEL_UNDONE', 'PAST_DUE', 'EXPIRED', 'PAYMENT_FAILED', 'TRIAL_USED',
    'ADMIN_GRANTED', 'ADMIN_EXTENDED', 'ADMIN_CANCELLED')),
  plan_code text,
  previous_plan_code text,
  actor_type text not null default 'SYSTEM' check (actor_type in ('USER', 'ADMIN', 'PROVIDER', 'SYSTEM')),
  actor_id uuid,
  reason text,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  -- Outbox: jobs-worker drains rows with a notify_type through _shared/notify.ts.
  notify_type text,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists uidx_saas_subscription_events_idem on public.saas_subscription_events(idempotency_key);
create index if not exists idx_saas_subscription_events_user on public.saas_subscription_events(user_id, created_at desc);
create index if not exists idx_saas_subscription_events_outbox on public.saas_subscription_events(created_at)
  where notify_type is not null and notified_at is null;

-- ── 5. Usage ledger (success-only) and first-use trials ─────────────────────
create table if not exists public.saas_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  feature text not null references public.saas_features(feature),
  funding text not null check (funding in ('TRIAL', 'PLAN')),
  subscription_id uuid references public.saas_subscriptions(id) on delete set null,
  plan_code text,
  period_start timestamptz,
  period_end timestamptz,
  idempotency_key text not null check (length(idempotency_key) between 8 and 300),
  job_ref text,
  state text not null check (state in ('RESERVED', 'COMMITTED', 'RELEASED')),
  reserved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  committed_at timestamptz,
  released_at timestamptz,
  release_reason text,
  -- Delivered after the reservation had expired and the allowance was full: kept, flagged.
  over_allowance boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, feature, idempotency_key)
);
create index if not exists idx_saas_usage_period
  on public.saas_usage(subscription_id, feature, period_start) where state in ('RESERVED', 'COMMITTED');
create index if not exists idx_saas_usage_stale on public.saas_usage(expires_at) where state = 'RESERVED';

create table if not exists public.saas_trials (
  user_id uuid not null references public.users(id) on delete cascade,
  feature text not null references public.saas_features(feature),
  state text not null check (state in ('RESERVED', 'CONSUMED', 'RELEASED')),
  usage_id uuid references public.saas_usage(id) on delete set null,
  reserved_at timestamptz not null default now(),
  consumed_at timestamptz,
  released_at timestamptz,
  -- One trial per account per feature, ever. A RELEASED trial can be reserved again;
  -- a CONSUMED one never.
  primary key (user_id, feature)
);

-- ── 6. Checkout and normalised payment events ───────────────────────────────
create table if not exists public.saas_checkouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  plan_code text not null references public.saas_plans(code),
  kind text not null check (kind in ('NEW', 'UPGRADE', 'RENEWAL')),
  amount_tetri integer not null check (amount_tetri > 0),
  currency text not null default 'GEL' check (currency = 'GEL'),
  provider text not null check (provider in ('SANDBOX', 'BOG', 'TBC')),
  provider_session_ref text,
  redirect_url text,
  -- The customer consented to automatic monthly renewal from a card saved at the bank.
  auto_renew boolean not null default false,
  status text not null default 'CREATED'
    check (status in ('CREATED', 'PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED', 'AMOUNT_MISMATCH', 'SANDBOX_NO_GRANT')),
  -- Every SANDBOX row says so, in the row itself.
  is_test boolean generated always as (provider = 'SANDBOX') stored,
  subscription_id uuid references public.saas_subscriptions(id) on delete set null,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  expires_at timestamptz not null default now() + interval '2 hours'
);
create index if not exists idx_saas_checkouts_user on public.saas_checkouts(user_id, created_at desc);
create unique index if not exists uidx_saas_checkouts_provider_ref
  on public.saas_checkouts(provider, provider_session_ref) where provider_session_ref is not null;

create table if not exists public.saas_payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  type text not null check (type in ('PAYMENT_SUCCEEDED', 'PAYMENT_FAILED', 'REFUNDED', 'OTHER')),
  amount_tetri integer,
  currency text,
  reference text,
  subscription_ref text,
  checkout_id uuid references public.saas_checkouts(id) on delete set null,
  is_test boolean generated always as (provider = 'SANDBOX') stored,
  -- Normalised fields only; never card data, never the raw provider body.
  summary jsonb not null default '{}'::jsonb,
  result jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id)
);

-- ── 7. RLS: read own, no client writes anywhere ─────────────────────────────
alter table public.saas_plans enable row level security;
alter table public.saas_features enable row level security;
alter table public.saas_plan_entitlements enable row level security;
alter table public.saas_subscriptions enable row level security;
alter table public.saas_subscription_events enable row level security;
alter table public.saas_usage enable row level security;
alter table public.saas_trials enable row level security;
alter table public.saas_checkouts enable row level security;
alter table public.saas_payment_events enable row level security;

drop policy if exists saas_plans_read on public.saas_plans;
create policy saas_plans_read on public.saas_plans for select to anon, authenticated using (enabled or public.is_admin());
drop policy if exists saas_features_read on public.saas_features;
create policy saas_features_read on public.saas_features for select to anon, authenticated using (true);
drop policy if exists saas_plan_entitlements_read on public.saas_plan_entitlements;
create policy saas_plan_entitlements_read on public.saas_plan_entitlements for select to anon, authenticated using (true);
drop policy if exists saas_subscriptions_read_own on public.saas_subscriptions;
create policy saas_subscriptions_read_own on public.saas_subscriptions for select to authenticated
  using (user_id = public.auth_user_id() or public.is_admin());
drop policy if exists saas_subscription_events_read_own on public.saas_subscription_events;
create policy saas_subscription_events_read_own on public.saas_subscription_events for select to authenticated
  using (user_id = public.auth_user_id() or public.is_admin());
drop policy if exists saas_usage_read_own on public.saas_usage;
create policy saas_usage_read_own on public.saas_usage for select to authenticated
  using (user_id = public.auth_user_id() or public.is_admin());
drop policy if exists saas_trials_read_own on public.saas_trials;
create policy saas_trials_read_own on public.saas_trials for select to authenticated
  using (user_id = public.auth_user_id() or public.is_admin());
drop policy if exists saas_checkouts_read_own on public.saas_checkouts;
create policy saas_checkouts_read_own on public.saas_checkouts for select to authenticated
  using (user_id = public.auth_user_id() or public.is_admin());
drop policy if exists saas_payment_events_admin on public.saas_payment_events;
create policy saas_payment_events_admin on public.saas_payment_events for select to authenticated using (public.is_admin());

revoke insert, update, delete, truncate on public.saas_plans, public.saas_features, public.saas_plan_entitlements,
  public.saas_subscriptions, public.saas_subscription_events, public.saas_usage, public.saas_trials,
  public.saas_checkouts, public.saas_payment_events from anon, authenticated;

-- ============================================================================
-- Helpers
-- ============================================================================

-- One billing month, calendar-correct in Tbilisi (31 Jan -> 28/29 Feb, never 3 Mar).
create or replace function public.saas_period_end(p_start timestamptz)
returns timestamptz language sql immutable set search_path to '' as $$
  select ((p_start at time zone 'Asia/Tbilisi') + interval '1 month') at time zone 'Asia/Tbilisi'
$$;

-- The account may receive a first-use trial: confirmed email or phone, not suspended.
create or replace function public.saas_account_eligible(p_user_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.users u join auth.users a on a.id = u.auth_id
     where u.id = p_user_id and u.suspended_at is null
       and (a.email_confirmed_at is not null or a.phone_confirmed_at is not null))
$$;

-- The subscription that grants access now: ACTIVE, or PAST_DUE inside its grace.
create or replace function public.saas_live_subscription(p_user_id uuid)
returns public.saas_subscriptions language sql stable security definer set search_path to '' as $$
  select s.* from public.saas_subscriptions s
   where s.user_id = p_user_id
     and (s.status = 'ACTIVE' or (s.status = 'PAST_DUE' and s.grace_until > now()))
   order by s.created_at desc limit 1
$$;

create or replace function public.saas_user_has_feature(p_user_id uuid, p_feature text)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.saas_live_subscription(p_user_id) s
      join public.saas_plan_entitlements e on e.plan_code = s.plan_code and e.feature = p_feature
     where s.id is not null and e.enabled and (e.unlimited or coalesce(e.limit_per_period, 0) > 0))
$$;

create or replace function public.saas_my_user_id()
returns uuid language sql stable security definer set search_path to '' as $$
  select u.id from public.users u where u.auth_id = auth.uid()
$$;

create or replace function public.saas_event(
  p_user_id uuid, p_subscription_id uuid, p_type text, p_plan text, p_previous text,
  p_actor_type text, p_actor_id uuid, p_reason text, p_key text, p_payload jsonb, p_notify text)
returns void language sql security definer set search_path to '' as $$
  insert into public.saas_subscription_events
    (user_id, subscription_id, event_type, plan_code, previous_plan_code, actor_type, actor_id, reason,
     idempotency_key, payload, notify_type)
  values (p_user_id, p_subscription_id, p_type, p_plan, p_previous, p_actor_type, p_actor_id, p_reason,
          p_key, coalesce(p_payload, '{}'::jsonb), p_notify)
  on conflict (idempotency_key) do nothing
$$;

-- ============================================================================
-- Usage: begin -> commit | release, and the sweeper
-- ============================================================================

create or replace function public.saas_usage_begin(
  p_user_id uuid, p_feature text, p_key text, p_job_ref text default null, p_allow_legacy boolean default true)
returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_f public.saas_features;
  v_u public.saas_usage;
  v_t public.saas_trials;
  v_sub public.saas_subscriptions;
  v_e public.saas_plan_entitlements;
  v_funding text;
  v_used integer := 0;
  v_balance numeric := 0;
  v_eligible boolean;
  v_exhausted boolean := false;
begin
  if p_user_id is null then raise exception 'INVALID_ARGUMENT'; end if;
  if p_key is null or length(p_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  select * into v_f from public.saas_features where feature = p_feature;
  if not found or v_f.kind <> 'QUOTA' then raise exception 'FEATURE_UNKNOWN'; end if;

  -- Serialises every start, commit and release of this user's feature.
  perform pg_advisory_xact_lock(hashtextextended('saas_usage:' || p_user_id::text || ':' || p_feature, 0));

  select * into v_u from public.saas_usage where user_id = p_user_id and feature = p_feature and idempotency_key = p_key for update;
  if found and v_u.state in ('RESERVED', 'COMMITTED') then
    return jsonb_build_object('ok', true, 'duplicate', true, 'funding', v_u.funding, 'usageId', v_u.id, 'state', v_u.state);
  end if;

  -- 1. First-use trial.
  v_eligible := public.saas_account_eligible(p_user_id);
  if v_f.trial_enabled and v_eligible then
    select * into v_t from public.saas_trials where user_id = p_user_id and feature = p_feature for update;
    if not found or v_t.state = 'RELEASED' then v_funding := 'TRIAL'; end if;
  end if;

  -- 2. Plan allowance of the live period.
  if v_funding is null then
    v_sub := public.saas_live_subscription(p_user_id);
    if v_sub.id is not null then
      select * into v_e from public.saas_plan_entitlements where plan_code = v_sub.plan_code and feature = p_feature;
      if found and v_e.enabled then
        if v_e.unlimited then
          v_funding := 'PLAN';
        else
          select count(*) into v_used from public.saas_usage
           where subscription_id = v_sub.id and feature = p_feature and funding = 'PLAN'
             and period_start = v_sub.current_period_start and state in ('RESERVED', 'COMMITTED');
          if v_used < coalesce(v_e.limit_per_period, 0) then v_funding := 'PLAN'; else v_exhausted := true; end if;
        end if;
      else
        v_exhausted := true;
      end if;
    end if;
  end if;

  if v_funding is not null then
    if v_u.id is not null then
      update public.saas_usage
         set funding = v_funding, state = 'RESERVED',
             subscription_id = case when v_funding = 'PLAN' then v_sub.id end,
             plan_code = case when v_funding = 'PLAN' then v_sub.plan_code end,
             period_start = case when v_funding = 'PLAN' then v_sub.current_period_start end,
             period_end = case when v_funding = 'PLAN' then v_sub.current_period_end end,
             job_ref = coalesce(p_job_ref, job_ref), reserved_at = now(),
             expires_at = now() + make_interval(mins => v_f.reservation_ttl_minutes),
             committed_at = null, released_at = null, release_reason = null
       where id = v_u.id returning * into v_u;
    else
      insert into public.saas_usage (user_id, feature, funding, subscription_id, plan_code, period_start, period_end,
                                     idempotency_key, job_ref, state, expires_at)
      values (p_user_id, p_feature, v_funding,
              case when v_funding = 'PLAN' then v_sub.id end, case when v_funding = 'PLAN' then v_sub.plan_code end,
              case when v_funding = 'PLAN' then v_sub.current_period_start end, case when v_funding = 'PLAN' then v_sub.current_period_end end,
              p_key, p_job_ref, 'RESERVED', now() + make_interval(mins => v_f.reservation_ttl_minutes))
      returning * into v_u;
    end if;
    if v_funding = 'TRIAL' then
      insert into public.saas_trials (user_id, feature, state, usage_id)
      values (p_user_id, p_feature, 'RESERVED', v_u.id)
      on conflict (user_id, feature) do update
        set state = 'RESERVED', usage_id = excluded.usage_id, reserved_at = now(), released_at = null
        where public.saas_trials.state = 'RELEASED';
    end if;
    return jsonb_build_object('ok', true, 'duplicate', false, 'funding', v_funding, 'usageId', v_u.id,
      'planCode', v_sub.plan_code, 'used', v_used + case when v_funding = 'PLAN' then 1 else 0 end,
      'limit', case when v_funding = 'PLAN' and not v_e.unlimited then v_e.limit_per_period end,
      'unlimited', coalesce(v_e.unlimited, false));
  end if;

  -- 3. Legacy credit balance: only for accounts that still hold credits. Never sold anew.
  select coalesce(ca.balance, 0) into v_balance from public.credit_accounts ca where ca.user_id = p_user_id;
  v_balance := coalesce(v_balance, 0);
  if p_allow_legacy and v_balance > 0 then
    return jsonb_build_object('ok', true, 'funding', 'LEGACY_CREDITS', 'legacyBalance', v_balance,
      'fallbackReason', case when v_exhausted then 'ALLOWANCE_EXHAUSTED' else 'SUBSCRIPTION_REQUIRED' end);
  end if;

  return jsonb_build_object('ok', false,
    'reason', case when v_exhausted then 'ALLOWANCE_EXHAUSTED' else 'SUBSCRIPTION_REQUIRED' end,
    'planCode', v_sub.plan_code, 'trialBlocked', case when v_f.trial_enabled and not v_eligible then 'ACCOUNT_NOT_VERIFIED' end);
end $$;

create or replace function public.saas_usage_commit(p_user_id uuid, p_feature text, p_key text)
returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_u public.saas_usage;
  v_over boolean := false;
  v_e public.saas_plan_entitlements;
  v_n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('saas_usage:' || p_user_id::text || ':' || p_feature, 0));
  select * into v_u from public.saas_usage where user_id = p_user_id and feature = p_feature and idempotency_key = p_key for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); end if;
  if v_u.state = 'COMMITTED' then return jsonb_build_object('ok', true, 'duplicate', true, 'funding', v_u.funding); end if;
  if v_u.state = 'RELEASED' and coalesce(v_u.release_reason, '') <> 'EXPIRED' then
    return jsonb_build_object('ok', false, 'reason', 'RELEASED');
  end if;
  -- Delivered after the sweeper returned the slot: the customer got it, so it counts; when that
  -- pushes the period past its allowance it is kept and flagged, never charged elsewhere.
  if v_u.state = 'RELEASED' then
    if v_u.funding = 'PLAN' then
      select * into v_e from public.saas_plan_entitlements where plan_code = v_u.plan_code and feature = p_feature;
      select count(*) into v_n from public.saas_usage
       where subscription_id = v_u.subscription_id and feature = p_feature and funding = 'PLAN'
         and period_start = v_u.period_start and state in ('RESERVED', 'COMMITTED');
      v_over := not coalesce(v_e.unlimited, false) and v_n >= coalesce(v_e.limit_per_period, 0);
    elsif exists (select 1 from public.saas_trials t where t.user_id = p_user_id and t.feature = p_feature and t.state = 'CONSUMED') then
      v_over := true;
    end if;
  end if;
  update public.saas_usage set state = 'COMMITTED', committed_at = now(), over_allowance = v_over,
         released_at = null, release_reason = null
   where id = v_u.id;
  if v_u.funding = 'TRIAL' then
    update public.saas_trials set state = 'CONSUMED', consumed_at = now(), usage_id = v_u.id
     where user_id = p_user_id and feature = p_feature and state <> 'CONSUMED';
    perform public.saas_event(p_user_id, null, 'TRIAL_USED', null, null, 'SYSTEM', null, null,
      'trial:' || p_user_id::text || ':' || p_feature, jsonb_build_object('feature', p_feature, 'usageId', v_u.id), 'TRIAL_USED');
  end if;
  return jsonb_build_object('ok', true, 'duplicate', false, 'funding', v_u.funding, 'overAllowance', v_over);
end $$;

create or replace function public.saas_usage_release(p_user_id uuid, p_feature text, p_key text, p_reason text default 'FAILED')
returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_u public.saas_usage;
begin
  perform pg_advisory_xact_lock(hashtextextended('saas_usage:' || p_user_id::text || ':' || p_feature, 0));
  select * into v_u from public.saas_usage where user_id = p_user_id and feature = p_feature and idempotency_key = p_key for update;
  if not found then return jsonb_build_object('ok', true, 'reason', 'NOT_FOUND'); end if;
  if v_u.state <> 'RESERVED' then return jsonb_build_object('ok', true, 'duplicate', true, 'state', v_u.state); end if;
  update public.saas_usage set state = 'RELEASED', released_at = now(), release_reason = left(coalesce(p_reason, 'FAILED'), 60)
   where id = v_u.id;
  if v_u.funding = 'TRIAL' then
    update public.saas_trials set state = 'RELEASED', released_at = now()
     where user_id = p_user_id and feature = p_feature and state = 'RESERVED' and usage_id = v_u.id;
  end if;
  return jsonb_build_object('ok', true, 'duplicate', false, 'funding', v_u.funding);
end $$;

-- Stale reservations (crashed or abandoned work) go back to the customer.
create or replace function public.saas_usage_sweep(p_limit integer default 200)
returns integer
language plpgsql security definer set search_path to '' as $$
declare
  v_row record;
  v_n integer := 0;
begin
  for v_row in
    select id, user_id, feature, idempotency_key from public.saas_usage
     where state = 'RESERVED' and expires_at < now()
     order by expires_at limit greatest(coalesce(p_limit, 200), 1)
  loop
    perform public.saas_usage_release(v_row.user_id, v_row.feature, v_row.idempotency_key, 'EXPIRED');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ============================================================================
-- Lifecycle
-- ============================================================================

-- Create the checkout the provider will be asked to collect. Price from the plan row only.
create or replace function public.saas_checkout_create(p_user_id uuid, p_plan_code text, p_provider text,
                                                        p_auto_renew boolean default false)
returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_plan public.saas_plans;
  v_cur public.saas_plans;
  v_sub public.saas_subscriptions;
  v_kind text;
  v_window integer := public.billing_setting_num('saas_renewal_window_days', 3)::integer;
  v_id uuid;
begin
  if p_user_id is null then raise exception 'INVALID_ARGUMENT'; end if;
  if p_provider not in ('SANDBOX', 'BOG', 'TBC') then return jsonb_build_object('ok', false, 'reason', 'PROVIDER_UNKNOWN'); end if;
  select * into v_plan from public.saas_plans where code = p_plan_code;
  if not found or not v_plan.enabled then return jsonb_build_object('ok', false, 'reason', 'PLAN_UNAVAILABLE'); end if;
  if exists (select 1 from public.users u where u.id = p_user_id and u.suspended_at is not null) then
    return jsonb_build_object('ok', false, 'reason', 'ACCOUNT_SUSPENDED');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('saas_sub:' || p_user_id::text, 0));
  select * into v_sub from public.saas_subscriptions where user_id = p_user_id and status in ('ACTIVE', 'PAST_DUE');
  if v_sub.id is null then
    v_kind := 'NEW';
  else
    select * into v_cur from public.saas_plans where code = v_sub.plan_code;
    if v_sub.next_period_paid then return jsonb_build_object('ok', false, 'reason', 'NEXT_PERIOD_ALREADY_PAID'); end if;
    if v_plan.priority_tier > v_cur.priority_tier then
      v_kind := 'UPGRADE';
    elsif v_plan.code = coalesce(v_sub.pending_plan_code, v_sub.plan_code) then
      -- Paying for the next month: only inside the renewal window, or once it has lapsed.
      if v_sub.status = 'ACTIVE' and v_sub.current_period_end > now() + make_interval(days => v_window) then
        return jsonb_build_object('ok', false, 'reason', 'ALREADY_ACTIVE', 'currentPeriodEnd', v_sub.current_period_end);
      end if;
      v_kind := 'RENEWAL';
    else
      -- A cheaper plan is a downgrade, scheduled for the period end, never charged now.
      return jsonb_build_object('ok', false, 'reason', 'USE_DOWNGRADE');
    end if;
  end if;

  insert into public.saas_checkouts (user_id, plan_code, kind, amount_tetri, provider, subscription_id, auto_renew)
  values (p_user_id, v_plan.code, v_kind, v_plan.price_gel_tetri, p_provider, v_sub.id, coalesce(p_auto_renew, false))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'checkoutId', v_id, 'kind', v_kind, 'planCode', v_plan.code,
    'amountTetri', v_plan.price_gel_tetri, 'currency', 'GEL');
end $$;

create or replace function public.saas_checkout_attach(p_checkout_id uuid, p_provider_ref text, p_redirect_url text)
returns void language sql security definer set search_path to '' as $$
  update public.saas_checkouts
     set provider_session_ref = p_provider_ref, redirect_url = p_redirect_url, status = 'PENDING', updated_at = now()
   where id = p_checkout_id and status = 'CREATED'
$$;

-- A verified, normalised provider event. The ONLY path that grants access.
create or replace function public.saas_payment_event_apply(
  p_provider text, p_event_id text, p_type text, p_amount_tetri integer, p_currency text,
  p_reference text, p_subscription_ref text, p_summary jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_ev public.saas_payment_events;
  v_co public.saas_checkouts;
  v_sub public.saas_subscriptions;
  v_cur public.saas_plans;
  v_new public.saas_plans;
  v_result jsonb;
  v_now timestamptz := now();
  v_grace integer := public.billing_setting_num('saas_past_due_grace_days', 3)::integer;
begin
  if p_provider is null or p_event_id is null or length(p_event_id) < 4 then raise exception 'INVALID_EVENT'; end if;
  if p_type not in ('PAYMENT_SUCCEEDED', 'PAYMENT_FAILED', 'REFUNDED', 'OTHER') then raise exception 'INVALID_EVENT_TYPE'; end if;

  insert into public.saas_payment_events (provider, event_id, type, amount_tetri, currency, reference, subscription_ref, summary)
  values (p_provider, p_event_id, p_type, p_amount_tetri, upper(p_currency), p_reference, p_subscription_ref, coalesce(p_summary, '{}'::jsonb))
  on conflict (provider, event_id) do nothing
  returning * into v_ev;
  if v_ev.id is null then
    -- Replay: answer with what the first delivery decided, change nothing.
    select * into v_ev from public.saas_payment_events where provider = p_provider and event_id = p_event_id;
    return coalesce(v_ev.result, '{}'::jsonb) || jsonb_build_object('duplicate', true);
  end if;

  -- reference = our checkout id.
  if p_reference ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into v_co from public.saas_checkouts where id = p_reference::uuid and provider = p_provider for update;
  end if;
  if v_co.id is null and p_reference is not null then
    -- TBC names only its payment id; BOG renewals may come back under the bank's order id.
    select * into v_co from public.saas_checkouts where provider = p_provider and provider_session_ref = p_reference for update;
  end if;
  if v_co.id is null then
    v_result := jsonb_build_object('ok', false, 'reason', 'CHECKOUT_NOT_FOUND');
    update public.saas_payment_events set result = v_result, processed_at = now() where id = v_ev.id;
    return v_result;
  end if;
  update public.saas_payment_events set checkout_id = v_co.id where id = v_ev.id;
  perform pg_advisory_xact_lock(hashtextextended('saas_sub:' || v_co.user_id::text, 0));

  if p_type = 'PAYMENT_FAILED' then
    if v_co.status in ('CREATED', 'PENDING') then
      update public.saas_checkouts set status = 'FAILED', failure_reason = left(coalesce(p_summary->>'reason', 'PROVIDER_DECLINED'), 120), updated_at = now()
       where id = v_co.id;
      perform public.saas_event(v_co.user_id, v_co.subscription_id, 'PAYMENT_FAILED', v_co.plan_code, null, 'PROVIDER', null,
        p_summary->>'reason', 'payfail:' || p_provider || ':' || p_event_id,
        jsonb_build_object('checkoutId', v_co.id, 'amountTetri', v_co.amount_tetri), 'PAYMENT_FAILED');
    end if;
    v_result := jsonb_build_object('ok', true, 'applied', 'PAYMENT_FAILED', 'checkoutId', v_co.id);
    update public.saas_payment_events set result = v_result, processed_at = now() where id = v_ev.id;
    return v_result;
  end if;

  if p_type <> 'PAYMENT_SUCCEEDED' then
    -- Refunds and other events are recorded for admin review; access is changed by support, audited.
    v_result := jsonb_build_object('ok', true, 'applied', 'RECORDED_ONLY', 'checkoutId', v_co.id);
    update public.saas_payment_events set result = v_result, processed_at = now() where id = v_ev.id;
    return v_result;
  end if;

  if v_co.status = 'PAID' then
    v_result := jsonb_build_object('ok', true, 'applied', 'ALREADY_PAID', 'checkoutId', v_co.id);
    update public.saas_payment_events set result = v_result, processed_at = now() where id = v_ev.id;
    return v_result;
  end if;
  if p_amount_tetri is distinct from v_co.amount_tetri or upper(coalesce(p_currency, '')) <> v_co.currency then
    update public.saas_checkouts set status = 'AMOUNT_MISMATCH', failure_reason = 'amount ' || coalesce(p_amount_tetri::text, 'null') || ' ' || coalesce(p_currency, ''), updated_at = now()
     where id = v_co.id;
    v_result := jsonb_build_object('ok', false, 'reason', 'AMOUNT_MISMATCH', 'checkoutId', v_co.id);
    update public.saas_payment_events set result = v_result, processed_at = now() where id = v_ev.id;
    return v_result;
  end if;

  -- OWNER RULE (2026-10-29): a SANDBOX (test) event never grants a subscription in production.
  -- It grants only on a database where a superuser set homatch.saas_sandbox_grants = 'on'
  -- (ALTER DATABASE ... SET; a local or staging test database). No admin RPC can set it, and
  -- production never does. Otherwise the payment is recorded, labelled, and grants nothing.
  if p_provider = 'SANDBOX' and coalesce(current_setting('homatch.saas_sandbox_grants', true), '') <> 'on' then
    update public.saas_checkouts set status = 'SANDBOX_NO_GRANT', failure_reason = 'SANDBOX event: no access in this environment', updated_at = now()
     where id = v_co.id;
    v_result := jsonb_build_object('ok', true, 'applied', 'SANDBOX_RECORDED_NO_ACCESS', 'checkoutId', v_co.id, 'sandbox', true);
    update public.saas_payment_events set result = v_result, processed_at = now() where id = v_ev.id;
    return v_result;
  end if;

  select * into v_new from public.saas_plans where code = v_co.plan_code;
  select * into v_sub from public.saas_subscriptions where user_id = v_co.user_id and status in ('ACTIVE', 'PAST_DUE') for update;

  if v_sub.id is null then
    insert into public.saas_subscriptions (user_id, plan_code, status, current_period_start, current_period_end,
                                           provider, provider_subscription_ref, recurring)
    values (v_co.user_id, v_co.plan_code, 'ACTIVE', v_now, public.saas_period_end(v_now), p_provider,
            case when v_co.auto_renew then p_subscription_ref end, v_co.auto_renew and p_subscription_ref is not null)
    returning * into v_sub;
    perform public.saas_event(v_co.user_id, v_sub.id, 'ACTIVATED', v_co.plan_code, null, 'PROVIDER', null, null,
      'activated:' || v_co.id, jsonb_build_object('checkoutId', v_co.id, 'periodEnd', v_sub.current_period_end), 'SUBSCRIPTION_ACTIVATED');
  else
    select * into v_cur from public.saas_plans where code = v_sub.plan_code;
    if v_new.priority_tier > v_cur.priority_tier then
      -- UPGRADE NOW: the new plan and a fresh period start this instant, allowances reset.
      -- No proration and no refund of the unused days (documented in BILLING.md).
      update public.saas_subscriptions
         set plan_code = v_new.code, status = 'ACTIVE', current_period_start = v_now, current_period_end = public.saas_period_end(v_now),
             pending_plan_code = null, cancel_at_period_end = false, grace_until = null, updated_at = now(),
             provider = p_provider,
             provider_subscription_ref = case when v_co.auto_renew and p_subscription_ref is not null then p_subscription_ref else provider_subscription_ref end,
             recurring = recurring or (v_co.auto_renew and p_subscription_ref is not null)
       where id = v_sub.id returning * into v_sub;
      perform public.saas_event(v_co.user_id, v_sub.id, 'UPGRADED', v_new.code, v_cur.code, 'PROVIDER', null, null,
        'upgraded:' || v_co.id, jsonb_build_object('checkoutId', v_co.id, 'periodEnd', v_sub.current_period_end), 'SUBSCRIPTION_ACTIVATED');
    elsif v_sub.status = 'PAST_DUE' or v_sub.current_period_end <= v_now then
      -- Lapsed: the paid month starts now.
      update public.saas_subscriptions
         set plan_code = v_new.code, status = 'ACTIVE', current_period_start = v_now, current_period_end = public.saas_period_end(v_now),
             pending_plan_code = null, cancel_at_period_end = false, grace_until = null, updated_at = now()
       where id = v_sub.id returning * into v_sub;
      perform public.saas_event(v_co.user_id, v_sub.id, 'RENEWED', v_new.code, v_cur.code, 'PROVIDER', null, null,
        'renewed:' || v_co.id, jsonb_build_object('checkoutId', v_co.id, 'periodEnd', v_sub.current_period_end), 'SUBSCRIPTION_RENEWED');
    else
      -- Paid ahead: the tick rolls into the next period at the boundary.
      update public.saas_subscriptions
         set next_period_paid = true, next_period_plan_code = v_new.code, cancel_at_period_end = false, updated_at = now()
       where id = v_sub.id returning * into v_sub;
      perform public.saas_event(v_co.user_id, v_sub.id, 'RENEWAL_PAID', v_new.code, v_cur.code, 'PROVIDER', null, null,
        'renewal_paid:' || v_co.id, jsonb_build_object('checkoutId', v_co.id, 'from', v_sub.current_period_end), null);
    end if;
  end if;

  update public.saas_checkouts set status = 'PAID', paid_at = now(), subscription_id = v_sub.id, updated_at = now() where id = v_co.id;
  v_result := jsonb_build_object('ok', true, 'applied', 'PAYMENT_SUCCEEDED', 'checkoutId', v_co.id, 'subscriptionId', v_sub.id,
    'planCode', v_sub.plan_code, 'periodEnd', v_sub.current_period_end);
  update public.saas_payment_events set result = v_result, processed_at = now() where id = v_ev.id;
  return v_result;
end $$;

-- Period boundaries, grace, expiry. jobs-worker calls it every tick.
create or replace function public.saas_subscription_tick(p_limit integer default 200)
returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_s public.saas_subscriptions;
  v_grace integer := public.billing_setting_num('saas_past_due_grace_days', 3)::integer;
  v_renewed integer := 0; v_past_due integer := 0; v_expired integer := 0; v_downgraded integer := 0;
  v_next text;
  v_start timestamptz;
begin
  for v_s in
    select * from public.saas_subscriptions
     where (status = 'ACTIVE' and current_period_end <= now())
        or (status = 'PAST_DUE' and grace_until <= now())
     order by current_period_end limit greatest(coalesce(p_limit, 200), 1)
     for update skip locked
  loop
    if v_s.status = 'PAST_DUE' then
      update public.saas_subscriptions set status = 'EXPIRED', ended_at = now(), end_reason = 'UNPAID', updated_at = now() where id = v_s.id;
      perform public.saas_event(v_s.user_id, v_s.id, 'EXPIRED', v_s.plan_code, null, 'SYSTEM', null, 'UNPAID',
        'expired:' || v_s.id || ':' || v_s.current_period_end, '{}'::jsonb, 'SUBSCRIPTION_ENDED');
      v_expired := v_expired + 1;
    elsif v_s.cancel_at_period_end then
      update public.saas_subscriptions set status = 'EXPIRED', ended_at = now(), end_reason = 'CANCELLED', updated_at = now() where id = v_s.id;
      perform public.saas_event(v_s.user_id, v_s.id, 'EXPIRED', v_s.plan_code, null, 'SYSTEM', null, 'CANCELLED',
        'expired:' || v_s.id || ':' || v_s.current_period_end, '{}'::jsonb, 'SUBSCRIPTION_ENDED');
      v_expired := v_expired + 1;
    elsif v_s.next_period_paid then
      v_next := coalesce(v_s.next_period_plan_code, v_s.pending_plan_code, v_s.plan_code);
      v_start := v_s.current_period_end;
      update public.saas_subscriptions
         set plan_code = v_next, current_period_start = v_start, current_period_end = public.saas_period_end(v_start),
             next_period_paid = false, next_period_plan_code = null, pending_plan_code = null, updated_at = now()
       where id = v_s.id;
      if v_next <> v_s.plan_code then
        perform public.saas_event(v_s.user_id, v_s.id, 'DOWNGRADED', v_next, v_s.plan_code, 'SYSTEM', null, null,
          'downgraded:' || v_s.id || ':' || v_start, '{}'::jsonb, null);
        v_downgraded := v_downgraded + 1;
      end if;
      perform public.saas_event(v_s.user_id, v_s.id, 'RENEWED', v_next, v_s.plan_code, 'SYSTEM', null, null,
        'renewed:' || v_s.id || ':' || v_start, jsonb_build_object('periodStart', v_start), 'SUBSCRIPTION_RENEWED');
      v_renewed := v_renewed + 1;
    else
      -- Nothing paid for the next month (no provider recurring yet): PAST_DUE with grace and a pay link.
      update public.saas_subscriptions set status = 'PAST_DUE', grace_until = now() + make_interval(days => v_grace), updated_at = now()
       where id = v_s.id;
      perform public.saas_event(v_s.user_id, v_s.id, 'PAST_DUE', v_s.plan_code, null, 'SYSTEM', null, null,
        'past_due:' || v_s.id || ':' || v_s.current_period_end, jsonb_build_object('graceDays', v_grace), 'SUBSCRIPTION_PAYMENT_DUE');
      v_past_due := v_past_due + 1;
    end if;
  end loop;

  update public.saas_checkouts set status = 'EXPIRED', updated_at = now()
   where status in ('CREATED', 'PENDING') and expires_at < now() - interval '1 day';

  return jsonb_build_object('renewed', v_renewed, 'pastDue', v_past_due, 'expired', v_expired, 'downgraded', v_downgraded,
    'usageReleased', public.saas_usage_sweep(200));
end $$;

-- Reconciliation: checkouts still PENDING at a bank, re-checked against the bank by jobs-worker.
create or replace function public.saas_pending_checkouts(p_limit integer default 20)
returns table (id uuid, provider text, provider_session_ref text)
language sql stable security definer set search_path to '' as $$
  select c.id, c.provider, c.provider_session_ref from public.saas_checkouts c
   where c.status = 'PENDING' and c.provider in ('BOG', 'TBC') and c.provider_session_ref is not null
     and c.updated_at < now() - interval '2 minutes' and c.created_at > now() - interval '3 days'
   order by c.updated_at limit greatest(coalesce(p_limit, 20), 1)
$$;

-- Automatic renewal: recurring subscriptions due within a day with no renewal attempt this period.
-- One attempt per period: a failed charge is not retried automatically (the period end moves the
-- subscription to PAST_DUE and the customer pays by link), so a card is never charged twice.
create or replace function public.saas_recurring_due(p_limit integer default 20)
returns table (subscription_id uuid, user_id uuid, plan_code text, provider text, provider_subscription_ref text)
language sql stable security definer set search_path to '' as $$
  select s.id, s.user_id, coalesce(s.pending_plan_code, s.plan_code), s.provider, s.provider_subscription_ref
    from public.saas_subscriptions s
   where s.status = 'ACTIVE' and s.recurring and s.provider in ('BOG', 'TBC') and s.provider_subscription_ref is not null
     and not s.cancel_at_period_end and not s.next_period_paid
     and s.current_period_end < now() + interval '1 day'
     and not exists (select 1 from public.saas_checkouts c where c.subscription_id = s.id and c.kind = 'RENEWAL'
                      and c.created_at >= s.current_period_start)
   order by s.current_period_end limit greatest(coalesce(p_limit, 20), 1)
$$;

-- Refunds are executed at the bank by an admin (saas-checkout admin-refund) and recorded here.
-- A refund never changes access by itself; support decides that separately (audited).
create or replace function public.admin_saas_record_refund(p_checkout_id uuid, p_amount_tetri integer, p_ok boolean,
                                                          p_refund_ref text, p_reason text, p_admin uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare v_co public.saas_checkouts;
begin
  perform public.saas_require_reason(p_reason);
  select * into v_co from public.saas_checkouts where id = p_checkout_id;
  if not found then raise exception 'CHECKOUT_NOT_FOUND'; end if;
  perform public.saas_audit(coalesce(p_admin, '00000000-0000-0000-0000-000000000000'::uuid),
    case when p_ok then 'SAAS_REFUND_REQUESTED' else 'SAAS_REFUND_FAILED' end, 'saas_checkouts', p_checkout_id::text,
    jsonb_build_object('status', v_co.status, 'amountTetri', v_co.amount_tetri, 'provider', v_co.provider),
    jsonb_build_object('refundTetri', p_amount_tetri, 'refundRef', p_refund_ref), p_reason, v_co.user_id);
end $$;

-- Outbox drain for notify(): claims rows, at most once.
create or replace function public.saas_claim_notifications(p_limit integer default 25)
returns table (id uuid, user_id uuid, notify_type text, event_type text, plan_code text, payload jsonb)
language sql security definer set search_path to '' as $$
  update public.saas_subscription_events e set notified_at = now()
   where e.id in (select x.id from public.saas_subscription_events x
                   where x.notify_type is not null and x.notified_at is null
                   order by x.created_at limit greatest(coalesce(p_limit, 25), 1) for update skip locked)
  returning e.id, e.user_id, e.notify_type, e.event_type, e.plan_code, e.payload
$$;

-- ============================================================================
-- Customer actions (authenticated, own subscription only)
-- ============================================================================

create or replace function public.saas_my_subscription_action(p_action text, p_plan_code text default null)
returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_user uuid := public.saas_my_user_id();
  v_sub public.saas_subscriptions;
  v_cur public.saas_plans;
  v_target public.saas_plans;
begin
  if v_user is null then raise exception 'UNAUTHENTICATED' using errcode = 'insufficient_privilege'; end if;
  perform pg_advisory_xact_lock(hashtextextended('saas_sub:' || v_user::text, 0));
  select * into v_sub from public.saas_subscriptions where user_id = v_user and status in ('ACTIVE', 'PAST_DUE') for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'NO_SUBSCRIPTION'); end if;
  select * into v_cur from public.saas_plans where code = v_sub.plan_code;

  if p_action = 'CANCEL' then
    if v_sub.next_period_paid then return jsonb_build_object('ok', false, 'reason', 'NEXT_PERIOD_ALREADY_PAID'); end if;
    update public.saas_subscriptions set cancel_at_period_end = true, pending_plan_code = null, updated_at = now() where id = v_sub.id;
    perform public.saas_event(v_user, v_sub.id, 'CANCEL_REQUESTED', v_sub.plan_code, null, 'USER', v_user, null,
      'cancel:' || v_sub.id || ':' || extract(epoch from now())::bigint, jsonb_build_object('activeUntil', v_sub.current_period_end), null);
  elsif p_action = 'UNDO_CANCEL' then
    update public.saas_subscriptions set cancel_at_period_end = false, updated_at = now() where id = v_sub.id;
    perform public.saas_event(v_user, v_sub.id, 'CANCEL_UNDONE', v_sub.plan_code, null, 'USER', v_user, null,
      'uncancel:' || v_sub.id || ':' || extract(epoch from now())::bigint, '{}'::jsonb, null);
  elsif p_action = 'DOWNGRADE' then
    select * into v_target from public.saas_plans where code = p_plan_code and enabled;
    if not found then return jsonb_build_object('ok', false, 'reason', 'PLAN_UNAVAILABLE'); end if;
    if v_target.priority_tier >= v_cur.priority_tier then return jsonb_build_object('ok', false, 'reason', 'NOT_A_DOWNGRADE'); end if;
    if v_sub.next_period_paid then return jsonb_build_object('ok', false, 'reason', 'NEXT_PERIOD_ALREADY_PAID'); end if;
    update public.saas_subscriptions set pending_plan_code = v_target.code, cancel_at_period_end = false, updated_at = now() where id = v_sub.id;
    perform public.saas_event(v_user, v_sub.id, 'DOWNGRADE_SCHEDULED', v_target.code, v_sub.plan_code, 'USER', v_user, null,
      'downgrade:' || v_sub.id || ':' || extract(epoch from now())::bigint, jsonb_build_object('from', v_sub.current_period_end), null);
  elsif p_action = 'UNDO_DOWNGRADE' then
    update public.saas_subscriptions set pending_plan_code = null, updated_at = now() where id = v_sub.id;
    perform public.saas_event(v_user, v_sub.id, 'DOWNGRADE_CANCELLED', v_sub.plan_code, null, 'USER', v_user, null,
      'undowngrade:' || v_sub.id || ':' || extract(epoch from now())::bigint, '{}'::jsonb, null);
  else
    raise exception 'INVALID_ACTION';
  end if;
  return jsonb_build_object('ok', true, 'action', p_action);
end $$;

-- ============================================================================
-- What the UI reads
-- ============================================================================

create or replace function public.saas_public_plans()
returns jsonb
language sql stable security definer set search_path to '' as $$
  select jsonb_build_object(
    'currency', 'GEL',
    'plans', coalesce((select jsonb_agg(jsonb_build_object(
        'code', p.code, 'name', p.name, 'priceTetri', p.price_gel_tetri, 'currency', p.currency,
        'vatInclusive', p.vat_inclusive, 'priorityTier', p.priority_tier,
        'entitlements', (select jsonb_object_agg(e.feature, jsonb_build_object(
              'enabled', e.enabled, 'limit', e.limit_per_period, 'unlimited', e.unlimited))
            from public.saas_plan_entitlements e where e.plan_code = p.code))
      order by p.sort_order) from public.saas_plans p where p.enabled), '[]'::jsonb),
    'trials', coalesce((select jsonb_agg(f.feature order by f.sort_order) from public.saas_features f
                         where f.trial_enabled and f.kind = 'QUOTA'), '[]'::jsonb))
$$;

create or replace function public.saas_entitlement_status(p_user_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare
  v_sub public.saas_subscriptions;
  v_any public.saas_subscriptions;
  v_features jsonb := '[]'::jsonb;
  v_f record;
  v_used integer;
  v_balance numeric;
  v_eligible boolean := public.saas_account_eligible(p_user_id);
begin
  v_sub := public.saas_live_subscription(p_user_id);
  select * into v_any from public.saas_subscriptions where user_id = p_user_id and status in ('ACTIVE', 'PAST_DUE') order by created_at desc limit 1;
  for v_f in
    select f.*, e.enabled as e_enabled, e.limit_per_period, e.unlimited, t.state as trial_state
      from public.saas_features f
      left join public.saas_plan_entitlements e on e.feature = f.feature and e.plan_code = v_sub.plan_code
      left join public.saas_trials t on t.user_id = p_user_id and t.feature = f.feature
     order by f.sort_order
  loop
    v_used := 0;
    if v_sub.id is not null and v_f.kind = 'QUOTA' then
      select count(*) into v_used from public.saas_usage u
       where u.subscription_id = v_sub.id and u.feature = v_f.feature and u.funding = 'PLAN'
         and u.period_start = v_sub.current_period_start and u.state in ('RESERVED', 'COMMITTED');
    end if;
    v_features := v_features || jsonb_build_object(
      'feature', v_f.feature, 'kind', v_f.kind,
      'included', coalesce(v_f.e_enabled, false) and v_sub.id is not null,
      'unlimited', coalesce(v_f.unlimited, false) and coalesce(v_f.e_enabled, false) and v_sub.id is not null,
      'limit', case when v_sub.id is not null and coalesce(v_f.e_enabled, false) and not coalesce(v_f.unlimited, false) then v_f.limit_per_period end,
      'used', v_used,
      'remaining', case when v_sub.id is null or not coalesce(v_f.e_enabled, false) then 0
                        when v_f.unlimited then null
                        else greatest(coalesce(v_f.limit_per_period, 0) - v_used, 0) end,
      'trialEnabled', v_f.trial_enabled,
      'trialState', coalesce(v_f.trial_state, 'UNUSED'),
      'trialAvailable', v_f.trial_enabled and v_eligible and coalesce(v_f.trial_state, 'RELEASED') = 'RELEASED');
  end loop;
  select coalesce(ca.balance, 0) into v_balance from public.credit_accounts ca where ca.user_id = p_user_id;
  return jsonb_build_object(
    'plan', coalesce(v_sub.plan_code, 'FREE'),
    'subscription', case when v_any.id is null then null else jsonb_build_object(
        'id', v_any.id, 'planCode', v_any.plan_code, 'status', v_any.status,
        'hasAccess', v_sub.id is not null,
        'currentPeriodStart', v_any.current_period_start, 'currentPeriodEnd', v_any.current_period_end,
        'cancelAtPeriodEnd', v_any.cancel_at_period_end, 'pendingPlanCode', v_any.pending_plan_code,
        'nextPeriodPaid', v_any.next_period_paid, 'nextPeriodPlanCode', v_any.next_period_plan_code,
        'graceUntil', v_any.grace_until, 'recurring', v_any.recurring,
        'renewalOpensAt', v_any.current_period_end - make_interval(days => public.billing_setting_num('saas_renewal_window_days', 3)::integer)) end,
    'features', v_features,
    'accountEligibleForTrials', v_eligible,
    'legacyBalance', coalesce(v_balance, 0),
    'hasLegacyBalance', coalesce(v_balance, 0) > 0);
end $$;

-- The one function the UI reads for "what may I do".
create or replace function public.entitlement_status_for_me()
returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare
  v_user uuid := public.saas_my_user_id();
begin
  if v_user is null then raise exception 'UNAUTHENTICATED' using errcode = 'insufficient_privilege'; end if;
  return public.saas_entitlement_status(v_user);
end $$;

-- ============================================================================
-- Admin: plans, entitlements, trials, settings, support overrides. All audited.
-- ============================================================================

create or replace function public.saas_admin_actor()
returns uuid language plpgsql stable security definer set search_path to '' as $$
declare v uuid;
begin
  select u.id into v from public.users u where u.auth_id = auth.uid() and u.is_admin = true;
  if v is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'FORBIDDEN' using errcode = 'insufficient_privilege';
  end if;
  return coalesce(v, '00000000-0000-0000-0000-000000000000'::uuid);
end $$;

create or replace function public.saas_audit(p_admin uuid, p_action text, p_entity_type text, p_entity_id text,
                                            p_old jsonb, p_new jsonb, p_reason text, p_target uuid default null)
returns void language sql security definer set search_path to '' as $$
  insert into public.admin_audit_log (admin_id, target_id, action, entity_type, entity_id, metadata)
  values (p_admin, p_target, p_action, p_entity_type, p_entity_id,
          jsonb_build_object('old', p_old, 'new', p_new, 'reason', btrim(p_reason), 'at', now()))
$$;

create or replace function public.saas_require_reason(p_reason text)
returns void language plpgsql immutable set search_path to '' as $$
begin
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
end $$;

create or replace function public.admin_saas_set_plan(p_code text, p_price_tetri integer, p_enabled boolean,
                                                      p_priority_tier integer, p_reason text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_admin uuid := public.saas_admin_actor();
  v_old public.saas_plans;
  v_new public.saas_plans;
begin
  perform public.saas_require_reason(p_reason);
  select * into v_old from public.saas_plans where code = p_code for update;
  if not found then raise exception 'PLAN_NOT_FOUND'; end if;
  if p_price_tetri is not null and (p_price_tetri <= 0 or p_price_tetri > 10000000) then raise exception 'INVALID_PRICE'; end if;
  if p_priority_tier is not null and (p_priority_tier < 1 or p_priority_tier > 100) then raise exception 'INVALID_PRIORITY'; end if;
  update public.saas_plans
     set price_gel_tetri = coalesce(p_price_tetri, price_gel_tetri), enabled = coalesce(p_enabled, enabled),
         priority_tier = coalesce(p_priority_tier, priority_tier), updated_at = now(), updated_by = v_admin
   where code = p_code returning * into v_new;
  perform public.saas_audit(v_admin, 'SAAS_PLAN_UPDATED', 'saas_plans', p_code, to_jsonb(v_old), to_jsonb(v_new), p_reason);
  return to_jsonb(v_new);
end $$;

create or replace function public.admin_saas_set_entitlement(p_plan text, p_feature text, p_enabled boolean,
                                                             p_limit integer, p_unlimited boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_admin uuid := public.saas_admin_actor();
  v_old public.saas_plan_entitlements;
  v_new public.saas_plan_entitlements;
begin
  perform public.saas_require_reason(p_reason);
  if not exists (select 1 from public.saas_plans where code = p_plan) then raise exception 'PLAN_NOT_FOUND'; end if;
  if not exists (select 1 from public.saas_features where feature = p_feature) then raise exception 'FEATURE_UNKNOWN'; end if;
  if p_limit is not null and (p_limit < 0 or p_limit > 100000) then raise exception 'INVALID_LIMIT'; end if;
  if not coalesce(p_unlimited, false) and p_limit is null then raise exception 'LIMIT_REQUIRED'; end if;
  select * into v_old from public.saas_plan_entitlements where plan_code = p_plan and feature = p_feature for update;
  insert into public.saas_plan_entitlements (plan_code, feature, enabled, limit_per_period, unlimited, updated_by)
  values (p_plan, p_feature, coalesce(p_enabled, true), case when coalesce(p_unlimited, false) then null else p_limit end,
          coalesce(p_unlimited, false), v_admin)
  on conflict (plan_code, feature) do update
    set enabled = excluded.enabled, limit_per_period = excluded.limit_per_period, unlimited = excluded.unlimited,
        updated_at = now(), updated_by = v_admin
  returning * into v_new;
  perform public.saas_audit(v_admin, 'SAAS_ENTITLEMENT_UPDATED', 'saas_plan_entitlements', p_plan || ':' || p_feature,
                            to_jsonb(v_old), to_jsonb(v_new), p_reason);
  return to_jsonb(v_new);
end $$;

create or replace function public.admin_saas_set_trial(p_feature text, p_enabled boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_admin uuid := public.saas_admin_actor();
  v_old public.saas_features;
  v_new public.saas_features;
begin
  perform public.saas_require_reason(p_reason);
  select * into v_old from public.saas_features where feature = p_feature for update;
  if not found or v_old.kind <> 'QUOTA' then raise exception 'FEATURE_UNKNOWN'; end if;
  update public.saas_features set trial_enabled = coalesce(p_enabled, false), updated_at = now(), updated_by = v_admin
   where feature = p_feature returning * into v_new;
  perform public.saas_audit(v_admin, 'SAAS_TRIAL_UPDATED', 'saas_features', p_feature, to_jsonb(v_old), to_jsonb(v_new), p_reason);
  return to_jsonb(v_new);
end $$;

create or replace function public.admin_saas_set_setting(p_key text, p_value jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_admin uuid := public.saas_admin_actor();
  v_old jsonb;
begin
  perform public.saas_require_reason(p_reason);
  if p_key not in ('saas_past_due_grace_days', 'saas_renewal_window_days', 'saas_sandbox_payments_enabled', 'saas_default_payment_provider') then
    raise exception 'SETTING_NOT_EDITABLE';
  end if;
  if p_key in ('saas_past_due_grace_days', 'saas_renewal_window_days')
     and (jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric < 0 or (p_value #>> '{}')::numeric > 30) then
    raise exception 'INVALID_VALUE';
  end if;
  if p_key = 'saas_sandbox_payments_enabled' and jsonb_typeof(p_value) <> 'boolean' then raise exception 'INVALID_VALUE'; end if;
  -- SANDBOX can never be the provider customers are sent to.
  if p_key = 'saas_default_payment_provider' and (p_value #>> '{}') not in ('NONE', 'BOG', 'TBC') then raise exception 'INVALID_VALUE'; end if;
  select value into v_old from public.admin_settings where key = p_key;
  insert into public.admin_settings (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value;
  perform public.saas_audit(v_admin, 'SAAS_SETTING_UPDATED', 'admin_settings', p_key, v_old, p_value, p_reason);
  return jsonb_build_object('key', p_key, 'value', p_value);
end $$;

-- Support: grant a plan for N days without payment (or extend / cancel). Reason mandatory.
create or replace function public.admin_saas_support(p_action text, p_user_id uuid, p_plan text default null,
                                                     p_days integer default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_admin uuid := public.saas_admin_actor();
  v_sub public.saas_subscriptions;
  v_old jsonb;
  v_now timestamptz := now();
begin
  perform public.saas_require_reason(p_reason);
  if p_user_id is null or not exists (select 1 from public.users where id = p_user_id) then raise exception 'USER_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('saas_sub:' || p_user_id::text, 0));
  select * into v_sub from public.saas_subscriptions where user_id = p_user_id and status in ('ACTIVE', 'PAST_DUE') for update;
  v_old := to_jsonb(v_sub);

  if p_action = 'GRANT' then
    if p_days is null or p_days < 1 or p_days > 366 then raise exception 'INVALID_DAYS'; end if;
    if not exists (select 1 from public.saas_plans where code = p_plan) then raise exception 'PLAN_NOT_FOUND'; end if;
    if v_sub.id is not null then raise exception 'ALREADY_SUBSCRIBED'; end if;
    insert into public.saas_subscriptions (user_id, plan_code, status, current_period_start, current_period_end, provider)
    values (p_user_id, p_plan, 'ACTIVE', v_now, v_now + make_interval(days => p_days), 'ADMIN')
    returning * into v_sub;
    perform public.saas_event(p_user_id, v_sub.id, 'ADMIN_GRANTED', p_plan, null, 'ADMIN', v_admin, p_reason,
      'admin_grant:' || v_sub.id, jsonb_build_object('days', p_days), 'SUBSCRIPTION_ACTIVATED');
  elsif p_action = 'EXTEND' then
    if v_sub.id is null then raise exception 'NO_SUBSCRIPTION'; end if;
    if p_days is null or p_days < 1 or p_days > 366 then raise exception 'INVALID_DAYS'; end if;
    update public.saas_subscriptions
       set current_period_end = greatest(current_period_end, v_now) + make_interval(days => p_days),
           status = 'ACTIVE', grace_until = null, updated_at = now()
     where id = v_sub.id returning * into v_sub;
    perform public.saas_event(p_user_id, v_sub.id, 'ADMIN_EXTENDED', v_sub.plan_code, null, 'ADMIN', v_admin, p_reason,
      'admin_extend:' || v_sub.id || ':' || extract(epoch from clock_timestamp())::text, jsonb_build_object('days', p_days), null);
  elsif p_action = 'CANCEL_NOW' then
    if v_sub.id is null then raise exception 'NO_SUBSCRIPTION'; end if;
    update public.saas_subscriptions set status = 'EXPIRED', ended_at = now(), end_reason = 'ADMIN', updated_at = now()
     where id = v_sub.id returning * into v_sub;
    perform public.saas_event(p_user_id, v_sub.id, 'ADMIN_CANCELLED', v_sub.plan_code, null, 'ADMIN', v_admin, p_reason,
      'admin_cancel:' || v_sub.id, '{}'::jsonb, 'SUBSCRIPTION_ENDED');
  elsif p_action = 'CANCEL_AT_PERIOD_END' then
    if v_sub.id is null then raise exception 'NO_SUBSCRIPTION'; end if;
    update public.saas_subscriptions set cancel_at_period_end = true, next_period_paid = false, updated_at = now()
     where id = v_sub.id returning * into v_sub;
    perform public.saas_event(p_user_id, v_sub.id, 'CANCEL_REQUESTED', v_sub.plan_code, null, 'ADMIN', v_admin, p_reason,
      'admin_cancel_end:' || v_sub.id || ':' || extract(epoch from clock_timestamp())::text, '{}'::jsonb, null);
  else
    raise exception 'INVALID_ACTION';
  end if;
  perform public.saas_audit(v_admin, 'SAAS_SUPPORT_' || p_action, 'saas_subscriptions', v_sub.id::text, v_old, to_jsonb(v_sub), p_reason, p_user_id);
  return to_jsonb(v_sub);
end $$;

create or replace function public.admin_saas_overview()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  perform public.saas_admin_actor();
  return jsonb_build_object(
    'plans', (select coalesce(jsonb_agg(to_jsonb(p) order by p.sort_order), '[]'::jsonb) from public.saas_plans p),
    'features', (select coalesce(jsonb_agg(to_jsonb(f) order by f.sort_order), '[]'::jsonb) from public.saas_features f),
    'entitlements', (select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) from public.saas_plan_entitlements e),
    'settings', (select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb) from public.admin_settings s
                  where s.key in ('saas_past_due_grace_days', 'saas_renewal_window_days', 'saas_sandbox_payments_enabled', 'saas_default_payment_provider')),
    'sandboxGrantsAccess', coalesce(current_setting('homatch.saas_sandbox_grants', true), '') = 'on',
    'counts', jsonb_build_object(
       'active', (select count(*) from public.saas_subscriptions where status = 'ACTIVE'),
       'pastDue', (select count(*) from public.saas_subscriptions where status = 'PAST_DUE'),
       'expired', (select count(*) from public.saas_subscriptions where status = 'EXPIRED'),
       'trialsConsumed', (select count(*) from public.saas_trials where state = 'CONSUMED')));
end $$;

create or replace function public.admin_saas_subscriptions(p_search text default null, p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  perform public.saas_admin_actor();
  return coalesce((select jsonb_agg(r) from (
    select s.id, s.user_id, u.email, s.plan_code, s.status, s.current_period_start, s.current_period_end,
           s.cancel_at_period_end, s.pending_plan_code, s.next_period_paid, s.grace_until, s.provider, s.created_at
      from public.saas_subscriptions s join public.users u on u.id = s.user_id
     where p_search is null or u.email ilike '%' || p_search || '%' or s.user_id::text = p_search
     order by s.updated_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) r), '[]'::jsonb);
end $$;

create or replace function public.admin_saas_payment_events(p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  perform public.saas_admin_actor();
  return coalesce((select jsonb_agg(r) from (
    select e.id, e.provider, e.is_test, e.event_id, e.type, e.amount_tetri, e.currency, e.reference, e.checkout_id, e.result,
           e.received_at, e.processed_at, c.user_id, c.plan_code, c.status as checkout_status
      from public.saas_payment_events e left join public.saas_checkouts c on c.id = e.checkout_id
     order by e.received_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) r), '[]'::jsonb);
end $$;

create or replace function public.admin_saas_audit(p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  perform public.saas_admin_actor();
  return coalesce((select jsonb_agg(r) from (
    select a.id, a.admin_id, a.target_id, a.action, a.entity_id, a.metadata, a.created_at
      from public.admin_audit_log a where a.action like 'SAAS\_%'
     order by a.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) r), '[]'::jsonb);
end $$;

-- ── Grants ──────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'saas_period_end(timestamptz)', 'saas_account_eligible(uuid)', 'saas_live_subscription(uuid)',
    'saas_user_has_feature(uuid, text)', 'saas_my_user_id()',
    'saas_event(uuid, uuid, text, text, text, text, uuid, text, text, jsonb, text)',
    'saas_usage_begin(uuid, text, text, text, boolean)', 'saas_usage_commit(uuid, text, text)',
    'saas_usage_release(uuid, text, text, text)', 'saas_usage_sweep(integer)',
    'saas_checkout_create(uuid, text, text, boolean)', 'saas_checkout_attach(uuid, text, text)',
    'saas_payment_event_apply(text, text, text, integer, text, text, text, jsonb)',
    'saas_subscription_tick(integer)', 'saas_claim_notifications(integer)',
    'saas_pending_checkouts(integer)', 'saas_recurring_due(integer)',
    'admin_saas_record_refund(uuid, integer, boolean, text, text, uuid)',
    'saas_my_subscription_action(text, text)', 'saas_public_plans()', 'saas_entitlement_status(uuid)',
    'entitlement_status_for_me()', 'saas_admin_actor()', 'saas_audit(uuid, text, text, text, jsonb, jsonb, text, uuid)',
    'saas_require_reason(text)',
    'admin_saas_set_plan(text, integer, boolean, integer, text)',
    'admin_saas_set_entitlement(text, text, boolean, integer, boolean, text)',
    'admin_saas_set_trial(text, boolean, text)', 'admin_saas_set_setting(text, jsonb, text)',
    'admin_saas_support(text, uuid, text, integer, text)', 'admin_saas_overview()',
    'admin_saas_subscriptions(text, integer)', 'admin_saas_payment_events(integer)', 'admin_saas_audit(integer)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

grant execute on function public.saas_public_plans() to anon, authenticated;
grant execute on function public.entitlement_status_for_me() to authenticated;
grant execute on function public.saas_my_subscription_action(text, text) to authenticated;
grant execute on function public.admin_saas_set_plan(text, integer, boolean, integer, text) to authenticated;
grant execute on function public.admin_saas_set_entitlement(text, text, boolean, integer, boolean, text) to authenticated;
grant execute on function public.admin_saas_set_trial(text, boolean, text) to authenticated;
grant execute on function public.admin_saas_set_setting(text, jsonb, text) to authenticated;
grant execute on function public.admin_saas_support(text, uuid, text, integer, text) to authenticated;
grant execute on function public.admin_saas_overview() to authenticated;
grant execute on function public.admin_saas_subscriptions(text, integer) to authenticated;
grant execute on function public.admin_saas_payment_events(integer) to authenticated;
grant execute on function public.admin_saas_audit(integer) to authenticated;
