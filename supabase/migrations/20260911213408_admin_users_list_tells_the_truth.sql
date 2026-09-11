-- THE ADMIN USERS PAGE WAS NOT WRONG SO MUCH AS BLIND.
--
-- It read public.users directly and rendered four columns. Against production
-- that is 10 rows — but only THREE of them are people:
--
--   tatochachua@gmail.com          Google, signed in 2026-09-11   (admin)
--   arachemianino70@gmail.com      Google, signed in 2026-09-07
--   giorgi02021993milan@gmail.com  Google, signed in 2026-09-11
--
-- The other seven are CI and smoke-test leftovers (cors.verify*,
-- homatch.smoketest*, hm-e2e-*, hm-ci-*) with a profile row and NO auth user
-- behind them. They cannot sign in, they are not customers, and they were
-- inflating the headline user count by 233%.
--
-- public.users alone cannot tell those apart, because the difference lives in
-- auth.users — which the browser cannot read. So this is a SECURITY DEFINER
-- RPC that joins the two and states, per row, whether a real registration
-- exists behind the profile.
--
-- Nothing is deleted here. Orphaned rows are LABELLED, and what to do about
-- them stays an admin's decision.
--
-- NOTE: the body below is superseded minutes later by
-- 20260911213453_finance_and_admin_users_one_identity.sql, which fixes
-- verify_runs — research_jobs.user_id holds an AUTH id, so it must join on
-- users.auth_id and not on users.id. Read that migration for the current body.

CREATE OR REPLACE FUNCTION public.admin_users_list(
  p_limit integer DEFAULT 200, p_offset integer DEFAULT 0,
  p_include_orphans boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_cpu numeric := public.billing_setting_num('credits_per_usd', 10);
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    raise exception 'FORBIDDEN: admin only';
  end if;

  return jsonb_build_object(
    'credits_per_usd', v_cpu,
    -- The counts an operator actually needs, rather than one raw row count.
    'totals', (select jsonb_build_object(
        'profiles', count(*),
        'registered', count(*) filter (where a.id is not null),
        'orphaned', count(*) filter (where a.id is null),
        'signed_in_ever', count(*) filter (where a.last_sign_in_at is not null),
        'active_30d', count(*) filter (where a.last_sign_in_at >= now() - interval '30 days'),
        'admins', count(*) filter (where u.is_admin))
      from public.users u left join auth.users a on a.id = u.auth_id),
    'rows', COALESCE((select jsonb_agg(r order by (r->>'created_at') desc) from (
      select jsonb_build_object(
        'id', u.id, 'email', u.email, 'full_name', u.full_name,
        'nickname', u.nickname, 'username', u.username, 'phone', u.phone,
        'avatar_url', u.avatar_url, 'plan', COALESCE(u.plan, 'FREE'),
        'is_admin', u.is_admin, 'preferred_language', u.preferred_language,
        'created_at', u.created_at,
        -- THE DISTINCTION THE PAGE WAS MISSING.
        'registered', (a.id is not null),
        'sign_in_provider', a.raw_app_meta_data->>'provider',
        'last_sign_in_at', a.last_sign_in_at,
        'email_confirmed_at', a.email_confirmed_at,
        'auth_created_at', a.created_at,
        -- Credits are CREDITS. The page was printing them with a dollar sign,
        -- which after the 1 Credit = $0.10 redenomination overstated every
        -- balance tenfold.
        'credits_balance', round(COALESCE(ca.balance, 0), 2),
        'credits_reserved', round(COALESCE(ca.reserved, 0), 2),
        'credits_value_usd', round(COALESCE(ca.balance, 0) / v_cpu, 2),
        'properties', COALESCE(p.n, 0),
        'verify_runs', COALESCE(rj.n, 0),
        'paid_usd', round(COALESCE(pay.usd, 0), 2),
        'last_activity_at', greatest(a.last_sign_in_at, rj.last_run, u.updated_at)
      ) as r
      from public.users u
      left join auth.users a on a.id = u.auth_id
      left join public.credit_accounts ca on ca.user_id = u.id
      left join lateral (select count(*) n from public.properties pr
                          where pr.user_id = u.id) p on true
      left join lateral (select count(*) n, max(created_at) last_run
                           from public.research_jobs j where j.user_id = u.id) rj on true
      left join lateral (select sum(public.fx_to_usd(pm.total_cents::numeric/100, pm.currency, pm.created_at)) usd
                           from public.payments pm
                          where pm.user_id = u.id and pm.status = 'COMPLETED') pay on true
      where p_include_orphans or a.id is not null
      order by u.created_at desc
      limit greatest(1, least(p_limit, 1000)) offset greatest(0, p_offset)
    ) q), '[]'::jsonb)
  );
end;
$fn$;

REVOKE ALL ON FUNCTION public.admin_users_list(integer, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_users_list(integer, integer, boolean) TO authenticated, service_role;
