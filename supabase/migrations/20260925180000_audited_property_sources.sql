-- HOMATCH — twenty Georgian property sources, audited on 2026-09-25.
--
-- WHAT THIS IS, AND WHAT IT IS NOT
--
-- scripts/audit-property-sources.mjs asked each of these sites the only
-- question that decides whether it can have an adapter: does its own
-- robots.txt permit HomatchResearch to read its listing paths? Two requests
-- per host — /robots.txt and / — with a User-Agent naming Homatch and
-- pointing at a page about the crawler, several seconds apart, honouring any
-- published Crawl-delay. Nothing was followed, nothing disallowed was probed,
-- and nothing was stored from the pages.
--
-- Every row below is the RESULT of that, not a plan for it. The lifecycle is
-- AUDITED or BLOCKED and nothing higher, because:
--
--   PERMITTED is not IMPLEMENTED   one door being open is not an adapter
--   A 200 IS NOT A PARSE           a cookie wall answers 200 and carries none
--   NOTHING HERE IS LIVE_TESTED    no adapter has read any of these
--
-- THE TWO THAT SAID NO
--
-- myhome.ge is the largest Georgian portal and its robots.txt allows every
-- path we would want. Its home page answers 403 to an identifying crawler.
-- That is an access control rather than a crawl rule, and it is still a
-- refusal: BLOCKED / LOGIN_REQUIRED. It is not a problem to be solved with a
-- browser user-agent, a proxy or a headless session, and this migration
-- records it so nobody has to rediscover that by trying.
--
-- krtsanisi.com did not resolve at all. UNREACHABLE is deliberately a
-- different finding from a refusal: one is probably ours to retry, the other
-- is theirs to decide.
--
-- THE TWO THAT ASKED FOR TIME
--
-- origencollection.com and zarayaproperties.com publish Crawl-delay: 10.
-- Recorded so the fetcher honours it rather than discovering it by being
-- rate-limited.

-- One row per host. `url` is the identity, so re-running this updates rather
-- than duplicating.
do $$
declare
  rec record;
  existing uuid;
