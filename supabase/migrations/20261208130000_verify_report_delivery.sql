-- Verify: research completion is not report delivery (stabilization, 2026-10-30).
--
-- Production 2026-10-29: verify-synthesis failed to boot; job 674df06e (cadastral
-- 01.16.06.039.039) read COMPLETE while synthesis_state was FAILED and no report
-- existed, and nothing recorded why. A report is DELIVERED only when
-- synthesis_state = 'READY' and synthesis_json exists (src/verify/reportDelivery.ts;
-- the SQL below is the same rule).
--
-- 1. public.verify_report_failures: one row per failed report attempt (who
--    noticed it, the attempt, the HTTP status, a bounded and credential-masked
--    reason). Written by research-agent / verify-synthesis with the service role
--    AFTER synthesis_state is written (bookkeeping, never control flow). RLS on,
--    no policy: customers never read it; Admin reads it through the RPC below.
-- 2. public.verify_report_delivery_state(...): the delivery rule in SQL.
-- 3. public.admin_verify_delivery(days, limit, problems_only): Admin's view of
--    research state and delivery state side by side, with attempts, last error,
--    engine, per-stage cost, billing/usage state and whether the audited
--    admin_verify_retry_synthesis (20261208100000) can act on the job.
-- 4. public.admin_verify_engine_stats(days): same signature and every old key,
--    now counted by DELIVERY: `complete` = reports delivered, `failed` = report
--    failed + research failed (a stop is no longer a failure), plus
--    researchComplete / delivered / reportFailed / reportPending / researchFailed /
--    stopped / successRate / avgReportSeconds, and the delivery state per recent job.
--
-- Additive and backward compatible: no existing row, report, billing or usage
-- record is changed. Admin-only reads; nothing here writes outside the new table.

-- 1 ────────────────────────────────────────────────────────────────────────
create table if not exists public.verify_report_failures (
  id          bigint generated always as identity primary key,
  job_id      uuid not null references public.research_jobs(id) on delete cascade,
  source      text not null check (source in ('DRIVER', 'RESEARCH', 'BACKGROUND', 'REQUEST')),
  attempt     integer,
  http_status integer,
  reason      text not null check (length(reason) between 1 and 500),
  created_at  timestamptz not null default now()
);
comment on table public.verify_report_failures is
  'Why a Verify report attempt failed (admin diagnostics). Service-role writes after synthesis_state; read through admin_verify_delivery. Never customer-visible.';
create index if not exists verify_report_failures_job_idx on public.verify_report_failures (job_id, created_at desc);
alter table public.verify_report_failures enable row level security;
revoke all on table public.verify_report_failures from public, anon, authenticated;
grant select, insert on table public.verify_report_failures to service_role;

-- 2 ────────────────────────────────────────────────────────────────────────
create or replace function public.verify_report_delivery_state(
  p_status text, p_cancelled_at timestamptz, p_synthesis_state text, p_attempts integer,
  p_has_report boolean, p_completed_at timestamptz)
returns text
language sql
stable
set search_path to ''
as $$
  select case
    when p_cancelled_at is not null or p_status in ('CANCELLED', 'PAUSED') then 'STOPPED'
    when p_status in ('FAILED', 'ERROR') then 'RESEARCH_FAILED'
    when p_status is distinct from 'COMPLETE' then 'RESEARCHING'
    when p_synthesis_state = 'READY' and p_has_report then 'DELIVERED'
    when p_synthesis_state = 'FAILED' and coalesce(p_attempts, 0) >= 4 then 'FAILED'
    when p_completed_at is not null and p_completed_at < now() - interval '2 hours' then 'FAILED'
    else 'PREPARING'
  end
$$;
comment on function public.verify_report_delivery_state(text, timestamptz, text, integer, boolean, timestamptz) is
  'DELIVERED only when synthesis READY and the report exists; mirrors src/verify/reportDelivery.ts (4 attempts, 2 h settle grace).';
revoke all on function public.verify_report_delivery_state(text, timestamptz, text, integer, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.verify_report_delivery_state(text, timestamptz, text, integer, boolean, timestamptz) to service_role;

-- 3 ────────────────────────────────────────────────────────────────────────
create or replace function public.admin_verify_delivery(
  p_days integer default 14, p_limit integer default 40, p_problems_only boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 14), 90)));
  v_limit integer := greatest(1, least(coalesce(p_limit, 40), 200));
  v jsonb;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  with jobs as (
    select j.id, j.query, j.status, j.stage, j.created_at, j.completed_at, j.cancelled_at,
           j.synthesis_state, coalesce(j.synthesis_attempts, 0) as attempts, j.synthesis_at,
           (j.synthesis_json is not null) as has_report,
           coalesce(nullif(j.result_json->'_engine'->>'version', ''), 'V1') as engine,
           public.verify_report_delivery_state(j.status, j.cancelled_at, j.synthesis_state,
             j.synthesis_attempts, j.synthesis_json is not null, j.completed_at) as delivery
      from public.research_jobs j
     where j.created_at >= v_since and j.deleted_at is null
  ), picked as (
    select * from jobs
     where not coalesce(p_problems_only, false) or delivery in ('PREPARING', 'FAILED')
     order by created_at desc
     limit v_limit
  )
  select jsonb_build_object(
    'days', greatest(1, least(coalesce(p_days, 14), 90)),
    'retryAvailable', to_regprocedure('public.admin_verify_retry_synthesis(uuid, text)') is not null,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'subject', p.query,
        'engine', p.engine,
        'researchStatus', p.status,
        'researchStage', p.stage,
        'createdAt', p.created_at,
        'researchCompletedAt', p.completed_at,
        'delivery', p.delivery,
        'synthesisState', p.synthesis_state,
        'attempts', p.attempts,
        'synthesisAt', p.synthesis_at,
        'hasReport', p.has_report,
        'lastError', f.reason,
        'lastErrorSource', f.source,
        'lastErrorStatus', f.http_status,
        'lastErrorAt', f.created_at,
        'failures', coalesce(fc.n, 0),
        'costUsd', round(c.total_cogs_usd, 4),
        'stages', coalesce(st.stages, '[]'::jsonb),
        'billingState', b.state,
        'usageState', u.state,
        'usageReleaseReason', u.release_reason,
        'retryable', p.status = 'COMPLETE' and p.synthesis_state = 'FAILED' and not p.has_report
      ) order by p.created_at desc)
        from picked p
        left join lateral (
          select x.reason, x.source, x.http_status, x.created_at
            from public.verify_report_failures x where x.job_id = p.id
           order by x.created_at desc limit 1) f on true
        left join lateral (select count(*)::integer as n from public.verify_report_failures x where x.job_id = p.id) fc on true
        left join public.verify_job_cogs c on c.job_id = p.id
        left join lateral (
          select jsonb_agg(jsonb_build_object(
                   'stage', s.stage, 'model', s.model,
                   'usd', round(coalesce(s.model_cost_usd, 0) + coalesce(s.search_cost_usd, 0), 6),
                   'priced', s.price_state = 'PRICED') order by s.priced_at nulls last, s.stage) as stages
            from public.verify_stage_cogs s where s.job_id = p.id) st on true
        left join public.verify_billing b on b.job_id = p.id
        left join lateral (
          select x.state, x.release_reason from public.saas_usage x
           where x.feature = 'VERIFY' and x.idempotency_key = 'verify:' || p.id::text
           order by x.created_at desc limit 1) u on true
    ), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;
