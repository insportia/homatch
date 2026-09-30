-- META ADS MASTER: targeting, managed-campaign mapping, write-through
-- operations, insights history, recommendations, summaries, timeline, Guard,
-- lead forms, lead attribution, fee policies, and the service balance.
--
-- Additive except three constraints widened (ledger entry types, lead
-- statuses, funnel events) and two guard triggers tightened (campaign status
-- and launched-campaign fields; lead attribution is server-owned).

-- ── 1. CAMPAIGNS: targeting + the managed mapping + cached analysis ──────
alter table public.meta_campaigns
  add column if not exists targeting jsonb,
  add column if not exists fee_percent numeric,
  add column if not exists ad_account_external_id text,
  add column if not exists page_external_id text,
  add column if not exists instagram_external_id text,
  add column if not exists lead_form_external_id text,
  add column if not exists approved_state jsonb,
  add column if not exists approved_version integer not null default 0,
  add column if not exists guard_state text not null default 'OK',
  add column if not exists ended_at timestamptz,
  add column if not exists insights_synced_at timestamptz,
  add column if not exists health jsonb,
  add column if not exists summary jsonb,
  add column if not exists summary_facts_key text,
  add column if not exists summary_at timestamptz;

alter table public.meta_campaigns drop constraint if exists meta_campaigns_guard_state_check;
alter table public.meta_campaigns add constraint meta_campaigns_guard_state_check
  check (guard_state in ('OK', 'NEEDS_REVIEW', 'LOCKED_FOR_REVIEW'));

comment on column public.meta_campaigns.targeting is
  'Customer intent: {locations:[{type,key,name,countryCode,radiusKm}], ageMin, ageMax, gender}. Server applies Meta rules (targeting.ts).';
comment on column public.meta_campaigns.approved_state is
  'The HOMATCH-approved Meta configuration (guard.ts ManagedState), updated only when Meta confirms a HOMATCH write. Drift is measured against it.';

/* The browser may edit a draft's targeting, never a launched campaign's, and
   never the server-owned mapping, Guard or analysis columns. */
