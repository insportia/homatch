/* ══════════════════════════════════════════════════════════════════════
 * WHAT VERIFY HANDS THE PRICING AND WALLET WORK
 * ══════════════════════════════════════════════════════════════════════
 *
 * One row per completed verification: what it consumed, what that cost
 * Homatch in raw provider spend, and why it cost that.
 *
 * Deliberately NOT a price. No margin, no VAT, no plan, no entitlement, no
 * customer-facing figure of any kind. Pricing owns those decisions; this only
 * reports cost, so the two subsystems can change without breaking each other
 * and neither has to understand the other's internals.
 *
 * quality_tier is null rather than guessed. Verify does not emit a tier yet,
 * and inventing one here would have a pricing engine bill against a concept
 * this side does not implement. The column exists so it can be filled later
 * without a schema change or a migration to the consumer.
 *
 * The reuse_* fields exist so pricing can tell WHY one verification cost less
 * than another — the difference between giving a discount and performing a
 * genuinely cheaper unit of work. A second flat in a known building shows
 * reuse_facts_on_subject = 0 with reuse_facts_on_lineage > 0: nothing is known
 * about that exact unit, but a great deal is known about where it sits.
 */
create or replace view public.verify_billing_events as
select
  j.id                                        as job_id,
  'VERIFY'::text                              as product_type,
  null::text                                  as quality_tier,
  j.user_id,
  j.query                                     as subject,
  j.completed_at,
  round(extract(epoch from (j.completed_at - j.created_at)))::int as duration_seconds,

  c.total_tokens,
  c.cached_input_tokens,
  c.web_searches,
  'OPENAI'::text                              as provider,

  c.model_cost_usd,
  c.search_cost_usd,
  c.total_cogs_usd                            as provider_cogs_usd,
  c.total_cogs_cents                          as provider_cogs_cents,
  'USD'::text                                 as cogs_currency,
  c.price_state,

  (select max(b.effective_from)
     from public.provider_price_book b
    where b.provider = 'OPENAI'
      and b.effective_from <= j.completed_at
      and (b.effective_to is null or b.effective_to > j.completed_at)) as price_book_effective_from,

  coalesce((j.result_json->'_reusePlan'->>'known')::boolean, false) as reuse_graph_hit,
  (j.result_json->'_reusePlan'->>'reusableFacts')::int              as reuse_facts_reused,
  (j.result_json->'_reusePlan'->>'requiredFacts')::int              as reuse_facts_required,
  (j.result_json->'_reusePlan'->>'heldFacts')::int                  as reuse_facts_on_subject,
  (j.result_json->'_reusePlan'->>'relatedFacts')::int               as reuse_facts_on_lineage,

  (select jsonb_object_agg(s.stage, jsonb_build_object(
            'tokens', s.total_tokens,
            'web_searches', s.web_searches,
            'model_cost_usd', s.model_cost_usd,
            'search_cost_usd', s.search_cost_usd,
            'model', s.model))
     from public.verify_stage_cogs s
    where s.job_id = j.id)                    as stage_breakdown

from public.research_jobs j
join public.verify_job_cogs c on c.job_id = j.id
where j.status = 'COMPLETE';

comment on view public.verify_billing_events is
  'Metering for one completed Verify: what it consumed, what it cost Homatch in raw provider spend, and why. Cost only - never a customer price, margin, VAT or entitlement.';

revoke all on public.verify_billing_events from anon, authenticated;
grant select on public.verify_billing_events to service_role;
