-- AI TALK COST OF GOODS: the middle of a chain whose two ends already existed.
--
-- voice_usage_events has carried cost_usd and cost_basis since it was written,
-- and provider_price_book has carried effective-dated rates with the exact
-- resolution semantics COGS needs. Neither was ever connected to AI Talk:
--
--   * every one of the 2,238 AI Talk usage rows in production is a Cartesia
--     TTS row, and every single cost_usd is NULL
--   * no STT row has ever been written -- the browser streams microphone audio
--     straight to the Railway worker and nothing reports the duration back
--   * no LLM row has ever been written -- Luna's token counts reach a console
--     log line in turn_trace and stop there
--   * the price book has no row for any voice provider at all
--
-- This migration adds only what that middle needs. It creates no second
-- ledger, no parallel pricing table and no customer-facing number.
--
-- COGS ONLY. Nothing here is what a customer is charged, and nothing here may
-- ever become that. See voice_usage_events' own header.

-- ── 1. The units voice actually bills in ────────────────────────────────────
--
-- The book was written for token-billed models. Speech is billed by the
-- character and by the second, and fixed infrastructure is billed by the
-- month. MONTH is deliberately in the same table rather than a new one: there
-- must be exactly one place that answers "what does this cost".

alter table public.provider_price_book
  drop constraint if exists provider_price_book_unit_check;

alter table public.provider_price_book
  add constraint provider_price_book_unit_check check (unit in (
    'INPUT_TOKEN',
    'CACHED_INPUT_TOKEN',
    'OUTPUT_TOKEN',
    'REASONING_TOKEN',
    'WEB_SEARCH_CALL',
    'TOOL_CALL',
    'PROVIDER_CALL',
    -- Synthesis is billed per character of text submitted.
    'CHARACTER',
    -- Streaming recognition is billed per second of audio streamed.
    'AUDIO_SECOND',
    -- A fixed monthly subscription, allocated rather than metered. Rows with
    -- this unit are NOT provider-native variable cost and must never be
    -- presented as though they were.
    'MONTH'
  ));

-- ── 2. What the prompt cache actually saved ─────────────────────────────────
--
-- The book has had a CACHED_INPUT_TOKEN rate for Luna since it was seeded --
-- one tenth of the fresh input rate -- and nothing could use it, because the
-- usage type in _shared/comm/llm.ts narrowed the provider's usage object to
-- two fields and dropped input_tokens_details.cached_tokens at parse time.
-- Cached tokens are a subset of input_tokens, not an addition to them.

alter table public.voice_usage_events
  add column if not exists cached_input_tokens integer;

comment on column public.voice_usage_events.cached_input_tokens is
  'Of input_tokens, how many the provider served from its prompt cache. A '
  'subset of input_tokens, never an addition. NULL means the provider did not '
  'say, which is not the same as zero.';

-- Per-session roll-up joins on the bare session_id uuid; there is no FK
-- because voice_usage_events serves surfaces that have no talk session.
create index if not exists voice_usage_events_session
  on public.voice_usage_events (session_id, occurred_at desc)
  where session_id is not null;

-- ── 3. The rates, from the providers' own published pricing ─────────────────
--
-- Correcting a price is closing one row and opening another, never editing the
-- past: provider_price_book_no_overlap enforces that, so these are inserted
-- with effective_from at the beginning of recorded AI Talk usage and no
-- effective_to. Guarded so re-running this migration is not an error.

