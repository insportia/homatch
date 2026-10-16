-- HOMATCH EMAIL STUDIO — property-offer email campaigns to UNLOCKED HOMATCH leads.
--
-- A seller who unlocked HOMATCH members (internal_lead_unlocks) may email a property
-- offer to the ones who gave marketing consent. The studio builds on the outreach
-- email machinery that already exists — the Resend adapter, the admin kill switch,
-- the provider switch, the spend cap, the Svix-signed email-webhook and its dedupe —
-- and keeps its OWN thin campaign/recipient rows, for three reasons:
--
--   1. outreach_sends stores recipient_email and its owner SELECT policy hands that
--      column to the browser. A lead's address may never reach the seller's client
--      (an unlock is not consent, and a later withdrawal must apply at once), so the
--      address is resolved at send time on the server and stored nowhere here.
--   2. outreach_campaigns is driven by outreach-send's list-based dispatcher and the
--      jobs-worker scheduler (contact_list_id, RUNNING/COMPLETED, LEGACY_MOCK…). A
--      studio campaign targets members, not an imported list, and must never be
--      picked up by that loop.
--   3. outreach_campaigns.owner_id is the auth id while every HOMATCH Leads object is
--      keyed by the users.id; mixing them is the exact id-space bug the outreach
--      reconciliation migrations had to repair.
--
-- Recipient eligibility (marketing email), re-checked at review AND at claim time:
--   unlocked by this account · member not suspended, not blocked either way ·
--   lead_contact_preferences.accept_marketing_email = true (the explicit consent) ·
--   share_email_on_unlock = true (the address may be disclosed) ·
--   accept_property_offers = true · no notification_preferences row saying
--   marketing_opt_in = false · not suppressed (studio unsubscribe/bounce/complaint)
--   · not unsubscribed/suppressed/do-not-contact/complained in this seller's own
--   outreach_contacts for the same address.
--
-- Campaigns are free (no billable product is touched). Provider cost is recorded
-- in cost_events by the edge handler when a real send happens.
--
-- Append-only. The runner owns the transaction. Safe to apply twice.

/* ════════════════════════════════════════════════════════════════════════
 * 0 · settings (kill switch OFF by default, per-account daily cap)
 * ════════════════════════════════════════════════════════════════════════ */

insert into public.admin_settings (key, value, description)
values ('email_studio_sending_enabled', 'false'::jsonb,
        'Email Studio: allow real campaign and test sends through Resend. Off = draft, preview and review only.')
on conflict (key) do nothing;
insert into public.admin_settings (key, value, description)
values ('email_studio_daily_recipient_cap', '200'::jsonb,
        'Email Studio: maximum campaign recipients one account may send to per rolling 24 hours.')
on conflict (key) do nothing;

/* ════════════════════════════════════════════════════════════════════════
 * 1 · tables
 * ════════════════════════════════════════════════════════════════════════ */

create table if not exists public.email_studio_campaigns (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references public.users(id) on delete cascade,
  property_id    uuid references public.properties(id) on delete set null,
  template_id    text not null default 'PROPERTY_INTRODUCTION' check (template_id in
                   ('PROPERTY_INTRODUCTION', 'MODERN_RESIDENCE', 'PREMIUM_PROPERTY', 'PERSONAL_FOLLOW_UP')),
  name           text not null default '' check (length(name) <= 160),
  language       text not null default 'en' check (language in ('en', 'ka', 'ru', 'tr', 'ar', 'he')),
  -- { subject, preheader, blocks[] } — validated and normalised by the renderer.
  content        jsonb not null default '{}'::jsonb check (pg_column_size(content) <= 65536),
  status         text not null default 'DRAFT' check (status in
                   ('DRAFT', 'REVIEWED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED')),
  reviewed_hash  text,
  reviewed_at    timestamptz,
  approved_at    timestamptz,
  sent_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists email_studio_campaigns_owner on public.email_studio_campaigns (owner_user_id, updated_at desc);
alter table public.email_studio_campaigns enable row level security;
revoke all on public.email_studio_campaigns from anon, authenticated;
grant select on public.email_studio_campaigns to authenticated;
drop policy if exists email_studio_campaigns_own on public.email_studio_campaigns;
create policy email_studio_campaigns_own on public.email_studio_campaigns
  for select to authenticated using (owner_user_id = public.current_homatch_user_id());

create table if not exists public.email_studio_recipients (
  id                  uuid primary key default gen_random_uuid(),
  campaign_id         uuid not null references public.email_studio_campaigns(id) on delete cascade,
  owner_user_id       uuid not null references public.users(id) on delete cascade,
  lead_user_id        uuid not null references public.users(id) on delete cascade,
  unlock_id           uuid references public.internal_lead_unlocks(id) on delete set null,
  status              text not null default 'PENDING' check (status in
                        ('PENDING', 'SENDING', 'SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED',
                         'FAILED', 'SKIPPED')),
  skip_reason         text,
  -- campaign:lead — the send claim. One email per member per campaign, ever.
  idempotency_key     text not null,
  attempt_count       integer not null default 0,
  provider            text,
  provider_message_id text,
  error_message       text,
  cost_usd            numeric(10,6) not null default 0,
  claimed_at          timestamptz,
  sent_at             timestamptz,
  delivered_at        timestamptz,
  bounced_at          timestamptz,
  complained_at       timestamptz,
  unsubscribed_at     timestamptz,
  opened_at           timestamptz,
  open_count          integer not null default 0,
  first_clicked_at    timestamptz,
  click_count         integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (campaign_id, lead_user_id)
);
create unique index if not exists email_studio_recipients_idem on public.email_studio_recipients (idempotency_key);
create index if not exists email_studio_recipients_msg on public.email_studio_recipients (provider_message_id)
  where provider_message_id is not null;
create index if not exists email_studio_recipients_owner_claimed on public.email_studio_recipients (owner_user_id, claimed_at)
  where claimed_at is not null;
alter table public.email_studio_recipients enable row level security;
revoke all on public.email_studio_recipients from anon, authenticated;
grant select on public.email_studio_recipients to authenticated;
drop policy if exists email_studio_recipients_own on public.email_studio_recipients;
create policy email_studio_recipients_own on public.email_studio_recipients
  for select to authenticated using (owner_user_id = public.current_homatch_user_id());

create table if not exists public.email_studio_events (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid references public.email_studio_campaigns(id) on delete cascade,
  recipient_id      uuid references public.email_studio_recipients(id) on delete cascade,
  owner_user_id     uuid not null references public.users(id) on delete cascade,
  kind              text not null check (kind in
                      ('SENT', 'FAILED', 'SKIPPED', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'OPENED', 'CLICKED',
                       'UNSUBSCRIBED', 'TEST_SENT')),
  provider_event_id text,
  detail            jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);
create unique index if not exists email_studio_events_provider_event on public.email_studio_events (provider_event_id)
  where provider_event_id is not null;
create index if not exists email_studio_events_campaign on public.email_studio_events (campaign_id, created_at desc);
create index if not exists email_studio_events_owner_kind on public.email_studio_events (owner_user_id, kind, created_at desc);
alter table public.email_studio_events enable row level security;
revoke all on public.email_studio_events from anon, authenticated;
grant select on public.email_studio_events to authenticated;
drop policy if exists email_studio_events_own on public.email_studio_events;
create policy email_studio_events_own on public.email_studio_events
  for select to authenticated using (owner_user_id = public.current_homatch_user_id());

/* A member who unsubscribed from, bounced or complained about studio mail. Global:
   one seller's bounce is every seller's bounce. Server-only (holds the address). */
create table if not exists public.email_studio_suppressions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.users(id) on delete cascade,
  email       text,
  reason      text not null check (reason in ('UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED', 'MANUAL')),
  source      text not null default 'EMAIL_STUDIO',
  recipient_id uuid references public.email_studio_recipients(id) on delete set null,
  created_at  timestamptz not null default now(),
  check (user_id is not null or email is not null)
);
create unique index if not exists email_studio_suppressions_user_reason on public.email_studio_suppressions (user_id, reason)
  where user_id is not null;
