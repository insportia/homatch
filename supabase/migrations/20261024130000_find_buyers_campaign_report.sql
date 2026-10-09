-- FIND BUYERS / FIND TENANTS — the campaign report, from records only.
--
-- The owner asked what a paid search actually did. Two STABLE reads answer
-- it from the rows the campaign wrote — never from a model, never invented:
--
--   find_buyers_campaign_report(job)     the owner's (or admin's) report of
--     ONE campaign: property searched, buyer profile targeted, coverage
--     (languages, platforms, communities, posts, comments), research budget
--     used vs available (as a share — provider economics never reach the
--     owner), timing, results by match category and rejection reason, best
--     sources, limitations, planned vs executed coverage, and Research NOTE
--     codes with parameters, each computed from the same records.
--   admin_find_buyers_intelligence(days) the admin's cross-campaign view:
--     query and Actor effectiveness, false-positive rate after
--     re-qualification, rejection distribution, source quality, timing,
--     comment coverage, free vs paid Telegram, bottlenecks.
--
-- Legacy campaigns (before 20261024090000) have no role / match_category:
-- their leads are reported as UNCATEGORISED, never as qualified. New columns
-- are read through to_jsonb(row) so the same body serves a campaign written
-- before or after qualification existed.
-- Additive and read-only: two functions, no table changes.

