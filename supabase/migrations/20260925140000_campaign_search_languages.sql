-- HOMATCH — which languages a campaign searches in, recorded where it is billed.
--
-- WHY THE DATABASE HAS TO HOLD THIS
--
-- src/research-core/discovery/campaign-languages.ts decides the set, and a
-- decision that lives only in a function call is re-made on every resume. The
-- failure that produces is specific and expensive: a customer chooses Hebrew,
-- the campaign stops, and three days later a worker reconstructs the set from
-- languagesForMarket() and runs six languages. The customer is billed for the
-- resume rather than for the language.
--
-- So the selection is persisted, and persisted in FOUR parts, because they
-- answer four different questions:
--
--   search_language_mode        who decided -- EXPLICIT, AUTO or ALL
--   search_languages_selected   what the customer ticked. Kept even under
--                               AUTO, so "they accepted our suggestion" and
--                               "they chose this themselves" stay
--                               distinguishable a year later
--   search_languages_resolved   what actually runs. The planner reads THIS
--                               and nothing else
--   search_language_rationale   why each language is in the set, as it was
--                               shown to the customer at the time
--
-- The rationale is a snapshot, not a view. Recomputing it later would answer
-- with today's registry evidence about a decision made against last month's,
-- which is a different sentence presented as the same one.
--
-- AND A FIFTH, WHICH IS THE ONE THAT SAVES MONEY
--
-- search_languages_discovered: the languages this campaign has already paid
-- to discover in. A campaign that ran HE + EN and then gains RU must schedule
-- RUSSIAN and nothing else. Without a record of what was already bought there
-- is no way to tell "the language set changed" from "this language is new",
-- and every edit re-runs everything.
--
-- MIGRATING WHAT IS ALREADY THERE
--
-- Every existing campaign gets NULL, which reads as "recorded before Homatch
-- tracked search languages" -- not as an empty set, which would read as a
-- campaign that searches nothing, and not backfilled with a guess about what
-- those campaigns would have chosen. The first launch after this migration
-- resolves and stores a real selection. Nothing is rewritten.

-- ── the campaign's own configuration ─────────────────────────────────────
alter table public.matching_campaigns
  add column if not exists search_language_mode text,
  add column if not exists search_languages_selected text[],
  add column if not exists search_languages_resolved text[],
  add column if not exists search_language_rationale jsonb,
  add column if not exists search_languages_discovered text[],
  add column if not exists search_language_updated_at timestamptz;

comment on column public.matching_campaigns.search_language_mode is
  'EXPLICIT (the customer chose), AUTO (they accepted a recommendation) or '
  'ALL. NULL means the campaign predates search-language selection.';
comment on column public.matching_campaigns.search_languages_selected is
  'What the customer ticked. Kept alongside the resolved set so an accepted '
  'recommendation stays distinguishable from a deliberate choice.';
comment on column public.matching_campaigns.search_languages_resolved is
  'The set the planner runs. The only column discovery reads.';
comment on column public.matching_campaigns.search_language_rationale is
  'Why each language was in the set, as shown to the customer at the time. A '
  'snapshot: recomputing it would answer a different question.';
comment on column public.matching_campaigns.search_languages_discovered is
  'Languages this campaign has already paid to discover in. A resume schedules '
  'resolved MINUS this, so adding a language does not re-buy the others.';

-- ── the same, snapshotted onto the run that used it ──────────────────────
--
-- The job carries its own copy because the campaign's set can change between
-- runs, and "what did this job actually search in" must stay answerable after
-- it does. A job pointing at a mutable campaign column answers with today's
-- configuration about last week's work.
alter table public.matching_jobs
  add column if not exists search_languages text[],
  add column if not exists search_language_mode text;

comment on column public.matching_jobs.search_languages is
  'The languages THIS run searched. A snapshot, because the campaign''s set '
  'may change before the next run and this one must stay answerable.';

-- ── what the supported set is, in one place ──────────────────────────────
--
-- Mirrors CAMPAIGN_SEARCH_LANGUAGES in campaign-languages.ts. Two lists in
-- two languages is a drift risk, and the alternative -- accepting any text --
-- is worse: a typo becomes a language the planner has no lexicon for, and the
-- campaign silently searches in five languages instead of six while its
-- configuration says six.
create or replace function public.campaign_search_languages()
returns text[]
language sql
immutable
as $$ select array['ka','en','ru','he','ar','tr']::text[] $$;

comment on function public.campaign_search_languages is
  'The discovery languages a customer may choose. Mirrors '
  'CAMPAIGN_SEARCH_LANGUAGES in src/research-core/discovery/campaign-languages.ts; '
  'a test asserts the two agree.';