create or replace function public.meta_campaigns_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.role() = 'service_role' then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'DRAFT' then raise exception 'META_ADS_CLIENT_STATUS'; end if;
    new.external_campaign_id := null; new.external_status := null;
    new.launch_idempotency_key := null; new.spend_cents := 0;
    new.preflight := null; new.results := null; new.plan := null; new.plan_version := null;
    new.launched_at := null; new.settled_at := null;
    new.fee_percent := null; new.ad_account_external_id := null; new.page_external_id := null;
    new.instagram_external_id := null; new.lead_form_external_id := null;
    new.approved_state := null; new.approved_version := 0; new.guard_state := 'OK';
    new.ended_at := null; new.insights_synced_at := null; new.health := null;
    new.summary := null; new.summary_facts_key := null; new.summary_at := null;
    new.objective := null; new.special_ad_categories := '{}'; new.last_error := null; new.last_synced_at := null;
    return new;
  end if;
  if new.external_campaign_id is distinct from old.external_campaign_id
     or new.external_status is distinct from old.external_status
     or new.launch_idempotency_key is distinct from old.launch_idempotency_key
     or new.spend_cents is distinct from old.spend_cents
     or new.preflight is distinct from old.preflight
     or new.plan is distinct from old.plan
     or new.plan_version is distinct from old.plan_version
     or new.results is distinct from old.results
     or new.launched_at is distinct from old.launched_at
     or new.settled_at is distinct from old.settled_at
     or new.fee_percent is distinct from old.fee_percent
     or new.ad_account_external_id is distinct from old.ad_account_external_id
     or new.page_external_id is distinct from old.page_external_id
     or new.instagram_external_id is distinct from old.instagram_external_id
     or new.lead_form_external_id is distinct from old.lead_form_external_id
     or new.approved_state is distinct from old.approved_state
     or new.approved_version is distinct from old.approved_version
     or new.guard_state is distinct from old.guard_state
     or new.ended_at is distinct from old.ended_at
     or new.insights_synced_at is distinct from old.insights_synced_at
     or new.health is distinct from old.health
     or new.summary is distinct from old.summary
     or new.summary_facts_key is distinct from old.summary_facts_key
     or new.summary_at is distinct from old.summary_at
     or new.objective is distinct from old.objective
     or new.special_ad_categories is distinct from old.special_ad_categories
     or new.last_error is distinct from old.last_error
     or new.last_synced_at is distinct from old.last_synced_at then
    raise exception 'META_ADS_SERVER_FIELD';
  end if;
  -- Once submitted to Meta, money, goal, destination and audience change only
  -- through the server's write-through (edit budget / edit duration).
  -- (Currency too: every ledger row of the campaign is in its currency.)
  if (old.launched_at is not null or old.external_campaign_id is not null
      or old.status in ('LAUNCHING','SUBMITTED','META_REVIEW','ACTIVE','PAUSED','COMPLETED'))
     and (new.daily_budget_cents is distinct from old.daily_budget_cents
          or new.duration_days is distinct from old.duration_days
          or new.goal is distinct from old.goal
          or new.destination is distinct from old.destination
          or new.targeting is distinct from old.targeting
          or new.currency is distinct from old.currency
          or new.audience_id is distinct from old.audience_id
          or new.placements is distinct from old.placements
          or new.property_id is distinct from old.property_id
          or new.offer is distinct from old.offer
          or new.start_at is distinct from old.start_at) then
    raise exception 'META_ADS_LAUNCHED_LOCKED';
  end if;
  -- The browser moves only a campaign that never reached Meta, and only
  -- between draft states. A launched campaign leaves its live state through
  -- the server (pause / end / archive), which acts at Meta first.
  if new.status is distinct from old.status and (
       old.launched_at is not null or old.external_campaign_id is not null
       or old.status in ('LAUNCHING','SUBMITTED','META_REVIEW','ACTIVE','PAUSED','COMPLETED','ARCHIVED')
       or new.status not in ('DRAFT','CONNECTION_REQUIRED','CREATIVE_REQUIRED','AUDIENCE_REQUIRED','PREFLIGHT_REQUIRED','ARCHIVED')) then
    raise exception 'META_ADS_CLIENT_STATUS';
  end if;
  new.updated_at := now();
  return new;
end $function$;

-- ── 2. ENTITY MAP: parents, so every ad resolves to its ad set and creative ──
alter table public.meta_ad_entities
  add column if not exists parent_external_id text,
  add column if not exists creative_external_id text,
  add column if not exists local_creative_id uuid;
create index if not exists meta_ad_entities_external_idx on public.meta_ad_entities (external_id);

-- ── 3. OPERATIONS: every HOMATCH write to Meta, for write-through + origin ──
create table if not exists public.meta_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  campaign_id uuid references public.meta_campaigns(id) on delete cascade,
  op text not null check (op in ('LAUNCH','PAUSE','RESUME','END','EDIT_BUDGET','EDIT_DURATION','PAUSE_AD','RESUME_AD',
                                 'GUARD_PAUSE_DUPLICATE','GUARD_PAUSE_CAMPAIGN','ACCEPT_EXTERNAL','RESTORE_CONFIG','APPLY_RECOMMENDATION')),
  actor text not null default 'CUSTOMER' check (actor in ('CUSTOMER','ADMIN','SYSTEM')),
  actor_user_id uuid,
  object_external_id text,
  changes jsonb not null default '[]'::jsonb,
  status text not null default 'REQUESTED' check (status in ('REQUESTED','CONFIRMED','FAILED','NOT_PERMITTED')),
  idempotency_key text unique,
  error jsonb,
  requested_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create index if not exists meta_operations_campaign_idx on public.meta_operations (campaign_id, requested_at desc);
alter table public.meta_operations enable row level security;
drop policy if exists meta_operations_admin on public.meta_operations;
create policy meta_operations_admin on public.meta_operations for select to authenticated using (public.is_admin());
revoke all on public.meta_operations from anon;
comment on table public.meta_operations is
  'Every change HOMATCH asked Meta to make: written REQUESTED before the Graph call, CONFIRMED only after Meta confirmed it. Guard uses it to tell HOMATCH-originated changes from external ones. Admin-readable; customers see the timeline instead.';

