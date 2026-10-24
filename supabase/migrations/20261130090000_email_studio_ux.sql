-- EMAIL STUDIO & LEADS — the UX pass (2026-10-24).
--
-- Owner brief "HOMATCH — Final Email Studio & Leads UX Overhaul". What the screens need from the
-- database, and nothing that weakens a rule:
--
--   1. outreach_contacts.first_name / last_name — a lead added by hand has both; full_name stays
--      the field every other path reads (it is kept as "first last"). Adding a lead NEVER marks
--      it consented: consent is recorded only through my_outreach_contact_set_email_consent,
--      with a lawful basis, exactly as before.
--   2. outreach_campaigns.email_draft_key — a client-generated key per unsaved draft, unique per
--      owner, so a retried or double-fired first save returns the same draft instead of a second.
--   3. email_assets — images and logos uploaded for email designs. The bytes live in the private
--      R2 bucket (users/<account>/email-assets/<uuid>.<ext>); this row is the registry the public
--      image link (email-webhook ?ema=<id>) serves from. Only the service role writes it; the
--      owner reads their own. A DELETED row is never served again.
--   4. email_audience_matches: + contactIds — individually selected leads. The batch, estimate
--      and scheduler all call this one predicate, so selection means the same thing everywhere.
--      email_audience_estimate now also excludes globally suppressed addresses (bounces and
--      complaints on any account), so "eligible" is the count that will actually be sent.
--   5. my_email_allowance() — the real sending allowance: plan period, overage terms, the
--      per-customer daily ceiling, HOMATCH's provider day/month ceilings and the switches. Read
--      from the same settings email_quota_reserve enforces; nothing is assumed. Provider-wide
--      figures are returned as REMAINING capacity only, never other customers' volumes.
--   6. my_email_contacts_overview() — the Leads workspace header: how many leads, how many can
--      receive email, unsubscribed, suppressed, missing consent, per list. Counts, never addresses.
--   7. my_outreach_contacts_delete(ids) — delete leads that have no sending history; a lead that
--      was already contacted is kept (the history references it) and reported back, so the UI
--      can offer "unsubscribe" instead.
-- Additive: no existing row changes.

/* ── 1. names ─────────────────────────────────────────────────────────────────────────────── */
alter table public.outreach_contacts
  add column if not exists first_name text,
  add column if not exists last_name text;
alter table public.outreach_contacts drop constraint if exists outreach_contacts_name_parts_len;
alter table public.outreach_contacts add constraint outreach_contacts_name_parts_len
  check (coalesce(length(first_name), 0) <= 80 and coalesce(length(last_name), 0) <= 80);

/* ── 2. draft key ─────────────────────────────────────────────────────────────────────────── */
alter table public.outreach_campaigns add column if not exists email_draft_key uuid;
create unique index if not exists outreach_campaigns_email_draft_key
  on public.outreach_campaigns (owner_id, email_draft_key) where email_draft_key is not null;

/* ── 3. assets ────────────────────────────────────────────────────────────────────────────── */
create table if not exists public.email_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,                                   -- auth uid, as outreach_* rows
  owner_user_id uuid not null references public.users (id) on delete cascade,
  object_key text not null unique,
  content_type text not null check (content_type in ('image/png', 'image/jpeg', 'image/gif')),
  byte_size integer not null check (byte_size > 0 and byte_size <= 5242880),
  width integer check (width is null or width between 1 and 10000),
  height integer check (height is null or height between 1 and 10000),
  kind text not null default 'IMAGE' check (kind in ('IMAGE', 'LOGO')),
  original_filename text check (original_filename is null or length(original_filename) <= 200),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'DELETED')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists email_assets_owner on public.email_assets (owner_id, created_at desc) where status = 'ACTIVE';
alter table public.email_assets enable row level security;
drop policy if exists email_assets_owner_read on public.email_assets;
create policy email_assets_owner_read on public.email_assets for select to authenticated
  using (owner_id = (select auth.uid()) and status = 'ACTIVE');
revoke all on public.email_assets from anon, authenticated;
grant select on public.email_assets to authenticated;
grant all on public.email_assets to service_role;

