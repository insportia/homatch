-- Homatch — remove TRUNCATE / REFERENCES / TRIGGER from the client roles.
--
-- WHAT WAS FOUND
--
-- `authenticated` (and `anon`) hold TRUNCATE on 79 tables in `public`. That is
-- the standard Supabase bootstrap grant — `grant all privileges on all tables
-- in schema public to anon, authenticated` — and it is almost always left
-- as-is.
--
-- It matters here because TRUNCATE is NOT subject to row level security.
-- Policies apply to SELECT/INSERT/UPDATE/DELETE; TRUNCATE is gated purely by
-- the privilege. Verified against production inside a rolled-back
-- transaction, on an empty table with no inbound foreign key:
--
--     set local role authenticated;
--     truncate table public.renovation_price_observations;   -- SUCCEEDED
--
-- while the same role's DELETE on research_jobs correctly affected 0 rows,
-- because RLS does govern DELETE.
--
-- HONEST SEVERITY: LATENT, NOT LIVE.
--
-- There is no reachable exploit today. PostgREST only ever issues
-- SELECT/INSERT/UPDATE/DELETE and RPC calls — it never emits TRUNCATE — and
-- an audit of every function `authenticated` may execute found none that
-- evaluates dynamic SQL. A customer holds a JWT, not a SQL channel.
--
-- It is fixed anyway because the gap between "not currently reachable" and
-- "catastrophic when reachable" is one future feature: any RPC that builds
-- SQL from input, any admin tool that runs a query as the caller's role, any
-- direct-connection integration using the client role. The blast radius is
-- every row in the table, RLS notwithstanding, and the fix costs nothing.
--
-- WHAT IS DELIBERATELY NOT CHANGED
--
--   * SELECT/INSERT/UPDATE/DELETE keep their grants — those are the ones RLS
--     actually governs, and narrowing them is per-table product work (see
--     20260911090000 for research_jobs), not a blanket sweep.
--   * No policy is added, removed or weakened here.
--   * service_role and postgres are untouched; migrations, Edge Functions and
--     operator tooling keep working exactly as before.
--
-- Idempotent: REVOKE of a privilege that is already absent is a no-op.

do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select c.relname
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      -- tables, partitioned tables, and views/matviews. TRUNCATE on a view
      -- errors anyway, so those grants are inert -- but leaving them behind
      -- means "no client role holds TRUNCATE in public" is not a checkable
      -- invariant, and the security test below asserts exactly that.
      and c.relkind in ('r','p','v','m')
  loop
    execute format(
      'revoke truncate, references, trigger on public.%I from anon, authenticated',
      r.relname
    );
    n := n + 1;
  end loop;
  raise notice 'revoked truncate/references/trigger on % tables', n;
end $$;

-- Future tables must not re-acquire it. Supabase's bootstrap default
-- privileges are owned by `postgres`, so the matching default is amended
-- rather than a new one being introduced.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;
