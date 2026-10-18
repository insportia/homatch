-- FIND BUYERS 2.0 (owner, 2026-10-18) — internal matching, unlocked-leads CRM, AI outreach.
--
-- Builds on the HOMATCH Leads marketplace (20261028090000) and Email Studio (20261028110000);
-- nothing here replaces them, and every existing function keeps its signature.
--
--   1 · prices      Standard $0.30 = 3 credits, VIP (code PREMIUM) $1.00 = 10 credits, at the
--                   production rate credits_per_usd = 10. Only these two catalogue rows change.
--                   Segment rules are untouched: VIP needs a STATED budget at the
--                   owner-configured threshold (internal_lead_premium_rules); unknown → Standard.
--   2 · demand      a Marketplace Search keeps what it states beyond the plan vocabulary
--                   (intent_profiles.requirements, rooms already had columns) and ONE demand per
--                   distinct search (subscription fingerprint; a repeat refreshes last_active_at).
--   3 · feed v2     internal_leads_feed_v2: the same anonymised, owner-only feed plus who is
--                   searching (DIRECT / BROKER_FOR_CLIENT / PROFESSIONAL), last activity and
--                   staleness, stated features, and server-side filters (searcher, lock state,
--                   district, property type) — still free, still no identifier before unlock.
--   4 · CRM         stages CONTACT_PLANNED, NEGOTIATING, CONVERTED; "I contacted them" is a
--                   logged owner action (crm_update.logContact), never inferred.
--   5 · scheduling  a REVIEWED Email Studio campaign can be scheduled; jobs-worker dispatches it
--                   through the same studio send path (consent, suppression, daily cap and the
--                   sending switch re-checked at send time). Nothing is ever sent by AI drafting.

/* ════════════════════════════════════════════════════════════════════════
 * 1 · prices
 * ════════════════════════════════════════════════════════════════════════ */

update public.billable_products set standard_retail_cents = 30, updated_at = now()
 where code = 'INTERNAL_LEAD_STANDARD' and standard_retail_cents is distinct from 30;
update public.billable_products set standard_retail_cents = 100, name = 'HOMATCH Leads — VIP contact unlock', updated_at = now()
 where code = 'INTERNAL_LEAD_PREMIUM' and standard_retail_cents is distinct from 100;

/* ════════════════════════════════════════════════════════════════════════
 * 2 · demand persistence
 * ════════════════════════════════════════════════════════════════════════ */

alter table public.intent_profiles
  add column if not exists requirements jsonb not null default '{}'::jsonb,
  add column if not exists last_active_at timestamptz;

alter table public.active_search_subscriptions
  add column if not exists demand_fingerprint text,
  add column if not exists last_active_at timestamptz,
  add column if not exists demand_source text;

-- One active demand per person per distinct search. Rows written before this column existed
-- have no fingerprint and are left exactly as they are.
create unique index if not exists active_search_subscriptions_demand_fingerprint
  on public.active_search_subscriptions (user_id, demand_fingerprint)
  where is_active and demand_fingerprint is not null;

/* ════════════════════════════════════════════════════════════════════════
 * 3 · feed v2
 * ════════════════════════════════════════════════════════════════════════ */

/* Only the structured, non-identifying feature keys a Marketplace Search writes. */
create or replace function public.internal_lead_features(p jsonb)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
    from jsonb_each(coalesce(p, '{}'::jsonb)) e(k, v)
   where k in ('bathroomsMin', 'buildingStatuses', 'renovation', 'furnished', 'parking', 'mustHave',
               'niceToHave', 'exclusions', 'floorPreferences', 'floorRange', 'maxBuildingAge', 'nearby',
               'statedCurrencyUnconverted')
$$;
revoke all on function public.internal_lead_features(jsonb) from public, anon, authenticated;
grant execute on function public.internal_lead_features(jsonb) to service_role;