-- ── 4. INSIGHTS HISTORY ──────────────────────────────────────────────────
create table if not exists public.meta_insights (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references public.meta_campaigns(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  level text not null check (level in ('campaign','adset','ad')),
  object_external_id text not null default '',
  day date,
  breakdown text not null default 'none',
  breakdown_key text not null default '',
  row_key text generated always as (
    level || ':' || object_external_id || ':' || coalesce((day - date '1970-01-01')::text, 'window') || ':' || breakdown || ':' || breakdown_key) stored,
  window_since date,
  window_until date,
  currency text not null,
  spend_minor bigint not null default 0,
  impressions bigint not null default 0,
  reach bigint,
  clicks bigint not null default 0,
  link_clicks bigint not null default 0,
  landing_page_views bigint not null default 0,
  leads bigint not null default 0,
  messages bigint not null default 0,
  registrations bigint not null default 0,
  post_engagements bigint not null default 0,
  fetched_at timestamptz not null default now(),
  unique (campaign_id, row_key)
);
create index if not exists meta_insights_campaign_day_idx on public.meta_insights (campaign_id, level, day);
alter table public.meta_insights enable row level security;
drop policy if exists meta_insights_own on public.meta_insights;
create policy meta_insights_own on public.meta_insights for select to authenticated
  using (user_id = public.auth_user_id() or public.is_admin());
revoke all on public.meta_insights from anon;

-- ── 5. RECOMMENDATIONS (structured evidence first; AI only narrates) ─────
create table if not exists public.meta_recommendations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.meta_campaigns(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null,
  affected text not null,
  window_current text not null,
  window_previous text,
  metric text not null,
  baseline numeric,
  candidate numeric,
  confidence text not null check (confidence in ('INSUFFICIENT_DATA','EARLY_SIGNAL','MEANINGFUL_SIGNAL','HIGH_CONFIDENCE')),
  reason_codes text[] not null default '{}',
  actionable boolean not null default false,
  proposed jsonb,
  status text not null default 'OPEN' check (status in ('OPEN','APPLIED','DISMISSED','SNOOZED','EXPIRED')),
  snooze_until timestamptz,
  dedupe_key text not null unique,
  before_metrics jsonb,
  after_metrics jsonb,
  outcome text check (outcome in ('HELPED','NEUTRAL','HURT','INSUFFICIENT_DATA')),
  outcome_at timestamptz,
  created_at timestamptz not null default now(),
  acted_at timestamptz
);
create index if not exists meta_recommendations_campaign_idx on public.meta_recommendations (campaign_id, status, created_at desc);
alter table public.meta_recommendations enable row level security;
drop policy if exists meta_recommendations_own on public.meta_recommendations;
create policy meta_recommendations_own on public.meta_recommendations for select to authenticated
  using (user_id = public.auth_user_id() or public.is_admin());
revoke all on public.meta_recommendations from anon;

-- ── 6. CAMPAIGN TIMELINE (customer words) + admin-only detail ────────────
create table if not exists public.meta_campaign_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.meta_campaigns(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null,
  customer_key text not null,
  params jsonb not null default '{}'::jsonb,
  dedupe_key text unique,
  at timestamptz not null default now()
);
create index if not exists meta_campaign_events_campaign_idx on public.meta_campaign_events (campaign_id, at desc);
alter table public.meta_campaign_events enable row level security;
drop policy if exists meta_campaign_events_own on public.meta_campaign_events;
create policy meta_campaign_events_own on public.meta_campaign_events for select to authenticated
  using (user_id = public.auth_user_id() or public.is_admin());
revoke all on public.meta_campaign_events from anon;

-- ── 7. GUARD ─────────────────────────────────────────────────────────────
create table if not exists public.meta_guard_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  ad_account_external_id text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','WATCH','SUSPENDED')),
  active_strikes integer not null default 0,
  active_warnings integer not null default 0,
  suspended_at timestamptz,
  reinstated_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, ad_account_external_id)
);
alter table public.meta_guard_accounts add column if not exists last_duplicate_scan_at timestamptz;
alter table public.meta_guard_accounts enable row level security;
drop policy if exists meta_guard_accounts_own on public.meta_guard_accounts;
create policy meta_guard_accounts_own on public.meta_guard_accounts for select to authenticated
  using (user_id = public.auth_user_id() or public.is_admin());
