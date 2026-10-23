-- EMAIL STUDIO: campaign review state machine, server-side approval and templates (2026-10-24).
--
-- Owner brief "HOMATCH EMAIL STUDIO — COMPLETE PREMIUM REBUILD" §10: a campaign is sent only
-- after it passed the Campaign Risk Engine and was approved, and the approval is enforced at
-- the sending endpoint — a frontend status is not enough. Until now an owner could write any
-- status on their own outreach_campaigns row (RLS "owners_manage" is FOR ALL), including
-- APPROVED, and outreach-send moved any DRAFT/READY/PAUSED email campaign to RUNNING.
--
-- What this adds (EMAIL campaigns only; SMS/calls/other channels unchanged):
--   · new statuses READY_FOR_REVIEW, UNDER_REVIEW, CHANGES_REQUESTED, REJECTED, PARTIALLY_SENT
--     (existing values stay valid: REVIEW_REQUIRED reads as UNDER_REVIEW, RUNNING as SENDING,
--     COMPLETED as SENT);
--   · content_hash, maintained by trigger over everything the recipient sees and who receives it;
--   · approved_content_hash, set only by the review path. outreach-send refuses an email campaign
--     whose content_hash differs from it;
--   · a guard trigger: from the client (role "authenticated") an owner can edit content and
--     move DRAFT ⇄ CANCELLED, APPROVED ⇄ SCHEDULED, RUNNING → PAUSED — never into a review or
--     approval state, and never write approval or risk columns. A material edit of a campaign
--     under review or approved returns it to DRAFT and drops the approval (logged);
--   · email_campaign_reviews: every submission, risk verdict and decision (append-only);
--   · email_campaign_review_decide(): the admin decision, reason required for reject/changes,
--     written to admin_audit_log too;
--   · email_templates: a customer's own saved designs (RLS by owner);
--   · admin setting email_review_policy = MANUAL_ALL (every campaign waits for an admin) until
--     the owner chooses AUTO_LOW_RISK. Hard prohibitions are code, not a setting.
-- Additive only. Existing rows: the 3 production email campaigns are COMPLETED and untouched.

alter table public.outreach_campaigns
  add column if not exists design jsonb,
  add column if not exists preview_text text,
  add column if not exists objective text,
  add column if not exists description text,
  add column if not exists contact_list_ids uuid[],
  add column if not exists audience_filter jsonb,
  add column if not exists content_hash text,
  add column if not exists approved_content_hash text,
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_by uuid,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text,
  add column if not exists risk_score integer,
  add column if not exists risk_reasons jsonb,
  add column if not exists risk_checked_at timestamptz;

alter table public.outreach_campaigns drop constraint if exists outreach_campaigns_status_check;
alter table public.outreach_campaigns add constraint outreach_campaigns_status_check check (status = any (array[
  'DRAFT', 'READY', 'REVIEW_REQUIRED', 'APPROVED', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLIANCE_PAUSED',
  'COMPLETED', 'CANCELLED', 'FAILED',
  'READY_FOR_REVIEW', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'REJECTED', 'PARTIALLY_SENT'
]::text[]));
alter table public.outreach_campaigns drop constraint if exists outreach_campaigns_design_size_check;
alter table public.outreach_campaigns add constraint outreach_campaigns_design_size_check
  check (design is null or pg_column_size(design) <= 262144);

/* Everything a recipient sees and who receives it. Order and separators are part of the contract. */
create or replace function public.email_campaign_content_hash(c public.outreach_campaigns)
returns text
language sql
immutable
set search_path to ''
as $function$
  select md5(concat_ws(chr(31),
    coalesce(c.subject, ''), coalesce(c.preview_text, ''), coalesce(c.html_body, ''), coalesce(c.text_body, ''),
    coalesce(c.sender_name, ''), coalesce(lower(c.sender_email), ''), coalesce(lower(c.reply_to), ''),
    coalesce(c.contact_list_id::text, ''),
    coalesce((select string_agg(x::text, ',' order by x::text) from unnest(c.contact_list_ids) x), ''),
    coalesce(c.audience_filter::text, ''), coalesce(c.language, '')));
$function$;