/*
 * internal_leads_feed_v2(property, p)
 *   p.filters   array of: STRONG POTENTIAL STANDARD PREMIUM FRESH UNLOCKED LOCKED CONTACTED SAVED
 *               DIRECT BROKER STALE ACTIVE — all must hold
 *   p.sort      BEST | NEWEST | ACTIVE | UPDATED | BUDGET_DESC | BUDGET_ASC
 *   p.district  text (matches the stated district or one of the stated neighbourhoods)
 *   p.propertyType  text (one of the stated property types)
 *   p.limit / p.offset
 * Same guarantees as internal_leads_feed: owner-only, eligible members only, no identifier,
 * phone, email or free text before an unlock, budget rounded, free.
 */
create or replace function public.internal_leads_feed_v2(p_property_id uuid, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_seen timestamptz;
  v_limit integer := greatest(1, least(coalesce((p->>'limit')::integer, 24), 60));
  v_offset integer := greatest(0, coalesce((p->>'offset')::integer, 0));
  v_sort text := upper(coalesce(nullif(p->>'sort', ''), 'BEST'));
  v_filters text[] := coalesce((select array_agg(upper(x)) from jsonb_array_elements_text(
                        case when jsonb_typeof(p->'filters') = 'array' then p->'filters' else '[]'::jsonb end) x), '{}');
  v_district text := nullif(lower(trim(coalesce(p->>'district', ''))), '');
  v_ptype text := nullif(upper(trim(coalesce(p->>'propertyType', ''))), '');
  v_result jsonb;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from public.properties pr where pr.id = p_property_id and pr.user_id = v_me and not pr.is_deleted) then
    raise exception 'not found' using errcode = '42501';
  end if;
  select s.seen_at into v_seen from public.internal_lead_seen s
   where s.account_user_id = v_me and s.property_id = p_property_id;

  with base as (
    select r.*, ip.transaction_type, ip.intent_type::text as intent_type, ip.property_types,
           ip.country, ip.city, ip.district, ip.neighborhoods,
           ip.budget_min, ip.budget_max, ip.currency,
           ip.bedrooms_min, ip.bedrooms_max, ip.rooms_min, ip.rooms_max, ip.area_min, ip.area_max,
           public.internal_lead_features(ip.requirements) as features,
           ip.created_at as demand_at,
           greatest(ip.created_at, coalesce(ip.last_active_at, ip.created_at), coalesce(sub.last_active_at, sub.created_at)) as active_at,
           case when sub.on_behalf then 'BROKER_FOR_CLIENT'
                when usr.account_type::text is distinct from 'PERSONAL' then 'PROFESSIONAL'
                else 'DIRECT' end as searcher,
           seg.segment, seg.budget_usd,
           case when upper(coalesce(ip.transaction_type, '')) in ('RENT', 'LEASE', 'RENTAL') then 'RENT' else 'SALE' end as tx,
           case when r.match_score >= 0.8 then 'STRONG' when r.match_score >= 0.5 then 'POTENTIAL' else 'WEAK' end as band,
           (u.id is not null) as unlocked,
           c.status as crm_status, c.id as crm_entry_id,
           exists (select 1 from public.internal_lead_saved sv where sv.account_user_id = v_me and sv.match_id = r.match_id) as saved,
           (c.status is not null and c.status <> 'UNLOCKED') as contacted,
           ((v_seen is null and r.matched_at > now() - interval '7 days') or (v_seen is not null and r.matched_at > v_seen)) as fresh,
           prefs.share_phone_on_unlock, prefs.share_email_on_unlock,
           usr.phone is not null and length(usr.phone) > 4 as has_phone,
           usr.email is not null and position('@' in usr.email) > 1 as has_email,
           usr.nickname, usr.full_name, usr.preferred_language
      from public.internal_lead_rows(v_me, p_property_id) r
      join public.intent_profiles ip on ip.id = r.intent_profile_id
      join public.users usr on usr.id = r.lead_user_id
      left join lateral (select s.on_behalf, s.last_active_at, s.created_at
                           from public.active_search_subscriptions s
                          where s.user_id = r.lead_user_id and s.intent_id = r.intent_profile_id and s.is_active
                          order by s.created_at desc limit 1) sub on true
      cross join lateral public.internal_lead_segment(r.intent_profile_id) seg
      cross join lateral public.lead_contact_prefs_of(r.lead_user_id) prefs
      left join public.internal_lead_unlocks u on u.account_user_id = v_me and u.lead_user_id = r.lead_user_id
      left join public.lead_crm_entries c on c.owner_user_id = v_me and c.lead_user_id = r.lead_user_id
  ), marked as (
    select b.*, (b.active_at < now() - interval '45 days') as stale from base b
  ), filtered as (
    select * from marked b
     where (not ('STRONG' = any (v_filters)) or b.band = 'STRONG')
       and (not ('POTENTIAL' = any (v_filters)) or b.band = 'POTENTIAL')
       and (not ('STANDARD' = any (v_filters)) or b.segment = 'STANDARD')
       and (not ('PREMIUM' = any (v_filters)) or b.segment = 'PREMIUM')
       and (not ('FRESH' = any (v_filters)) or b.fresh)
       and (not ('UNLOCKED' = any (v_filters)) or b.unlocked)
       and (not ('LOCKED' = any (v_filters)) or not b.unlocked)
       and (not ('CONTACTED' = any (v_filters)) or b.contacted)
       and (not ('SAVED' = any (v_filters)) or b.saved)
       and (not ('DIRECT' = any (v_filters)) or b.searcher = 'DIRECT')
       and (not ('BROKER' = any (v_filters)) or b.searcher <> 'DIRECT')
       and (not ('STALE' = any (v_filters)) or b.stale)
       and (not ('ACTIVE' = any (v_filters)) or not b.stale)
       and (v_district is null or lower(coalesce(b.district, '')) = v_district
            or exists (select 1 from unnest(coalesce(b.neighborhoods, '{}'::text[])) nb where lower(nb) = v_district))
       and (v_ptype is null or v_ptype = any (coalesce(b.property_types, '{}'::text[])))
  ), page as (
    select f.*, row_number() over (order by
       case when v_sort = 'BEST' then f.match_score end desc nulls last,
       case when v_sort = 'NEWEST' then f.demand_at end desc nulls last,
       case when v_sort = 'ACTIVE' then f.active_at end desc nulls last,
       case when v_sort = 'UPDATED' then f.updated_at end desc nulls last,
       case when v_sort = 'BUDGET_DESC' then f.budget_usd end desc nulls last,
       case when v_sort = 'BUDGET_ASC' then f.budget_usd end asc nulls last,
       f.match_score desc, f.match_id) as rn
      from filtered f
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'counts', (select jsonb_build_object(
        'ALL', count(*),
        'STRONG', count(*) filter (where band = 'STRONG'),
        'POTENTIAL', count(*) filter (where band = 'POTENTIAL'),
        'STANDARD', count(*) filter (where segment = 'STANDARD'),
        'PREMIUM', count(*) filter (where segment = 'PREMIUM'),
        'FRESH', count(*) filter (where fresh),
        'UNLOCKED', count(*) filter (where unlocked),
        'LOCKED', count(*) filter (where not unlocked),
        'CONTACTED', count(*) filter (where contacted),
        'SAVED', count(*) filter (where saved),
        'DIRECT', count(*) filter (where searcher = 'DIRECT'),
        'BROKER', count(*) filter (where searcher <> 'DIRECT'),
        'STALE', count(*) filter (where stale),
        'ACTIVE', count(*) filter (where not stale)) from marked),
    'facets', jsonb_build_object(
        'districts', coalesce((select jsonb_agg(distinct d order by d) from (
            select b.district as d from marked b where b.district is not null
            union select nb from marked b, unnest(coalesce(b.neighborhoods, '{}'::text[])) nb) x), '[]'::jsonb),
        'propertyTypes', coalesce((select jsonb_agg(distinct t order by t) from marked b, unnest(coalesce(b.property_types, '{}'::text[])) t), '[]'::jsonb)),
    'prices', public.internal_lead_prices(),
    'lastSeenAt', v_seen,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'matchId', pg.match_id,
        'score', round(pg.match_score * 100),
        'band', pg.band,
        'segment', pg.segment,
        'priceCredits', (public.internal_lead_prices() ->> pg.segment)::numeric,
        'unlocked', pg.unlocked,
        'contacted', pg.contacted,
        'crmStatus', pg.crm_status,
        'crmEntryId', pg.crm_entry_id,
        'saved', pg.saved,
        'fresh', pg.fresh,
        'stale', pg.stale,
        'searcher', pg.searcher,
        'transaction', pg.tx,
        'intentType', pg.intent_type,
        'propertyTypes', to_jsonb(coalesce(pg.property_types, '{}'::text[])),
        'locations', jsonb_build_object('city', pg.city, 'district', pg.district,
                                        'neighborhoods', to_jsonb(coalesce(pg.neighborhoods, '{}'::text[]))),
        'budget', case when pg.budget_min is null and pg.budget_max is null then null else jsonb_build_object(
                    'min', public.internal_lead_round_budget(pg.budget_min, pg.tx),
                    'max', public.internal_lead_round_budget(pg.budget_max, pg.tx),
                    'currency', pg.currency) end,
        'requirements', jsonb_strip_nulls(jsonb_build_object(
                    'bedroomsMin', pg.bedrooms_min, 'bedroomsMax', pg.bedrooms_max,
                    'roomsMin', pg.rooms_min, 'roomsMax', pg.rooms_max,
                    'areaMin', pg.area_min, 'areaMax', pg.area_max)),
        'features', pg.features,
        'agreed', to_jsonb(pg.agreed),
        'conflicted', to_jsonb(pg.conflicted),
        'unknown', to_jsonb(pg.unknown_dimensions),
        'demandAt', pg.demand_at,
        'activeAt', pg.active_at,
        'matchedAt', pg.matched_at,
        'updatedAt', pg.updated_at,
        'contactOptions', jsonb_build_object(
            'message', true,
            'phone', pg.share_phone_on_unlock and pg.has_phone,
            'email', pg.share_email_on_unlock and pg.has_email),
        'displayName', case when pg.unlocked then coalesce(nullif(pg.nickname, ''),
                         nullif(split_part(coalesce(pg.full_name, ''), ' ', 1), '')) end,
        'language', case when pg.unlocked then pg.preferred_language::text end
      ) order by pg.rn) from page pg where pg.rn > v_offset and pg.rn <= v_offset + v_limit), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.internal_leads_feed_v2(uuid, jsonb) from public, anon;