/* ── 4. audience: individually selected leads; estimate excludes global suppressions ──────── */
create or replace function public.email_audience_matches(oc public.outreach_contacts, f jsonb)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select (f is null or jsonb_typeof(f) <> 'object' or (
        (coalesce(jsonb_array_length(f->'languages'), 0) = 0 or lower(coalesce(oc.language, 'unknown')) in (select lower(x) from jsonb_array_elements_text(f->'languages') x))
    and (coalesce(jsonb_array_length(f->'countries'), 0) = 0 or upper(coalesce(oc.country, '')) in (select upper(x) from jsonb_array_elements_text(f->'countries') x))
    and (coalesce(jsonb_array_length(f->'leadTypes'), 0) = 0 or upper(coalesce(oc.lead_type, '')) in (select upper(x) from jsonb_array_elements_text(f->'leadTypes') x))
    and (coalesce(jsonb_array_length(f->'sources'), 0) = 0 or upper(coalesce(oc.source_kind, 'IMPORT')) in (select upper(x) from jsonb_array_elements_text(f->'sources') x))
    and (coalesce(jsonb_array_length(f->'tags'), 0) = 0 or coalesce(oc.tags, '{}'::text[]) && array(select jsonb_array_elements_text(f->'tags')))
    and (coalesce(jsonb_array_length(f->'contactIds'), 0) = 0 or oc.id::text in (select x from jsonb_array_elements_text(f->'contactIds') x))
  ));
$function$;

create or replace function public.email_audience_estimate(p_list_ids uuid[], p_filter jsonb)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  with own as (
    select oc.* from public.outreach_contacts oc
     where oc.owner_id = auth.uid() and oc.list_id = any (coalesce(p_list_ids, '{}'::uuid[]))
  ), excluded as (
    select lower(x.email) as email from public.outreach_contacts x
     where x.owner_id = auth.uid() and x.email is not null
       and x.list_id in (select (jsonb_array_elements_text(coalesce(p_filter->'excludeListIds', '[]'::jsonb)))::uuid)
  ), matched as (
    select oc.*,
           exists (select 1 from public.email_studio_suppressions s where lower(s.email) = lower(oc.email)) as globally_suppressed
      from public.outreach_contacts oc
     where oc.owner_id = auth.uid() and oc.list_id = any (coalesce(p_list_ids, '{}'::uuid[]))
       and public.email_audience_matches(oc, p_filter) and (oc.email is null or lower(oc.email) not in (select email from excluded))
  ), reachable as (
    select * from matched where email is not null and coalesce(email_valid, true) and not suppressed and not globally_suppressed
       and not coalesce(do_not_contact, false) and not coalesce(unsubscribed, false) and not coalesce(is_duplicate, false)
  )
  select jsonb_build_object(
    'total', (select count(*) from own),
    'matched', (select count(*) from matched),
    'withEmail', (select count(*) from matched where email is not null),
    'invalidEmail', (select count(*) from matched where email is not null and email_valid = false),
    'reachable', (select count(distinct lower(email)) from reachable),
    'eligible', (select count(distinct lower(email)) from reachable where consent_status = 'CONSENTED'),
    'consentUnknown', (select count(distinct lower(email)) from reachable where consent_status is distinct from 'CONSENTED'),
    'suppressed', (select count(*) from matched where suppressed or coalesce(unsubscribed, false) or coalesce(do_not_contact, false) or globally_suppressed),
    'duplicates', (select count(*) from reachable) - (select count(distinct lower(email)) from reachable),
    'byLanguage', (select coalesce(jsonb_object_agg(l, n), '{}'::jsonb) from (select coalesce(lower(language), 'unknown') l, count(distinct lower(email)) n from reachable where consent_status = 'CONSENTED' group by 1) t),
    'bySource', (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) from (select coalesce(source_kind, 'IMPORT') s, count(distinct lower(email)) n from reachable where consent_status = 'CONSENTED' group by 1) t)
  );
$function$;
revoke all on function public.email_audience_estimate(uuid[], jsonb) from public, anon;
grant execute on function public.email_audience_estimate(uuid[], jsonb) to authenticated;

/* ── 5. the real sending allowance ────────────────────────────────────────────────────────── */
create or replace function public.my_email_allowance()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_owner uuid := public.current_homatch_user_id();
  v_plan jsonb;
  v_sub public.email_subscriptions;
  v_period public.email_quota_periods;
  v_tenant_cap integer := nullif(public.billing_setting_num('email_marketing_tenant_daily_cap', 0), 0)::integer;
  v_day_cap integer := nullif(public.billing_setting_num('email_marketing_provider_daily_cap', 0), 0)::integer;
  v_month_cap integer := nullif(public.billing_setting_num('email_marketing_provider_monthly_cap', 0), 0)::integer;
  v_tenant_used integer; v_day_used integer; v_month_used integer;
  v_kill jsonb; v_live jsonb; v_enabled jsonb;
  v_snap record;
  v_resend_day integer; v_resend_month integer;
  v_overage_room integer;
