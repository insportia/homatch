-- HOMATCH Admin control centre, part 1 — finding things.
--
-- WHY THIS EXISTS
--
-- The Admin could list the newest two hundred users and the newest two hundred
-- properties and then filter those in the browser. Anything older than the
-- two-hundredth row did not exist as far as an operator could tell, and the
-- one server-side search there was (admin-user360 search_users) interpolated
-- the typed text straight into a PostgREST .or() filter, so a comma or a
-- parenthesis in the box rewrote the query.
--
-- So the finding moves to the database, behind functions that:
--
--   * refuse anybody who is not an administrator, IN SQL. A hidden button is
--     not authorisation; these raise 42501 for every caller for whom
--     public.is_admin() is false, whatever screen they came from;
--   * take the typed text as a VALUE and never as query syntax — LIKE
--     wildcards in it are escaped, so "50%" means fifty-percent and "_" is an
--     underscore;
--   * return shaped rows, never whole records: a phone number is reported as
--     present or absent and is only read back through a separate, audited
--     reveal.
--
-- Every function here is SECURITY DEFINER with a pinned search_path, revoked
-- from PUBLIC and anon, and granted to authenticated only — so an anonymous
-- caller cannot reach even the guard.
--
-- Idempotent: create-or-replace and if-not-exists throughout.

-- ── indexes the lookups lean on ─────────────────────────────────────────
-- users.email had no index at all; exact lookups by email are the most
-- common thing an operator types.
create index if not exists users_email_lower_idx on public.users (lower(email));
create index if not exists admin_audit_log_action_idx on public.admin_audit_log (action, created_at desc);
create index if not exists properties_created_idx on public.properties (created_at desc);
create index if not exists property_facts_district_idx on public.property_facts (district);

-- ── helpers (not callable by clients) ───────────────────────────────────