create or replace function public.find_buyers_campaign_report(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v jsonb;
begin
  /* The property owner (campaign or property row) or an admin; anything else —
     including a job that does not exist — is FORBIDDEN (no existence leak). */
  if not (public.is_admin() or exists (
        select 1 from public.find_buyers_campaigns c
         where c.matching_job_id = p_job_id
           and (c.user_id = public.auth_user_id()
                or exists (select 1 from public.properties p where p.id = c.property_id and p.user_id = public.auth_user_id())))) then
    raise exception 'FORBIDDEN';
  end if;

  -- REPORT BODY BEGIN
  with c as (
    select x.matching_job_id, x.property_id, x.transaction, x.credits_committed, x.provider_budget_micros, x.languages,
           coalesce(x.dna, '{}'::jsonb) as dna, coalesce(x.query_plan, '{}'::jsonb) as qp, coalesce(x.stats, '{}'::jsonb) as st,
           x.stop_reason, x.finalized_at, x.created_at,
           case when jsonb_typeof(to_jsonb(x) -> 'strategy') = 'object' then to_jsonb(x) -> 'strategy' else '{}'::jsonb end as strategy,
           case when jsonb_typeof(to_jsonb(x) -> 'metrics') = 'object' then to_jsonb(x) -> 'metrics' else '{}'::jsonb end as metrics
      from public.find_buyers_campaigns x where x.matching_job_id = p_job_id
  ), w as (
    select case when c.transaction = 'RENT' then 'RENT_SEEKER' else 'BUY_SEEKER' end as seeker,
           case when c.transaction = 'RENT' then 'BUY_SEEKER' else 'RENT_SEEKER' end as other_seeker
      from c
  ), r as (
    select r.source, r.operation, r.status, r.language, coalesce(r.items_fetched, 0) as items, r.started_at,
           case when r.status in ('RESERVED', 'STARTING', 'RUNNING') then r.reserved_micros
                when r.status = 'RELEASED' then 0 else coalesce(r.actual_micros, r.reserved_micros) end as spent,
           r.operation in ('FB_GROUP_SEARCH', 'LINKEDIN_GROUPS') as disc,
           lower(substring(regexp_replace(coalesce(r.reason ->> 'targetUrl', ''), '^https?://(www\.|m\.|web\.)?', '')
                 from '^((?:facebook\.com/groups|vk\.com|t\.me|instagram\.com/explore/tags)/[^/?#]+)')) as tgt
      from public.find_buyers_actor_runs r where r.matching_job_id = p_job_id
  ), q as (
    select q.provider, q.status, q.language, q.cancel_reason, coalesce(q.metadata, '{}'::jsonb) as md,
           coalesce(q.finished_at, q.processed_at) as ended_at,
           (q.provider = 'TELEGRAM_SOURCES' or (q.provider = 'APIFY_MEMO23' and q.metadata ->> 'stage' in ('FB_GROUP_SEARCH', 'LINKEDIN_GROUPS'))) as p1
      from public.discovery_query_queue q where q.matching_job_id = p_job_id
  ), a as (
    select a.content_kind, a.intent_class, a.comments_decision,
           to_jsonb(a) ->> 'role' as role, to_jsonb(a) ->> 'match_category' as cat,
           case when jsonb_typeof(to_jsonb(a) -> 'rejection_reasons') = 'array' then to_jsonb(a) -> 'rejection_reasons' else '[]'::jsonb end as reasons
      from public.find_buyers_assessments a where a.matching_job_id = p_job_id
  ), l as (
    select l.source, l.created_at, public.find_buyers_signal_is_current(l.signal_at) as cur,
           to_jsonb(l) ->> 'role' as role, to_jsonb(l) ->> 'match_category' as cat,
           case when jsonb_typeof(to_jsonb(l) -> 'rejection_reasons') = 'array' then to_jsonb(l) -> 'rejection_reasons' else '[]'::jsonb end as reasons,
           coalesce(to_jsonb(l) ->> 'budget_fit', 'UNKNOWN') as bfit, coalesce(to_jsonb(l) ->> 'location_fit', 'UNKNOWN') as lfit,
           lower(substring(regexp_replace(coalesce(l.evidence -> 0 ->> 'url', ''), '^https?://(www\.|m\.|web\.)?', '')
                 from '^((?:facebook\.com/groups|vk\.com|t\.me|instagram\.com/explore/tags)/[^/?#]+)')) as tgt
      from public.find_buyers_leads l where l.matching_job_id = p_job_id
  ), rs as (
    /* Roles: the assessed signals once qualification wrote them, else the candidates. */
    select a.role, a.reasons from a where exists (select 1 from a a2 where a2.role is not null)
    union all
    select l.role, l.reasons from l where not exists (select 1 from a a2 where a2.role is not null)
  ), plat as (
    select r.source as platform, count(*) as runs,
           count(*) filter (where r.status in ('RESERVED', 'STARTING', 'RUNNING')) as live,
           count(*) filter (where r.status in ('SUCCEEDED', 'ABORTED', 'TIMED_OUT')) as ok,
           count(*) filter (where r.status = 'FAILED') as failed,
           sum(r.items) as items, sum(r.spent) as spent
      from r where r.status <> 'RELEASED' group by r.source
  ), plat2 as (
    select p.*, case when p.live > 0 then 'RUNNING' when p.items > 0 then 'READ' when p.ok > 0 then 'EMPTY' else 'FAILED' end as state,
           (select count(*) from l where l.source = p.platform and l.cur and l.cat in ('STRONG', 'POTENTIAL')) as qualified,
           (select count(*) from l where l.source = p.platform and l.cur and l.cat is null) as uncategorised
      from plat p
  ), m as (
    select
      c.transaction, coalesce(c.dna ->> 'counterpart', case when c.transaction = 'RENT' then 'TENANT' else 'BUYER' end) as counterpart,
      c.provider_budget_micros as budget_micros, c.credits_committed as credits, c.finalized_at is null as live,
      (select coalesce(sum(r.spent), 0) from r) as actor_micros,
      (select coalesce(sum(coalesce(g.actual_micros, g.estimated_micros)), 0) from public.find_buyers_cost_ledger g
        where g.matching_job_id = p_job_id and g.kind in ('AI', 'TRANSLATION') and g.cost_state <> 'RELEASED') as ai_micros,
      (select count(*) from a) as sig_total,
      (select count(*) from a where a.content_kind = 'POST') as sig_posts,
      (select count(*) from a where a.content_kind = 'COMMENT') as sig_comments,
      (select count(*) from a where a.content_kind = 'MESSAGE') as sig_messages,
      (select count(*) from rs where rs.role is not null) as role_known,
      (select count(*) from rs, w where rs.role = w.seeker) as seekers,
      (select count(*) from rs, w where rs.role = w.other_seeker) as other_seekers,
      (select count(*) from rs where rs.role in ('SALE_OFFER', 'RENT_OFFER', 'AGENT')) as supply_roles,
      (select count(*) from rs where rs.role = 'JOB' or rs.reasons ? 'JOB_SEARCH') as job_roles,
      (select count(*) from a where a.intent_class in ('SELLER', 'OWNER', 'AGENT')) as supply_intent,
      (select count(*) from a where a.intent_class is not null) as intent_known,
      (select count(*) from l, w where l.role = w.seeker) as genuine,
      (select count(*) from l, w where l.role = w.seeker and l.bfit = 'COMPATIBLE' and l.lfit = 'COMPATIBLE') as genuine_fit,
      (select count(*) from l, w where l.role = w.seeker and l.bfit = 'UNKNOWN') as genuine_budget_unknown,
      (select count(*) from l, w where l.role = w.seeker and l.lfit = 'UNKNOWN') as genuine_location_unknown,
      (select count(*) from l where l.cur and l.cat = 'STRONG') as strong,
      (select count(*) from l where l.cur and l.cat = 'POTENTIAL') as potential,
      (select count(*) from l where l.cur and l.cat = 'WEAK') as weak,
      (select count(*) from l where l.cur and l.cat is null) as uncategorised,
      (select count(*) from l where l.cat = 'REJECTED') as rejected,
      (select count(*) from l where not l.cur and coalesce(l.cat, '') <> 'REJECTED') as expired,
      (select count(*) from l where l.cur and coalesce(l.cat, '') <> 'REJECTED' and l.cat is not null and l.bfit = 'UNKNOWN') as cur_budget_unknown,
      (select count(*) from l where l.cur and coalesce(l.cat, '') <> 'REJECTED' and l.cat is not null and l.lfit = 'UNKNOWN') as cur_location_unknown,
      (select count(*) from l where l.cur and coalesce(l.cat, '') <> 'REJECTED' and l.cat is not null) as cur_categorised,
      (select count(*) from q where q.status = 'BUDGET_REACHED' or q.cancel_reason in ('PHASE1_BUDGET', 'BUDGET_REACHED')) as budget_stops,
      (select count(*) from q where q.cancel_reason = 'PHASE1_BUDGET') as phase1_budget_stops,
      (select count(*) from q where q.cancel_reason in ('CAMPAIGN_DEADLINE', 'RUN_DEADLINE')) as deadline_stops,
      (select coalesce(jsonb_agg(distinct q.language), '[]'::jsonb) from q
        where (q.status = 'BUDGET_REACHED' or q.cancel_reason in ('PHASE1_BUDGET', 'BUDGET_REACHED')) and q.p1 and q.language <> 'multi') as budget_cut_languages,
      (select count(distinct lower(regexp_replace(q.md ->> 'targetUrl', '/+$', ''))) from q
        where q.cancel_reason in ('CAMPAIGN_DEADLINE', 'RUN_DEADLINE') and q.md ->> 'targetUrl' is not null
          and not exists (select 1 from r where r.tgt is not null and r.items > 0
                           and lower(regexp_replace(q.md ->> 'targetUrl', '/+$', '')) like '%' || r.tgt)) as groups_unread,
      (select coalesce(jsonb_agg(p.platform order by p.platform), '[]'::jsonb) from plat2 p where p.state = 'FAILED') as failed_platforms,
      (select coalesce(jsonb_agg(p.platform order by p.platform), '[]'::jsonb) from plat2 p where p.state = 'EMPTY') as empty_platforms,
      (select coalesce(sum((q.md -> 'last_outcome' ->> 'newMessages')::numeric), 0)::int from q where q.provider = 'TELEGRAM') as tg_free_msgs,
      (select coalesce(sum((q.md -> 'last_outcome' ->> 'targetsConsidered')::numeric), 0)::int from q where q.provider = 'TELEGRAM') as tg_free_targets,
      (select count(*) from q where q.provider = 'TELEGRAM') as tg_free_jobs,
      (select coalesce(sum(r.items), 0) from r where r.operation = 'TELEGRAM_CHANNEL') as tg_paid_items,
      (select count(distinct r.tgt) from r where r.operation = 'TELEGRAM_CHANNEL' and r.status in ('SUCCEEDED', 'ABORTED', 'TIMED_OUT')) as tg_paid_channels,
      (select coalesce(sum((q.md -> 'last_outcome' ->> 'communitiesFound')::numeric), 0)::int
         from q where q.provider = 'TELEGRAM_SOURCES') as tg_discovered,
      (select coalesce(sum((q.md -> 'last_outcome' ->> 'activated')::numeric), 0)::int from q where q.provider = 'TELEGRAM_SOURCES') as tg_activated,
      (select coalesce(sum(r.items), 0) from r where r.disc) as groups_found,
      (select count(distinct r.tgt) from r where not r.disc and r.tgt is not null and r.status in ('SUCCEEDED', 'ABORTED', 'TIMED_OUT')) as communities_read,
      (select coalesce(sum(r.items), 0) from r where not r.disc) as posts_retrieved
    from c
  ), mm as (
    select m.*, m.actor_micros + m.ai_micros as used_micros,
           case when m.budget_micros > 0 then least(100, round(100.0 * (m.actor_micros + m.ai_micros) / m.budget_micros))::int end as used_pct
      from m
  )
  select jsonb_build_object(
    'jobId', c.matching_job_id,
    'generatedAt', now(),
    'live', mm.live,
    'legacy', mm.uncategorised > 0 or (mm.role_known = 0 and (select count(*) from l) > 0),
    /* What was searched for: the campaign's stored property DNA. */
    'property', jsonb_build_object(
      'transaction', c.transaction, 'counterpart', mm.counterpart,
      'propertyType', c.dna ->> 'propertyType', 'rooms', c.dna -> 'rooms', 'bedrooms', c.dna -> 'bedrooms',
      'areaSqm', c.dna -> 'areaSqm', 'price', c.dna -> 'price', 'currency', c.dna ->> 'currency',
      'city', c.dna ->> 'city', 'district', c.dna ->> 'district', 'neighborhood', c.dna ->> 'neighborhood'),
    /* Who was looked for: the property-specific strategy when the campaign
       stored one, else the tolerances derived from the property itself. */
    'buyerProfile', jsonb_build_object(
      'basis', case when c.strategy ?| array['personas', 'budgetBand', 'places'] then 'STRATEGY' else 'PROPERTY' end,
      'personas', case when jsonb_typeof(c.strategy -> 'personas') = 'array' then c.strategy -> 'personas' else '[]'::jsonb end,
      'budgetBand', coalesce(c.strategy -> 'budgetBand', case when c.dna #> '{tolerances,price}' is not null then jsonb_build_object(
          'min', c.dna #> '{tolerances,price,min}', 'max', c.dna #> '{tolerances,price,max}', 'currency', c.dna ->> 'currency') end),
      'places', case when jsonb_typeof(c.strategy -> 'places') = 'array' then c.strategy -> 'places'
                     else (select coalesce(jsonb_agg(p), '[]'::jsonb) from unnest(array[c.dna ->> 'neighborhood', c.dna ->> 'district', c.dna ->> 'city']) p where p is not null) end,
      'bedrooms', c.dna #> '{tolerances,bedrooms}', 'area', c.dna #> '{tolerances,area}'),
    'coverage', jsonb_build_object(
      'languages', (select coalesce(jsonb_agg(distinct x order by x), '[]'::jsonb) from (
          select jsonb_array_elements_text(case when jsonb_typeof(c.st -> 'languagesSearched') = 'array' then c.st -> 'languagesSearched' else '[]'::jsonb end) x
          union select r.language from r where r.status in ('SUCCEEDED', 'ABORTED', 'TIMED_OUT', 'RUNNING') and r.language is not null and r.language <> 'multi'
          union select jsonb_array_elements_text(case when jsonb_typeof(q.md -> 'last_outcome' -> 'languagesSearched') = 'array' then q.md -> 'last_outcome' -> 'languagesSearched' else '[]'::jsonb end)
            from q where q.provider = 'TELEGRAM_SOURCES') z),
      'platforms', (select coalesce(jsonb_agg(jsonb_build_object('platform', p.platform, 'state', p.state, 'runs', p.runs, 'items', p.items,
            'qualified', p.qualified, 'uncategorised', p.uncategorised) order by p.items desc, p.platform), '[]'::jsonb) from plat2 p),
      'telegramNative', mm.tg_free_jobs > 0,
      'locations', (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from (
          select unnest(array[c.dna ->> 'neighborhood', c.dna ->> 'district', c.dna ->> 'city']) x
          union select q.md ->> 'city' from q) z where x is not null and x <> ''),
      'communitiesDiscovered', mm.tg_discovered + mm.groups_found,
      'telegramCommunitiesDiscovered', mm.tg_discovered,
      'groupsFound', mm.groups_found,
      'communitiesRead', mm.communities_read,
      'postsRetrieved', mm.posts_retrieved + mm.tg_free_msgs,
      'signalsAnalysed', case when mm.sig_total > 0 then mm.sig_total else coalesce((c.st ->> 'signalsAnalyzed')::int, 0) end,
      'postsAnalysed', mm.sig_posts,
      'messagesAnalysed', mm.sig_messages,
      'commentsExamined', greatest(mm.sig_comments, coalesce((c.st ->> 'commentsReviewed')::int, 0)),
      'commentDecisions', (select coalesce(jsonb_object_agg(d, n), '{}'::jsonb) from (
          select coalesce(a.comments_decision, 'NOT_DECIDED') d, count(*) n from a where a.content_kind = 'POST' group by 1) z),
      'staleSkipped', coalesce((c.st ->> 'staleSkipped')::int, 0),
      'duplicatesRemoved', coalesce((c.st ->> 'duplicatesRemoved')::int, 0)),
    /* The owner sees the research budget as a share; provider money stays internal. */
    'budget', jsonb_build_object(
      'creditsCommitted', c.credits_committed,
      'usedPct', mm.used_pct,
      'exhausted', coalesce(mm.used_pct >= 95, false)),
    'timing', jsonb_build_object(
      'createdAt', c.created_at, 'finalizedAt', c.finalized_at, 'stopReason', c.stop_reason,
      'durationSeconds', round(extract(epoch from (coalesce(c.finalized_at, now()) - c.created_at)))::int,
      'phase1DeadlineAt', c.qp #>> '{phases,phase1DeadlineAt}',
      'phase1EndedAt', (select max(q.ended_at) from q where q.p1 and q.status in ('DONE', 'FAILED', 'CANCELLED', 'BUDGET_REACHED')),
      'firstVisibleAt', coalesce(c.metrics -> 'firstVisibleAt', to_jsonb((select min(l.created_at) from l))),
      'firstQualifiedAt', coalesce(c.metrics -> 'firstQualifiedAt', to_jsonb((select min(l.created_at) from l where l.cat in ('STRONG', 'POTENTIAL'))))),
    'results', jsonb_build_object(
      'strong', mm.strong, 'potential', mm.potential, 'weak', mm.weak, 'uncategorised', mm.uncategorised,
      'rejected', mm.rejected, 'expired', mm.expired,
      'visible', mm.strong + mm.potential + mm.weak + mm.uncategorised,
      'signalRoles', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
          select coalesce(rs.role, 'UNCATEGORISED') k, count(*) n from rs group by 1) z),
      'candidateRoles', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
          select coalesce(l.role, 'UNCATEGORISED') k, count(*) n from l group by 1) z),
      'rejectionReasons', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
          select x k, count(*) n from l, jsonb_array_elements_text(l.reasons) x where l.cat = 'REJECTED' group by 1) z),
      'signalRejectionReasons', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
          select x k, count(*) n from a, jsonb_array_elements_text(a.reasons) x where a.cat = 'REJECTED' group by 1) z),
      'intentClasses', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
          select coalesce(a.intent_class, 'UNKNOWN') k, count(*) n from a group by 1) z),
      'budgetFit', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
          select l.bfit k, count(*) n from l where l.cur and l.cat in ('STRONG', 'POTENTIAL', 'WEAK') group by 1) z),
      'locationFit', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
          select l.lfit k, count(*) n from l where l.cur and l.cat in ('STRONG', 'POTENTIAL', 'WEAK') group by 1) z),
      'genuineSeekers', mm.genuine),
    /* Communities that produced visible leads, by qualified (then uncategorised) leads per budget share. */
    'bestSources', (select coalesce(jsonb_agg(b order by (b ->> 'qualified')::int desc, (b ->> 'uncategorised')::int desc, (b ->> 'postsRead')::int desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'platform', g.platform, 'community', g.tgt,
          'qualified', g.qualified, 'weak', g.weak, 'uncategorised', g.uncategorised,
          'postsRead', coalesce((select sum(r.items) from r where r.tgt = g.tgt), 0),
          'budgetSharePct', case when mm.used_micros > 0 then round(100.0 * coalesce((select sum(r.spent) from r where r.tgt = g.tgt), 0) / mm.used_micros, 1) end) as b
          from (select l.source as platform, l.tgt,
                       count(*) filter (where l.cat in ('STRONG', 'POTENTIAL')) as qualified,
                       count(*) filter (where l.cat = 'WEAK') as weak,
                       count(*) filter (where l.cat is null) as uncategorised
                  from l where l.cur and coalesce(l.cat, '') <> 'REJECTED'
                 group by l.source, l.tgt) g
         order by g.qualified desc, g.uncategorised desc limit 6) z),
    'coveragePlan', jsonb_build_object(
      'planned', c.qp #> '{phases,planned}',
      'queue', jsonb_build_object(
        'total', (select count(*) from q),
        'done', (select count(*) from q where q.status = 'DONE'),
        'failed', (select count(*) from q where q.status in ('FAILED', 'BUDGET_REACHED')),
        'cancelled', (select count(*) from q where q.status = 'CANCELLED'),
        'open', (select count(*) from q where q.status in ('PENDING', 'PROCESSING', 'RETRY_WAIT', 'PAUSED'))),
      'cancelledBy', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
          select coalesce(q.cancel_reason, 'UNSPECIFIED') k, count(*) n from q where q.status = 'CANCELLED' group by 1) z)),
    'limitations', (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (values
        (1, case when jsonb_array_length(mm.failed_platforms) > 0 then jsonb_build_object('code', 'SOURCES_FAILED', 'platforms', mm.failed_platforms) end),
        (2, case when jsonb_array_length(mm.empty_platforms) > 0 then jsonb_build_object('code', 'SOURCES_EMPTY', 'platforms', mm.empty_platforms) end),
        (3, case when mm.phase1_budget_stops > 0 then jsonb_build_object('code', 'DISCOVERY_BUDGET_CAP', 'jobs', mm.phase1_budget_stops) end),
        (4, case when mm.budget_stops - mm.phase1_budget_stops > 0 then jsonb_build_object('code', 'BUDGET_STOPS', 'jobs', mm.budget_stops - mm.phase1_budget_stops) end),
        (5, case when mm.deadline_stops > 0 then jsonb_build_object('code', 'TIME_LIMIT', 'jobs', mm.deadline_stops) end),
        (6, case when coalesce(mm.used_pct >= 95, false) then jsonb_build_object('code', 'BUDGET_EXHAUSTED', 'usedPct', mm.used_pct) end),
        (7, case when mm.cur_categorised > 0 and mm.cur_budget_unknown > 0 then jsonb_build_object('code', 'BUDGET_UNKNOWN', 'leads', mm.cur_budget_unknown, 'of', mm.cur_categorised) end),
        (8, case when mm.cur_categorised > 0 and mm.cur_location_unknown > 0 then jsonb_build_object('code', 'LOCATION_UNKNOWN', 'leads', mm.cur_location_unknown, 'of', mm.cur_categorised) end),
        (9, case when mm.sig_comments = 0 and mm.sig_posts > 0 then jsonb_build_object('code', 'COMMENTS_NOT_EXAMINED', 'posts', mm.sig_posts) end),
        (10, case when mm.uncategorised > 0 then jsonb_build_object('code', 'LEGACY_UNCATEGORISED', 'leads', mm.uncategorised) end)
      ) v(o, x) where x is not null),
    /* Research notes: each a code + the numbers behind it; the screen words them. */
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('code', x ->> 'code', 'params', x - 'code') order by o), '[]'::jsonb) from (values
        (1, case when mm.live then jsonb_build_object('code', 'PARTIAL_REPORT') end),
        (2, case when mm.uncategorised > 0 then jsonb_build_object('code', 'LEGACY_UNCATEGORISED', 'leads', mm.uncategorised) end),
        (3, case when mm.genuine > 0 and mm.genuine_fit = 0 then jsonb_build_object('code', 'NO_LOCATION_AND_PRICE_MATCH', 'genuineBuyers', mm.genuine) end),
        (4, case when not mm.live and mm.role_known > 0 and mm.seekers = 0 then jsonb_build_object('code', 'NO_GENUINE_DEMAND', 'signals', mm.role_known) end),
        (5, case when mm.other_seekers >= 3 and mm.other_seekers > mm.seekers then jsonb_build_object(
              'code', case when mm.transaction = 'RENT' then 'PURCHASE_DEMAND_DOMINANT' else 'RENTAL_DEMAND_DOMINANT' end,
              'share', round(100.0 * mm.other_seekers / (mm.other_seekers + mm.seekers))::int,
              'otherSeekers', mm.other_seekers, 'seekers', mm.seekers) end),
        (6, case when mm.role_known >= 10 and mm.supply_roles * 100 >= mm.role_known * 40
                   then jsonb_build_object('code', 'SUPPLY_DOMINANT', 'share', round(100.0 * mm.supply_roles / mm.role_known)::int, 'basis', 'ROLE')
                 when mm.role_known = 0 and mm.intent_known >= 10 and mm.supply_intent * 100 >= mm.intent_known * 40
                   then jsonb_build_object('code', 'SUPPLY_DOMINANT', 'share', round(100.0 * mm.supply_intent / mm.intent_known)::int, 'basis', 'INTENT') end),
        (7, case when mm.job_roles >= 3 then jsonb_build_object('code', 'JOB_GROUP_NOISE', 'signals', mm.job_roles) end),
        (8, case when jsonb_array_length(mm.failed_platforms) > 0 then jsonb_build_object('code', 'SOURCES_FAILED', 'list', mm.failed_platforms) end),
        (9, case when mm.budget_stops > 0 or coalesce(mm.used_pct >= 95, false)
                 then jsonb_build_object('code', 'BUDGET_LIMITED', 'usedPct', mm.used_pct, 'stoppedJobs', mm.budget_stops) end),
        (10, case when mm.deadline_stops > 0 then jsonb_build_object('code', 'TIME_LIMITED', 'stoppedJobs', mm.deadline_stops) end),
        (11, case when mm.sig_comments = 0 and mm.sig_posts > 0 then jsonb_build_object('code', 'COMMENTS_NOT_EXAMINED', 'posts', mm.sig_posts) end),
        (12, case when mm.tg_free_jobs > 0 or mm.tg_paid_items > 0 or mm.tg_discovered > 0 then jsonb_build_object('code', 'TELEGRAM_COVERAGE',
              'free', mm.tg_free_msgs, 'freeChannels', mm.tg_free_targets, 'paid', mm.tg_paid_items, 'paidChannels', mm.tg_paid_channels,
              'discovered', mm.tg_discovered, 'activated', mm.tg_activated) end),
        (13, case when mm.genuine >= 2 and mm.genuine_budget_unknown * 2 >= mm.genuine
                  then jsonb_build_object('code', 'NO_BUDGET_STATED', 'share', round(100.0 * mm.genuine_budget_unknown / mm.genuine)::int) end),
        (14, case when jsonb_array_length(mm.budget_cut_languages) > 0 or mm.groups_unread > 0 or jsonb_array_length(mm.failed_platforms) > 0
                     or (mm.tg_discovered > mm.tg_activated and mm.tg_discovered > 0)
                  then jsonb_build_object('code', 'EXPANSION_OPTIONS',
                    'languages', mm.budget_cut_languages, 'groupsUnread', mm.groups_unread, 'sources', mm.failed_platforms,
                    'telegramUnread', greatest(mm.tg_discovered - mm.tg_activated, 0)) end)
      ) v(o, x) where x is not null),
    /* Admin only: the economics behind usedPct. */
    'economics', case when public.is_admin() then jsonb_build_object(
      'budgetMicros', mm.budget_micros, 'actorMicros', mm.actor_micros, 'aiMicros', mm.ai_micros, 'usedMicros', mm.used_micros) end
  ) into v
  from c, mm;
  -- REPORT BODY END

  return v;
