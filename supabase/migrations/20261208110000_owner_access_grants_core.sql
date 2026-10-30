-- ============================================================================
-- OWNER UNLIMITED + ADMIN ACCESS GRANTS (1/2): data model and the one resolver.
--
-- Owner requirement (2026-10-30): the HOMATCH owner account has permanent,
-- server-side Unlimited access to every included internal service (Verify,
-- Contract Analysis, internal lead unlock, HOMI, internal search/matching)
-- without a subscription, allowance or credits, through the same routes and
-- pipelines as any customer. Admins can give other accounts audited access
-- grants (Unlimited, a plan as a MANUAL grant, or custom per-feature limits),
-- temporary or permanent.
--
-- ONE RESOLVER: saas_access_resolve(user, feature). Every gated path reads it:
-- saas_usage_begin (reserve), saas_usage_preview (quotes, badges),
-- saas_user_has_feature (internal lead unlock), saas_entitlement_status (UI),
-- verify_billing_open (Verify wrapper), contract analysis (preview + edge).
--
-- PRECEDENCE (deterministic):
--   1. OWNER   platform_owner row, features with saas_features.internal_included
--   2. GRANT   an active admin access grant that covers the feature (see below)
--   3. TRIAL   eligible first-use trial (QUOTA features)       } live order kept:
--   4. PLAN    allowance of the live paid subscription period  } trial, then plan
--   5. LEGACY_CREDITS (QUOTA, positive legacy balance only)
--   6. NONE    SUBSCRIPTION_REQUIRED / ALLOWANCE_EXHAUSTED
-- OWNER and GRANT uses are recorded in saas_usage (funding OWNER / GRANT) for
-- history and never consume a trial, a plan allowance or legacy credits.
--
-- GRANT OVERLAP: among the user's ACTIVE grants inside their validity window
-- that carry an allowance row for the feature:
--   a) an unlimited row wins; between several, permanent first, then the latest
--      expiry, then the oldest grant, then the id;
--   b) otherwise the limited row with capacity left whose grant expires FIRST
--      (permanent last) is used, then oldest grant, then id;
--   c) every limited row exhausted -> fall through to TRIAL / PLAN / LEGACY,
--      and a final refusal says ALLOWANCE_EXHAUSTED.
-- A grant's allowance window: TOTAL = since counted_since (a reset moves it);
-- MONTHLY = the Tbilisi calendar month anchored at the grant start, never
-- earlier than counted_since.
--
-- Pass-through costs are NOT included anywhere here: Find Property / Find
-- Buyers external discovery budgets, Meta Ads spend, Design Studio GPU renders
-- keep their wallet / explicit-budget paths and safeguards.
-- ============================================================================

-- ── 1. The owner: a protected singleton marker, not an email, not a client flag ──
create table if not exists public.platform_owner (
  user_id uuid primary key references public.users(id) on delete restrict,
  singleton boolean not null default true unique check (singleton),
  designated_at timestamptz not null default now(),
  designated_by text not null,
  note text
);
alter table public.platform_owner enable row level security;
revoke all on public.platform_owner from anon, authenticated;

-- The owner entitlement cannot be revoked, transferred or expire by accident: changing the row
-- needs a deliberate session switch (a reviewed migration that sets homatch.owner_transfer = 'on').
create or replace function public.platform_owner_guard()
returns trigger language plpgsql set search_path to '' as $$
begin
  if coalesce(current_setting('homatch.owner_transfer', true), '') <> 'on' then
    raise exception 'OWNER_PROTECTED' using errcode = 'insufficient_privilege';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists platform_owner_guard_row on public.platform_owner;
create trigger platform_owner_guard_row before update or delete on public.platform_owner
  for each row execute function public.platform_owner_guard();
drop trigger if exists platform_owner_guard_truncate on public.platform_owner;
create trigger platform_owner_guard_truncate before truncate on public.platform_owner
  for each statement execute function public.platform_owner_guard();

-- Seed: production's owner account, found read-only on 2026-10-30 as the ONLY users.is_admin
-- account (all 41 admin_audit_log actions to date). Seeded by its permanent id, and only when that
-- row exists and is still an admin; on any other database this is a no-op.
insert into public.platform_owner (user_id, designated_by, note)
select u.id, 'MIGRATION 20261208110000', 'Sole admin account at designation (owner requirement 2026-10-30)'
  from public.users u
 where u.id = '5157044e-9158-437a-86a2-e34d5ada82f7'::uuid and u.is_admin
   and not exists (select 1 from public.platform_owner)