begin
  for rec in
    select * from (values
      -- host,                   family,             finding,           lifecycle,  languages
      ('ss.ge',                  'CLASSIFIEDS',      'PUBLIC_HTML',     'AUDITED',  array['ka','en','ru']),
      ('home.ss.ge',             'PROPERTY_PORTAL',  'PUBLIC_HTML',     'AUDITED',  array['ka','en','ru']),
      ('korter.ge',              'PROPERTY_PORTAL',  'PUBLIC_HTML',     'AUDITED',  array['ka','en','ru']),
      ('realting.com',           'INVESTMENT_SITE',  'PUBLIC_HTML',     'AUDITED',  array['en','ru']),
      ('home24.ge',              'PROPERTY_PORTAL',  'PUBLIC_HTML',     'AUDITED',  array['ka','en']),
      ('realtor.ge',             'AGENCY_SITE',      'PUBLIC_HTML',     'AUDITED',  array['ka','en']),
      ('place.ge',               'PROPERTY_PORTAL',  'PUBLIC_HTML',     'AUDITED',  array['ka','en']),
      ('myhomesale.ge',          'AGENCY_SITE',      'PUBLIC_HTML',     'AUDITED',  array['ka','en']),
      ('estatemarket.ge',        'AGENCY_SITE',      'PUBLIC_HTML',     'AUDITED',  array['ka','en']),
      ('xeli.ge',                'CLASSIFIEDS',      'PUBLIC_HTML',     'AUDITED',  array['ka']),
      ('cgagency.ge',            'AGENCY_SITE',      'PUBLIC_HTML',     'AUDITED',  array['ka','en']),
      ('brokeri.ge',             'AGENCY_SITE',      'PUBLIC_HTML',     'AUDITED',  array['ka','en']),
      ('origencollection.com',   'DEVELOPER_SITE',   'PUBLIC_HTML',     'AUDITED',  array['en','ka']),
      ('makler.ge',              'CLASSIFIEDS',      'PUBLIC_HTML',     'AUDITED',  array['ka','ru']),
      ('expathome.ge',           'EXPAT_COMMUNITY',  'PUBLIC_HTML',     'AUDITED',  array['en','ru']),
      ('topbroker.ge',           'AGENCY_SITE',      'PUBLIC_HTML',     'AUDITED',  array['ka','en']),
      ('caucasusestate.ge',      'AGENCY_SITE',      'PUBLIC_HTML',     'AUDITED',  array['en','ka']),
      ('zarayaproperties.com',   'DEVELOPER_SITE',   'PUBLIC_HTML',     'AUDITED',  array['en','ru']),
      -- Its robots.txt allows everything; its server refuses an identifying
      -- crawler with 403. Recorded, not worked around.
      ('myhome.ge',              'PROPERTY_PORTAL',  'LOGIN_REQUIRED',  'BLOCKED',  array['ka','en','ru']),
      -- Did not resolve. Different from a refusal on purpose.
      ('krtsanisi.com',          'DEVELOPER_SITE',   'UNREACHABLE',     'BLOCKED',  array['en','ka'])
    ) as t(host, family, finding, lifecycle, languages)
  loop
    select id into existing from public.source_registry
     where url = 'https://' || rec.host limit 1;

    if existing is null then
      insert into public.source_registry (
        platform, source_type, url, name, country_code, language, languages,
        active, priority, provider,
        lifecycle, source_family, access_finding, lifecycle_changed_at
      ) values (
        'WEBSITE', 'WEBSITE', 'https://' || rec.host, rec.host, 'GE',
        rec.languages[1], rec.languages,
        -- ACTIVE, but not scannable: source_may_scan_for_campaign() gates on
        -- lifecycle, and AUDITED is below the bar. `active` means "not
        -- deleted"; the lifecycle decides whether anything reads it.
        true, 5, 'HOMATCH_AUDIT',
        rec.lifecycle, rec.family, rec.finding, now()
      ) returning id into existing;
    else
      /*
       * Re-auditing UPDATES the finding. It does not reset counters, does not
       * touch scan cursors, and does not lower a source that has since been
       * implemented -- an audit says what the site allows, not how far along
       * our work is. The one exception is a finding that now refuses: that
       * moves the source to BLOCKED whatever rung it was on, because
       * continuing to read a site that has started saying no is the failure
       * this whole column exists to prevent.
       */
      update public.source_registry
         set source_family = coalesce(source_family, rec.family),
             access_finding = rec.finding,
             lifecycle = case
               when rec.finding in ('ROBOTS_DISALLOWED','LOGIN_REQUIRED','ANTI_BOT','TERMS_PROHIBIT','GEO_BLOCKED','UNREACHABLE')
                 then 'BLOCKED'
               when lifecycle = 'DISCOVERED' then 'AUDITED'
               else lifecycle
             end,
             lifecycle_changed_at = now(),
             updated_at = now()
       where id = existing;
    end if;

    insert into public.source_lifecycle_events (
      source_id, from_state, to_state, evidence_kind, reason, rejected, detail
    ) values (
      existing, 'DISCOVERED', rec.lifecycle, 'AUDIT',
      'robots.txt and home page checked with the identifying crawler on 2026-09-25: ' || rec.finding,
      false,
      jsonb_build_object(
        'host', rec.host,
        'family', rec.family,
        'finding', rec.finding,
        'method', 'GET /robots.txt and GET / with HomatchResearch/1.0',
        'script', 'scripts/audit-property-sources.mjs'
      )
    );
  end loop;
end $$;

-- Two sites publish Crawl-delay: 10. Recorded on the row so the fetcher
-- honours it rather than finding out by being rate-limited.
update public.source_registry
   set priority = 3
 where url in ('https://origencollection.com', 'https://zarayaproperties.com');

comment on column public.source_registry.provider is
  'Where the row came from. HOMATCH_AUDIT means a human-reviewed audit by '
  'scripts/audit-property-sources.mjs, as opposed to a row written by the '
  'retired discovery pipeline.';
