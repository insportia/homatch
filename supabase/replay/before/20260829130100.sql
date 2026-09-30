-- Needed by 20260829130100_secure_internal_helper_functions.sql, which alters
-- and revokes these functions before any repository migration creates them.

-- declared for real by 20260905222421 (replaces this stub)
create or replace function public.increment_source_failure(p_source_id uuid)
returns void language sql as $$ select null::void $$;

-- production-only: a Supabase-created event-trigger function, never declared
-- by a repository migration
create or replace function public.rls_auto_enable()
returns event_trigger language plpgsql as $$ begin return; end $$;
