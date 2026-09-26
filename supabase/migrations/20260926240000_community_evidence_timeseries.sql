-- GLOBAL INTELLIGENCE, ASKED A QUESTION WITH A CLOCK IN IT.
--
-- timeBounds() has existed since the time model landed and had no consumers: the
-- windows were computed and nothing ever queried with them. This is the read
-- side, and its whole job is to keep one distinction the frontend cannot be
-- trusted to keep on its own.
--
-- WHICH CLOCK
--
-- "Buyers who posted today" and "buyers we found today" are different questions
-- with different answers, and answering the wrong one silently is worse than
-- refusing. raw_signals carries both, plus a third that matters for freshness:
--
--   published_at      when the AUTHOR posted. NULLABLE -- a source that stated no
--                     date has none, so a published_at window legitimately
--                     excludes rows a discovered_at window includes.
--   discovered_at     when HOMATCH first saw it. Never null.
--   last_verified_at  when we last CONFIRMED it. Null until something re-reads it.
--
-- The column is therefore a parameter, not a default buried in a query, and the
-- answer always states which one it used.
--
-- WHY DYNAMIC SQL, AND WHY IT IS SAFE
--
-- A CASE expression over the three columns would be injection-proof and would
-- also defeat every index on them, turning a windowed count into a full scan of
-- the evidence table. So the column name is interpolated -- and interpolation is
-- only acceptable behind a closed allowlist, which is what the CASE below is. An
-- unlisted value raises; it is never defaulted past, because silently answering a
-- different question than the one asked is the exact failure this file exists to
-- prevent.
--
-- The bucket is allowlisted the same way. truncUnit() in the research core does
-- this too; the check is repeated here because the database must not depend on a
-- caller having been careful.
--
-- A NOTE ON THE LEDGER, so the history reads honestly.
--
-- Production shows this function applied TWICE: once as
-- `community_evidence_timeseries` and once as
-- `community_evidence_timeseries_enum_cast`. The second was a correction, and it
-- has no file of its own because this file carries the corrected version -- the
-- `$3::signal_platform` cast below. Replaying this file alone reaches the same
-- final state, which is what a migration file is for.
--
-- The first attempt compared the enum column against a text parameter and every
-- call failed with `operator does not exist: signal_platform = text`. Caught by
-- running it, not by reading it.

create or replace function community_evidence_timeseries(
  p_from timestamptz,
  p_to timestamptz,
  p_column text default 'discovered_at',
  p_bucket text default 'DAY',
  p_platform text default null,
  p_direction text default null,
  p_language text default null
)
returns table (
  bucket_start timestamptz,
  evidence_count bigint,
  demand_count bigint,
  supply_count bigint,
  reference_count bigint,
  unknown_count bigint,
  -- Evidence in this bucket that has since gone away. A count of what we hold
  -- that is no longer there is a different fact from a count of what we found.
  unavailable_count bigint
)
language plpgsql
stable
as $$
declare
  v_column text;
  v_unit   text;
begin
  -- THE ALLOWLIST. Not a sanitiser, not an escape: a fixed set of three literals,
  -- chosen by comparison, and an error for anything else.
  v_column := case p_column
    when 'published_at'     then 'published_at'
    when 'discovered_at'    then 'discovered_at'
    when 'last_verified_at' then 'last_verified_at'
    else null
  end;
  if v_column is null then
    raise exception 'community_evidence_timeseries: unsupported time column %', p_column
      using hint = 'one of published_at, discovered_at, last_verified_at';
  end if;

  v_unit := case upper(p_bucket)
    when 'HOUR'  then 'hour'
    when 'DAY'   then 'day'
    when 'WEEK'  then 'week'
    when 'MONTH' then 'month'
    else null
  end;
  if v_unit is null then
    raise exception 'community_evidence_timeseries: unsupported bucket %', p_bucket
      using hint = 'one of HOUR, DAY, WEEK, MONTH';
  end if;

  if p_from is null or p_to is null then
    raise exception 'community_evidence_timeseries: both bounds are required';
  end if;
  if p_from > p_to then
    raise exception 'community_evidence_timeseries: the window starts after it ends';
  end if;

  return query execute format($q$
    select
      date_trunc(%L, s.%I)                                          as bucket_start,
      count(*)                                                      as evidence_count,
      count(*) filter (where s.research_direction = 'DEMAND')        as demand_count,
      count(*) filter (where s.research_direction = 'SUPPLY')        as supply_count,
      count(*) filter (where s.research_direction = 'REFERENCE')     as reference_count,
      count(*) filter (where s.research_direction = 'UNKNOWN'
                          or s.research_direction is null)           as unknown_count,
      count(*) filter (where s.became_unavailable_at is not null)    as unavailable_count
    from raw_signals s
    where s.%I >= $1
      and s.%I <  $2
      -- A NULL time column is not in any window. Stated rather than left to
      -- three-valued logic: published_at is nullable and a reader has to be able
      -- to see that those rows were excluded on purpose.
      and s.%I is not null
      -- THE PARAMETER IS CAST, NOT THE COLUMN. raw_signals.platform is the enum
      -- signal_platform, so a text comparison needs one side converted, and which
      -- side is not a style choice:
      --   s.platform::text = $3   defeats any index on platform, and a misspelled
      --                           'TELEGRAN' quietly matches nothing, which reads
      --                           as "no evidence on Telegram"
      --   s.platform = $3::enum   stays indexable, and a misspelling raises
      -- Answering a different question than the one asked is the failure this
      -- whole function is built to avoid, so it raises.
      and ($3 is null or s.platform = $3::signal_platform)
      and ($4 is null or s.research_direction = $4)
      and ($5 is null or s.language = $5)
    group by 1
    order by 1
  $q$, v_unit, v_column, v_column, v_column, v_column)
  using p_from, p_to, p_platform, p_direction, p_language;
end;
$$;

comment on function community_evidence_timeseries is
  'Windowed counts of community evidence. The time column is a parameter because '
  '"posted today" and "found today" are different questions; it is allowlisted to '
  'three names so the interpolation needed for index use cannot become injection.';

-- Indexes for the two clocks a window is actually asked about. discovered_at is
-- never null so a plain index serves it; published_at is nullable and only
-- non-null rows can ever match a window, so a partial index is both smaller and
-- exactly the set being scanned.
create index if not exists raw_signals_discovered_at_idx
  on raw_signals (discovered_at desc);

create index if not exists raw_signals_published_at_idx
  on raw_signals (published_at desc)
  where published_at is not null;

-- Only EXECUTE, and only to the roles that already reach this data through RLS
-- on the underlying table. The function is stable and reads one table; it is not
-- SECURITY DEFINER, so it cannot be used to see past a policy.
revoke all on function community_evidence_timeseries(
  timestamptz, timestamptz, text, text, text, text, text
) from public;
grant execute on function community_evidence_timeseries(
  timestamptz, timestamptz, text, text, text, text, text
) to authenticated, service_role;