grant execute on function public.internal_leads_feed_v2(uuid, jsonb) to authenticated;

/* ════════════════════════════════════════════════════════════════════════
 * 4 · CRM stages and logged contact
 * ════════════════════════════════════════════════════════════════════════ */

alter table public.lead_crm_entries drop constraint if exists lead_crm_entries_status_check;
alter table public.lead_crm_entries add constraint lead_crm_entries_status_check check (status in
  ('UNLOCKED', 'CONTACT_PLANNED', 'CONTACTED', 'DELIVERED', 'REPLIED', 'INTERESTED',
   'VIEWING_SCHEDULED', 'NEGOTIATING', 'CONVERTED', 'CLOSED', 'NOT_INTERESTED'));

create or replace function public.crm_list(p_status text default null, p_search text default null,
                                           p_limit integer default 30, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_limit integer := greatest(1, least(coalesce(p_limit, 30), 100));
  v_q text := nullif(trim(coalesce(p_search, '')), '');
  v_out jsonb;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  with rows as (
    select e.*, u.nickname, u.full_name, u.preferred_language,
           pr.title as property_title, pr.homatch_id,
           public.crm_conversation_of(v_me, e.lead_user_id, e.property_id) as conversation_id,
           (select count(*) from public.lead_crm_notes n where n.entry_id = e.id) as note_count,
           ul.segment as unlock_segment, ul.created_at as unlocked_at
      from public.lead_crm_entries e
      join public.users u on u.id = e.lead_user_id
      left join public.properties pr on pr.id = e.property_id
      left join public.internal_lead_unlocks ul on ul.id = e.unlock_id
     where e.owner_user_id = v_me
       and (p_status is null or upper(p_status) = 'ALL'
            or (upper(p_status) = 'DUE' and e.follow_up_at <= now())
            or e.status = upper(p_status))
       and (v_q is null or coalesce(u.nickname, '') ilike '%' || v_q || '%'
                       or coalesce(u.full_name, '') ilike '%' || v_q || '%'
                       or coalesce(pr.title, '') ilike '%' || v_q || '%'
                       or coalesce(pr.homatch_id::text, '') = v_q)
  )
  select jsonb_build_object(
    'total', (select count(*) from rows),
    'counts', (select jsonb_object_agg(s, (select count(*) from public.lead_crm_entries x where x.owner_user_id = v_me and x.status = s))
                 from unnest(array['UNLOCKED','CONTACT_PLANNED','CONTACTED','DELIVERED','REPLIED','INTERESTED',
                                   'VIEWING_SCHEDULED','NEGOTIATING','CONVERTED','CLOSED','NOT_INTERESTED']) s),
    'dueFollowUps', (select count(*) from public.lead_crm_entries x where x.owner_user_id = v_me and x.follow_up_at <= now()),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'entryId', r.id,
        'displayName', coalesce(nullif(r.nickname, ''), nullif(split_part(coalesce(r.full_name, ''), ' ', 1), '')),
        'language', r.preferred_language::text,
        'status', r.status,
        'propertyId', r.property_id,
        'propertyTitle', r.property_title,
        'homatchId', r.homatch_id,
        'conversationId', r.conversation_id,
        'followUpAt', r.follow_up_at,
        'followUpNote', r.follow_up_note,
        'noteCount', r.note_count,
        'segment', r.unlock_segment,
        'unlockedAt', coalesce(r.unlocked_at, r.created_at),
        'lastActivityAt', r.last_activity_at,
        'createdAt', r.created_at) order by r.last_activity_at desc)
        from (select * from rows order by last_activity_at desc limit v_limit offset greatest(0, coalesce(p_offset, 0))) r), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.crm_list(text, text, integer, integer) from public, anon;
