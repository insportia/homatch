-- ============================================================================
-- OWNER UNLIMITED + ADMIN ACCESS GRANTS (2/2): audited admin RPCs.
--
-- Admin → Money → User access ("მომხმარებლების წვდომები", /admin/access).
-- Every write: admin only (saas_admin_actor), reason required, advisory lock per
-- target, a saas_access_events row (actor, target, previous, new, reason, time,
-- expiry) AND an admin_audit_log SAAS_ACCESS_* row (old/new/reason).
--
-- Guards:
--   * nobody grants, modifies or revokes their OWN access (FORBIDDEN_SELF);
--   * the owner's entitlement is not a grant: it cannot be granted, modified,
--     revoked or reset here (OWNER_PROTECTED), and platform_owner itself refuses
--     update / delete / truncate;
--   * access for another ADMIN account can be changed only by the owner (or the
--     service role): admins cannot raise each other;
--   * revoke needs the literal confirmation 'REVOKE';
--   * a temporary grant expires at most 10 years ahead and at least 5 minutes ahead.
-- ============================================================================

create or replace function public.saas_access_guard(p_actor uuid, p_target uuid)
returns void language plpgsql stable security definer set search_path to '' as $$
declare v_target_admin boolean;
begin
  if p_target is null then raise exception 'USER_NOT_FOUND'; end if;
  select u.is_admin into v_target_admin from public.users u where u.id = p_target;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  if p_actor = p_target then raise exception 'FORBIDDEN_SELF' using errcode = 'insufficient_privilege'; end if;
  if public.saas_is_owner(p_target) then raise exception 'OWNER_PROTECTED' using errcode = 'insufficient_privilege'; end if;
  if coalesce(v_target_admin, false)
     and not public.saas_is_owner(p_actor)
     and p_actor <> '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'OWNER_ONLY' using errcode = 'insufficient_privilege';
  end if;
end $$;

-- A grant with its allowance rows and, per row, the live window's usage.
create or replace function public.saas_access_grant_json(p_grant_id uuid)
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_object(
    'id', g.id, 'userId', g.user_id, 'kind', g.kind, 'planCode', g.plan_code, 'status', g.status,
    'live', g.status = 'ACTIVE' and g.starts_at <= now() and (g.expires_at is null or g.expires_at > now()),
    'expired', g.expires_at is not null and g.expires_at <= now(),
    'startsAt', g.starts_at, 'expiresAt', g.expires_at, 'permanent', g.expires_at is null,
    'reason', g.reason, 'createdBy', g.created_by, 'createdAt', g.created_at,
    'updatedBy', g.updated_by, 'updatedAt', g.updated_at,
    'revokedBy', g.revoked_by, 'revokedAt', g.revoked_at, 'revokeReason', g.revoke_reason,
    'allowances', coalesce((
      select jsonb_agg(jsonb_build_object(
               'feature', a.feature, 'unlimited', a.unlimited, 'limit', a.limit_count, 'period', a.period,
               'countedSince', a.counted_since, 'windowStart', w.ws, 'used', w.used,
               'remaining', case when a.unlimited then null else greatest(a.limit_count - w.used, 0) end)
             order by f.sort_order)
        from public.saas_access_grant_allowances a
        join public.saas_features f on f.feature = a.feature
        cross join lateral (
          select x.ws, (select count(*)::integer from public.saas_usage u
                         where u.grant_id = a.grant_id and u.feature = a.feature and u.funding = 'GRANT'
                           and u.period_start = x.ws and u.state in ('RESERVED', 'COMMITTED')) as used
            from (select case when a.period = 'MONTHLY'
                              then greatest(a.counted_since, public.saas_grant_period_start(g.starts_at, now()))
                              else a.counted_since end as ws) x) w
       where a.grant_id = g.id), '[]'::jsonb))
  from public.saas_access_grants g where g.id = p_grant_id
$$;

create or replace function public.saas_access_log(p_actor uuid, p_target uuid, p_grant uuid, p_action text,
                                                  p_old jsonb, p_new jsonb, p_reason text, p_expires timestamptz)