on conflict do nothing;

create or replace function public.saas_is_owner(p_user_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select p_user_id is not null and exists (select 1 from public.platform_owner o where o.user_id = p_user_id)
$$;

-- ── 2. Which features count as "included internal services" ────────────────
alter table public.saas_features add column if not exists internal_included boolean not null default true;
-- Premium discovery is not wired yet and may spend on external providers: never implied by
-- owner / Unlimited. A custom grant can still name it explicitly.
update public.saas_features set internal_included = false where feature = 'PREMIUM_DISCOVERY';

-- ── 3. Admin access grants ──────────────────────────────────────────────────
create table if not exists public.saas_access_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  -- UNLIMITED: every included feature, unlimited. PLAN: a plan's allowances as a MANUAL grant
  -- (never a payment). CUSTOM: the allowance rows the admin chose.
  kind text not null check (kind in ('UNLIMITED', 'PLAN', 'CUSTOM')),
  plan_code text references public.saas_plans(code),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVOKED')),
  starts_at timestamptz not null default now(),
  -- NULL = permanent.
  expires_at timestamptz,
  reason text not null check (length(btrim(reason)) >= 3),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  revoked_by uuid,
  revoked_at timestamptz,
  revoke_reason text,
  constraint saas_access_grants_plan check ((kind = 'PLAN') = (plan_code is not null)),
  constraint saas_access_grants_window check (expires_at is null or expires_at > starts_at)
);
create index if not exists idx_saas_access_grants_user on public.saas_access_grants(user_id) where status = 'ACTIVE';

create table if not exists public.saas_access_grant_allowances (
  grant_id uuid not null references public.saas_access_grants(id) on delete cascade,
  feature text not null references public.saas_features(feature),
  unlimited boolean not null default false,
  limit_count integer check (limit_count is null or limit_count between 0 and 100000),
  period text not null default 'TOTAL' check (period in ('TOTAL', 'MONTHLY')),
  -- Uses before this instant do not count (an admin reset moves it to now()).
  counted_since timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (grant_id, feature),
  constraint saas_access_grant_allowances_shape check (unlimited or limit_count is not null)
);