create index if not exists email_studio_suppressions_email on public.email_studio_suppressions (lower(email))
  where email is not null;
alter table public.email_studio_suppressions enable row level security;
revoke all on public.email_studio_suppressions from anon, authenticated;

/* ════════════════════════════════════════════════════════════════════════
 * 2 · internal helpers (service_role only)
 * ════════════════════════════════════════════════════════════════════════ */

create or replace function public.email_studio_display_name(p_user_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(u.nickname, ''), nullif(split_part(coalesce(u.full_name, ''), ' ', 1), ''))
    from public.users u where u.id = p_user_id
$$;
revoke all on function public.email_studio_display_name(uuid) from public, anon, authenticated, service_role;
grant execute on function public.email_studio_display_name(uuid) to service_role;

create or replace function public.email_studio_setting_bool(p_key text, p_default boolean)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select case when jsonb_typeof(value) = 'boolean' then (value #>> '{}')::boolean
                               when value #>> '{}' in ('true', 'false') then (value #>> '{}')::boolean
                               else null end
                     from public.admin_settings where key = p_key), p_default)
$$;
revoke all on function public.email_studio_setting_bool(text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.email_studio_setting_bool(text, boolean) to service_role;

create or replace function public.email_studio_daily_cap()
returns integer language sql stable security definer set search_path = public as $$
  select greatest(0, coalesce((select case when value #>> '{}' ~ '^[0-9]+$' then (value #>> '{}')::integer end
                                 from public.admin_settings where key = 'email_studio_daily_recipient_cap'), 200))
$$;
revoke all on function public.email_studio_daily_cap() from public, anon, authenticated, service_role;
grant execute on function public.email_studio_daily_cap() to service_role;

/*
 * Why a member may not receive this seller's marketing email — null when they may.
 * The single eligibility rule; review, claim and the owner listing all call it.
 */
create or replace function public.email_studio_lead_eligibility(p_owner uuid, p_lead uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_user record;
  v_prefs record;
  v_owner_auth uuid;
begin
  if not exists (select 1 from public.internal_lead_unlocks u
                  where u.account_user_id = p_owner and u.lead_user_id = p_lead) then
    return 'NOT_UNLOCKED';
  end if;
  select id, email, suspended_at into v_user from public.users where id = p_lead;
  if not found or v_user.suspended_at is not null then return 'ACCOUNT_UNAVAILABLE'; end if;
  if exists (select 1 from public.conversation_blocks b
              where (b.blocker_id = p_lead and b.blocked_id = p_owner)
                 or (b.blocker_id = p_owner and b.blocked_id = p_lead)) then
    return 'BLOCKED';
  end if;
  select * into v_prefs from public.lead_contact_prefs_of(p_lead);
  if not v_prefs.accept_marketing_email then return 'NO_MARKETING_CONSENT'; end if;
  if not v_prefs.share_email_on_unlock then return 'EMAIL_NOT_SHARED'; end if;
  if not v_prefs.accept_property_offers then return 'NOT_ACCEPTING_OFFERS'; end if;
  if exists (select 1 from public.notification_preferences n
              where n.user_id = p_lead and n.marketing_opt_in = false) then
    return 'MARKETING_OPT_OUT';
  end if;
  if v_user.email is null or v_user.email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then return 'NO_EMAIL'; end if;
  if exists (select 1 from public.email_studio_suppressions s
              where s.user_id = p_lead or lower(s.email) = lower(v_user.email)) then
    return 'SUPPRESSED';
  end if;
  select auth_id into v_owner_auth from public.users where id = p_owner;
  if exists (select 1 from public.outreach_contacts c
              where c.owner_id in (p_owner, v_owner_auth)
                and lower(c.email) = lower(v_user.email)
                and (coalesce(c.unsubscribed, false) or coalesce(c.suppressed, false)
                     or coalesce(c.do_not_contact, false)
                     or coalesce(c.complaint_count, 0) >= 1 or coalesce(c.bounce_count, 0) >= 3)) then
    return 'SUPPRESSED';
  end if;
  return null;
end $$;
revoke all on function public.email_studio_lead_eligibility(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.email_studio_lead_eligibility(uuid, uuid) to service_role;

/* The version a review approves: content, template, property, language and audience. */
create or replace function public.email_studio_version_hash(p_campaign_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select md5(c.template_id || '|' || coalesce(c.property_id::text, '') || '|' || c.language || '|'
             || c.content::text || '|'
             || coalesce((select string_agg(r.lead_user_id::text, ',' order by r.lead_user_id)
                            from public.email_studio_recipients r where r.campaign_id = c.id), ''))
    from public.email_studio_campaigns c where c.id = p_campaign_id
$$;
revoke all on function public.email_studio_version_hash(uuid) from public, anon, authenticated, service_role;
grant execute on function public.email_studio_version_hash(uuid) to service_role;

create or replace function public.email_studio_stats_of(p_campaign_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'recipients',   count(*),
    'pending',      count(*) filter (where status = 'PENDING'),
    'sending',      count(*) filter (where status = 'SENDING'),
    'sent',         count(*) filter (where status in ('SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED')),
    'delivered',    count(*) filter (where status = 'DELIVERED' or (status = 'COMPLAINED' and delivered_at is not null)),
    'bounced',      count(*) filter (where status = 'BOUNCED'),
    'complaints',   count(*) filter (where status = 'COMPLAINED'),
    'failed',       count(*) filter (where status = 'FAILED'),
    'skipped',      count(*) filter (where status = 'SKIPPED'),
    'unsubscribed', count(*) filter (where unsubscribed_at is not null),
    'opened',       count(*) filter (where opened_at is not null),
    'clicked',      count(*) filter (where first_clicked_at is not null),
    -- Replies to a studio email reach the seller's inbox, not a campaign row:
    -- there is no reliable per-campaign reply attribution, so it is not counted.
    'repliedTracked', false,
    'opensApproximate', true)
    from public.email_studio_recipients where campaign_id = p_campaign_id
$$;
revoke all on function public.email_studio_stats_of(uuid) from public, anon, authenticated, service_role;
grant execute on function public.email_studio_stats_of(uuid) to service_role;

/* One CRM timeline event (and a forward-only status move) for the owner ↔ lead entry. */
create or replace function public.email_studio_crm_event(p_owner uuid, p_lead uuid, p_kind text, p_detail jsonb,
                                                         p_advance_to text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_e record;
  v_old integer;
  v_new integer;
begin
  select * into v_e from public.lead_crm_entries where owner_user_id = p_owner and lead_user_id = p_lead;
  if not found then return; end if;
  insert into public.lead_crm_events (entry_id, kind, detail) values (v_e.id, p_kind, coalesce(p_detail, '{}'::jsonb));
  v_old := array_position(array['UNLOCKED','CONTACTED','DELIVERED','REPLIED'], v_e.status);
  v_new := array_position(array['UNLOCKED','CONTACTED','DELIVERED','REPLIED'], p_advance_to);
  if p_advance_to is not null and v_old is not null and v_new > v_old then
    update public.lead_crm_entries set status = p_advance_to, status_set_by = 'SYSTEM',
           last_activity_at = now(), updated_at = now() where id = v_e.id;
    insert into public.lead_crm_events (entry_id, kind, detail)
    values (v_e.id, 'STATUS_CHANGED', jsonb_build_object('from', v_e.status, 'to', p_advance_to, 'by', 'SYSTEM',
                                                        'source', 'EMAIL_STUDIO'));
  else
    update public.lead_crm_entries set last_activity_at = now(), updated_at = now() where id = v_e.id;
  end if;
end $$;
revoke all on function public.email_studio_crm_event(uuid, uuid, text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.email_studio_crm_event(uuid, uuid, text, jsonb, text) to service_role;

/* ════════════════════════════════════════════════════════════════════════
 * 3 · owner RPCs (authenticated; each checks ownership itself)
 * ════════════════════════════════════════════════════════════════════════ */

/* The caller's own listings, with whether the Premium template fits them. */
create or replace function public.email_studio_my_properties()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public.current_homatch_user_id();
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'propertyId', p.id, 'homatchId', p.homatch_id, 'title', p.title,
             'transactionType', p.transaction_type::text, 'propertyType', p.property_type::text,
             'city', f.city, 'district', f.district, 'price', f.total_price, 'currency', f.currency,
             'segment', s.segment,
             'premiumEligible', coalesce(s.segment = 'PREMIUM', false))
           order by p.homatch_id desc nulls last)
      from public.properties p
      left join lateral (select * from public.property_facts pf where pf.property_id = p.id limit 1) f on true
      left join public.property_market_segments s on s.property_id = p.id
     where p.user_id = v_me and not coalesce(p.is_deleted, false) and p.archived_at is null), '[]'::jsonb);
end $$;
revoke all on function public.email_studio_my_properties() from public, anon, authenticated, service_role;
grant execute on function public.email_studio_my_properties() to authenticated;

/*
 * Eligibility for a selection of the caller's leads. p_match_ids are HOMATCH Leads
 * handles (supply_matches ids); null → every lead this account has unlocked.
 * displayName only — never an address, a phone or a member id.
 */
create or replace function public.email_studio_eligible_recipients(p_match_ids uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_out jsonb;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if exists (select 1 from public.users where id = v_me and suspended_at is not null) then
    raise exception 'account suspended' using errcode = '42501';
  end if;
  with picked as (
    select distinct on (coalesce(u.lead_user_id::text, h.mid::text))
           h.mid as match_id, u.id as unlock_id, u.lead_user_id, u.created_at
      from unnest(coalesce(p_match_ids, '{}'::uuid[])) as h(mid)
      left join public.supply_matches m on m.id = h.mid and m.supply_user_id = v_me
                                       and m.source_kind = 'INTERNAL_HOMATCH'
      left join public.internal_lead_unlocks u on u.account_user_id = v_me and u.lead_user_id = m.demand_user_id
     where p_match_ids is not null
    union all
    select null::uuid, u.id, u.lead_user_id, u.created_at
      from public.internal_lead_unlocks u
     where p_match_ids is null and u.account_user_id = v_me
  ), rows as (
    select p.match_id, p.unlock_id, p.created_at,
           case when p.unlock_id is null then null else public.email_studio_display_name(p.lead_user_id) end as display_name,
           case when p.unlock_id is null then null
                else (select preferred_language::text from public.users where id = p.lead_user_id) end as language,
           case when p.unlock_id is null then 'NOT_UNLOCKED'
                else public.email_studio_lead_eligibility(v_me, p.lead_user_id) end as reason
      from picked p
  )
  select jsonb_build_object(
    'total', (select count(*) from rows),
    'eligibleCount', (select count(*) from rows where reason is null),
    'reasons', coalesce((select jsonb_object_agg(reason, n) from
                           (select reason, count(*) n from rows where reason is not null group by reason) x), '{}'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                         'unlockId', r.unlock_id, 'matchId', r.match_id, 'displayName', r.display_name,
                         'language', r.language, 'eligible', r.reason is null, 'reason', r.reason)
                       order by (r.reason is null) desc, r.created_at desc nulls last) from rows r), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.email_studio_eligible_recipients(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.email_studio_eligible_recipients(uuid[]) to authenticated;

/* Create or update a draft. Any edit voids an earlier review. */
create or replace function public.email_studio_save_draft(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_id uuid := nullif(p->>'campaignId', '')::uuid;
  v_c record;
  v_property uuid := nullif(p->>'propertyId', '')::uuid;
  v_template text := coalesce(nullif(p->>'templateId', ''), 'PROPERTY_INTRODUCTION');
  v_lang text := coalesce(nullif(p->>'language', ''), 'en');
  v_content jsonb := coalesce(p->'content', '{}'::jsonb);
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if exists (select 1 from public.users where id = v_me and suspended_at is not null) then
    raise exception 'account suspended' using errcode = '42501';
  end if;
  if v_property is not null and not exists (select 1 from public.properties where id = v_property and user_id = v_me) then
    raise exception 'not your property' using errcode = '42501';
  end if;
  if jsonb_typeof(v_content) <> 'object' then raise exception 'invalid content' using errcode = '22023'; end if;
  if v_template = 'PREMIUM_PROPERTY' and (v_property is null or not exists (
       select 1 from public.property_market_segments s where s.property_id = v_property and s.segment = 'PREMIUM')) then
    raise exception 'premium template not available for this listing' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.email_studio_campaigns (owner_user_id, property_id, template_id, name, language, content)
    values (v_me, v_property, v_template, left(coalesce(p->>'name', ''), 160), v_lang, v_content)
    returning id into v_id;
  else
    select * into v_c from public.email_studio_campaigns where id = v_id and owner_user_id = v_me for update;
    if not found then raise exception 'not found' using errcode = '42501'; end if;
    if v_c.status not in ('DRAFT', 'REVIEWED') then
      raise exception 'campaign already sent' using errcode = '22023';
    end if;
    update public.email_studio_campaigns
       set property_id = v_property, template_id = v_template,
           name = left(coalesce(p->>'name', name), 160), language = v_lang, content = v_content,
           status = 'DRAFT', reviewed_hash = null, reviewed_at = null, updated_at = now()
     where id = v_id;
  end if;
  return public.email_studio_get_campaign(v_id);
end $$;

/* Replace the audience of a draft with these unlocked leads (unlock ids). */
create or replace function public.email_studio_set_recipients(p_campaign_id uuid, p_unlock_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_c record;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_c from public.email_studio_campaigns where id = p_campaign_id and owner_user_id = v_me for update;
  if not found then raise exception 'not found' using errcode = '42501'; end if;
  if v_c.status not in ('DRAFT', 'REVIEWED') then raise exception 'campaign already sent' using errcode = '22023'; end if;
  if coalesce(array_length(p_unlock_ids, 1), 0) > 500 then
    raise exception 'too many recipients' using errcode = '22023';
  end if;

  delete from public.email_studio_recipients r
   where r.campaign_id = p_campaign_id
     and not exists (select 1 from public.internal_lead_unlocks u
                      where u.id = any(coalesce(p_unlock_ids, '{}'::uuid[]))
                        and u.account_user_id = v_me and u.lead_user_id = r.lead_user_id);
  insert into public.email_studio_recipients (campaign_id, owner_user_id, lead_user_id, unlock_id, idempotency_key)
  select p_campaign_id, v_me, u.lead_user_id, u.id, 'es:' || p_campaign_id || ':' || u.lead_user_id
    from public.internal_lead_unlocks u
   where u.id = any(coalesce(p_unlock_ids, '{}'::uuid[])) and u.account_user_id = v_me
  on conflict (campaign_id, lead_user_id) do nothing;

  update public.email_studio_campaigns
     set status = 'DRAFT', reviewed_hash = null, reviewed_at = null, updated_at = now()
   where id = p_campaign_id;
  return public.email_studio_get_campaign(p_campaign_id);
end $$;

create or replace function public.email_studio_get_campaign(p_campaign_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_c record;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_c from public.email_studio_campaigns where id = p_campaign_id and owner_user_id = v_me;
  if not found then raise exception 'not found' using errcode = '42501'; end if;
  return jsonb_build_object(
    'campaignId', v_c.id, 'propertyId', v_c.property_id, 'templateId', v_c.template_id, 'name', v_c.name,
    'language', v_c.language, 'content', v_c.content, 'status', v_c.status,
    'reviewedHash', v_c.reviewed_hash, 'reviewedAt', v_c.reviewed_at, 'approvedAt', v_c.approved_at,
    'sentAt', v_c.sent_at, 'createdAt', v_c.created_at, 'updatedAt', v_c.updated_at,
    'stats', public.email_studio_stats_of(v_c.id),
    'recipients', coalesce((select jsonb_agg(jsonb_build_object(
        'recipientId', r.id, 'unlockId', r.unlock_id,
        'displayName', public.email_studio_display_name(r.lead_user_id),
        'status', r.status, 'skipReason', r.skip_reason,
        'reason', case when r.status = 'PENDING' then public.email_studio_lead_eligibility(v_me, r.lead_user_id) end,
        'sentAt', r.sent_at, 'deliveredAt', r.delivered_at, 'openedAt', r.opened_at,
        'clickedAt', r.first_clicked_at, 'unsubscribedAt', r.unsubscribed_at)
      order by r.created_at) from public.email_studio_recipients r where r.campaign_id = v_c.id), '[]'::jsonb));
end $$;

create or replace function public.email_studio_list_campaigns()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public.current_homatch_user_id();
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'campaignId', c.id, 'name', c.name, 'templateId', c.template_id, 'status', c.status,
             'propertyId', c.property_id, 'propertyTitle', p.title, 'homatchId', p.homatch_id,
             'subject', c.content->>'subject', 'language', c.language,
             'sentAt', c.sent_at, 'updatedAt', c.updated_at,
             'stats', public.email_studio_stats_of(c.id))
           order by c.updated_at desc)
      from (select * from public.email_studio_campaigns where owner_user_id = v_me
             order by updated_at desc limit 100) c
      left join public.properties p on p.id = c.property_id), '[]'::jsonb);
end $$;

create or replace function public.email_studio_campaign_stats(p_campaign_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public.current_homatch_user_id();
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from public.email_studio_campaigns where id = p_campaign_id and owner_user_id = v_me) then
    raise exception 'not found' using errcode = '42501';
  end if;
  return public.email_studio_stats_of(p_campaign_id);
end $$;

create or replace function public.email_studio_delete_draft(p_campaign_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_homatch_user_id();
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  delete from public.email_studio_campaigns
   where id = p_campaign_id and owner_user_id = v_me and status in ('DRAFT', 'REVIEWED');
  return found;
end $$;

/*
 * Review: re-check every recipient, fix the approved version. Returns the hash the
 * send must present, the eligible/skipped split and the price (0 credits — campaigns
 * are free; provider cost is HOMATCH's).
 */
create or replace function public.email_studio_review(p_campaign_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_c record;
  v_hash text;
  v_out jsonb;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if exists (select 1 from public.users where id = v_me and suspended_at is not null) then
    raise exception 'account suspended' using errcode = '42501';
  end if;
  select * into v_c from public.email_studio_campaigns where id = p_campaign_id and owner_user_id = v_me for update;
  if not found then raise exception 'not found' using errcode = '42501'; end if;
  if v_c.status not in ('DRAFT', 'REVIEWED') then raise exception 'campaign already sent' using errcode = '22023'; end if;
  if v_c.property_id is null then raise exception 'choose a property' using errcode = '22023'; end if;

  v_hash := public.email_studio_version_hash(p_campaign_id);
  update public.email_studio_campaigns
     set status = 'REVIEWED', reviewed_hash = v_hash, reviewed_at = now(), updated_at = now()
   where id = p_campaign_id;

  with r as (
    select public.email_studio_lead_eligibility(v_me, x.lead_user_id) as reason
      from public.email_studio_recipients x where x.campaign_id = p_campaign_id and x.status = 'PENDING'
  )
  select jsonb_build_object(
    'versionHash', v_hash,
    'recipients', (select count(*) from r),
    'eligible', (select count(*) from r where reason is null),
    'reasons', coalesce((select jsonb_object_agg(reason, n) from
                          (select reason, count(*) n from r where reason is not null group by reason) y), '{}'::jsonb),
    'costCredits', 0,
    'dailyCap', public.email_studio_daily_cap(),
    'dailyUsed', (select count(*) from public.email_studio_recipients q
                   where q.owner_user_id = v_me and q.claimed_at > now() - interval '24 hours'),
    'sendingEnabled', public.email_studio_setting_bool('email_studio_sending_enabled', false)
  ) into v_out;
  return v_out;
end $$;

/* ════════════════════════════════════════════════════════════════════════
 * 4 · the send path (service_role only — the edge handler)
 * ════════════════════════════════════════════════════════════════════════ */

/* Start (or continue) a send: approval of exactly the reviewed version. */
create or replace function public.email_studio_begin_send(p_owner uuid, p_campaign_id uuid, p_version_hash text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_c record;
begin
  select * into v_c from public.email_studio_campaigns where id = p_campaign_id and owner_user_id = p_owner for update;
  if not found then return 'NOT_FOUND'; end if;
  if exists (select 1 from public.users where id = p_owner and suspended_at is not null) then return 'ACCOUNT_SUSPENDED'; end if;
  if v_c.status in ('SENT', 'FAILED', 'CANCELLED') then return 'ALREADY_SENT'; end if;
  if v_c.status = 'DRAFT' or v_c.reviewed_hash is null then return 'NOT_REVIEWED'; end if;
  if p_version_hash is null or p_version_hash <> v_c.reviewed_hash
     or public.email_studio_version_hash(p_campaign_id) <> v_c.reviewed_hash then
    return 'VERSION_MISMATCH';
  end if;
  if not public.email_studio_setting_bool('email_studio_sending_enabled', false) then return 'SENDING_DISABLED'; end if;
  update public.email_studio_campaigns
     set status = 'SENDING', approved_at = coalesce(approved_at, now()), updated_at = now()
   where id = p_campaign_id;
  return 'OK';
end $$;
revoke all on function public.email_studio_begin_send(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.email_studio_begin_send(uuid, uuid, text) to service_role;

/*
 * Claim up to p_limit (≤ 50) PENDING recipients of a SENDING campaign, within the
 * account's rolling daily cap. Eligibility is re-checked here, at the last moment:
 * a member who withdrew consent since the review is SKIPPED, never emailed.
 * Only PENDING rows are claimable, so a retried call can never email anyone twice.
 * Returns the addresses — to the service role only.
 */
create or replace function public.email_studio_claim_recipients(p_owner uuid, p_campaign_id uuid, p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cap integer := public.email_studio_daily_cap();
  v_used integer;
  v_room integer;
  v_r record;
  v_reason text;
  v_claimed jsonb := '[]'::jsonb;
  v_skipped integer := 0;
  v_n integer := 0;
begin
  if not exists (select 1 from public.email_studio_campaigns
                  where id = p_campaign_id and owner_user_id = p_owner and status = 'SENDING') then
    return jsonb_build_object('error', 'NOT_SENDING');
  end if;
  -- Serialise claims per account so two concurrent calls cannot both spend the cap.
  perform pg_advisory_xact_lock(hashtextextended('email_studio_cap:' || p_owner::text, 0));
  -- A claim whose outcome never came back (the edge died mid-call) may or may not
  -- have been emailed. It is closed as FAILED/UNCONFIRMED and never retried: a
  -- possible duplicate is worse than a possible miss.
  update public.email_studio_recipients
     set status = 'FAILED', error_message = 'UNCONFIRMED', updated_at = now()
   where campaign_id = p_campaign_id and status = 'SENDING' and claimed_at < now() - interval '15 minutes';
  select count(*) into v_used from public.email_studio_recipients
   where owner_user_id = p_owner and claimed_at > now() - interval '24 hours';
  v_room := greatest(0, v_cap - v_used);

  for v_r in
    select r.* from public.email_studio_recipients r
     where r.campaign_id = p_campaign_id and r.status = 'PENDING'
     order by r.created_at
     for update skip locked
  loop
    v_reason := public.email_studio_lead_eligibility(p_owner, v_r.lead_user_id);
    if v_reason is not null then
      update public.email_studio_recipients set status = 'SKIPPED', skip_reason = v_reason, updated_at = now()
       where id = v_r.id;
      insert into public.email_studio_events (campaign_id, recipient_id, owner_user_id, kind, detail)
      values (p_campaign_id, v_r.id, p_owner, 'SKIPPED', jsonb_build_object('reason', v_reason));
      v_skipped := v_skipped + 1;
      continue;
    end if;
    exit when v_n >= least(greatest(coalesce(p_limit, 50), 1), 50) or v_n >= v_room;
    update public.email_studio_recipients
       set status = 'SENDING', claimed_at = now(), attempt_count = attempt_count + 1, updated_at = now()
     where id = v_r.id;
    v_claimed := v_claimed || jsonb_build_object(
      'recipientId', v_r.id, 'leadUserId', v_r.lead_user_id, 'idempotencyKey', v_r.idempotency_key,
      'email', (select email from public.users where id = v_r.lead_user_id),
      'displayName', public.email_studio_display_name(v_r.lead_user_id),
      'language', (select preferred_language::text from public.users where id = v_r.lead_user_id));
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object(
    'claimed', v_claimed, 'skipped', v_skipped,
    'capRemaining', greatest(0, v_room - v_n), 'dailyCap', v_cap,
    'remaining', (select count(*) from public.email_studio_recipients
                   where campaign_id = p_campaign_id and status = 'PENDING'));
end $$;
revoke all on function public.email_studio_claim_recipients(uuid, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.email_studio_claim_recipients(uuid, uuid, integer) to service_role;

/* The provider's answer for one claimed recipient. Only a SENDING row moves. */
create or replace function public.email_studio_mark_sent(p_recipient_id uuid, p_success boolean, p_provider text,
                                                         p_provider_message_id text, p_error text, p_cost_usd numeric)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_r record;
begin
  select * into v_r from public.email_studio_recipients where id = p_recipient_id for update;
  if not found or v_r.status <> 'SENDING' then return false; end if;
  update public.email_studio_recipients
     set status = case when p_success then 'SENT' else 'FAILED' end,
         provider = p_provider, provider_message_id = p_provider_message_id,
         error_message = left(p_error, 500), cost_usd = coalesce(p_cost_usd, 0),
         sent_at = case when p_success then now() end, updated_at = now()
   where id = p_recipient_id;
  insert into public.email_studio_events (campaign_id, recipient_id, owner_user_id, kind, detail)
  values (v_r.campaign_id, v_r.id, v_r.owner_user_id, case when p_success then 'SENT' else 'FAILED' end,
          case when p_success then '{}'::jsonb else jsonb_build_object('error', left(p_error, 200)) end);
  if p_success then
    perform public.email_studio_crm_event(v_r.owner_user_id, v_r.lead_user_id, 'EMAIL_SENT',
              jsonb_build_object('campaign_id', v_r.campaign_id), 'CONTACTED');
  end if;
  return true;
end $$;
revoke all on function public.email_studio_mark_sent(uuid, boolean, text, text, text, numeric) from public, anon, authenticated, service_role;
grant execute on function public.email_studio_mark_sent(uuid, boolean, text, text, text, numeric) to service_role;

/* Close the campaign once nothing is left to claim or confirm. */
create or replace function public.email_studio_finish_send(p_campaign_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if exists (select 1 from public.email_studio_recipients
              where campaign_id = p_campaign_id and status in ('PENDING', 'SENDING')) then
    return 'SENDING';
  end if;
  v_status := case when exists (select 1 from public.email_studio_recipients
                                 where campaign_id = p_campaign_id and status in ('SENT','DELIVERED','BOUNCED','COMPLAINED'))
                   then 'SENT' else 'FAILED' end;
  update public.email_studio_campaigns set status = v_status, sent_at = coalesce(sent_at, now()), updated_at = now()
   where id = p_campaign_id and status = 'SENDING';
  return v_status;
end $$;
revoke all on function public.email_studio_finish_send(uuid) from public, anon, authenticated, service_role;
grant execute on function public.email_studio_finish_send(uuid) to service_role;

/* Test sends: at most 5 per account per 24 hours, to the account's own address. */
create or replace function public.email_studio_record_test(p_owner uuid, p_campaign_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.email_studio_campaigns where id = p_campaign_id and owner_user_id = p_owner) then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('email_studio_test:' || p_owner::text, 0));
  if (select count(*) from public.email_studio_events
       where owner_user_id = p_owner and kind = 'TEST_SENT' and created_at > now() - interval '24 hours') >= 5 then
    return false;
  end if;
  insert into public.email_studio_events (campaign_id, owner_user_id, kind) values (p_campaign_id, p_owner, 'TEST_SENT');
  return true;
end $$;
revoke all on function public.email_studio_record_test(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.email_studio_record_test(uuid, uuid) to service_role;

/*
 * A provider event for a studio email, keyed on the provider's message id.
 * Returns the campaign id when the message is a studio send, null otherwise (the
 * webhook then falls through to the outreach path). Deduplicated on the provider's
 * event id. Monotonic: BOUNCED / COMPLAINED are terminal; a late DELIVERED does not
 * overwrite them. Opens and clicks never change the status (opens are approximate:
 * image blocking hides some, privacy proxies invent others).
 */
create or replace function public.email_studio_apply_event(p_provider_message_id text, p_kind text,
                                                           p_event_key text, p_detail jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_r record;
  v_kind text := upper(coalesce(p_kind, ''));
  v_email text;
  v_inserted uuid;
  v_permanent boolean;
begin
  if p_provider_message_id is null or p_provider_message_id = '' then return null; end if;
  select * into v_r from public.email_studio_recipients where provider_message_id = p_provider_message_id
   order by created_at desc limit 1 for update;
  if not found then return null; end if;
  if v_kind not in ('DELIVERED', 'BOUNCED', 'COMPLAINED', 'OPENED', 'CLICKED') then return v_r.campaign_id; end if;

  insert into public.email_studio_events (campaign_id, recipient_id, owner_user_id, kind, provider_event_id, detail)
  values (v_r.campaign_id, v_r.id, v_r.owner_user_id, v_kind, nullif(p_event_key, ''), coalesce(p_detail, '{}'::jsonb))
  on conflict (provider_event_id) where provider_event_id is not null do nothing
  returning id into v_inserted;
  if v_inserted is null then return v_r.campaign_id; end if;  -- a duplicate delivery

  select email into v_email from public.users where id = v_r.lead_user_id;

  if v_kind = 'DELIVERED' then
    if v_r.status = 'SENT' then
      update public.email_studio_recipients set status = 'DELIVERED', delivered_at = now(), updated_at = now() where id = v_r.id;
      perform public.email_studio_crm_event(v_r.owner_user_id, v_r.lead_user_id, 'EMAIL_DELIVERED',
                jsonb_build_object('campaign_id', v_r.campaign_id), 'DELIVERED');
    elsif v_r.delivered_at is null then
      update public.email_studio_recipients set delivered_at = now(), updated_at = now() where id = v_r.id;
    end if;
  elsif v_kind = 'BOUNCED' then
    v_permanent := coalesce(p_detail->>'bounceType', '') !~* 'transient|temporary|soft';
    if v_r.status not in ('BOUNCED', 'COMPLAINED') then
      update public.email_studio_recipients set status = 'BOUNCED', bounced_at = now(), updated_at = now() where id = v_r.id;
      perform public.email_studio_crm_event(v_r.owner_user_id, v_r.lead_user_id, 'EMAIL_BOUNCED',
                jsonb_build_object('campaign_id', v_r.campaign_id, 'permanent', v_permanent));
    end if;
    if v_permanent then
      insert into public.email_studio_suppressions (user_id, email, reason, recipient_id)
      values (v_r.lead_user_id, v_email, 'BOUNCED', v_r.id)
      on conflict (user_id, reason) where user_id is not null do nothing;
    end if;
  elsif v_kind = 'COMPLAINED' then
    if v_r.status <> 'COMPLAINED' then
      update public.email_studio_recipients set status = 'COMPLAINED', complained_at = now(), updated_at = now() where id = v_r.id;
    end if;
    insert into public.email_studio_suppressions (user_id, email, reason, recipient_id)
    values (v_r.lead_user_id, v_email, 'COMPLAINED', v_r.id)
    on conflict (user_id, reason) where user_id is not null do nothing;
    -- A spam report withdraws marketing consent outright.
    insert into public.lead_contact_preferences as l (user_id, accept_marketing_email, updated_at)
    values (v_r.lead_user_id, false, now())
    on conflict (user_id) do update set accept_marketing_email = false, updated_at = now();
    perform public.email_studio_crm_event(v_r.owner_user_id, v_r.lead_user_id, 'EMAIL_COMPLAINED',
              jsonb_build_object('campaign_id', v_r.campaign_id));
  elsif v_kind = 'OPENED' then
    update public.email_studio_recipients
       set open_count = open_count + 1, opened_at = coalesce(opened_at, now()), updated_at = now() where id = v_r.id;
    if v_r.opened_at is null then
      perform public.email_studio_crm_event(v_r.owner_user_id, v_r.lead_user_id, 'EMAIL_OPENED',
                jsonb_build_object('campaign_id', v_r.campaign_id, 'approximate', true));
    end if;
  elsif v_kind = 'CLICKED' then
    update public.email_studio_recipients
       set click_count = click_count + 1, first_clicked_at = coalesce(first_clicked_at, now()), updated_at = now()
     where id = v_r.id;
    if v_r.first_clicked_at is null then
      perform public.email_studio_crm_event(v_r.owner_user_id, v_r.lead_user_id, 'EMAIL_CLICKED',
                jsonb_build_object('campaign_id', v_r.campaign_id));
    end if;
  end if;
  return v_r.campaign_id;
end $$;
revoke all on function public.email_studio_apply_event(text, text, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.email_studio_apply_event(text, text, text, jsonb) to service_role;

/*
 * One-click unsubscribe from a studio email (the signed link the webhook endpoint
 * verifies). Withdraws marketing consent for every seller — the member's own
 * accept_marketing_email — and suppresses the address. Idempotent.
 * Returns { ok, already, language }.
 */
create or replace function public.email_studio_unsubscribe(p_recipient_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_r record;
  v_lang text;
  v_email text;
  v_already boolean;
begin
  select * into v_r from public.email_studio_recipients where id = p_recipient_id for update;
  if not found then return jsonb_build_object('ok', false); end if;
  select preferred_language::text, email into v_lang, v_email from public.users where id = v_r.lead_user_id;
  v_already := v_r.unsubscribed_at is not null
               or exists (select 1 from public.email_studio_suppressions
                           where user_id = v_r.lead_user_id and reason = 'UNSUBSCRIBED');

  insert into public.lead_contact_preferences as l (user_id, accept_marketing_email, updated_at)
  values (v_r.lead_user_id, false, now())
  on conflict (user_id) do update set accept_marketing_email = false, updated_at = now();
  insert into public.email_studio_suppressions (user_id, email, reason, recipient_id)
  values (v_r.lead_user_id, v_email, 'UNSUBSCRIBED', v_r.id)
  on conflict (user_id, reason) where user_id is not null do nothing;

  if v_r.unsubscribed_at is null then
    update public.email_studio_recipients set unsubscribed_at = now(), updated_at = now() where id = v_r.id;
    insert into public.email_studio_events (campaign_id, recipient_id, owner_user_id, kind)
    values (v_r.campaign_id, v_r.id, v_r.owner_user_id, 'UNSUBSCRIBED');
    perform public.email_studio_crm_event(v_r.owner_user_id, v_r.lead_user_id, 'EMAIL_UNSUBSCRIBED',
              jsonb_build_object('campaign_id', v_r.campaign_id));
  end if;
  return jsonb_build_object('ok', true, 'already', v_already, 'language', coalesce(v_lang, 'en'));
end $$;
revoke all on function public.email_studio_unsubscribe(uuid) from public, anon, authenticated, service_role;
grant execute on function public.email_studio_unsubscribe(uuid) to service_role;

/* ════════════════════════════════════════════════════════════════════════
 * 5 · grants for the owner RPCs (after every function exists)
 * ════════════════════════════════════════════════════════════════════════ */

revoke all on function public.email_studio_save_draft(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.email_studio_save_draft(jsonb) to authenticated;
revoke all on function public.email_studio_set_recipients(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.email_studio_set_recipients(uuid, uuid[]) to authenticated;
revoke all on function public.email_studio_get_campaign(uuid) from public, anon, authenticated, service_role;
grant execute on function public.email_studio_get_campaign(uuid) to authenticated;
revoke all on function public.email_studio_list_campaigns() from public, anon, authenticated, service_role;
grant execute on function public.email_studio_list_campaigns() to authenticated;
revoke all on function public.email_studio_campaign_stats(uuid) from public, anon, authenticated, service_role;
grant execute on function public.email_studio_campaign_stats(uuid) to authenticated;
revoke all on function public.email_studio_delete_draft(uuid) from public, anon, authenticated, service_role;
grant execute on function public.email_studio_delete_draft(uuid) to authenticated;
revoke all on function public.email_studio_review(uuid) from public, anon, authenticated, service_role;
grant execute on function public.email_studio_review(uuid) to authenticated;