create table if not exists public.email_campaign_reviews (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.outreach_campaigns(id) on delete cascade,
  owner_id uuid not null,
  actor_id uuid,
  actor_kind text not null check (actor_kind in ('OWNER', 'SYSTEM', 'ADMIN')),
  action text not null check (action in ('SUBMITTED', 'AUTO_APPROVED', 'HELD_FOR_REVIEW', 'BLOCKED', 'APPROVED',
    'REJECTED', 'CHANGES_REQUESTED', 'APPROVAL_INVALIDATED', 'SCHEDULED', 'UNSCHEDULED', 'PAUSED', 'CANCELLED')),
  reason text,
  content_hash text,
  risk_level text,
  risk_score integer,
  risk_findings jsonb,
  created_at timestamptz not null default now()
);
create index if not exists email_campaign_reviews_campaign on public.email_campaign_reviews (campaign_id, created_at desc);
alter table public.email_campaign_reviews enable row level security;
drop policy if exists email_campaign_reviews_read on public.email_campaign_reviews;
create policy email_campaign_reviews_read on public.email_campaign_reviews for select to authenticated
  using (owner_id = (select auth.uid()) or public.is_admin());
revoke all on public.email_campaign_reviews from anon, authenticated;
grant select on public.email_campaign_reviews to authenticated;

/* The owner-side log line the guard writes. Callable only for the caller's own campaign and only
   with the owner actions; review verdicts are written by the review path, never here. */