-- Every change: actor, target, previous, new, reason, time, expiry.
create table if not exists public.saas_access_events (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid references public.saas_access_grants(id) on delete set null,
  target_user_id uuid not null references public.users(id) on delete cascade,
  actor_id uuid not null,
  action text not null check (action in ('GRANTED', 'MODIFIED', 'REVOKED', 'ALLOWANCE_RESET', 'REFUSED_OWNER')),
  previous jsonb,
  new jsonb,
  reason text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_saas_access_events_target on public.saas_access_events(target_user_id, created_at desc);

alter table public.saas_access_grants enable row level security;
alter table public.saas_access_grant_allowances enable row level security;
alter table public.saas_access_events enable row level security;
drop policy if exists saas_access_grants_read on public.saas_access_grants;
create policy saas_access_grants_read on public.saas_access_grants for select to authenticated
  using (user_id = public.auth_user_id() or public.is_admin());
drop policy if exists saas_access_grant_allowances_read on public.saas_access_grant_allowances;
create policy saas_access_grant_allowances_read on public.saas_access_grant_allowances for select to authenticated
  using (exists (select 1 from public.saas_access_grants g where g.id = grant_id
                  and (g.user_id = public.auth_user_id() or public.is_admin())));
drop policy if exists saas_access_events_admin on public.saas_access_events;
create policy saas_access_events_admin on public.saas_access_events for select to authenticated using (public.is_admin());
revoke insert, update, delete, truncate on public.saas_access_grants, public.saas_access_grant_allowances,
  public.saas_access_events from anon, authenticated;

-- ── 4. Usage ledger: OWNER / GRANT funding, the grant that paid ─────────────
alter table public.saas_usage drop constraint if exists saas_usage_funding_check;
alter table public.saas_usage add constraint saas_usage_funding_check check (funding in ('TRIAL', 'PLAN', 'OWNER', 'GRANT'));
alter table public.saas_usage add column if not exists grant_id uuid references public.saas_access_grants(id) on delete set null;
create index if not exists idx_saas_usage_grant
  on public.saas_usage(grant_id, feature, period_start) where state in ('RESERVED', 'COMMITTED');

-- The start of the MONTHLY window containing p_at, anchored at p_anchor (Tbilisi calendar months,
-- the same arithmetic as saas_period_end).
create or replace function public.saas_grant_period_start(p_anchor timestamptz, p_at timestamptz)
returns timestamptz language plpgsql immutable set search_path to '' as $$
declare
  a timestamp := p_anchor at time zone 'Asia/Tbilisi';
  n timestamp := p_at at time zone 'Asia/Tbilisi';
  m integer;
begin
  if p_at <= p_anchor then return p_anchor; end if;
  m := (extract(year from n)::integer - extract(year from a)::integer) * 12
       + extract(month from n)::integer - extract(month from a)::integer;
  while m > 0 and a + make_interval(months => m) > n loop m := m - 1; end loop;
  return (a + make_interval(months => m)) at time zone 'Asia/Tbilisi';
end $$;

-- The grant allowance that funds p_feature now (rule a / b above), or the exhausted marker.
create or replace function public.saas_access_grant_pick(p_user_id uuid, p_feature text)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  r record;
  v_used integer;
  v_exhausted boolean := false;
begin
  for r in
    select g.id, g.kind, g.plan_code, g.starts_at, g.expires_at, a.unlimited, a.limit_count, a.period,
           case when a.period = 'MONTHLY' then greatest(a.counted_since, public.saas_grant_period_start(g.starts_at, now()))
                else a.counted_since end as window_start
      from public.saas_access_grants g
      join public.saas_access_grant_allowances a on a.grant_id = g.id and a.feature = p_feature
     where g.user_id = p_user_id and g.status = 'ACTIVE' and g.starts_at <= now()
       and (g.expires_at is null or g.expires_at > now())
     order by a.unlimited desc,
              case when a.unlimited then g.expires_at end desc nulls first,
              case when not a.unlimited then g.expires_at end asc nulls last,
              g.created_at, g.id
  loop
    if r.unlimited then
      return jsonb_build_object('grantId', r.id, 'grantKind', r.kind, 'grantPlanCode', r.plan_code, 'unlimited', true,
        'limit', null, 'used', null, 'remaining', null, 'period', r.period, 'windowStart', r.window_start,
        'expiresAt', r.expires_at, 'permanent', r.expires_at is null);
    end if;
    select count(*) into v_used from public.saas_usage u
     where u.grant_id = r.id and u.feature = p_feature and u.funding = 'GRANT'
       and u.period_start = r.window_start and u.state in ('RESERVED', 'COMMITTED');
    if v_used < r.limit_count then
      return jsonb_build_object('grantId', r.id, 'grantKind', r.kind, 'grantPlanCode', r.plan_code, 'unlimited', false,
        'limit', r.limit_count, 'used', v_used, 'remaining', r.limit_count - v_used, 'period', r.period,
        'windowStart', r.window_start, 'expiresAt', r.expires_at, 'permanent', r.expires_at is null);
    end if;
    v_exhausted := true;
  end loop;
  if v_exhausted then return jsonb_build_object('exhausted', true); end if;
  return null;
end $$;

-- ── 5. THE resolver ─────────────────────────────────────────────────────────
create or replace function public.saas_access_resolve(p_user_id uuid, p_feature text)
returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare
  v_f public.saas_features;
  v_t public.saas_trials;
  v_sub public.saas_subscriptions;
  v_e public.saas_plan_entitlements;
  v_grant jsonb;
  v_used integer := 0;
  v_balance numeric;
  v_eligible boolean;
  v_exhausted boolean := false;
begin
  select * into v_f from public.saas_features where feature = p_feature;
  if not found then return jsonb_build_object('funding', 'NONE', 'reason', 'FEATURE_UNKNOWN'); end if;
  if p_user_id is null then return jsonb_build_object('funding', 'NONE', 'reason', 'SUBSCRIPTION_REQUIRED'); end if;

  -- 1. Owner.
  if v_f.internal_included and public.saas_is_owner(p_user_id) then
    return jsonb_build_object('funding', 'OWNER', 'unlimited', true, 'kind', v_f.kind);
  end if;

  -- 2. Admin access grant.
  v_grant := public.saas_access_grant_pick(p_user_id, p_feature);
  if v_grant is not null and v_grant ? 'grantId' then
    return jsonb_build_object('funding', 'GRANT', 'kind', v_f.kind) || v_grant;
  end if;
  v_exhausted := v_grant is not null;

  -- 3. First-use trial (QUOTA only).
  v_eligible := public.saas_account_eligible(p_user_id);
  if v_f.kind = 'QUOTA' and v_f.trial_enabled and v_eligible then
    select * into v_t from public.saas_trials where user_id = p_user_id and feature = p_feature;
    if not found or v_t.state = 'RELEASED' then return jsonb_build_object('funding', 'TRIAL', 'kind', v_f.kind); end if;
  end if;

  -- 4. Plan of the live paid subscription.
  v_sub := public.saas_live_subscription(p_user_id);
  if v_sub.id is not null then
    select * into v_e from public.saas_plan_entitlements where plan_code = v_sub.plan_code and feature = p_feature;
    if found and v_e.enabled and (v_e.unlimited or v_f.kind = 'BOOLEAN') then
      return jsonb_build_object('funding', 'PLAN', 'kind', v_f.kind, 'unlimited', true, 'planCode', v_sub.plan_code,
        'subscriptionId', v_sub.id, 'periodStart', v_sub.current_period_start, 'periodEnd', v_sub.current_period_end);
    end if;
    if found and v_e.enabled then
      select count(*) into v_used from public.saas_usage
       where subscription_id = v_sub.id and feature = p_feature and funding = 'PLAN'
         and period_start = v_sub.current_period_start and state in ('RESERVED', 'COMMITTED');
      if v_used < coalesce(v_e.limit_per_period, 0) then
        return jsonb_build_object('funding', 'PLAN', 'kind', v_f.kind, 'unlimited', false, 'planCode', v_sub.plan_code,
          'used', v_used, 'limit', v_e.limit_per_period, 'remaining', v_e.limit_per_period - v_used,
          'subscriptionId', v_sub.id, 'periodStart', v_sub.current_period_start, 'periodEnd', v_sub.current_period_end);
      end if;
    end if;
    v_exhausted := true;
  end if;

  -- 5. Legacy credits (QUOTA only; never sold anew).
  if v_f.kind = 'QUOTA' then
    select ca.balance into v_balance from public.credit_accounts ca where ca.user_id = p_user_id;
    if coalesce(v_balance, 0) > 0 then
      return jsonb_build_object('funding', 'LEGACY_CREDITS', 'kind', v_f.kind, 'legacyBalance', v_balance,
        'fallbackReason', case when v_exhausted then 'ALLOWANCE_EXHAUSTED' else 'SUBSCRIPTION_REQUIRED' end,
        'planCode', v_sub.plan_code,
        'trialBlocked', case when v_f.trial_enabled and not v_eligible then 'ACCOUNT_NOT_VERIFIED' end);
    end if;
  end if;

  return jsonb_build_object('funding', 'NONE', 'kind', v_f.kind,
    'reason', case when v_exhausted then 'ALLOWANCE_EXHAUSTED' else 'SUBSCRIPTION_REQUIRED' end,
    'planCode', v_sub.plan_code,
    'trialBlocked', case when v_f.kind = 'QUOTA' and v_f.trial_enabled and not v_eligible then 'ACCOUNT_NOT_VERIFIED' end);
end $$;

-- ── 6. Every gated path reads the resolver ──────────────────────────────────
create or replace function public.saas_usage_preview(p_user_id uuid, p_feature text)
returns jsonb language sql stable security definer set search_path to '' as $$
  select public.saas_access_resolve(p_user_id, p_feature)
$$;

create or replace function public.saas_user_has_feature(p_user_id uuid, p_feature text)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(public.saas_access_resolve(p_user_id, p_feature)->>'funding', 'NONE') in ('OWNER', 'GRANT', 'PLAN')
$$;

create or replace function public.saas_usage_begin(
  p_user_id uuid, p_feature text, p_key text, p_job_ref text default null, p_allow_legacy boolean default true)
returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_f public.saas_features;
  v_u public.saas_usage;
  v_r jsonb;
  v_funding text;
  v_sub uuid;
  v_grant uuid;
  v_plan text;
  v_pstart timestamptz;
  v_pend timestamptz;
begin
  if p_user_id is null then raise exception 'INVALID_ARGUMENT'; end if;
  if p_key is null or length(p_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  select * into v_f from public.saas_features where feature = p_feature;
  if not found or v_f.kind <> 'QUOTA' then raise exception 'FEATURE_UNKNOWN'; end if;

  -- Serialises every start, commit and release of this user's feature (counts are read under it).
  perform pg_advisory_xact_lock(hashtextextended('saas_usage:' || p_user_id::text || ':' || p_feature, 0));

  select * into v_u from public.saas_usage where user_id = p_user_id and feature = p_feature and idempotency_key = p_key for update;
  if found and v_u.state in ('RESERVED', 'COMMITTED') then
    return jsonb_build_object('ok', true, 'duplicate', true, 'funding', v_u.funding, 'usageId', v_u.id, 'state', v_u.state);
  end if;

  v_r := public.saas_access_resolve(p_user_id, p_feature);
  v_funding := v_r->>'funding';

  if v_funding in ('OWNER', 'GRANT', 'TRIAL', 'PLAN') then
    if v_funding = 'PLAN' then
      v_sub := (v_r->>'subscriptionId')::uuid; v_plan := v_r->>'planCode';
      v_pstart := (v_r->>'periodStart')::timestamptz; v_pend := (v_r->>'periodEnd')::timestamptz;
    elsif v_funding = 'GRANT' then
      v_grant := (v_r->>'grantId')::uuid; v_plan := v_r->>'grantPlanCode';
      v_pstart := (v_r->>'windowStart')::timestamptz; v_pend := (v_r->>'expiresAt')::timestamptz;
    end if;
    if v_u.id is not null then
      update public.saas_usage
         set funding = v_funding, state = 'RESERVED', subscription_id = v_sub, grant_id = v_grant, plan_code = v_plan,
             period_start = v_pstart, period_end = v_pend,
             job_ref = coalesce(p_job_ref, job_ref), reserved_at = now(),
             expires_at = now() + make_interval(mins => v_f.reservation_ttl_minutes),
             committed_at = null, released_at = null, release_reason = null, over_allowance = false
       where id = v_u.id returning * into v_u;
    else
      insert into public.saas_usage (user_id, feature, funding, subscription_id, grant_id, plan_code, period_start, period_end,
                                     idempotency_key, job_ref, state, expires_at)
      values (p_user_id, p_feature, v_funding, v_sub, v_grant, v_plan, v_pstart, v_pend,
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
      'planCode', v_plan, 'grantId', v_grant,
      'used', case when v_funding in ('PLAN', 'GRANT') and not coalesce((v_r->>'unlimited')::boolean, false)
                   then coalesce((v_r->>'used')::integer, 0) + 1 else 0 end,
      'limit', case when coalesce((v_r->>'unlimited')::boolean, false) then null else (v_r->>'limit')::integer end,
      'unlimited', coalesce((v_r->>'unlimited')::boolean, false));
  end if;

  if v_funding = 'LEGACY_CREDITS' and p_allow_legacy then
    return jsonb_build_object('ok', true, 'funding', 'LEGACY_CREDITS', 'legacyBalance', (v_r->>'legacyBalance')::numeric,
      'fallbackReason', v_r->>'fallbackReason');
  end if;

  return jsonb_build_object('ok', false,
    'reason', coalesce(v_r->>'fallbackReason', v_r->>'reason', 'SUBSCRIPTION_REQUIRED'),
    'planCode', v_r->>'planCode', 'trialBlocked', v_r->>'trialBlocked');
end $$;

-- Commit: unchanged for TRIAL / PLAN; a GRANT use delivered after the sweeper returned its slot is
-- kept and flagged when the grant window is full; OWNER is never "over".
create or replace function public.saas_usage_commit(p_user_id uuid, p_feature text, p_key text)
returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_u public.saas_usage;
  v_over boolean := false;
  v_e public.saas_plan_entitlements;
  v_a public.saas_access_grant_allowances;
  v_n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('saas_usage:' || p_user_id::text || ':' || p_feature, 0));
  select * into v_u from public.saas_usage where user_id = p_user_id and feature = p_feature and idempotency_key = p_key for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); end if;
  if v_u.state = 'COMMITTED' then return jsonb_build_object('ok', true, 'duplicate', true, 'funding', v_u.funding); end if;
  if v_u.state = 'RELEASED' and coalesce(v_u.release_reason, '') <> 'EXPIRED' then
    return jsonb_build_object('ok', false, 'reason', 'RELEASED');
  end if;
  if v_u.state = 'RELEASED' then
    if v_u.funding = 'PLAN' then
      select * into v_e from public.saas_plan_entitlements where plan_code = v_u.plan_code and feature = p_feature;
      select count(*) into v_n from public.saas_usage
       where subscription_id = v_u.subscription_id and feature = p_feature and funding = 'PLAN'
         and period_start = v_u.period_start and state in ('RESERVED', 'COMMITTED');
      v_over := not coalesce(v_e.unlimited, false) and v_n >= coalesce(v_e.limit_per_period, 0);
    elsif v_u.funding = 'GRANT' then
      select * into v_a from public.saas_access_grant_allowances where grant_id = v_u.grant_id and feature = p_feature;
      select count(*) into v_n from public.saas_usage
       where grant_id = v_u.grant_id and feature = p_feature and funding = 'GRANT'
         and period_start = v_u.period_start and state in ('RESERVED', 'COMMITTED');
      v_over := not coalesce(v_a.unlimited, false) and v_n >= coalesce(v_a.limit_count, 0);
    elsif v_u.funding = 'TRIAL' and exists (select 1 from public.saas_trials t where t.user_id = p_user_id and t.feature = p_feature and t.state = 'CONSUMED') then
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