/* The typed text as a LIKE operand that matches itself, not a pattern. */
create or replace function public.homatch_ilike_escape(p text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select replace(replace(replace(coalesce(p, ''), '\', '\\'), '%', '\%'), '_', '\_');
$$;

revoke all on function public.homatch_ilike_escape(text) from public, anon, authenticated;

/*
 * Metadata as an operator may read it.
 *
 * Audit metadata is written by many hands, and one of them (admin-user360)
 * spread the whole request body into it. Any key that names a credential or a
 * contact detail is replaced, at any depth, before it leaves the database.
 */
create or replace function public.homatch_redact_json(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  k text;
  v jsonb;
  out jsonb;
begin
  if p is null then return null; end if;
  if jsonb_typeof(p) = 'object' then
    out := '{}'::jsonb;
    for k, v in select key, value from jsonb_each(p) loop
      if k ~* '(token|secret|password|passwd|authorization|cookie|api[_-]?key|refresh|jwt|otp|hashed|phone|e164|body|message_text|original_text)' then
        out := out || jsonb_build_object(k, '[redacted]');
      else
        out := out || jsonb_build_object(k, public.homatch_redact_json(v));
      end if;
    end loop;
    return out;
  elsif jsonb_typeof(p) = 'array' then
    return coalesce((select jsonb_agg(public.homatch_redact_json(e)) from jsonb_array_elements(p) e), '[]'::jsonb);
  end if;
  return p;
end $$;

revoke all on function public.homatch_redact_json(jsonb) from public, anon, authenticated;

/* A user as an admin list shows them: who, never how to reach them. */
create or replace function public.homatch_user_brief(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when u.id is null then null else jsonb_build_object(
    'id', u.id, 'email', u.email, 'full_name', u.full_name, 'username', u.username,
    'is_admin', coalesce(u.is_admin, false)) end
  from (select 1) one left join public.users u on u.id = p_user_id;
$$;

revoke all on function public.homatch_user_brief(uuid) from public, anon, authenticated;

-- ── 1. Overview counts ──────────────────────────────────────────────────
/*
 * Every number on the Admin front door, in one read.
 *
 * Only counts that are true by construction: a row either exists or it does
 * not. Nothing here is estimated, sampled or defaulted, and a section whose
 * source table is empty reports zero rather than being hidden.
 */
create or replace function public.admin_overview_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cpu numeric := 10;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = '42501';
  end if;

  begin
    v_cpu := public.billing_setting_num('credits_per_usd', 10);
  exception when undefined_function then v_cpu := 10;
  end;

  return jsonb_build_object(
    'generated_at', now(),
    'users', (select jsonb_build_object(
        'total', count(*),
        'registered', count(*) filter (where a.id is not null),
        'admins', count(*) filter (where u.is_admin),
        'new_7d', count(*) filter (where u.created_at >= now() - interval '7 days'))
      from public.users u left join auth.users a on a.id = u.auth_id),
    'properties', (select jsonb_build_object(
        'total', count(*) filter (where not coalesce(p.is_deleted, false)),
        'active', count(*) filter (where not coalesce(p.is_deleted, false) and p.archived_at is null and p.matching_status = 'ACTIVE'),
        'archived', count(*) filter (where not coalesce(p.is_deleted, false) and p.archived_at is not null),
        'with_reference', count(*) filter (where p.homatch_id is not null and not coalesce(p.is_deleted, false)))
      from public.properties p),
    'intelligence', (select jsonb_build_object(
        'signals', count(*),
        'active', count(*) filter (where s.withdrawn_at is null and s.superseded_by is null),
        'last_24h', count(*) filter (where s.created_at >= now() - interval '24 hours'))
      from public.intent_signals s),
    'effective_demands', (select count(*) from public.active_search_subscriptions x where x.is_active),
    'matches', (select jsonb_build_object(
        'internal', count(*) filter (where m.source_kind = 'INTERNAL_HOMATCH'),
        'internal_compatible', count(*) filter (where m.source_kind = 'INTERNAL_HOMATCH' and m.compatibility = 'COMPATIBLE'),
        'external', count(*) filter (where m.source_kind = 'EXTERNAL_INTELLIGENCE'),
        'legacy', (select count(*) from public.matches))
      from public.supply_matches m),
    'notifications', (select jsonb_build_object(
        'total', count(*),
        'unread', count(*) filter (where not n.read),
        'last_24h', count(*) filter (where n.created_at >= now() - interval '24 hours'),
        'pushed', count(*) filter (where n.pushed_at is not null))
      from public.notifications n),
    'announcements', (select jsonb_build_object(
        'draft', count(*) filter (where a.published_at is null),
        'published', count(*) filter (where a.published_at is not null))
      from public.announcements a),
    'campaigns', (select jsonb_build_object(
        'total', count(*),
        'active', count(*) filter (where coalesce(c.status_v2, c.status)::text = 'ACTIVE'),
        'paused', count(*) filter (where coalesce(c.status_v2, c.status)::text in ('PAUSED', 'LOW_BALANCE')))
      from public.matching_campaigns c),
    'billing', (select jsonb_build_object(
        'credits_per_usd', v_cpu,
        'wallet_balance_credits', round(coalesce(sum(ca.balance), 0), 2),
        'wallet_reserved_credits', round(coalesce(sum(ca.reserved), 0), 2),
        'payments_completed_30d', (select count(*) from public.payments pm
                                    where pm.status::text = 'COMPLETED' and pm.created_at >= now() - interval '30 days'))
      from public.credit_accounts ca),
    'providers', (select jsonb_build_object(
        'total', count(*),
        'by_status', coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb))
      from (select coalesce(ph.status, 'UNKNOWN') status, count(*) n from public.provider_health ph group by 1) s),
    'health', (select jsonb_build_object(
        'last_checked_at', h.checked_at,
        'db_reachable', h.db_reachable,
        'storage_reachable', h.storage_reachable,
        'last_match_run_at', h.last_match_run_at,
        'last_match_run_ok', h.last_match_run_ok)
      from (select 1) one left join lateral (
        select * from public.system_health_log order by checked_at desc limit 1) h on true),
    'impersonation', jsonb_build_object(
        'enabled', coalesce((select s.value in ('true'::jsonb, '"true"'::jsonb)
                              from public.admin_settings s where s.key = 'admin_impersonation_enabled'), false),
        'active_sessions', (select count(*) from public.impersonation_sessions i where i.ended_at is null)),
    'audit', jsonb_build_object(
        'last_24h', (select count(*) from public.admin_audit_log l where l.created_at >= now() - interval '24 hours'))
  );
end $$;

revoke all on function public.admin_overview_counts() from public, anon;
grant execute on function public.admin_overview_counts() to authenticated;

-- ── 2. User search ──────────────────────────────────────────────────────
/*
 * One box, every way an operator knows somebody.
 *
 *   a user id or auth id      exact
 *   a six-digit property ref  -> that property's owner
 *   an email                  exact first, then contained
 *   @username                 exact
 *   a phone number            digits, six or more, anywhere in the stored number
 *   a name                    contained, case-insensitive
 *
 * A phone is SEARCHED but not RETURNED: the row carries the last three digits
 * so the operator can confirm they found the right person, and nothing more.
 */
create or replace function public.admin_search_users(p_query text, p_limit integer default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  q        text := btrim(coalesce(p_query, ''));
  v_like   text;
  v_digits text;
  v_uuid   uuid;
  v_ref    integer;
  v_lim    integer := greatest(1, least(coalesce(p_limit, 25), 100));
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = '42501';
  end if;

  if length(q) < 2 then return '[]'::jsonb; end if;

  if q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_uuid := q::uuid;
  end if;
  if q ~ '^#?[0-9]{6}$' then
    v_ref := ltrim(q, '#')::integer;
  end if;
  v_digits := regexp_replace(q, '[^0-9]', '', 'g');
  v_like := '%' || public.homatch_ilike_escape(lower(q)) || '%';

  return coalesce((
    with hits as (
      select u.id, 1 as rank, 'USER_ID'::text as reason, null::integer as ref
        from public.users u
       where v_uuid is not null and (u.id = v_uuid or u.auth_id = v_uuid)
      union all
      select p.user_id, 1, 'PROPERTY_REFERENCE', p.homatch_id
        from public.properties p
       where v_ref is not null and p.homatch_id = v_ref
      union all
      select u.id, 2, 'EMAIL', null
        from public.users u
       where lower(u.email) = lower(q)
      union all
      select u.id, 3, 'USERNAME', null
        from public.users u
       where u.username is not null and lower(u.username) = lower(ltrim(q, '@'))
      union all
      select u.id, 4, 'PHONE', null
        from public.users u
       where length(v_digits) >= 6 and length(v_digits) >= length(q) - 4
         and u.phone is not null
         and regexp_replace(u.phone, '[^0-9]', '', 'g') like '%' || v_digits || '%'
      union all
      select u.id, 5, 'TEXT', null
        from public.users u
       where v_uuid is null and (
             lower(coalesce(u.email, ''))     like v_like escape '\'
          or lower(coalesce(u.full_name, '')) like v_like escape '\'
          or lower(coalesce(u.nickname, ''))  like v_like escape '\'
          or lower(coalesce(u.username, ''))  like v_like escape '\')
    ),
    best as (
      select distinct on (h.id) h.id, h.rank, h.reason, h.ref
        from hits h where h.id is not null
       order by h.id, h.rank
    ),
    top as (
      select b.* from best b order by b.rank limit v_lim
    )
    select jsonb_agg(jsonb_build_object(
             'id', u.id,
             'auth_id', u.auth_id,
             'email', u.email,
             'full_name', u.full_name,
             'username', u.username,
             'is_admin', coalesce(u.is_admin, false),
             'created_at', u.created_at,
             'registered', a.id is not null,
             'last_sign_in_at', a.last_sign_in_at,
             'has_phone', u.phone is not null and btrim(u.phone) <> '',
             'phone_hint', case when u.phone is null or length(regexp_replace(u.phone, '[^0-9]', '', 'g')) < 3 then null
                                else '•••' || right(regexp_replace(u.phone, '[^0-9]', '', 'g'), 3) end,
             'matched_by', t.reason,
             'property_reference', t.ref)
           order by t.rank, u.created_at desc)
      from top t
      join public.users u on u.id = t.id
      left join auth.users a on a.id = u.auth_id
  ), '[]'::jsonb);
end $$;

revoke all on function public.admin_search_users(text, integer) from public, anon;
grant execute on function public.admin_search_users(text, integer) to authenticated;

-- ── 3. Global lookup (Ctrl/Cmd-K) ───────────────────────────────────────
/*
 * Whatever identifier somebody pasted, where it lives.
 *
 * Every probe is an equality on a primary key or a unique index — the
 * six-digit reference, a uuid, an exact email — so this answers instantly at
 * any table size. Free text is left to the navigation search, which already
 * handles it.
 */
create or replace function public.admin_lookup(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  q      text := btrim(coalesce(p_query, ''));
  v_uuid uuid;
  v_ref  integer;
  out    jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = '42501';
  end if;

  if q = '' then return out; end if;

  if q ~ '^#?[0-9]{6}$' then
    v_ref := ltrim(q, '#')::integer;
    out := out || coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', 'property', 'id', p.id, 'reference', p.homatch_id,
        'label', p.title, 'detail', u.email,
        'path', '/admin/properties?ref=' || p.homatch_id))
        from public.properties p left join public.users u on u.id = p.user_id
       where p.homatch_id = v_ref), '[]'::jsonb);
  end if;

  if q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_uuid := q::uuid;

    out := out || coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', 'user', 'id', u.id, 'label', coalesce(u.full_name, u.email), 'detail', u.email,
        'path', '/admin/user360?user=' || u.id))
        from public.users u where u.id = v_uuid or u.auth_id = v_uuid), '[]'::jsonb);

    out := out || coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', 'property', 'id', p.id, 'reference', p.homatch_id, 'label', p.title,
        'path', '/admin/properties?' || case when p.homatch_id is not null
                                             then 'ref=' || p.homatch_id else 'id=' || p.id end))
        from public.properties p where p.id = v_uuid), '[]'::jsonb);

    out := out || coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', case when m.source_kind = 'INTERNAL_HOMATCH' then 'internal_match' else 'external_match' end,
        'id', m.id, 'label', m.deal_kind, 'detail', m.compatibility,
        'path', '/admin/supply-matches?id=' || m.id))
        from public.supply_matches m where m.id = v_uuid), '[]'::jsonb);

    out := out || coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', 'legacy_match', 'id', m.id, 'label', m.status::text,
        'path', '/admin/matches?id=' || m.id))
        from public.matches m where m.id = v_uuid), '[]'::jsonb);

    /* A conversation is found by who is in it. Its messages are not read. */
    out := out || coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', 'conversation', 'id', c.id,
        'label', coalesce(ui.email, '?') || ' ↔ ' || coalesce(ur.email, '?'),
        'detail', c.status::text,
        'path', '/admin/user360?user=' || c.initiator_id))
        from public.conversations c
        left join public.users ui on ui.id = c.initiator_id
        left join public.users ur on ur.id = c.recipient_id
       where c.id = v_uuid), '[]'::jsonb);

    out := out || coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', 'campaign', 'id', c.id, 'label', coalesce(p.title, c.id::text),
        'detail', coalesce(c.status_v2, c.status)::text,
        'path', '/admin/campaigns?id=' || c.id))
        from public.matching_campaigns c left join public.properties p on p.id = c.property_id
       where c.id = v_uuid), '[]'::jsonb);

    out := out || coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', 'signal', 'id', s.id, 'label', s.act, 'detail', s.source_surface,
        'path', '/admin/intelligence?signal=' || s.id))
        from public.intent_signals s where s.id = v_uuid), '[]'::jsonb);

    out := out || coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', 'notification', 'id', n.id, 'label', n.type::text,
        'path', '/admin/notifications?id=' || n.id))
        from public.notifications n where n.id = v_uuid), '[]'::jsonb);

    out := out || coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', 'announcement', 'id', a.id, 'label', a.slug,
        'path', '/admin/announcements?slug=' || a.slug))
        from public.announcements a where a.id = v_uuid), '[]'::jsonb);
  end if;

  if position('@' in q) > 1 then
    out := out || coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', 'user', 'id', u.id, 'label', coalesce(u.full_name, u.email), 'detail', u.email,
        'path', '/admin/user360?user=' || u.id))
        from (select * from public.users u where lower(u.email) = lower(q) limit 5) u), '[]'::jsonb);
  end if;

  return out;
