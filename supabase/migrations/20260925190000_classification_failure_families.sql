-- HOMATCH — 510 ERROR was one word for three different things.
--
-- WHAT THE EVIDENCE GATE FOUND, AND WHAT IT ACTUALLY MEANS
--
--   510 ERROR   239 FILTERED_OUT   119 CLASSIFIED
--
-- A 66% error rate reads as a broken pipeline. It is not one. It is two
-- separate defects wearing the same label, and the numbers say which is which.
--
-- DEFECT 1: A TRANSIENT FAILURE BECAME A PERMANENT STATE
--
-- The ERROR rows are not spread over time the way individual content
-- judgements would be. They arrive in bursts:
--
--   2026-08-28 22:30   111 errors across 31 distinct sources
--   2026-08-28 21:45    83 errors across 57 distinct sources
--   2026-08-28 22:45    76 errors across 51 distinct sources
--   2026-08-29 02:15    70 errors across 36 distinct sources
--
-- Around 85% of the total arrived in seven such minutes. That is the shape of
-- classify-signals-v2's chunk-level catch: one OpenAI call throws, and every
-- signal in the batch -- up to 300 of them, from dozens of unrelated sources
-- -- is written ERROR.
--
-- And ERROR is terminal. The classifier selects
-- `.eq('classification_status','PENDING')`, so nothing ever looks at those
-- rows again. A network timeout permanently discarded hundreds of signals
-- that were never actually read.
--
-- DEFECT 2: THE SOURCES SHOULD NOT HAVE BEEN THERE
--
-- By source, the ERROR rows are:
--
--   140  wrong market   r/Riyadh, r/saudiarabia, r/dubailawyer, r/opensooqsd
--    83  wrong subject  r/CheatProctoredTests, r/CertificationsAWS,
--                       r/HomeworkHelpers1, r/GeorgiaRealEstateExam
--    53  genuinely Georgian sources
--    32  no source row at all
--
-- r/GeorgiaRealEstateExam is the one that explains the rest: the retired
-- discovery searched "Georgia real estate" and registered the licensing exam
-- subreddit for the US STATE. The exam and homework subreddits came in on the
-- same sweep. Those signals are not classification failures; they are posts
-- about passing an AWS certification, correctly producing no property intent.
--
-- That half is already handled: source_lifecycle leaves every one of those
-- rows at DISCOVERED, and source_may_scan_for_campaign() excludes it.
--
-- WHAT THIS MIGRATION DOES, AND DOES NOT
--
-- It does NOT relabel the 510. Improving a metric by renaming its failures is
-- the one thing that would make this worse, and the existing rows keep ERROR
-- with a NULL kind, meaning "recorded before the pipeline separated causes".
--
-- It gives future rows somewhere to say WHICH failure happened, and it gives
-- a transient one a way back.

-- ── which kind of failure ────────────────────────────────────────────────
alter table public.raw_signals
  add column if not exists classification_error_kind text,
  add column if not exists classification_attempts integer not null default 0,
  add column if not exists classification_last_error text;

comment on column public.raw_signals.classification_error_kind is
  'Why classification did not produce a verdict. NULL on an ERROR row means '
  'it predates this column (2026-09-25), not that the cause was unknown at '
  'the time.';

comment on column public.raw_signals.classification_attempts is
  'How many times classification has been tried. A batch failure returns a '
  'signal to PENDING and increments this; only an exhausted count is '
  'terminal, so one provider timeout no longer discards 300 signals.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'raw_signals_classification_error_kind_check') then
    alter table public.raw_signals
      add constraint raw_signals_classification_error_kind_check
      check (classification_error_kind is null or classification_error_kind in (
        -- The provider call itself failed: timeout, 5xx, rate limit. NOTHING
        -- is known about the content, and the signal is owed another look.
        'BATCH_FAILED',
        -- The call succeeded and returned no verdict for this id. The model
        -- skipped it, which usually means it saw nothing to classify.
        'MODEL_OMITTED',
        -- A verdict existed and our own write failed. Ours to fix.
        'WRITE_FAILED',
        -- The response was not the shape we asked for.
        'MALFORMED_RESPONSE',
        -- Tried the permitted number of times and never got a verdict.
        'ATTEMPTS_EXHAUSTED'
      ))
      not valid;
  end if;
end $$;

alter table public.raw_signals
  validate constraint raw_signals_classification_error_kind_check;

-- The retry path selects on exactly this.
create index if not exists raw_signals_classification_retry_idx
  on public.raw_signals (classification_status, classification_attempts)
  where classification_status = 'PENDING';

-- ── what the failure families actually are ───────────────────────────────
--
-- So the question "is 510 ERROR acceptable" can be answered with a query
-- rather than by somebody re-deriving it from samples. Deliberately reports
-- COUNTS per family and no rate: "66% error" was the misleading number that
-- started this, because it divided three unrelated things by one total.
create or replace function public.classification_failure_families()
returns table (
  family text,
  signals bigint,
  distinct_sources bigint,
  first_seen timestamptz,
  last_seen timestamptz
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select
    case
      when rs.classification_error_kind is not null then rs.classification_error_kind
      when rs.source_id is null then 'NO_SOURCE_RECORDED'
      when sr.name ~* 'exam|cheat|homework|certification|aws' then 'SOURCE_WRONG_SUBJECT'
      when sr.name ~* 'riyadh|saudi|dubai|emirat|rasalkhaimah|opensooq|aswaq|jordan' then 'SOURCE_WRONG_MARKET'
      else 'LEGACY_UNSEPARATED'
    end as family,
    count(*) as signals,
    count(distinct rs.source_id) as distinct_sources,
    min(rs.discovered_at) as first_seen,
    max(rs.discovered_at) as last_seen
  from public.raw_signals rs
  left join public.source_registry sr on sr.id = rs.source_id
  where rs.classification_status = 'ERROR'
  group by 1
$$;

comment on function public.classification_failure_families is
  'Breaks the ERROR count into families instead of one number. The source-'
  'subject and source-market families are a SOURCE SELECTION defect from the '
  'retired discovery pipeline, not a classifier defect; BATCH_FAILED is a '
  'transient provider failure that used to be terminal.';

revoke all on function public.classification_failure_families() from public, anon, authenticated;
grant execute on function public.classification_failure_families() to service_role;
