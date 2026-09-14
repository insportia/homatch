-- HOMATCH — scheduled email sends, and a campaign that was simulated can
-- never become a campaign that was sent.
--
-- TWO SEPARATE GUARANTEES, BECAUSE ONE OF THEM IS NOT ENOUGH
--
-- The first lives in outreach-send: an EMAIL campaign is REFUSED when the
-- resolved adapter would be the mock one, rather than silently producing
-- outreach_sends rows marked SENT that nobody ever received. That is what
-- stops fake delivery counters being created at all.
--
-- The second lives here, and it is the belt to that function's braces. Any
-- campaign that has ever had a simulated send is marked LEGACY_MOCK, by a
-- trigger, at the moment the row lands — so a campaign cannot be rehearsed
-- while sending is off and then quietly flushed to real recipients on the day
-- somebody turns the provider on. SMS and voice keep their mock path, which
-- is exactly the case the trigger still has to catch.
--
-- Neither guarantee depends on the UI, and neither depends on the other.

-- ── 1. Sendability is a stored fact, not an inference ───────────────────
alter table public.outreach_campaigns
  add column if not exists send_eligibility text not null default 'PRODUCTION';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.outreach_campaigns'::regclass
      and conname = 'outreach_campaigns_send_eligibility_chk'
  ) then
    alter table public.outreach_campaigns
      add constraint outreach_campaigns_send_eligibility_chk
      check (send_eligibility in ('PRODUCTION', 'LEGACY_MOCK'));
  end if;
end $$;

comment on column public.outreach_campaigns.send_eligibility is
  'PRODUCTION: may be dispatched through a real provider. LEGACY_MOCK: has at '
  'least one simulated send and may never be dispatched, at any later date, '
  'whatever the provider settings then say.';

-- Every campaign that exists today predates real email sending ever being
-- enabled, so none of them may become sendable. Currently an empty set; the
-- statement is here so it stays correct if that changes before this is applied.
update public.outreach_campaigns set send_eligibility = 'LEGACY_MOCK';

-- ── 2. Failures are counted, so "partially failed" can be told from "sent" ──
alter table public.outreach_campaigns
  add column if not exists failed_count integer not null default 0;
alter table public.outreach_campaigns
  add column if not exists last_send_error text;

-- ── 3. A simulated send condemns its campaign, at the moment it lands ───
create or replace function public.outreach_mark_campaign_simulated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.provider = 'MOCK' then
    update public.outreach_campaigns
       set send_eligibility = 'LEGACY_MOCK', updated_at = now()
     where id = new.campaign_id
       and send_eligibility <> 'LEGACY_MOCK';
  end if;
  return new;
end $$;

drop trigger if exists outreach_sends_mark_simulated on public.outreach_sends;
create trigger outreach_sends_mark_simulated
  after insert or update of provider on public.outreach_sends
  for each row execute function public.outreach_mark_campaign_simulated();

-- ── 4. Claiming a due campaign, exactly once ────────────────────────────
--
-- SKIP LOCKED plus a status predicate inside the UPDATE is the whole
-- guarantee: two overlapping ticks cannot both move the same row out of
-- SCHEDULED, so a campaign is dispatched once however often the worker runs.
-- A crash after the claim leaves it RUNNING, which outreach-send is already
-- built to resume.
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
      order by c2.scheduled_at
      for update skip locked
      limit p_limit
   )
  returning c.id, c.owner_id, c.campaign_type;
$$;

revoke all on function public.outreach_claim_due_campaigns(integer) from public, anon, authenticated;

-- ── 5. Scheduled campaigns are found by the worker, not scanned for ─────
create index if not exists outreach_campaigns_due_idx
  on public.outreach_campaigns (scheduled_at)
  where status = 'SCHEDULED';
