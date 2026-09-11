-- admin_settings holds some values as JSON numbers (5) and some as JSON strings
-- ("250"). value::text::numeric works for the first and raises 22P02 for the
-- second, because the cast sees the quotes. Ten of the live spend caps are
-- stored as strings, so any caller reading one would have failed outright.
--
-- Found by finance_evaluate_alerts(), whose budget-drift check reads
-- spend_cap_global: "invalid input syntax for type numeric: "250"".
--
-- #>> '{}' extracts a JSON scalar as plain text whatever its type. The regex
-- guard means a non-numeric setting returns the default rather than raising,
-- which matters because these readers are on the live billing path.

CREATE OR REPLACE FUNCTION public.billing_setting_num(p_key text, p_default numeric)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT COALESCE((
    SELECT CASE
      WHEN (s.value #>> '{}') ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$'
      THEN trim(s.value #>> '{}')::numeric
    END
    FROM public.admin_settings s WHERE s.key = p_key
  ), p_default);
$fn$;

CREATE OR REPLACE FUNCTION public.billing_setting_bool(p_key text, p_default boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT COALESCE((
    SELECT CASE lower(trim(s.value #>> '{}'))
      WHEN 'true' THEN true WHEN 't' THEN true WHEN '1' THEN true WHEN 'yes' THEN true
      WHEN 'false' THEN false WHEN 'f' THEN false WHEN '0' THEN false WHEN 'no' THEN false
    END
    FROM public.admin_settings s WHERE s.key = p_key
  ), p_default);
$fn$;