-- Every element of a language array must be one of them. NULL stays legal --
-- that is what "predates this" looks like -- and an EMPTY array does not,
-- because a campaign that searches nothing is a campaign nobody asked for.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'matching_campaigns_search_languages_check') then
    alter table public.matching_campaigns
      add constraint matching_campaigns_search_languages_check
      check (
        (search_languages_resolved is null
          or (array_length(search_languages_resolved, 1) > 0
              and search_languages_resolved <@ public.campaign_search_languages()))
        and (search_languages_selected is null
          or search_languages_selected <@ public.campaign_search_languages())
        and (search_languages_discovered is null
          or search_languages_discovered <@ public.campaign_search_languages())
        and (search_language_mode is null
          or search_language_mode in ('EXPLICIT', 'AUTO', 'ALL'))
      )
      not valid;
  end if;
end $$;

alter table public.matching_campaigns
  validate constraint matching_campaigns_search_languages_check;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'matching_jobs_search_languages_check') then
    alter table public.matching_jobs
      add constraint matching_jobs_search_languages_check
      check (
        (search_languages is null
          or (array_length(search_languages, 1) > 0
              and search_languages <@ public.campaign_search_languages()))
        and (search_language_mode is null
          or search_language_mode in ('EXPLICIT', 'AUTO', 'ALL'))
      )
      not valid;
  end if;
end $$;

alter table public.matching_jobs
  validate constraint matching_jobs_search_languages_check;

-- ── coverage, per language, counted rather than estimated ────────────────
--
-- The campaign workspace has to be able to say "twelve Hebrew sources
-- attempted, nine reached, two blocked, one still running". Every column here
-- is a COUNT of something that happened. There is deliberately no percentage
-- and no total: a coverage percentage needs a denominator of "all relevant
-- sources in the world", nobody can produce one, and a number nobody can
-- defend is worse on a dashboard than an absence.
create table if not exists public.campaign_language_coverage (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.matching_campaigns(id) on delete cascade,
  -- Null for a campaign-level roll-up; set for one run's contribution.
  job_id uuid references public.matching_jobs(id) on delete set null,
  language text not null,

  -- The plan intended to scan this many sources.
  attempted integer not null default 0,
  -- ...of which this many answered with content,
  reached integer not null default 0,
  -- ...and this many refused: a wall, a block, a removal. Named, not hidden.
  blocked integer not null default 0,
  -- attempted - reached - blocked is sources still in flight, which is a real
  -- third state rather than a rounding error.

  -- Raw items read from the sources that answered.
  signals_found integer not null default 0,
  -- ...that survived the job's deterministic filter,
  signals_valid integer not null default 0,
  -- ...and were not already held. The number a customer actually receives.
  signals_unique integer not null default 0,
  -- Already held, by fingerprint or by id. Reuse working, not waste.
  signals_duplicate integer not null default 0,
  -- Held, but outside the delivery freshness window when this ran.
  signals_stale integer not null default 0,
  -- ...of which this many were re-checked and confirmed.
  signals_revalidated integer not null default 0,

  first_run_at timestamptz not null default now(),
  last_run_at timestamptz not null default now(),

  constraint campaign_language_coverage_language_check
    check (language = any (public.campaign_search_languages()))
);

comment on table public.campaign_language_coverage is
  'What actually happened per campaign language. Counts only: no percentage '
  'and no denominator, because "all relevant sources" is not a number anyone '
  'can produce and a coverage figure nobody can defend is worse than none.';

-- One roll-up row per campaign and language; the per-job rows sit beside it.
create unique index if not exists campaign_language_coverage_rollup_key
  on public.campaign_language_coverage (campaign_id, language)
  where job_id is null;

create index if not exists campaign_language_coverage_job_idx
  on public.campaign_language_coverage (job_id)
  where job_id is not null;

alter table public.campaign_language_coverage enable row level security;

-- Readable by the campaign's owner, writable only by the engine. A customer
-- may see what their campaign did; nothing client-side may edit the record of
-- it, because that record is what the spend is explained by.
drop policy if exists campaign_language_coverage_owner_read on public.campaign_language_coverage;
create policy campaign_language_coverage_owner_read
  on public.campaign_language_coverage
  for select
  using (
    exists (
      select 1
        from public.matching_campaigns c
        join public.users u on u.id = c.user_id
       where c.id = campaign_language_coverage.campaign_id
         and u.auth_id = auth.uid()
    )
  );

grant select on public.campaign_language_coverage to authenticated;