begin
  if v_owner is null then raise exception 'FORBIDDEN'; end if;
  v_plan := public.my_email_plan();
  select * into v_sub from public.email_subscriptions where owner_user_id = v_owner;
  select * into v_period from public.email_quota_periods where id = (v_plan->'period'->>'id')::uuid;

  select coalesce(sum(case when status = 'RESERVED' then included_part + overage_part else coalesce(sent, 0) end), 0)::integer
    into v_tenant_used from public.email_quota_reservations where owner_user_id = v_owner and created_at >= date_trunc('day', now());
  select coalesce(sum(case when status = 'RESERVED' then included_part + overage_part else coalesce(sent, 0) end), 0)::integer
    into v_day_used from public.email_quota_reservations where created_at >= date_trunc('day', now());
  select coalesce(sum(case when status = 'RESERVED' then included_part + overage_part else coalesce(sent, 0) end), 0)::integer
    into v_month_used from public.email_quota_reservations where created_at >= date_trunc('month', now());

  select value into v_kill from public.admin_settings where key = 'provider_kill_switch';
  select value into v_live from public.admin_settings where key = 'email_marketing_live';
  select value into v_enabled from public.admin_settings where key = 'outreach_email_sending_enabled';

  /* The provider's own figures, when a recent snapshot exists: remaining only. */
  select captured_at, usage into v_snap from public.email_provider_usage_snapshots
   where ok and captured_at > now() - interval '6 hours' order by captured_at desc limit 1;
  if v_snap.usage is not null then
    v_resend_day := case when (v_snap.usage->'emails'->'daily'->>'limit') ~ '^[0-9]+$'
      then greatest((v_snap.usage->'emails'->'daily'->>'limit')::integer - coalesce((v_snap.usage->'emails'->'daily'->>'used')::integer, 0), 0) end;
    v_resend_month := case when (v_snap.usage->'emails'->'monthly'->>'limit') ~ '^[0-9]+$'
      then greatest((v_snap.usage->'emails'->'monthly'->>'limit')::integer - coalesce((v_snap.usage->'emails'->'monthly'->>'used')::integer, 0), 0) end;
  end if;

  /* Overage the customer already consented to (MONTHLY plans only); null = no customer cap. */
  if v_period.kind = 'MONTHLY' and coalesce(v_sub.overage_enabled, false) and v_sub.overage_consented_at is not null then
    v_overage_room := case when v_sub.overage_max_blocks is null then null
      else greatest(v_sub.overage_max_blocks * 1000 - v_period.overage_used - v_period.overage_reserved, 0) end;
  else
    v_overage_room := greatest((v_period.overage_blocks_billed + v_period.overage_blocks_pending) * 1000 - v_period.overage_used - v_period.overage_reserved, 0);
  end if;

  return jsonb_build_object(
    'plan', jsonb_build_object('code', v_plan->>'effectivePlan', 'periodKind', v_period.kind, 'endsAt', v_period.ends_at,
      'included', v_period.included, 'used', v_period.used, 'reserved', v_period.reserved,
      'remaining', greatest(v_period.included - v_period.used - v_period.reserved, 0)),
    'overage', jsonb_build_object('enabled', coalesce(v_sub.overage_enabled, false) and v_sub.overage_consented_at is not null and v_period.kind = 'MONTHLY',
      'room', v_overage_room, 'pricePer1kUsd', 2.20),
    'tenantDaily', case when v_tenant_cap is null then null else jsonb_build_object('cap', v_tenant_cap, 'used', v_tenant_used,
      'remaining', greatest(v_tenant_cap - v_tenant_used, 0), 'resetsAt', date_trunc('day', now()) + interval '1 day') end,
    'providerDaily', case when v_day_cap is null then null else jsonb_build_object('remaining', greatest(v_day_cap - v_day_used, 0),
      'resetsAt', date_trunc('day', now()) + interval '1 day') end,
    'providerMonthly', case when v_month_cap is null then null else jsonb_build_object('remaining', greatest(v_month_cap - v_month_used, 0),
      'resetsAt', date_trunc('month', now()) + interval '1 month') end,
    'provider', case when v_snap.usage is null then null else jsonb_build_object('capturedAt', v_snap.captured_at,
      'dailyRemaining', v_resend_day, 'monthlyRemaining', v_resend_month,
      'ratePerSecond', case when (v_snap.usage->'rate_limit'->>'limit') ~ '^[0-9]+$' then (v_snap.usage->'rate_limit'->>'limit')::integer end) end,
    'sending', jsonb_build_object(
      'enabled', coalesce(v_enabled = 'true'::jsonb or v_enabled = '"true"'::jsonb, false)
                 and not (coalesce(v_kill = 'true'::jsonb or v_kill = '"true"'::jsonb, false)
                          and not coalesce(v_live = 'true'::jsonb or v_live = '"true"'::jsonb, false))),
    'computedAt', now()
  );
