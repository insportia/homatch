-- Email Marketing hidden (20261207140000): proofs on a throwaway database. Never production.
\set ON_ERROR_STOP on
create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if; raise notice 'PASS  %', msg; end $$;
create or replace function pg_temp.raises(stmt text, code text) returns boolean language plpgsql as $$
begin execute stmt; return false; exception when others then return sqlerrm = code; end $$;

-- 1. The key: OFF, audited once, nothing else flipped.
select pg_temp.ok((select not frontend_enabled and not backend_enabled and service_group = 'marketing' from public.service_controls where service_key = 'email_marketing'), 'email_marketing exists, OFF, in Marketing');
select pg_temp.ok((select count(*) = 1 from public.admin_audit_log where entity_id = 'email_marketing' and metadata ->> 'actor' = 'migration'), 'one audit row (a second apply adds none)');
select pg_temp.ok((select count(*) = (select count(*) from public._before) from public._before b join public.service_controls c using (service_key)
  where c.frontend_enabled = b.frontend_enabled and c.backend_enabled = b.backend_enabled and c.version = b.version), 'no existing switch moved (SMS stays ON)');
select pg_temp.ok((select reason like 'SMS campaigns%' from public.service_controls where service_key = 'email_campaigns'), 'the historic row says it is SMS now');
select pg_temp.ok((select count(*) = 2 from public.finance_services where service_control_key = 'email_marketing'), 'finance catalogue points at the new key');

-- 2. Pause preserves work: the claims skip email (and a paused service), SMS still claims.
select pg_temp.ok((select array_agg(campaign_type) = '{SMS}' from public.outreach_claim_due_campaigns(10)), 'only the SMS campaign is claimed while email is paused');
select pg_temp.ok((select status = 'SCHEDULED' and scheduled_at is not null from public.outreach_campaigns where id = 'e0000000-0000-0000-0000-000000000001'), 'the due email campaign stays SCHEDULED with its time');
select pg_temp.ok((select count(*) = 0 from public.outreach_claim_running_campaigns(10)), 'a RUNNING email campaign is not continued');
select pg_temp.ok((select status = 'RUNNING' from public.outreach_campaigns where id = 'e0000000-0000-0000-0000-000000000002'), 'and stays RUNNING');
select pg_temp.ok((select count(*) = 0 from public.email_studio_claim_due_scheduled(10)), 'no Studio schedule is due');
select pg_temp.ok((select schedule_attempted_at is null and scheduled_at is not null from public.email_studio_campaigns where id = '50000000-0000-0000-0000-000000000001'), 'and none is stamped or cleared');
select public.email_studio_schedule_outcome('50000000-0000-0000-0000-000000000001', 'SERVICE_PAUSED');
select pg_temp.ok((select scheduled_at is not null and schedule_state = 'SERVICE_PAUSED' from public.email_studio_campaigns where id = '50000000-0000-0000-0000-000000000001'), 'a paused outcome keeps the schedule');

-- 3. DB guard while off.
select pg_temp.ok(pg_temp.raises($$insert into public.outreach_campaigns (campaign_type, status) values ('EMAIL', 'DRAFT')$$, 'SERVICE_DISABLED'), 'no new email campaign');
select pg_temp.ok(not pg_temp.raises($$insert into public.outreach_campaigns (campaign_type, status) values ('SMS', 'DRAFT')$$, 'SERVICE_DISABLED'), 'SMS drafts are unaffected');
select pg_temp.ok(pg_temp.raises($$update public.outreach_campaigns set status = 'SCHEDULED', scheduled_at = now() + interval '1 day' where id = 'e0000000-0000-0000-0000-000000000003'$$, 'SERVICE_DISABLED'), 'no new schedule');
select pg_temp.ok(pg_temp.raises($$update public.outreach_campaigns set status = 'RUNNING' where id = 'e0000000-0000-0000-0000-000000000003'$$, 'SERVICE_DISABLED'), 'no start');
update public.outreach_campaigns set status = 'PAUSED' where id = 'e0000000-0000-0000-0000-000000000002';
select pg_temp.ok((select status = 'PAUSED' from public.outreach_campaigns where id = 'e0000000-0000-0000-0000-000000000002'), 'pausing is allowed');
select pg_temp.ok(pg_temp.raises($$update public.outreach_campaigns set status = 'RUNNING' where id = 'e0000000-0000-0000-0000-000000000002'$$, 'SERVICE_DISABLED'), 'no resume while off');
update public.outreach_campaigns set name = 'edited' where id = 'e0000000-0000-0000-0000-000000000003';
select pg_temp.ok((select name = 'edited' from public.outreach_campaigns where id = 'e0000000-0000-0000-0000-000000000003'), 'editing an existing draft is allowed');
-- the jobs worker's re-arm (RUNNING → SCHEDULED) and its claim (SCHEDULED → RUNNING) stay possible
update public.outreach_campaigns set status = 'RUNNING' where id = 'e0000000-0000-0000-0000-000000000001';
update public.outreach_campaigns set status = 'SCHEDULED' where id = 'e0000000-0000-0000-0000-000000000001';
select pg_temp.ok((select status = 'SCHEDULED' from public.outreach_campaigns where id = 'e0000000-0000-0000-0000-000000000001'), 're-arm is allowed');
select pg_temp.ok(pg_temp.raises($$insert into public.email_studio_campaigns (owner_user_id) values (gen_random_uuid())$$, 'SERVICE_DISABLED'), 'no new Studio campaign');
select pg_temp.ok(pg_temp.raises($$update public.email_studio_campaigns set scheduled_at = now() + interval '2 days' where id = '50000000-0000-0000-0000-000000000001'$$, 'SERVICE_DISABLED'), 'no new Studio schedule');
update public.email_studio_campaigns set scheduled_at = null, schedule_state = 'CANCELLED' where id = '50000000-0000-0000-0000-000000000001';
select pg_temp.ok((select scheduled_at is null from public.email_studio_campaigns where id = '50000000-0000-0000-0000-000000000001'), 'cancelling a schedule is allowed');

-- 4. Turned back on: everything resumes, nothing was lost.
update public.service_controls set frontend_enabled = true, backend_enabled = true where service_key = 'email_marketing';
select pg_temp.ok((select array_agg(id::text) = '{e0000000-0000-0000-0000-000000000001}' from public.outreach_claim_due_campaigns(10)), 'the preserved scheduled campaign is claimed on the first tick');
insert into public.outreach_campaigns (campaign_type, status) values ('EMAIL', 'DRAFT');
select pg_temp.ok(true, 'a new email draft is accepted again');
update public.outreach_campaigns set status = 'RUNNING' where id = 'e0000000-0000-0000-0000-000000000002';
select pg_temp.ok((select status = 'RUNNING' from public.outreach_campaigns where id = 'e0000000-0000-0000-0000-000000000002'), 'resume works again');
