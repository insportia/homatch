-- FIND BUYERS / FIND TENANTS — research opportunities (2026-10-16).
--
-- A comparable listing posted by someone else (a competitor's flat, an agency's
-- Page post, a group listing) is never a buyer. Its comment discussion is where
-- interested people show up. This read lists, for one campaign, the comparable
-- listings HOMATCH assessed, with the truth about their comments:
--   INSPECTED     comments were read and judged (interested_count = people found there)
--   NOT_INSPECTED the platform reports comments (or did not report a count) but none
--                 were read — the owner can review the discussion by hand
-- Listings the platform reported as comment-less are left out (no audience to review).
-- Nothing here is a lead, and nothing claims a person was found unless a lead exists.
--
-- Additive and read-only: one function, no table changes.

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