revoke all on public.meta_guard_accounts from anon;

create table if not exists public.meta_guard_incidents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  ad_account_external_id text not null,
  campaign_id uuid references public.meta_campaigns(id) on delete set null,
  action text not null check (action in ('MANUAL_PAUSE','MANUAL_RESUME','MATERIAL_EDIT','STRUCTURAL_EDIT','POSSIBLE_DUPLICATE','CONFIRMED_DUPLICATE','CONTROL_ACCESS_CHANGE')),
  level text not null check (level in ('NOTICE','WARNING','STRIKE','REVIEW_REQUIRED')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','CLEARED','DISMISSED','REVIEWED')),
  customer_key text not null,
  points integer not null default 0,
  protective_action text not null default 'NONE' check (protective_action in ('NONE','PAUSE_DUPLICATE','PAUSE_CAMPAIGN')),
  protective_status text not null default 'NONE' check (protective_status in ('NONE','APPLIED','FAILED','NOT_PERMITTED')),
  affected_external_ids text[] not null default '{}',
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);
create index if not exists meta_guard_incidents_account_idx on public.meta_guard_incidents (user_id, ad_account_external_id, created_at desc);
alter table public.meta_guard_incidents enable row level security;
drop policy if exists meta_guard_incidents_own on public.meta_guard_incidents;
create policy meta_guard_incidents_own on public.meta_guard_incidents for select to authenticated
  using (user_id = public.auth_user_id() or public.is_admin());
revoke all on public.meta_guard_incidents from anon;

create table if not exists public.meta_guard_evidence (
  incident_id uuid primary key references public.meta_guard_incidents(id) on delete cascade,
  evidence jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.meta_guard_evidence enable row level security;
drop policy if exists meta_guard_evidence_admin on public.meta_guard_evidence;
create policy meta_guard_evidence_admin on public.meta_guard_evidence for select to authenticated using (public.is_admin());
revoke all on public.meta_guard_evidence from anon;
comment on table public.meta_guard_evidence is 'Technical Guard evidence (diffs, signals, Meta object ids). Admin only; the customer sees the incident''s customer_key.';

create table if not exists public.meta_guard_admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null,
  target_user_id uuid not null,
  ad_account_external_id text,
  incident_id uuid references public.meta_guard_incidents(id) on delete set null,
  campaign_id uuid references public.meta_campaigns(id) on delete set null,
  action text not null,
  reason text not null check (length(btrim(reason)) >= 3),
  previous_state jsonb,
  new_state jsonb,
  created_at timestamptz not null default now()
);
alter table public.meta_guard_admin_actions enable row level security;
drop policy if exists meta_guard_admin_actions_admin on public.meta_guard_admin_actions;
create policy meta_guard_admin_actions_admin on public.meta_guard_admin_actions for select to authenticated using (public.is_admin());
revoke all on public.meta_guard_admin_actions from anon;

-- ── 8. LEAD FORMS ────────────────────────────────────────────────────────
create table if not exists public.meta_lead_forms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  page_external_id text not null,
  meta_form_id text,
  name text not null,
  spec jsonb not null,
  status text not null default 'PENDING' check (status in ('PENDING','CREATED','FAILED','ARCHIVED')),
  property_id text,
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, meta_form_id)
);
alter table public.meta_lead_forms enable row level security;
drop policy if exists meta_lead_forms_own on public.meta_lead_forms;
create policy meta_lead_forms_own on public.meta_lead_forms for select to authenticated
  using (user_id = public.auth_user_id() or public.is_admin());
revoke all on public.meta_lead_forms from anon;

-- ── 9. LEADS: full attribution + the CRM pipeline ────────────────────────
alter table public.meta_leads
  add column if not exists ad_external_id text,
  add column if not exists adset_external_id text,
  add column if not exists property_id text,
  add column if not exists answers jsonb,
  add column if not exists meta_created_time timestamptz;
