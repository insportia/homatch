-- HOMATCH — a source stamped "Georgia" is not evidence about Georgia.
--
-- WHAT PRODUCTION ACTUALLY HOLDS, CHECKED BEFORE ANYTHING WAS CHANGED
--
-- source_registry has 305 active rows for country_code = 'GE'. 296 of them
-- are Arabic-language Reddit communities: r/RasAlKhaimah, r/Emiratis,
-- r/FragranceJO. They were written on 2026-08-28/29 by the retired discovery
-- pipeline, which stamped each source with the market of the CAMPAIGN THAT
-- ASKED rather than the market the source is about.
--
-- That alone might be defensible — an Emirati community is a plausible place
-- to find an Arabic-speaking investor interested in Tbilisi. What they
-- actually produced is not:
--
--   103 CLASSIFIED signals, of which by their own intent_profiles.country
--        38 are about Georgia
--        65 are about Egypt, Turkey, Saudi Arabia, the UAE, Bosnia, Cyprus
--   478 ERROR
--    90 FILTERED_OUT
--
-- The CLASSIFIED samples are articles about buying property in Istanbul. The
-- ERROR samples are a cat meowing, a fragrance subreddit in Jordan, and an
-- electrical fault in Riyadh.
--
-- WHY THIS IS A MIGRATION AND NOT A DELETE
--
-- Those rows are history and they stay. What must not stand is the CONCLUSION
-- drawn from them: campaign_language_evidence counted source-level language
-- against source-level country, so Arabic ranked first for Georgia on the
-- strength of Turkish property articles, and AUTO would have recommended it.
-- A recommender fed by its own retired pipeline's mis-stamped rows is the
-- definition of fake source coverage.
--
-- So the function now asks a harder and more honest question: not "is this
-- source filed under Georgia" but "did this source produce a signal whose
-- INTENT is Georgia".
--
-- THE SECOND DEFECT, FOUND BY THE FIRST
--
-- intent_profiles.country is free text written by the classifier, and it
-- holds both forms of everything: Georgia AND GE, Saudi Arabia AND SA, UAE
-- AND United Arab Emirates, Egypt AND EG. Any query that groups by it
-- double-counts every market, which is why the numbers above needed adding up
-- by hand. normalize_country_code below is the one place that knows they are
-- the same country.

-- ── one spelling per country ─────────────────────────────────────────────
--
-- Deliberately narrow: the markets Homatch researches, plus the ones its
-- Arabic and Russian audiences actually write about. An unknown value is
-- returned UPPERCASED AND TRIMMED rather than mapped to null, so a country
-- this does not know about still compares equal to itself instead of
-- vanishing from every count.
create or replace function public.normalize_country_code(p_value text)
returns text
language sql
immutable
as $$
  select case upper(btrim(coalesce(p_value, '')))
    when 'GEORGIA' then 'GE'
    when 'SAKARTVELO' then 'GE'
    when 'TURKEY' then 'TR'
    when 'TURKIYE' then 'TR'
    when 'TÜRKIYE' then 'TR'
    when 'UNITED ARAB EMIRATES' then 'AE'
    when 'UAE' then 'AE'
    when 'SAUDI ARABIA' then 'SA'
    when 'KSA' then 'SA'
    when 'EGYPT' then 'EG'
    when 'ISRAEL' then 'IL'
    when 'RUSSIA' then 'RU'
    when 'RUSSIAN FEDERATION' then 'RU'
    when 'ARMENIA' then 'AM'
    when 'AZERBAIJAN' then 'AZ'
    when 'KAZAKHSTAN' then 'KZ'
    when 'UKRAINE' then 'UA'
    when 'CYPRUS' then 'CY'
    when 'GREECE' then 'GR'
    when 'BOSNIA AND HERZEGOVINA' then 'BA'
    when 'QATAR' then 'QA'
    when 'KUWAIT' then 'KW'
    when 'JORDAN' then 'JO'
    when 'INDIA' then 'IN'
    when 'UNITED KINGDOM' then 'GB'
    when 'UK' then 'GB'
    when 'UNITED STATES' then 'US'
    when 'USA' then 'US'
    when '' then null
    else upper(btrim(p_value))
  end
$$;

comment on function public.normalize_country_code is
  'One spelling per country. intent_profiles.country is free text from the '
  'classifier and holds both "Georgia" and "GE"; anything grouping by it '
  'without this double-counts every market. Unknown values pass through '
  'uppercased rather than becoming null, so they still compare to themselves.';

-- ── language evidence, from what a source PRODUCED ───────────────────────
--
-- The previous version counted a source's own language and country columns.
-- Those are written by whoever registered the source, and the retired
-- pipeline wrote them wrong at scale. This counts signals whose classified
-- intent is actually in the market — which a mis-stamped source cannot fake,
-- because the intent comes from reading the text.
--
-- `known_sources` still counts sources filed under the market, because that
-- IS the question it answers: how many places do we have to look. It is
-- `useful_signals` that decides the ranking, and that now requires the
-- signal to be about the market.
create or replace function public.campaign_language_evidence(p_country_code text)
returns table (language text, known_sources bigint, useful_signals bigint)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with market as (
    select public.normalize_country_code(p_country_code) as code
  ),
  sources as (
    select sr.id, lower(sr.language) as language
      from public.source_registry sr, market m
     where sr.active is true
       and sr.language is not null
       and public.normalize_country_code(sr.country_code) = m.code
  ),
  useful as (
    select s.language, count(*) as n
      from public.raw_signals rs
      join sources s on s.id = rs.source_id
      join public.intent_profiles ip on ip.signal_id = rs.id
         , market m
     where rs.classification_status = 'CLASSIFIED'
       -- THE FIX. A signal counts for this market only if its own classified
       -- intent says so. A source filed under Georgia that produced an
       -- article about Istanbul is not Georgian evidence.
       and public.normalize_country_code(ip.country) = m.code
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
  'Per-language source and useful-signal counts for a market. useful_signals '
  'requires the SIGNAL''S OWN classified intent to be in the market, because '
  'source_registry.country_code was stamped with the requesting campaign''s '
  'market by the retired discovery pipeline and 65 of 103 Arabic "Georgian" '
  'signals are about Turkey and Egypt. Ranking lives in '
  'src/research-core/discovery/campaign-languages.ts.';

revoke all on function public.campaign_language_evidence(text) from public, anon;
grant execute on function public.campaign_language_evidence(text) to service_role, authenticated;
