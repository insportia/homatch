-- The FOR EXPATS free layer was completely dark in production, and the
-- policies were not the reason.
--
-- 20260920191136 created eight tables with `for select to anon` policies
-- and never granted anon SELECT on the tables themselves. PostgreSQL checks
-- the GRANT first, so every anonymous read failed with 42501 before RLS was
-- ever consulted. Every policy was correct; the product was invisible to the
-- people it was written for.
--
-- HOW IT WAS FOUND, AND WHY NOTHING ELSE FOUND IT
--
-- By reading production over the REST API with the publishable key, which
-- is exactly what the browser does. Nothing else would have caught it:
--
--   `set local role anon` inside a service-role session does not reproduce
--   it faithfully enough to fail;
--   the in-repo tests assert POLICIES, and every policy was right;
--   the Supabase security advisors look for privileges that are too wide,
--   and this was a privilege that was missing.
--
-- The lesson is narrow and worth keeping: a policy is permission to see
-- rows, a grant is permission to reach the table, and proving the first
-- says nothing about the second.
--
-- SELECT ONLY, AND ONLY WHERE A POLICY ALREADY ALLOWS IT
--
-- The surrounding convention (community_directory, markets) grants anon the
-- full DML set and relies on RLS alone. That works, and it leaves
-- privileges switched on that no policy will ever permit anybody to use.
-- These grants are narrowed to what the policies actually allow: SELECT on
-- the eight published-content tables, and INSERT on the outbound funnel,
-- which is the single place an anonymous visitor may write.
--
-- Nothing is granted on expat_profiles, expat_tasks, expat_reminder_log,
-- expat_provider_research or expat_research_providers. Those hold
-- citizenship, family shape and travel intent, and an anonymous session has
-- no business reaching them at either layer.

grant select on public.expat_topics            to anon;
grant select on public.expat_topic_facts       to anon;
grant select on public.expat_citations         to anon;
grant select on public.expat_fact_citations    to anon;
grant select on public.expat_cost_observations to anon;
grant select on public.expat_places            to anon;
grant select on public.expat_place_ratings     to anon;
grant select on public.expat_updates           to anon;

-- The one write an anonymous visitor may make: recording that they moved
-- towards a provider. The policy already restricts it to rows with a null
-- user_id, and there is no SELECT grant, so the funnel stays write-only.
grant insert on public.expat_outbound_events to anon;
