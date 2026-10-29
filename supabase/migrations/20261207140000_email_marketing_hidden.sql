-- EMAIL MARKETING HIDDEN (owner decision, 2026-10-29): the public Email Marketing product
-- (email campaigns, Email Studio, sending domains, CRM inbox replies, email plans) is hidden
-- and closed on the server. Code and data are preserved; Admin → Service Control Center turns
-- it back on (service `email_marketing`). Transactional email (Resend notifications, receipts,
-- verification mail) is a different path and is not touched.
--
-- THE KEY SPLIT.
--   * `email_marketing` (NEW): email campaigns + Email Studio + plans/domains/inbox. FAIL CLOSED:
--     hidden and refused unless its row explicitly says ON. Seeded OFF/OFF here, audited.
--   * `email_campaigns` (EXISTING ROW, historic name): from now on it governs SMS campaigns
--     only. Its switches are NOT touched, so SMS keeps exactly the behaviour it has today and
--     code deployed before this migration keeps reading the same row.
--
-- WHY THE OLD ROW IS NOT FLIPPED: before the new jobs-worker is deployed, an OFF
-- `email_campaigns` would make the old dispatcher mark every scheduled campaign FAILED. The
-- database guards below make Email Marketing closed the moment this migration is applied,
-- without depending on any function deploy:
--
--   1. NO NEW EMAIL CAMPAIGNS while `email_marketing` is off: inserting an EMAIL row into
--      outreach_campaigns, or a row into email_studio_campaigns, is refused (SERVICE_DISABLED).
--   2. NO NEW SCHEDULE / START / RESUME: moving an EMAIL campaign into SCHEDULED or RUNNING from
--      any other status, or arming a Studio schedule, is refused. Unscheduling, pausing,
--      cancelling and editing stay possible: the owner may always stop work.
--   3. PAUSE PRESERVES WORK: the claim functions the jobs worker polls skip campaigns whose
--      service is off (EMAIL → email_marketing, SMS → email_campaigns, AI_CALL → ai_call_center)
--      instead of handing them to a sender that would refuse them. A SCHEDULED or RUNNING
--      campaign and an armed Studio schedule therefore stay exactly as they are and go out on
--      the first tick after the service is turned back on. A "service paused" outcome never
--      clears a Studio schedule again.
--
-- EMAIL PLAN RENEWALS: email-marketing's plan_renew_due charges nothing while the service is
-- off (decided 2026-10-29: renewals pause and NOTHING is extended; a paid period that ends
-- during the pause lapses as it would without renewal). That is enforced in the edge
-- function; nothing here charges.
--
-- Additive and backward compatible: one CHECK widened, one row inserted (ON CONFLICT DO
-- NOTHING), two BEFORE triggers added, four functions replaced with the same signatures,
-- two finance catalogue rows re-pointed to the new key. Nothing is dropped or deleted.

/* ════════════════════════════════════════════════════════════════════════
 * 1 · the new key, OFF, audited
 * ════════════════════════════════════════════════════════════════════════ */

alter table public.service_controls drop constraint service_controls_service_key_check;
alter table public.service_controls add constraint service_controls_service_key_check check (service_key in (
  'publishing', 'ai_call_center', 'ai_talk', 'whatsapp', 'live_chat', 'design_studio',
  'find_property', 'find_property_deep', 'find_buyers', 'find_buyers_external',
  'internal_matching', 'curated_leads',
  'verify', 'contracts', 'mortgage', 'investment', 'for_expats',
  'meta_ads', 'email_campaigns', 'email_marketing',
  'ai_assistant',
  'brokers_directory', 'broker_desk', 'developers'));

insert into public.service_controls (service_key, frontend_enabled, backend_enabled, service_group, reason) values
  ('email_marketing', false, false, 'marketing',
   'Owner decision 2026-10-29: Email Marketing hidden publicly and closed on the server; code and data preserved')
on conflict (service_key) do nothing;

update public.service_controls
   set reason = coalesce(reason, 'SMS campaigns (since 2026-10-29 email campaigns and Email Studio are service email_marketing)')
 where service_key = 'email_campaigns' and reason is null;

insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
select '00000000-0000-0000-0000-000000000000'::uuid, 'SERVICE_CONTROL_SET', 'service_controls', 'email_marketing',
       jsonb_build_object(
         'result', 'CHANGED', 'actor', 'migration', 'request_id', 'migration:20261207140000',
         'reason', 'Owner decision 2026-10-29: Email Marketing hidden publicly and closed on the server; code and data preserved',
         'before', null,
         'after', jsonb_build_object('frontend', false, 'backend', false, 'version', 1))
 where not exists (select 1 from public.admin_audit_log
                    where entity_type = 'service_controls' and entity_id = 'email_marketing'
                      and metadata ->> 'request_id' = 'migration:20261207140000');

update public.finance_services set service_control_key = 'email_marketing'
 where service_key in ('email_marketing', 'email_studio') and service_control_key = 'email_campaigns';

/* ════════════════════════════════════════════════════════════════════════
 * 2 · database guards: no new email campaign, no new schedule, while off
 * ════════════════════════════════════════════════════════════════════════ */

/* outreach_campaigns, EMAIL rows only (SMS, calls and WhatsApp are not this service). Fires for
   every role: the edge functions are gated too, this is the boundary nothing can skip. Moves
   between SCHEDULED and RUNNING (the jobs worker's claim and its re-arm) stay allowed. */
