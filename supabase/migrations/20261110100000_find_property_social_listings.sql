-- FIND PROPERTY — social listings in the results, and no charge without confirmed provider work.
--
-- 1. supply_observations.image_urls: a social offer keeps its own post photos, so it can be
--    shown beside portal listings (never invented; empty when the post had none).
-- 2. find_property_customer_micros: what the CUSTOMER pays for in a paid social campaign —
--    only Actor runs the provider confirmed (a provider run id), and never a run whose start
--    was ambiguous (cost_basis START_AMBIGUOUS: HOMATCH's cost of goods, still booked in
--    cost_events and still counted against the provider budget by
--    find_property_committed_micros, which is unchanged).
-- 3. my_find_property_campaign.creditsUsed reads the customer figure.
-- Paid search stays OFF (find_property_social_enabled); nothing here starts or enables a run.

alter table public.supply_observations add column if not exists image_urls text[] not null default '{}'::text[];
comment on column public.supply_observations.image_urls is
  'Photos the source itself published with this observation (https only, at most 12). Empty when it had none; never generated.';

create or replace function public.find_property_customer_micros(p_run_id uuid)
returns bigint language sql stable set search_path = public as $$
  select coalesce(sum(case
           /* Never confirmed by the provider: released, or an ambiguous start (HOMATCH's cost). */
           when provider_run_id is null then 0
           when cost_basis = 'START_AMBIGUOUS' then 0
           /* Confirmed and still running: at most its reservation (Apify enforces the cap). */
           when status = 'RUNNING' and cost_booked_at is null then reserved_micros
           when actual_micros is not null then actual_micros
           /* Confirmed, cost unknown: counted at its reservation, never silently zero. */
           else reserved_micros end), 0)::bigint
    from public.find_property_actor_runs where discovery_run_id = p_run_id
$$;
comment on function public.find_property_customer_micros(uuid) is
  'Provider spend the customer of a paid social campaign is charged for (÷ 0.63, capped): confirmed Actor runs only. START_AMBIGUOUS and unstarted runs are excluded.';
revoke all on function public.find_property_customer_micros(uuid) from public, anon, authenticated;
grant execute on function public.find_property_customer_micros(uuid) to service_role;

/* Same body as 20261107095700, creditsUsed from find_property_customer_micros.
   The customer's own campaign, live: per-network progress, money held and used. Never another person's run. */
create or replace function public.my_find_property_campaign(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public.current_homatch_user_id(); v_run public.discovery_runs%rowtype;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_run from public.discovery_runs where id = p_run_id and user_id = v_me;
  if not found then raise exception 'not found' using errcode = '42501'; end if;
  return jsonb_build_object(
    'id', v_run.id, 'status', v_run.status, 'stage', v_run.stage, 'createdAt', v_run.created_at,
    'deadlineAt', v_run.deadline_at, 'completedAt', v_run.completed_at, 'failureReason', v_run.failure_reason,
    'networks', coalesce(to_jsonb(v_run.offer_networks), '[]'::jsonb), 'policy', v_run.pricing_policy,
    'creditsAuthorized', (v_run.billing_grant ->> 'authorizedMaxCredits')::numeric,
    'creditsCharged', v_run.credits_charged,
    /* Credits the CONFIRMED work so far would cost (consumed / 0.63, up to the cent, never
       above the authorised price) — the customer's figure; provider dollars stay in Admin. */
    'creditsUsed', least(coalesce((v_run.billing_grant ->> 'authorizedMaxCredits')::numeric, 0),
      round(ceil(ceil(public.find_property_customer_micros(v_run.id) * 10000.0 / public.paid_discovery_provider_share_bps()) / 10000.0)
            * coalesce(v_run.credits_per_usd, 10) / 100.0, 2)),
    'offersFound', v_run.offers_found, 'resultsFound', v_run.results_found,
    'unavailable', coalesce(v_run.offer_plan -> 'unavailable', '[]'::jsonb),
    'skippedForBudget', coalesce((v_run.offer_plan ->> 'skippedForBudget')::int, 0),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('network', n, 'planned', planned, 'done', done, 'running', running,
                                 'failed', failed, 'budget', budget) order by n) from (
        select coalesce(q.metadata ->> 'network', q.provider) n,
               count(*) planned,
               count(*) filter (where q.status = 'DONE') done,
               count(*) filter (where q.status in ('PROCESSING', 'RETRY_WAIT', 'PENDING')) running,
               count(*) filter (where q.status = 'FAILED') failed,
               count(*) filter (where q.status = 'BUDGET_REACHED') budget
          from public.discovery_query_queue q where q.discovery_run_id = v_run.id group by 1) s), '[]'::jsonb));
end $$;
revoke all on function public.my_find_property_campaign(uuid) from public, anon;
grant execute on function public.my_find_property_campaign(uuid) to authenticated;
