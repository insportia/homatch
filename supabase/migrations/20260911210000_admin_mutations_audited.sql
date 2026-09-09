-- Homatch — admin mutations that land, and that leave a record.
--
-- WHAT WAS FOUND
--
-- Proven in production as a real admin (is_admin = true), rolled back:
--
--   markets_toggle_rows=0   admin_settings_rows=1   missing_key_rows=0
--
-- (1) THE MARKETS TOGGLE HAS NEVER WORKED.
--
--     public.markets has RLS enabled and exactly one policy: markets_public_read
--     [SELECT]. There is no UPDATE policy for anyone. AdminMarketsPage's switch
--     issues `.from('markets').update({enabled}).eq('id', id)`, which matches
--     zero rows; PostgREST returns 204 with no error, so the page's
--     `if (error)` branch never fires and it shows "Market enabled".
--
--     Which markets are enabled decides where the product operates. Every
--     toggle of that switch, for as long as the page has existed, has been
--     theatre.
--
-- (2) A SETTING THAT DOES NOT EXIST YET CANNOT BE CREATED.
--
--     updateAdminSetting/updatePricingConfig/updateSpendCaps all use UPDATE
--     ... WHERE key = $1. A key with no row matches nothing -- again 204, no
--     error. So a spend cap or a pricing knob that was never seeded silently
--     stays unset while the screen reports it saved.
--
-- (3) NONE OF THEM CHECK ANYTHING.
--
--     Not one of those three helpers inspects the error, let alone the row
--     count. They are `await supabase...update(...)` and return void.
--
-- (4) NOTHING IS AUDITED.
--
--     admin_audit_log has existed since 00033_phase7 and holds ZERO rows.
--     Nothing has ever written to it. The settings these screens change are
--     provider_kill_switch, spend_cap_*, outreach_*_sending_enabled and the
--     credit pricing table -- who turned off the kill switch, and when, is not
--     recorded anywhere.
--
-- WHAT THIS DOES
--
-- Two SECURITY DEFINER functions, in the shape the rest of this codebase
-- already uses for privileged writes. Each one checks that the caller is an
-- admin, performs the write, records it in admin_audit_log with the old and
-- new value, and RETURNS the stored result so the caller can tell the
-- difference between "saved" and "matched nothing".
--
-- Reads are untouched: the admin screens still SELECT directly through the
-- existing admin-only policy.

/* ---------------- settings ---------------- */

create or replace function public.admin_set_setting(
  p_key   text,
  p_value jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid;
  v_old   jsonb;
begin
  if p_key is null or p_value is null then
    raise exception 'INVALID_ARGUMENT';
  end if;

  select u.id into v_admin
    from public.users u
   where u.auth_id = auth.uid() and u.is_admin = true;

  if v_admin is null and auth.role() <> 'service_role' then
    raise exception 'FORBIDDEN';
  end if;

  select s.value into v_old from public.admin_settings s where s.key = p_key;

  -- Upsert, not update. A key that was never seeded used to be an unreported
  -- no-op; creating it is what the admin actually asked for.
  insert into public.admin_settings (key, value, updated_at)
  values (p_key, p_value, now())
  on conflict (key) do update
    set value = excluded.value, updated_at = now();

  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  values (
    coalesce(v_admin, '00000000-0000-0000-0000-000000000000'::uuid),
    'SETTING_UPDATED', 'admin_settings', p_key,
    jsonb_build_object(
      'old', v_old,
      'new', p_value,
      'created', v_old is null,
      'reason', p_reason,
      'actor', case when v_admin is null then 'service_role' else 'admin' end
    )
  );

  return p_value;
end $$;

comment on function public.admin_set_setting(text, jsonb, text) is
  'Admin-only, audited write to admin_settings. Upserts, so a key that was never seeded is created rather than silently skipped.';

revoke all on function public.admin_set_setting(text, jsonb, text) from public, anon;
grant execute on function public.admin_set_setting(text, jsonb, text) to authenticated, service_role;

/* ---------------- markets ---------------- */

create or replace function public.admin_set_market_enabled(
  p_market_id uuid,
  p_enabled   boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid;
  v_old   boolean;
begin
  if p_market_id is null or p_enabled is null then
    raise exception 'INVALID_ARGUMENT';
  end if;

  select u.id into v_admin
    from public.users u
   where u.auth_id = auth.uid() and u.is_admin = true;

  if v_admin is null and auth.role() <> 'service_role' then
    raise exception 'FORBIDDEN';
  end if;

  select m.enabled into v_old from public.markets m where m.id = p_market_id;
  if not found then
    raise exception 'MARKET_NOT_FOUND';
  end if;

  update public.markets set enabled = p_enabled where id = p_market_id;

  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  values (
    coalesce(v_admin, '00000000-0000-0000-0000-000000000000'::uuid),
    case when p_enabled then 'MARKET_ENABLED' else 'MARKET_DISABLED' end,
    'markets', p_market_id::text,
    jsonb_build_object('old', v_old, 'new', p_enabled)
  );

  return p_enabled;
end $$;

comment on function public.admin_set_market_enabled(uuid, boolean) is
  'Admin-only, audited market toggle. public.markets has no UPDATE policy, so the direct write this replaces matched zero rows and reported success.';

revoke all on function public.admin_set_market_enabled(uuid, boolean) from public, anon;
grant execute on function public.admin_set_market_enabled(uuid, boolean) to authenticated, service_role;