grant execute on function public.crm_list(text, text, integer, integer) to authenticated;

/*
 * The lead's documented requirements and the match explanation for the CRM profile:
 * only once the owner holds the entitlement (the entry exists only after an unlock).
 */
create or replace function public.crm_entry_profile(p_entry_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_e record;
  v_m record;
  v_ip record;
  v_u record;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_e from public.lead_crm_entries where id = p_entry_id and owner_user_id = v_me;
  if not found then raise exception 'not found' using errcode = '42501'; end if;
  select ul.segment, ul.created_at, ul.credits_charged into v_u from public.internal_lead_unlocks ul where ul.id = v_e.unlock_id;
  select m.* into v_m from public.supply_matches m
   where m.demand_user_id = v_e.lead_user_id and m.supply_user_id = v_me and m.source_kind = 'INTERNAL_HOMATCH'
     and (v_e.property_id is null or m.property_id = v_e.property_id)
   order by m.match_score desc, m.updated_at desc limit 1;
  if v_m.intent_profile_id is not null then select * into v_ip from public.intent_profiles where id = v_m.intent_profile_id; end if;
  return jsonb_build_object(
    'entryId', v_e.id,
    'source', 'HOMATCH_MEMBER_SEARCH',
    'segment', v_u.segment,
    'unlockedAt', coalesce(v_u.created_at, v_e.created_at),
    'creditsCharged', v_u.credits_charged,
    'match', case when v_m.id is null then null else jsonb_build_object(
        'matchId', v_m.id, 'propertyId', v_m.property_id, 'score', round(v_m.match_score * 100), 'agreed', to_jsonb(coalesce(v_m.agreed, '{}')),
        'conflicted', to_jsonb(coalesce(v_m.conflicted, '{}')), 'unknown', to_jsonb(coalesce(v_m.unknown_dimensions, '{}')),
        'matchedAt', v_m.created_at) end,
    'demand', case when v_ip.id is null then null else jsonb_strip_nulls(jsonb_build_object(
        'transaction', case when upper(coalesce(v_ip.transaction_type, '')) in ('RENT', 'LEASE', 'RENTAL') then 'RENT' else 'SALE' end,
        'propertyTypes', to_jsonb(coalesce(v_ip.property_types, '{}'::text[])),
        'city', v_ip.city, 'district', v_ip.district, 'neighborhoods', to_jsonb(coalesce(v_ip.neighborhoods, '{}'::text[])),
        'budgetMin', v_ip.budget_min, 'budgetMax', v_ip.budget_max, 'currency', v_ip.currency,
        'bedroomsMin', v_ip.bedrooms_min, 'bedroomsMax', v_ip.bedrooms_max,
        'roomsMin', v_ip.rooms_min, 'roomsMax', v_ip.rooms_max, 'areaMin', v_ip.area_min, 'areaMax', v_ip.area_max,
        'features', public.internal_lead_features(v_ip.requirements),
        'statedAt', v_ip.created_at, 'activeAt', coalesce(v_ip.last_active_at, v_ip.created_at))) end,
    'drafts', coalesce((select jsonb_agg(jsonb_build_object('createdAt', ev.created_at, 'detail', ev.detail) order by ev.created_at desc)
                          from (select * from public.lead_crm_events where entry_id = v_e.id and kind = 'AI_DRAFT'
                                 order by created_at desc limit 10) ev), '[]'::jsonb));
end $$;
revoke all on function public.crm_entry_profile(uuid) from public, anon;
grant execute on function public.crm_entry_profile(uuid) to authenticated;

create or replace function public.crm_update(p_entry_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_e record;
  v_status text := upper(nullif(p->>'status', ''));
  v_channel text := upper(nullif(p->>'logContact', ''));
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_e from public.lead_crm_entries where id = p_entry_id and owner_user_id = v_me for update;
  if not found then raise exception 'not found' using errcode = '42501'; end if;

  if v_status is not null and v_status <> v_e.status then
    if v_status not in ('UNLOCKED','CONTACT_PLANNED','CONTACTED','DELIVERED','REPLIED','INTERESTED',
                        'VIEWING_SCHEDULED','NEGOTIATING','CONVERTED','CLOSED','NOT_INTERESTED') then
      raise exception 'invalid status' using errcode = '22023';
    end if;
    update public.lead_crm_entries set status = v_status, status_set_by = 'OWNER', last_activity_at = now(), updated_at = now()
     where id = p_entry_id;
    insert into public.lead_crm_events (entry_id, kind, detail)
    values (p_entry_id, 'STATUS_CHANGED', jsonb_build_object('from', v_e.status, 'to', v_status, 'by', 'OWNER'));
    v_e.status := v_status;
  end if;

  /* The owner says they contacted the member outside HOMATCH (WhatsApp, a call …):
     recorded as their statement, and CONTACTED only moves forward from UNLOCKED/PLANNED. */
  if v_channel is not null then
    if v_channel not in ('PHONE', 'WHATSAPP', 'TELEGRAM', 'SMS', 'EMAIL', 'IN_PERSON', 'OTHER') then
      raise exception 'invalid channel' using errcode = '22023';
    end if;
    insert into public.lead_crm_events (entry_id, kind, detail)
    values (p_entry_id, 'CONTACT_LOGGED', jsonb_build_object('channel', v_channel, 'by', 'OWNER',
            'outcome', left(nullif(trim(coalesce(p->>'outcome', '')), ''), 300)));
    if v_e.status in ('UNLOCKED', 'CONTACT_PLANNED') then
      update public.lead_crm_entries set status = 'CONTACTED', status_set_by = 'OWNER', last_activity_at = now(), updated_at = now()
       where id = p_entry_id;
      insert into public.lead_crm_events (entry_id, kind, detail)
      values (p_entry_id, 'STATUS_CHANGED', jsonb_build_object('from', v_e.status, 'to', 'CONTACTED', 'by', 'OWNER', 'channel', v_channel));
    else
      update public.lead_crm_entries set last_activity_at = now(), updated_at = now() where id = p_entry_id;
    end if;
  end if;

  if p ? 'note' and length(trim(coalesce(p->>'note', ''))) > 0 then
    insert into public.lead_crm_notes (entry_id, body) values (p_entry_id, left(trim(p->>'note'), 4000));
    insert into public.lead_crm_events (entry_id, kind) values (p_entry_id, 'NOTE_ADDED');
    update public.lead_crm_entries set last_activity_at = now(), updated_at = now() where id = p_entry_id;
  end if;

  if p ? 'followUpAt' then
    update public.lead_crm_entries
       set follow_up_at = nullif(p->>'followUpAt', '')::timestamptz,
           follow_up_note = left(nullif(trim(coalesce(p->>'followUpNote', '')), ''), 500),
           follow_up_notified_at = null, updated_at = now()
     where id = p_entry_id;
    insert into public.lead_crm_events (entry_id, kind, detail)
    values (p_entry_id, case when nullif(p->>'followUpAt', '') is null then 'FOLLOW_UP_CLEARED' else 'FOLLOW_UP_SCHEDULED' end,
            jsonb_build_object('at', nullif(p->>'followUpAt', '')));
  end if;
  return public.crm_entry_detail(p_entry_id);
end $$;
revoke all on function public.crm_update(uuid, jsonb) from public, anon;
grant execute on function public.crm_update(uuid, jsonb) to authenticated;

/* ════════════════════════════════════════════════════════════════════════
 * 5 · Email Studio scheduling
 * ════════════════════════════════════════════════════════════════════════ */

alter table public.email_studio_campaigns
  add column if not exists scheduled_at timestamptz,
  add column if not exists scheduled_hash text,
  add column if not exists schedule_timezone text,
  add column if not exists schedule_state text,
  add column if not exists schedule_attempted_at timestamptz;
create index if not exists email_studio_campaigns_due on public.email_studio_campaigns (scheduled_at)
  where scheduled_at is not null;

/*
 * Schedule a REVIEWED campaign: the exact reviewed version is what will be sent. Editing
 * the campaign changes its version hash, so begin_send then refuses (VERSION_MISMATCH) —
 * a schedule never sends something the owner did not review.
 */
create or replace function public.email_studio_schedule(p_campaign_id uuid, p_at timestamptz, p_timezone text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_c record;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_c from public.email_studio_campaigns where id = p_campaign_id and owner_user_id = v_me for update;
  if not found then raise exception 'not found' using errcode = '42501'; end if;
  if p_at is null then
    update public.email_studio_campaigns set scheduled_at = null, scheduled_hash = null, schedule_timezone = null,
           schedule_state = 'CANCELLED', updated_at = now() where id = p_campaign_id;
    return jsonb_build_object('ok', true, 'scheduledAt', null);
  end if;
  if v_c.status <> 'REVIEWED' or v_c.reviewed_hash is null then raise exception 'NOT_REVIEWED' using errcode = '22023'; end if;
  if p_at < now() + interval '5 minutes' or p_at > now() + interval '90 days' then raise exception 'INVALID_TIME' using errcode = '22023'; end if;
  update public.email_studio_campaigns
     set scheduled_at = p_at, scheduled_hash = v_c.reviewed_hash, schedule_timezone = left(nullif(trim(coalesce(p_timezone, '')), ''), 64),
         schedule_state = 'SCHEDULED', schedule_attempted_at = null, updated_at = now()
   where id = p_campaign_id;
  return jsonb_build_object('ok', true, 'scheduledAt', p_at);
end $$;
revoke all on function public.email_studio_schedule(uuid, timestamptz, text) from public, anon;
grant execute on function public.email_studio_schedule(uuid, timestamptz, text) to authenticated;

/* Due scheduled campaigns for jobs-worker (service role): REVIEWED at their time, or SENDING
   (a scheduled send that needs another batch). Claimed for 2 minutes to avoid double dispatch. */
create or replace function public.email_studio_claim_due_scheduled(p_limit integer default 5)
returns table (campaign_id uuid, owner_user_id uuid, version_hash text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select c.id from public.email_studio_campaigns c
     where c.scheduled_at is not null and c.scheduled_at <= now() and c.scheduled_hash is not null
       and c.status in ('REVIEWED', 'SENDING')
       and (c.schedule_attempted_at is null or c.schedule_attempted_at < now() - interval '2 minutes')
     order by c.scheduled_at
     limit greatest(1, least(coalesce(p_limit, 5), 20))
     for update skip locked
  )
  update public.email_studio_campaigns c set schedule_attempted_at = now()
    from due where c.id = due.id
  returning c.id, c.owner_user_id, c.scheduled_hash;
end $$;
revoke all on function public.email_studio_claim_due_scheduled(integer) from public, anon, authenticated;
grant execute on function public.email_studio_claim_due_scheduled(integer) to service_role;

/* The outcome of a scheduled attempt, as the owner should see it. A refusal ends the schedule:
   it is never silently re-armed for some later moment. */
create or replace function public.email_studio_schedule_outcome(p_campaign_id uuid, p_state text)
returns void language sql security definer set search_path = public as $$
  update public.email_studio_campaigns
     set schedule_state = left(p_state, 40),
         scheduled_at = case when p_state in ('SENT', 'SENDING') then scheduled_at else null end,
         updated_at = now()
   where id = p_campaign_id;
$$;
revoke all on function public.email_studio_schedule_outcome(uuid, text) from public, anon, authenticated;
grant execute on function public.email_studio_schedule_outcome(uuid, text) to service_role;

/* ════════════════════════════════════════════════════════════════════════
 * 6 · "Find Internal Matches" — the real matcher's state for one listing
 * ════════════════════════════════════════════════════════════════════════ */

/*
 * What the owner's search screen shows while HOMATCH compares the listing with every active
 * member search: whether the listing is still queued or being scanned (the matcher deletes
 * the queue row when the scan completes), how many active member searches exist to compare
 * with (a count, never who), and how many eligible matches there are now. Free; owner-only.
 */
create or replace function public.internal_leads_match_status(p_property_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_q record;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from public.properties p where p.id = p_property_id and p.user_id = v_me and not p.is_deleted) then
    raise exception 'not found' using errcode = '42501';
  end if;
  select * into v_q from public.native_match_property_queue where property_id = p_property_id;
  return jsonb_build_object(
    'queued', v_q.property_id is not null,
    'scanning', v_q.property_id is not null and (v_q.scan_started_at is not null or v_q.leased_until > now()),
    'enqueuedAt', v_q.enqueued_at,
    'retrying', v_q.property_id is not null and v_q.last_error is not null,
    'activeSearches', (select count(*) from public.active_search_subscriptions s
                        where s.is_active and s.side = 'SUPPLY' and s.user_id <> v_me and s.intent_id is not null),
    'matches', (select count(*) from public.internal_lead_rows(v_me, p_property_id)),
    'checkedAt', now());
end $$;
revoke all on function public.internal_leads_match_status(uuid) from public, anon;
grant execute on function public.internal_leads_match_status(uuid) to authenticated;