end $$;

revoke all on function public.admin_lookup(text) from public, anon;
grant execute on function public.admin_lookup(text) to authenticated;

-- ── 4. Audit log ────────────────────────────────────────────────────────
/*
 * admin_audit_log had writers and no reader.
 *
 * admin_id is the ACTING ADMIN, recorded by some writers as the auth id and by
 * others (admin_set_setting) as the profile id; both are resolved, so a filter
 * by admin finds all of that person's entries whichever writer recorded them.
 */
create or replace function public.admin_audit_log_list(
  p_admin text default null,
  p_action text default null,
  p_target text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_lim   integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_off   integer := greatest(0, coalesce(p_offset, 0));
  v_admin uuid[];
  v_target uuid[];
  v_target_text text := nullif(btrim(coalesce(p_target, '')), '');
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_admin, '')), '') is not null then
    select coalesce(array_agg(x), '{}') into v_admin from (
      select u.id x from public.users u
       where u.id::text = btrim(p_admin) or u.auth_id::text = btrim(p_admin) or lower(u.email) = lower(btrim(p_admin))
      union
      select u.auth_id from public.users u
       where (u.id::text = btrim(p_admin) or u.auth_id::text = btrim(p_admin) or lower(u.email) = lower(btrim(p_admin)))
         and u.auth_id is not null
    ) s;
    /* An id with no profile behind it (a service actor, a deleted admin) is
       still an id somebody may paste. Assigned, never cast inside the query,
       so free text can never reach a uuid cast. */
    if btrim(p_admin) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_admin := v_admin || btrim(p_admin)::uuid;
    end if;
  end if;

  if v_target_text is not null then
    select coalesce(array_agg(u.id), '{}') into v_target from public.users u
     where u.id::text = v_target_text or u.auth_id::text = v_target_text or lower(u.email) = lower(v_target_text);
  end if;

  return jsonb_build_object(
    'actions', coalesce((select jsonb_agg(a order by a) from (select distinct l.action a from public.admin_audit_log l) d), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(r order by (r->>'created_at') desc) from (
        select jsonb_build_object(
          'id', l.id,
          'created_at', l.created_at,
          'action', l.action,
          'entity_type', l.entity_type,
          'entity_id', l.entity_id,
          'admin', (select jsonb_build_object('id', u.id, 'email', u.email)
                      from public.users u where u.auth_id = l.admin_id or u.id = l.admin_id limit 1),
          'admin_ref', l.admin_id,
          'target', public.homatch_user_brief(l.target_id),
          'metadata', public.homatch_redact_json(l.metadata),
          'total', count(*) over ()
        ) r
        from public.admin_audit_log l
        where (v_admin is null or l.admin_id = any (v_admin))
          and (nullif(btrim(coalesce(p_action, '')), '') is null or l.action = btrim(p_action))
          and (v_target_text is null
               or l.target_id = any (v_target)
               or l.entity_id = v_target_text)
          and (p_from is null or l.created_at >= p_from)
          and (p_to is null or l.created_at < p_to)
        order by l.created_at desc
        limit v_lim offset v_off
      ) q), '[]'::jsonb)
  );
