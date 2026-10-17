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
-- Additive: two nullable columns, the view re-created with one more filter, two
-- functions. Rollback: drop the two functions, re-create the view without the
-- owner_cleared_at filter, drop the columns.

alter table public.find_buyers_leads add column if not exists owner_cleared_at timestamptz;
alter table public.matches add column if not exists owner_cleared_at timestamptz;

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
   where j.property_id = p_property_id and j.status not in ('completed', 'partially_completed', 'failed', 'cancelled', 'canceled');
  return jsonb_build_object(
    'leads', (select count(*) from public.find_buyers_leads l
               where l.property_id = p_property_id and l.owner_cleared_at is null
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

/* The clear itself: hides, never deletes; idempotent (already-cleared rows are left as they are). */
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
  if not public.find_buyers_may_clear_results(p_property_id) then
    raise exception 'FORBIDDEN';
  end if;
  select coalesce(array_agg(j.id), '{}') into v_active from public.matching_jobs j
   where j.property_id = p_property_id and j.status not in ('completed', 'partially_completed', 'failed', 'cancelled', 'canceled');
  update public.find_buyers_leads l set owner_cleared_at = v_now
   where l.property_id = p_property_id and l.owner_cleared_at is null and not (l.matching_job_id = any (v_active));
  get diagnostics v_leads = row_count;
  update public.matches m set owner_cleared_at = v_now
   where m.property_id = p_property_id and m.owner_cleared_at is null and coalesce(m.status, '') <> 'UNLOCKED';
  get diagnostics v_matches = row_count;
  return jsonb_build_object('leadsCleared', v_leads, 'legacyMatchesCleared', v_matches, 'clearedAt', v_now);
end;
$function$;

revoke all on function public.find_buyers_may_clear_results(uuid) from public, anon;
revoke all on function public.find_buyers_clear_results_preview(uuid) from public, anon;
revoke all on function public.find_buyers_clear_results(uuid) from public, anon;
grant execute on function public.find_buyers_may_clear_results(uuid) to authenticated, service_role;
grant execute on function public.find_buyers_clear_results_preview(uuid) to authenticated, service_role;
grant execute on function public.find_buyers_clear_results(uuid) to authenticated, service_role;