insert into public.provider_price_book (provider, model, unit, rate, per_units, currency, effective_from, source, notes)
select * from (values
  -- Cartesia Sonic, billed per character submitted to synthesis.
  ('CARTESIA', 'sonic-3', 'CHARACTER', 65.00, 1000000::numeric, 'USD',
   timestamptz '2026-09-13 00:00:00+00',
   'cartesia.ai/pricing (retrieved 2026-09-18)',
   'Scale plan effective character rate. Cartesia bills the text SUBMITTED, so a '
   'request cancelled mid-stream is still billed for what was sent.'),
  ('CARTESIA', 'sonic-2', 'CHARACTER', 65.00, 1000000::numeric, 'USD',
   timestamptz '2026-09-13 00:00:00+00', 'cartesia.ai/pricing (retrieved 2026-09-18)', null),
  ('CARTESIA', 'sonic', 'CHARACTER', 65.00, 1000000::numeric, 'USD',
   timestamptz '2026-09-13 00:00:00+00', 'cartesia.ai/pricing (retrieved 2026-09-18)', null),

  -- Google Cloud Speech-to-Text v2, streaming, chirp_3. Billed per second of
  -- audio streamed, per stream.
  ('GOOGLE', 'chirp_3', 'AUDIO_SECOND', 0.016, 60::numeric, 'USD',
   timestamptz '2026-09-13 00:00:00+00',
   'cloud.google.com/speech-to-text/v2/pricing (retrieved 2026-09-18)',
   'Dynamic batching / streaming rate, $0.016 per minute. AI TALK OPENS TWO '
   'CONCURRENT STREAMS PER SESSION -- the pinned recogniser and the auto second '
   'opinion -- and both are billed, so a session''s STT seconds are roughly '
   'double its speech seconds. That is the cost of the language switching, and '
   'it is recorded as two measurements rather than hidden in one.'),

  -- ElevenLabs is no longer on the AI Talk synthesis path, but 237 historical
  -- rows are, and a rate makes them priceable rather than permanently unknown.
  ('ELEVENLABS', 'eleven_flash_v2_5', 'CHARACTER', 50.00, 1000000::numeric, 'USD',
   timestamptz '2026-09-13 00:00:00+00', 'elevenlabs.io/pricing (retrieved 2026-09-18)',
   'Historical only. AI Talk synthesis has been Cartesia-only since 2026-09-14.'),
  ('ELEVENLABS', 'eleven_v3_conversational', 'CHARACTER', 100.00, 1000000::numeric, 'USD',
   timestamptz '2026-09-13 00:00:00+00', 'elevenlabs.io/pricing (retrieved 2026-09-18)', 'Historical only.'),
  ('ELEVENLABS', 'eleven_v3', 'CHARACTER', 100.00, 1000000::numeric, 'USD',
   timestamptz '2026-09-13 00:00:00+00', 'elevenlabs.io/pricing (retrieved 2026-09-18)', 'Historical only.'),

  -- ── FIXED INFRASTRUCTURE, ALLOCATED AND NOT METERED ──────────────────────
  --
  -- These are monthly subscriptions, not per-call prices, and they are kept
  -- visibly separate everywhere they are shown. The allocation methodology is
  -- stated in ai_talk_infra_allocation below and is the only honest thing to
  -- do with a fixed cost: divide it by the usage it actually served.
  --
  -- Railway: the official worker exists ONLY to carry AI Talk speech to
  -- Google, so 100% of it is AI-Talk-attributable. Measured over the 7 days to
  -- 2026-09-18 it averaged 0.0018 vCPU and 0.276 GB, which at Railway's
  -- $20/vCPU-month and $10/GB-month is about $2.80 of usage on top of the $5
  -- seat.
  ('RAILWAY', 'homatch-official-worker', 'MONTH', 7.80, 1::numeric, 'USD',
   timestamptz '2026-09-13 00:00:00+00',
   'Railway usage metrics 7d to 2026-09-18 + railway.com/pricing',
   '$5 seat + measured usage (avg 0.0018 vCPU, 0.276 GB). 100% AI-Talk-attributable: '
   'this service carries nothing else.'),

  -- Supabase: a shared Pro plan. AI Talk is one surface among many, so only a
  -- share is attributable, and that share is an ESTIMATE stated as one rather
  -- than a measurement dressed as one.
  ('SUPABASE', 'pro-plan-ai-talk-share', 'MONTH', 5.00, 1::numeric, 'USD',
   timestamptz '2026-09-13 00:00:00+00',
   'supabase.com/pricing ($25/mo Pro) + operator-set attributable share',
   'ESTIMATED share of the $25 Pro plan attributable to AI Talk (edge invocations, '
   'logs, session rows). Not measured per request. Change this row -- close it and '
   'open a new one -- when a better basis exists.')
) as v(provider, model, unit, rate, per_units, currency, effective_from, source, notes)
where not exists (
  select 1 from public.provider_price_book b
  where b.provider = v.provider
    and coalesce(b.model, '') = coalesce(v.model, '')
    and b.unit = v.unit
);