alter table public.meta_leads drop constraint if exists meta_leads_status_check;
update public.meta_leads set status = case status when 'INTERESTED' then 'QUALIFIED' when 'NOT_INTERESTED' then 'LOST' when 'CLOSED' then 'WON' else status end
 where status in ('INTERESTED','NOT_INTERESTED','CLOSED');
alter table public.meta_leads add constraint meta_leads_status_check
  check (status in ('NEW','CONTACTED','QUALIFIED','VIEWING','NEGOTIATING','WON','LOST'));
create index if not exists meta_leads_campaign_idx on public.meta_leads (campaign_id, received_at desc);

-- Lead identity and attribution are server-owned; the owner edits only the pipeline (status, note).
create or replace function public.meta_leads_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.role() = 'service_role' then return new; end if;
  if new.fields is distinct from old.fields
     or new.external_lead_id is distinct from old.external_lead_id
     or new.source is distinct from old.source
     or new.campaign_id is distinct from old.campaign_id
     or new.user_id is distinct from old.user_id
     or new.form_external_id is distinct from old.form_external_id
     or new.received_at is distinct from old.received_at
     or new.ad_external_id is distinct from old.ad_external_id
     or new.adset_external_id is distinct from old.adset_external_id
     or new.property_id is distinct from old.property_id
     or new.answers is distinct from old.answers
     or new.meta_created_time is distinct from old.meta_created_time then
    raise exception 'META_ADS_SERVER_FIELD';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ── 10. FEE POLICIES (HOMATCH commercial terms only) ─────────────────────
create table if not exists public.meta_fee_policies (
  user_id uuid primary key,
  kind text not null check (kind in ('STANDARD_PERCENT','FEE_EXEMPT','CUSTOM_PERCENT')),
  percent numeric check (percent is null or (percent >= 0 and percent <= 100)),
  reason text not null,
  set_by uuid not null,
  updated_at timestamptz not null default now(),
  check (kind <> 'CUSTOM_PERCENT' or percent is not null)
);
alter table public.meta_fee_policies enable row level security;
drop policy if exists meta_fee_policies_own on public.meta_fee_policies;
create policy meta_fee_policies_own on public.meta_fee_policies for select to authenticated
  using (user_id = public.auth_user_id() or public.is_admin());
revoke all on public.meta_fee_policies from anon;

create table if not exists public.meta_fee_policy_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  admin_user_id uuid not null,
  previous jsonb,
  next jsonb not null,
  reason text not null check (length(btrim(reason)) >= 3),
  created_at timestamptz not null default now()
);
alter table public.meta_fee_policy_audit enable row level security;
drop policy if exists meta_fee_policy_audit_admin on public.meta_fee_policy_audit;
create policy meta_fee_policy_audit_admin on public.meta_fee_policy_audit for select to authenticated using (public.is_admin());
revoke all on public.meta_fee_policy_audit from anon;

-- ── 11. LEDGER: an explicit release entry; the balance views ─────────────
alter table public.meta_ads_ledger drop constraint if exists meta_ads_ledger_entry_type_check;
alter table public.meta_ads_ledger add constraint meta_ads_ledger_entry_type_check
  check (entry_type in ('DEPOSIT','RESERVE','RELEASE','META_SPEND','HOMATCH_FEE','FEE_RELEASE','REFUND','WITHDRAWAL','ADJUSTMENT'));
comment on column public.meta_ads_ledger.entry_type is
  'HOMATCH_FEE reserves the service fee; FEE_RELEASE (and legacy REFUND) returns unused fee to the AVAILABLE HOMATCH balance — never to cash. WITHDRAWAL is unused: advertising balance is non-refundable.';

-- Already security_invoker since 20260929200000; restated so the invariant sits next to its sibling view.
alter view public.meta_wallet_balances set (security_invoker = true);

