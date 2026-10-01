-- META ADS — the customer's own words and their favourite creative.
--
-- 1. meta_creatives.priority — "Priority creative": a preference signal the
--    plan honours (strategy.buildPlan always includes a priority creative and
--    gives it the first slot); delivery is still decided by results. Written
--    by the customer, like every other creative field.
-- 2. meta_campaigns.owner_brief — "Tell HOMATCH what you really want": soft
--    intent in the customer's own words. Never sent to Meta, never part of the
--    launch fingerprint, never a targeting field.
-- 3. meta_campaigns.brief_understanding — what HOMATCH understood from that
--    brief (meta-ads-api brief_interpret: validated, closed vocabularies), and
--    the customer's corrections to it. Carries the hash of the brief it was
--    read from, so a stale reading is never shown as current.
--
-- Additive only; no existing row changes meaning (priority false, brief '').

alter table public.meta_creatives
  add column if not exists priority boolean not null default false;

alter table public.meta_campaigns
  add column if not exists owner_brief text not null default '';

alter table public.meta_campaigns
  add column if not exists brief_understanding jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'meta_campaigns_owner_brief_len') then
    alter table public.meta_campaigns
      add constraint meta_campaigns_owner_brief_len check (char_length(owner_brief) <= 1500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'meta_campaigns_brief_understanding_size') then
    alter table public.meta_campaigns
      add constraint meta_campaigns_brief_understanding_size
      check (brief_understanding is null or (jsonb_typeof(brief_understanding) = 'object' and pg_column_size(brief_understanding) <= 16384));
  end if;
end $$;
