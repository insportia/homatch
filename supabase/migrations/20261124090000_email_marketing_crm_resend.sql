-- EMAIL MARKETING, CRM INBOX, RESEND INFRASTRUCTURE (owner brief 2026-10-22).
--
-- Owner decision (2026-10-22, in session): billing is per service. Email Marketing
-- is sold as plans — Free (50 emails once per account), Pro ($50/month, 50,000),
-- Scale ($220/month, 100,000) — with overage at $2.20 per started 1,000 emails ONLY
-- after the customer explicitly enables it. Every price is final and includes the
-- 18% Georgian VAT; Finance V2 extracts VAT and allocates 37% HOMATCH / 63%
-- execution of the VAT-exclusive revenue (new policy email_marketing_37_63_vat_v1).
-- Plans are paid from the credit wallet (10 credits = $1) through the existing
-- reserve → settle path; the card provider is still in mock mode, so nothing here
-- charges a card. Renewal is opt-in (auto_renew) and never silent.
--
-- What this migration adds (additive; nothing settled is rewritten):
--   1. comm_messages.email_meta / html_body — a received email keeps its headers,
--      threading ids, authentication verdicts and HTML (owner RLS unchanged).
--   2. email_reply_routes — opaque reply tokens: r-<token>@reply.homatch.live maps a
--      reply to exactly one tenant (and campaign/recipient). The sender address is
--      never trusted for tenant attribution.
--   3. email_sending_domains — customer sending domains mirrored from the Resend
--      Domains API (a domain belongs to one account; provider state is authoritative).
--   4. Plans and quota: email_plans, email_subscriptions, email_quota_periods,
--      email_quota_reservations, email_billing_events + service_role RPCs with
--      idempotent reserve → settle → release, and customer RPCs (status, overage
--      consent, auto-renew).
--   5. Billable products EMAIL_PLAN_PRO / EMAIL_PLAN_SCALE / EMAIL_OVERAGE_1K, the
--      Finance V2 policy and service row, and the revenue view taught the new split.
--   6. Deliverability fixes on the outreach path: a bounce or complaint now suppresses
--      the contact; an opt-out belongs to the ADDRESS across an owner's rows; a
--      scheduled outreach campaign no longer stalls after its first batch.
--   7. email_ops_overview() — admin-only operational read.

------------------------------------------------------------------------------
-- 1. Received email detail on the existing message row.
------------------------------------------------------------------------------
alter table public.comm_messages add column if not exists email_meta jsonb;
alter table public.comm_messages add column if not exists html_body text;
comment on column public.comm_messages.email_meta is
  'EMAIL channel: subject, message_id, in_reply_to, references, cc, to, authentication {spf,dkim,dmarc}, attachments [{id,filename,content_type,size}], route {kind,campaign_id}. Never secrets.';
comment on column public.comm_messages.html_body is
  'EMAIL channel: the message HTML exactly as received/sent. Untrusted: rendered only sanitised in a sandboxed frame.';

------------------------------------------------------------------------------
-- 2. Reply routing tokens.
------------------------------------------------------------------------------
create table if not exists public.email_reply_routes (
  token           text primary key check (token ~ '^[a-z2-7]{26}$'),
  owner_user_id   uuid not null references public.users(id) on delete cascade,
  owner_auth_id   uuid not null,
  kind            text not null check (kind in ('STUDIO', 'OUTREACH', 'CRM')),
  campaign_id     uuid,
  recipient_id    uuid,
  conversation_id uuid references public.comm_conversations(id) on delete set null,
  contact_email   text,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '365 days',
  revoked_at      timestamptz
);
create index if not exists email_reply_routes_owner on public.email_reply_routes (owner_user_id, created_at desc);
create unique index if not exists email_reply_routes_crm_conv on public.email_reply_routes (conversation_id)
  where kind = 'CRM' and revoked_at is null;
alter table public.email_reply_routes enable row level security;
revoke all on public.email_reply_routes from public, anon, authenticated;
grant all on public.email_reply_routes to service_role;
comment on table public.email_reply_routes is
  'Opaque reply addresses (r-<token>@reply.homatch.live). 130-bit random token, server-only; resolves a reply to one tenant. Revocable.';

