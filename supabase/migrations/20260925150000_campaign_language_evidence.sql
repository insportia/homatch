-- HOMATCH — which languages have actually paid off in a market.
--
-- WHAT THE RECOMMENDER NEEDS, AND WHAT IT MUST NOT BE GIVEN
--
-- AUTO mode suggests languages. Suggesting them from the market default alone
-- is a standing guess: Georgia "is written in" six languages whether or not
-- any of them have ever produced a lead for anybody. The registry can do
-- better — it knows which languages Homatch has sources in and which of those
-- sources produced signals that survived a filter.
--
-- What it must NOT do is filter. A language with no record is not a language
-- known to be useless; every language had no record once, and a recommender
-- that only ever suggests what already worked can never discover that a
-- market has an Arabic-speaking investor population. So this function returns
-- counts and the ranking happens in campaign-languages.ts, where an absent
-- row scores as UNPROVEN and still makes the list.
--
-- COUNTS, NOT A SCORE
--
-- The arithmetic stays in one place — the TypeScript, which is tested — and
-- this returns the two facts it needs. A scoring function here would be a
-- second opinion in a second language, and the day they disagree the
-- recommendation shown to the customer and the one that ran would differ.
create or replace function public.campaign_language_evidence(p_country_code text)
returns table (language text, known_sources bigint, useful_signals bigint)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with sources as (
    select sr.id, lower(sr.language) as language
      from public.source_registry sr
     where sr.active is true
       and sr.language is not null
       and upper(coalesce(sr.country_code, '')) = upper(coalesce(p_country_code, ''))
  ),
  -- CLASSIFIED is the deterministic filter having accepted it. FILTERED_OUT
  -- means the pipeline looked and said no, which is a source doing its job
  -- badly rather than a source that was never read -- and counting it as
  -- useful would rank a channel full of irrelevant chatter above a quiet one
  -- that produces real buyers.
  useful as (
    select s.language, count(*) as n
      from public.raw_signals rs
      join sources s on s.id = rs.source_id
     where rs.classification_status = 'CLASSIFIED'
     group by s.language
  )
  select s.language,
         count(distinct s.id) as known_sources,
         coalesce(max(u.n), 0) as useful_signals
    from sources s
    left join useful u on u.language = s.language
   group by s.language
$$;

comment on function public.campaign_language_evidence is
  'Per-language source and useful-signal counts for a market, for AUTO '
  'language recommendation. Counts only -- the ranking lives in '
  'src/research-core/discovery/campaign-languages.ts so there is one copy of it.';

revoke all on function public.campaign_language_evidence(text) from public, anon;
grant execute on function public.campaign_language_evidence(text) to service_role, authenticated;