returns void language plpgsql security definer set search_path to '' as $$
begin
  insert into public.saas_access_events (grant_id, target_user_id, actor_id, action, previous, new, reason, expires_at)
  values (p_grant, p_target, p_actor, p_action, p_old, p_new, btrim(p_reason), p_expires);
  perform public.saas_audit(p_actor, 'SAAS_ACCESS_' || p_action, 'saas_access_grants', p_grant::text, p_old, p_new, p_reason, p_target);
end $$;

create or replace function public.saas_access_check_expiry(p_expires timestamptz)
returns void language plpgsql stable set search_path to '' as $$
begin
  if p_expires is not null and (p_expires < now() + interval '5 minutes' or p_expires > now() + interval '10 years') then
    raise exception 'INVALID_EXPIRY';
  end if;
end $$;

-- Validate and write allowance rows from [{feature, unlimited, limit, period, remove}].
create or replace function public.saas_access_apply_allowances(p_grant_id uuid, p_allowances jsonb)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_item jsonb;
  v_f public.saas_features;
  v_unl boolean;
  v_limit integer;
  v_period text;
begin
  if p_allowances is null then return; end if;
  if jsonb_typeof(p_allowances) <> 'array' then raise exception 'INVALID_ALLOWANCES'; end if;
  for v_item in select * from jsonb_array_elements(p_allowances) loop
    select * into v_f from public.saas_features where feature = v_item->>'feature';
    if not found then raise exception 'FEATURE_UNKNOWN'; end if;
    if coalesce((v_item->>'remove')::boolean, false) then
      delete from public.saas_access_grant_allowances where grant_id = p_grant_id and feature = v_f.feature;
      continue;
    end if;
    v_unl := coalesce((v_item->>'unlimited')::boolean, false);
    v_limit := case when v_unl then null else (v_item->>'limit')::integer end;
    v_period := coalesce(v_item->>'period', 'TOTAL');
    if v_f.kind = 'BOOLEAN' and not v_unl then raise exception 'BOOLEAN_FEATURE_IS_ON_OR_OFF'; end if;
    if not v_unl and (v_limit is null or v_limit < 0 or v_limit > 100000) then raise exception 'INVALID_LIMIT'; end if;
    if v_period not in ('TOTAL', 'MONTHLY') then raise exception 'INVALID_PERIOD'; end if;
    insert into public.saas_access_grant_allowances (grant_id, feature, unlimited, limit_count, period)
    values (p_grant_id, v_f.feature, v_unl, v_limit, v_period)
    on conflict (grant_id, feature) do update
      set unlimited = excluded.unlimited, limit_count = excluded.limit_count, period = excluded.period, updated_at = now();
  end loop;
end $$;