create or replace view public.meta_service_balances with (security_invoker = true) as
with per_campaign as (
  select l.user_id, l.currency, l.campaign_id,
         sum(case when l.entry_type = 'HOMATCH_FEE' then -l.amount_cents else 0 end)
       - sum(case when l.entry_type in ('FEE_RELEASE', 'REFUND') then l.amount_cents else 0 end) as held
    from public.meta_ads_ledger l
   where l.campaign_id is not null
   group by l.user_id, l.currency, l.campaign_id
)
select b.user_id, b.currency, b.available_cents, b.deposited_cents,
       coalesce((select sum(pc.held) from per_campaign pc join public.meta_campaigns c on c.id = pc.campaign_id
                  where pc.user_id = b.user_id and pc.currency = b.currency and c.settled_at is null), 0) as reserved_service_cents,
       coalesce((select sum(pc.held) from per_campaign pc join public.meta_campaigns c on c.id = pc.campaign_id
                  where pc.user_id = b.user_id and pc.currency = b.currency and c.settled_at is not null), 0) as consumed_service_cents,
       coalesce((select sum(r.amount_cents) from public.meta_ads_ledger r
                  where r.user_id = b.user_id and r.currency = b.currency and r.entry_type in ('FEE_RELEASE', 'REFUND')), 0) as released_cents
  from public.meta_wallet_balances b;
grant select on public.meta_service_balances to authenticated;
revoke all on public.meta_service_balances from anon;

-- ── 12. FUNNEL EVENTS: the AI copy limiter can finally count itself ─────
alter table public.meta_funnel_events drop constraint if exists meta_funnel_events_event_check;
alter table public.meta_funnel_events add constraint meta_funnel_events_event_check
  check (event in ('meta_ads_started','meta_ads_draft_created','meta_ads_auth_required','meta_ads_authenticated',
                   'meta_connected','preflight_completed','checkout_started','launch_requested','published',
                   'budget_edited','duration_edited','campaign_ended','recommendation_applied','lead_form_created',
                   'summary_generated')
         or event like 'ai_copy\_%');

-- ── 13. SETTINGS: canonical parameters (code defaults when {}) + goals ───
insert into public.admin_settings (key, value)
values ('meta_ads_strategy_params', '{}'::jsonb),
       ('meta_ads_analysis_params', '{}'::jsonb),
       ('meta_ads_guard_policy', '{}'::jsonb),
       ('meta_ads_guard_enabled', 'true'::jsonb),
       ('meta_ads_ai_summary_enabled', 'true'::jsonb)
on conflict (key) do nothing;

-- MESSAGES (Messenger / Instagram Direct) is end-to-end supported now and the owner asked for it to be
-- fixed and offered (Meta Ads master brief); Admin can still switch it off. WhatsApp stays behind its own switch.
update public.admin_settings
   set value = (select to_jsonb(array(select distinct x from jsonb_array_elements_text(value || '["MESSAGES"]'::jsonb) as t(x))))
 where key = 'meta_ads_goals_enabled' and not (value ? 'MESSAGES');

-- ── 14. NOTIFICATIONS ────────────────────────────────────────────────────
alter type public.notification_type add value if not exists 'META_GUARD';
alter type public.notification_type add value if not exists 'META_RECOMMENDATION';

-- ── 15. CANONICAL EVENTS + NOTIFICATION HISTORY ─────────────────────────
-- One row per condition (key), carried across monitoring cycles: lifecycle
-- state, severity, bucketed evidence fingerprint, first/last seen, and when
-- it last notified. A stable condition updates last_seen_at and nothing else.
create table if not exists public.meta_events (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  user_id uuid not null references public.users(id) on delete cascade,
  campaign_id uuid references public.meta_campaigns(id) on delete cascade,
  type text not null,
  category text not null check (category in ('CAMPAIGN','LEADS','BILLING','GUARD','SYSTEM')),
  severity text not null check (severity in ('INFO','IMPORTANT','CRITICAL')),
  action_required boolean not null default false,
  state text not null check (state in ('OPEN','RESOLVED')),
  evidence_fingerprint text not null,
  evidence jsonb not null default '{}'::jsonb,
  facts jsonb not null default '{}'::jsonb,
  deep_link text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_notified_at timestamptz,
  missing_cycles integer not null default 0,
  reminders integer not null default 0,
  resolved_at timestamptz,
  unique (user_id, key)
);
create index if not exists meta_events_user_idx on public.meta_events (user_id, state, last_seen_at desc);
create index if not exists meta_events_campaign_idx on public.meta_events (campaign_id, state);
alter table public.meta_events enable row level security;
drop policy if exists meta_events_own on public.meta_events;
create policy meta_events_own on public.meta_events for select to authenticated
  using (user_id = public.auth_user_id() or public.is_admin());
