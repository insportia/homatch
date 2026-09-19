/* ══════════════════════════════════════════════════════════════════════
 * WHAT ONE VERIFY COST, WHERE AN ADMINISTRATOR CAN READ IT
 * ══════════════════════════════════════════════════════════════════════
 *
 * public.verify_billing_events already answers this, one row per completed
 * verification, and it is the authoritative answer: the metering, the price
 * book version it was costed against, the per-stage breakdown. Nothing here
 * recomputes any of it. A second cost engine would be a second set of
 * numbers to disagree with the first.
 *
 * What is missing is a way to READ it from the product. That view is
 * `revoke all ... from anon, authenticated; grant select to service_role`,
 * which is correct — it is raw cost, and cost is not a customer's business —
 * but it also means the Admin UI cannot see it at all.
 *
 * So these three functions are a reading surface and nothing else. Each is
 * SECURITY DEFINER with an empty search_path, each refuses anyone who is not
 * an administrator, and each selects from the existing view.
 *
 * COST, NEVER PRICE
 *
 * Every figure below is provider spend. No margin, no VAT, no plan, no
 * entitlement, no customer-facing number. The same boundary
 * verify_billing_events draws, drawn again here so it cannot be crossed by
 * accident.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * Railway and Supabase are fixed-subscription infrastructure. The existing
 * contract excludes them from provider_cogs on purpose, and no per-job share
 * of them is invented here. If allocated infrastructure cost is wanted later
 * it belongs in its own explicitly labelled metric, exactly as AI Talk keeps
 * ai_talk_infra_allocation() separate from its measured variable COGS.
 *
 * REFUSAL IS NOT AN EMPTY RESULT
 *
 * These were written first as plain SQL functions with `where is_admin()`.
 * That filters ROWS — and an aggregate over no rows still returns one, so a
 * non-administrator calling the summary got jobs_count = 0 and null totals
 * back. "You may not see this" arriving as "there is nothing to see" is the
 * same failure as an unpriced run reported as free. They raise now.
 *
 * UNKNOWN IS NOT ZERO
 *
 * A verification whose price book had no rate for some stage is
 * PARTIALLY_PRICED. Summing it into a total as if the missing part were free
 * would understate spend while looking precise. The summary therefore reports
 * how many runs are fully priced and how many are not, ALONGSIDE the total,
 * so a reader can see when that total is a floor rather than a figure.
 */

-- ── SUMMARY ────────────────────────────────────────────────────────────
create or replace function public.verify_cogs_summary(
  p_from timestamptz default null,
  p_to   timestamptz default null
)
returns table (
  jobs_count            bigint,
  priced_jobs           bigint,
  partially_priced_jobs bigint,
  total_cogs_usd        numeric,
  avg_cogs_usd          numeric,
  total_model_cost_usd  numeric,
  total_search_cost_usd numeric,
  total_tokens          bigint,
  cached_input_tokens   bigint,
  web_searches          bigint,
  avg_duration_seconds  numeric,
  reuse_hits            bigint
)
language plpgsql
stable
security definer
set search_path to ''
as $fn$
begin
  -- NULL-SAFE ON PURPOSE.
  --
  -- Written first as `auth.role() <> 'service_role' and not is_admin()`,
  -- which is the shape used elsewhere in this schema. auth.role() is NULL
  -- outside a PostgREST request, and `NULL <> 'service_role'` is NULL, so
  -- `NULL and true` is NULL and the IF never fires: the guard let a caller
  -- with no role at all straight through. Proven against production before
  -- this was corrected. Both sides are coalesced now.
  if not (coalesce(auth.role(), '') = 'service_role' or coalesce(public.is_admin(), false)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  return query
  select
    count(*)::bigint,
    count(*) filter (where e.price_state = 'PRICED')::bigint,
    count(*) filter (where e.price_state is distinct from 'PRICED')::bigint,
    -- A sum of what is KNOWN. The two counts above are what tell a reader
    -- whether that sum is the whole story.
    sum(e.provider_cogs_usd)::numeric,
    avg(e.provider_cogs_usd)::numeric,
    sum(e.model_cost_usd)::numeric,
    sum(e.search_cost_usd)::numeric,
    sum(e.total_tokens)::bigint,
    sum(e.cached_input_tokens)::bigint,
    sum(e.web_searches)::bigint,
    avg(e.duration_seconds)::numeric,
    count(*) filter (where e.reuse_graph_hit)::bigint
  from public.verify_billing_events e
  where (p_from is null or e.completed_at >= p_from)
    and (p_to   is null or e.completed_at <  p_to);
end;
$fn$;

comment on function public.verify_cogs_summary(timestamptz, timestamptz) is
  'Admin-only. Aggregate Verify provider COGS over a window, read from verify_billing_events. Cost, never price. partially_priced_jobs > 0 means total_cogs_usd is a floor.';

-- ── ONE ROW PER VERIFICATION ───────────────────────────────────────────
create or replace function public.verify_cogs_jobs(
  p_from  timestamptz default null,
  p_to    timestamptz default null,
  p_limit int default 100,
  p_offset int default 0
)
returns table (
  job_id              uuid,
  user_id             uuid,
  user_email          text,
  subject             text,
  completed_at        timestamptz,
  duration_seconds    int,
  total_tokens        bigint,
  cached_input_tokens bigint,
  web_searches        bigint,
  model_cost_usd      numeric,
  search_cost_usd     numeric,
  provider_cogs_usd   numeric,
  price_state         text,
  provider            text,
  reuse_graph_hit     boolean,
  reuse_facts_reused  int
)
language plpgsql
stable
security definer
set search_path to ''
as $fn$
begin
  -- NULL-SAFE ON PURPOSE.
  --
  -- Written first as `auth.role() <> 'service_role' and not is_admin()`,
  -- which is the shape used elsewhere in this schema. auth.role() is NULL
  -- outside a PostgREST request, and `NULL <> 'service_role'` is NULL, so
  -- `NULL and true` is NULL and the IF never fires: the guard let a caller
  -- with no role at all straight through. Proven against production before
  -- this was corrected. Both sides are coalesced now.
  if not (coalesce(auth.role(), '') = 'service_role' or coalesce(public.is_admin(), false)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  return query
  select
    e.job_id,
    e.user_id,
    -- The account, where one is legitimately readable. An anonymous run has
    -- no account and shows none rather than a placeholder that looks like one.
    u.email::text,
    e.subject,
    e.completed_at,
    e.duration_seconds,
    e.total_tokens::bigint,
    e.cached_input_tokens::bigint,
    e.web_searches,
    e.model_cost_usd,
    e.search_cost_usd,
    e.provider_cogs_usd,
    e.price_state,
    e.provider,
    e.reuse_graph_hit,
    e.reuse_facts_reused
  from public.verify_billing_events e
  left join auth.users u on u.id = e.user_id
  where (p_from is null or e.completed_at >= p_from)
    and (p_to   is null or e.completed_at <  p_to)
  order by e.completed_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 100), 500))
  offset greatest(0, coalesce(p_offset, 0));