-- ── Grant ───────────────────────────────────────────────────────────────────
create or replace function public.admin_access_grant(p_user_id uuid, p_kind text, p_plan_code text,
                                                     p_allowances jsonb, p_expires_at timestamptz, p_reason text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_admin uuid := public.saas_admin_actor();
  v_g public.saas_access_grants;
  v_new jsonb;
begin
  perform public.saas_require_reason(p_reason);
  perform public.saas_access_guard(v_admin, p_user_id);
  perform public.saas_access_check_expiry(p_expires_at);
  if p_kind not in ('UNLIMITED', 'PLAN', 'CUSTOM') then raise exception 'INVALID_KIND'; end if;
  if p_kind = 'PLAN' and not exists (select 1 from public.saas_plans where code = p_plan_code) then raise exception 'PLAN_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('saas_access:' || p_user_id::text, 0));

  insert into public.saas_access_grants (user_id, kind, plan_code, expires_at, reason, created_by)
  values (p_user_id, p_kind, case when p_kind = 'PLAN' then p_plan_code end, p_expires_at, btrim(p_reason), v_admin)
  returning * into v_g;

  if p_kind = 'UNLIMITED' then
    insert into public.saas_access_grant_allowances (grant_id, feature, unlimited, limit_count, period)
    select v_g.id, f.feature, true, null, 'TOTAL' from public.saas_features f where f.internal_included;
  elsif p_kind = 'PLAN' then
    -- A snapshot of the plan's allowances at grant time, counted per month from the grant start.
    insert into public.saas_access_grant_allowances (grant_id, feature, unlimited, limit_count, period)
    select v_g.id, e.feature, e.unlimited or f.kind = 'BOOLEAN',
           case when e.unlimited or f.kind = 'BOOLEAN' then null else e.limit_per_period end, 'MONTHLY'
      from public.saas_plan_entitlements e join public.saas_features f on f.feature = e.feature
     where e.plan_code = p_plan_code and e.enabled and (e.unlimited or f.kind = 'BOOLEAN' or coalesce(e.limit_per_period, 0) > 0);
  else
    if p_allowances is null or jsonb_typeof(p_allowances) <> 'array' or jsonb_array_length(p_allowances) = 0 then
      raise exception 'ALLOWANCES_REQUIRED';
    end if;
    perform public.saas_access_apply_allowances(v_g.id, p_allowances);
  end if;

  v_new := public.saas_access_grant_json(v_g.id);
  perform public.saas_access_log(v_admin, p_user_id, v_g.id, 'GRANTED', null, v_new, p_reason, p_expires_at);
  return v_new;
end $$;

-- ── Modify: expiry and / or allowances ─────────────────────────────────────
-- p_expiry_mode: KEEP | PERMANENT | DATE (p_expires_at).
create or replace function public.admin_access_grant_update(p_grant_id uuid, p_expiry_mode text, p_expires_at timestamptz,
                                                            p_allowances jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_admin uuid := public.saas_admin_actor();
  v_g public.saas_access_grants;
  v_old jsonb;
  v_new jsonb;
begin
  perform public.saas_require_reason(p_reason);
  select * into v_g from public.saas_access_grants where id = p_grant_id;
  if not found then raise exception 'GRANT_NOT_FOUND'; end if;
  perform public.saas_access_guard(v_admin, v_g.user_id);
  perform pg_advisory_xact_lock(hashtextextended('saas_access:' || v_g.user_id::text, 0));
  select * into v_g from public.saas_access_grants where id = p_grant_id for update;
  if v_g.status <> 'ACTIVE' then raise exception 'GRANT_REVOKED'; end if;
  if coalesce(p_expiry_mode, 'KEEP') not in ('KEEP', 'PERMANENT', 'DATE') then raise exception 'INVALID_EXPIRY'; end if;
  if p_expiry_mode = 'DATE' then
    if p_expires_at is null then raise exception 'INVALID_EXPIRY'; end if;
    perform public.saas_access_check_expiry(p_expires_at);
  end if;
  v_old := public.saas_access_grant_json(p_grant_id);

  update public.saas_access_grants
     set expires_at = case coalesce(p_expiry_mode, 'KEEP') when 'PERMANENT' then null when 'DATE' then p_expires_at else expires_at end,
         -- An admin editing allowances turns a plan / unlimited grant into a custom one: the label never lies.
         kind = case when p_allowances is not null and jsonb_array_length(p_allowances) > 0 then 'CUSTOM' else kind end,
         plan_code = case when p_allowances is not null and jsonb_array_length(p_allowances) > 0 then null else plan_code end,
         updated_by = v_admin, updated_at = now()
   where id = p_grant_id returning * into v_g;
  perform public.saas_access_apply_allowances(p_grant_id, p_allowances);
  if not exists (select 1 from public.saas_access_grant_allowances where grant_id = p_grant_id) then
    raise exception 'ALLOWANCES_REQUIRED';
  end if;

  v_new := public.saas_access_grant_json(p_grant_id);
  perform public.saas_access_log(v_admin, v_g.user_id, p_grant_id, 'MODIFIED', v_old, v_new, p_reason, v_g.expires_at);
  return v_new;
end $$;

-- ── Revoke (explicit confirmation) ──────────────────────────────────────────
create or replace function public.admin_access_grant_revoke(p_grant_id uuid, p_reason text, p_confirm text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_admin uuid := public.saas_admin_actor();
  v_g public.saas_access_grants;
  v_old jsonb;
  v_new jsonb;
begin
  perform public.saas_require_reason(p_reason);
  if coalesce(p_confirm, '') <> 'REVOKE' then raise exception 'CONFIRMATION_REQUIRED'; end if;
  select * into v_g from public.saas_access_grants where id = p_grant_id;
  if not found then raise exception 'GRANT_NOT_FOUND'; end if;
  perform public.saas_access_guard(v_admin, v_g.user_id);
  perform pg_advisory_xact_lock(hashtextextended('saas_access:' || v_g.user_id::text, 0));
  select * into v_g from public.saas_access_grants where id = p_grant_id for update;
  if v_g.status = 'REVOKED' then return public.saas_access_grant_json(p_grant_id) || jsonb_build_object('duplicate', true); end if;
  v_old := public.saas_access_grant_json(p_grant_id);
  update public.saas_access_grants
     set status = 'REVOKED', revoked_by = v_admin, revoked_at = now(), revoke_reason = btrim(p_reason),
         updated_by = v_admin, updated_at = now()
   where id = p_grant_id;
  v_new := public.saas_access_grant_json(p_grant_id);
  perform public.saas_access_log(v_admin, v_g.user_id, p_grant_id, 'REVOKED', v_old, v_new, p_reason, v_g.expires_at);
  return v_new;
end $$;

-- ── Reset a grant's counters (one feature, or all when p_feature is null) ───
create or replace function public.admin_access_allowance_reset(p_grant_id uuid, p_feature text, p_reason text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_admin uuid := public.saas_admin_actor();
  v_g public.saas_access_grants;
  v_old jsonb;
  v_new jsonb;
begin
  perform public.saas_require_reason(p_reason);
  select * into v_g from public.saas_access_grants where id = p_grant_id;
  if not found then raise exception 'GRANT_NOT_FOUND'; end if;
  perform public.saas_access_guard(v_admin, v_g.user_id);
  perform pg_advisory_xact_lock(hashtextextended('saas_access:' || v_g.user_id::text, 0));
  if v_g.status <> 'ACTIVE' then raise exception 'GRANT_REVOKED'; end if;
  v_old := public.saas_access_grant_json(p_grant_id);
  update public.saas_access_grant_allowances set counted_since = clock_timestamp(), updated_at = now()
   where grant_id = p_grant_id and (p_feature is null or feature = p_feature);
  if not found then raise exception 'FEATURE_NOT_IN_GRANT'; end if;
  v_new := public.saas_access_grant_json(p_grant_id);
  perform public.saas_access_log(v_admin, v_g.user_id, p_grant_id, 'ALLOWANCE_RESET', v_old, v_new, p_reason, v_g.expires_at);
  return v_new;
end $$;

-- ── Read: search and one account ────────────────────────────────────────────
create or replace function public.admin_access_users(p_search text default null, p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform public.saas_admin_actor();
  return coalesce((select jsonb_agg(r) from (
    select u.id, u.email, u.full_name as "fullName", u.username, u.is_admin as "isAdmin",
           public.saas_is_owner(u.id) as owner, u.suspended_at is not null as suspended, u.created_at as "createdAt",
           (select s.plan_code from public.saas_live_subscription(u.id) s) as plan,
           (select count(*)::integer from public.saas_access_grants g where g.user_id = u.id and g.status = 'ACTIVE'
               and g.starts_at <= now() and (g.expires_at is null or g.expires_at > now())) as "activeGrants",
           public.saas_is_owner(u.id) or exists (select 1 from public.saas_access_grants g where g.user_id = u.id and g.kind = 'UNLIMITED'
               and g.status = 'ACTIVE' and g.starts_at <= now() and (g.expires_at is null or g.expires_at > now())) as unlimited
      from public.users u
     where v_q is null or u.email ilike '%' || v_q || '%' or u.full_name ilike '%' || v_q || '%'
        or u.username ilike '%' || v_q || '%' or u.id::text = v_q
     order by public.saas_is_owner(u.id) desc, u.is_admin desc, u.created_at desc
     limit least(greatest(coalesce(p_limit, 30), 1), 100)) r), '[]'::jsonb);
end $$;

create or replace function public.admin_access_user(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_admin uuid := public.saas_admin_actor();
  v_u record;
begin
  select u.id, u.email, u.full_name, u.username, u.is_admin, u.account_type, u.suspended_at, u.created_at,
         a.email_confirmed_at, a.phone_confirmed_at
    into v_u
    from public.users u left join auth.users a on a.id = u.auth_id where u.id = p_user_id;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  return jsonb_build_object(
    'user', jsonb_build_object('id', v_u.id, 'email', v_u.email, 'fullName', v_u.full_name, 'username', v_u.username,
              'isAdmin', v_u.is_admin, 'owner', public.saas_is_owner(v_u.id), 'accountType', v_u.account_type,
              'suspended', v_u.suspended_at is not null, 'createdAt', v_u.created_at,
              'verified', v_u.email_confirmed_at is not null or v_u.phone_confirmed_at is not null),
    -- What the viewer may do to this account (the server re-checks on every write).
    'manageable', v_admin <> v_u.id and not public.saas_is_owner(v_u.id)
                  and (not coalesce(v_u.is_admin, false) or public.saas_is_owner(v_admin)
                       or v_admin = '00000000-0000-0000-0000-000000000000'::uuid),
    'status', public.saas_entitlement_status(v_u.id),
    'grants', coalesce((select jsonb_agg(public.saas_access_grant_json(g.id) order by g.created_at desc)
                          from public.saas_access_grants g where g.user_id = v_u.id), '[]'::jsonb),
    'usage', coalesce((select jsonb_agg(x order by x."reservedAt" desc) from (
                select u.id, u.feature, u.funding, u.state, u.plan_code as "planCode", u.grant_id as "grantId",
                       u.job_ref as "jobRef", u.reserved_at as "reservedAt", u.committed_at as "committedAt",
                       u.released_at as "releasedAt", u.release_reason as "releaseReason", u.over_allowance as "overAllowance"
                  from public.saas_usage u where u.user_id = v_u.id order by u.reserved_at desc limit 60) x), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(x order by x."createdAt" desc) from (
                select e.id, e.grant_id as "grantId", e.action, e.actor_id as "actorId",
                       (select a.email from public.users a where a.id = e.actor_id) as "actorEmail",
                       e.previous, e.new, e.reason, e.expires_at as "expiresAt", e.created_at as "createdAt"
                  from public.saas_access_events e where e.target_user_id = v_u.id order by e.created_at desc limit 60) x), '[]'::jsonb),
    'legacyBalance', coalesce((select ca.balance from public.credit_accounts ca where ca.user_id = v_u.id), 0));
end $$;

-- ── Grants ──────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'saas_access_guard(uuid, uuid)', 'saas_access_grant_json(uuid)',
    'saas_access_log(uuid, uuid, uuid, text, jsonb, jsonb, text, timestamptz)',
    'saas_access_check_expiry(timestamptz)', 'saas_access_apply_allowances(uuid, jsonb)',
    'admin_access_grant(uuid, text, text, jsonb, timestamptz, text)',
    'admin_access_grant_update(uuid, text, timestamptz, jsonb, text)',
    'admin_access_grant_revoke(uuid, text, text)', 'admin_access_allowance_reset(uuid, text, text)',
    'admin_access_users(text, integer)', 'admin_access_user(uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Customers call nothing here; admins reach these through PostgREST and the server re-checks.
grant execute on function public.admin_access_grant(uuid, text, text, jsonb, timestamptz, text) to authenticated;
grant execute on function public.admin_access_grant_update(uuid, text, timestamptz, jsonb, text) to authenticated;
grant execute on function public.admin_access_grant_revoke(uuid, text, text) to authenticated;
grant execute on function public.admin_access_allowance_reset(uuid, text, text) to authenticated;
grant execute on function public.admin_access_users(text, integer) to authenticated;
grant execute on function public.admin_access_user(uuid) to authenticated;
