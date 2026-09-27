-- HOMATCH Admin control centre, part 2 — what the platform knows and did.
--
-- Native intelligence, effective demand, internal and external matches,
-- notifications, campaigns and the system's own record of its background
-- work — each as an admin-only read that returns STRUCTURE and never
-- somebody's words.
--
-- THE LINE THESE FUNCTIONS HOLD
--
-- intent_signals is derived from private conversation. An operator needs to
-- see that a signal exists, what it asserted (act, side, dimension, firmness),
-- where it came from (surface + event id) and whether it still stands. They
-- do not need the sentence, and a screen that showed it would be a second copy
-- of a private message with different access rules. So:
--
--   * no function here selects messages.body, live_chat_messages.body,
--     intent_profiles.original_text / translated_text, raw_signals text or
--     notifications.body;
--   * constraints pass through homatch_safe_constraints, which keeps short
--     scalar values (a city, a number, a currency) and drops any long string
--     or any key that names text — so even a future writer that stored a
--     quote inside constraints cannot surface it here.
--
-- Same shape as part 1: SECURITY DEFINER, pinned search_path, is_admin()
-- checked in SQL, revoked from PUBLIC and anon, granted to authenticated.

create index if not exists notifications_dedupe_key_idx
  on public.notifications (dedupe_key) where dedupe_key is not null;
create index if not exists notifications_created_idx
  on public.notifications (created_at desc);
create index if not exists intent_signals_created_idx
  on public.intent_signals (created_at desc);
create index if not exists intent_signals_actor_idx
  on public.intent_signals (actor_user_id, source_at desc);
create index if not exists supply_matches_created_idx
  on public.supply_matches (created_at desc);
create index if not exists supply_matches_property_idx
  on public.supply_matches (property_id) where property_id is not null;

