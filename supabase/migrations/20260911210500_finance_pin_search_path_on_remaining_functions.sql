-- Supabase's linter flagged two functions this work added without a pinned
-- search_path. Both are reachable from a trigger or from SECURITY DEFINER
-- callers, so an attacker-controlled search_path is exactly the shape of
-- privilege escalation the lint exists to catch. Pin them.
--
-- (touch_provider_price_book and touch_intelligence_row carry the same lint
-- but predate this work and belong to other features; they are left alone
-- rather than changed as a drive-by.)

CREATE OR REPLACE FUNCTION public.finance_monthly_equivalent_cents(
  p_amount_cents integer, p_frequency text
) RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT CASE p_frequency
    WHEN 'MONTHLY'   THEN p_amount_cents::numeric
    WHEN 'QUARTERLY' THEN p_amount_cents::numeric / 3
    WHEN 'ANNUAL'    THEN p_amount_cents::numeric / 12
    ELSE 0  -- ONE_OFF has no monthly equivalent; it lands in its own month.
  END;
$fn$;

CREATE OR REPLACE FUNCTION public.finance_provider_registry_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
begin
  new.updated_at := now();
  if new.credential_env_var is not null and (
       length(new.credential_env_var) > 64
       or new.credential_env_var !~ '^[A-Z][A-Z0-9_]*$') then
    raise exception 'credential_env_var must be an ENV VAR NAME, never a secret value';
  end if;
  return new;
end;
$fn$;
