-- Work that exists BEFORE Email Marketing is hidden: it must survive the pause untouched.
insert into public.outreach_campaigns (id, owner_id, name, campaign_type, status, scheduled_at, approved_content_hash, content_hash, contact_list_id) values
  ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'due email', 'EMAIL', 'SCHEDULED', now() - interval '5 minutes', 'h1', 'h1', gen_random_uuid()),
  ('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', 'running email', 'EMAIL', 'RUNNING', now() - interval '1 day', 'h2', 'h2', gen_random_uuid()),
  ('e0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a', 'draft email', 'EMAIL', 'DRAFT', null, null, 'h3', null),
  ('e0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-00000000000a', 'due sms', 'SMS', 'SCHEDULED', now() - interval '5 minutes', null, null, gen_random_uuid());
update public.outreach_campaigns set updated_at = now() - interval '10 minutes' where id = 'e0000000-0000-0000-0000-000000000002';
insert into public.email_studio_campaigns (id, owner_user_id, status, scheduled_at, scheduled_hash, schedule_state) values
  ('50000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'REVIEWED', now() - interval '5 minutes', 'v1', 'SCHEDULED');
create table public._before as select service_key, frontend_enabled, backend_enabled, version from public.service_controls;
