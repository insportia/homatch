-- FIND BUYERS / FIND TENANTS — the owner clears old results (owner, 2026-10-17).
--
-- "I want to clear previous buyer-match results from my account." An explicit,
-- owner-scoped, confirmed action — never automatic. Clearing HIDES results; it
-- deletes nothing:
--   find_buyers_leads   owner_cleared_at set → left out of find_buyers_current_leads
--   matches (legacy)    owner_cleared_at set → left out of the customer lists
-- Untouched: the property, an active campaign (its leads are never cleared), credit
-- transactions and ledgers, Actor runs, assessments, raw signals, audit records,
-- other users' rows. A cleared person found again on the same signal stays a
-- duplicate (pipeline campaign-delivery dedupe), so cleared results do not come
-- back; a NEW signal from that person is a new result.
-- Contacts the owner already PAID to open (matches.status = 'UNLOCKED') stay
-- visible: hiding a paid contact is not what "clear old results" means.
--
-- Additive: three nullable columns, the view re-created with one more filter, three new
-- functions, and find_buyers_research_opportunities re-created (same signature) so a
-- cleared search's opportunities and interested counts stay hidden. Rollback: drop the
-- three new functions, re-create the view and find_buyers_research_opportunities from
-- 20261109100000 / their previous definitions, drop the columns.

alter table public.find_buyers_leads add column if not exists owner_cleared_at timestamptz;
alter table public.matches add column if not exists owner_cleared_at timestamptz;
/* A cleared (finished) search: its research opportunities are not shown again either. */
alter table public.find_buyers_campaigns add column if not exists owner_cleared_at timestamptz;

create or replace view public.find_buyers_current_leads with (security_invoker = true) as
 SELECT id,
    matching_job_id,
    campaign_id,
    property_id,
    user_id,
    person_id,
    author_name,
    author_profile_url,
    counterpart,
    source,
    intent_class,
    overall_score,
    strength,
    similarity,
    intent_score,
    score_components,
    explanation,
    best_signal_id,
    parent_signal_id,
    evidence,
    signal_count,
    signal_at,
    seen_before,
    language,
    created_at,
    updated_at,
    role,
    transaction,
    match_category,
    rejection_reasons,
    budget_fit,
    location_fit,
    requirements_fit,
    qualification,
    qualification_version,
    requalified_at
   FROM public.find_buyers_leads l
  WHERE (public.find_buyers_signal_is_current(signal_at) AND (COALESCE(match_category, 'POTENTIAL'::text) <> 'REJECTED'::text) AND owner_cleared_at IS NULL);