end;
$function$;
revoke all on function public.find_buyers_campaign_report(uuid) from public, anon;
grant execute on function public.find_buyers_campaign_report(uuid) to authenticated, service_role;

------------------------------------------------------------------------------
-- Admin: what works, what costs, what is noise — across recent campaigns.
------------------------------------------------------------------------------
create or replace function public.admin_find_buyers_intelligence(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_since timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 7), 1));
  v jsonb;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;

  -- INTELLIGENCE BODY BEGIN
  with c as (
    select x.matching_job_id, x.created_at, x.finalized_at, x.provider_budget_micros, coalesce(x.query_plan, '{}'::jsonb) as qp
      from public.find_buyers_campaigns x where x.created_at >= v_since
  ), r as (
    select r.matching_job_id, r.actor_key, r.operation, r.source, r.status, r.language, r.started_at,
           coalesce(r.items_fetched, 0) as items, coalesce(r.qualified_leads, 0) as qualified, coalesce(r.strong_leads, 0) as strong,
           case when r.status in ('RESERVED', 'STARTING', 'RUNNING') then r.reserved_micros
                when r.status = 'RELEASED' then 0 else coalesce(r.actual_micros, r.reserved_micros) end as spent,
           coalesce(nullif(r.reason ->> 'query', ''), nullif(r.reason ->> 'targetUrl', ''), r.reason ->> 'arm', r.operation) as qkey,
           lower(substring(regexp_replace(coalesce(r.reason ->> 'targetUrl', ''), '^https?://(www\.|m\.|web\.)?', '')
                 from '^((?:facebook\.com/groups|vk\.com|t\.me|instagram\.com/explore/tags)/[^/?#]+)')) as tgt
      from public.find_buyers_actor_runs r join c on c.matching_job_id = r.matching_job_id
  ), q as (
    select q.matching_job_id, q.provider, q.status, q.cancel_reason, coalesce(q.metadata, '{}'::jsonb) as md,
           coalesce(q.finished_at, q.processed_at) as ended_at,
           (q.provider = 'TELEGRAM_SOURCES' or (q.provider = 'APIFY_MEMO23' and q.metadata ->> 'stage' in ('FB_GROUP_SEARCH', 'LINKEDIN_GROUPS'))) as p1
      from public.discovery_query_queue q join c on c.matching_job_id = q.matching_job_id
  ), a as (
    select a.matching_job_id, a.content_kind, a.comments_decision, to_jsonb(a) ->> 'match_category' as cat,
           case when jsonb_typeof(to_jsonb(a) -> 'rejection_reasons') = 'array' then to_jsonb(a) -> 'rejection_reasons' else '[]'::jsonb end as reasons
      from public.find_buyers_assessments a join c on c.matching_job_id = a.matching_job_id
  ), l as (
    select l.matching_job_id, l.source, l.created_at, to_jsonb(l) ->> 'match_category' as cat, to_jsonb(l) ->> 'requalified_at' as requalified_at,
           case when jsonb_typeof(to_jsonb(l) -> 'rejection_reasons') = 'array' then to_jsonb(l) -> 'rejection_reasons' else '[]'::jsonb end as reasons,
           lower(substring(regexp_replace(coalesce(l.evidence -> 0 ->> 'url', ''), '^https?://(www\.|m\.|web\.)?', '')
                 from '^((?:facebook\.com/groups|vk\.com|t\.me|instagram\.com/explore/tags)/[^/?#]+)')) as tgt
      from public.find_buyers_leads l join c on c.matching_job_id = l.matching_job_id
  )
  select jsonb_build_object(
    'since', v_since,
    'campaigns', (select count(*) from c),
    /* Each query / arm: what it cost, what it read, what qualified (as recorded per run). */
    'queries', (select coalesce(jsonb_agg(x order by (x ->> 'costMicros')::bigint desc), '[]'::jsonb) from (
        select jsonb_build_object('operation', r.operation, 'query', r.qkey, 'language', r.language,
          'runs', count(*), 'failed', count(*) filter (where r.status = 'FAILED'),
          'costMicros', sum(r.spent), 'items', sum(r.items), 'qualified', sum(r.qualified), 'strong', sum(r.strong)) x
          from r where r.status <> 'RELEASED' group by r.operation, r.qkey, r.language
         order by sum(r.spent) desc limit 60) z),
    'actors', (select coalesce(jsonb_agg(x order by (x ->> 'costMicros')::bigint desc), '[]'::jsonb) from (
        select jsonb_build_object('actorKey', r.actor_key, 'runs', count(*),
          'succeeded', count(*) filter (where r.status = 'SUCCEEDED'), 'failed', count(*) filter (where r.status in ('FAILED', 'TIMED_OUT')),
          'empty', count(*) filter (where r.status = 'SUCCEEDED' and r.items = 0),
          'costMicros', sum(r.spent), 'items', sum(r.items), 'qualified', sum(r.qualified),
          'costPerQualifiedMicros', case when sum(r.qualified) > 0 then (sum(r.spent) / sum(r.qualified))::bigint end) x
          from r where r.status <> 'RELEASED' group by r.actor_key) z),
    /* Leads that re-qualification moved to REJECTED, of those it re-examined. */
    'falsePositives', jsonb_build_object(
      'leads', (select count(*) from l),
      'requalified', (select count(*) from l where l.requalified_at is not null),
      'rejectedAfterRequalification', (select count(*) from l where l.requalified_at is not null and l.cat = 'REJECTED'),
      'rate', (select case when count(*) filter (where l.requalified_at is not null) > 0 then round(
          count(*) filter (where l.requalified_at is not null and l.cat = 'REJECTED')::numeric
          / count(*) filter (where l.requalified_at is not null), 3) end from l)),
    'categories', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
        select coalesce(l.cat, 'UNCATEGORISED') k, count(*) n from l group by 1) z),
    'rejectionReasons', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
        select x k, count(*) n from l, jsonb_array_elements_text(l.reasons) x where l.cat = 'REJECTED' group by 1) z),
    'signalRejectionReasons', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
        select x k, count(*) n from a, jsonb_array_elements_text(a.reasons) x where a.cat = 'REJECTED' group by 1) z),
    /* Per group / channel: leads it produced, how many survived, what reading it cost. */
    'sourceQuality', (select coalesce(jsonb_agg(x order by (x ->> 'leads')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('platform', s.platform, 'community', s.tgt, 'leads', s.leads, 'qualified', s.qualified,
          'rejected', s.rejected, 'uncategorised', s.uncategorised, 'costMicros', s.cost, 'items', s.items,
          'qualifiedPerDollar', case when s.cost > 0 then round(s.qualified / (s.cost / 1000000.0), 2) end) x
          from (
            select coalesce(lg.platform, rg.platform) as platform, coalesce(lg.tgt, rg.tgt) as tgt,
                   coalesce(lg.leads, 0) as leads, coalesce(lg.qualified, 0) as qualified, coalesce(lg.rejected, 0) as rejected,
                   coalesce(lg.uncategorised, 0) as uncategorised, coalesce(rg.cost, 0) as cost, coalesce(rg.items, 0) as items
              from (select l.source as platform, l.tgt, count(*) as leads,
                           count(*) filter (where l.cat in ('STRONG', 'POTENTIAL')) as qualified,
                           count(*) filter (where l.cat = 'REJECTED') as rejected,
                           count(*) filter (where l.cat is null) as uncategorised
                      from l where l.tgt is not null group by 1, 2) lg
              full join (select min(r.source) as platform, r.tgt, sum(r.spent) as cost, sum(r.items) as items
                           from r where r.tgt is not null group by r.tgt) rg on rg.tgt = lg.tgt
             order by coalesce(lg.leads, 0) desc, coalesce(rg.cost, 0) desc limit 60) s) z),
    /* Discovery (Phase 1) vs extraction (Phase 2) timing, per campaign. */
    'timing', (select coalesce(jsonb_agg(x order by x ->> 'createdAt' desc), '[]'::jsonb) from (
        select jsonb_build_object('jobId', c.matching_job_id, 'createdAt', c.created_at, 'finalizedAt', c.finalized_at,
          'phase1EndedAt', (select max(q.ended_at) from q where q.matching_job_id = c.matching_job_id and q.p1),
          'firstExtractionAt', (select min(r.started_at) from r where r.matching_job_id = c.matching_job_id and r.operation not in ('FB_GROUP_SEARCH', 'LINKEDIN_GROUPS')),
          'firstLeadAt', (select min(l.created_at) from l where l.matching_job_id = c.matching_job_id),
          'firstQualifiedAt', (select min(l.created_at) from l where l.matching_job_id = c.matching_job_id and l.cat in ('STRONG', 'POTENTIAL')),
          'phase1Seconds', round(extract(epoch from ((select max(q.ended_at) from q where q.matching_job_id = c.matching_job_id and q.p1) - c.created_at)))::int,
          'durationSeconds', round(extract(epoch from (coalesce(c.finalized_at, now()) - c.created_at)))::int) x
          from c order by c.created_at desc limit 30) z),
    'comments', jsonb_build_object(
      'commentsAssessed', (select count(*) from a where a.content_kind = 'COMMENT'),
      'postsAssessed', (select count(*) from a where a.content_kind = 'POST'),
      'decisions', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
          select coalesce(a.comments_decision, 'NOT_DECIDED') k, count(*) n from a where a.content_kind = 'POST' group by 1) z)),
    'telegram', jsonb_build_object(
      'freeJobs', (select count(*) from q where q.provider = 'TELEGRAM'),
      'freeMessages', (select coalesce(sum((q.md -> 'last_outcome' ->> 'newMessages')::numeric), 0)::int from q where q.provider = 'TELEGRAM'),
      'freeTargets', (select coalesce(sum((q.md -> 'last_outcome' ->> 'targetsConsidered')::numeric), 0)::int from q where q.provider = 'TELEGRAM'),
      'paidRuns', (select count(*) from r where r.operation = 'TELEGRAM_CHANNEL' and r.status <> 'RELEASED'),
      'paidItems', (select coalesce(sum(r.items), 0) from r where r.operation = 'TELEGRAM_CHANNEL'),
      'paidChannels', (select count(distinct r.tgt) from r where r.operation = 'TELEGRAM_CHANNEL' and r.status <> 'RELEASED'),
      'paidCostMicros', (select coalesce(sum(r.spent), 0) from r where r.operation = 'TELEGRAM_CHANNEL'),
      'communitiesDiscovered', (select coalesce(sum((q.md -> 'last_outcome' ->> 'communitiesFound')::numeric), 0)::int from q where q.provider = 'TELEGRAM_SOURCES')),
    'bottlenecks', jsonb_build_object(
      'waits', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
          select q.md ->> 'lastWait' k, count(*) n from q where q.md ->> 'lastWait' is not null group by 1) z),
      'cancelled', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
          select coalesce(q.cancel_reason, 'UNSPECIFIED') k, count(*) n from q where q.status = 'CANCELLED' group by 1) z),
      'queueStates', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
          select q.status k, count(*) n from q group by 1) z),
      'phase1AvgSeconds', (select round(avg(s))::int from (
          select extract(epoch from (max(q.ended_at) - min(c.created_at))) s
            from q join c on c.matching_job_id = q.matching_job_id where q.p1 group by q.matching_job_id) z))
  ) into v;
  -- INTELLIGENCE BODY END

  return v;
end;
$function$;
revoke all on function public.admin_find_buyers_intelligence(integer) from public, anon;
grant execute on function public.admin_find_buyers_intelligence(integer) to authenticated;