-- ── helper: constraints an operator may read ────────────────────────────
create or replace function public.homatch_safe_constraints(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  k text;
  v jsonb;
  out jsonb := '{}'::jsonb;
  kept jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return '{}'::jsonb; end if;
  for k, v in select key, value from jsonb_each(p) loop
    continue when k ~* '(text|quote|message|body|raw|excerpt|snippet|original|note|comment|translat|content|sentence)';
    if jsonb_typeof(v) in ('number', 'boolean', 'null') then
      out := out || jsonb_build_object(k, v);
    elsif jsonb_typeof(v) = 'string' and length(v #>> '{}') <= 64 then
      out := out || jsonb_build_object(k, v);
    elsif jsonb_typeof(v) = 'array' then
      select coalesce(jsonb_agg(e), '[]'::jsonb) into kept
        from (select e from jsonb_array_elements(v) e
               where jsonb_typeof(e) in ('number', 'boolean')
                  or (jsonb_typeof(e) = 'string' and length(e #>> '{}') <= 64)
               limit 20) s;
      out := out || jsonb_build_object(k, kept);
    end if;
  end loop;
  return out;
end $$;

revoke all on function public.homatch_safe_constraints(jsonb) from public, anon, authenticated;

-- ── 5. Native intelligence ──────────────────────────────────────────────
create or replace function public.admin_intent_signals(
  p_user text default null,
  p_source_surface text default null,
  p_act text default null,
  p_side text default null,
  p_status text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_homatch_id integer default null,
  p_signal_id uuid default null,
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
  v_user   text := nullif(btrim(coalesce(p_user, '')), '');
  v_uuid   uuid;
  v_status text := nullif(upper(btrim(coalesce(p_status, ''))), '');
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = '42501';
  end if;

  if v_user ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_uuid := v_user::uuid;
  end if;

  return jsonb_build_object('rows', coalesce((
    select jsonb_agg(r order by (r->>'created_at') desc) from (
      select jsonb_build_object(
        'id', s.id,
        'actor', public.homatch_user_brief(s.actor_user_id),
        'source_surface', s.source_surface,
        'source_event_id', s.source_event_id,
        'source_at', s.source_at,
        'side', s.side,
        'act', s.act,
        'dimension', s.dimension,
        'polarity', s.polarity,
        'attribution', s.attribution,
        'explicit', s.explicit,
        'confidence', s.confidence,
        'scope', s.scope,
        'strength', s.strength,
        'constraints', public.homatch_safe_constraints(s.constraints),
        'property_id', s.property_id,
        'property_homatch_id', p.homatch_id,
        'intent_profile_id', s.intent_profile_id,
        'conversation_id', s.conversation_id,
        'status', case when s.withdrawn_at is not null then 'WITHDRAWN'
                       when s.superseded_by is not null then 'SUPERSEDED'
                       else 'ACTIVE' end,
        'superseded_by', s.superseded_by,
        'withdrawn_at', s.withdrawn_at,
        'withdrawn_reason', s.withdrawn_reason,
        'created_at', s.created_at,
        'total', count(*) over ()
      ) r
      from public.intent_signals s
      left join public.properties p on p.id = s.property_id
      left join public.users u on u.id = s.actor_user_id
      where (p_signal_id is null or s.id = p_signal_id)
        and (v_user is null
             or (v_uuid is not null and (s.actor_user_id = v_uuid or u.auth_id = v_uuid))
             or (v_uuid is null and lower(coalesce(u.email, '')) like '%' || public.homatch_ilike_escape(lower(v_user)) || '%' escape '\'))
        and (nullif(p_source_surface, '') is null or s.source_surface = upper(p_source_surface))
        and (nullif(p_act, '') is null or s.act = upper(p_act))
        and (nullif(p_side, '') is null or s.side = upper(p_side))
        and (v_status is null
             or (v_status = 'ACTIVE' and s.withdrawn_at is null and s.superseded_by is null)
             or (v_status = 'WITHDRAWN' and s.withdrawn_at is not null)
             or (v_status = 'SUPERSEDED' and s.withdrawn_at is null and s.superseded_by is not null))
        and (p_from is null or s.source_at >= p_from)
        and (p_to is null or s.source_at < p_to)
        and (p_homatch_id is null or p.homatch_id = p_homatch_id)
      order by s.created_at desc, s.id
      limit v_lim offset v_off
    ) q), '[]'::jsonb));
end $$;

revoke all on function public.admin_intent_signals(text, text, text, text, text, timestamptz, timestamptz, integer, uuid, integer, integer) from public, anon;
grant execute on function public.admin_intent_signals(text, text, text, text, text, timestamptz, timestamptz, integer, uuid, integer, integer) to authenticated;

-- ── 6. Effective demand ─────────────────────────────────────────────────
/*
 * What somebody CURRENTLY wants, separated from everything they ever said.
 *
 * The projection is what the matcher reads: active_search_subscriptions
 * joined to intent_profiles (ingest-live-chat writes these with
 * classifier_version 'live-chat-1.0.0'; Find Property writes its own). It is
 * returned as stored.
 *
 * Firmness is not stored on the projection; it is stored on the signals. So
 * `firmness` is each dimension's firmness from the NEWEST still-standing
 * DEMAND signal that stated one — the same "later statement refines, per
 * dimension" rule effective.ts applies. A dimension with no stored firmness is
 * absent here and shown as UNKNOWN; nothing is defaulted.
 */
create or replace function public.admin_user_effective_demand(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'user', public.homatch_user_brief(p_user_id),
    'projections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'subscription_id', s.id,
        'intent_profile_id', s.intent_id,
        'side', s.side,
        'is_active', s.is_active,
        'created_at', s.created_at,
        'last_notified_at', s.last_notified_at,
        'origin', case when ip.classifier_version = 'live-chat-1.0.0' then 'CONVERSATION'
                       when ip.classifier_version is null then 'UNKNOWN'
                       else 'SEARCH' end,
        'intent_type', ip.intent_type,
        'transaction_type', ip.transaction_type,
        'country', ip.country,
        'city', ip.city,
        'district', ip.district,
        'neighborhoods', ip.neighborhoods,
        'property_types', ip.property_types,
        'bedrooms_min', ip.bedrooms_min,
        'bedrooms_max', ip.bedrooms_max,
        'area_min', ip.area_min,
        'area_max', ip.area_max,
        'budget_min', ip.budget_min,
        'budget_max', ip.budget_max,
        'currency', ip.currency,
        'confidence', ip.intent_confidence,
        'criteria', public.homatch_safe_constraints(s.search_criteria))
        order by s.is_active desc, s.created_at desc)
        from public.active_search_subscriptions s
        left join public.intent_profiles ip on ip.id = s.intent_id
       where s.user_id = p_user_id), '[]'::jsonb),
    'firmness', coalesce((
      select jsonb_object_agg(x.k, x.v) from (
        select distinct on (e.key) e.key k, e.value v
          from public.intent_signals s, jsonb_each(s.strength) e
         where s.actor_user_id = p_user_id
           and s.side = 'DEMAND'
           and s.withdrawn_at is null and s.superseded_by is null
           and e.value in ('"REQUIRED"'::jsonb, '"PREFERRED"'::jsonb, '"FLEXIBLE"'::jsonb)
         order by e.key, s.source_at desc) x), '{}'::jsonb),
    'signals', (
      select jsonb_build_object(
        'active', count(*) filter (where s.withdrawn_at is null and s.superseded_by is null),
        'withdrawn', count(*) filter (where s.withdrawn_at is not null),
        'superseded', count(*) filter (where s.withdrawn_at is null and s.superseded_by is not null),
        'last_stated_at', max(s.source_at))
        from public.intent_signals s where s.actor_user_id = p_user_id)
  );
end $$;

revoke all on function public.admin_user_effective_demand(uuid) from public, anon;
grant execute on function public.admin_user_effective_demand(uuid) to authenticated;

-- ── 7. Matches: internal vs external ────────────────────────────────────
/*
 * INTERNAL: two Homatch accounts — a listing (supply user) and a projected
 * demand (demand user). Both are real accounts and both are shown.
 *
 * EXTERNAL: a signal and an observation found outside Homatch. There is no
 * Homatch counterparty and none is invented: `counterparty` is null and the
 * row carries only the reference ids the evidence lives under.
 */
create or replace function public.admin_supply_matches(
  p_kind text default null,
  p_homatch_id integer default null,
  p_user text default null,
  p_deal_kind text default null,
  p_compatibility text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_id uuid default null,
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
  v_lim  integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_off  integer := greatest(0, coalesce(p_offset, 0));
  v_kind text := case upper(btrim(coalesce(p_kind, '')))
                   when 'INTERNAL' then 'INTERNAL_HOMATCH'
                   when 'EXTERNAL' then 'EXTERNAL_INTELLIGENCE'
                   else null end;
  v_user text := nullif(btrim(coalesce(p_user, '')), '');
  v_uids uuid[];
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = '42501';
  end if;

  if v_user is not null then
    select coalesce(array_agg(u.id), '{}') into v_uids from public.users u
     where u.id::text = v_user or u.auth_id::text = v_user
        or lower(coalesce(u.email, '')) like '%' || public.homatch_ilike_escape(lower(v_user)) || '%' escape '\';
  end if;

  return jsonb_build_object(
    'counts', (select jsonb_build_object(
        'internal', count(*) filter (where m.source_kind = 'INTERNAL_HOMATCH'),
        'external', count(*) filter (where m.source_kind = 'EXTERNAL_INTELLIGENCE'))
      from public.supply_matches m),
    'rows', coalesce((
    select jsonb_agg(r order by (r->>'created_at') desc) from (
      select jsonb_build_object(
        'id', m.id,
        'kind', case when m.source_kind = 'INTERNAL_HOMATCH' then 'INTERNAL' else 'EXTERNAL' end,
        'compatibility', m.compatibility,
        'score', m.match_score,
        'deal_kind', m.deal_kind,
        'demand_role', m.demand_role,
        'supply_role', m.supply_role,
        'agreed', m.agreed,
        'conflicted', m.conflicted,
        'unknown_dimensions', m.unknown_dimensions,
        'flexible_dimensions', m.flexible_dimensions,
        'created_at', m.created_at,
        'updated_at', m.updated_at,
        'demand_id', m.intent_profile_id,
        'property', case when p.id is null then null else jsonb_build_object(
            'id', p.id, 'homatch_id', p.homatch_id, 'title', p.title) end,
        'supply_user', case when m.source_kind = 'INTERNAL_HOMATCH' then public.homatch_user_brief(m.supply_user_id) end,
        'demand_user', case when m.source_kind = 'INTERNAL_HOMATCH' then public.homatch_user_brief(m.demand_user_id) end,
        'counterparty', null,
        'external_refs', case when m.source_kind = 'EXTERNAL_INTELLIGENCE' then jsonb_build_object(
            'signal_id', m.signal_id, 'observation_id', m.observation_id) end,
        'campaign', case when c.id is null then null else jsonb_build_object(
            'id', c.id, 'status', coalesce(c.status_v2, c.status)::text,
            'owner', public.homatch_user_brief(c.user_id),
            'property_homatch_id', (select cp.homatch_id from public.properties cp where cp.id = c.property_id)) end,
        'notifications', case when m.source_kind = 'INTERNAL_HOMATCH' then coalesce((
            select jsonb_agg(jsonb_build_object(
                     'side', split_part(n.dedupe_key, ':', 3),
                     'recipient', n.user_id,
                     'created_at', n.created_at,
                     'read', n.read,
                     'pushed_at', n.pushed_at) order by n.created_at)
              from public.notifications n
             where n.dedupe_key in ('native-match:' || m.id || ':supply', 'native-match:' || m.id || ':demand')),
            '[]'::jsonb) end,
        'conversation_exists', case when m.source_kind = 'INTERNAL_HOMATCH' then exists (
            select 1 from public.conversations cv
             where cv.property_id = m.property_id
               and ((cv.initiator_id = m.supply_user_id and cv.recipient_id = m.demand_user_id)
                 or (cv.initiator_id = m.demand_user_id and cv.recipient_id = m.supply_user_id))) end,
        'total', count(*) over ()
      ) r
      from public.supply_matches m
      left join public.properties p on p.id = m.property_id
      left join public.matching_campaigns c on c.id = m.campaign_id
      where (p_id is null or m.id = p_id)
        and (v_kind is null or m.source_kind = v_kind)
        and (p_homatch_id is null or p.homatch_id = p_homatch_id
             or exists (select 1 from public.properties cp where cp.id = c.property_id and cp.homatch_id = p_homatch_id))
        and (v_uids is null or m.supply_user_id = any (v_uids) or m.demand_user_id = any (v_uids) or c.user_id = any (v_uids))
        and (nullif(p_deal_kind, '') is null or m.deal_kind = upper(p_deal_kind))
        and (nullif(p_compatibility, '') is null or m.compatibility = upper(p_compatibility))
        and (p_from is null or m.created_at >= p_from)
        and (p_to is null or m.created_at < p_to)
      order by m.created_at desc, m.id
      limit v_lim offset v_off
    ) q), '[]'::jsonb));
end $$;

revoke all on function public.admin_supply_matches(text, integer, text, text, text, timestamptz, timestamptz, uuid, integer, integer) from public, anon;
grant execute on function public.admin_supply_matches(text, integer, text, text, text, timestamptz, timestamptz, uuid, integer, integer) to authenticated;

-- ── 8. Notifications ────────────────────────────────────────────────────
/*
 * What was sent to whom, and what became of it.
 *
 * The BODY column is never returned. A message notification's body is a fixed
 * sentence today (send-message writes no preview), but "today" is not a
 * guarantee an admin screen can rest on, and the operational questions —
 * was it created, was it pushed, was it read, where does it lead, what is its
 * dedupe key — are all answered without it.
 */
create or replace function public.admin_notifications_list(
  p_type text default null,
  p_recipient text default null,
  p_read boolean default null,
  p_pushed boolean default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_id uuid default null,
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
  v_lim  integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_off  integer := greatest(0, coalesce(p_offset, 0));
  v_rec  text := nullif(btrim(coalesce(p_recipient, '')), '');
  v_uids uuid[];
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = '42501';
  end if;

  if v_rec is not null then
    select coalesce(array_agg(u.id), '{}') into v_uids from public.users u
     where u.id::text = v_rec or u.auth_id::text = v_rec
        or lower(coalesce(u.email, '')) like '%' || public.homatch_ilike_escape(lower(v_rec)) || '%' escape '\';
  end if;

  return jsonb_build_object(
    'types', to_jsonb(enum_range(null::public.notification_type)),
    'rows', coalesce((
    select jsonb_agg(r order by (r->>'created_at') desc) from (
      select jsonb_build_object(
        'id', n.id,
        'recipient', public.homatch_user_brief(n.user_id),
        'type', n.type,
        'kind', n.metadata ->> 'kind',
        'priority', n.priority,
        'title', case when n.type::text = 'NEW_MESSAGE' then null else n.title end,
        'created_at', n.created_at,
        'read', n.read,
        'seen_at', n.seen_at,
        'read_at', n.read_at,
        'pushed_at', n.pushed_at,
        'entity_type', n.entity_type,
        'entity_id', n.entity_id,
        'property_id', n.property_id,
        'deep_link', n.deep_link,
        'dedupe_key', n.dedupe_key,
        'group_key', n.group_key,
        'total', count(*) over ()
      ) r
      from public.notifications n
      where (p_id is null or n.id = p_id)
        and (nullif(p_type, '') is null or n.type::text = upper(p_type))
        and (v_uids is null or n.user_id = any (v_uids))
        and (p_read is null or n.read = p_read)
        and (p_pushed is null or (n.pushed_at is not null) = p_pushed)
        and (p_from is null or n.created_at >= p_from)
        and (p_to is null or n.created_at < p_to)
      order by n.created_at desc, n.id
      limit v_lim offset v_off
    ) q), '[]'::jsonb));
end $$;

revoke all on function public.admin_notifications_list(text, text, boolean, boolean, timestamptz, timestamptz, uuid, integer, integer) from public, anon;
grant execute on function public.admin_notifications_list(text, text, boolean, boolean, timestamptz, timestamptz, uuid, integer, integer) to authenticated;

-- ── 13. Campaigns ───────────────────────────────────────────────────────
/*
 * Four money figures that must never be merged into one.
 *
 *   budget_credits      what the owner AUTHORISED for this search — the sum
 *                       of authorized_max_credits on its FIND_CLIENTS
 *                       reservations (match-campaign reserves with the
 *                       property id as job_ref).
 *   spent_credits       what was actually SETTLED against those reservations.
 *   provider_cogs_usd   what the providers cost US for this campaign's runs
 *                       (matching_jobs.cost_usd_total) — an internal cost,
 *                       never a price.
 *   wallet_balance      the owner's wallet, which is none of the above.
 *
 * Credits convert at billing_setting_num('credits_per_usd'), 10 credits = $1.
 */
create or replace function public.admin_campaigns_list(
  p_owner text default null,
  p_state text default null,
  p_transaction text default null,
  p_language text default null,
  p_id uuid default null,
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
  v_owner text := nullif(btrim(coalesce(p_owner, '')), '');
  v_cpu   numeric := 10;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = '42501';
  end if;

  begin
    v_cpu := public.billing_setting_num('credits_per_usd', 10);
  exception when undefined_function then v_cpu := 10;
  end;

  return jsonb_build_object(
    'credits_per_usd', v_cpu,
    'rows', coalesce((
    select jsonb_agg(r order by (r->>'created_at') desc) from (
      select jsonb_build_object(
        'id', c.id,
        'state', coalesce(c.status_v2, c.status)::text,
        'created_at', c.created_at,
        'updated_at', c.updated_at,
        'language_mode', c.search_language_mode,
        'languages_selected', c.search_languages_selected,
        'languages_resolved', c.search_languages_resolved,
        'property', case when p.id is null then null else jsonb_build_object(
            'id', p.id, 'homatch_id', p.homatch_id, 'title', p.title,
            'transaction_type', p.transaction_type, 'city', f.city) end,
        'owner', public.homatch_user_brief(c.user_id),
        'wallet_balance_credits', (select round(ca.balance, 2) from public.credit_accounts ca where ca.user_id = c.user_id limit 1),
        'budget_credits', (select round(coalesce(sum(coalesce(ur.authorized_max_credits, ur.reserved_credits)), 0), 2)
                             from public.usage_reservations ur
                            where ur.product_code = 'FIND_CLIENTS' and ur.job_ref = c.property_id::text),
        'spent_credits', (select round(coalesce(sum(ur.settled_credits), 0), 2)
                            from public.usage_reservations ur
                           where ur.product_code = 'FIND_CLIENTS' and ur.job_ref = c.property_id::text),
        'provider_cogs_usd', (select round(coalesce(sum(j.cost_usd_total), 0), 4)
                                from public.matching_jobs j where j.campaign_id = c.id or j.property_id = c.property_id),
        'runs', (select count(*) from public.matching_jobs j where j.campaign_id = c.id or j.property_id = c.property_id),
        'last_run', (select jsonb_build_object('status', j.status, 'completed_at', j.completed_at, 'matches_created', j.matches_created)
                       from public.matching_jobs j where j.campaign_id = c.id or j.property_id = c.property_id
                      order by j.created_at desc limit 1),
        'total', count(*) over ()
      ) r
      from public.matching_campaigns c
      left join public.properties p on p.id = c.property_id
      left join public.property_facts f on f.property_id = c.property_id
      left join public.users o on o.id = c.user_id
      where (p_id is null or c.id = p_id)
        and (v_owner is null
             or o.id::text = v_owner or o.auth_id::text = v_owner
             or lower(coalesce(o.email, '')) like '%' || public.homatch_ilike_escape(lower(v_owner)) || '%' escape '\')
        and (nullif(p_state, '') is null or coalesce(c.status_v2, c.status)::text = upper(p_state))
        and (nullif(p_transaction, '') is null or p.transaction_type::text = upper(p_transaction))
        and (nullif(p_language, '') is null
             or lower(p_language) = any (coalesce(c.search_languages_resolved, '{}'))
             or lower(p_language) = any (coalesce(c.search_languages_selected, '{}')))
      order by c.created_at desc, c.id
      limit v_lim offset v_off
    ) q), '[]'::jsonb));
end $$;

revoke all on function public.admin_campaigns_list(text, text, text, text, uuid, integer, integer) from public, anon;
grant execute on function public.admin_campaigns_list(text, text, text, text, uuid, integer, integer) to authenticated;

-- ── 12. System facts ────────────────────────────────────────────────────
/*
 * What the database itself can attest about background work.
 *
 * It cannot see whether an edge function or the Railway worker answers; it
 * can see when work last finished and last failed, and whether anything
 * claims to be running without having sent a heartbeat. Those are reported
 * as facts with their timestamps and nothing here turns them into "healthy".
 */
create or replace function public.admin_system_facts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: admin only' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'background_jobs', (select jsonb_build_object(
        'by_state_24h', coalesce((select jsonb_object_agg(x.state, x.n) from (
            select b.state, count(*) n from public.background_jobs b
             where b.created_at >= now() - interval '24 hours' group by b.state) x), '{}'::jsonb),
        'in_flight', count(*) filter (where b.state in ('STARTING', 'COMMITTED', 'PROCESSING', 'PARTIAL')),
        'stale_heartbeat', count(*) filter (where b.state in ('STARTING', 'COMMITTED', 'PROCESSING', 'PARTIAL')
                                              and coalesce(b.last_heartbeat_at, b.started_at, b.created_at) < now() - interval '10 minutes'),
        'last_completed_at', max(b.completed_at),
        'last_failed_at', max(b.failed_at),
        'last_failed_code', (select b2.error_code from public.background_jobs b2
                              where b2.failed_at is not null order by b2.failed_at desc limit 1))
      from public.background_jobs b),
    'matching_jobs', (select jsonb_build_object(
        'last_completed_at', max(j.completed_at) filter (where j.status::text in ('completed', 'partially_completed')),
        'last_failed_at', max(coalesce(j.completed_at, j.updated_at)) filter (where j.status::text = 'failed'),
        'last_failure_reason', (select j2.failure_reason from public.matching_jobs j2
                                 where j2.status::text = 'failed' order by j2.updated_at desc limit 1),
        'runs_24h', count(*) filter (where j.created_at >= now() - interval '24 hours'))
      from public.matching_jobs j),
    'providers', coalesce((select jsonb_agg(jsonb_build_object(
        'provider', ph.provider, 'status', ph.status,
        'last_tested_at', ph.last_tested_at, 'last_success_at', ph.last_success_at,
        'latency_ms', ph.latency_ms, 'success_count', ph.success_count, 'failure_count', ph.failure_count,
        'last_error', left(ph.last_error, 240)) order by ph.provider)
      from public.provider_health ph), '[]'::jsonb),
    'health_log', (select jsonb_build_object(
        'last', (select to_jsonb(h) - 'provider_statuses' from public.system_health_log h order by h.checked_at desc limit 1),
        'checks_24h', count(*) filter (where h.checked_at >= now() - interval '24 hours'))
      from public.system_health_log h)
  );
end $$;

revoke all on function public.admin_system_facts() from public, anon;
grant execute on function public.admin_system_facts() to authenticated;