end $$;

revoke all on function public.admin_audit_log_list(text, text, text, timestamptz, timestamptz, integer, integer) from public, anon;
grant execute on function public.admin_audit_log_list(text, text, text, timestamptz, timestamptz, integer, integer) to authenticated;

-- ── 5. Properties ───────────────────────────────────────────────────────
/*
 * The property list, filtered where the rows are.
 *
 * `p_homatch_id` is an exact lookup on the unique index over the permanent
 * six-digit reference, and deliberately ignores the default "not deleted"
 * narrowing: an operator holding a reference wants THAT property, including
 * one its owner deleted.
 *
 * Status is the operator's word, not a column: ACTIVE / PAUSED / DRAFT /
 * COMPLETED are the matching state of a live listing, ARCHIVED and DELETED are
 * the two ways a listing stops being live.
 */
create or replace function public.admin_properties_search(
  p_homatch_id integer default null,
  p_owner text default null,
  p_status text default null,
  p_transaction text default null,
  p_city text default null,
  p_district text default null,
  p_created_from timestamptz default null,
  p_created_to timestamptz default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_lim    integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_off    integer := greatest(0, coalesce(p_offset, 0));
  v_owner  text := nullif(btrim(coalesce(p_owner, '')), '');
  v_status text := nullif(upper(btrim(coalesce(p_status, ''))), '');
  v_tx     text := nullif(upper(btrim(coalesce(p_transaction, ''))), '');
  v_city   text := nullif(btrim(coalesce(p_city, '')), '');
  v_dist   text := nullif(btrim(coalesce(p_district, '')), '');
  v_owner_uuid uuid;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = '42501';
  end if;

  if v_owner ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_owner_uuid := v_owner::uuid;
  end if;

  return jsonb_build_object('rows', coalesce((
    select jsonb_agg(r order by (r->>'created_at') desc) from (
      select jsonb_build_object(
        'id', p.id,
        'homatch_id', p.homatch_id,
        'title', p.title,
        'property_type', p.property_type,
        'transaction_type', p.transaction_type,
        'matching_status', p.matching_status,
        'archived_at', p.archived_at,
        'is_deleted', coalesce(p.is_deleted, false),
        'source_type', p.source_type,
        'source_domain', f.source_domain,
        'city', f.city,
        'district', f.district,
        'country_code', f.country_code,
        'created_at', p.created_at,
        'owner', public.homatch_user_brief(p.user_id),
        'contact_phone_present', p.contact_phone_e164 is not null or nullif(btrim(coalesce(p.contact_phone_raw, '')), '') is not null,
        'campaign_status', (select coalesce(c.status_v2, c.status)::text from public.matching_campaigns c where c.property_id = p.id limit 1),
        'internal_matches', (select count(*) from public.supply_matches m where m.property_id = p.id),
        'total', count(*) over ()
      ) r
      from public.properties p
      left join public.property_facts f on f.property_id = p.id
      left join public.users o on o.id = p.user_id
      where (p_homatch_id is null or p.homatch_id = p_homatch_id)
        and (
          case
            when v_status is null then (p_homatch_id is not null or not coalesce(p.is_deleted, false))
            when v_status = 'DELETED' then coalesce(p.is_deleted, false)
            when v_status = 'ARCHIVED' then not coalesce(p.is_deleted, false) and p.archived_at is not null
            else not coalesce(p.is_deleted, false) and p.archived_at is null and p.matching_status::text = v_status
          end)
        and (v_owner is null
             or (v_owner_uuid is not null and (p.user_id = v_owner_uuid or o.auth_id = v_owner_uuid))
             or (v_owner_uuid is null and lower(coalesce(o.email, '')) like '%' || public.homatch_ilike_escape(lower(v_owner)) || '%' escape '\'))
        and (v_tx is null or p.transaction_type::text = v_tx)
        and (v_city is null or lower(coalesce(f.city, '')) like '%' || public.homatch_ilike_escape(lower(v_city)) || '%' escape '\')
        and (v_dist is null or lower(coalesce(f.district, '')) like '%' || public.homatch_ilike_escape(lower(v_dist)) || '%' escape '\')
        and (p_created_from is null or p.created_at >= p_created_from)
        and (p_created_to is null or p.created_at < p_created_to)
      order by p.created_at desc, p.id
      limit v_lim offset v_off
    ) q), '[]'::jsonb));
end $$;

revoke all on function public.admin_properties_search(integer, text, text, text, text, text, timestamptz, timestamptz, integer, integer) from public, anon;
grant execute on function public.admin_properties_search(integer, text, text, text, text, text, timestamptz, timestamptz, integer, integer) to authenticated;

/*
 * One property, with where it came from and where it stands.
 *
 * Contact readiness is PRESENT or ABSENT. The number itself is only returned
 * by admin_property_reveal_contact, which writes an audit row first.
 */
create or replace function public.admin_property_detail(p_property_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  p public.properties%rowtype;
  f public.property_facts%rowtype;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = '42501';
  end if;

  select * into p from public.properties where id = p_property_id;
  if not found then return null; end if;
  select * into f from public.property_facts where property_id = p.id;

  return jsonb_build_object(
    'id', p.id,
    'homatch_id', p.homatch_id,
    'title', p.title,
    'property_type', p.property_type,
    'transaction_type', p.transaction_type,
    'matching_status', p.matching_status,
    'matchability_score', p.matchability_score,
    'archived_at', p.archived_at,
    'is_deleted', coalesce(p.is_deleted, false),
    'created_at', p.created_at,
    'updated_at', p.updated_at,
    'owner', public.homatch_user_brief(p.user_id),
    'owner_has_phone', (select u.phone is not null and btrim(u.phone) <> '' from public.users u where u.id = p.user_id),
    'contact_phone_present', p.contact_phone_e164 is not null or nullif(btrim(coalesce(p.contact_phone_raw, '')), '') is not null,
    'contact_phone_country', p.contact_phone_country,
    'provenance', jsonb_build_object(
      'source_type', p.source_type,
      'source_domain', f.source_domain,
      'source_url', f.source_url,
      'source_language', f.source_language,
      'extraction_confidence', f.extraction_confidence,
      'developer_id', p.developer_id,
      'canonical_group_id', p.canonical_group_id,
      'last_import', (select jsonb_build_object('status', i.status, 'error_code', i.error_code,
                                                'created_at', i.created_at, 'provider', i.extraction_provider)
                        from public.property_imports i where i.property_id = p.id
                       order by i.created_at desc limit 1)),
    'facts', jsonb_build_object(
      'country_code', f.country_code, 'city', f.city, 'district', f.district,
      'price', f.total_price, 'currency', f.currency, 'area', f.area,
      'bedrooms', f.bedrooms, 'rooms', f.rooms),
    'matching', jsonb_build_object(
      'campaign', (select jsonb_build_object('id', c.id, 'status', coalesce(c.status_v2, c.status)::text,
                                             'languages', c.search_languages_resolved, 'created_at', c.created_at)
                     from public.matching_campaigns c where c.property_id = p.id limit 1),
      'last_job', (select jsonb_build_object('id', j.id, 'status', j.status, 'completed_at', j.completed_at,
                                             'matches_created', j.matches_created, 'failure_reason', j.failure_reason)
                     from public.matching_jobs j where j.property_id = p.id order by j.created_at desc limit 1),
      'internal_matches', (select count(*) from public.supply_matches m where m.property_id = p.id),
      'internal_compatible', (select count(*) from public.supply_matches m
                                where m.property_id = p.id and m.compatibility = 'COMPATIBLE'),
      'legacy_matches', (select count(*) from public.matches m where m.property_id = p.id),
      'interest_signals', (select count(*) from public.intent_signals s
                             where s.property_id = p.id and s.withdrawn_at is null and s.superseded_by is null))
  );
end $$;

revoke all on function public.admin_property_detail(uuid) from public, anon;
grant execute on function public.admin_property_detail(uuid) to authenticated;

/*
 * Show a contact number, deliberately, and say so.
 *
 * A reason is required, and the audit row is written BEFORE the number is
 * returned, in the same transaction — so there is no path that reveals a
 * number without leaving a record. The number itself is not copied into the
 * audit metadata; the record says who looked, at what, and why.
 */
create or replace function public.admin_property_reveal_contact(p_property_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  p public.properties%rowtype;
  v_owner_phone text;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;

  select * into p from public.properties where id = p_property_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select u.phone into v_owner_phone from public.users u where u.id = p.user_id;

  insert into public.admin_audit_log (admin_id, target_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), p.user_id, 'CONTACT_PHONE_REVEALED', 'property', p.id::text,
          jsonb_build_object('reason', btrim(p_reason), 'homatch_id', p.homatch_id));

  return jsonb_build_object(
    'listing_phone', coalesce(p.contact_phone_e164, nullif(btrim(coalesce(p.contact_phone_raw, '')), '')),
    'owner_phone', nullif(btrim(coalesce(v_owner_phone, '')), ''));
end $$;

revoke all on function public.admin_property_reveal_contact(uuid, text) from public, anon;
grant execute on function public.admin_property_reveal_contact(uuid, text) to authenticated;