create or replace function public.email_campaign_log_owner(p_campaign uuid, p_action text, p_reason text, p_hash text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare v_owner uuid;
begin
  if p_action not in ('APPROVAL_INVALIDATED', 'SCHEDULED', 'UNSCHEDULED', 'PAUSED', 'CANCELLED') then raise exception 'INVALID_ACTION'; end if;
  select owner_id into v_owner from public.outreach_campaigns where id = p_campaign;
  if v_owner is null or v_owner is distinct from auth.uid() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  insert into public.email_campaign_reviews (campaign_id, owner_id, actor_id, actor_kind, action, reason, content_hash)
  values (p_campaign, v_owner, auth.uid(), 'OWNER', p_action, left(p_reason, 500), p_hash);
end;
$function$;
revoke all on function public.email_campaign_log_owner(uuid, text, text, text) from public, anon;
grant execute on function public.email_campaign_log_owner(uuid, text, text, text) to authenticated;

/* The guard. Runs as the CALLER (security invoker), so current_user tells a browser request
   (authenticated/anon) from the service role and from security-definer review functions, which
   pass through. The browser can edit content, never approve, and a material edit drops approval. */
create or replace function public.outreach_campaigns_email_guard()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $function$
declare
  v_client boolean := current_user in ('authenticated', 'anon');
  v_review_states text[] := array['READY_FOR_REVIEW', 'UNDER_REVIEW', 'REVIEW_REQUIRED', 'APPROVED', 'SCHEDULED'];
begin
  if new.campaign_type is distinct from 'EMAIL' then return new; end if;
  new.content_hash := public.email_campaign_content_hash(new);
  if not v_client then return new; end if;

  if tg_op = 'INSERT' then
    if new.status not in ('DRAFT') then raise exception 'EMAIL_STATUS_NOT_ALLOWED' using errcode = '42501'; end if;
    new.approved_content_hash := null; new.approved_at := null; new.approved_by := null;
    new.reviewed_by := null; new.reviewed_at := null; new.submitted_at := null;
    new.risk_level := null; new.risk_score := null; new.risk_reasons := null; new.risk_checked_at := null;
    new.compliance_state := null;
    return new;
  end if;

  /* Approval and risk columns belong to the review path. */
  if new.approved_content_hash is distinct from old.approved_content_hash or new.approved_at is distinct from old.approved_at
     or new.approved_by is distinct from old.approved_by or new.reviewed_by is distinct from old.reviewed_by
     or new.reviewed_at is distinct from old.reviewed_at or new.review_note is distinct from old.review_note
     or new.risk_level is distinct from old.risk_level or new.risk_score is distinct from old.risk_score
     or new.risk_reasons is distinct from old.risk_reasons or new.risk_checked_at is distinct from old.risk_checked_at
     or new.compliance_state is distinct from old.compliance_state or new.submitted_at is distinct from old.submitted_at
     or new.sent_count is distinct from old.sent_count or new.delivered_count is distinct from old.delivered_count
     or new.bounce_count is distinct from old.bounce_count or new.complaint_count is distinct from old.complaint_count
     or new.unsubscribe_count is distinct from old.unsubscribe_count or new.failed_count is distinct from old.failed_count
     or new.send_eligibility is distinct from old.send_eligibility or new.owner_id is distinct from old.owner_id
     or new.campaign_type is distinct from old.campaign_type then
    raise exception 'EMAIL_REVIEW_FIELDS_READ_ONLY' using errcode = '42501';
  end if;

  /* A material edit while under review or approved: back to DRAFT, approval gone, logged. */
  if new.content_hash is distinct from old.content_hash then
    if old.status in ('RUNNING', 'COMPLETED', 'PARTIALLY_SENT') then
      raise exception 'EMAIL_CAMPAIGN_ALREADY_SENDING' using errcode = '42501';
    end if;
    if old.status = any (v_review_states) or old.approved_content_hash is not null then
      new.status := 'DRAFT'; new.approved_content_hash := null; new.approved_at := null; new.approved_by := null;
      new.scheduled_at := null;
      perform public.email_campaign_log_owner(old.id, 'APPROVAL_INVALIDATED', 'content changed after submission', new.content_hash);
      return new;
    end if;
  end if;

  if new.status is distinct from old.status then
    if not (
         (new.status = 'DRAFT' and old.status in ('DRAFT', 'CHANGES_REQUESTED', 'REJECTED', 'READY', 'CANCELLED', 'READY_FOR_REVIEW', 'UNDER_REVIEW', 'REVIEW_REQUIRED'))
      or (new.status = 'CANCELLED' and old.status not in ('RUNNING', 'COMPLETED', 'PARTIALLY_SENT', 'CANCELLED'))
      or (new.status = 'SCHEDULED' and old.status = 'APPROVED' and new.scheduled_at is not null and new.scheduled_at > now())
      or (new.status = 'APPROVED' and old.status = 'SCHEDULED')
      or (new.status = 'PAUSED' and old.status = 'RUNNING')
    ) then
      raise exception 'EMAIL_STATUS_TRANSITION_NOT_ALLOWED: % -> %', old.status, new.status using errcode = '42501';
    end if;
    if new.status = 'DRAFT' and old.status in ('READY_FOR_REVIEW', 'UNDER_REVIEW', 'REVIEW_REQUIRED') then
      perform public.email_campaign_log_owner(old.id, 'APPROVAL_INVALIDATED', 'withdrawn from review', new.content_hash);
    elsif new.status in ('SCHEDULED', 'APPROVED', 'PAUSED', 'CANCELLED') then
      perform public.email_campaign_log_owner(old.id,
              case new.status when 'SCHEDULED' then 'SCHEDULED' when 'APPROVED' then 'UNSCHEDULED' when 'PAUSED' then 'PAUSED' else 'CANCELLED' end,
              null, new.content_hash);
    end if;
    if new.status = 'APPROVED' then new.scheduled_at := null; end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists outreach_campaigns_email_guard on public.outreach_campaigns;
create trigger outreach_campaigns_email_guard
  before insert or update on public.outreach_campaigns
  for each row execute function public.outreach_campaigns_email_guard();

/* Backfill the hash for existing email campaigns (the guard computes it from now on). */
update public.outreach_campaigns c set content_hash = public.email_campaign_content_hash(c)
 where c.campaign_type = 'EMAIL' and c.content_hash is null;

/* The admin decision. Reason required for anything but approval; approval pins the current content. */
create or replace function public.email_campaign_review_decide(p_campaign uuid, p_decision text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_c public.outreach_campaigns;
  v_admin uuid := auth.uid();
  v_status text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_admin is null or not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_decision not in ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'PAUSED') then raise exception 'INVALID_DECISION'; end if;
  if p_decision <> 'APPROVED' and v_reason is null then raise exception 'REASON_REQUIRED'; end if;
  select * into v_c from public.outreach_campaigns where id = p_campaign and campaign_type = 'EMAIL' for update;
  if not found then raise exception 'CAMPAIGN_NOT_FOUND'; end if;
  if p_decision = 'APPROVED' then
    if v_c.status not in ('READY_FOR_REVIEW', 'UNDER_REVIEW', 'REVIEW_REQUIRED', 'CHANGES_REQUESTED') then
      raise exception 'NOT_AWAITING_REVIEW';
    end if;
    if coalesce(v_c.risk_level, '') = 'BLOCKED' then raise exception 'HARD_PROHIBITION'; end if;
    v_status := 'APPROVED';
  elsif p_decision = 'PAUSED' then
    if v_c.status not in ('RUNNING', 'SCHEDULED', 'APPROVED') then raise exception 'NOT_PAUSABLE'; end if;
    v_status := 'PAUSED';
  else
    if v_c.status in ('RUNNING', 'COMPLETED', 'PARTIALLY_SENT', 'CANCELLED') then raise exception 'ALREADY_SENT'; end if;
    v_status := p_decision;
  end if;
  update public.outreach_campaigns set
    status = v_status,
    approved_content_hash = case when v_status = 'APPROVED' then v_c.content_hash when v_status = 'PAUSED' then approved_content_hash else null end,
    approved_at = case when v_status = 'APPROVED' then now() when v_status = 'PAUSED' then approved_at else null end,
    approved_by = case when v_status = 'APPROVED' then v_admin when v_status = 'PAUSED' then approved_by else null end,
    reviewed_by = v_admin, reviewed_at = now(), review_note = v_reason,
    paused_reason = case when v_status = 'PAUSED' then left(v_reason, 500) else paused_reason end,
    updated_at = now()
  where id = v_c.id;
  insert into public.email_campaign_reviews (campaign_id, owner_id, actor_id, actor_kind, action, reason, content_hash, risk_level, risk_score)
  values (v_c.id, v_c.owner_id, v_admin, 'ADMIN', v_status, v_reason, v_c.content_hash, v_c.risk_level, v_c.risk_score);
  insert into public.admin_audit_log (admin_id, target_id, action, entity_type, entity_id, metadata)
  values ((select u.id from public.users u where u.auth_id = v_admin), null, 'EMAIL_CAMPAIGN_' || v_status, 'outreach_campaign', v_c.id::text,
          jsonb_build_object('reason', v_reason, 'previous_status', v_c.status, 'content_hash', v_c.content_hash));
  return jsonb_build_object('status', v_status);
end;
$function$;
revoke all on function public.email_campaign_review_decide(uuid, text, text) from public, anon;
grant execute on function public.email_campaign_review_decide(uuid, text, text) to authenticated;

/* A customer's own saved designs. Built-in templates live in code. */
create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  kind text not null default 'CUSTOM',
  language text,
  subject text,
  preview_text text,
  design jsonb not null check (pg_column_size(design) <= 262144),
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists email_templates_owner on public.email_templates (owner_id, updated_at desc);
alter table public.email_templates enable row level security;
drop policy if exists email_templates_owner on public.email_templates;
create policy email_templates_owner on public.email_templates for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
revoke all on public.email_templates from anon;
grant select, insert, update, delete on public.email_templates to authenticated;

insert into public.admin_settings (key, value, updated_at)
values ('email_review_policy', '"MANUAL_ALL"'::jsonb, now())
on conflict (key) do nothing;

/* The scheduler claims an email campaign only with a current approval; anything else stays
   SCHEDULED (visible, cancellable) instead of being moved to RUNNING and refused by the gate. */
create or replace function public.outreach_claim_due_campaigns(p_limit integer default 5)
returns table (id uuid, owner_id uuid, campaign_type text)
language sql
security definer
set search_path = public
as $$
  update public.outreach_campaigns c
     set status = 'RUNNING',
         launched_at = coalesce(c.launched_at, now()),
         updated_at = now()
   where c.id in (
     select c2.id from public.outreach_campaigns c2
      where c2.status = 'SCHEDULED'
        and c2.scheduled_at is not null
        and c2.scheduled_at <= now()
        and c2.send_eligibility = 'PRODUCTION'
        and (c2.campaign_type <> 'EMAIL'
             or (c2.approved_content_hash is not null and c2.approved_content_hash = c2.content_hash))
      order by c2.scheduled_at
      for update skip locked
      limit p_limit
   )
  returning c.id, c.owner_id, c.campaign_type;
$$;
revoke all on function public.outreach_claim_due_campaigns(integer) from public, anon, authenticated;
