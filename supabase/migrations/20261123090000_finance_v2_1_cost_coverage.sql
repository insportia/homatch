-- FINANCE V2.1 — complete cost coverage, one price resolution, honest profit (owner brief
-- "Final Finance V2.1 & Production Hardening Closeout", 2026-10-22).
--
-- Nothing here changes a customer price, a wallet balance, a settled row or a service switch.
--   1. cost_provider gains the providers the edge now records (GEMINI, CARTESIA, ELEVENLABS,
--      META, RETELL, TWILIO, RESEND, RUNPOD).
--   2. cost_events gains finance_service (the Finance V2 service the recorder declares) and
--      idempotency_key (unique: one row per provider call across retries, callbacks, replays).
--   3. provider_estimated_cost_usd: a NULL model matches only model-agnostic rows (it used to
--      fall through to gpt-4o-mini's rate), and NULL units are unknown (NULL), never $0.
--   4. provider_price_book: the Design Studio image models from imageProviders.ts PRICE_TABLE
--      (same figures and sources), so the book is the one place a rate lives; a drift test
--      keeps the two equal until Design Studio reads the book directly.
--   5. wallet_sweep_expired_reservations: row lock (skip locked) and a status guard, so a
--      settle racing the sweeper can never be relabelled EXPIRED. The sweeper stays OFF
--      (admin_settings.wallet_reservation_sweeper_enabled absent).
--   6. finance_services: the services that now record cost; finance_cost_coverage: what each
--      service's cost does NOT yet include (drives "profit incomplete" in Admin).
--   7. finance_v2_cost_lines / finance_v2_services: recorder-declared service first;
--      coverageGaps + costComplete per service.
--   8. finance_v2_shared_costs(from, to): shared infrastructure, never allocated to a service.

/* ── 1. Providers ─────────────────────────────────────────────────────────── */
alter type public.cost_provider add value if not exists 'GEMINI';
alter type public.cost_provider add value if not exists 'CARTESIA';
alter type public.cost_provider add value if not exists 'ELEVENLABS';
alter type public.cost_provider add value if not exists 'META';
alter type public.cost_provider add value if not exists 'RETELL';
alter type public.cost_provider add value if not exists 'TWILIO';
alter type public.cost_provider add value if not exists 'RESEND';
alter type public.cost_provider add value if not exists 'RUNPOD';

/* ── 2. cost_events: declared service + idempotency ───────────────────────── */
alter table public.cost_events add column if not exists finance_service text;
alter table public.cost_events add column if not exists idempotency_key text;
create unique index if not exists cost_events_idempotency_key_uq on public.cost_events (idempotency_key);
comment on column public.cost_events.finance_service is 'Finance V2 service key declared by the recorder (_shared/providerCost.ts recordUsageCost). NULL = classified by operation_type.';
comment on column public.cost_events.idempotency_key is 'One row per provider call: retries, callbacks, polling and replays upsert onto the same key.';

/* ── 3. One price resolution: no wrong-model fallback, no silent zero ────── */
create or replace function public.provider_estimated_cost_usd(
  p_provider text,
  p_unit text,
  p_units numeric,
  p_model text default null,
  p_at timestamptz default now()
)
returns numeric
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select case when p_units is null then null
              else round(pb.rate * (p_units / nullif(pb.per_units, 0)), 6) end
    from public.provider_price_book pb
   where upper(pb.provider) = upper(p_provider)
     and upper(pb.unit) = upper(p_unit)
     /* A named model takes its own rate or a model-agnostic one; an unnamed model only a
        model-agnostic one (it used to inherit whichever model sorted first: gpt-4o-mini). */
     and ((p_model is null and pb.model is null) or (p_model is not null and (pb.model is null or pb.model = p_model)))
     and pb.effective_from <= p_at
     and (pb.effective_to is null or pb.effective_to > p_at)
   order by pb.model nulls last, pb.effective_from desc
   limit 1
$$;
comment on function public.provider_estimated_cost_usd(text, text, numeric, text, timestamptz) is
  'The configured cost of a provider operation, or NULL when the price book has no active rate for it or the units are unknown. NULL is the signal for UNPRICED -- never 0. (V2.1: an unnamed model never inherits a named model''s rate.)';
revoke all on function public.provider_estimated_cost_usd(text, text, numeric, text, timestamptz) from public, anon, authenticated;
grant execute on function public.provider_estimated_cost_usd(text, text, numeric, text, timestamptz) to service_role;

/* ── 4. Design Studio image rates into the book (identical to PRICE_TABLE) ── */
/* The units the recorder emits (image tokens, messages, call minutes, scraping credits,
   captcha solves, GPU seconds), so their rates can live in the book. Widening only. */
alter table public.provider_price_book drop constraint if exists provider_price_book_unit_check;
alter table public.provider_price_book add constraint provider_price_book_unit_check check (unit = any (array[
  'INPUT_TOKEN', 'CACHED_INPUT_TOKEN', 'OUTPUT_TOKEN', 'REASONING_TOKEN', 'WEB_SEARCH_CALL', 'TOOL_CALL',
  'PROVIDER_CALL', 'CHARACTER', 'AUDIO_SECOND', 'MONTH',
  'IMAGE_INPUT_TOKEN', 'IMAGE_OUTPUT_TOKEN', 'MESSAGE', 'MINUTE', 'CREDIT', 'SOLVE', 'GPU_SECOND'])) not valid;
alter table public.provider_price_book validate constraint provider_price_book_unit_check;

insert into public.provider_price_book (provider, model, unit, rate, per_units, currency, effective_from, source, notes)
select v.provider, v.model, v.unit, v.rate, 1000000, 'USD', '2026-10-02T00:00:00Z', v.src,
       'Finance V2.1: copied from supabase/functions/_shared/designStudio/imageProviders.ts PRICE_TABLE (tests/matrix/priceRegistryDrift.test.mjs keeps them equal).'
  from (values
    ('OPENAI', 'gpt-image-2', 'INPUT_TOKEN', 5::numeric, 'https://developers.openai.com/api/docs/pricing (2026-10-02)'),
    ('OPENAI', 'gpt-image-2', 'IMAGE_INPUT_TOKEN', 8::numeric, 'https://developers.openai.com/api/docs/pricing (2026-10-02)'),
    ('OPENAI', 'gpt-image-2', 'CACHED_INPUT_TOKEN', 2::numeric, 'https://developers.openai.com/api/docs/pricing (2026-10-02)'),
    ('OPENAI', 'gpt-image-2', 'IMAGE_OUTPUT_TOKEN', 30::numeric, 'https://developers.openai.com/api/docs/pricing (2026-10-02)'),
    ('OPENAI', 'gpt-image-2.5-sunburst', 'INPUT_TOKEN', 5::numeric, 'https://developers.openai.com/api/docs/pricing (2026-10-02)'),
    ('OPENAI', 'gpt-image-2.5-sunburst', 'IMAGE_INPUT_TOKEN', 8::numeric, 'https://developers.openai.com/api/docs/pricing (2026-10-02)'),
    ('OPENAI', 'gpt-image-2.5-sunburst', 'CACHED_INPUT_TOKEN', 2::numeric, 'https://developers.openai.com/api/docs/pricing (2026-10-02)'),
    ('OPENAI', 'gpt-image-2.5-sunburst', 'IMAGE_OUTPUT_TOKEN', 30::numeric, 'https://developers.openai.com/api/docs/pricing (2026-10-02)'),
    ('OPENAI', 'gpt-image-2.5-flare', 'INPUT_TOKEN', 5::numeric, 'https://developers.openai.com/api/docs/pricing (2026-10-02)'),
    ('OPENAI', 'gpt-image-2.5-flare', 'IMAGE_INPUT_TOKEN', 8::numeric, 'https://developers.openai.com/api/docs/pricing (2026-10-02)'),
    ('OPENAI', 'gpt-image-2.5-flare', 'CACHED_INPUT_TOKEN', 2::numeric, 'https://developers.openai.com/api/docs/pricing (2026-10-02)'),
    ('OPENAI', 'gpt-image-2.5-flare', 'IMAGE_OUTPUT_TOKEN', 30::numeric, 'https://developers.openai.com/api/docs/pricing (2026-10-02)'),
    ('GEMINI', 'gemini-3-pro-image', 'INPUT_TOKEN', 2::numeric, 'https://ai.google.dev/gemini-api/docs/pricing (2026-10-02)'),
    ('GEMINI', 'gemini-3-pro-image', 'IMAGE_INPUT_TOKEN', 2::numeric, 'https://ai.google.dev/gemini-api/docs/pricing (2026-10-02)'),
    ('GEMINI', 'gemini-3-pro-image', 'IMAGE_OUTPUT_TOKEN', 120::numeric, 'https://ai.google.dev/gemini-api/docs/pricing (2026-10-02)'),
    ('GEMINI', 'gemini-3-pro-image', 'OUTPUT_TOKEN', 12::numeric, 'https://ai.google.dev/gemini-api/docs/pricing (2026-10-02)'),
    ('GEMINI', 'gemini-3.1-flash-image', 'INPUT_TOKEN', 0.5::numeric, 'https://ai.google.dev/gemini-api/docs/pricing (2026-10-02)'),
    ('GEMINI', 'gemini-3.1-flash-image', 'IMAGE_INPUT_TOKEN', 0.5::numeric, 'https://ai.google.dev/gemini-api/docs/pricing (2026-10-02)'),
    ('GEMINI', 'gemini-3.1-flash-image', 'IMAGE_OUTPUT_TOKEN', 60::numeric, 'https://ai.google.dev/gemini-api/docs/pricing (2026-10-02)'),
    ('GEMINI', 'gemini-3.1-flash-image', 'OUTPUT_TOKEN', 3::numeric, 'https://ai.google.dev/gemini-api/docs/pricing (2026-10-02)')
  ) v(provider, model, unit, rate, src)
 where not exists (select 1 from public.provider_price_book b
                    where upper(b.provider) = v.provider and b.model = v.model and upper(b.unit) = v.unit and b.effective_to is null);

/* ── 5. Reservation sweeper: lock, and never relabel a settled hold ───────── */
create or replace function public.wallet_sweep_expired_reservations(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_row record; v_count integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  for v_row in
    select id from public.usage_reservations
     where status = 'RESERVED' and expires_at < now()
     order by expires_at
     limit greatest(1, least(coalesce(p_limit, 200), 500))
     for update skip locked
  loop
    perform public.wallet_release(v_row.id, 'reservation_expired');
    /* Only a hold this sweep actually released becomes EXPIRED. A settle that won the race
       left it SETTLED, and SETTLED it stays (2026-10-22 audit: the update was unconditional). */
    update public.usage_reservations set status = 'EXPIRED' where id = v_row.id and status = 'RELEASED';
    if found then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.wallet_sweep_expired_reservations(integer) from public, anon, authenticated;
grant execute on function public.wallet_sweep_expired_reservations(integer) to service_role;

/* ── 6. Services that now record cost; what each cost does not yet include ── */
insert into public.finance_services (service_key, name, product_codes, policy_id, pricing_kind, price_note, service_control_key, sort_order) values
  ('deal_room', 'Deal Room AI', '{}', 'free_v1', 'FREE', 'AI answers inside a deal room (document analysis is billed separately)', null, 125),
  ('investment_consultant', 'Investment consultant', '{}', 'free_v1', 'FREE', 'AI investment conversation', null, 126),
  ('social_posts', 'Social post generator', '{}', 'free_v1', 'FREE', 'AI social post drafts', null, 127),
  ('communications', 'Communications (AI agent, voice, WhatsApp, calls)', '{}', 'free_v1', 'FREE', 'Outreach/voice/WhatsApp provider cost; sending services paused', null, 128),
  ('developer_tools', 'Developer document & floor-plan extraction', '{}', 'free_v1', 'FREE', 'AI extraction for developer workspaces', null, 129),
  ('property_import', 'Property import (scraping)', '{}', 'free_v1', 'FREE', 'ZenRows / ScrapingBee fetches for listing import', null, 130)
on conflict (service_key) do nothing;

create table if not exists public.finance_cost_coverage (
  service_key text not null references public.finance_services(service_key),
  source      text not null,
  status      text not null check (status in ('COVERED', 'PARTIAL', 'UNSUPPORTED', 'UNPRICED_SOURCE')),
  note        text not null,
  updated_at  timestamptz not null default now(),
  primary key (service_key, source)
);
alter table public.finance_cost_coverage enable row level security;
revoke all on public.finance_cost_coverage from anon, authenticated;
comment on table public.finance_cost_coverage is
  'Finance V2.1: known limits of each service''s recorded cost. Any non-COVERED row makes that service''s profit "incomplete" in Admin. Evidence: docs/claude/FINANCE_V2_1_COVERAGE.md.';

insert into public.finance_cost_coverage (service_key, source, status, note) values
  ('ai_talk', 'openai-realtime-listen', 'UNSUPPORTED', 'The browser streams audio to OpenAI Realtime directly; the server never sees usage, so this cost cannot be recorded server-side.'),
  ('design_studio', 'runpod-cold-start', 'PARTIAL', 'RunPod bills cold start, but delayTime mixes it with unbilled queue wait; GPU cost is a floor (executionTime only).'),
  ('design_studio', 'runpod-rate', 'UNPRICED_SOURCE', 'GPU second rate comes from env RUNPOD_DS_USD_PER_SECOND, not the price book.'),
  ('communications', 'whatsapp-meta', 'UNPRICED_SOURCE', 'Meta WhatsApp conversation pricing is not in the price book; sends are recorded with units, cost UNPRICED.'),
  ('communications', 'retell-calls', 'UNPRICED_SOURCE', 'Retell per-minute cost is not in the price book unless the webhook reports it; recorded with minutes.'),
  ('property_import', 'zenrows-scrapingbee-credits', 'UNPRICED_SOURCE', 'Credits are recorded from response headers; $ per credit is not in the price book.'),
  ('social_posts', 'gemini-2.0-flash', 'UNPRICED_SOURCE', 'gemini-2.0-flash has no price-book rate; tokens recorded, cost UNPRICED until the owner adds the rate.'),
  ('verify', 'captcha-rate', 'UNPRICED_SOURCE', '2Captcha cost per solve comes from worker env CAPTCHA_RECAPTCHA_COST_USD (default 0.003), not the price book.')
on conflict (service_key, source) do update set status = excluded.status, note = excluded.note, updated_at = now();

/* ── 7. Ledger: recorder-declared service first; coverage + completeness ─── */
create or replace view public.finance_v2_cost_lines with (security_invoker = true) as
with ce as (
  select c.id, c.provider, c.operation_type, c.source, c.request_id, c.units, c.cost_usd, c.pricing_state,
         c.job_id, c.discovery_job_id, c."timestamp", c.correlation_id, c.model, c.input_tokens, c.output_tokens, c.cached_input_tokens,
         coalesce(c.finance_service, case
           when c.job_id is not null and (c.operation_type like 'VERIFY\_%' or c.operation_type in ('REPORT_TRANSLATION_VERIFY', 'DEVELOPER_ADS_VERIFY')) then 'verify'
           /* Find Property search AI: cost_events is the correlated record (20261119130000_find_property_costs). */
           when c.operation_type like 'MARKETPLACE\_%' then 'find_property_search'
           when c.operation_type like 'FIND\_BUYERS%' or c.operation_type in ('FIND_PROPERTY_ACTOR_RUN', 'CAPTCHA_SOLVE') then null
           when c.operation_type = 'MATCH_UNLOCK' then null /* a $0 marker row, not a cost */
           when c.provider::text in ('DATAFORSEO', 'APIFY') then 'retired_providers'
           when c.operation_type ilike 'meta\_ads%' then 'meta_ads_ai'
           when c.operation_type ilike '%email%' or c.source ilike '%email%' then 'email_studio'
           /* V2.1: v1 signal classification (CLASSIFY_SIGNAL / _BATCH / _SIGNALS) is shared platform AI too. */
           when c.operation_type ilike 'CLASSIFY\_%' or c.operation_type ilike '%chat%' then 'shared_platform'
           else 'unattributed' end) as service_key
    from public.cost_events c
)
select 'ce:' || ce.id::text as line_id, ce.service_key, coalesce(ce.job_id::text, ce.correlation_id, ce.request_id, ce.discovery_job_id::text) as execution_id,
       ce."timestamp" as occurred_at, ce.provider::text as provider, ce.operation_type as operation, ce.model,
       ce.units, case when ce.input_tokens is not null or ce.output_tokens is not null then 'TOKENS' else 'UNIT' end as unit_label,
       ce.input_tokens::bigint, ce.cached_input_tokens::bigint as cached_tokens, ce.output_tokens::bigint,
       null::numeric as unit_price_usd,
       case when public.finance_cost_status(ce.pricing_state) = 'UNPRICED' then null else ce.cost_usd end as cost_usd,
       public.finance_cost_status(ce.pricing_state) as cost_status, 'cost_events'::text as cost_source, true as is_direct
  from ce where ce.service_key is not null
union all
select 'captcha:' || v.id::text, 'verify', v.job_id::text, v.created_at, coalesce(v.provider, '2CAPTCHA'), 'CAPTCHA_SOLVE ' || coalesce(v.kind, ''), null,
       1, 'SOLVE', null, null, null, v.cost_usd, v.cost_usd,
       case when v.cost_usd is null then 'UNPRICED' else 'ESTIMATED' end, 'verify_captcha_events', true
  from public.verify_captcha_events v where v.job_id is not null
union all
select 'fbrun:' || r.id::text, 'find_buyers', r.matching_job_id::text, coalesce(r.finished_at, r.created_at), 'APIFY_MEMO23',
       coalesce(r.operation, 'ACTOR_RUN') || ' · ' || r.actor_key, null, r.results_billed, 'RESULTS', null, null, null, null,
       coalesce(r.actual_micros, r.reserved_micros) / 1e6,
       case when r.actual_micros is not null and r.cost_basis = 'PROVIDER_REPORTED' then 'ACTUAL' else 'ESTIMATED' end,
       'find_buyers_actor_runs', true
  from public.find_buyers_actor_runs r where r.status <> 'RELEASED'
union all
select 'fbai:' || l.id::text, 'find_buyers', l.matching_job_id::text, l.occurred_at, 'OPENAI', l.kind || ' · ' || coalesce(l.operation, ''), l.model,
       coalesce(l.input_tokens, 0) + coalesce(l.output_tokens, 0), 'TOKENS', l.input_tokens, null, l.output_tokens, null,
       case when upper(coalesce(l.cost_state, '')) = 'UNKNOWN' then null else coalesce(l.actual_micros, l.estimated_micros) / 1e6 end,
       public.finance_cost_status(l.cost_state), 'find_buyers_cost_ledger', true
  from public.find_buyers_cost_ledger l where l.provider = 'OPENAI' and upper(coalesce(l.cost_state, '')) <> 'RELEASED'
union all
select 'fprun:' || r.id::text, 'find_property_paid', r.discovery_run_id::text, r.created_at, 'APIFY_MEMO23',
       coalesce(r.stage, 'ACTOR_RUN') || ' · ' || r.actor_key, null, r.results_billed, 'RESULTS', null, null, null, null,
       coalesce(r.actual_micros, r.reserved_micros) / 1e6,
       case when r.actual_micros is not null then 'ACTUAL' else 'ESTIMATED' end, 'find_property_actor_runs', true
  from public.find_property_actor_runs r where r.status <> 'RELEASED'
union all
select 'usage:' || u.id::text, coalesce(s.service_key, 'unattributed'), coalesce(u.job_ref, u.id::text), u.created_at, coalesce(u.provider, 'OPENAI'),
       coalesce(u.provider_operation, u.product_code), u.model,
       coalesce(u.input_tokens, 0) + coalesce(u.output_tokens, 0), 'TOKENS', u.input_tokens, u.cached_tokens, u.output_tokens, null,
       case when st.status = 'UNPRICED' then null else round((coalesce(u.raw_provider_cost_cents, 0) + coalesce(u.ai_cost_cents, 0)) / 100.0, 8) end,
       st.status, 'usage_events', true
  from public.usage_events u
  left join public.finance_services s on u.product_code = any (s.product_codes)
  cross join lateral (select case
      /* An OpenAI call with tokens but no rate at the time is UNPRICED, whatever 0 was stored
         (billing_ai_cost_cents turns a missing rate into 0). */
      when coalesce(u.provider, 'OPENAI') = 'OPENAI' and u.model is not null and coalesce(u.input_tokens, 0) + coalesce(u.output_tokens, 0) > 0
       and (public.price_per_unit_at('OPENAI', u.model, 'INPUT_TOKEN', u.created_at) is null
            or public.price_per_unit_at('OPENAI', u.model, 'OUTPUT_TOKEN', u.created_at) is null) then 'UNPRICED'
      else public.finance_cost_status(coalesce(u.metadata ->> 'pricing_state', u.pricing_state)) end as status) st
 where u.product_code not in ('VERIFY', 'FIND_CLIENTS', 'FIND_PROPERTY')
   and (coalesce(u.raw_provider_cost_cents, 0) + coalesce(u.ai_cost_cents, 0) > 0 or coalesce(u.input_tokens, 0) + coalesce(u.output_tokens, 0) > 0)
union all
select 'voice:' || v.id::text, 'ai_talk', v.session_id::text, v.occurred_at, v.provider, coalesce(v.role, 'VOICE'), v.model,
       coalesce(v.characters::numeric, v.audio_seconds::numeric, (coalesce(v.input_tokens, 0) + coalesce(v.output_tokens, 0))::numeric),
       case when v.characters is not null then 'CHARACTERS' when v.audio_seconds is not null then 'AUDIO_SECONDS' else 'TOKENS' end,
       v.input_tokens, v.cached_input_tokens, v.output_tokens, null, v.cost_usd,
       case when v.cost_usd is null then 'UNPRICED' else 'ESTIMATED' end, 'voice_usage_events', true
  from public.voice_usage_events v;
comment on view public.finance_v2_cost_lines is
  'Finance V2.1: every directly attributable provider/AI cost, from its authoritative source (Verify cost_events + CAPTCHA, Find Buyers actor runs + OpenAI ledger, Find Property search telemetry + paid actor runs, usage_events for cost-based products, voice_usage_events). cost_usd NULL = UNPRICED, never 0. Superseded duplicates (cost_events copies of ledgered rows) are excluded.';

revoke all on public.finance_v2_cost_lines from anon, authenticated;

create or replace function public.finance_v2_services(p_from timestamptz default now() - interval '30 days', p_to timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.finance_require_admin();
  return coalesce((
    with rev as (
      select service_key, count(*) filter (where gross_usd > 0) charges, sum(gross_usd) gross, sum(vat_usd) vat, sum(net_usd) net,
             sum(homatch_allocation_usd) homatch_alloc, sum(execution_allocation_usd) exec_alloc,
             sum(case when gross_usd < 0 then -gross_usd else 0 end) refunds,
             sum(public.finance_credits_to_usd(coalesce(released_credits, 0), occurred_at)) unused_usd,
             count(*) filter (where profit_floor_shortfall) floor_shortfalls,
             count(*) filter (where vat_bps is null) tax_unknown
        from public.finance_v2_revenue_lines where occurred_at >= p_from and occurred_at < p_to group by 1),
    cost as (
      select service_key, count(*) lines, sum(cost_usd) cogs,
             sum(cost_usd) filter (where upper(provider) in ('OPENAI', 'ANTHROPIC', 'GEMINI', 'GOOGLE', 'CARTESIA', 'ELEVENLABS')) ai_cogs,
             sum(cost_usd) filter (where cost_status = 'ACTUAL') actual_cogs,
             sum(cost_usd) filter (where cost_status = 'ESTIMATED') estimated_cogs,
             count(*) filter (where cost_status = 'UNPRICED') unpriced_lines,
             count(*) filter (where cost_status = 'PARTIALLY_PRICED') partial_lines
        from public.finance_v2_cost_lines where occurred_at >= p_from and occurred_at < p_to group by 1),
    ex as (
      select service_key, count(distinct execution_id) executions from (
        select service_key, execution_id from public.finance_v2_revenue_lines where occurred_at >= p_from and occurred_at < p_to
        union select service_key, execution_id from public.finance_v2_cost_lines where occurred_at >= p_from and occurred_at < p_to) x group by 1),
    sc as (select service_key, frontend_enabled, backend_enabled from public.service_controls_public())
    select jsonb_agg(jsonb_build_object(
      'service', s.service_key, 'name', s.name, 'policy', s.policy_id, 'pricingKind', s.pricing_kind, 'priceNote', s.price_note,
      'productCodes', to_jsonb(s.product_codes),
      'live', case when s.service_control_key is null then null else jsonb_build_object('frontend', sc.frontend_enabled, 'backend', sc.backend_enabled) end,
      'executions', coalesce(ex.executions, 0), 'charges', coalesce(rev.charges, 0),
      'grossUsd', round(coalesce(rev.gross, 0), 6), 'vatUsd', round(coalesce(rev.vat, 0), 6), 'netUsd', round(coalesce(rev.net, 0), 6),
      'homatchAllocationUsd', round(rev.homatch_alloc, 6), 'executionAllocationUsd', round(rev.exec_alloc, 6),
      'refundsUsd', round(coalesce(rev.refunds, 0), 6), 'unusedBudgetUsd', round(coalesce(rev.unused_usd, 0), 6),
      'cogsUsd', round(coalesce(cost.cogs, 0), 8), 'aiCogsUsd', round(coalesce(cost.ai_cogs, 0), 8),
      'providerCogsUsd', round(coalesce(cost.cogs, 0) - coalesce(cost.ai_cogs, 0), 8),
      'actualCogsUsd', round(coalesce(cost.actual_cogs, 0), 8), 'estimatedCogsUsd', round(coalesce(cost.estimated_cogs, 0), 8),
      'costLines', coalesce(cost.lines, 0), 'unpricedLines', coalesce(cost.unpriced_lines, 0), 'partialLines', coalesce(cost.partial_lines, 0),
      'profitUsd', round(coalesce(rev.net, 0) - coalesce(cost.cogs, 0), 6),
      'marginBps', case when coalesce(rev.net, 0) > 0 then round((rev.net - coalesce(cost.cogs, 0)) / rev.net * 10000) end,
      'avgCostPerExecutionUsd', case when coalesce(ex.executions, 0) > 0 then round(coalesce(cost.cogs, 0) / ex.executions, 8) end,
      'profitFloorShortfalls', coalesce(rev.floor_shortfalls, 0), 'taxUnknownLines', coalesce(rev.tax_unknown, 0),
      /* V2.1: what this service's cost figure does NOT include, and whether profit is complete. */
      'coverageGaps', coalesce((select jsonb_agg(jsonb_build_object('source', g.source, 'status', g.status, 'note', g.note) order by g.source)
                                  from public.finance_cost_coverage g where g.service_key = s.service_key and g.status <> 'COVERED'), '[]'::jsonb),
      'costComplete', coalesce(cost.unpriced_lines, 0) = 0 and coalesce(cost.partial_lines, 0) = 0
                      and not exists (select 1 from public.finance_cost_coverage g where g.service_key = s.service_key and g.status <> 'COVERED'))
      order by s.sort_order)
    from public.finance_services s
    left join rev on rev.service_key = s.service_key
    left join cost on cost.service_key = s.service_key
    left join ex on ex.service_key = s.service_key
    left join sc on sc.service_key = s.service_control_key
  ), '[]'::jsonb);
end $$;


/* ── 8. Shared infrastructure: never allocated to a service ────────────────── */
create or replace function public.finance_v2_shared_costs(p_from timestamptz default now() - interval '30 days', p_to timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_days numeric := greatest(extract(epoch from (p_to - p_from)) / 86400.0, 0);
begin
  perform public.finance_require_admin();
  return jsonb_build_object(
    'periodDays', round(v_days, 2),
    'lines', coalesce((select jsonb_agg(x order by x ->> 'vendor') from (
      /* Monthly rates in the price book, prorated over the period (30.4375-day month). */
      select jsonb_build_object('vendor', pb.provider, 'item', pb.model, 'source', 'provider_price_book',
               'monthlyUsd', round(pb.rate / pb.per_units, 6),
               'periodUsd', round(pb.rate / pb.per_units * v_days / 30.4375, 6), 'status', 'ESTIMATED') x
        from public.provider_price_book pb
       where upper(pb.unit) = 'MONTH' and pb.effective_from <= p_to and (pb.effective_to is null or pb.effective_to > p_from)
      union all
      /* Company fixed expenses: an amount of 0 means NOT CONFIGURED, never free. */
      select jsonb_build_object('vendor', e.vendor, 'item', e.name, 'source', 'finance_fixed_expenses',
               'monthlyUsd', case when e.amount_cents > 0 then round(e.amount_cents / 100.0 / case upper(e.billing_frequency) when 'ANNUAL' then 12 when 'YEARLY' then 12 when 'QUARTERLY' then 3 else 1 end, 6) end,
               'periodUsd', case when e.amount_cents > 0 then round(e.amount_cents / 100.0 / case upper(e.billing_frequency) when 'ANNUAL' then 12 when 'YEARLY' then 12 when 'QUARTERLY' then 3 else 1 end * v_days / 30.4375, 6) end,
               'status', case when e.amount_cents > 0 then 'ESTIMATED' else 'NOT_CONFIGURED' end)
        from public.finance_fixed_expenses e
       where e.active and e.superseded_by is null and (e.ends_at is null or e.ends_at >= p_from::date) and e.starts_at <= p_to::date
    ) t), '[]'::jsonb),
    'complete', not exists (select 1 from public.finance_fixed_expenses e where e.active and e.superseded_by is null and coalesce(e.amount_cents, 0) <= 0));
end $$;
revoke all on function public.finance_v2_shared_costs(timestamptz, timestamptz) from public, anon;
grant execute on function public.finance_v2_shared_costs(timestamptz, timestamptz) to authenticated;

/* ── 9. Live price drift: the copies that must equal provider_price_book ──── */
create or replace function public.finance_v2_price_drift()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_fb jsonb := (select value from public.admin_settings where key = 'find_buyers_openai_price_book');
begin
  perform public.finance_require_admin();
  return coalesce((select jsonb_agg(x) from (
    /* Find Buyers prices its OpenAI calls from this setting (it also drives the campaign budget). */
    select jsonb_build_object('registry', 'admin_settings.find_buyers_openai_price_book', 'model', v_fb ->> 'model', 'unit', u.unit,
             'settingPerMTokUsd', u.setting_usd, 'bookPerMTokUsd', round(public.provider_estimated_cost_usd('OPENAI', u.unit, 1000000, v_fb ->> 'model'), 6),
             'status', case when public.provider_estimated_cost_usd('OPENAI', u.unit, 1000000, v_fb ->> 'model') is null then 'NOT_IN_BOOK'
                            when round(public.provider_estimated_cost_usd('OPENAI', u.unit, 1000000, v_fb ->> 'model'), 6) = round(u.setting_usd, 6) then 'MATCH'
                            else 'DRIFT' end) x
      from (values ('INPUT_TOKEN', (v_fb ->> 'inputPerMTokMicros')::numeric / 1e6),
                   ('OUTPUT_TOKEN', (v_fb ->> 'outputPerMTokMicros')::numeric / 1e6)) u(unit, setting_usd)
     where v_fb is not null
  ) t), '[]'::jsonb);
end $$;
revoke all on function public.finance_v2_price_drift() from public, anon;
grant execute on function public.finance_v2_price_drift() to authenticated;