-- ── 7. Verify wrapper: OWNER / GRANT are included uses like TRIAL / PLAN ────
create or replace function public.verify_billing_open(
  p_job_id uuid, p_user_id uuid, p_idempotency_key text,
  p_extend boolean default false, p_expected_authorizations integer default null, p_expected_credits numeric default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user uuid;
  v_key text := 'verify:' || p_job_id::text;
  v_begin jsonb;
  v_wallet jsonb;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if not exists (select 1 from public.research_jobs where id = p_job_id and user_id = p_user_id) then
    raise exception 'JOB_NOT_OWNED';
  end if;
  -- A job that already held wallet money keeps the wallet path (stop/continue, extensions).
  if exists (select 1 from public.verify_billing where job_id = p_job_id) then
    return public.verify_billing_open_wallet(p_job_id, p_user_id, p_idempotency_key, p_extend, p_expected_authorizations, p_expected_credits)
           || jsonb_build_object('funding', 'LEGACY_CREDITS');
  end if;
  v_user := public.verify_wallet_user(p_user_id);
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'SUBSCRIPTION_REQUIRED');
  end if;

  v_begin := public.saas_usage_begin(v_user, 'VERIFY', v_key, p_job_id::text, true);
  if (v_begin->>'ok')::boolean and v_begin->>'funding' in ('OWNER', 'GRANT', 'TRIAL', 'PLAN') then
    return jsonb_build_object('ok', true, 'duplicate', coalesce((v_begin->>'duplicate')::boolean, false),
      'funding', v_begin->>'funding', 'usageId', v_begin->>'usageId',
      'priceMode', 'INCLUDED', 'priceCredits', 0, 'reservedCredits', 0, 'chargedTotal', 0, 'authorizations', 0);
  end if;
  if (v_begin->>'ok')::boolean and v_begin->>'funding' = 'LEGACY_CREDITS' then
    v_wallet := public.verify_billing_open_wallet(p_job_id, p_user_id, p_idempotency_key, p_extend, p_expected_authorizations, p_expected_credits);
    if not coalesce((v_wallet->>'ok')::boolean, false) and v_wallet->>'reason' = 'INSUFFICIENT_CREDITS' then
      return v_wallet || jsonb_build_object('reason', v_begin->>'fallbackReason', 'legacyReason', 'INSUFFICIENT_CREDITS');
    end if;
    return v_wallet || jsonb_build_object('funding', 'LEGACY_CREDITS');
  end if;
  return jsonb_build_object('ok', false, 'reason', coalesce(v_begin->>'reason', 'SUBSCRIPTION_REQUIRED'),
    'trialBlocked', v_begin->>'trialBlocked', 'planCode', v_begin->>'planCode');