/* The caller may clear this property's results: its owner (or an admin / the service role). */
create or replace function public.find_buyers_may_clear_results(p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', current_setting('request.jwt.claim.role', true), '') = 'service_role'
      or public.is_admin()
      or exists (select 1 from public.properties p where p.id = p_property_id and p.user_id = public.auth_user_id() and coalesce(p.is_deleted, false) = false);
$function$;

/* What a clear would hide now — shown in the confirmation dialog before anything changes. */
create or replace function public.find_buyers_clear_results_preview(p_property_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_active uuid[];
begin
  if not public.find_buyers_may_clear_results(p_property_id) then
    raise exception 'FORBIDDEN';
  end if;
  select coalesce(array_agg(j.id), '{}') into v_active from public.matching_jobs j
   where j.property_id = p_property_id and j.status not in ('completed', 'partially_completed', 'failed', 'cancelled', 'budget_reached');
  return jsonb_build_object(
    'leads', (select count(*) from public.find_buyers_leads l
               where l.property_id = p_property_id and l.owner_cleared_at is null
                 and public.find_buyers_signal_is_current(l.signal_at)
                 and coalesce(l.match_category, 'POTENTIAL') <> 'REJECTED' and not (l.matching_job_id = any (v_active))),
    'legacyMatches', (select count(*) from public.matches m
               where m.property_id = p_property_id and m.owner_cleared_at is null
                 and coalesce(m.status, '') not in ('UNLOCKED', 'REJECTED')),
    'legacyUnlockedKept', (select count(*) from public.matches m
               where m.property_id = p_property_id and m.owner_cleared_at is null and m.status = 'UNLOCKED'),
    'activeCampaign', cardinality(v_active) > 0
  );
end;
$function$;

/* The clear itself: hides, never deletes; idempotent (already-cleared rows are left as they are).
   Only the property's owner (or the service role) may clear: an admin can preview, never hide
   another user's results. leadsCleared / legacyMatchesCleared count what the owner could see —
   the same rows the preview counted; already-hidden rows (rejected, older than 30 days) are
   stamped too but not counted. */
create or replace function public.find_buyers_clear_results(p_property_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_active uuid[];
  v_now timestamptz := now();
  v_leads integer;
  v_matches integer;
begin
  if not (coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', current_setting('request.jwt.claim.role', true), '') = 'service_role'
          or exists (select 1 from public.properties p where p.id = p_property_id and p.user_id = public.auth_user_id() and coalesce(p.is_deleted, false) = false)) then
    raise exception 'FORBIDDEN';
  end if;
  select coalesce(array_agg(j.id), '{}') into v_active from public.matching_jobs j
   where j.property_id = p_property_id and j.status not in ('completed', 'partially_completed', 'failed', 'cancelled', 'budget_reached');
  with u as (
    update public.find_buyers_leads l set owner_cleared_at = v_now
     where l.property_id = p_property_id and l.owner_cleared_at is null and not (l.matching_job_id = any (v_active))
    returning l.signal_at, l.match_category)
  select count(*) filter (where public.find_buyers_signal_is_current(u.signal_at) and coalesce(u.match_category, 'POTENTIAL') <> 'REJECTED')
    into v_leads from u;
  with u as (
    update public.matches m set owner_cleared_at = v_now
     where m.property_id = p_property_id and m.owner_cleared_at is null and coalesce(m.status, '') <> 'UNLOCKED'
    returning m.status)
  select count(*) filter (where coalesce(u.status, '') <> 'REJECTED') into v_matches from u;
  update public.find_buyers_campaigns c set owner_cleared_at = v_now
   where c.property_id = p_property_id and c.owner_cleared_at is null and not (c.matching_job_id = any (v_active));
  return jsonb_build_object('leadsCleared', v_leads, 'legacyMatchesCleared', v_matches, 'clearedAt', v_now);
end;
$function$;

revoke all on function public.find_buyers_may_clear_results(uuid) from public, anon;
revoke all on function public.find_buyers_clear_results_preview(uuid) from public, anon;
revoke all on function public.find_buyers_clear_results(uuid) from public, anon;
grant execute on function public.find_buyers_may_clear_results(uuid) to authenticated, service_role;
grant execute on function public.find_buyers_clear_results_preview(uuid) to authenticated, service_role;
grant execute on function public.find_buyers_clear_results(uuid) to authenticated, service_role;

/* Research opportunities of a cleared search are not shown again (same signature as
   20261109100000; only the cleared checks are new). */
create or replace function public.find_buyers_research_opportunities(p_job_id uuid)
returns table (
  signal_id uuid,
  url text,
  excerpt text,
  author_name text,
  published_at timestamptz,
  language text,
  similarity integer,
  reported_comments integer,
  comments_state text,
  interested_count integer,
  source text,
  source_kind text,
  competitor boolean
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_listing_role text;
  v_skip_below integer;
begin
  /* The property owner (campaign or property row) or an admin; anything else —
     including a job that does not exist — is FORBIDDEN (no existence leak). */
  if not (coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', current_setting('request.jwt.claim.role', true), '') = 'service_role'
          or public.is_admin() or exists (
        select 1 from public.find_buyers_campaigns c
         where c.matching_job_id = p_job_id
           and (c.user_id = public.auth_user_id()
                or exists (select 1 from public.properties p where p.id = c.property_id and p.user_id = public.auth_user_id())))) then
    raise exception 'FORBIDDEN';
  end if;

  select case when c.transaction = 'RENT' then 'RENT_OFFER' else 'SALE_OFFER' end
    into v_listing_role from public.find_buyers_campaigns c where c.matching_job_id = p_job_id;
  /* The owner cleared this search's results (20261112100000): nothing to show again. */
  if exists (select 1 from public.find_buyers_campaigns c where c.matching_job_id = p_job_id and c.owner_cleared_at is not null) then
    return;
  end if;
  /* The pipeline's own comment gate floor (find_buyers_comment_gate.skipBelow, default 55). */
  select coalesce((select round((s.value ->> 'skipBelow')::numeric)::int from public.admin_settings s
                     where s.key = 'find_buyers_comment_gate' and (s.value ->> 'skipBelow') ~ '^\d+(\.\d+)?$'), 55)
    into v_skip_below;

  return query
  with posts as (
    select a.signal_id, a.similarity, a.qualification,
           case when (a.qualification ->> 'reportedComments') ~ '^\d+$' then (a.qualification ->> 'reportedComments')::int end as reported
      from public.find_buyers_assessments a
     where a.matching_job_id = p_job_id
       and a.content_kind = 'POST'
       and a.role = v_listing_role
       and coalesce(a.similarity, 0) >= v_skip_below
       and a.signal_id is not null
  ), comments as (
    select a.parent_signal_id, count(*)::int as n
      from public.find_buyers_assessments a
     where a.matching_job_id = p_job_id and a.content_kind = 'COMMENT' and a.parent_signal_id is not null
     group by a.parent_signal_id
  ), people as (
    select l.parent_signal_id, count(*)::int as n
      from public.find_buyers_leads l
     where l.matching_job_id = p_job_id and l.parent_signal_id is not null
       /* the same people the owner's lead list shows: current and not rejected */
       and public.find_buyers_signal_is_current(l.signal_at)
       and coalesce(l.match_category, 'POTENTIAL') <> 'REJECTED'
       and l.owner_cleared_at is null
     group by l.parent_signal_id
  )
  select p.signal_id,
         r.source_url,
         left(r.original_text, 300),
         r.author_public_name,
         r.published_at,
         r.language,
         p.similarity,
         p.reported,
         case when cm.n is not null then 'INSPECTED' else 'NOT_INSPECTED' end,
         coalesce(pe.n, 0),
         r.platform::text,
         coalesce(p.qualification ->> 'sourceKind', 'GROUP'),
         true
    from posts p
    join public.raw_signals r on r.id = p.signal_id
    left join comments cm on cm.parent_signal_id = p.signal_id
    left join people pe on pe.parent_signal_id = p.signal_id
   where r.source_url is not null
     and public.find_buyers_signal_is_current(r.published_at)
     /* the platform said "no comments": nothing to review */
     and coalesce(p.reported, -1) <> 0
   order by (cm.n is not null) desc, coalesce(p.reported, 0) desc, p.similarity desc
   limit 60;
end;
$function$;

revoke all on function public.find_buyers_research_opportunities(uuid) from public, anon;
grant execute on function public.find_buyers_research_opportunities(uuid) to authenticated, service_role;
