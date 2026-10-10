-- Extra production objects 20261027110000_email_studio.sql reads, layered on top of
-- homatch_leads_fixture.sql + the HOMATCH Leads migration (columns as in production).
-- Run: tests/sql/run-email-studio.sh
alter table public.admin_settings add column if not exists description text;

create table public.notification_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  categories jsonb not null default '{}'::jsonb, push_enabled boolean not null default true,
  marketing_opt_in boolean not null default false, updated_at timestamptz not null default now()
);
create table public.outreach_contacts (
  id uuid primary key default gen_random_uuid(), owner_id uuid, email text, full_name text,
  do_not_contact boolean default false, unsubscribed boolean default false, suppressed boolean default false,
  bounce_count int default 0, complaint_count int default 0
);
create table public.property_market_segments (
  property_id uuid primary key references public.properties(id) on delete cascade,
  segment text not null check (segment in ('PREMIUM', 'MIDDLE', 'ECONOMY', 'UNKNOWN'))
);
insert into public.property_market_segments values ('00000000-0000-0000-0000-0000000000f2', 'PREMIUM');

-- b5, b6: two more members for the consent matrix.
insert into public.users (id, auth_id, email, full_name, nickname, preferred_language) values
  ('00000000-0000-0000-0000-0000000000b5', '10000000-0000-0000-0000-0000000000b5', 'buyer5@x.test', 'Tamar Five', null, 'ka'),
  ('00000000-0000-0000-0000-0000000000b6', '10000000-0000-0000-0000-0000000000b6', 'buyer6@x.test', 'Dov Six', null, 'he');

-- a1 has unlocked b1, b2, b5, b6 (directly, as the unlock RPC would have); a2 unlocked b1.
insert into public.internal_lead_unlocks (id, account_user_id, lead_user_id, first_match_id, first_property_id, segment, unit_price_credits, credits_charged) values
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', 'STANDARD', 2.5, 2.5),
  ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000f1', 'PREMIUM', 6, 6),
  ('00000000-0000-0000-0000-00000000e005', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b5', null, '00000000-0000-0000-0000-0000000000f1', 'STANDARD', 2.5, 2.5),
  ('00000000-0000-0000-0000-00000000e006', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b6', null, '00000000-0000-0000-0000-0000000000f1', 'STANDARD', 2.5, 2.5),
  ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d6', '00000000-0000-0000-0000-0000000000f3', 'STANDARD', 2.5, 2.5);

insert into public.lead_crm_entries (owner_user_id, lead_user_id, unlock_id, property_id, status) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000000f1', 'UNLOCKED'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-00000000e006', '00000000-0000-0000-0000-0000000000f1', 'UNLOCKED');