end;
$function$;

-- ── 8. What the UI reads: entitlement_status_for_me() -> saas_entitlement_status ──
create or replace function public.saas_entitlement_status(p_user_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare
  v_sub public.saas_subscriptions;
  v_any public.saas_subscriptions;
  v_features jsonb := '[]'::jsonb;
  v_f record;
  v_used integer;
  v_r jsonb;
  v_src text;
  v_balance numeric;
  v_eligible boolean := public.saas_account_eligible(p_user_id);
  v_owner boolean := public.saas_is_owner(p_user_id);
  v_month timestamptz := (date_trunc('month', now() at time zone 'Asia/Tbilisi')) at time zone 'Asia/Tbilisi';
  v_grants jsonb;
  v_unlimited_grant boolean;
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
    v_r := public.saas_access_resolve(p_user_id, v_f.feature);
    v_src := v_r->>'funding';
    if v_src = 'OWNER' then
      -- Real numbers only: this month's delivered and running owner uses, no limit.
      select count(*) into v_used from public.saas_usage u
       where u.user_id = p_user_id and u.feature = v_f.feature and u.funding = 'OWNER'
         and u.reserved_at >= v_month and u.state in ('RESERVED', 'COMMITTED');
      v_features := v_features || jsonb_build_object(
        'feature', v_f.feature, 'kind', v_f.kind, 'source', 'OWNER', 'included', true, 'unlimited', true,
        'limit', null, 'used', v_used, 'remaining', null,
        'trialEnabled', v_f.trial_enabled, 'trialState', coalesce(v_f.trial_state, 'UNUSED'), 'trialAvailable', false);
    elsif v_src = 'GRANT' then
      v_features := v_features || jsonb_build_object(
        'feature', v_f.feature, 'kind', v_f.kind, 'source', 'GRANT', 'included', true,
        'unlimited', coalesce((v_r->>'unlimited')::boolean, false),
        'limit', (v_r->>'limit')::integer, 'used', coalesce((v_r->>'used')::integer, 0),
        'remaining', (v_r->>'remaining')::integer,
        'grant', jsonb_build_object('id', v_r->>'grantId', 'kind', v_r->>'grantKind', 'planCode', v_r->>'grantPlanCode',
                                    'period', v_r->>'period', 'expiresAt', v_r->'expiresAt', 'permanent', (v_r->>'permanent')::boolean),
        'trialEnabled', v_f.trial_enabled, 'trialState', coalesce(v_f.trial_state, 'UNUSED'),
        'trialAvailable', v_f.trial_enabled and v_eligible and coalesce(v_f.trial_state, 'RELEASED') = 'RELEASED');
    else
      v_used := 0;
      if v_sub.id is not null and v_f.kind = 'QUOTA' then
        select count(*) into v_used from public.saas_usage u
         where u.subscription_id = v_sub.id and u.feature = v_f.feature and u.funding = 'PLAN'
           and u.period_start = v_sub.current_period_start and u.state in ('RESERVED', 'COMMITTED');
      end if;
      v_features := v_features || jsonb_build_object(
        'feature', v_f.feature, 'kind', v_f.kind, 'source', coalesce(v_src, 'NONE'),
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
    end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', g.id, 'kind', g.kind, 'planCode', g.plan_code, 'startsAt', g.starts_at, 'expiresAt', g.expires_at,
           'permanent', g.expires_at is null,
           'allowances', (select coalesce(jsonb_agg(jsonb_build_object('feature', a.feature, 'unlimited', a.unlimited,
                                   'limit', a.limit_count, 'period', a.period) order by a.feature), '[]'::jsonb)
                            from public.saas_access_grant_allowances a where a.grant_id = g.id))
           order by g.created_at), '[]'::jsonb),
         coalesce(bool_or(g.kind = 'UNLIMITED'), false)
    into v_grants, v_unlimited_grant
    from public.saas_access_grants g
   where g.user_id = p_user_id and g.status = 'ACTIVE' and g.starts_at <= now() and (g.expires_at is null or g.expires_at > now());

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
    'hasLegacyBalance', coalesce(v_balance, 0) > 0,
    -- Owner / manual access. `unlimited` is what the UI uses to hide every credit and top-up surface.
    'access', jsonb_build_object(
      'owner', v_owner,
      'unlimited', v_owner or v_unlimited_grant,
      'source', case when v_owner then 'OWNER' when jsonb_array_length(v_grants) > 0 then 'GRANT'
                     when v_sub.id is not null then 'PLAN' else 'NONE' end,
      'grants', v_grants));
end $$;

-- ── Grants ──────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'platform_owner_guard()', 'saas_is_owner(uuid)', 'saas_grant_period_start(timestamptz, timestamptz)',
    'saas_access_grant_pick(uuid, text)', 'saas_access_resolve(uuid, text)',
    'saas_usage_preview(uuid, text)', 'saas_user_has_feature(uuid, text)',
    'saas_usage_begin(uuid, text, text, text, boolean)', 'saas_usage_commit(uuid, text, text)',
    'verify_billing_open(uuid, uuid, text, boolean, integer, numeric)', 'saas_entitlement_status(uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