end;
$function$;
revoke all on function public.my_email_allowance() from public, anon;
grant execute on function public.my_email_allowance() to authenticated;

/* ── 6. the Leads workspace header ────────────────────────────────────────────────────────── */
create or replace function public.my_email_contacts_overview()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  with mine as (
    select oc.*,
           exists (select 1 from public.email_studio_suppressions s where lower(s.email) = lower(oc.email)) as globally_suppressed
      from public.outreach_contacts oc where oc.owner_id = auth.uid()
  ), r as (
    select *, (email is not null and email <> '' and coalesce(email_valid, true) and not suppressed and not globally_suppressed
               and not coalesce(do_not_contact, false) and not coalesce(unsubscribed, false) and not coalesce(is_duplicate, false)) as reachable
      from mine
  )
  select jsonb_build_object(
    'total', (select count(*) from r),
    'withEmail', (select count(*) from r where email is not null and email <> ''),
    'invalidEmail', (select count(*) from r where email is not null and email <> '' and email_valid = false),
    'canReceive', (select count(distinct lower(email)) from r where reachable and consent_status = 'CONSENTED'),
    'consentMissing', (select count(distinct lower(email)) from r where reachable and consent_status is distinct from 'CONSENTED'),
    'unsubscribed', (select count(*) from r where coalesce(unsubscribed, false)),
    'suppressed', (select count(*) from r where (suppressed or globally_suppressed or coalesce(do_not_contact, false)) and not coalesce(unsubscribed, false)),
    'lists', (select coalesce(jsonb_agg(x order by x->>'createdAt' desc), '[]'::jsonb) from (
       select jsonb_build_object('id', l.id, 'name', l.name, 'createdAt', l.created_at, 'sourceKind', l.source_kind,
         'total', count(r.id), 'canReceive', count(distinct lower(r.email)) filter (where r.reachable and r.consent_status = 'CONSENTED')) x
         from public.outreach_contact_lists l left join r on r.list_id = l.id
        where l.owner_id = auth.uid() and coalesce(l.import_status, 'READY') <> 'ARCHIVED'
        group by l.id) t)
  );
$function$;
revoke all on function public.my_email_contacts_overview() from public, anon;
grant execute on function public.my_email_contacts_overview() to authenticated;

/* ── 7. delete leads without history ──────────────────────────────────────────────────────── */
create or replace function public.my_outreach_contacts_delete(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[] := (select array_agg(distinct x) from unnest(coalesce(p_ids, '{}'::uuid[])) x);
  v_deleted integer := 0;
  v_kept uuid[];
  v_lists uuid[];
begin
  if v_uid is null then raise exception 'FORBIDDEN'; end if;
  if coalesce(array_length(v_ids, 1), 0) > 1000 then raise exception 'TOO_MANY'; end if;
  select array_agg(c.id) into v_kept from public.outreach_contacts c
   where c.owner_id = v_uid and c.id = any (v_ids)
     and exists (select 1 from public.outreach_sends s where s.contact_id = c.id);
  select array_agg(distinct c.list_id) into v_lists from public.outreach_contacts c where c.owner_id = v_uid and c.id = any (v_ids);
  delete from public.outreach_contacts c
   where c.owner_id = v_uid and c.id = any (v_ids) and not (c.id = any (coalesce(v_kept, '{}'::uuid[])));
  get diagnostics v_deleted = row_count;
  update public.outreach_contact_lists l
     set total_rows = (select count(*) from public.outreach_contacts c where c.list_id = l.id), updated_at = now()
   where l.owner_id = v_uid and l.id = any (coalesce(v_lists, '{}'::uuid[]));
  return jsonb_build_object('deleted', v_deleted, 'kept', coalesce(to_jsonb(v_kept), '[]'::jsonb));
end;
$function$;
revoke all on function public.my_outreach_contacts_delete(uuid[]) from public, anon;
grant execute on function public.my_outreach_contacts_delete(uuid[]) to authenticated;