create or replace function public.email_marketing_outreach_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.campaign_type is distinct from 'EMAIL' then return new; end if;
  if public.service_backend_enabled('email_marketing') then return new; end if;
  if tg_op = 'INSERT' then
    raise exception 'SERVICE_DISABLED' using hint = 'email_marketing', errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and new.status in ('SCHEDULED', 'RUNNING')
     and old.status not in ('SCHEDULED', 'RUNNING') then
    raise exception 'SERVICE_DISABLED' using hint = 'email_marketing', errcode = '42501';
  end if;
  return new;
end;
$function$;
revoke all on function public.email_marketing_outreach_guard() from public, anon, authenticated;

drop trigger if exists trg_0_service_control_email_marketing on public.outreach_campaigns;
create trigger trg_0_service_control_email_marketing
  before insert or update on public.outreach_campaigns
  for each row execute function public.email_marketing_outreach_guard();

/* email_studio_campaigns: no new campaign, no newly armed schedule. Keeping, editing or
   clearing an existing schedule is allowed. */
create or replace function public.email_marketing_studio_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if public.service_backend_enabled('email_marketing') then return new; end if;
  if tg_op = 'INSERT' then
    raise exception 'SERVICE_DISABLED' using hint = 'email_marketing', errcode = '42501';
  end if;
  if new.scheduled_at is not null and new.scheduled_at is distinct from old.scheduled_at then
    raise exception 'SERVICE_DISABLED' using hint = 'email_marketing', errcode = '42501';
  end if;
  return new;
end;
$function$;
revoke all on function public.email_marketing_studio_guard() from public, anon, authenticated;

drop trigger if exists trg_0_service_control_email_marketing on public.email_studio_campaigns;
create trigger trg_0_service_control_email_marketing
  before insert or update on public.email_studio_campaigns
  for each row execute function public.email_marketing_studio_guard();

/* ════════════════════════════════════════════════════════════════════════
 * 3 · pause preserves work: the claims skip a paused service
 * ════════════════════════════════════════════════════════════════════════ */

/* Same signature and body as 20261127120000, plus the per-type service check. A campaign of a
   paused service is simply not due yet: it stays SCHEDULED with its time. */
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
        and (c2.campaign_type <> 'EMAIL' or public.service_backend_enabled('email_marketing'))
        and (c2.campaign_type <> 'SMS' or public.service_backend_enabled('email_campaigns'))
        and (c2.campaign_type <> 'AI_CALL' or public.service_backend_enabled('ai_call_center'))
      order by c2.scheduled_at
      for update skip locked
      limit p_limit
   )
  returning c.id, c.owner_id, c.campaign_type;
$$;
revoke all on function public.outreach_claim_due_campaigns(integer) from public, anon, authenticated;
grant execute on function public.outreach_claim_due_campaigns(integer) to service_role;

/* A RUNNING email campaign is not continued while Email Marketing is off: it stays RUNNING,
   with the contacts it has left, and continues after the service is back. */
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
        and public.service_backend_enabled('email_marketing')
        and c2.send_eligibility = 'PRODUCTION'
        and c2.updated_at < now() - interval '60 seconds'
        and (c2.contact_list_id is not null or coalesce(array_length(c2.contact_list_ids, 1), 0) > 0)
        and (coalesce(c2.metadata -> 'broadcast' ->> 'state', '') = 'SYNCING'
             or exists (select 1 from public.outreach_email_campaign_batch(c2.id, 1)))
      order by c2.updated_at
      for update skip locked
      limit greatest(1, least(coalesce(p_limit, 5), 20))
   )
  returning c.id, c.owner_id, c.campaign_type;
$function$;
revoke all on function public.outreach_claim_running_campaigns(integer) from public, anon, authenticated;
grant execute on function public.outreach_claim_running_campaigns(integer) to service_role;

/* Studio schedules: nothing is due while Email Marketing is off (no attempt is stamped either). */
create or replace function public.email_studio_claim_due_scheduled(p_limit integer default 5)
returns table (campaign_id uuid, owner_user_id uuid, version_hash text)
language plpgsql security definer set search_path = public as $$
begin
  if not public.service_backend_enabled('email_marketing') then return; end if;
  return query
  with due as (
    select c.id from public.email_studio_campaigns c
     where c.scheduled_at is not null and c.scheduled_at <= now() and c.scheduled_hash is not null
       and c.status in ('REVIEWED', 'SENDING')
       and (c.schedule_attempted_at is null or c.schedule_attempted_at < now() - interval '2 minutes')
     order by c.scheduled_at
     limit greatest(1, least(coalesce(p_limit, 5), 20))
     for update skip locked
  )
  update public.email_studio_campaigns c set schedule_attempted_at = now()
    from due where c.id = due.id
  returning c.id, c.owner_user_id, c.scheduled_hash;
end $$;
revoke all on function public.email_studio_claim_due_scheduled(integer) from public, anon, authenticated;
grant execute on function public.email_studio_claim_due_scheduled(integer) to service_role;

/* The outcome of a scheduled attempt. A refusal still ends the schedule, EXCEPT a paused
   service: SERVICE_PAUSED records the state and keeps the time, so the schedule is re-armed
   for the first tick after the service is back, never destroyed by the pause. */
create or replace function public.email_studio_schedule_outcome(p_campaign_id uuid, p_state text)
returns void language sql security definer set search_path = public as $$
  update public.email_studio_campaigns
     set schedule_state = left(p_state, 40),
         scheduled_at = case when p_state in ('SENT', 'SENDING', 'SERVICE_PAUSED') then scheduled_at else null end,
         updated_at = now()
   where id = p_campaign_id;
$$;
revoke all on function public.email_studio_schedule_outcome(uuid, text) from public, anon, authenticated;
grant execute on function public.email_studio_schedule_outcome(uuid, text) to service_role;
