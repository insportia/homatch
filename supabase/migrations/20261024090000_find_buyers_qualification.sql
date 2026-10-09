-- FIND BUYERS / FIND TENANTS — evidence-backed lead qualification.
--
-- The first production campaign (VILLION, 2026-10-09) showed 37 "qualified"
-- leads of which 4 were real purchase requests: job seekers, rental seekers
-- and sale advertisements were scored as buyers. Qualification is now an
-- explicit, recorded decision per assessed signal and per lead:
--   role             BUY_SEEKER | RENT_SEEKER | SALE_OFFER | RENT_OFFER |
--                    AGENT | SERVICE | JOB | IRRELEVANT | UNCLEAR
--   match_category   STRONG | POTENTIAL | WEAK | REJECTED
--   rejection_reasons  explicit codes (WRONG_TRANSACTION, JOB_SEARCH, …)
--   budget_fit / location_fit / requirements_fit
--                    COMPATIBLE | NEARBY | INCOMPATIBLE | UNKNOWN …
-- UNKNOWN is never COMPATIBLE. Rejected leads are KEPT (evidence and
-- financial history are never deleted) and leave the customer-facing view.
-- Additive: columns, one view redefinition, campaign strategy/metrics.

alter table public.find_buyers_assessments
  add column if not exists role text,
  add column if not exists transaction text,
  add column if not exists match_category text,
  add column if not exists rejection_reasons text[] not null default '{}',
  add column if not exists budget_fit text,
  add column if not exists location_fit text,
  add column if not exists requirements_fit text,
  add column if not exists qualification jsonb,
  add column if not exists qualification_version integer;

alter table public.find_buyers_leads
  add column if not exists role text,
  add column if not exists transaction text,
  add column if not exists match_category text,
  add column if not exists rejection_reasons text[] not null default '{}',
  add column if not exists budget_fit text,
  add column if not exists location_fit text,
  add column if not exists requirements_fit text,
  add column if not exists qualification jsonb,
  add column if not exists qualification_version integer,
  add column if not exists requalified_at timestamptz;

do $$ begin
  alter table public.find_buyers_leads add constraint find_buyers_leads_match_category_chk
    check (match_category is null or match_category in ('STRONG', 'POTENTIAL', 'WEAK', 'REJECTED'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.find_buyers_assessments add constraint find_buyers_assessments_match_category_chk
    check (match_category is null or match_category in ('STRONG', 'POTENTIAL', 'WEAK', 'REJECTED'));
exception when duplicate_object then null; end $$;

create index if not exists find_buyers_leads_job_category_idx
  on public.find_buyers_leads (matching_job_id, match_category);
create index if not exists find_buyers_assessments_job_category_idx
  on public.find_buyers_assessments (matching_job_id, match_category);

/* The property-specific search strategy (personas, budget band, places,
   languages, query hypotheses) and the campaign's measured timings. */
alter table public.find_buyers_campaigns
  add column if not exists strategy jsonb,
  add column if not exists metrics jsonb not null default '{}'::jsonb;

/* What the owner sees: current AND not rejected. A legacy row without a
   category (written before qualification) stays visible until it is
   re-qualified; re-qualification sets a category on every row. */
create or replace view public.find_buyers_current_leads with (security_invoker = true) as
  select l.* from public.find_buyers_leads l
   where public.find_buyers_signal_is_current(l.signal_at)
     and coalesce(l.match_category, 'POTENTIAL') <> 'REJECTED';
revoke all on public.find_buyers_current_leads from public, anon;
grant select on public.find_buyers_current_leads to authenticated, service_role;