-- ── 4. The allocation methodology, as a function rather than a comment ──────
--
-- Fixed monthly infrastructure divided by the AI Talk usage that month. This
-- is deliberately a view over real usage rather than a stored per-event
-- number: allocating a subscription is an opinion about a denominator, and an
-- opinion should be recomputed, not frozen into a ledger.
--
-- Returns NULL, not zero, for a month with no measured minutes. Dividing a
-- fixed cost by nothing does not make the cost nothing.

create or replace function public.ai_talk_infra_allocation(p_from timestamptz, p_to timestamptz)
returns table (
  monthly_usd numeric,
  months numeric,
  period_usd numeric,
  minutes numeric,
  usd_per_minute numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with fixed as (
    select coalesce(sum(rate), 0)::numeric as monthly_usd
    from public.provider_price_book
    where unit = 'MONTH'
      and effective_from <= p_to
      and (effective_to is null or effective_to > p_from)
  ),
  used as (
    select coalesce(sum(consumed_seconds), 0)::numeric / 60.0 as minutes
    from public.comm_talk_sessions
    where created_at >= p_from and created_at < p_to
  ),
  -- The fraction of a 30-day month this window covers, so a 7-day view is
  -- charged roughly 7/30 of the subscription rather than all of it.
  span as (
    select greatest(extract(epoch from (p_to - p_from)) / 2592000.0, 0)::numeric as months
  )
  select
    fixed.monthly_usd,
    span.months,
    round(fixed.monthly_usd * span.months, 6) as period_usd,
    used.minutes,
    case when used.minutes > 0
      then round(fixed.monthly_usd * span.months / used.minutes, 6)
      else null
    end as usd_per_minute
  from fixed, used, span;
$$;

comment on function public.ai_talk_infra_allocation(timestamptz, timestamptz) is
  'Fixed monthly infrastructure (provider_price_book rows with unit = MONTH), '
  'pro-rated to the window and divided by the AI Talk minutes actually served '
  'in it. ALLOCATED, not metered: never present this beside provider-native '
  'variable cost without saying which is which. NULL usd_per_minute when there '
  'were no minutes.';

revoke all on function public.ai_talk_infra_allocation(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.ai_talk_infra_allocation(timestamptz, timestamptz) to service_role;

-- ── 5. Pricing the rows that are already in the table ───────────────────────
--
-- BACKFILL, AND ONLY WHERE IT IS DETERMINISTIC.
--
-- Every historical AI Talk row is a TTS row with a real character count and a
-- real model, and the rate for that model on that date is now on file. That
-- multiplication is arithmetic, not a guess, so it is done, and marked
-- CALCULATED -- from provider-reported units and an admin-entered rate, which
-- is exactly what that basis means.
--
-- NOTHING ELSE IS BACKFILLED. There are no historical STT or LLM rows to
-- price, and inventing the audio seconds or token counts they would have had
-- would be fabrication. Those sessions keep an honest hole.

update public.voice_usage_events e
set cost_usd = round(
      (e.characters::numeric / b.per_units) * b.rate,
      6
    ),
    cost_basis = 'CALCULATED'
from public.provider_price_book b
where e.cost_usd is null
  and e.role = 'TTS'
  and e.characters is not null
  and e.characters > 0
  and b.provider = e.provider
  and b.model = e.model
  and b.unit = 'CHARACTER'
  and b.effective_from <= e.occurred_at
  and (b.effective_to is null or b.effective_to > e.occurred_at);