end;
$fn$;

comment on function public.verify_cogs_jobs(timestamptz, timestamptz, int, int) is
  'Admin-only. One completed Verify per row with its measured provider COGS, read from verify_billing_events. Cost, never price.';

-- ── ONE VERIFICATION, INSPECTED ────────────────────────────────────────
create or replace function public.verify_cogs_job(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $fn$
declare
  v jsonb;
begin
  -- NULL-SAFE ON PURPOSE.
  --
  -- Written first as `auth.role() <> 'service_role' and not is_admin()`,
  -- which is the shape used elsewhere in this schema. auth.role() is NULL
  -- outside a PostgREST request, and `NULL <> 'service_role'` is NULL, so
  -- `NULL and true` is NULL and the IF never fires: the guard let a caller
  -- with no role at all straight through. Proven against production before
  -- this was corrected. Both sides are coalesced now.
  if not (coalesce(auth.role(), '') = 'service_role' or coalesce(public.is_admin(), false)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select to_jsonb(x) into v from (
    select
      e.job_id,
      e.user_id,
      (select u.email::text from auth.users u where u.id = e.user_id) as user_email,
      e.subject,
      e.completed_at,
      e.duration_seconds,
      e.total_tokens,
      e.cached_input_tokens,
      e.web_searches,
      e.provider,
      e.model_cost_usd,
      e.search_cost_usd,
      e.provider_cogs_usd,
      e.provider_cogs_cents,
      e.cogs_currency,
      e.price_state,
      e.price_book_effective_from,
      e.reuse_graph_hit,
      e.reuse_facts_reused,
      e.reuse_facts_required,
      e.reuse_facts_on_subject,
      e.reuse_facts_on_lineage,
      -- Per stage: model, tokens, searches and what each stage cost. The
      -- existing breakdown, carried through untouched.
      e.stage_breakdown
    from public.verify_billing_events e
    where e.job_id = p_job_id
  ) x;

  -- A job that does not exist is null, which is different from a job that
  -- cost nothing and different again from a caller who may not ask.
  return v;
end;
$fn$;

comment on function public.verify_cogs_job(uuid) is
  'Admin-only. One completed Verify with its full per-stage COGS breakdown and the price book version it was costed against. Cost, never price.';

-- ── WHO MAY CALL THEM ──────────────────────────────────────────────────
-- Each function checks is_admin() itself; these grants are the second lock
-- rather than the only one. anon is never given execute at all.
revoke all on function public.verify_cogs_summary(timestamptz, timestamptz) from public;
revoke all on function public.verify_cogs_jobs(timestamptz, timestamptz, int, int) from public;
revoke all on function public.verify_cogs_job(uuid) from public;

grant execute on function public.verify_cogs_summary(timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.verify_cogs_jobs(timestamptz, timestamptz, int, int) to authenticated, service_role;
grant execute on function public.verify_cogs_job(uuid) to authenticated, service_role;