revoke all on function public.admin_verify_delivery(integer, integer, boolean) from public, anon;
grant execute on function public.admin_verify_delivery(integer, integer, boolean) to authenticated;

-- 4 ────────────────────────────────────────────────────────────────────────
create or replace function public.admin_verify_engine_stats(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
  v jsonb;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  with jobs as (
    select j.id, j.query, j.status, j.created_at, j.completed_at, j.synthesis_at, j.synthesis_state,
           coalesce(j.synthesis_attempts, 0) as attempts,
           coalesce(nullif(j.result_json->'_engine'->>'version', ''), 'V1') as engine,
           public.verify_report_delivery_state(j.status, j.cancelled_at, j.synthesis_state,
             j.synthesis_attempts, j.synthesis_json is not null, j.completed_at) as delivery,
           c.total_cogs_usd
      from public.research_jobs j
      left join public.verify_job_cogs c on c.job_id = j.id
     where j.created_at >= v_since and j.deleted_at is null
  )
  select jsonb_build_object(
    'days', v_days,
    'countsBy', 'DELIVERY',
    'engines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'engine', e.engine,
               'jobs', e.jobs,
               'complete', e.delivered,
               'failed', e.report_failed + e.research_failed,
               'researchComplete', e.research_complete,
               'delivered', e.delivered,
               'reportFailed', e.report_failed,
               'reportPending', e.report_pending,
               'researchFailed', e.research_failed,
               'stopped', e.stopped,
               'successRate', case when e.delivered + e.report_failed + e.research_failed > 0
                                   then round(e.delivered::numeric / (e.delivered + e.report_failed + e.research_failed), 4) end,
               'avgSeconds', e.avg_seconds,
               'avgReportSeconds', e.avg_report_seconds,
               'avgCogsUsd', e.avg_cogs,
               'avgCogsAllUsd', e.avg_cogs_all,
               'pricedJobs', e.priced
             ) order by e.engine)
        from (
          select engine,
                 count(*) as jobs,
                 count(*) filter (where status = 'COMPLETE') as research_complete,
                 count(*) filter (where delivery = 'DELIVERED') as delivered,
                 count(*) filter (where delivery = 'FAILED') as report_failed,
                 count(*) filter (where delivery = 'PREPARING') as report_pending,
                 count(*) filter (where delivery = 'RESEARCH_FAILED') as research_failed,
                 count(*) filter (where delivery = 'STOPPED') as stopped,
                 round(avg(extract(epoch from (completed_at - created_at))) filter (where delivery = 'DELIVERED'))::integer as avg_seconds,
                 /* Research end to report saved, first builds only: a later
                    auto-upgrade rewrites synthesis_at days afterwards. */
                 round(avg(extract(epoch from (synthesis_at - completed_at)))
                   filter (where delivery = 'DELIVERED' and synthesis_at >= completed_at
                             and synthesis_at < completed_at + interval '6 hours'))::integer as avg_report_seconds,
                 round(avg(total_cogs_usd) filter (where delivery = 'DELIVERED'), 4) as avg_cogs,
                 round(avg(total_cogs_usd) filter (where status = 'COMPLETE'), 4) as avg_cogs_all,
                 count(total_cogs_usd) filter (where delivery = 'DELIVERED') as priced
            from jobs group by engine
        ) e
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'engine', r.engine, 'status', r.status, 'createdAt', r.created_at,
               'delivery', r.delivery, 'synthesisState', r.synthesis_state, 'attempts', r.attempts,
               'seconds', case when r.completed_at is not null then round(extract(epoch from (r.completed_at - r.created_at)))::integer end,
               'cogsUsd', round(r.total_cogs_usd, 4)
             ) order by r.created_at desc)
        from (select * from jobs order by created_at desc limit 40) r
    ), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;
revoke all on function public.admin_verify_engine_stats(integer) from public, anon;
grant execute on function public.admin_verify_engine_stats(integer) to authenticated;