------------------------------------------------------------------------------
-- 3. Customer sending domains (Resend Domains API mirror).
------------------------------------------------------------------------------
create table if not exists public.email_sending_domains (
  id                 uuid primary key default gen_random_uuid(),
  owner_user_id      uuid not null references public.users(id) on delete cascade,
  domain             text not null check (domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'),
  resend_domain_id   text,
  provider_status    text,
  status             text not null default 'NOT_CONFIGURED'
                     check (status in ('NOT_CONFIGURED','DNS_PENDING','VERIFICATION_PENDING','VERIFIED','FAILED','RESTRICTED','DISCONNECTED')),
  region             text not null default 'eu-west-1',
  records            jsonb not null default '[]'::jsonb,
  sender_local_part  text check (sender_local_part is null or sender_local_part ~ '^[A-Za-z0-9._%+-]{1,64}$'),
  sender_name        text check (sender_name is null or char_length(sender_name) <= 80),
  last_error         text,
  last_checked_at    timestamptz,
  verified_at        timestamptz,
  disconnected_at    timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
/* A domain can be connected by ONE account at a time: no hijacking another tenant's domain. */
create unique index if not exists email_sending_domains_active_domain
  on public.email_sending_domains (domain) where status <> 'DISCONNECTED';
create unique index if not exists email_sending_domains_resend_id
  on public.email_sending_domains (resend_domain_id) where resend_domain_id is not null;
create index if not exists email_sending_domains_owner on public.email_sending_domains (owner_user_id);
alter table public.email_sending_domains enable row level security;
drop policy if exists email_sending_domains_own_read on public.email_sending_domains;
create policy email_sending_domains_own_read on public.email_sending_domains
  for select to authenticated using (owner_user_id = public.current_homatch_user_id() or public.is_admin());
revoke all on public.email_sending_domains from public, anon;
grant select on public.email_sending_domains to authenticated;
grant all on public.email_sending_domains to service_role;
comment on table public.email_sending_domains is
  'Customer sending domains. Written only by the email-marketing edge function from Resend Domains API answers; status is never VERIFIED unless Resend says verified.';

------------------------------------------------------------------------------
-- 4. Plans, subscriptions, quota.
------------------------------------------------------------------------------
create table if not exists public.email_plans (
  code              text primary key check (code in ('FREE','PRO','SCALE')),
  name              text not null,
  price_usd_gross   numeric(10,2) not null check (price_usd_gross >= 0),
  included_emails   integer not null check (included_emails >= 0),
  period            text not null check (period in ('LIFETIME','MONTH')),
  product_code      text,
  sort_order        integer not null default 0,
  active            boolean not null default true
);
insert into public.email_plans (code, name, price_usd_gross, included_emails, period, product_code, sort_order) values
  ('FREE',  'Free',  0,      50,     'LIFETIME', null,               10),
  ('PRO',   'Pro',   50.00,  50000,  'MONTH',    'EMAIL_PLAN_PRO',   20),
  ('SCALE', 'Scale', 220.00, 100000, 'MONTH',    'EMAIL_PLAN_SCALE', 30)
on conflict (code) do nothing;
alter table public.email_plans enable row level security;
drop policy if exists email_plans_read on public.email_plans;
create policy email_plans_read on public.email_plans for select to authenticated using (true);
grant select on public.email_plans to authenticated;

create table if not exists public.email_subscriptions (
  owner_user_id          uuid primary key references public.users(id) on delete cascade,
  plan_code              text not null references public.email_plans(code),
  status                 text not null default 'ACTIVE' check (status in ('ACTIVE','LAPSED','CANCELLED')),
  current_period_id      uuid,
  auto_renew             boolean not null default false,
  pending_plan_code      text references public.email_plans(code),
  overage_enabled        boolean not null default false,
  overage_consented_at   timestamptz,
  overage_max_blocks     integer check (overage_max_blocks is null or overage_max_blocks between 1 and 1000),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table if not exists public.email_quota_periods (
  id                     uuid primary key default gen_random_uuid(),
  owner_user_id          uuid not null references public.users(id) on delete cascade,
  plan_code              text not null references public.email_plans(code),
  kind                   text not null check (kind in ('FREE_LIFETIME','MONTHLY')),
  starts_at              timestamptz not null default now(),
  ends_at                timestamptz,
  included               integer not null check (included >= 0),
  used                   integer not null default 0 check (used >= 0),
  reserved               integer not null default 0 check (reserved >= 0),
  overage_used           integer not null default 0 check (overage_used >= 0),
  overage_reserved       integer not null default 0 check (overage_reserved >= 0),
  overage_blocks_billed  integer not null default 0 check (overage_blocks_billed >= 0),
  billing_event_id       uuid,
  created_at             timestamptz not null default now(),
  check (kind = 'FREE_LIFETIME' or ends_at is not null)
);
/* The free allowance exists once per account, ever — it can never be re-created to reset. */
create unique index if not exists email_quota_periods_one_free on public.email_quota_periods (owner_user_id) where kind = 'FREE_LIFETIME';
create index if not exists email_quota_periods_owner on public.email_quota_periods (owner_user_id, starts_at desc);

create table if not exists public.email_quota_reservations (
  id               uuid primary key default gen_random_uuid(),
  owner_user_id    uuid not null references public.users(id) on delete cascade,
  period_id        uuid not null references public.email_quota_periods(id),
  idempotency_key  text not null unique,
  source           text not null,
  requested        integer not null check (requested > 0),
  included_part    integer not null check (included_part >= 0),
  overage_part     integer not null check (overage_part >= 0),
  sent             integer,
  status           text not null default 'RESERVED' check (status in ('RESERVED','SETTLED','RELEASED')),
  created_at       timestamptz not null default now(),
  settled_at       timestamptz
);
create index if not exists email_quota_reservations_open on public.email_quota_reservations (owner_user_id) where status = 'RESERVED';

create table if not exists public.email_billing_events (
  id                     uuid primary key default gen_random_uuid(),
  owner_user_id          uuid not null references public.users(id) on delete cascade,
  kind                   text not null check (kind in ('PLAN_PURCHASE','PLAN_RENEWAL','OVERAGE_BLOCKS')),
  plan_code              text references public.email_plans(code),
  period_id              uuid references public.email_quota_periods(id),
  blocks                 integer,
  credits                numeric(14,4) not null check (credits > 0),
  gross_usd              numeric(12,2) not null check (gross_usd > 0),
  wallet_reservation_id  uuid,
  idempotency_key        text not null unique,
  created_at             timestamptz not null default now()
);
create index if not exists email_billing_events_owner on public.email_billing_events (owner_user_id, created_at desc);

alter table public.email_subscriptions enable row level security;
alter table public.email_quota_periods enable row level security;
alter table public.email_quota_reservations enable row level security;
alter table public.email_billing_events enable row level security;
drop policy if exists email_subscriptions_own on public.email_subscriptions;
create policy email_subscriptions_own on public.email_subscriptions for select to authenticated
  using (owner_user_id = public.current_homatch_user_id() or public.is_admin());
drop policy if exists email_quota_periods_own on public.email_quota_periods;
create policy email_quota_periods_own on public.email_quota_periods for select to authenticated
  using (owner_user_id = public.current_homatch_user_id() or public.is_admin());
drop policy if exists email_billing_events_own on public.email_billing_events;
create policy email_billing_events_own on public.email_billing_events for select to authenticated
  using (owner_user_id = public.current_homatch_user_id() or public.is_admin());
revoke all on public.email_subscriptions, public.email_quota_periods, public.email_quota_reservations, public.email_billing_events from public, anon, authenticated;
grant select on public.email_subscriptions, public.email_quota_periods, public.email_billing_events to authenticated;
grant all on public.email_subscriptions, public.email_quota_periods, public.email_quota_reservations, public.email_billing_events to service_role;

/* The current quota period for an owner; creates the Free account (once, ever) on first use.
   A paid period that has ended without a renewal falls back to the Free lifetime period. */
create or replace function public.email_quota_current_period(p_owner uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_sub public.email_subscriptions;
  v_period public.email_quota_periods;
  v_free uuid;
begin
  if p_owner is null then raise exception 'OWNER_REQUIRED'; end if;
  insert into public.email_quota_periods (owner_user_id, plan_code, kind, included)
  values (p_owner, 'FREE', 'FREE_LIFETIME', (select included_emails from public.email_plans where code = 'FREE'))
  on conflict (owner_user_id) where kind = 'FREE_LIFETIME' do nothing;
  select id into v_free from public.email_quota_periods where owner_user_id = p_owner and kind = 'FREE_LIFETIME';
  insert into public.email_subscriptions (owner_user_id, plan_code, current_period_id)
  values (p_owner, 'FREE', v_free)
  on conflict (owner_user_id) do nothing;

  select * into v_sub from public.email_subscriptions where owner_user_id = p_owner;
  if v_sub.current_period_id is null then return v_free; end if;
  select * into v_period from public.email_quota_periods where id = v_sub.current_period_id;
  if v_period.kind = 'MONTHLY' and (v_period.ends_at <= now() or v_sub.status <> 'ACTIVE') then
    return v_free;
  end if;
  return v_period.id;
end;
$function$;

/* Reserve quota for p_count emails. Idempotent on p_key (a retry returns the first answer).
   Without overage consent only the included remainder is granted. With consent, the overage
   blocks still to be billed are returned; the caller charges them (email_quota_record_overage)
   BEFORE sending, or releases the reservation. */
create or replace function public.email_quota_reserve(
  p_owner uuid, p_count integer, p_key text, p_source text, p_allow_partial boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_existing public.email_quota_reservations;
  v_period_id uuid;
  v_period public.email_quota_periods;
  v_sub public.email_subscriptions;
  v_remaining integer;
  v_inc integer;
  v_over integer := 0;
  v_blocks integer := 0;
  v_id uuid;
begin
  if p_count is null or p_count <= 0 then raise exception 'INVALID_COUNT'; end if;
  if p_key is null or length(p_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;

  select * into v_existing from public.email_quota_reservations where idempotency_key = p_key;
  if found then
    return jsonb_build_object('reservationId', v_existing.id, 'granted', v_existing.included_part + v_existing.overage_part,
      'included', v_existing.included_part, 'overage', v_existing.overage_part, 'blocksToBill', 0,
      'status', v_existing.status, 'duplicate', true);
  end if;

  v_period_id := public.email_quota_current_period(p_owner);
  select * into v_period from public.email_quota_periods where id = v_period_id for update;
  select * into v_sub from public.email_subscriptions where owner_user_id = p_owner;

  v_remaining := greatest(v_period.included - v_period.used - v_period.reserved, 0);
  v_inc := least(p_count, v_remaining);
  if p_count > v_inc and v_sub.overage_enabled and v_sub.overage_consented_at is not null and v_period.kind = 'MONTHLY' then
    v_over := p_count - v_inc;
    v_blocks := ceil((v_period.overage_used + v_period.overage_reserved + v_over)::numeric / 1000)::integer - v_period.overage_blocks_billed;
    if v_blocks < 0 then v_blocks := 0; end if;
    if v_sub.overage_max_blocks is not null and v_period.overage_blocks_billed + v_blocks > v_sub.overage_max_blocks then
      /* Over the customer's own cap: grant only what the cap allows. */
      v_over := greatest(v_sub.overage_max_blocks * 1000 - v_period.overage_used - v_period.overage_reserved, 0);
      v_over := least(v_over, p_count - v_inc);
      v_blocks := greatest(ceil((v_period.overage_used + v_period.overage_reserved + v_over)::numeric / 1000)::integer - v_period.overage_blocks_billed, 0);
    end if;
  end if;

  if v_inc + v_over = 0 or (not p_allow_partial and v_inc + v_over < p_count) then
    return jsonb_build_object('reservationId', null, 'granted', 0, 'included', 0, 'overage', 0, 'blocksToBill', 0,
      'status', 'REFUSED', 'reason', case when v_sub.overage_enabled then 'OVERAGE_CAP_REACHED' else 'QUOTA_EXHAUSTED' end,
      'remaining', v_remaining);
  end if;

  insert into public.email_quota_reservations (owner_user_id, period_id, idempotency_key, source, requested, included_part, overage_part)
  values (p_owner, v_period.id, p_key, left(coalesce(p_source, 'UNKNOWN'), 40), p_count, v_inc, v_over)
  returning id into v_id;
  update public.email_quota_periods
     set reserved = reserved + v_inc, overage_reserved = overage_reserved + v_over
   where id = v_period.id;

  return jsonb_build_object('reservationId', v_id, 'granted', v_inc + v_over, 'included', v_inc, 'overage', v_over,
    'blocksToBill', v_blocks, 'status', 'RESERVED', 'duplicate', false, 'periodId', v_period.id);
end;
$function$;

/* Record that overage blocks for a period were charged (wallet settled). Idempotent on the key. */
create or replace function public.email_quota_record_overage(
  p_owner uuid, p_period uuid, p_blocks integer, p_credits numeric, p_gross_usd numeric, p_wallet_reservation uuid, p_key text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare v_id uuid;
begin
  insert into public.email_billing_events (owner_user_id, kind, period_id, blocks, credits, gross_usd, wallet_reservation_id, idempotency_key)
  values (p_owner, 'OVERAGE_BLOCKS', p_period, p_blocks, p_credits, p_gross_usd, p_wallet_reservation, p_key)
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null then
    update public.email_quota_periods set overage_blocks_billed = overage_blocks_billed + p_blocks
     where id = p_period and owner_user_id = p_owner;
  else
    select id into v_id from public.email_billing_events where idempotency_key = p_key;
  end if;
  return v_id;
end;
$function$;

/* Settle a reservation with the number actually accepted by the provider. Idempotent.
   Included emails are consumed first; unsent emails go back to the period. */
create or replace function public.email_quota_settle(p_reservation uuid, p_sent integer)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_r public.email_quota_reservations;
  v_sent integer;
  v_inc_used integer;
  v_over_used integer;
begin
  select * into v_r from public.email_quota_reservations where id = p_reservation for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v_r.status <> 'RESERVED' then
    return jsonb_build_object('status', v_r.status, 'sent', coalesce(v_r.sent, 0), 'duplicate', true);
  end if;
  v_sent := least(greatest(coalesce(p_sent, 0), 0), v_r.included_part + v_r.overage_part);
  v_inc_used := least(v_sent, v_r.included_part);
  v_over_used := v_sent - v_inc_used;
  update public.email_quota_periods
     set reserved = greatest(reserved - v_r.included_part, 0),
         overage_reserved = greatest(overage_reserved - v_r.overage_part, 0),
         used = used + v_inc_used,
         overage_used = overage_used + v_over_used
   where id = v_r.period_id;
  update public.email_quota_reservations set status = 'SETTLED', sent = v_sent, settled_at = now() where id = v_r.id;
  return jsonb_build_object('status', 'SETTLED', 'sent', v_sent, 'included', v_inc_used, 'overage', v_over_used, 'duplicate', false);
end;
$function$;

create or replace function public.email_quota_release(p_reservation uuid)
returns jsonb
language sql
security definer
set search_path to ''
as $function$
  select public.email_quota_settle(p_reservation, 0);
$function$;

/* Activate a paid plan period after the wallet charge reserved. Idempotent on p_key.
   A renewal starts where the current period ends; a purchase or upgrade starts now. */
create or replace function public.email_plan_activate(
  p_owner uuid, p_plan text, p_kind text, p_credits numeric, p_gross_usd numeric, p_wallet_reservation uuid, p_key text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_plan public.email_plans;
  v_sub public.email_subscriptions;
  v_prev public.email_quota_periods;
  v_start timestamptz := now();
  v_period uuid;
  v_event uuid;
begin
  if p_kind not in ('PLAN_PURCHASE', 'PLAN_RENEWAL') then raise exception 'INVALID_KIND'; end if;
  select * into v_plan from public.email_plans where code = p_plan and active and period = 'MONTH';
  if not found then raise exception 'UNKNOWN_PLAN'; end if;

  select id into v_event from public.email_billing_events where idempotency_key = p_key;
  if found then
    return jsonb_build_object('duplicate', true, 'billingEventId', v_event,
      'periodId', (select period_id from public.email_billing_events where id = v_event));
  end if;

  perform public.email_quota_current_period(p_owner);
  select * into v_sub from public.email_subscriptions where owner_user_id = p_owner for update;
  if p_kind = 'PLAN_RENEWAL' and v_sub.current_period_id is not null then
    select * into v_prev from public.email_quota_periods where id = v_sub.current_period_id;
    if v_prev.kind = 'MONTHLY' and v_prev.ends_at > now() - interval '3 days' then
      v_start := greatest(v_prev.ends_at, now() - interval '3 days');
    end if;
  end if;

  insert into public.email_billing_events (owner_user_id, kind, plan_code, credits, gross_usd, wallet_reservation_id, idempotency_key)
  values (p_owner, p_kind, p_plan, p_credits, p_gross_usd, p_wallet_reservation, p_key)
  returning id into v_event;
  insert into public.email_quota_periods (owner_user_id, plan_code, kind, starts_at, ends_at, included, billing_event_id)
  values (p_owner, p_plan, 'MONTHLY', v_start, v_start + interval '1 month', v_plan.included_emails, v_event)
  returning id into v_period;
  update public.email_billing_events set period_id = v_period where id = v_event;
  update public.email_subscriptions
     set plan_code = p_plan, status = 'ACTIVE', current_period_id = v_period,
         pending_plan_code = case when pending_plan_code = p_plan then null else pending_plan_code end,
         updated_at = now()
   where owner_user_id = p_owner;
  return jsonb_build_object('duplicate', false, 'billingEventId', v_event, 'periodId', v_period,
    'startsAt', v_start, 'endsAt', v_start + interval '1 month');
end;
$function$;

/* Paid subscriptions whose period ends within the hour (or has ended within 3 days) and opted
   into renewal. The renewal itself (wallet charge) is done by the caller. */
create or replace function public.email_plan_due_renewals(p_limit integer default 20)
returns table (owner_user_id uuid, plan_code text, period_id uuid, ends_at timestamptz)
language sql
security definer
set search_path to ''
as $function$
  select s.owner_user_id, coalesce(s.pending_plan_code, s.plan_code), p.id, p.ends_at
    from public.email_subscriptions s
    join public.email_quota_periods p on p.id = s.current_period_id
   where s.status = 'ACTIVE' and s.auto_renew and p.kind = 'MONTHLY'
     and coalesce(s.pending_plan_code, s.plan_code) in ('PRO', 'SCALE')
     and p.ends_at <= now() + interval '1 hour' and p.ends_at > now() - interval '3 days'
   order by p.ends_at
   limit greatest(1, least(coalesce(p_limit, 20), 100));
$function$;

/* Paid periods that ended more than 3 days ago without renewal: the subscription lapses and
   the account falls back to whatever is left of its Free allowance. */
create or replace function public.email_plan_lapse_expired()
returns integer
language sql
security definer
set search_path to ''
as $function$
  with lapsed as (
    update public.email_subscriptions s
       set status = 'LAPSED', updated_at = now()
      from public.email_quota_periods p
     where p.id = s.current_period_id and s.status = 'ACTIVE' and p.kind = 'MONTHLY'
       and p.ends_at <= now() - interval '3 days'
    returning 1
  ) select count(*)::integer from lapsed;
$function$;

revoke all on function public.email_quota_current_period(uuid) from public, anon, authenticated;
revoke all on function public.email_quota_reserve(uuid, integer, text, text, boolean) from public, anon, authenticated;
revoke all on function public.email_quota_record_overage(uuid, uuid, integer, numeric, numeric, uuid, text) from public, anon, authenticated;
revoke all on function public.email_quota_settle(uuid, integer) from public, anon, authenticated;
revoke all on function public.email_quota_release(uuid) from public, anon, authenticated;
revoke all on function public.email_plan_activate(uuid, text, text, numeric, numeric, uuid, text) from public, anon, authenticated;
revoke all on function public.email_plan_due_renewals(integer) from public, anon, authenticated;
revoke all on function public.email_plan_lapse_expired() from public, anon, authenticated;
grant execute on function public.email_quota_current_period(uuid) to service_role;
grant execute on function public.email_quota_reserve(uuid, integer, text, text, boolean) to service_role;
grant execute on function public.email_quota_record_overage(uuid, uuid, integer, numeric, numeric, uuid, text) to service_role;
grant execute on function public.email_quota_settle(uuid, integer) to service_role;
grant execute on function public.email_quota_release(uuid) to service_role;
grant execute on function public.email_plan_activate(uuid, text, text, numeric, numeric, uuid, text) to service_role;
grant execute on function public.email_plan_due_renewals(integer) to service_role;
grant execute on function public.email_plan_lapse_expired() to service_role;

/* The customer's own plan, quota and consent, for the UI. Creates the Free account on first read. */
create or replace function public.my_email_plan()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_owner uuid := public.current_homatch_user_id();
  v_period_id uuid;
  v_period public.email_quota_periods;
  v_sub public.email_subscriptions;
  v_free public.email_quota_periods;
begin
  if v_owner is null then raise exception 'FORBIDDEN'; end if;
  v_period_id := public.email_quota_current_period(v_owner);
  select * into v_period from public.email_quota_periods where id = v_period_id;
  select * into v_sub from public.email_subscriptions where owner_user_id = v_owner;
  select * into v_free from public.email_quota_periods where owner_user_id = v_owner and kind = 'FREE_LIFETIME';
  return jsonb_build_object(
    'plan', v_sub.plan_code, 'status', v_sub.status, 'effectivePlan', v_period.plan_code,
    'autoRenew', v_sub.auto_renew, 'pendingPlan', v_sub.pending_plan_code,
    'overageEnabled', v_sub.overage_enabled, 'overageConsentedAt', v_sub.overage_consented_at, 'overageMaxBlocks', v_sub.overage_max_blocks,
    'period', jsonb_build_object('id', v_period.id, 'kind', v_period.kind, 'startsAt', v_period.starts_at, 'endsAt', v_period.ends_at,
      'included', v_period.included, 'used', v_period.used, 'reserved', v_period.reserved,
      'remaining', greatest(v_period.included - v_period.used - v_period.reserved, 0),
      'overageUsed', v_period.overage_used, 'overageBlocksBilled', v_period.overage_blocks_billed),
    'freeRemaining', greatest(coalesce(v_free.included - v_free.used - v_free.reserved, 0), 0),
    'plans', (select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'priceUsd', price_usd_gross,
                'includedEmails', included_emails, 'period', period, 'credits', price_usd_gross * public.billing_setting_num('credits_per_usd', 10)) order by sort_order)
                from public.email_plans where active),
    'overagePricePer1kUsd', 2.20);
end;
$function$;

/* Overage is off until the customer turns it on; turning it on records the consent moment. */
create or replace function public.my_email_set_overage(p_enabled boolean, p_max_blocks integer default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_owner uuid := public.current_homatch_user_id();
begin
  if v_owner is null then raise exception 'FORBIDDEN'; end if;
  if p_max_blocks is not null and (p_max_blocks < 1 or p_max_blocks > 1000) then raise exception 'INVALID_CAP'; end if;
  perform public.email_quota_current_period(v_owner);
  update public.email_subscriptions
     set overage_enabled = coalesce(p_enabled, false),
         overage_consented_at = case when coalesce(p_enabled, false) then now() else null end,
         overage_max_blocks = case when coalesce(p_enabled, false) then p_max_blocks else null end,
         updated_at = now()
   where owner_user_id = v_owner;
  return public.my_email_plan();
end;
$function$;

create or replace function public.my_email_set_auto_renew(p_enabled boolean, p_next_plan text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_owner uuid := public.current_homatch_user_id();
begin
  if v_owner is null then raise exception 'FORBIDDEN'; end if;
  if p_next_plan is not null and p_next_plan not in ('PRO', 'SCALE') then raise exception 'UNKNOWN_PLAN'; end if;
  perform public.email_quota_current_period(v_owner);
  update public.email_subscriptions
     set auto_renew = coalesce(p_enabled, false),
         pending_plan_code = case when p_next_plan is not null and p_next_plan <> plan_code then p_next_plan else null end,
         updated_at = now()
   where owner_user_id = v_owner;
  return public.my_email_plan();
end;
$function$;
revoke all on function public.my_email_plan() from public, anon;
revoke all on function public.my_email_set_overage(boolean, integer) from public, anon;
revoke all on function public.my_email_set_auto_renew(boolean, text) from public, anon;
grant execute on function public.my_email_plan() to authenticated;
grant execute on function public.my_email_set_overage(boolean, integer) to authenticated;
grant execute on function public.my_email_set_auto_renew(boolean, text) to authenticated;

------------------------------------------------------------------------------
-- 5. Billable products, Finance V2 policy and service.
------------------------------------------------------------------------------
insert into public.billable_products (code, name, billing_mode, requires_reservation, standard_retail_cents, reference_landed_cogs_cents,
  min_gross_margin_bps, estimate_strategy, pricing_version, enabled, pricing_active, kill_switch, sort_order, config, min_viable_budget_credits)
values
  ('EMAIL_PLAN_PRO', 'Email Marketing Pro (1 month)', 'FIXED', true, 5000, 0, 0, 'FIXED', 1, true, true, false, 400,
   '{"unit":"MONTH","included_emails":50000,"vat_inclusive":true,"pricing_policy":"email_marketing_37_63_vat_v1"}', 0),
  ('EMAIL_PLAN_SCALE', 'Email Marketing Scale (1 month)', 'FIXED', true, 22000, 0, 0, 'FIXED', 1, true, true, false, 401,
   '{"unit":"MONTH","included_emails":100000,"vat_inclusive":true,"pricing_policy":"email_marketing_37_63_vat_v1"}', 0),
  ('EMAIL_OVERAGE_1K', 'Email Marketing overage (1,000 emails)', 'FIXED', true, 220, 0, 0, 'PER_UNIT', 1, true, true, false, 402,
   '{"unit":"1000_EMAILS","vat_inclusive":true,"requires_customer_consent":true,"pricing_policy":"email_marketing_37_63_vat_v1"}', 0)
on conflict (code) do nothing;

insert into public.finance_commercial_policies (policy_id, kind, params, status, description) values
  ('email_marketing_37_63_vat_v1', 'PERCENT_SPLIT',
   '{"executionBps":6300,"homatchBps":3700,"base":"VAT_EXCLUSIVE","vatBps":1800,"prices":{"PRO":50,"SCALE":220,"overagePer1k":2.2}}',
   'CURRENT',
   'Email Marketing plans (owner, 2026-10-22): VAT-inclusive prices; VAT out first, then 37% HOMATCH / 63% execution of the VAT-exclusive revenue. Allocations are not costs; Resend/AI cost is reported separately.')
on conflict (policy_id) do nothing;

insert into public.finance_services (service_key, name, product_codes, policy_id, pricing_kind, price_note, service_control_key, sort_order) values
  ('email_marketing', 'Email Marketing', '{EMAIL_PLAN_PRO,EMAIL_PLAN_SCALE,EMAIL_OVERAGE_1K}', 'email_marketing_37_63_vat_v1', 'FIXED',
   'Free 50 lifetime · Pro $50/mo 50k · Scale $220/mo 100k · overage $2.20 per 1k with consent (VAT incl.)', 'email_campaigns', 125)
on conflict (service_key) do nothing;

------------------------------------------------------------------------------
-- 6. Deliverability on the outreach path.
------------------------------------------------------------------------------
/* A bounce or complaint on an outreach send suppresses the contact (and, through the
   address-level trigger below, every row of that owner with the same address). */
create or replace function public.outreach_sends_suppress_on_bounce()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.contact_id is null or new.status is not distinct from old.status then return new; end if;
  if new.status = 'BOUNCED' then
    update public.outreach_contacts
       set bounce_count = coalesce(bounce_count, 0) + 1, suppressed = true,
           suppressed_reason = coalesce(suppressed_reason, 'HARD_BOUNCE'), updated_at = now()
     where id = new.contact_id;
  elsif new.status = 'COMPLAINED' then
    update public.outreach_contacts
       set complaint_count = coalesce(complaint_count, 0) + 1, suppressed = true, do_not_contact = true,
           suppressed_reason = coalesce(suppressed_reason, 'COMPLAINT'), updated_at = now()
     where id = new.contact_id;
  end if;
  return new;
end;
$function$;
revoke all on function public.outreach_sends_suppress_on_bounce() from public, anon, authenticated;
drop trigger if exists trg_outreach_sends_suppress on public.outreach_sends;
create trigger trg_outreach_sends_suppress
  after update of status on public.outreach_sends
  for each row execute function public.outreach_sends_suppress_on_bounce();

/* An opt-out belongs to the ADDRESS: any of an owner's rows opting out applies to all of that
   owner's rows with the same email, now and for rows added later. Flags only ever turn on. */
create or replace function public.outreach_contacts_share_email_optout()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.email is null or new.owner_id is null then return new; end if;
  if tg_op = 'INSERT' then
    select coalesce(bool_or(coalesce(x.unsubscribed, false)), false) or coalesce(new.unsubscribed, false),
           coalesce(bool_or(coalesce(x.suppressed, false)), false) or coalesce(new.suppressed, false),
           coalesce(bool_or(coalesce(x.do_not_contact, false)), false) or coalesce(new.do_not_contact, false)
      into new.unsubscribed, new.suppressed, new.do_not_contact
      from public.outreach_contacts x
     where x.owner_id = new.owner_id and lower(x.email) = lower(new.email);
    return new;
  end if;
  /* Propagation ends by itself (only rows not yet flagged are touched); the depth bound is a
     safety net. Depth 2 is the normal case when a bounce on outreach_sends suppresses the contact. */
  if pg_trigger_depth() <= 3 and (
       (coalesce(new.unsubscribed, false) and not coalesce(old.unsubscribed, false))
    or (coalesce(new.suppressed, false) and not coalesce(old.suppressed, false))
    or (coalesce(new.do_not_contact, false) and not coalesce(old.do_not_contact, false))) then
    update public.outreach_contacts x
       set unsubscribed = coalesce(x.unsubscribed, false) or coalesce(new.unsubscribed, false),
           unsubscribed_at = case when coalesce(new.unsubscribed, false) and not coalesce(x.unsubscribed, false)
                                  then coalesce(new.unsubscribed_at, now()) else x.unsubscribed_at end,
           suppressed = coalesce(x.suppressed, false) or coalesce(new.suppressed, false),
           do_not_contact = coalesce(x.do_not_contact, false) or coalesce(new.do_not_contact, false),
           updated_at = now()
     where x.owner_id = new.owner_id and lower(x.email) = lower(new.email) and x.id <> new.id
       and ((coalesce(new.unsubscribed, false) and not coalesce(x.unsubscribed, false))
         or (coalesce(new.suppressed, false) and not coalesce(x.suppressed, false))
         or (coalesce(new.do_not_contact, false) and not coalesce(x.do_not_contact, false)));
  end if;
  return new;
end;
$function$;
revoke all on function public.outreach_contacts_share_email_optout() from public, anon, authenticated;
drop trigger if exists trg_outreach_contacts_optout_insert on public.outreach_contacts;
create trigger trg_outreach_contacts_optout_insert
  before insert on public.outreach_contacts
  for each row execute function public.outreach_contacts_share_email_optout();
drop trigger if exists trg_outreach_contacts_optout_update on public.outreach_contacts;
create trigger trg_outreach_contacts_optout_update
  after update of unsubscribed, suppressed, do_not_contact on public.outreach_contacts
  for each row execute function public.outreach_contacts_share_email_optout();

/* Existing data: an address already opted out on one row is opted out on all of that owner's rows. */
update public.outreach_contacts c
   set unsubscribed = true, unsubscribed_at = coalesce(c.unsubscribed_at, now()), updated_at = now()
 where c.email is not null and not coalesce(c.unsubscribed, false)
   and exists (select 1 from public.outreach_contacts x
                where x.owner_id = c.owner_id and lower(x.email) = lower(c.email) and coalesce(x.unsubscribed, false));
update public.outreach_contacts c
   set suppressed = true, updated_at = now()
 where c.email is not null and not coalesce(c.suppressed, false)
   and exists (select 1 from public.outreach_contacts x
                where x.owner_id = c.owner_id and lower(x.email) = lower(c.email) and coalesce(x.suppressed, false));

/* A RUNNING email campaign with eligible contacts left is picked up again (one lease per minute),
   so a scheduled campaign no longer stops after its first batch. */
create or replace function public.outreach_claim_running_campaigns(p_limit integer default 5)
returns table (id uuid, owner_id uuid, campaign_type text)
language sql
security definer
set search_path to 'public'
as $function$
  update public.outreach_campaigns c
     set updated_at = now()
   where c.id in (
     select c2.id from public.outreach_campaigns c2
      where c2.status = 'RUNNING' and c2.campaign_type = 'EMAIL'
        and c2.send_eligibility = 'PRODUCTION'
        and c2.updated_at < now() - interval '60 seconds'
        and c2.contact_list_id is not null
        and exists (
          select 1 from public.outreach_contacts oc
           where oc.list_id = c2.contact_list_id and oc.owner_id = c2.owner_id
             and oc.email is not null and not coalesce(oc.suppressed, false)
             and not coalesce(oc.unsubscribed, false) and not coalesce(oc.do_not_contact, false)
             and not coalesce(oc.is_duplicate, false)
             and not exists (select 1 from public.outreach_sends s
                              where s.campaign_id = c2.id and s.contact_id = oc.id and s.status <> 'FAILED'))
      order by c2.updated_at
      for update skip locked
      limit greatest(1, least(coalesce(p_limit, 5), 20))
   )
  returning c.id, c.owner_id, c.campaign_type;
$function$;
revoke all on function public.outreach_claim_running_campaigns(integer) from public, anon, authenticated;
grant execute on function public.outreach_claim_running_campaigns(integer) to service_role;

/* One answer to "may this owner email this address?" across both sending systems. */
create or replace function public.email_address_suppressed(p_owner_auth uuid, p_email text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (select 1 from public.email_studio_suppressions s where lower(s.email) = lower(p_email))
      or exists (select 1 from public.outreach_contacts c
                  where c.owner_id = p_owner_auth and lower(c.email) = lower(p_email)
                    and (coalesce(c.unsubscribed, false) or coalesce(c.suppressed, false) or coalesce(c.do_not_contact, false)));
$function$;
revoke all on function public.email_address_suppressed(uuid, text) from public, anon, authenticated;
grant execute on function public.email_address_suppressed(uuid, text) to service_role;

------------------------------------------------------------------------------
-- 7. Admin operations overview.
------------------------------------------------------------------------------
create or replace function public.email_ops_overview(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'windowDays', greatest(1, least(coalesce(p_days, 30), 365)),
    'switches', (select jsonb_object_agg(key, value) from public.admin_settings
                  where key in ('provider_kill_switch','outreach_email_sending_enabled','email_studio_sending_enabled','email_studio_daily_recipient_cap','spend_cap_resend')),
    'outreach', (select jsonb_build_object('sent', count(*) filter (where status in ('SENT','DELIVERED','BOUNCED','COMPLAINED')),
                   'delivered', count(*) filter (where status = 'DELIVERED'), 'bounced', count(*) filter (where status = 'BOUNCED'),
                   'complained', count(*) filter (where status = 'COMPLAINED'), 'failed', count(*) filter (where status = 'FAILED'))
                   from public.outreach_sends where created_at >= v_since and channel = 'EMAIL'),
    'studio', (select jsonb_build_object('sent', count(*) filter (where sent_at is not null), 'delivered', count(*) filter (where delivered_at is not null),
                 'bounced', count(*) filter (where bounced_at is not null), 'complained', count(*) filter (where complained_at is not null),
                 'failed', count(*) filter (where status = 'FAILED'))
                 from public.email_studio_recipients where created_at >= v_since),
    'webhooks', (select jsonb_build_object('received', count(*), 'errors', count(*) filter (where processing_error is not null),
                   'unprocessed', count(*) filter (where processed_at is null), 'duplicates', coalesce(sum(duplicate_count), 0),
                   'byType', (select jsonb_object_agg(event_type, n) from (select event_type, count(*) n from public.comm_webhook_events
                              where provider = 'RESEND' and received_at >= v_since group by 1) t))
                   from public.comm_webhook_events where provider = 'RESEND' and received_at >= v_since),
    'inbound', (select count(*) from public.comm_messages where direction = 'INBOUND' and created_at >= v_since
                  and conversation_id in (select id from public.comm_conversations where channel = 'EMAIL')),
    'domains', (select jsonb_object_agg(status, n) from (select status, count(*) n from public.email_sending_domains group by 1) d),
    'subscriptions', (select jsonb_object_agg(plan_code || ':' || status, n) from (select plan_code, status, count(*) n from public.email_subscriptions group by 1, 2) s),
    'quota', (select jsonb_build_object('openReservations', count(*) filter (where status = 'RESERVED'),
                'staleReservations', count(*) filter (where status = 'RESERVED' and created_at < now() - interval '1 hour'))
                from public.email_quota_reservations),
    'billing', (select jsonb_build_object('events', count(*), 'grossUsd', coalesce(sum(gross_usd), 0))
                  from public.email_billing_events where created_at >= v_since)
  );
end;
$function$;
revoke all on function public.email_ops_overview(integer) from public, anon;
grant execute on function public.email_ops_overview(integer) to authenticated;

------------------------------------------------------------------------------
-- 8. Consent for marketing email (lead discovery is NOT marketing eligibility).
------------------------------------------------------------------------------
alter table public.outreach_contacts add column if not exists consent_lawful_basis text
  check (consent_lawful_basis is null or consent_lawful_basis in ('CONSENT','CONTRACT','LEGITIMATE_INTEREST_EXISTING_CUSTOMER'));
alter table public.outreach_contacts add column if not exists consent_recorded_at timestamptz;
comment on column public.outreach_contacts.consent_lawful_basis is
  'Why marketing email to this contact is lawful. Marketing sends require consent_status = CONSENTED. A contact found by Find Buyers is never marketing-eligible by discovery alone.';

------------------------------------------------------------------------------
-- 9. Provider economics (layers B/C/D): Resend's published prices, kept apart from
--    customer entitlements (layer A) and allocations (layer E).
------------------------------------------------------------------------------
create table if not exists public.email_provider_price_tiers (
  id                 text primary key,
  product            text not null check (product in ('TRANSACTIONAL','MARKETING','ADDON')),
  tier_name          text not null,
  monthly_usd        numeric(12,2),
  emails_per_month   integer,
  contacts_limit     integer,
  domains_included   integer,
  overage_per_1k_usd numeric(8,4),
  source_url         text not null,
  verified_on        date not null,
  note               text
);
insert into public.email_provider_price_tiers (id, product, tier_name, monthly_usd, emails_per_month, contacts_limit, domains_included, overage_per_1k_usd, source_url, verified_on, note) values
  ('tx_free',       'TRANSACTIONAL', 'Free',  0,    3000,    null, 3,    null, 'https://resend.com/pricing?product=transactional', '2026-10-22', '100 emails/day'),
  ('tx_pro_50k',    'TRANSACTIONAL', 'Pro',   20,   50000,   null, 10,   0.90, 'https://resend.com/pricing?product=transactional', '2026-10-22', null),
  ('tx_pro_100k',   'TRANSACTIONAL', 'Pro',   35,   100000,  null, 10,   0.90, 'https://resend.com/pricing?product=transactional', '2026-10-22', null),
  ('tx_scale_100k', 'TRANSACTIONAL', 'Scale', 90,   100000,  null, 1000, 0.90, 'https://resend.com/pricing?product=transactional', '2026-10-22', null),
  ('tx_scale_200k', 'TRANSACTIONAL', 'Scale', 160,  200000,  null, 1000, 0.80, 'https://resend.com/pricing?product=transactional', '2026-10-22', null),
  ('tx_scale_500k', 'TRANSACTIONAL', 'Scale', 350,  500000,  null, 1000, 0.70, 'https://resend.com/pricing?product=transactional', '2026-10-22', null),
  ('tx_scale_1m',   'TRANSACTIONAL', 'Scale', 650,  1000000, null, 1000, 0.65, 'https://resend.com/pricing?product=transactional', '2026-10-22', null),
  ('tx_scale_1_5m', 'TRANSACTIONAL', 'Scale', 825,  1500000, null, 1000, 0.52, 'https://resend.com/pricing?product=transactional', '2026-10-22', null),
  ('tx_scale_2_5m', 'TRANSACTIONAL', 'Scale', 1150, 2500000, null, 1000, 0.46, 'https://resend.com/pricing?product=transactional', '2026-10-22', null),
  ('mk_free',       'MARKETING', 'Free', 0,   null, 1000,   null, null, 'https://resend.com/pricing?product=marketing', '2026-10-22', 'contact-based; sends not limited'),
  ('mk_pro_5k',     'MARKETING', 'Pro',  40,  null, 5000,   null, null, 'https://resend.com/pricing?product=marketing', '2026-10-22', null),
  ('mk_pro_10k',    'MARKETING', 'Pro',  80,  null, 10000,  null, null, 'https://resend.com/pricing?product=marketing', '2026-10-22', null),
  ('mk_pro_15k',    'MARKETING', 'Pro',  120, null, 15000,  null, null, 'https://resend.com/pricing?product=marketing', '2026-10-22', null),
  ('mk_pro_25k',    'MARKETING', 'Pro',  180, null, 25000,  null, null, 'https://resend.com/pricing?product=marketing', '2026-10-22', null),
  ('mk_pro_50k',    'MARKETING', 'Pro',  250, null, 50000,  null, null, 'https://resend.com/pricing?product=marketing', '2026-10-22', null),
  ('mk_pro_100k',   'MARKETING', 'Pro',  450, null, 100000, null, null, 'https://resend.com/pricing?product=marketing', '2026-10-22', null),
  ('mk_pro_150k',   'MARKETING', 'Pro',  650, null, 150000, null, null, 'https://resend.com/pricing?product=marketing', '2026-10-22', null),
  ('addon_domains_100',  'ADDON', 'Additional 100 domains', 20, null, null, 100, null, 'https://resend.com/pricing?product=transactional', '2026-10-22', 'Pro and Scale'),
  ('addon_dedicated_ip', 'ADDON', 'Dedicated IP', 30, null, null, null, null, 'https://resend.com/pricing?product=transactional', '2026-10-22', 'Scale, >3,000 emails/day')
on conflict (id) do nothing;
alter table public.email_provider_price_tiers enable row level security;
revoke all on public.email_provider_price_tiers from public, anon, authenticated;
grant all on public.email_provider_price_tiers to service_role;

/* What Resend's GET /usage reported, one row per poll. Admin-only. */
create table if not exists public.email_provider_usage_snapshots (
  id          uuid primary key default gen_random_uuid(),
  provider    text not null default 'RESEND',
  captured_at timestamptz not null default now(),
  ok          boolean not null,
  error       text,
  usage       jsonb
);
create index if not exists email_provider_usage_snapshots_at on public.email_provider_usage_snapshots (captured_at desc);
alter table public.email_provider_usage_snapshots enable row level security;
revoke all on public.email_provider_usage_snapshots from public, anon, authenticated;
grant all on public.email_provider_usage_snapshots to service_role;

/* Bulk marketing route: TRANSACTIONAL (per-recipient /emails, our own suppression and quota)
   until the Resend Marketing subscription and its contact limits are verified; BROADCAST only
   when an admin switches it. Never changed by code. */
insert into public.admin_settings (key, value) values
  ('email_marketing_route', '"TRANSACTIONAL"'::jsonb),
  ('email_marketing_reply_domain', '"reply.homatch.live"'::jsonb),
  ('email_marketing_default_sender', '"CSmarketing@homatch.live"'::jsonb),
  ('email_marketing_provider_alert_pct', '80'::jsonb)
on conflict (key) do nothing;

/* Admin economics: customer revenue and allocations next to provider capacity and recorded cost. */
create or replace function public.email_economics_overview(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'windowDays', greatest(1, least(coalesce(p_days, 30), 365)),
    'revenue', (select jsonb_build_object(
        'grossUsd', coalesce(sum(r.gross_usd), 0), 'netUsd', coalesce(sum(r.net_usd), 0), 'vatUsd', coalesce(sum(r.vat_usd), 0),
        'homatchAllocationUsd', coalesce(sum(r.homatch_allocation_usd), 0), 'executionAllocationUsd', coalesce(sum(r.execution_allocation_usd), 0),
        'lines', count(*))
        from public.finance_v2_revenue_lines r where r.service_key = 'email_marketing' and r.occurred_at >= v_since),
    'providerCosts', (select jsonb_build_object(
        'recordedUsd', coalesce(sum(c.cost_usd) filter (where coalesce(c.pricing_state, 'ESTIMATED') <> 'UNPRICED'), 0),
        'unpricedLines', count(*) filter (where c.pricing_state = 'UNPRICED'),
        'lines', count(*))
        from public.cost_events c where c.provider = 'RESEND' and c.timestamp >= v_since),
    'latestUsage', (select jsonb_build_object('capturedAt', captured_at, 'ok', ok, 'error', error, 'usage', usage)
        from public.email_provider_usage_snapshots order by captured_at desc limit 1),
    'priceTiers', (select jsonb_agg(to_jsonb(t) order by t.product, t.monthly_usd) from public.email_provider_price_tiers t),
    'customerVolume', (select jsonb_build_object('includedUsed', coalesce(sum(used), 0), 'overageUsed', coalesce(sum(overage_used), 0),
        'overageBlocksBilled', coalesce(sum(overage_blocks_billed), 0),
        'committedAllowance', coalesce(sum(included) filter (where kind = 'MONTHLY' and ends_at > now()), 0))
        from public.email_quota_periods where ends_at is null or ends_at > v_since),
    'activePaid', (select count(*) from public.email_subscriptions s join public.email_quota_periods p on p.id = s.current_period_id
        where s.status = 'ACTIVE' and p.kind = 'MONTHLY' and p.ends_at > now()),
    'domains', (select count(*) from public.email_sending_domains where status <> 'DISCONNECTED'),
    'settings', (select jsonb_object_agg(key, value) from public.admin_settings where key like 'email_marketing_%')
  );
end;
$function$;
revoke all on function public.email_economics_overview(integer) from public, anon;
grant execute on function public.email_economics_overview(integer) to authenticated;

------------------------------------------------------------------------------
-- 10. Finance V2 revenue lines: the same view, verbatim from 20261119140000, with the
--     Email Marketing policy added to the two allocation branches (37/63 of VAT-exclusive).
------------------------------------------------------------------------------
create or replace view public.finance_v2_revenue_lines with (security_invoker = true) as
with base as (
  /* A charged product no service lists still counts — as 'unattributed', never dropped. */
  select 'usage:' || u.id::text as line_id, coalesce(s.service_key, 'unattributed') as service_key,
         case when u.product_code in ('FIND_CLIENTS', 'FIND_PROPERTY') then coalesce(u.provider_request_id, u.job_ref, u.id::text)
              else coalesce(u.job_ref, u.id::text) end as execution_id,
         u.created_at as occurred_at, u.user_id, u.product_code, u.charged_credits as credits,
         public.finance_credits_to_usd(u.charged_credits, u.created_at) as gross_usd,
         u.released_credits,
         case when u.product_code = 'FIND_CLIENTS' then coalesce(fbc.pricing_policy, 'legacy_find_buyers_quote')
              when u.product_code = 'FIND_PROPERTY' then coalesce(dr.pricing_policy, 'legacy_find_property_quote')
              else s.policy_id end as policy_id,
         coalesce((u.metadata ->> 'profit_floor_shortfall')::boolean, false) as profit_floor_shortfall,
         'usage_events'::text as source
    from public.usage_events u
    left join public.finance_services s on u.product_code = any (s.product_codes)
    left join public.find_buyers_campaigns fbc on u.product_code = 'FIND_CLIENTS' and fbc.matching_job_id::text = u.provider_request_id
    left join public.discovery_runs dr on u.product_code = 'FIND_PROPERTY' and dr.id::text = u.provider_request_id
   where u.charged_credits > 0
  union all
  select 'ledger:' || l.id::text,
         case l.type::text when 'MATCH_UNLOCK' then 'match_unlocks' when 'BROKER_DIRECTORY_LISTING' then 'broker_directory' else 'broker_discovery' end,
         coalesce(l.reference, l.id::text), l.created_at, l.user_id, l.type::text, -l.amount,
         public.finance_credits_to_usd(-l.amount, l.created_at), 0, 'fixed_retail_v1', false, 'credit_ledger'
    from public.credit_ledger l
   where l.type::text in ('MATCH_UNLOCK', 'BROKER_DIRECTORY_LISTING', 'BROKER_DISCOVERY') and l.amount < 0
  union all
  select 'meta:' || m.id::text, 'meta_ads_fee', coalesce(m.campaign_id::text, m.id::text), m.created_at, m.user_id, m.entry_type::text, null,
         -m.amount_cents / 100.0, 0, /* HOMATCH_FEE is stored negative (revenue), FEE_RELEASE positive (refund) */
         'meta_ads_fee_v1', false, 'meta_ads_ledger'
    from public.meta_ads_ledger m
   where m.entry_type::text in ('HOMATCH_FEE', 'FEE_RELEASE') and upper(coalesce(m.currency, 'USD')) = 'USD'
)
select b.*, t.vat_bps, sp.net_usd, sp.vat_usd,
       case when b.policy_id in ('paid_discovery_37_63_vat_v2', 'email_marketing_37_63_vat_v1') then round(sp.net_usd * 0.37, 6)
            when b.policy_id = 'paid_discovery_37_63_v1' then round(b.gross_usd * 0.37, 6) end as homatch_allocation_usd,
       case when b.policy_id in ('paid_discovery_37_63_vat_v2', 'email_marketing_37_63_vat_v1') then round(sp.net_usd * 0.63, 6)
            when b.policy_id = 'paid_discovery_37_63_v1' then round(b.gross_usd * 0.63, 6) end as execution_allocation_usd
  from base b
  cross join lateral (select public.finance_vat_bps_at(b.occurred_at) as vat_bps) t
  cross join lateral public.finance_split_gross(b.gross_usd, t.vat_bps) sp;

------------------------------------------------------------------------------
-- 11. Finance V2.1 cost lines: the same view, verbatim from 20261123090000, with email
--     provider cost (Studio, outreach, CRM replies) attributed to email_marketing, the
--     service that now carries email revenue — so Admin margin is revenue minus ITS cost.
------------------------------------------------------------------------------
create or replace view public.finance_v2_cost_lines with (security_invoker = true) as
with ce as (
  select c.id, c.provider, c.operation_type, c.source, c.request_id, c.units, c.cost_usd, c.pricing_state,
         c.job_id, c.discovery_job_id, c."timestamp", c.correlation_id, c.model, c.input_tokens, c.output_tokens, c.cached_input_tokens,
         coalesce(c.finance_service, case
           when c.job_id is not null and (c.operation_type like 'VERIFY\_%' or c.operation_type in ('REPORT_TRANSLATION_VERIFY', 'DEVELOPER_ADS_VERIFY')) then 'verify'
           /* Find Property search AI: cost_events is the correlated record (20261119130000_find_property_costs). */
           when c.operation_type like 'MARKETPLACE\_%' then 'find_property_search'
           when c.operation_type like 'FIND\_BUYERS%' or c.operation_type in ('FIND_PROPERTY_ACTOR_RUN', 'CAPTCHA_SOLVE') then null
           when c.operation_type = 'MATCH_UNLOCK' then null /* a $0 marker row, not a cost */
           when c.provider::text in ('DATAFORSEO', 'APIFY') then 'retired_providers'
           when c.operation_type ilike 'meta\_ads%' then 'meta_ads_ai'
           when c.operation_type ilike '%email%' or c.source ilike '%email%' then 'email_marketing'
           /* V2.1: v1 signal classification (CLASSIFY_SIGNAL / _BATCH / _SIGNALS) is shared platform AI too. */
           when c.operation_type ilike 'CLASSIFY\_%' or c.operation_type ilike '%chat%' then 'shared_platform'
           else 'unattributed' end) as service_key
    from public.cost_events c
)
select 'ce:' || ce.id::text as line_id, ce.service_key, coalesce(ce.job_id::text, ce.correlation_id, ce.request_id, ce.discovery_job_id::text) as execution_id,
       ce."timestamp" as occurred_at, ce.provider::text as provider, ce.operation_type as operation, ce.model,
       ce.units, case when ce.input_tokens is not null or ce.output_tokens is not null then 'TOKENS' else 'UNIT' end as unit_label,
       ce.input_tokens::bigint, ce.cached_input_tokens::bigint as cached_tokens, ce.output_tokens::bigint,
       null::numeric as unit_price_usd,
       case when public.finance_cost_status(ce.pricing_state) = 'UNPRICED' then null else ce.cost_usd end as cost_usd,
       public.finance_cost_status(ce.pricing_state) as cost_status, 'cost_events'::text as cost_source, true as is_direct
  from ce where ce.service_key is not null
union all
select 'captcha:' || v.id::text, 'verify', v.job_id::text, v.created_at, coalesce(v.provider, '2CAPTCHA'), 'CAPTCHA_SOLVE ' || coalesce(v.kind, ''), null,
       1, 'SOLVE', null, null, null, v.cost_usd, v.cost_usd,
       case when v.cost_usd is null then 'UNPRICED' else 'ESTIMATED' end, 'verify_captcha_events', true
  from public.verify_captcha_events v where v.job_id is not null
union all
select 'fbrun:' || r.id::text, 'find_buyers', r.matching_job_id::text, coalesce(r.finished_at, r.created_at), 'APIFY_MEMO23',
       coalesce(r.operation, 'ACTOR_RUN') || ' · ' || r.actor_key, null, r.results_billed, 'RESULTS', null, null, null, null,
       coalesce(r.actual_micros, r.reserved_micros) / 1e6,
       case when r.actual_micros is not null and r.cost_basis = 'PROVIDER_REPORTED' then 'ACTUAL' else 'ESTIMATED' end,
       'find_buyers_actor_runs', true
  from public.find_buyers_actor_runs r where r.status <> 'RELEASED'
union all
select 'fbai:' || l.id::text, 'find_buyers', l.matching_job_id::text, l.occurred_at, 'OPENAI', l.kind || ' · ' || coalesce(l.operation, ''), l.model,
       coalesce(l.input_tokens, 0) + coalesce(l.output_tokens, 0), 'TOKENS', l.input_tokens, null, l.output_tokens, null,
       case when upper(coalesce(l.cost_state, '')) = 'UNKNOWN' then null else coalesce(l.actual_micros, l.estimated_micros) / 1e6 end,
       public.finance_cost_status(l.cost_state), 'find_buyers_cost_ledger', true
  from public.find_buyers_cost_ledger l where l.provider = 'OPENAI' and upper(coalesce(l.cost_state, '')) <> 'RELEASED'
union all
select 'fprun:' || r.id::text, 'find_property_paid', r.discovery_run_id::text, r.created_at, 'APIFY_MEMO23',
       coalesce(r.stage, 'ACTOR_RUN') || ' · ' || r.actor_key, null, r.results_billed, 'RESULTS', null, null, null, null,
       coalesce(r.actual_micros, r.reserved_micros) / 1e6,
       case when r.actual_micros is not null then 'ACTUAL' else 'ESTIMATED' end, 'find_property_actor_runs', true
  from public.find_property_actor_runs r where r.status <> 'RELEASED'
union all
select 'usage:' || u.id::text, coalesce(s.service_key, 'unattributed'), coalesce(u.job_ref, u.id::text), u.created_at, coalesce(u.provider, 'OPENAI'),
       coalesce(u.provider_operation, u.product_code), u.model,
       coalesce(u.input_tokens, 0) + coalesce(u.output_tokens, 0), 'TOKENS', u.input_tokens, u.cached_tokens, u.output_tokens, null,
       case when st.status = 'UNPRICED' then null else round((coalesce(u.raw_provider_cost_cents, 0) + coalesce(u.ai_cost_cents, 0)) / 100.0, 8) end,
       st.status, 'usage_events', true
  from public.usage_events u
  left join public.finance_services s on u.product_code = any (s.product_codes)
  cross join lateral (select case
      /* An OpenAI call with tokens but no rate at the time is UNPRICED, whatever 0 was stored
         (billing_ai_cost_cents turns a missing rate into 0). */
      when coalesce(u.provider, 'OPENAI') = 'OPENAI' and u.model is not null and coalesce(u.input_tokens, 0) + coalesce(u.output_tokens, 0) > 0
       and (public.price_per_unit_at('OPENAI', u.model, 'INPUT_TOKEN', u.created_at) is null
            or public.price_per_unit_at('OPENAI', u.model, 'OUTPUT_TOKEN', u.created_at) is null) then 'UNPRICED'
      else public.finance_cost_status(coalesce(u.metadata ->> 'pricing_state', u.pricing_state)) end as status) st
 where u.product_code not in ('VERIFY', 'FIND_CLIENTS', 'FIND_PROPERTY')
   and (coalesce(u.raw_provider_cost_cents, 0) + coalesce(u.ai_cost_cents, 0) > 0 or coalesce(u.input_tokens, 0) + coalesce(u.output_tokens, 0) > 0)
union all
select 'voice:' || v.id::text, 'ai_talk', v.session_id::text, v.occurred_at, v.provider, coalesce(v.role, 'VOICE'), v.model,
       coalesce(v.characters::numeric, v.audio_seconds::numeric, (coalesce(v.input_tokens, 0) + coalesce(v.output_tokens, 0))::numeric),
       case when v.characters is not null then 'CHARACTERS' when v.audio_seconds is not null then 'AUDIO_SECONDS' else 'TOKENS' end,
       v.input_tokens, v.cached_input_tokens, v.output_tokens, null, v.cost_usd,
       case when v.cost_usd is null then 'UNPRICED' else 'ESTIMATED' end, 'voice_usage_events', true
  from public.voice_usage_events v
 /* Admin voice previews are telemetry here; their cost is the voice-ai cost_events row (V2.1). */
 where v.surface is distinct from 'VOICE_PREVIEW';
