-- EMAIL STUDIO — visual builder history and deliverability evidence (2026-10-24).
--
-- Owner brief "Premium Drag & Drop Visual Builder + Production Email Deliverability". Additive:
--
--   1. email_design_versions — snapshots of a campaign's design document (the structured source of
--      truth, never only HTML), written by campaign_save at most every two minutes per campaign and
--      on demand. Owner reads their own; only the service role writes; 50 kept per campaign.
--   2. email_deliverability_checks — the result of each deliverability_check (provider record
--      status + public DNS: SPF, DKIM, DMARC, alignment) so the panel can show the last check.
--   3. email_placement_tests — what the OWNER observed for a controlled test message: where it
--      landed (Inbox / Spam / Promotions / not received) in which mailbox provider, and the
--      authentication summary read from that message's own headers (parsed in the browser; the raw
--      headers are not stored). This is the only place an "Inbox" or "Spam" placement exists in
--      HOMATCH — a provider "delivered" event never becomes one.

/* ── 1. design versions ───────────────────────────────────────────────────────────────────── */
create table if not exists public.email_design_versions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.outreach_campaigns (id) on delete cascade,
  owner_id uuid not null,
  design jsonb not null check (pg_column_size(design) <= 262144),
  subject text,
  reason text not null default 'AUTOSAVE' check (reason in ('AUTOSAVE', 'MANUAL', 'RESTORE', 'TEMPLATE')),
  created_at timestamptz not null default now()
);
create index if not exists email_design_versions_campaign on public.email_design_versions (campaign_id, created_at desc);
alter table public.email_design_versions enable row level security;
drop policy if exists email_design_versions_owner_read on public.email_design_versions;
create policy email_design_versions_owner_read on public.email_design_versions for select to authenticated
  using (owner_id = (select auth.uid()));
revoke all on public.email_design_versions from anon, authenticated;
grant select on public.email_design_versions to authenticated;
grant all on public.email_design_versions to service_role;

/* Keep the newest 50 per campaign. */
create or replace function public.email_design_versions_trim()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  delete from public.email_design_versions v
   where v.campaign_id = new.campaign_id
     and v.id in (select id from public.email_design_versions where campaign_id = new.campaign_id order by created_at desc offset 50);
  return null;
end;
$function$;
drop trigger if exists email_design_versions_trim on public.email_design_versions;
create trigger email_design_versions_trim after insert on public.email_design_versions
  for each row execute function public.email_design_versions_trim();

/* ── 2. deliverability checks ─────────────────────────────────────────────────────────────── */
create table if not exists public.email_deliverability_checks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  result jsonb not null check (pg_column_size(result) <= 65536),
  checked_at timestamptz not null default now()
);
create index if not exists email_deliverability_checks_owner on public.email_deliverability_checks (owner_id, checked_at desc);
alter table public.email_deliverability_checks enable row level security;
drop policy if exists email_deliverability_checks_owner_read on public.email_deliverability_checks;
create policy email_deliverability_checks_owner_read on public.email_deliverability_checks for select to authenticated
  using (owner_id = (select auth.uid()));
revoke all on public.email_deliverability_checks from anon, authenticated;
grant select on public.email_deliverability_checks to authenticated;
grant all on public.email_deliverability_checks to service_role;

/* ── 3. controlled placement tests ────────────────────────────────────────────────────────── */
create table if not exists public.email_placement_tests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  campaign_id uuid references public.outreach_campaigns (id) on delete set null,
  mailbox text not null check (mailbox in ('GMAIL', 'OUTLOOK', 'YAHOO', 'APPLE', 'OTHER')),
  placement text not null check (placement in ('INBOX', 'SPAM', 'PROMOTIONS', 'OTHER_TAB', 'NOT_RECEIVED')),
  auth jsonb check (auth is null or pg_column_size(auth) <= 8192),
  note text check (note is null or length(note) <= 500),
  observed_at timestamptz not null default now()
);
create index if not exists email_placement_tests_owner on public.email_placement_tests (owner_id, observed_at desc);
alter table public.email_placement_tests enable row level security;
drop policy if exists email_placement_tests_owner on public.email_placement_tests;
create policy email_placement_tests_owner on public.email_placement_tests for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
revoke all on public.email_placement_tests from anon;
grant select, insert, delete on public.email_placement_tests to authenticated;
grant all on public.email_placement_tests to service_role;