revoke all on public.meta_events from anon;

create table if not exists public.meta_event_notifications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.meta_events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  transition text not null check (transition in ('OPEN','ESCALATED','UPDATED','RESOLVED','REMINDER','BRIEF')),
  severity text not null,
  evidence_fingerprint text not null,
  channels text[] not null default '{}',
  notification_id uuid,
  ai_summary_id uuid,
  created_at timestamptz not null default now(),
  unique (event_id, transition, evidence_fingerprint)
);
alter table public.meta_event_notifications enable row level security;
drop policy if exists meta_event_notifications_own on public.meta_event_notifications;
create policy meta_event_notifications_own on public.meta_event_notifications for select to authenticated
  using (user_id = public.auth_user_id() or public.is_admin());
revoke all on public.meta_event_notifications from anon;

-- ── 16. AI SUMMARIES, CACHED BY EVIDENCE — with their cost ──────────────
create table if not exists public.meta_ai_summaries (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null,
  locale text not null,
  purpose text not null check (purpose in ('EVENT','CAMPAIGN_SUMMARY','BRIEF')),
  user_id uuid,
  campaign_id uuid references public.meta_campaigns(id) on delete cascade,
  trigger_reason text not null,
  text text not null,
  model text,
  input_tokens integer,
  output_tokens integer,
  raw_cost_usd numeric,
  landed_cost_usd numeric,
  created_at timestamptz not null default now(),
  unique (purpose, fingerprint, locale)
);
alter table public.meta_ai_summaries enable row level security;
drop policy if exists meta_ai_summaries_own on public.meta_ai_summaries;
create policy meta_ai_summaries_own on public.meta_ai_summaries for select to authenticated
  using (user_id = public.auth_user_id() or public.is_admin());
revoke all on public.meta_ai_summaries from anon;

-- ── 17. DELIVERY LOG: every push/email attempt, one table for all channels ─
create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid,
  user_id uuid not null references public.users(id) on delete cascade,
  channel text not null check (channel in ('IN_APP','PUSH','EMAIL')),
  status text not null check (status in ('QUEUED','SENT','FAILED','SKIPPED')),
  reason text,
  provider text,
  provider_message_id text,
  source text not null default 'meta_ads',
  event_key text,
  created_at timestamptz not null default now(),
  unique (notification_id, channel)
);
alter table public.notification_deliveries enable row level security;
drop policy if exists notification_deliveries_admin on public.notification_deliveries;
create policy notification_deliveries_admin on public.notification_deliveries for select to authenticated using (public.is_admin());
revoke all on public.notification_deliveries from anon;

alter table public.notification_preferences
  add column if not exists email_enabled boolean not null default true;
comment on column public.notification_preferences.email_enabled is
  'Email for important notices. Account-integrity messages (Meta Ads Guard, access loss) are sent regardless.';

-- ── 18. BRIEFS ───────────────────────────────────────────────────────────
create table if not exists public.meta_briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  period text not null check (period in ('DAILY','WEEKLY')),
  period_key text not null,
  fingerprint text not null,
  content jsonb not null,
  notification_id uuid,
  channels text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (user_id, period, period_key)
);
alter table public.meta_briefs enable row level security;
drop policy if exists meta_briefs_own on public.meta_briefs;
create policy meta_briefs_own on public.meta_briefs for select to authenticated
  using (user_id = public.auth_user_id() or public.is_admin());
revoke all on public.meta_briefs from anon;

-- ── 19. GRANTS: server-owned tables are read-only to signed-in users ─────
-- RLS already refuses these writes; the explicit revoke is the repo convention.
revoke insert, update, delete, truncate on
  public.meta_operations, public.meta_insights, public.meta_recommendations, public.meta_campaign_events,
  public.meta_guard_accounts, public.meta_guard_incidents, public.meta_guard_evidence, public.meta_guard_admin_actions,
  public.meta_lead_forms, public.meta_fee_policies, public.meta_fee_policy_audit, public.meta_events,
  public.meta_event_notifications, public.meta_ai_summaries, public.notification_deliveries, public.meta_briefs
  from authenticated;
